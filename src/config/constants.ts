// src/config/constants.ts
// [기능 1] 최대 장수 및 서비스 주요 제한값을 한 곳에서 관리하는 설정 파일입니다.

export const MAX_SLIDES = {
  // 인스타 자동 업로드(API): 인스타그램 공식 캐러셀 한도에 맞춰 최대 10장
  AUTO_PUBLISH: 10,
  // 이미지 다운로드만 할 때: 인스타그램 앱에서 직접 올릴 때용 최대 20장
  DOWNLOAD_ONLY: 20,
} as const;

// 한 사용자가 연결할 수 있는 최대 인스타그램 계정 수
export const MAX_IG_ACCOUNTS = 5;

// 사용자 1명이 하루에 AI로 자동 생성할 수 있는 게시물 횟수 (AI 비용 보호)
export const MAX_DAILY_AI_GENERATIONS = 15;

// 인스타그램 계정 1개당 하루 최대 API 업로드 한도 (Instagram Graph API 공식 기준)
export const IG_DAILY_PUBLISH_LIMIT = 25;

// 인스타그램 캡션 제한
export const CAPTION_LIMITS = {
  MAX_LENGTH: 2200,
  MAX_HASHTAGS: 30,
} as const;

// 이미지 비율 설정 (기본 4:5, 한 게시물 내 모든 장은 동일한 비율로 생성)
export const ASPECT_RATIOS = {
  '4:5': { width: 1080, height: 1350, label: '4:5 세로형 (1080×1350 · 인스타 추천)' },
  '1:1': { width: 1080, height: 1080, label: '1:1 정사각형 (1080×1080)' },
} as const;

export type AspectRatioKey = keyof typeof ASPECT_RATIOS;

// [기능 4] 무료 상업적 이용 가능 한국어 폰트 6종
export const KOREAN_FONTS = [
  {
    id: 'Pretendard',
    name: '프리텐다드 (Pretendard)',
    description: '가장 깔끔하고 읽기 편한 현대적인 고딕',
    cssFamily: "'Pretendard', sans-serif",
    file: 'Pretendard-Regular.woff',
    boldFile: 'Pretendard-Bold.woff',
    fallbackUrl: 'https://cdn.jsdelivr.net/gh/Project-Noonnu/noonfonts_2107@1.1/Pretendard-Regular.woff',
  },
  {
    id: 'Noto Serif KR',
    name: '본명조 (Noto Serif KR)',
    description: '차분하고 신뢰감을 주는 정통 명조체',
    cssFamily: "'Noto Serif KR', serif",
    file: 'NotoSerifKR-Regular.otf',
    boldFile: 'NotoSerifKR-Regular.otf',
    fallbackUrl: 'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Serif/OTF/Korean/NotoSerifCJKkr-Regular.otf',
  },
  {
    id: 'Black Han Sans',
    name: '검은고딕 (Black Han Sans)',
    description: '한눈에 시선을 사로잡는 굵고 강렬한 제목체',
    cssFamily: "'Black Han Sans', sans-serif",
    file: 'BlackHanSans-Regular.ttf',
    boldFile: 'BlackHanSans-Regular.ttf',
    fallbackUrl: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/blackhansans/BlackHanSans-Regular.ttf',
  },
  {
    id: 'Jua',
    name: '배달의민족 주아체 (Jua)',
    description: '동글동글하고 친근한 느낌의 귀여운 글씨',
    cssFamily: "'Jua', sans-serif",
    file: 'Jua-Regular.ttf',
    boldFile: 'Jua-Regular.ttf',
    fallbackUrl: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/jua/Jua-Regular.ttf',
  },
  {
    id: 'Gowun Batang',
    name: '고운바탕 (Gowun Batang)',
    description: '따뜻하고 감성적인 에세이 느낌의 바탕체',
    cssFamily: "'Gowun Batang', serif",
    file: 'GowunBatang-Regular.ttf',
    boldFile: 'GowunBatang-Regular.ttf',
    fallbackUrl: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/gowunbatang/GowunBatang-Regular.ttf',
  },
  {
    id: 'Nanum Pen Script',
    name: '나눔펜체 (Nanum Pen Script)',
    description: '직접 손으로 쓴 듯 자연스러운 손글씨체',
    cssFamily: "'Nanum Pen Script', cursive",
    file: 'NanumPenScript-Regular.ttf',
    boldFile: 'NanumPenScript-Regular.ttf',
    fallbackUrl: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumpenscript/NanumPenScript-Regular.ttf',
  },
] as const;

