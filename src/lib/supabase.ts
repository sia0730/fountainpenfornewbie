// src/lib/supabase.ts
// 브라우저 및 서버 API에서 사용하는 Supabase 클라이언트와 일일 AI 생성 한도 체크 함수입니다.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { MAX_DAILY_AI_GENERATIONS } from '@/config/constants';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;

// 브라우저용 클라이언트
let browserClient: SupabaseClient | null = null;
export function getSupabaseBrowser(): SupabaseClient {
  if (!browserClient) {
    browserClient = createClient(supabaseUrl, supabaseAnonKey);
  }
  return browserClient;
}

// 서버 관리자용 클라이언트 (API 라우트 및 예약 업로드 크론용)
export function getSupabaseAdmin(): SupabaseClient {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });
}

// 요청 헤더의 Bearer 토큰으로 현재 로그인한 사용자 확인
export async function getUserFromRequest(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.replace('Bearer ', '').trim();
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return null;
  }
  return data.user;
}

// [지켜야 할 것] 사용자 1명이 하루에 만들 수 있는 게시물 수를 제한 (AI 비용 보호)
export async function checkAndIncrementDailyUsage(userId: string): Promise<{
  allowed: boolean;
  currentCount: number;
  limit: number;
}> {
  const admin = getSupabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);

  const { data: existing } = await admin
    .from('daily_usage')
    .select('*')
    .eq('user_id', userId)
    .eq('usage_date', today)
    .maybeSingle();

  const currentCount = existing?.generation_count ?? 0;

  if (currentCount >= MAX_DAILY_AI_GENERATIONS) {
    return {
      allowed: false,
      currentCount,
      limit: MAX_DAILY_AI_GENERATIONS,
    };
  }

  if (existing) {
    await admin
      .from('daily_usage')
      .update({ generation_count: currentCount + 1 })
      .eq('id', existing.id);
  } else {
    await admin.from('daily_usage').insert({
      user_id: userId,
      usage_date: today,
      generation_count: 1,
    });
  }

  return {
    allowed: true,
    currentCount: currentCount + 1,
    limit: MAX_DAILY_AI_GENERATIONS,
  };
}
