-- ==========================================
-- 인스타 자동 제작 + 자동 업로드 서비스 DB 스키마
-- Supabase SQL Editor에 전체 복사 후 [Run]을 누르세요.
-- ==========================================

-- UUID 생성 확장 기능 활성화
create extension if not exists "pgcrypto";

-- 1. 연결된 인스타그램 계정 테이블
create table if not exists public.instagram_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ig_user_id text not null,
  username text not null,
  name text default '',
  profile_picture_url text default '',
  encrypted_access_token text not null,
  token_expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'expiring_soon', 'expired', 'disconnected')),
  default_font text not null default 'Pretendard',
  default_mood text not null default 'minimal',
  default_accent_color text not null default '#2563EB',
  default_hashtags text not null default '#일상 #카드뉴스 #인스타그램',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, ig_user_id)
);

-- 2. 게시물(카드뉴스 프로젝트) 테이블
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '새 게시물',
  raw_text text not null default '',
  publish_mode text not null default 'auto_publish' check (publish_mode in ('auto_publish', 'download_only')),
  slide_count integer not null default 4,
  aspect_ratio text not null default '4:5',
  font_family text not null default 'Pretendard',
  mood_preset text not null default 'minimal',
  accent_color text not null default '#2563EB',
  caption_tone text not null default 'friendly',
  base_caption text not null default '',
  slides jsonb not null default '[]'::jsonb,
  uploaded_photos jsonb not null default '[]'::jsonb,
  rendered_image_urls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. 계정별 업로드 및 예약 작업(타겟) 테이블
create table if not exists public.post_targets (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  instagram_account_id uuid not null references public.instagram_accounts(id) on delete cascade,
  custom_caption text not null default '',
  status text not null default 'scheduled' check (status in ('scheduled', 'publishing', 'published', 'retry_pending', 'failed')),
  scheduled_at timestamptz not null default now(),
  published_at timestamptz,
  ig_media_id text,
  ig_permalink text,
  retry_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. 사용자별 일일 AI 생성 횟수 제한 테이블 (AI 비용 보호용)
create table if not exists public.daily_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default current_date,
  generation_count integer not null default 0,
  unique(user_id, usage_date)
);

-- 인덱스 생성 (조회 및 예약 작업 속도 향상)
create index if not exists idx_ig_accounts_user_id on public.instagram_accounts(user_id);
create index if not exists idx_posts_user_id on public.posts(user_id);
create index if not exists idx_post_targets_status_scheduled on public.post_targets(status, scheduled_at);
create index if not exists idx_post_targets_user_id on public.post_targets(user_id);

-- ==========================================
-- RLS (Row Level Security) 보안 정책:
-- 다른 사용자의 사진, 토큰, 게시물을 절대 볼 수 없게 차단
-- (여러 번 실행해도 오류가 나지 않도록 기존 정책 삭제 후 재생성)
-- ==========================================
alter table public.instagram_accounts enable row level security;
alter table public.posts enable row level security;
alter table public.post_targets enable row level security;
alter table public.daily_usage enable row level security;

drop policy if exists "본인 인스타 계정만 조회/관리" on public.instagram_accounts;
create policy "본인 인스타 계정만 조회/관리" on public.instagram_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "본인 게시물만 조회/관리" on public.posts;
create policy "본인 게시물만 조회/관리" on public.posts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "본인 업로드 기록만 조회/관리" on public.post_targets;
create policy "본인 업로드 기록만 조회/관리" on public.post_targets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "본인 일일 사용량만 조회/관리" on public.daily_usage;
create policy "본인 일일 사용량만 조회/관리" on public.daily_usage
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ==========================================
-- Supabase Storage 버킷 설정
-- 1) user-uploads: 사용자가 올린 원본 사진
-- 2) post-images: 인스타 API가 읽어갈 최종 JPEG 이미지 (공개 URL)
-- ==========================================
insert into storage.buckets (id, name, public)
values ('user-uploads', 'user-uploads', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do nothing;

-- Storage 보안 정책: 본인 폴더(user_id/...)에만 업로드/삭제 가능
drop policy if exists "본인 원본 사진 업로드" on storage.objects;
create policy "본인 원본 사진 업로드" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'user-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "원본 사진 공개 읽기" on storage.objects;
create policy "원본 사진 공개 읽기" on storage.objects
  for select to public
  using (bucket_id = 'user-uploads');

drop policy if exists "본인 렌더링 이미지 업로드" on storage.objects;
create policy "본인 렌더링 이미지 업로드" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'post-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "렌더링 이미지 공개 읽기 (인스타 API 수집용)" on storage.objects;
create policy "렌더링 이미지 공개 읽기 (인스타 API 수집용)" on storage.objects
  for select to public
  using (bucket_id = 'post-images');

-- ==========================================
-- 6. AI 카드뉴스 기획안 저장 테이블 (plans)
-- ==========================================
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  topic text not null,
  target_audience text default '',
  purpose text default '',
  tone text default 'friendly',
  reference_text text default '',
  slide_count integer not null default 5,
  recommended_slide_count integer not null default 5,
  recommendation_reason text default '',
  cover_candidates jsonb not null default '[]',
  cover_title_candidates jsonb not null default '[]',
  selected_cover_index integer not null default 0,
  cuts_json jsonb not null default '[]',
  cuts jsonb not null default '[]',
  plan_group_json jsonb not null default '[]',
  brand_settings_json jsonb not null default '{}',
  caption_draft text default '',
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.plans enable row level security;

drop policy if exists "본인 기획안만 조회/관리" on public.plans;
create policy "본인 기획안만 조회/관리" on public.plans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ==========================================
-- 7. 계정별 브랜드 설정 테이블 (brand_settings)
-- ==========================================
create table if not exists public.brand_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  account_id text not null default 'default',
  tone text default '친근하게',
  favorite_hashtags text default '',
  forbidden_words text default '',
  closing_signature text default '',
  updated_at timestamptz not null default now()
);

alter table public.brand_settings enable row level security;

drop policy if exists "본인 브랜드 설정만 조회/관리" on public.brand_settings;
create policy "본인 브랜드 설정만 조회/관리" on public.brand_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ==========================================
-- 8. 내 템플릿 저장 테이블 (user_card_templates)
-- ==========================================
create table if not exists public.user_card_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  template_config jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.user_card_templates enable row level security;

drop policy if exists "본인 템플릿만 조회/관리" on public.user_card_templates;
create policy "본인 템플릿만 조회/관리" on public.user_card_templates
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);



