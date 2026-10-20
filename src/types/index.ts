// src/types/index.ts
import { AspectRatioKey, CaptionToneId, FontId, MoodId } from '@/config/constants';

export type SlideRole = 'single_core' | 'cover' | 'body' | 'cta';

export type SlideLayoutType = 'auto' | 'top-photo' | 'bottom-photo' | 'full-bleed' | 'split-left';

export interface UploadedPhoto {
  id: string;
  url: string; // 공개 URL 또는 Data URL
  name: string;
  width?: number;
  height?: number;
}

export interface CustomFontItem {
  id: string;
  name: string;
  base64Data: string; // base64 font buffer for satori server rendering
  mimeType?: string;
}

export interface SlideItem {
  id: string;
  slideNumber: number;
  role: SlideRole;
  roleLabel: string; // '핵심 한 줄' | '표지' | '본문' | '마무리·행동 유도'
  badgeText: string;
  headline: string;
  body: string;
  photoIndex: number | null; // 대표 사진 인덱스 (하위 호환)
  photoUrl?: string | null; // 대표 사진 URL (하위 호환)
  // 한 장에 사진 여러 장(1~4장) 넣기 지원
  photoIndices?: number[];
  photoUrls?: string[];
  multiPhotoLayout?: 'auto' | 'row' | 'col' | 'grid' | 'collage';
  // 사진 직접 수정 (위치/확대/어둡기)
  focusX?: number; // 0~100 (가로 위치 중심)
  focusY?: number; // 0~100 (세로 위치 중심)
  photoZoom?: number; // 100~200 (%)
  overlayOpacity?: number; // 0~85 (%) 배경 사진 위 어두운 정도
  // 레이아웃 및 글씨 위치·크기·정렬·색상 직접 수정
  layoutType?: SlideLayoutType;
  textPosition?: 'top' | 'center' | 'bottom';
  textAlign?: 'left' | 'center' | 'right';
  titleSize?: number; // 사용자 지정 제목 크기 (px)
  bodySize?: number; // 사용자 지정 본문 크기 (px)
  customTextColor?: string;
  customBgColor?: string;
  showBadge?: boolean;
  showSlideNumber?: boolean;
  footerText?: string; // 슬라이드별 하단 문구 (비워두면 표시 안 함)
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
  font_family: string;
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