export type FontId = (typeof KOREAN_FONTS)[number]['id'];

// [기능 4] 분위기 프리셋 6종 (각각 배경색, 글자 크기, 여백, 사진 처리 방식이 다름)
export const MOOD_PRESETS = [
  {
    id: 'minimal',
    name: '1) 미니멀',
    description: '깨끗한 흰 배경과 얇은 글씨, 넓은 여백',
    bgColor: '#FFFFFF',
    cardBgColor: '#F8FAFC',
    textColor: '#111827',
    subTextColor: '#4B5563',
    defaultAccent: '#2563EB',
    titleSize: 54,
    bodySize: 30,
    padding: 84,
    borderRadius: 16,
    photoLayout: 'framed-top', // 상단 정돈된 프레임 + 하단 깔끔한 텍스트
    photoFilter: 'none',
  },
  {
    id: 'film',
    name: '2) 감성 필름',
    description: '따뜻한 크림색 배경과 필름 인화 사진 느낌',
    bgColor: '#F6F1E7',
    cardBgColor: '#EFE8D8',
    textColor: '#2C2520',
    subTextColor: '#5C5248',
    defaultAccent: '#B45309',
    titleSize: 50,
    bodySize: 28,
    padding: 92,
    borderRadius: 6,
    photoLayout: 'polaroid', // 폴라로이드 필름 여백 프레임
    photoFilter: 'warm',
  },
  {
    id: 'pastel',
    name: '3) 귀여운 파스텔',
    description: '둥근 모서리와 부드럽고 밝은 파스텔 카드',
    bgColor: '#FFF5F7',
    cardBgColor: '#FFFFFF',
    textColor: '#374151',
    subTextColor: '#6B7280',
    defaultAccent: '#EC4899',
    titleSize: 56,
    bodySize: 32,
    padding: 72,
    borderRadius: 42,
    photoLayout: 'rounded-card', // 둥근 액자형 카드 배치
    photoFilter: 'bright',
  },
  {
    id: 'poster',
    name: '4) 굵은 포스터',
    description: '아주 큰 글자와 강한 대비, 시선 집중 포스터형',
    bgColor: '#0F172A',
    cardBgColor: '#1E293B',
    textColor: '#FFFFFF',
    subTextColor: '#E2E8F0',
    defaultAccent: '#FACC15',
    titleSize: 72,
    bodySize: 34,
    padding: 68,
    borderRadius: 0,
    photoLayout: 'full-bleed', // 사진 전체 배경 + 강한 하단 다크 그라데이션
    photoFilter: 'contrast',
  },
  {
    id: 'cardnews',
    name: '5) 정보형 카드뉴스',
    description: '상단 핵심 뱃지 + 제목 구분선 + 요약 박스 구조',
    bgColor: '#F1F5F9',
    cardBgColor: '#FFFFFF',
    textColor: '#0F172A',
    subTextColor: '#334155',
    defaultAccent: '#0284C7',
    titleSize: 52,
    bodySize: 30,
    padding: 64,
    borderRadius: 24,
    photoLayout: 'split-box', // 상단 헤더 + 중단 사진 + 하단 요약 박스
    photoFilter: 'none',
  },
  {
    id: 'dark',
    name: '6) 다크 시크',
    description: '고급스러운 다크 배경과 세련된 포인트 컬러',
    bgColor: '#121214',
    cardBgColor: '#1C1C21',
    textColor: '#F4F4F6',
    subTextColor: '#A1A1AA',
    defaultAccent: '#A855F7',
    titleSize: 56,
    bodySize: 30,
    padding: 80,
    borderRadius: 20,
    photoLayout: 'dark-luxury', // 다크 프레임 + 은은한 글로우 포인트
    photoFilter: 'dim',
  },
] as const;

export type MoodId = (typeof MOOD_PRESETS)[number]['id'];

// [기능 5] 캡션 말투 옵션
export const CAPTION_TONES = [
  { id: 'friendly', name: '친근하게 (해요체 + 이모지)', description: '이웃에게 말하듯 다정하고 공감 가는 말투' },
  { id: 'professional', name: '전문적으로 (정중한 안내체)', description: '신뢰감을 주는 깔끔하고 정돈된 정보 전달 말투' },
  { id: 'short', name: '짧고 굵게 (임팩트 한 줄)', description: '핵심만 딱 짚어주는 간결하고 힙한 말투' },
] as const;

export type CaptionToneId = (typeof CAPTION_TONES)[number]['id'];
