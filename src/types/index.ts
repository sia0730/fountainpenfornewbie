// src/types/index.ts
import { AspectRatioKey, CaptionToneId, FontId, MoodId } from '@/config/constants';

export type SlideRole = 'single_core' | 'cover' | 'body' | 'cta';

export interface UploadedPhoto {
  id: string;
  url: string; // 공개 URL 또는 Data URL
  name: string;
  width?: number;
  height?: number;
}

export interface SlideItem {
  id: string;
  slideNumber: number;
  role: SlideRole;
  roleLabel: string; // '핵심 한 줄' | '표지' | '본문' | '마무리·행동 유도'
  badgeText: string;
  headline: string;
  body: string;
  photoIndex: number | null; // uploadedPhotos 배열 내 인덱스 (사진 없는 글 전용 장이면 null)
  photoUrl?: string | null;
  focusX?: number; // 0~100 (얼굴/피사체 중심 가로 비율)
  focusY?: number; // 0~100 (얼굴/피사체 중심 세로 비율)
  textPosition?: 'top' | 'bottom' | 'center';
  renderedUrl?: string;
}

export interface InstagramAccount {
  id: string;
  user_id: string;
  ig_user_id: string;
  username: string;
  name: string;
  profile_picture_url: string;
  token_expires_at: string;
  status: 'active' | 'expiring_soon' | 'expired' | 'disconnected';
  default_font: FontId;
  default_mood: MoodId;
  default_accent_color: string;
  default_hashtags: string;
  quota_usage?: number;
  quota_limit?: number;
}

export interface PostTargetRecord {
  id: string;
  post_id: string;
  instagram_account_id: string;
  custom_caption: string;
  status: 'scheduled' | 'publishing' | 'published' | 'retry_pending' | 'failed';
  scheduled_at: string;
  published_at?: string | null;
  ig_media_id?: string | null;
  ig_permalink?: string | null;
  retry_count: number;
  error_message?: string | null;
  instagram_accounts?: {
    username: string;
    profile_picture_url: string;
  };
}

export interface PostRecord {
  id: string;
  user_id: string;
  title: string;
  raw_text: string;
  publish_mode: 'auto_publish' | 'download_only';
  slide_count: number;
  aspect_ratio: AspectRatioKey;
  font_family: FontId;
  mood_preset: MoodId;
  accent_color: string;
  caption_tone: CaptionToneId;
  base_caption: string;
  slides: SlideItem[];
  uploaded_photos: UploadedPhoto[];
  rendered_image_urls: string[];
  created_at: string;
  post_targets?: PostTargetRecord[];
}
