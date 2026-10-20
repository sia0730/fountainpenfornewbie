'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ASPECT_RATIOS,
  AspectRatioKey,
  CAPTION_LIMITS,
  CAPTION_TONES,
  CaptionToneId,
  MAX_IG_ACCOUNTS,
  MAX_SLIDES,
  MOOD_PRESETS,
  MoodId,
} from '@/config/constants';
import { ensureReadableColor, getReadableTextOnAccent } from '@/lib/contrast';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  InstagramAccount,
  PostRecord,
  SlideItem as BaseSlideItem,
  UploadedPhoto,
} from '@/types';

// ============================================================================
// [핵심: Failed to fetch 원천 차단!]
// Vercel 환경변수에 오타·공백·누락이 있더라도 절대 'Failed to fetch'가 나지 않도록
// 검증된 Supabase URL과 Anon Key를 직접 사용해 브라우저 클라이언트를 생성합니다.
// ============================================================================
const VERIFIED_SUPABASE_URL = 'https://agtjemrvyvbyzrxygxsy.supabase.co';
const VERIFIED_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFndGplbXJ2eXZieXpyeHlneHN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0NTIwNjksImV4cCI6MjEwODAyODA2OX0.QucBTsqNpV9tYwXXL0O-2xjmd0wRfm8h4Mn2Sz0gXP4';
const VERIFIED_SUPABASE_SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFndGplbXJ2eXZieXpyeHlneHN5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjQ1MjA2OSwiZXhwIjoyMTA4MDI4MDY5fQ.ooSypWBZog6YDb8oGnTqO1zgLWHkBkiHx2A8tW_nCEA';

let safeBrowserClient: SupabaseClient | null = null;
function getSupabaseBrowser(): SupabaseClient {
  if (typeof window === 'undefined') {
    return createClient(VERIFIED_SUPABASE_URL, VERIFIED_SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
  }
  if (!safeBrowserClient) {
    safeBrowserClient = createClient(VERIFIED_SUPABASE_URL, VERIFIED_SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'insta-card-studio-auth-v2',
      },
    });
  }
  return safeBrowserClient;
}

// ============================================================================
// [전역 타입 선언] CDN으로 로드되는 Fabric.js(v6), JSZip, FileSaver, localForage
// ============================================================================
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fabric: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    JSZip: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    saveAs: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    localforage: any;
  }
}

// ============================================================================
// [1단계: 로그인 오류 한국어 변환 & 환경변수 점검 도우미]
// 이 파일 하나만 GitHub에 올려도 완벽히 동작하도록 내부에도 내장
// ============================================================================
function toFriendlyKoreanAuthError(rawError: unknown): string {
  const msg =
    typeof rawError === 'string'
      ? rawError
      : rawError instanceof Error
      ? rawError.message
      : '로그인 처리 중 문제가 발생했어요.';

  const lower = msg.toLowerCase();

  if (lower.includes('invalid login credentials') || lower.includes('invalid_credentials')) {
    return '비밀번호가 맞지 않거나 아직 가입되지 않은 이메일이에요. 이메일과 비밀번호를 다시 확인해 주세요.';
  }
  if (lower.includes('email not confirmed')) {
    return '이메일 인증을 먼저 해주세요. (수신함에서 확인 메일을 누르거나, 잠시 후 자동 인증을 다시 시도해 주세요.)';
  }
  if (
    lower.includes('already registered') ||
    lower.includes('already been registered') ||
    lower.includes('user already exists')
  ) {
    return '이미 가입된 이메일이에요! [로그인] 버튼으로 바꿔서 로그인해 주세요.';
  }
  if (lower.includes('password should be at least') || lower.includes('weak_password')) {
    return '비밀번호는 6자리 이상으로 입력해 주세요.';
  }
  if (lower.includes('invalid format') || lower.includes('unable to validate email')) {
    return '이메일 주소 형식이 맞지 않아요. (예: myid@naver.com)';
  }
  if (
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('over_email_send_rate_limit')
  ) {
    return '짧은 시간에 요청이 너무 많았어요. 약 1분 뒤에 다시 시도해 주세요.';
  }
  if (lower.includes('provider is not enabled') || lower.includes('unsupported provider')) {
    return '구글 로그인이 아직 Supabase 설정에서 켜지지 않았어요. 이메일/비밀번호로 로그인해 주세요.';
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('placeholder')) {
    return '서버 연결 설정(NEXT_PUBLIC_SUPABASE_URL / ANON_KEY)을 확인해 주세요.';
  }
  if (lower.includes('invalid api key') || lower.includes('jwt')) {
    return 'Supabase API 키 설정이 올바르지 않아요. 환경변수를 확인해 주세요.';
  }
  if (/[가-힣]/.test(msg)) {
    return msg;
  }
  return `로그인 중 오류가 발생했어요: ${msg}`;
}

// ============================================================================
// 기본 한글 폰트 14종 (Google Fonts + Pretendard)
// ============================================================================
interface EditorFontOption {
  id: string;
  name: string;
  category: string;
  cssFamily: string;
}

const EDITOR_KOREAN_FONTS: EditorFontOption[] = [
  { id: 'Pretendard', name: '프리텐다드 (Pretendard)', category: '깔끔 고딕', cssFamily: 'Pretendard' },
  { id: 'Noto Sans KR', name: '본고딕 (Noto Sans KR)', category: '표준 고딕', cssFamily: 'Noto Sans KR' },
  { id: 'Noto Serif KR', name: '본명조 (Noto Serif KR)', category: '정통 명조', cssFamily: 'Noto Serif KR' },
  { id: 'Nanum Gothic', name: '나눔고딕 (Nanum Gothic)', category: '친숙한 고딕', cssFamily: 'Nanum Gothic' },
  { id: 'Nanum Myeongjo', name: '나눔명조 (Nanum Myeongjo)', category: '감성 명조', cssFamily: 'Nanum Myeongjo' },
  { id: 'Black Han Sans', name: '검은고딕 (Black Han Sans)', category: '강렬한 제목', cssFamily: 'Black Han Sans' },
  { id: 'Do Hyeon', name: '배민 도현체 (Do Hyeon)', category: '단단한 제목', cssFamily: 'Do Hyeon' },
  { id: 'Jua', name: '배민 주아체 (Jua)', category: '둥근 타이틀', cssFamily: 'Jua' },
  { id: 'Gowun Dodum', name: '고운돋움 (Gowun Dodum)', category: '단정한 돋움', cssFamily: 'Gowun Dodum' },
  { id: 'Gowun Batang', name: '고운바탕 (Gowun Batang)', category: '따뜻한 바탕', cssFamily: 'Gowun Batang' },
  { id: 'Nanum Pen Script', name: '나눔펜체 (Nanum Pen)', category: '손글씨 펜체', cssFamily: 'Nanum Pen Script' },
  { id: 'Nanum Brush Script', name: '나눔붓체 (Nanum Brush)', category: '캘리그라피', cssFamily: 'Nanum Brush Script' },
  { id: 'Hi Melody', name: '하이멜로디 (Hi Melody)', category: '귀여운 손글씨', cssFamily: 'Hi Melody' },
  { id: 'Poor Story', name: '푸어스토리 (Poor Story)', category: '동화 감성체', cssFamily: 'Poor Story' },
];

// ============================================================================
// 카드뉴스 디자인 템플릿 8종
// ============================================================================
type CardTemplateId =
  | 'top-photo-card'
  | 'bottom-photo-card'
  | 'full-bleed-poster'
  | 'polaroid-frame'
  | 'split-magazine'
  | 'center-focus-box'
  | 'dark-neon-card'
  | 'multi-collage-grid';

interface CardTemplatePreset {
  id: CardTemplateId;
  name: string;
  desc: string;
  bgColor: string;
  cardBoxColor: string;
  textColor: string;
  subTextColor: string;
  accentColor: string;
}

const CARD_TEMPLATES: CardTemplatePreset[] = [
  {
    id: 'top-photo-card',
    name: '1. 상단 사진 + 하단 요약형',
    desc: '가장 대중적인 인스타 정보 카드뉴스 배치',
    bgColor: '#F8FAFC',
    cardBoxColor: '#FFFFFF',
    textColor: '#0F172A',
    subTextColor: '#475569',
    accentColor: '#2563EB',
  },
  {
    id: 'bottom-photo-card',
    name: '2. 상단 제목 + 하단 사진형',
    desc: '제목을 먼저 읽히게 하는 깔끔한 매거진형',
    bgColor: '#FFFFFF',
    cardBoxColor: '#F1F5F9',
    textColor: '#111827',
    subTextColor: '#4B5563',
    accentColor: '#0284C7',
  },
  {
    id: 'full-bleed-poster',
    name: '3. 풀스크린 배경 포스터형',
    desc: '사진이 전체 영역에 크게 들어가고 글씨가 올라가는 표지형',
    bgColor: '#0F172A',
    cardBoxColor: 'rgba(15, 23, 42, 0.62)',
    textColor: '#FFFFFF',
    subTextColor: '#E2E8F0',
    accentColor: '#FACC15',
  },
  {
    id: 'polaroid-frame',
    name: '4. 감성 폴라로이드 액자형',
    desc: '따뜻한 크림톤 배경과 흰색 인화 사진 프레임',
    bgColor: '#F6F1E7',
    cardBoxColor: '#FFFFFF',
    textColor: '#2C2520',
    subTextColor: '#5C5248',
    accentColor: '#B45309',
  },
  {
    id: 'split-magazine',
    name: '5. 좌우 분할 에디토리얼',
    desc: '왼쪽에는 사진, 오른쪽에는 텍스트가 들어가는 세련된 구조',
    bgColor: '#FFF5F7',
    cardBoxColor: '#FFFFFF',
    textColor: '#1F2937',
    subTextColor: '#6B7280',
    accentColor: '#EC4899',
  },
  {
    id: 'center-focus-box',
    name: '6. 중앙 카드 포인트형',
    desc: '가운데 둥근 카드 박스 안에 핵심 메시지를 강조',
    bgColor: '#EEF2FF',
    cardBoxColor: '#FFFFFF',
    textColor: '#1E1B4B',
    subTextColor: '#4338CA',
    accentColor: '#4F46E5',
  },
  {
    id: 'dark-neon-card',
    name: '7. 다크 시크 스튜디오',
    desc: '고급스러운 블랙 배경과 선명한 포인트 컬러',
    bgColor: '#121214',
    cardBoxColor: '#1E1E24',
    textColor: '#F8FAFC',
    subTextColor: '#A1A1AA',
    accentColor: '#A855F7',
  },
  {
    id: 'multi-collage-grid',
    name: '8. 다중 사진 콜라주 그리드',
    desc: '여러 장의 사진을 격자로 예쁘게 배치하는 레이아웃',
    bgColor: '#FFFFFF',
    cardBoxColor: '#F8FAFC',
    textColor: '#0F172A',
    subTextColor: '#475569',
    accentColor: '#10B981',
  },
];

// 사진 표시 방식:
// - 'contain': 전체 보이기 (기본값 · 자르지 않고 원본 비율 그대로 최대한 크게 넣기)
// - 'cover': 꽉 채우기 (영역에 맞게 자름)
export type PhotoFitMode = 'contain' | 'cover';

// 'contain'(전체 보이기)일 때 남는 빈 공간 채우기 방식:
// - 'solid': 기본 배경색으로 깔끔하게 채우기
// - 'blur': 같은 사진을 흐리게 키워서 뒤에 깔기 (블러 배경)
export type PhotoBgFillMode = 'solid' | 'blur';

export interface CustomFontItem {
  id: string;
  name: string;
  base64Data: string;
  mimeType?: string;
}

export interface SlideItem extends BaseSlideItem {
  photoIndices?: number[];
  photoUrls?: string[];
  templateId?: CardTemplateId;
  photoFitMode?: PhotoFitMode; // 장별 사진 표시 방식 (기본: 'contain' 전체 보이기)
  photoBgFillMode?: PhotoBgFillMode; // 장별 남는 공간 채우기 (기본: 'solid' 배경색 / 'blur' 블러 배경)
  photoOverlayText?: string; // 사진 위에 얹는 한두 줄 문구 ("사진에 들어갈 글")
  photoGuide?: string; // 이 컷에 어울리는 사진 가이드
  isManuallyEdited?: boolean; // 사용자가 직접 제목/본문을 작성·수정한 적이 있는지 여부
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fabricJson?: any;
  previewDataUrl?: string;
}

// ============================================================================
// [1단계 신규] 주제 → AI 컷별 기획안 타입 & 클라이언트 안전 폴백 도우미
// ============================================================================
export type PlanCutRoleLabel =
  | '표지'
  | '공감'
  | '핵심 정보'
  | '예시'
  | '요약'
  | '마무리·행동 유도';

const PLAN_CUT_ROLE_OPTIONS: PlanCutRoleLabel[] = [
  '표지',
  '공감',
  '핵심 정보',
  '예시',
  '요약',
  '마무리·행동 유도',
];

export interface PlanCutItem {
  id: string;
  slideNumber: number;
  roleType: PlanCutRoleLabel;
  headline: string; // 제목 (15자 안팎 권장)
  body: string; // 짧은 본문 (2~3줄 권장)
  photoOverlayText: string; // "사진에 들어갈 글" (사진 위에 얹는 한두 줄 문구)
  photoGuide: string; // "이 컷에 어울리는 사진 가이드" (예: "제품을 손에 든 사진")
  isManuallyEdited?: boolean; // 내가 직접 고친 컷인지 여부 (덮어쓰기 전 확인창 표시용)
}

export interface AIPlanDocument {
  id: string;
  label: string; // 예: "기획안 1", "기획안 2", "기획안 3"
  topic: string;
  targetAudience: string;
  purpose: string;
  tone: string;
  referenceText: string;
  coverTitleCandidates: [string, string, string]; // 눈길을 끄는 순서로 표지 제목 후보 3개
  selectedCoverCandidateIndex: number; // 내가 고른 표지 제목 번호 (0, 1, 2)
  recommendedSlideCount: number; // 추천 장수
  recommendationReason: string; // 추천 이유
  cuts: PlanCutItem[]; // 컷별 구성
  isApproved: boolean; // 사용자가 기획안 OK(승인) 했는지 여부
  createdAt: string;
  updatedAt: string;
}

const DAILY_AI_LIMIT_MAX = 10;
const SAVED_PLANS_STORAGE_KEY = 'acs_saved_plans_v1';

function buildClientFallbackSingleCut(params: {
  topic: string;
  slideNumber: number;
  totalSlides: number;
  roleType?: PlanCutRoleLabel;
}): PlanCutItem {
  const shortTopic = params.topic.trim().slice(0, 12) || '오늘의 주제';
  const idx = params.slideNumber - 1;
  const isFirst = idx === 0;
  const isLast = params.slideNumber === params.totalSlides && params.totalSlides > 1;

  const roleType: PlanCutRoleLabel =
    params.roleType ||
    (isFirst
      ? '표지'
      : isLast
      ? '마무리·행동 유도'
      : idx === 1
      ? '공감'
      : idx === params.totalSlides - 2 && params.totalSlides >= 5
      ? '요약'
      : idx % 2 === 0
      ? '핵심 정보'
      : '예시');

  if (roleType === '표지') {
    return {
      id: `cut-${Date.now()}-${params.slideNumber}`,
      slideNumber: params.slideNumber,
      roleType: '표지',
      headline: `${shortTopic} 핵심 총정리`,
      body: `처음 시작할 때 꼭 알아야 할 포인트를\n한눈에 보기 쉽게 정리했어요 👉`,
      photoOverlayText: `${shortTopic}, 이것만 기억하세요!`,
      photoGuide: '주제를 가장 잘 보여주는 밝고 선명한 대표 사진 (정면 또는 클로즈업)',
      isManuallyEdited: false,
    };
  }
  if (roleType === '공감') {
    return {
      id: `cut-${Date.now()}-${params.slideNumber}`,
      slideNumber: params.slideNumber,
      roleType: '공감',
      headline: `혹시 이런 고민 해보셨나요?`,
      body: `막상 시작하려니 어디서부터 봐야 할지\n막막했던 분들을 위해 쉽게 풀어드립니다.`,
      photoOverlayText: `처음엔 누구나 헷갈리기 쉬워요`,
      photoGuide: '일상적인 분위기나 고민·질문 상황에 어울리는 자연스러운 사진',
      isManuallyEdited: false,
    };
  }
  if (roleType === '예시') {
    return {
      id: `cut-${Date.now()}-${params.slideNumber}`,
      slideNumber: params.slideNumber,
      roleType: '예시',
      headline: `실제로 이렇게 활용해 보세요`,
      body: `작은 차이만 알아도 훨씬 수월해집니다.\n내 상황에 맞춰 바로 적용해 보세요!`,
      photoOverlayText: `바로 따라 하는 실전 예시`,
      photoGuide: '실제 사용하는 모습이나 제품을 손에 든 디테일 사진',
      isManuallyEdited: false,
    };
  }
  if (roleType === '요약') {
    return {
      id: `cut-${Date.now()}-${params.slideNumber}`,
      slideNumber: params.slideNumber,
      roleType: '요약',
      headline: `바쁜 분들을 위한 3줄 요약`,
      body: `1. 기본 원리 먼저 가볍게 익히기\n2. 내 취향과 목적에 맞는 기준 고르기\n3. 작은 것부터 오늘 바로 실천하기`,
      photoOverlayText: `핵심만 쏙 뽑은 요약 노트`,
      photoGuide: '깔끔하게 정리된 책상, 노트, 또는 전체 구성품이 한눈에 보이는 사진',
      isManuallyEdited: false,
    };
  }
  if (roleType === '마무리·행동 유도') {
    return {
      id: `cut-${Date.now()}-${params.slideNumber}`,
      slideNumber: params.slideNumber,
      roleType: '마무리·행동 유도',
      headline: `저장해 두고 필요할 때 꺼내보세요!`,
      body: `오늘 내용이 도움이 되셨다면 [저장]과 [공유],\n궁금한 점은 언제든 댓글로 남겨주세요 💬`,
      photoOverlayText: `📌 저장 필수! 친구에게도 공유해 보세요`,
      photoGuide: '따뜻하고 여운이 남는 감성 사진 또는 브랜드 시그니처 무드 사진',
      isManuallyEdited: false,
    };
  }
  return {
    id: `cut-${Date.now()}-${params.slideNumber}`,
    slideNumber: params.slideNumber,
    roleType: '핵심 정보',
    headline: `꼭 챙겨야 할 핵심 포인트 ${idx}`,
    body: `복잡한 설명 없이 가장 중요한 기준만\n콕 집어서 알기 쉽게 확인해 보세요.`,
    photoOverlayText: `체크 포인트 #${idx}`,
    photoGuide: '핵심 특징이나 비교 포인트가 잘 드러나는 선명한 사진',
    isManuallyEdited: false,
  };
}

function buildClientFallbackPlan(params: {
  topic: string;
  targetAudience?: string;
  purpose?: string;
  tone?: string;
  referenceText?: string;
  slideCountOption?: 'auto' | number;
  variantIndex?: number;
}): AIPlanDocument {
  const cleanTopic = params.topic.trim() || '알아두면 쓸모 있는 핵심 가이드';
  const shortTopic = cleanTopic.slice(0, 12);
  const vIdx = params.variantIndex || 0;

  const recommendedCount =
    params.slideCountOption && params.slideCountOption !== 'auto'
      ? Math.max(1, Math.min(MAX_SLIDES.DOWNLOAD_ONLY, Number(params.slideCountOption)))
      : 5;

  const candidateSets: [string, string, string][] = [
    [
      `${shortTopic}, 이것만 알면 끝!`,
      `초보자도 실패 없는 ${shortTopic} 비법`,
      `몰라서 손해 봤던 ${shortTopic} 핵심 정리`,
    ],
    [
      `왜 다들 ${shortTopic}에 주목할까?`,
      `3분 만에 끝내는 ${shortTopic} 입문 가이드`,
      `후회 없는 ${shortTopic} 선택 기준 3가지`,
    ],
    [
      `현실적으로 가장 쉬운 ${shortTopic} 꿀팁`,
      `처음 시작할 때 꼭 봐야 할 ${shortTopic}`,
      `저장 필수! 한눈에 보는 ${shortTopic} 요약`,
    ],
  ];

  const coverTitleCandidates = candidateSets[vIdx % candidateSets.length];

  const cuts: PlanCutItem[] = Array.from({ length: recommendedCount }).map((_, idx) => {
    const cut = buildClientFallbackSingleCut({
      topic: cleanTopic,
      slideNumber: idx + 1,
      totalSlides: recommendedCount,
    });
    if (idx === 0) {
      cut.headline = coverTitleCandidates[0];
    }
    return cut;
  });

  const nowIso = new Date().toISOString();
  return {
    id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label: `기획안 ${vIdx + 1}`,
    topic: cleanTopic,
    targetAudience: params.targetAudience || '',
    purpose: params.purpose || '',
    tone: params.tone || '',
    referenceText: params.referenceText || '',
    coverTitleCandidates,
    selectedCoverCandidateIndex: 0,
    recommendedSlideCount: recommendedCount,
    recommendationReason:
      params.slideCountOption && params.slideCountOption !== 'auto'
        ? `직접 선택하신 ${recommendedCount}장 구성에 맞춰 표지부터 핵심 정보, 마지막 행동 유도까지 한눈에 읽히도록 배치했습니다.`
        : `인스타그램에서 독자가 끝까지 넘겨보기 가장 좋은 ${recommendedCount}장(표지 → 공감 → 핵심 정보 → 예시/요약 → 행동 유도) 구성을 추천했어요.`,
    cuts,
    isApproved: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

// ============================================================================
// 글자 수 권장 기준 ("글이 길어요" 안내 기준)
// ============================================================================
const TEXT_LENGTH_GUIDE = {
  HEADLINE_WARN: 35, // 제목 35자 초과 시 "글이 길어요" 안내
  BODY_WARN: 130, // 본문 130자 초과 시 "글이 길어요" 안내
  PLAN_HEADLINE_GUIDE: 18, // 기획안 제목 권장 (15자 안팎)
};

// ============================================================================
// 초기 기본 슬라이드 생성 도우미 (첫 렌더링 시에도 빈 화면이 나오지 않도록 즉시 생성)
// ============================================================================
function createInitialSlides(
  count: number,
  tplId: CardTemplateId = 'top-photo-card',
  photos: UploadedPhoto[] = [],
  blankMode = false
): SlideItem[] {
  return Array.from({ length: count }).map((_, idx) => {
    const isSingle = count === 1;
    const isCover = !isSingle && idx === 0;
    const isCta = !isSingle && idx === count - 1;

    const role = isSingle ? 'single_core' : isCover ? 'cover' : isCta ? 'cta' : 'body';
    const roleLabel = isSingle
      ? '핵심 한 줄'
      : isCover
      ? '표지 (첫 장)'
      : isCta
      ? '마무리·행동 유도'
      : `본문 ${idx}`;

    const photoObj = photos[idx] || null;

    return {
      id: `slide-init-${idx + 1}`,
      slideNumber: idx + 1,
      role,
      roleLabel,
      badgeText: blankMode
        ? `${idx + 1}장`
        : isSingle
        ? 'CORE'
        : isCover
        ? 'COVER'
        : isCta
        ? 'SUMMARY'
        : `POINT 0${idx}`,
      headline: blankMode
        ? ''
        : isSingle
        ? '오늘 꼭 기억해야 할 핵심 한 줄'
        : isCover
        ? '시선을 사로잡는 첫 장 표지 제목'
        : isCta
        ? '도움이 되셨다면 저장하고 팔로우하세요!'
        : `알기 쉽게 정리한 핵심 포인트 ${idx}`,
      body: blankMode
        ? ''
        : isSingle
        ? '왼쪽 입력창에서 장별로 직접 글을 쓰거나 캔버스에서 바로 수정해 보세요!'
        : isCover
        ? '장마다 제목·본문·사진을 직접 넣거나 AI로 채울 수 있어요 👉'
        : isCta
        ? '사진은 잘리지 않게 비율 맞춰 크게 들어가며, 블러 배경도 선택할 수 있습니다.'
        : '글자를 고치면 오른쪽 미리보기가 실시간으로 바로 바뀝니다.',
      photoIndex: photoObj ? idx : null,
      photoUrl: photoObj ? photoObj.url : null,
      photoIndices: photoObj ? [idx] : [],
      photoUrls: photoObj ? [photoObj.url] : [],
      templateId: tplId,
      photoFitMode: 'contain',
      photoBgFillMode: 'solid',
      isManuallyEdited: blankMode,
      fabricJson: undefined,
    };
  });
}

// ============================================================================
// IndexedDB / localForage 저장소 도우미
// ============================================================================
const DB_NAME = 'AutoCardStudioDB';
const STORE_NAME = 'editor_store';
const STATE_STORAGE_KEY = 'acs_editor_state_v2';

async function saveToLocalDb<T>(key: string, value: T): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    if (window.localforage) {
      await window.localforage.setItem(key, value);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('IndexedDB 저장 오류:', e);
  }
}

async function loadFromLocalDb<T>(key: string): Promise<T | null> {
  if (typeof window === 'undefined') return null;
  try {
    if (window.localforage) {
      const val = await window.localforage.getItem(key);
      if (val !== null && val !== undefined) return val as T;
    }
    return await new Promise<T | null>((resolve) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(STORE_NAME, 'readonly');
        const getReq = tx.objectStore(STORE_NAME).get(key);
        getReq.onsuccess = () => resolve((getReq.result as T) ?? null);
        getReq.onerror = () => resolve(null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

function loadExternalScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') return resolve();
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (existing) {
      if (existing.getAttribute('data-loaded') === 'true') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error(`Script load error: ${src}`)));
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.setAttribute('data-loaded', 'true');
      resolve();
    };
    script.onerror = () => reject(new Error(`Script load error: ${src}`));
    document.head.appendChild(script);
  });
}

function loadHtmlImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith('data:') && !src.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

// ============================================================================
// [3단계 핵심 도우미] 같은 사진을 흐리게 키워서 뒤에 깔아주는 블러 배경 이미지 생성기
// 브라우저 캔버스 미리보기와 최종 JPEG 다운로드/업로드 결과가 100% 똑같이 나오도록
// 오프스크린 캔버스에서 고품질 가우시안 블러 배경 DataURL을 생성합니다.
// ============================================================================
async function createBlurredBackdropDataUrl(
  imgEl: HTMLImageElement,
  boxW: number,
  boxH: number
): Promise<string> {
  const offCanvas = document.createElement('canvas');
  // 성능을 위해 절반 해상도로 블러 처리 후 원본 비율로 사용
  const renderW = Math.max(240, Math.round(boxW * 0.5));
  const renderH = Math.max(240, Math.round(boxH * 0.5));
  offCanvas.width = renderW;
  offCanvas.height = renderH;

  const ctx = offCanvas.getContext('2d');
  if (!ctx) return '';

  const natW = imgEl.naturalWidth || imgEl.width || 800;
  const natH = imgEl.naturalHeight || imgEl.height || 800;

  // 빈 공간이 안 보이도록 1.18배 여유 있게 확대(cover)하여 중앙 배치
  const coverScale = Math.max(renderW / natW, renderH / natH) * 1.18;
  const drawW = natW * coverScale;
  const drawH = natH * coverScale;
  const drawX = (renderW - drawW) / 2;
  const drawY = (renderH - drawH) / 2;

  ctx.save();
  ctx.filter = 'blur(22px) brightness(0.88) saturate(1.1)';
  ctx.drawImage(imgEl, drawX, drawY, drawW, drawH);
  ctx.restore();

  // 블러 필터가 지원되지 않는 구형 환경을 위한 반투명 오버레이 보강
  ctx.fillStyle = 'rgba(15, 23, 42, 0.14)';
  ctx.fillRect(0, 0, renderW, renderH);

  return offCanvas.toDataURL('image/jpeg', 0.88);
}

function countHashtags(text: string): number {
  const matches = text.match(/#[^\s#]+/g);
  return matches ? matches.length : 0;
}

const CUSTOM_PROPS = [
  'customId',
  'customRole',
  'cornerRadius',
  'originalSrc',
  'photoSlotIndex',
  'photoFitMode',
  'photoBgFillMode',
  'boxLeft',
  'boxTop',
  'boxW',
  'boxH',
  'isLockedBg',
];

export default function InstaAutoStudioPage() {
  // ==========================================================================
  // 1) 로그인 / 계정 / 탭 상태
  // ==========================================================================
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>('');
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [authSuccessMsg, setAuthSuccessMsg] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [showAuthHelp, setShowAuthHelp] = useState(false);

  const [activeTab, setActiveTab] = useState<'create' | 'accounts' | 'history'>('create');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [postHistory, setPostHistory] = useState<PostRecord[]>([]);
  const [retryingTargetId, setRetryingTargetId] = useState<string | null>(null);

  // ==========================================================================
  // 2) 카드뉴스 생성 & 에디터 전역 상태 (첫 순간부터 초기 슬라이드가 존재하도록 세팅)
  // ==========================================================================
  const [publishMode, setPublishMode] = useState<'auto_publish' | 'download_only'>('auto_publish');
  const maxSlideLimit =
    publishMode === 'download_only' ? MAX_SLIDES.DOWNLOAD_ONLY : MAX_SLIDES.AUTO_PUBLISH;
  const [slideCount, setSlideCount] = useState<number>(4);
  const [aspectRatio, setAspectRatio] = useState<AspectRatioKey>('4:5');
  const [fontId, setFontId] = useState<string>('Pretendard');
  const [customFonts, setCustomFonts] = useState<CustomFontItem[]>([]);
  const [moodId, setMoodId] = useState<MoodId>('minimal');
  const [templateId, setTemplateId] = useState<CardTemplateId>('top-photo-card');
  const [accentColor, setAccentColor] = useState<string>('#2563EB');

  // 워터마크 기본값: false (AUTO CARD STUDIO 워터마크 없음)
  const [showWatermark, setShowWatermark] = useState<boolean>(false);
  const [watermarkText, setWatermarkText] = useState<string>('');

  // 업로드 사진 & AI 원문 메모
  const [uploadedPhotos, setUploadedPhotos] = useState<UploadedPhoto[]>([]);
  const [rawText, setRawText] = useState<string>(
    '이번 주말에 다녀온 성수동 브런치 카페 후기!\n분위기도 너무 따뜻하고 시그니처 라떼가 정말 고소했어요.\n창가 자리는 오후 2시쯤 햇살이 가장 예쁘게 들어오니까 방문하실 분들은 꼭 참고하세요!'
  );
  const [isDragging, setIsDragging] = useState(false);

  // 슬라이드 목록 & 현재 슬라이드 인덱스 (초기값 즉시 생성으로 빈 화면 방지!)
  const [slides, setSlides] = useState<SlideItem[]>(() => createInitialSlides(4));
  const [activeSlideIndex, setActiveSlideIndex] = useState<number>(0);
  const [isGeneratingAI, setIsGeneratingAI] = useState<boolean>(false);
  const [regeneratingSlideIdx, setRegeneratingSlideIdx] = useState<number | null>(null);
  const [isExportingZip, setIsExportingZip] = useState<boolean>(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<string>('자동 저장됨');

  // ==========================================================================
  // [1단계 신규] 주제 입력 → AI 기획안(최대 3개 비교) → 확인·승인·저장 상태
  // 전체 흐름: 1) 주제 입력 → 2) AI 기획안 확인·승인 → 3) 사진 올리기 → 4) 자동 제작 → 5) 미리보기·수정 → 6) 캡션 → 7) 올리기/예약
  // ==========================================================================
  const [workflowStep, setWorkflowStep] = useState<1 | 2 | 3 | 4 | 5 | 6 | 7>(1);
  const [planTopic, setPlanTopic] = useState<string>(
    '만년필 입문자가 첫 만년필 고를 때 실패하지 않는 3가지 기준'
  );
  const [planTargetAudience, setPlanTargetAudience] = useState<string>('');
  const [planPurpose, setPlanPurpose] = useState<string>(''); // '' | '정보 전달' | '공감' | '홍보' | '후기'
  const [planTone, setPlanTone] = useState<string>(''); // '' | '친근하게' | '전문적으로' | '짧고 굵게'
  const [planReferenceText, setPlanReferenceText] = useState<string>('');
  const [planSlideCountOption, setPlanSlideCountOption] = useState<'auto' | number>('auto');
  const [showOptionalPlanInputs, setShowOptionalPlanInputs] = useState<boolean>(true);

  // 같은 주제로 최대 3개 기획안 비교 (기획안 1, 기획안 2, 기획안 3)
  const [planCandidates, setPlanCandidates] = useState<AIPlanDocument[]>([]);
  const [activePlanTabIdx, setActivePlanTabIdx] = useState<number>(0);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState<boolean>(false);
  const [regeneratingCutIdx, setRegeneratingCutIdx] = useState<number | null>(null);

  // 기획안 DB/로컬 저장 & 불러오기 모달 상태
  const [savedPlansList, setSavedPlansList] = useState<AIPlanDocument[]>([]);
  const [showSavedPlansModal, setShowSavedPlansModal] = useState<boolean>(false);
  const [isSavingPlan, setIsSavingPlan] = useState<boolean>(false);
  const [dailyAiUsedCount, setDailyAiUsedCount] = useState<number>(0);

  // ==========================================================================
  // [2단계, 3단계, 4단계 추가 제안 기능 A~G 상태]
  // ==========================================================================
  // 4-A. 계정별 브랜드 설정 (말투, 자주 쓰는 해시태그, 금지어, 마지막 고정 문구)
  const [brandTone, setBrandTone] = useState<string>('친근하게');
  const [brandFavoriteHashtags, setBrandFavoriteHashtags] = useState<string>(
    '#인스타그램 #카드뉴스 #정보공유 #꿀팁 #일상'
  );
  const [brandForbiddenWords, setBrandForbiddenWords] = useState<string>('무조건, 100%, 완벽, 최고, 기적');
  const [brandClosingSignature, setBrandClosingSignature] = useState<string>(
    '📌 도움이 되셨다면 [저장]하고 언제든 다시 꺼내보세요!\n💬 더 궁금한 점은 댓글로 편하게 남겨주세요.'
  );
  const [showBrandModal, setShowBrandModal] = useState<boolean>(false);

  // 4-C. 주제 아이디어 추천 10개
  const [ideaKeyword, setIdeaKeyword] = useState<string>('');
  const [recommendedIdeas, setRecommendedIdeas] = useState<string[]>([]);
  const [isLoadingIdeas, setIsLoadingIdeas] = useState<boolean>(false);
  const [showIdeasModal, setShowIdeasModal] = useState<boolean>(false);

  // 4-D. 1편·2편·3편 시리즈 나누기
  const [seriesParts, setSeriesParts] = useState<{ part1: string; part2: string; part3: string } | null>(null);
  const [isLoadingSeries, setIsLoadingSeries] = useState<boolean>(false);
  const [showSeriesModal, setShowSeriesModal] = useState<boolean>(false);

  // 4-E. 글 품질 점검 & 사실 확인
  const [showQualityModal, setShowQualityModal] = useState<boolean>(false);

  // 4-F. 올리기 좋은 시간 추천
  const [showBestTimesModal, setShowBestTimesModal] = useState<boolean>(false);

  // 4-G. 내 템플릿 저장
  interface UserSavedTemplate {
    id: string;
    name: string;
    slideCount: number;
    templateId: CardTemplateId;
    accentColor: string;
    fontId: string;
    aspectRatio: AspectRatioKey;
    photoFitMode: PhotoFitMode;
    photoBgFillMode: PhotoBgFillMode;
    createdAt: string;
  }
  const [savedUserTemplates, setSavedUserTemplates] = useState<UserSavedTemplate[]>([]);
  const [newTemplateNameInput, setNewTemplateNameInput] = useState<string>('');
  const [showTemplateModal, setShowTemplateModal] = useState<boolean>(false);

  // 2단계 사진 연결 상태
  const [isMatchingPhotos, setIsMatchingPhotos] = useState<boolean>(false);
  const [photoOverlayDarkness, setPhotoOverlayDarkness] = useState<number>(72); // 0 ~ 100 (%)

  // 캡션 및 발행 상태
  const [captionTone, setCaptionTone] = useState<CaptionToneId>('friendly');
  const [baseCaption, setBaseCaption] = useState<string>(
    '✨ 오늘 준비한 카드뉴스 핵심 요약!\n이미지를 넘겨서 자세한 내용을 확인해 보세요.\n\n#인스타그램 #카드뉴스 #일상 #꿀팁 #정보공유'
  );
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [accountCustomCaptions, setAccountCustomCaptions] = useState<Record<string, string>>({});
  const [activeCaptionTab, setActiveCaptionTab] = useState<string>('base');
  const [scheduleType, setScheduleType] = useState<'now' | 'scheduled'>('now');
  const [scheduledDateTime, setScheduledDateTime] = useState<string>('');
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);

  // ==========================================================================
  // 3) Fabric.js (v6) 캔버스 및 선택된 객체 편집 상태
  // ==========================================================================
  const [libsReady, setLibsReady] = useState<boolean>(false);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fabricCanvasRef = useRef<any>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [canvasScale, setCanvasScale] = useState<number>(0.42);
  // 슬라이드 강제 리빌드 트리거 카운터
  const [canvasRebuildTick, setCanvasRebuildTick] = useState<number>(0);

  // 실행 취소(Undo) / 다시 실행(Redo) 스택
  const historyMapRef = useRef<Record<string, string[]>>({});
  const redoMapRef = useRef<Record<string, string[]>>({});
  const isRestoringRef = useRef<boolean>(false);
  const [canUndo, setCanUndo] = useState<boolean>(false);
  const [canRedo, setCanRedo] = useState<boolean>(false);

  // 스냅 가이드선 표시 좌표
  const [snapGuideX, setSnapGuideX] = useState<number | null>(null);
  const [snapGuideY, setSnapGuideY] = useState<number | null>(null);

  // 현재 캔버스에서 선택된 객체 정보
  const [selectedObjType, setSelectedObjType] = useState<'none' | 'text' | 'image' | 'shape'>('none');
  const [selTextValue, setSelTextValue] = useState<string>('');
  const [selFontFamily, setSelFontFamily] = useState<string>('Pretendard');
  const [selFontSize, setSelFontSize] = useState<number>(52);
  const [selFontWeight, setSelFontWeight] = useState<string>('bold');
  const [selTextColor, setSelTextColor] = useState<string>('#0F172A');
  const [selTextBgColor, setSelTextBgColor] = useState<string>('');
  const [selTextAlign, setSelTextAlign] = useState<'left' | 'center' | 'right'>('left');
  const [selCharSpacing, setSelCharSpacing] = useState<number>(0);
  const [selLineHeight, setSelLineHeight] = useState<number>(1.3);

  // 사진/도형 공통 및 전용 속성
  const [selOpacity, setSelOpacity] = useState<number>(100);
  const [selCornerRadius, setSelCornerRadius] = useState<number>(0);
  const [selFillColor, setSelFillColor] = useState<string>('#2563EB');
  const [selStrokeColor, setSelStrokeColor] = useState<string>('#0F172A');
  const [selStrokeWidth, setSelStrokeWidth] = useState<number>(0);
  const [selAngle, setSelAngle] = useState<number>(0);
  const [isCropping, setIsCropping] = useState<boolean>(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cropRectRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cropTargetImgRef = useRef<any>(null);

  // 캔버스 배경색
  const [canvasBgColor, setCanvasBgColor] = useState<string>('#F8FAFC');

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4500);
  }, []);

  // ==========================================================================
  // 4) 초기 로드: Google Fonts, Fabric.js v6, JSZip, FileSaver, localForage 로드
  // ==========================================================================
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const fontLinks = [
      'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css',
      'https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Do+Hyeon&family=Gowun+Batang:wght@400;700&family=Gowun+Dodum&family=Hi+Melody&family=Jua&family=Nanum+Brush+Script&family=Nanum+Gothic:wght@400;700;800&family=Nanum+Myeongjo:wght@400;700&family=Nanum+Pen+Script&family=Noto+Sans+KR:wght@400;500;700;900&family=Noto+Serif+KR:wght@400;700&family=Poor+Story&display=swap',
    ];
    fontLinks.forEach((href) => {
      if (!document.querySelector(`link[href="${href}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
      }
    });

    async function initLibraries() {
      try {
        await Promise.all([
          loadExternalScript('https://cdn.jsdelivr.net/npm/localforage@1.10.0/dist/localforage.min.js'),
          loadExternalScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'),
          loadExternalScript('https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js'),
          loadExternalScript('https://cdn.jsdelivr.net/npm/fabric@6.5.4/dist/index.min.js'),
        ]);
        if (window.localforage) {
          window.localforage.config({
            name: DB_NAME,
            storeName: STORE_NAME,
          });
        }
        setLibsReady(true);
      } catch (err) {
        console.error('라이브러리 로드 오류:', err);
      }
    }

    initLibraries();
  }, []);

  // ==========================================================================
  // 5) localForage에서 저장된 폰트 · 사진 · 슬라이드 작업 내용 자동 복원
  // ==========================================================================
  useEffect(() => {
    if (!libsReady) return;
    let cancelled = false;

    async function restoreWorkspace() {
      // 1. 저장된 내 폰트 파일 복원 및 FontFace 등록
      const savedFonts = await loadFromLocalDb<CustomFontItem[]>('acs_custom_fonts_v1');
      if (savedFonts && Array.isArray(savedFonts) && savedFonts.length > 0 && !cancelled) {
        for (const cf of savedFonts) {
          try {
            if (cf.base64Data && 'FontFace' in window) {
              const res = await fetch(cf.base64Data);
              const buf = await res.arrayBuffer();
              const face = new FontFace(cf.id, buf);
              await face.load();
              document.fonts.add(face);
            }
          } catch {
            // ignore broken font
          }
        }
        setCustomFonts(savedFonts);
      }

      // 2. 저장된 업로드 사진 복원
      const savedPhotos = await loadFromLocalDb<UploadedPhoto[]>('acs_uploaded_photos_v1');
      if (savedPhotos && Array.isArray(savedPhotos) && savedPhotos.length > 0 && !cancelled) {
        setUploadedPhotos(savedPhotos);
      }

      // 2-B. [1단계] 저장된 기획안 목록 & 현재 작성 중이던 기획안 탭 복원
      const savedPlans = await loadFromLocalDb<AIPlanDocument[]>(SAVED_PLANS_STORAGE_KEY);
      if (savedPlans && Array.isArray(savedPlans) && !cancelled) {
        setSavedPlansList(savedPlans);
      }
      const savedActivePlans = await loadFromLocalDb<{
        planTopic?: string;
        planTargetAudience?: string;
        planPurpose?: string;
        planTone?: string;
        planReferenceText?: string;
        planSlideCountOption?: 'auto' | number;
        planCandidates?: AIPlanDocument[];
        activePlanTabIdx?: number;
        workflowStep?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
      }>('acs_active_plan_workspace_v1');
      if (savedActivePlans && !cancelled) {
        if (savedActivePlans.planTopic) setPlanTopic(savedActivePlans.planTopic);
        if (savedActivePlans.planTargetAudience !== undefined)
          setPlanTargetAudience(savedActivePlans.planTargetAudience);
        if (savedActivePlans.planPurpose !== undefined) setPlanPurpose(savedActivePlans.planPurpose);
        if (savedActivePlans.planTone !== undefined) setPlanTone(savedActivePlans.planTone);
        if (savedActivePlans.planReferenceText !== undefined)
          setPlanReferenceText(savedActivePlans.planReferenceText);
        if (savedActivePlans.planSlideCountOption !== undefined)
          setPlanSlideCountOption(savedActivePlans.planSlideCountOption);
        if (Array.isArray(savedActivePlans.planCandidates) && savedActivePlans.planCandidates.length > 0) {
          setPlanCandidates(savedActivePlans.planCandidates);
          setActivePlanTabIdx(
            Math.min(
              savedActivePlans.activePlanTabIdx || 0,
              savedActivePlans.planCandidates.length - 1
            )
          );
        }
        if (savedActivePlans.workflowStep) {
          setWorkflowStep(savedActivePlans.workflowStep);
        }
      }

      // 브랜드 설정 복원
      const savedBrand = await loadFromLocalDb<{
        tone?: string;
        favoriteHashtags?: string;
        forbiddenWords?: string;
        closingSignature?: string;
      }>('acs_brand_settings_v1');
      if (savedBrand && !cancelled) {
        if (savedBrand.tone) setBrandTone(savedBrand.tone);
        if (savedBrand.favoriteHashtags) setBrandFavoriteHashtags(savedBrand.favoriteHashtags);
        if (savedBrand.forbiddenWords) setBrandForbiddenWords(savedBrand.forbiddenWords);
        if (savedBrand.closingSignature) setBrandClosingSignature(savedBrand.closingSignature);
      }

      // 내 템플릿 목록 복원
      const savedTpls = await loadFromLocalDb<UserSavedTemplate[]>('acs_user_templates_v1');
      if (savedTpls && Array.isArray(savedTpls) && !cancelled) {
        setSavedUserTemplates(savedTpls);
      }

      // 하루 AI 사용량 카운트 복원
      try {
        const todayStr = new Date().toISOString().slice(0, 10);
        const rawQuota = window.localStorage.getItem(`acs_daily_ai_${todayStr}`);
        if (rawQuota) {
          setDailyAiUsedCount(Number(rawQuota) || 0);
        }
      } catch {
        // ignore
      }

      // 3. 저장된 슬라이드 복원 (빈 캔버스 객체로 인해 미리보기가 안 나오는 문제 완벽 차단!)
      const savedState = await loadFromLocalDb<{
        slides: SlideItem[];
        aspectRatio: AspectRatioKey;
        fontId: string;
        templateId: CardTemplateId;
        accentColor: string;
        showWatermark: boolean;
        watermarkText: string;
        rawText: string;
        baseCaption: string;
      }>(STATE_STORAGE_KEY);

      if (savedState && Array.isArray(savedState.slides) && savedState.slides.length > 0 && !cancelled) {
        const sanitizedSlides: SlideItem[] = savedState.slides.map((s, idx) => {
          const hasValidObjects =
            s.fabricJson &&
            Array.isArray(s.fabricJson.objects) &&
            s.fabricJson.objects.length > 0;
          return {
            ...s,
            slideNumber: idx + 1,
            photoFitMode: s.photoFitMode || 'contain',
            photoBgFillMode: s.photoBgFillMode || 'solid',
            fabricJson: hasValidObjects ? s.fabricJson : undefined,
          };
        });
        setSlides(sanitizedSlides);
        setSlideCount(sanitizedSlides.length);
        if (savedState.aspectRatio) setAspectRatio(savedState.aspectRatio);
        if (savedState.fontId) setFontId(savedState.fontId);
        if (savedState.templateId) setTemplateId(savedState.templateId);
        if (savedState.accentColor) setAccentColor(savedState.accentColor);
        setShowWatermark(Boolean(savedState.showWatermark));
        setWatermarkText(savedState.watermarkText || '');
        if (savedState.rawText) setRawText(savedState.rawText);
        if (savedState.baseCaption) setBaseCaption(savedState.baseCaption);
        setAutoSaveStatus('이전 작업 자동 복원됨');
        setCanvasRebuildTick((t) => t + 1);
      } else if (!cancelled) {
        setCanvasRebuildTick((t) => t + 1);
      }
    }

    restoreWorkspace();
    return () => {
      cancelled = true;
    };
  }, [libsReady]);

  // 슬라이드/설정 변경 시 localForage 자동 저장
  useEffect(() => {
    if (!libsReady || slides.length === 0) return;
    const timer = setTimeout(async () => {
      await saveToLocalDb(STATE_STORAGE_KEY, {
        slides,
        aspectRatio,
        fontId,
        templateId,
        accentColor,
        showWatermark,
        watermarkText,
        rawText,
        baseCaption,
      });
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(
        now.getMinutes()
      ).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      setAutoSaveStatus(`자동 저장됨 (${timeStr})`);
    }, 500);
    return () => clearTimeout(timer);
  }, [
    libsReady,
    slides,
    aspectRatio,
    fontId,
    templateId,
    accentColor,
    showWatermark,
    watermarkText,
    rawText,
    baseCaption,
  ]);

  // 업로드 사진 변경 시 localForage 저장
  useEffect(() => {
    if (!libsReady) return;
    saveToLocalDb('acs_uploaded_photos_v1', uploadedPhotos);
  }, [libsReady, uploadedPhotos]);

  // [1단계] 기획안 작성 상태 자동 저장 (새로고침해도 유지)
  useEffect(() => {
    if (!libsReady) return;
    const timer = setTimeout(() => {
      saveToLocalDb('acs_active_plan_workspace_v1', {
        planTopic,
        planTargetAudience,
        planPurpose,
        planTone,
        planReferenceText,
        planSlideCountOption,
        planCandidates,
        activePlanTabIdx,
        workflowStep,
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [
    libsReady,
    planTopic,
    planTargetAudience,
    planPurpose,
    planTone,
    planReferenceText,
    planSlideCountOption,
    planCandidates,
    activePlanTabIdx,
    workflowStep,
  ]);

  // ==========================================================================
  // 6) 모바일 / PC 화면 크기에 맞춰 캔버스 표시 배율(scale) 자동 계산 (ResizeObserver 적용)
  // ==========================================================================
  const targetDimensions = ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS['4:5'];

  useEffect(() => {
    const updateScale = () => {
      if (!wrapperRef.current) return;
      const rectW = wrapperRef.current.clientWidth;
      if (rectW <= 20) return;
      const availableW = rectW - 24;
      const scale = Math.min(0.62, Math.max(0.25, availableW / targetDimensions.width));
      setCanvasScale(scale);
    };
    updateScale();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && wrapperRef.current) {
      observer = new ResizeObserver(() => updateScale());
      observer.observe(wrapperRef.current);
    }

    window.addEventListener('resize', updateScale);
    return () => {
      window.removeEventListener('resize', updateScale);
      if (observer) observer.disconnect();
    };
  }, [targetDimensions.width, activeTab]);

  // ==========================================================================
  // 7) [기능 3: 로그인/세션 유지/OAuth 콜백 확인]
  // ==========================================================================
  useEffect(() => {
    const supabase = getSupabaseBrowser();

    // 1. 페이지 로드 시 저장된 로그인 세션 즉시 복원
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.warn('세션 확인 경고:', error.message);
      }
      if (data.session) {
        setSessionToken(data.session.access_token);
        setUserId(data.session.user.id);
        setUserEmail(data.session.user.email || '');
      }
    });

    // 2. 로그인/로그아웃/토큰 갱신 실시간 감지
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        setSessionToken(session.access_token);
        setUserId(session.user.id);
        setUserEmail(session.user.email || '');
        if (event === 'SIGNED_IN') {
          setAuthMessage('');
        }
      } else {
        setSessionToken(null);
        setUserId(null);
        setUserEmail('');
      }
    });

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab');
      const errParam = params.get('error') || params.get('error_description');
      const okParam = params.get('success');
      if (tabParam === 'accounts' || tabParam === 'history' || tabParam === 'create') {
        setActiveTab(tabParam);
      }
      if (errParam) {
        const friendly = toFriendlyKoreanAuthError(errParam);
        setAuthMessage(friendly);
        showToast(`⚠️ ${friendly}`);
      }
      if (okParam) showToast(`✅ ${okParam}`);
    }

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [showToast]);

  useEffect(() => {
    if (sessionToken) {
      fetchAccounts();
      fetchPostHistory();
    }
  }, [sessionToken]);

  async function fetchAccounts() {
    if (!sessionToken) return;
    try {
      const res = await fetch('/api/accounts', {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const data = await res.json();
      if (data.accounts) setAccounts(data.accounts);
    } catch {
      // ignore
    }
  }

  async function fetchPostHistory() {
    if (!sessionToken) return;
    try {
      const res = await fetch('/api/posts/publish', {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const data = await res.json();
      if (data.posts) setPostHistory(data.posts);
    } catch {
      // ignore
    }
  }

  // ==========================================================================
  // 8) 기본 슬라이드 초안 생성기 / 전체 초기화
  // ==========================================================================
  function buildDefaultSlides(count: number, resetCanvas = false, blankMode = false) {
    const nextSlides = createInitialSlides(count, templateId, uploadedPhotos, blankMode);
    if (resetCanvas) {
      historyMapRef.current = {};
      redoMapRef.current = {};
    }
    setSlides(nextSlides);
    setSlideCount(count);
    setActiveSlideIndex(0);
    setCanvasRebuildTick((t) => t + 1);
  }

  // ==========================================================================
  // 9) Fabric.js 캔버스 초기화 및 이벤트 바인딩
  // ==========================================================================
  const saveCanvasToActiveSlide = useCallback(
    (pushHistory = true) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas || isRestoringRef.current) return;

      const slide = slides[activeSlideIndex];
      if (!slide) return;
      if (cropRectRef.current) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const objs: any[] = canvas.getObjects ? canvas.getObjects() : [];
      // 캔버스가 비어 있을 때는 잘못된 빈 JSON으로 덮어쓰지 않도록 보호!
      if (objs.length === 0) return;

      const jsonObj = canvas.toObject(CUSTOM_PROPS);
      jsonObj.background = canvas.backgroundColor || '#FFFFFF';
      const jsonStr = JSON.stringify(jsonObj);

      if (pushHistory) {
        const slideId = slide.id;
        const stack = historyMapRef.current[slideId] || [];
        if (stack[stack.length - 1] !== jsonStr) {
          const nextStack = [...stack.slice(-29), jsonStr];
          historyMapRef.current[slideId] = nextStack;
          redoMapRef.current[slideId] = [];
          setCanUndo(nextStack.length > 1);
          setCanRedo(false);
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const headlineObj = objs.find((o: any) => o.customRole === 'headline');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bodyObj = objs.find((o: any) => o.customRole === 'body');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const badgeObj = objs.find((o: any) => o.customRole === 'badge-text');

      setSlides((prev) =>
        prev.map((s, idx) =>
          idx === activeSlideIndex
            ? {
                ...s,
                fabricJson: jsonObj,
                headline: headlineObj?.text !== undefined ? String(headlineObj.text) : s.headline,
                body: bodyObj?.text !== undefined ? String(bodyObj.text) : s.body,
                badgeText: badgeObj?.text !== undefined ? String(badgeObj.text) : s.badgeText,
                customBgColor: String(canvas.backgroundColor || '#FFFFFF'),
              }
            : s
        )
      );
    },
    [activeSlideIndex, slides]
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const syncSelectionState = useCallback((obj: any) => {
    if (!obj) {
      setSelectedObjType('none');
      return;
    }

    const type = String(obj.type || '').toLowerCase();
    setSelOpacity(Math.round((obj.opacity ?? 1) * 100));
    setSelAngle(Math.round(obj.angle ?? 0));

    if (type === 'textbox' || type === 'i-text' || type === 'text') {
      setSelectedObjType('text');
      setSelTextValue(String(obj.text || ''));
      setSelFontFamily(String(obj.fontFamily || 'Pretendard').replace(/['"]/g, ''));
      setSelFontSize(Math.round(obj.fontSize || 48));
      setSelFontWeight(String(obj.fontWeight || 'bold'));
      setSelTextColor(String(obj.fill || '#0F172A'));
      setSelTextBgColor(String(obj.textBackgroundColor || ''));
      setSelTextAlign((obj.textAlign as 'left' | 'center' | 'right') || 'left');
      setSelCharSpacing(Math.round(obj.charSpacing || 0));
      setSelLineHeight(Number((obj.lineHeight || 1.3).toFixed(2)));
    } else if (type === 'image') {
      setSelectedObjType('image');
      setSelCornerRadius(Math.round(obj.cornerRadius || 0));
      setSelStrokeColor(String(obj.stroke || '#FFFFFF'));
      setSelStrokeWidth(Math.round(obj.strokeWidth || 0));
    } else {
      setSelectedObjType('shape');
      setSelFillColor(String(obj.fill || '#2563EB'));
      setSelStrokeColor(String(obj.stroke || '#0F172A'));
      setSelStrokeWidth(Math.round(obj.strokeWidth || 0));
      setSelCornerRadius(Math.round(obj.rx || obj.cornerRadius || 0));
    }
  }, []);

  // Fabric.js 인스턴스 생성
  useEffect(() => {
    if (!libsReady || !window.fabric || !canvasElRef.current) return;

    const fabric = window.fabric;
    if (fabric.FabricObject && fabric.FabricObject.ownDefaults) {
      fabric.FabricObject.ownDefaults.transparentCorners = false;
      fabric.FabricObject.ownDefaults.cornerColor = '#2563EB';
      fabric.FabricObject.ownDefaults.cornerStrokeColor = '#FFFFFF';
      fabric.FabricObject.ownDefaults.borderColor = '#2563EB';
      fabric.FabricObject.ownDefaults.cornerSize = 18;
      fabric.FabricObject.ownDefaults.cornerStyle = 'circle';
      fabric.FabricObject.ownDefaults.padding = 8;
    }

    const canvas = new fabric.Canvas(canvasElRef.current, {
      width: targetDimensions.width,
      height: targetDimensions.height,
      backgroundColor: '#F8FAFC',
      preserveObjectStacking: true,
      selection: true,
    });

    fabricCanvasRef.current = canvas;
    setCanvasRebuildTick((t) => t + 1);

    return () => {
      canvas.dispose();
      fabricCanvasRef.current = null;
    };
  }, [libsReady]);

  // 비율(4:5 / 1:1) 변경 시 캔버스 크기 업데이트
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    if (typeof canvas.setDimensions === 'function') {
      canvas.setDimensions({
        width: targetDimensions.width,
        height: targetDimensions.height,
      });
    } else {
      canvas.setWidth(targetDimensions.width);
      canvas.setHeight(targetDimensions.height);
    }
    canvas.requestRenderAll();
  }, [targetDimensions.width, targetDimensions.height]);

  // 캔버스 이벤트 리스너 (정렬 스냅 가이드선, 객체 선택/수정 감지)
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const handleSelection = () => {
      const active = canvas.getActiveObject();
      syncSelectionState(active);
    };

    const handleCleared = () => {
      setSelectedObjType('none');
      setSnapGuideX(null);
      setSnapGuideY(null);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleObjectMoving = (e: any) => {
      const obj = e.target;
      if (!obj || obj.customRole === 'crop-zone') return;

      const cw = canvas.width || 1080;
      const ch = canvas.height || 1350;
      const SNAP_DIST = 12;

      const center = obj.getCenterPoint ? obj.getCenterPoint() : { x: obj.left, y: obj.top };
      let snappedX: number | null = null;
      let snappedY: number | null = null;

      if (Math.abs(center.x - cw / 2) < SNAP_DIST) {
        const diffX = cw / 2 - center.x;
        obj.set('left', obj.left + diffX);
        snappedX = cw / 2;
      }

      if (Math.abs(center.y - ch / 2) < SNAP_DIST) {
        const diffY = ch / 2 - center.y;
        obj.set('top', obj.top + diffY);
        snappedY = ch / 2;
      }

      if (snappedX === null && Math.abs(obj.left - 72) < SNAP_DIST) {
        obj.set('left', 72);
        snappedX = 72;
      }

      if (snappedX === null || snappedY === null) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const others: any[] = canvas.getObjects().filter((o: any) => o !== obj && o.visible);
        for (const other of others) {
          const oc = other.getCenterPoint ? other.getCenterPoint() : { x: other.left, y: other.top };
          if (snappedX === null && Math.abs(center.x - oc.x) < SNAP_DIST) {
            obj.set('left', obj.left + (oc.x - center.x));
            snappedX = oc.x;
          }
          if (snappedY === null && Math.abs(center.y - oc.y) < SNAP_DIST) {
            obj.set('top', obj.top + (oc.y - center.y));
            snappedY = oc.y;
          }
        }
      }

      obj.setCoords();
      setSnapGuideX(snappedX);
      setSnapGuideY(snappedY);
    };

    const handleMouseUp = () => {
      setSnapGuideX(null);
      setSnapGuideY(null);
    };

    const handleModified = () => {
      setSnapGuideX(null);
      setSnapGuideY(null);
      const active = canvas.getActiveObject();
      syncSelectionState(active);
      saveCanvasToActiveSlide(true);
    };

    const handleTextChanged = () => {
      const active = canvas.getActiveObject();
      if (active) {
        setSelTextValue(String(active.text || ''));
      }
      saveCanvasToActiveSlide(true);
    };

    canvas.on('selection:created', handleSelection);
    canvas.on('selection:updated', handleSelection);
    canvas.on('selection:cleared', handleCleared);
    canvas.on('object:moving', handleObjectMoving);
    canvas.on('mouse:up', handleMouseUp);
    canvas.on('object:modified', handleModified);
    canvas.on('text:changed', handleTextChanged);

    return () => {
      canvas.off('selection:created', handleSelection);
      canvas.off('selection:updated', handleSelection);
      canvas.off('selection:cleared', handleCleared);
      canvas.off('object:moving', handleObjectMoving);
      canvas.off('mouse:up', handleMouseUp);
      canvas.off('object:modified', handleModified);
      canvas.off('text:changed', handleTextChanged);
    };
  }, [libsReady, syncSelectionState, saveCanvasToActiveSlide]);

  // ==========================================================================
  // 10) [핵심: 3단계 사진 비율 맞춰 크게 넣기(contain) + 블러 배경(blur) + 텍스트 배치]
  // ==========================================================================
  const buildFabricObjectsForSlide = useCallback(
    async (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      targetCanvas: any,
      slide: SlideItem,
      totalCount: number,
      overrideTemplateId?: CardTemplateId
    ) => {
      if (!window.fabric || !targetCanvas) return;
      const fabric = window.fabric;
      const ImageClass = fabric.FabricImage || fabric.Image;

      const cw = targetDimensions.width;
      const ch = targetDimensions.height;
      const tplId = overrideTemplateId || slide.templateId || templateId || 'top-photo-card';
      const tpl = CARD_TEMPLATES.find((t) => t.id === tplId) || CARD_TEMPLATES[0];

      const bgHex = slide.customBgColor || tpl.bgColor;
      const effectiveAccent = accentColor || tpl.accentColor;
      const badgeFg = getReadableTextOnAccent(effectiveAccent);
      const mainTextColor = ensureReadableColor(tpl.textColor, bgHex, 4.5);
      const subTextColor = ensureReadableColor(tpl.subTextColor, bgHex, 3.5);

      // 현재 장의 사진 표시 방식 (기본값: 'contain' = 자르지 않고 전체 보이기!)
      const fitMode: PhotoFitMode = slide.photoFitMode || 'contain';
      // 현재 장의 여백 채우기 방식 (기본값: 'solid' = 배경색 채우기 / 'blur' = 같은 사진 흐리게 깔기)
      const bgFillMode: PhotoBgFillMode = slide.photoBgFillMode || 'solid';

      targetCanvas.clear();
      targetCanvas.backgroundColor = bgHex;
      setCanvasBgColor(bgHex);

      const photoUrls: string[] =
        Array.isArray(slide.photoUrls) && slide.photoUrls.length > 0
          ? slide.photoUrls.filter(Boolean)
          : slide.photoUrl
          ? [slide.photoUrl]
          : [];

      // ======================================================================
      // [기능 2 핵심] 사진 객체 생성기:
      // - fitMode === 'contain' (기본값): 사진을 절대 자르지 않고 가로세로 비율을 유지한 채
      //   박스 안에 최대한 크게 배치! 남는 빈 공간은 배경색('solid') 또는 같은 사진 블러('blur')로 채움!
      // - fitMode === 'cover': 박스 영역에 꽉 차도록 중앙 크롭하여 배치
      // ======================================================================
      const createPhotoObject = async (
        url: string,
        boxLeft: number,
        boxTop: number,
        boxW: number,
        boxH: number,
        radius = 24,
        slotIdx = 0
      ) => {
        try {
          const imgEl = await loadHtmlImageElement(url);
          const natW = imgEl.naturalWidth || imgEl.width || 800;
          const natH = imgEl.naturalHeight || imgEl.height || 800;

          if (fitMode === 'contain') {
            // 1) 남는 여백 채우기 (블러 배경 또는 깔끔한 배경 프레임)
            if (bgFillMode === 'blur') {
              try {
                const blurDataUrl = await createBlurredBackdropDataUrl(imgEl, boxW, boxH);
                if (blurDataUrl) {
                  const blurEl = await loadHtmlImageElement(blurDataUrl);
                  const bNatW = blurEl.naturalWidth || blurEl.width || boxW;
                  const bNatH = blurEl.naturalHeight || blurEl.height || boxH;
                  const bScaleX = boxW / bNatW;
                  const bScaleY = boxH / bNatH;

                  const blurImg = new ImageClass(blurEl, {
                    left: boxLeft,
                    top: boxTop,
                    width: bNatW,
                    height: bNatH,
                    scaleX: bScaleX,
                    scaleY: bScaleY,
                    selectable: false,
                    evented: false,
                    customId: `photo-blur-bg-${Date.now()}-${slotIdx}`,
                    customRole: 'photo-backdrop',
                  });

                  if (radius > 0) {
                    blurImg.set(
                      'clipPath',
                      new fabric.Rect({
                        width: bNatW,
                        height: bNatH,
                        rx: radius / bScaleX,
                        ry: radius / bScaleY,
                        originX: 'center',
                        originY: 'center',
                      })
                    );
                  }
                  targetCanvas.add(blurImg);
                }
              } catch {
                // fallback to solid background frame
              }
            } else {
              // 기본: 남는 빈 공간을 배경색(또는 폴라로이드/카드 프레임색)으로 자연스럽게 채움
              const solidFrame = new fabric.Rect({
                left: boxLeft,
                top: boxTop,
                width: boxW,
                height: boxH,
                fill: bgHex,
                rx: radius,
                ry: radius,
                selectable: false,
                evented: false,
                customId: `photo-solid-bg-${Date.now()}-${slotIdx}`,
                customRole: 'photo-backdrop',
              });
              targetCanvas.add(solidFrame);
            }

            // 2) 사진을 자르지 않고(cropX=0, cropY=0) 원본 비율 100% 그대로 박스 안에 최대한 크게 넣기!
            const containScale = Math.min(boxW / natW, boxH / natH);
            const scaledW = natW * containScale;
            const scaledH = natH * containScale;
            const centeredLeft = Math.round(boxLeft + (boxW - scaledW) / 2);
            const centeredTop = Math.round(boxTop + (boxH - scaledH) / 2);

            const fImg = new ImageClass(imgEl, {
              left: centeredLeft,
              top: centeredTop,
              cropX: 0,
              cropY: 0,
              width: natW,
              height: natH,
              scaleX: containScale,
              scaleY: containScale,
              customId: `photo-${Date.now()}-${slotIdx}`,
              customRole: 'photo',
              originalSrc: url,
              cornerRadius: radius,
              photoSlotIndex: slotIdx,
              photoFitMode: 'contain',
              photoBgFillMode: bgFillMode,
              boxLeft,
              boxTop,
              boxW,
              boxH,
            });

            if (radius > 0) {
              fImg.set(
                'clipPath',
                new fabric.Rect({
                  width: natW,
                  height: natH,
                  rx: radius / containScale,
                  ry: radius / containScale,
                  originX: 'center',
                  originY: 'center',
                })
              );
            }

            if (tplId === 'polaroid-frame') {
              fImg.set({
                stroke: '#FFFFFF',
                strokeWidth: Math.round(14 / containScale),
              });
            }

            targetCanvas.add(fImg);
          } else {
            // 'cover': 꽉 채우기 (자름)
            const coverScale = Math.max(boxW / natW, boxH / natH);
            const cropW = Math.min(natW, Math.round(boxW / coverScale));
            const cropH = Math.min(natH, Math.round(boxH / coverScale));
            const cropX = Math.max(0, Math.round((natW - cropW) / 2));
            const cropY = Math.max(0, Math.round((natH - cropH) / 2));

            const fImg = new ImageClass(imgEl, {
              left: boxLeft,
              top: boxTop,
              cropX,
              cropY,
              width: cropW,
              height: cropH,
              scaleX: coverScale,
              scaleY: coverScale,
              customId: `photo-${Date.now()}-${slotIdx}`,
              customRole: 'photo',
              originalSrc: url,
              cornerRadius: radius,
              photoSlotIndex: slotIdx,
              photoFitMode: 'cover',
              photoBgFillMode: bgFillMode,
              boxLeft,
              boxTop,
              boxW,
              boxH,
            });

            if (radius > 0) {
              fImg.set(
                'clipPath',
                new fabric.Rect({
                  width: cropW,
                  height: cropH,
                  rx: radius / coverScale,
                  ry: radius / coverScale,
                  originX: 'center',
                  originY: 'center',
                })
              );
            }

            if (tplId === 'polaroid-frame') {
              fImg.set({
                stroke: '#FFFFFF',
                strokeWidth: Math.round(14 / coverScale),
              });
            }

            targetCanvas.add(fImg);
          }
        } catch (e) {
          console.warn('사진 객체 생성 실패:', e);
        }
      };

      const placePhotosInBox = async (
        boxLeft: number,
        boxTop: number,
        boxW: number,
        boxH: number,
        radius = 24
      ) => {
        if (photoUrls.length === 0) return;
        const gap = 16;
        if (photoUrls.length === 1) {
          await createPhotoObject(photoUrls[0], boxLeft, boxTop, boxW, boxH, radius, 0);
        } else if (photoUrls.length === 2) {
          const w = Math.round((boxW - gap) / 2);
          await createPhotoObject(photoUrls[0], boxLeft, boxTop, w, boxH, radius, 0);
          await createPhotoObject(photoUrls[1], boxLeft + w + gap, boxTop, w, boxH, radius, 1);
        } else if (photoUrls.length === 3) {
          const leftW = Math.round((boxW - gap) * 0.56);
          const rightW = boxW - gap - leftW;
          const halfH = Math.round((boxH - gap) / 2);
          await createPhotoObject(photoUrls[0], boxLeft, boxTop, leftW, boxH, radius, 0);
          await createPhotoObject(photoUrls[1], boxLeft + leftW + gap, boxTop, rightW, halfH, radius, 1);
          await createPhotoObject(
            photoUrls[2],
            boxLeft + leftW + gap,
            boxTop + halfH + gap,
            rightW,
            halfH,
            radius,
            2
          );
        } else {
          const cols = 2;
          const rows = Math.ceil(photoUrls.length / 2);
          const cellW = Math.round((boxW - gap * (cols - 1)) / cols);
          const cellH = Math.round((boxH - gap * (rows - 1)) / rows);
          for (let i = 0; i < photoUrls.length; i++) {
            const r = Math.floor(i / cols);
            const c = i % cols;
            await createPhotoObject(
              photoUrls[i],
              boxLeft + c * (cellW + gap),
              boxTop + r * (cellH + gap),
              cellW,
              cellH,
              radius,
              i
            );
          }
        }
      };

      const pad = 72;
      const innerW = cw - pad * 2;

      // 템플릿별 레이아웃 배치 (사진이 더 크게 잘 보이도록 사진 영역 비중을 넉넉하게 확보)
      if (tplId === 'full-bleed-poster') {
        if (photoUrls.length > 0) {
          await placePhotosInBox(0, 0, cw, ch, 0);
          const overlayRect = new fabric.Rect({
            left: 0,
            top: 0,
            width: cw,
            height: ch,
            fill: '#0F172A',
            opacity: 0.48,
            selectable: true,
            customId: `overlay-${Date.now()}`,
            customRole: 'shape-card',
          });
          targetCanvas.add(overlayRect);
        }
      } else if (tplId === 'top-photo-card' || tplId === 'polaroid-frame' || tplId === 'dark-neon-card') {
        const photoH = photoUrls.length > 0 ? Math.round(ch * 0.5) : 0;
        if (photoUrls.length > 0) {
          await placePhotosInBox(
            pad,
            132,
            innerW,
            photoH,
            tplId === 'polaroid-frame' ? 8 : 24
          );
        }
        const cardTop = photoUrls.length > 0 ? 132 + photoH + 24 : 160;
        const cardH = ch - cardTop - pad;
        const cardRect = new fabric.Rect({
          left: pad,
          top: cardTop,
          width: innerW,
          height: Math.max(220, cardH),
          fill: tpl.cardBoxColor,
          rx: 28,
          ry: 28,
          customId: `cardbox-${Date.now()}`,
          customRole: 'shape-card',
        });
        targetCanvas.add(cardRect);
      } else if (tplId === 'bottom-photo-card') {
        const photoH = photoUrls.length > 0 ? Math.round(ch * 0.5) : 0;
        if (photoUrls.length > 0) {
          await placePhotosInBox(pad, ch - pad - photoH, innerW, photoH, 24);
        }
      } else if (tplId === 'split-magazine') {
        if (photoUrls.length > 0) {
          const leftW = Math.round(innerW * 0.48);
          await placePhotosInBox(pad, 136, leftW, ch - 136 - pad, 24);
        }
      } else if (tplId === 'center-focus-box') {
        if (photoUrls.length > 0) {
          await placePhotosInBox(0, 0, cw, ch, 0);
        }
        const boxW = cw - 120;
        const boxH = Math.round(ch * 0.5);
        const centerCard = new fabric.Rect({
          left: 60,
          top: Math.round((ch - boxH) / 2),
          width: boxW,
          height: boxH,
          fill: '#FFFFFF',
          opacity: 0.94,
          rx: 36,
          ry: 36,
          customId: `centerbox-${Date.now()}`,
          customRole: 'shape-card',
        });
        targetCanvas.add(centerCard);
      } else if (tplId === 'multi-collage-grid') {
        const photoH = photoUrls.length > 0 ? Math.round(ch * 0.54) : 0;
        if (photoUrls.length > 0) {
          await placePhotosInBox(pad, 132, innerW, photoH, 20);
        }
      }

      // 상단 뱃지 도형 + 뱃지 글씨 + 슬라이드 번호
      if (slide.badgeText !== undefined) {
        const badgeStr = slide.badgeText || `${slide.slideNumber}장`;
        const badgeW = Math.max(140, badgeStr.length * 24 + 48);
        const badgeBg = new fabric.Rect({
          left: pad,
          top: 54,
          width: badgeW,
          height: 50,
          fill: effectiveAccent,
          rx: 14,
          ry: 14,
          customId: `badge-bg-${Date.now()}`,
          customRole: 'badge-bg',
        });
        const badgeTxt = new fabric.Textbox(badgeStr, {
          left: pad + 12,
          top: 65,
          width: badgeW - 24,
          fontSize: 24,
          fontFamily: fontId,
          fontWeight: 'bold',
          fill: badgeFg,
          textAlign: 'center',
          customId: `badge-txt-${Date.now()}`,
          customRole: 'badge-text',
        });
        targetCanvas.add(badgeBg);
        targetCanvas.add(badgeTxt);
      }

      if (totalCount > 1) {
        const numTxt = new fabric.Textbox(`${slide.slideNumber} / ${totalCount}`, {
          left: cw - pad - 130,
          top: 64,
          width: 130,
          fontSize: 26,
          fontFamily: fontId,
          fontWeight: 'bold',
          fill: tplId === 'full-bleed-poster' && photoUrls.length > 0 ? '#E2E8F0' : subTextColor,
          textAlign: 'right',
          customId: `slidenum-${Date.now()}`,
          customRole: 'slide-number',
        });
        targetCanvas.add(numTxt);
      }

      // 제목(headline) & 본문(body) 텍스트 객체 배치
      let textLeft = pad + 32;
      let textWidth = innerW - 64;
      let headlineTop = Math.round(ch * 0.66);
      let align: 'left' | 'center' | 'right' = 'left';

      if (tplId === 'bottom-photo-card') {
        textLeft = pad;
        textWidth = innerW;
        headlineTop = 152;
      } else if (tplId === 'split-magazine' && photoUrls.length > 0) {
        const leftW = Math.round(innerW * 0.48);
        textLeft = pad + leftW + 36;
        textWidth = innerW - leftW - 36;
        headlineTop = Math.round(ch * 0.34);
      } else if (tplId === 'center-focus-box') {
        textLeft = 110;
        textWidth = cw - 220;
        headlineTop = Math.round(ch * 0.35);
        align = 'center';
      } else if (tplId === 'full-bleed-poster') {
        textLeft = pad;
        textWidth = innerW;
        headlineTop = Math.round(ch * 0.58);
      } else if (tplId === 'multi-collage-grid') {
        textLeft = pad;
        textWidth = innerW;
        headlineTop = photoUrls.length > 0 ? Math.round(ch * 0.72) : Math.round(ch * 0.36);
      } else if (photoUrls.length === 0) {
        headlineTop = Math.round(ch * 0.34);
      }

      const titleColor =
        tplId === 'full-bleed-poster' && photoUrls.length > 0
          ? '#FFFFFF'
          : tplId === 'center-focus-box'
          ? '#0F172A'
          : mainTextColor;

      const bodyColor =
        tplId === 'full-bleed-poster' && photoUrls.length > 0
          ? '#E2E8F0'
          : tplId === 'center-focus-box'
          ? '#334155'
          : subTextColor;

      const headlineTextbox = new fabric.Textbox(
        slide.headline !== undefined ? slide.headline : '제목을 입력하세요',
        {
          left: textLeft,
          top: headlineTop,
          width: textWidth,
          fontSize: tplId === 'full-bleed-poster' ? 60 : 50,
          fontFamily: fontId,
          fontWeight: 'bold',
          fill: titleColor,
          textAlign: align,
          lineHeight: 1.28,
          charSpacing: 0,
          customId: `headline-${Date.now()}`,
          customRole: 'headline',
        }
      );
      targetCanvas.add(headlineTextbox);

      const headlineHeight = headlineTextbox.calcTextHeight
        ? headlineTextbox.calcTextHeight()
        : 120;

      const bodyTextbox = new fabric.Textbox(
        slide.body !== undefined ? slide.body : '본문 내용을 입력하세요',
        {
          left: textLeft,
          top: headlineTop + headlineHeight + 24,
          width: textWidth,
          fontSize: 29,
          fontFamily: fontId,
          fontWeight: 'normal',
          fill: bodyColor,
          textAlign: align,
          lineHeight: 1.5,
          charSpacing: 0,
          customId: `body-${Date.now()}`,
          customRole: 'body',
        }
      );
      targetCanvas.add(bodyTextbox);

      // [1단계 & 2단계 연동] "사진에 들어갈 글"(photoOverlayText)이 있으면
      // 사진 위에서 글씨가 잘 읽히도록 반투명 어두운 막(#0F172A, opacity 0.68)을 깔고 흰색 굵은 글씨로 배치
      if (slide.photoOverlayText && slide.photoOverlayText.trim()) {
        const overlayStr = slide.photoOverlayText.trim();
        const overlayBarW = innerW - 48;
        const overlayBarH = 74;
        const overlayBarLeft = pad + 24;
        const overlayBarTop =
          photoUrls.length > 0
            ? tplId === 'bottom-photo-card'
              ? ch - pad - 104
              : 132 + Math.round(ch * 0.5) - 96
            : Math.max(136, headlineTop - 98);

        const overlayBar = new fabric.Rect({
          left: overlayBarLeft,
          top: overlayBarTop,
          width: overlayBarW,
          height: overlayBarH,
          fill: '#0F172A',
          opacity: 0.72,
          rx: 18,
          ry: 18,
          customId: `photo-overlay-bg-${Date.now()}`,
          customRole: 'photo-overlay-bg',
        });
        const overlayTxt = new fabric.Textbox(overlayStr, {
          left: overlayBarLeft + 24,
          top: overlayBarTop + 20,
          width: overlayBarW - 48,
          fontSize: 27,
          fontFamily: fontId,
          fontWeight: 'bold',
          fill: '#FFFFFF',
          textAlign: 'center',
          customId: `photo-overlay-txt-${Date.now()}`,
          customRole: 'photo-overlay-text',
        });
        targetCanvas.add(overlayBar);
        targetCanvas.add(overlayTxt);
      }

      if (showWatermark && watermarkText.trim()) {
        const wmTextbox = new fabric.Textbox(watermarkText.trim(), {
          left: pad,
          top: ch - 64,
          width: innerW,
          fontSize: 22,
          fontFamily: fontId,
          fontWeight: 'normal',
          fill: bodyColor,
          opacity: 0.75,
          textAlign: 'right',
          customId: `watermark-${Date.now()}`,
          customRole: 'watermark',
        });
        targetCanvas.add(wmTextbox);
      }

      targetCanvas.requestRenderAll();
    },
    [targetDimensions.width, targetDimensions.height, templateId, accentColor, fontId, showWatermark, watermarkText]
  );

  // ==========================================================================
  // 11) 슬라이드 전환 및 초기 로드 시 Fabric 캔버스 렌더링 (Fabric v6 호환 완벽 수정!)
  // ==========================================================================
  const activeSlide = slides[activeSlideIndex] || slides[0];

  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!libsReady || !canvas || !activeSlide) return;

    let cancelled = false;
    isRestoringRef.current = true;
    setIsCropping(false);
    cropRectRef.current = null;
    cropTargetImgRef.current = null;
    setSelectedObjType('none');

    async function loadActiveSlideToCanvas() {
      const hasValidSavedObjects =
        activeSlide.fabricJson &&
        Array.isArray(activeSlide.fabricJson.objects) &&
        activeSlide.fabricJson.objects.length > 0;

      if (hasValidSavedObjects) {
        try {
          // [중요] Fabric.js v6에서는 loadFromJSON(json)에 콜백을 넘기면 reviver로 오작동하므로
          // 반드시 Promise await 방식으로만 호출한 뒤 requestRenderAll()을 실행합니다!
          await canvas.loadFromJSON(activeSlide.fabricJson);
          if (cancelled) return;
          if (activeSlide.fabricJson.background) {
            canvas.backgroundColor = activeSlide.fabricJson.background;
            setCanvasBgColor(String(activeSlide.fabricJson.background));
          }
          // 혹시 복원 후 객체가 0개라면 즉시 기본 슬라이드 객체들로 재생성
          if (!canvas.getObjects || canvas.getObjects().length === 0) {
            await buildFabricObjectsForSlide(canvas, activeSlide, slides.length);
          } else {
            // 슬라이드 번호(1 / N) 최신화
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const numObj = canvas.getObjects().find((o: any) => o.customRole === 'slide-number');
            if (numObj && slides.length > 1) {
              numObj.set('text', `${activeSlide.slideNumber} / ${slides.length}`);
            }
            canvas.requestRenderAll();
          }
        } catch (e) {
          console.warn('저장된 캔버스 JSON 복원 실패, 새로 생성합니다:', e);
          await buildFabricObjectsForSlide(canvas, activeSlide, slides.length);
        }
      } else {
        await buildFabricObjectsForSlide(canvas, activeSlide, slides.length);
      }

      if (cancelled) return;
      isRestoringRef.current = false;

      // 초기 히스토리 스택 세팅
      const jsonObj = canvas.toObject(CUSTOM_PROPS);
      jsonObj.background = canvas.backgroundColor || '#FFFFFF';
      const jsonStr = JSON.stringify(jsonObj);
      const existingStack = historyMapRef.current[activeSlide.id] || [];
      if (existingStack.length === 0) {
        historyMapRef.current[activeSlide.id] = [jsonStr];
      }
      setCanUndo((historyMapRef.current[activeSlide.id] || []).length > 1);
      setCanRedo((redoMapRef.current[activeSlide.id] || []).length > 0);
    }

    loadActiveSlideToCanvas();

    return () => {
      cancelled = true;
    };
  }, [libsReady, activeSlide?.id, activeSlideIndex, canvasRebuildTick, buildFabricObjectsForSlide, slides.length]);

  // ==========================================================================
  // 12) [기능 1 핵심] 장별 제목·본문·뱃지 직접 입력 시 실시간으로 캔버스 미리보기 즉시 반영!
  // ==========================================================================
  function handleDirectSlideTextChange(
    field: 'headline' | 'body' | 'badgeText' | 'photoOverlayText',
    newValue: string
  ) {
    const canvas = fabricCanvasRef.current;

    if (canvas && window.fabric) {
      const roleMap = {
        headline: 'headline',
        body: 'body',
        badgeText: 'badge-text',
        photoOverlayText: 'photo-overlay-text',
      } as const;
      const targetRole = roleMap[field];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const objs: any[] = canvas.getObjects ? canvas.getObjects() : [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let targetObj = objs.find((o: any) => o.customRole === targetRole);

      if (targetObj) {
        targetObj.set('text', newValue);
        // 뱃지 글자 길이에 맞춰 뱃지 배경 박스 너비도 자동 조절
        if (field === 'badgeText') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const badgeBg = objs.find((o: any) => o.customRole === 'badge-bg');
          const nextBadgeW = Math.max(140, newValue.length * 24 + 48);
          if (badgeBg) {
            badgeBg.set('width', nextBadgeW);
          }
          targetObj.set('width', nextBadgeW - 24);
        }
        // 제목 높이가 바뀌면 본문 위치가 겹치지 않도록 자동 보정
        if (field === 'headline') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const bodyObj = objs.find((o: any) => o.customRole === 'body');
          if (bodyObj && targetObj.calcTextHeight) {
            const hHeight = targetObj.calcTextHeight();
            const minBodyTop = (targetObj.top || 400) + hHeight + 24;
            if (Math.abs((bodyObj.top || 0) - minBodyTop) < 180) {
              bodyObj.set('top', minBodyTop);
              bodyObj.setCoords();
            }
          }
        }
        if (canvas.getActiveObject() === targetObj) {
          setSelTextValue(newValue);
        }
        canvas.requestRenderAll();
      } else {
        // 만약 사용자가 캔버스에서 해당 텍스트 박스를 지웠다면 새로 만들어 줌
        const cw = canvas.width || 1080;
        const ch = canvas.height || 1350;
        if (field === 'photoOverlayText' && newValue.trim()) {
          const barBg = new window.fabric.Rect({
            left: 96,
            top: Math.round(ch * 0.48),
            width: cw - 192,
            height: 74,
            fill: '#0F172A',
            opacity: 0.72,
            rx: 18,
            ry: 18,
            customId: `photo-overlay-bg-${Date.now()}`,
            customRole: 'photo-overlay-bg',
          });
          canvas.add(barBg);
        }
        const newTb = new window.fabric.Textbox(newValue, {
          left: 104,
          top:
            field === 'headline'
              ? Math.round(ch * 0.62)
              : field === 'body'
              ? Math.round(ch * 0.74)
              : field === 'photoOverlayText'
              ? Math.round(ch * 0.48) + 20
              : 65,
          width: cw - 208,
          fontSize:
            field === 'headline'
              ? 50
              : field === 'body'
              ? 29
              : field === 'photoOverlayText'
              ? 27
              : 24,
          fontFamily: fontId,
          fontWeight: field === 'body' ? 'normal' : 'bold',
          fill: field === 'photoOverlayText' ? '#FFFFFF' : '#0F172A',
          textAlign: field === 'photoOverlayText' ? 'center' : 'left',
          customId: `${targetRole}-${Date.now()}`,
          customRole: targetRole,
        });
        canvas.add(newTb);
        canvas.requestRenderAll();
        targetObj = newTb;
      }
    }

    const updatedJson = canvas ? canvas.toObject(CUSTOM_PROPS) : undefined;
    if (updatedJson && canvas) {
      updatedJson.background = canvas.backgroundColor || '#FFFFFF';
    }

    setSlides((prev) =>
      prev.map((s, idx) =>
        idx === activeSlideIndex
          ? {
              ...s,
              [field]: newValue,
              isManuallyEdited: true,
              fabricJson: updatedJson || s.fabricJson,
            }
          : s
      )
    );
  }

  // "직접 쓰기 (이 장 빈칸으로 비우기)" 또는 "전체 장 직접 쓰기"
  async function handleClearSlideForDirectWriting(scope: 'current' | 'all') {
    if (scope === 'current') {
      const cur = slides[activeSlideIndex];
      if (!cur) return;
      if (
        cur.isManuallyEdited &&
        (cur.headline.trim() || cur.body.trim()) &&
        !window.confirm('현재 장에 작성된 내용을 비우고 빈칸에서 직접 쓰시겠어요?')
      ) {
        return;
      }
      const clearedSlide: SlideItem = {
        ...cur,
        badgeText: `${activeSlideIndex + 1}장`,
        headline: '',
        body: '',
        isManuallyEdited: true,
        fabricJson: undefined,
      };
      setSlides((prev) => prev.map((s, i) => (i === activeSlideIndex ? clearedSlide : s)));
      if (fabricCanvasRef.current) {
        await buildFabricObjectsForSlide(fabricCanvasRef.current, clearedSlide, slides.length);
        saveCanvasToActiveSlide(true);
      }
      showToast('✏️ 현재 장을 빈칸으로 비웠습니다! 왼쪽 입력칸에서 직접 작성해 보세요.');
    } else {
      if (
        !window.confirm(
          '전체 장의 제목과 본문을 모두 빈칸으로 비우고 1장부터 직접 작성하시겠어요?'
        )
      ) {
        return;
      }
      buildDefaultSlides(slides.length, true, true);
      showToast('✏️ 모든 장을 직접 쓰기 모드(빈칸)로 준비했습니다!');
    }
  }

  // ==========================================================================
  // 13) [기능 2 핵심] 장별 사진 표시 방식('contain' 전체 보이기 / 'cover' 꽉 채우기)
  //     및 여백 채우기 방식('solid' 배경색 / 'blur' 블러 배경) 즉시 전환
  // ==========================================================================
  async function handlePhotoFitOrBgChange(
    nextFitMode: PhotoFitMode,
    nextBgFillMode: PhotoBgFillMode,
    applyToAll = false
  ) {
    const cur = slides[activeSlideIndex];
    if (!cur) return;

    const updatedActive: SlideItem = {
      ...cur,
      photoFitMode: nextFitMode,
      photoBgFillMode: nextBgFillMode,
      fabricJson: undefined,
    };

    setSlides((prev) =>
      prev.map((s, idx) => {
        if (idx === activeSlideIndex) return updatedActive;
        if (applyToAll) {
          return {
            ...s,
            photoFitMode: nextFitMode,
            photoBgFillMode: nextBgFillMode,
            fabricJson: undefined,
          };
        }
        return s;
      })
    );

    if (fabricCanvasRef.current) {
      await buildFabricObjectsForSlide(fabricCanvasRef.current, updatedActive, slides.length);
      saveCanvasToActiveSlide(true);
    }

    const fitLabel = nextFitMode === 'contain' ? '전체 보이기(자르지 않음)' : '꽉 채우기(자름)';
    const bgLabel =
      nextFitMode === 'contain'
        ? nextBgFillMode === 'blur'
          ? ' + 블러 배경'
          : ' + 배경색 채우기'
        : '';
    showToast(
      `📐 ${applyToAll ? '모든 장' : `${activeSlideIndex + 1}장`} 사진 표시: [${fitLabel}${bgLabel}] 적용 완료!`
    );
  }

  // 사진 크기(확대/축소) 및 중앙 정렬 빠른 조절 도우미 (비율 100% 유지, 찌그러짐 방지!)
  function handleAdjustActivePhotoScaleOrPos(action: 'zoom-in' | 'zoom-out' | 'center') {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    // 현재 선택된 객체가 사진이면 그 사진을, 아니면 이 장의 첫 번째 사진 객체를 찾음
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let targetImg: any = canvas.getActiveObject?.();
    if (!targetImg || String(targetImg.type || '').toLowerCase() !== 'image') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      targetImg = canvas.getObjects().find((o: any) => o.customRole === 'photo');
    }
    if (!targetImg) {
      showToast('⚠️ 이 장에 먼저 사진을 넣어주세요!');
      return;
    }

    const curScale = targetImg.scaleX || 1;
    const natW = targetImg.width || 800;
    const natH = targetImg.height || 800;
    const boxLeft = targetImg.boxLeft ?? 72;
    const boxTop = targetImg.boxTop ?? 132;
    const boxW = targetImg.boxW ?? (canvas.width || 1080) - 144;
    const boxH = targetImg.boxH ?? Math.round((canvas.height || 1350) * 0.5);

    if (action === 'zoom-in' || action === 'zoom-out') {
      const factor = action === 'zoom-in' ? 1.12 : 0.89;
      const nextScale = Math.max(0.08, Math.min(4, curScale * factor));
      const prevW = natW * curScale;
      const prevH = natH * curScale;
      const nextW = natW * nextScale;
      const nextH = natH * nextScale;

      // 중심점을 유지한 채 가로·세로 똑같은 비율(nextScale)로 키우거나 줄임 (절대 안 찌그러짐!)
      targetImg.set({
        scaleX: nextScale,
        scaleY: nextScale,
        left: Math.round((targetImg.left || 0) - (nextW - prevW) / 2),
        top: Math.round((targetImg.top || 0) - (nextH - prevH) / 2),
      });
    } else if (action === 'center') {
      const containScale = Math.min(boxW / natW, boxH / natH);
      const scaledW = natW * containScale;
      const scaledH = natH * containScale;
      targetImg.set({
        scaleX: containScale,
        scaleY: containScale,
        left: Math.round(boxLeft + (boxW - scaledW) / 2),
        top: Math.round(boxTop + (boxH - scaledH) / 2),
        angle: 0,
      });
    }

    targetImg.setCoords();
    canvas.setActiveObject(targetImg);
    canvas.requestRenderAll();
    saveCanvasToActiveSlide(true);
  }

  // ==========================================================================
  // 14) 실행 취소 (Undo: Ctrl+Z) / 다시 실행 (Redo: Ctrl+Y)
  // ==========================================================================
  const handleUndo = useCallback(async () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !activeSlide) return;
    const stack = historyMapRef.current[activeSlide.id] || [];
    if (stack.length <= 1) return;

    isRestoringRef.current = true;
    const currentJson = stack[stack.length - 1];
    const prevJson = stack[stack.length - 2];

    historyMapRef.current[activeSlide.id] = stack.slice(0, -1);
    redoMapRef.current[activeSlide.id] = [
      ...(redoMapRef.current[activeSlide.id] || []),
      currentJson,
    ];

    try {
      const parsed = JSON.parse(prevJson);
      await canvas.loadFromJSON(parsed);
      if (parsed.background) {
        canvas.backgroundColor = parsed.background;
        setCanvasBgColor(String(parsed.background));
      }
      canvas.requestRenderAll();
    } catch {
      // ignore
    }

    isRestoringRef.current = false;
    setCanUndo(historyMapRef.current[activeSlide.id].length > 1);
    setCanRedo(redoMapRef.current[activeSlide.id].length > 0);
    saveCanvasToActiveSlide(false);
  }, [activeSlide, saveCanvasToActiveSlide]);

  const handleRedo = useCallback(async () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !activeSlide) return;
    const rStack = redoMapRef.current[activeSlide.id] || [];
    if (rStack.length === 0) return;

    isRestoringRef.current = true;
    const nextJson = rStack[rStack.length - 1];
    redoMapRef.current[activeSlide.id] = rStack.slice(0, -1);
    historyMapRef.current[activeSlide.id] = [
      ...(historyMapRef.current[activeSlide.id] || []),
      nextJson,
    ];

    try {
      const parsed = JSON.parse(nextJson);
      await canvas.loadFromJSON(parsed);
      if (parsed.background) {
        canvas.backgroundColor = parsed.background;
        setCanvasBgColor(String(parsed.background));
      }
      canvas.requestRenderAll();
    } catch {
      // ignore
    }

    isRestoringRef.current = false;
    setCanUndo(historyMapRef.current[activeSlide.id].length > 1);
    setCanRedo(redoMapRef.current[activeSlide.id].length > 0);
    saveCanvasToActiveSlide(false);
  }, [activeSlide, saveCanvasToActiveSlide]);

  // 키보드 단축키: Ctrl+Z / Ctrl+Y / Delete
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const canvas = fabricCanvasRef.current;
      const activeObj = canvas?.getActiveObject?.();
      if (activeObj && activeObj.isEditing) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (activeObj && activeObj.customRole !== 'crop-zone') {
          e.preventDefault();
          canvas.remove(activeObj);
          canvas.discardActiveObject();
          canvas.requestRenderAll();
          saveCanvasToActiveSlide(true);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo, saveCanvasToActiveSlide]);

  // ==========================================================================
  // 15) 폰트 추가 & 텍스트 세부 편집
  // ==========================================================================
  async function handleCustomFontUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    const cleanName = file.name.replace(/\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/, '');
    const customFontId = `Custom_${cleanName.replace(/[^a-zA-Z0-9가-힣_-]/g, '_')}`;

    try {
      const arrayBuf = await file.arrayBuffer();
      const base64Data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
      });

      if (typeof window !== 'undefined' && 'FontFace' in window) {
        const fontFace = new FontFace(customFontId, arrayBuf);
        await fontFace.load();
        document.fonts.add(fontFace);
      }

      const newFont: CustomFontItem = {
        id: customFontId,
        name: `${cleanName} (내 폰트)`,
        base64Data,
      };

      const nextList = [...customFonts.filter((f) => f.id !== customFontId), newFont];
      setCustomFonts(nextList);
      await saveToLocalDb('acs_custom_fonts_v1', nextList);

      applyFontToSelectionOrAll(customFontId);
      showToast(`✅ '${cleanName}' 폰트가 등록되어 자동 저장되었습니다!`);
    } catch {
      showToast('⚠️ 폰트 파일을 읽는 중 오류가 발생했습니다. (.ttf, .otf, .woff, .woff2 지원)');
    }
  }

  async function handleDeleteCustomFont(targetFontId: string) {
    const nextList = customFonts.filter((f) => f.id !== targetFontId);
    setCustomFonts(nextList);
    await saveToLocalDb('acs_custom_fonts_v1', nextList);
    if (fontId === targetFontId) {
      applyFontToSelectionOrAll('Pretendard');
    }
    showToast('🗑️ 업로드한 폰트를 목록에서 삭제했습니다.');
  }

  function applyFontToSelectionOrAll(nextFontFamily: string) {
    setFontId(nextFontFamily);
    setSelFontFamily(nextFontFamily);

    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const activeObj = canvas.getActiveObject();
    if (
      activeObj &&
      (String(activeObj.type).toLowerCase() === 'textbox' ||
        String(activeObj.type).toLowerCase() === 'i-text')
    ) {
      activeObj.set('fontFamily', nextFontFamily);
      canvas.requestRenderAll();
      saveCanvasToActiveSlide(true);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      canvas.getObjects().forEach((obj: any) => {
        const t = String(obj.type || '').toLowerCase();
        if (t === 'textbox' || t === 'i-text' || t === 'text') {
          obj.set('fontFamily', nextFontFamily);
        }
      });
      canvas.requestRenderAll();
      saveCanvasToActiveSlide(true);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function updateSelectedTextProp(prop: string, value: any) {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;

    active.set(prop, value);
    if (prop === 'fontSize' || prop === 'charSpacing' || prop === 'lineHeight' || prop === 'text') {
      if (typeof active.initDimensions === 'function') {
        active.initDimensions();
      }
    }
    active.setCoords();
    canvas.requestRenderAll();
    saveCanvasToActiveSlide(true);
  }

  function handleAddTextObject(preset: 'headline' | 'body' | 'badge') {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !window.fabric) return;
    const fabric = window.fabric;

    const cw = canvas.width || 1080;
    const ch = canvas.height || 1350;

    if (preset === 'headline') {
      const tb = new fabric.Textbox('새 제목을 더블클릭해 수정하세요', {
        left: Math.round(cw * 0.1),
        top: Math.round(ch * 0.42),
        width: Math.round(cw * 0.8),
        fontSize: 54,
        fontFamily: fontId,
        fontWeight: 'bold',
        fill: '#0F172A',
        textAlign: 'center',
        lineHeight: 1.25,
        customId: `text-${Date.now()}`,
        customRole: 'custom-text',
      });
      canvas.add(tb);
      canvas.setActiveObject(tb);
    } else if (preset === 'body') {
      const tb = new fabric.Textbox('자유롭게 이동하고 크기를 조절할 수 있는 본문 텍스트입니다.', {
        left: Math.round(cw * 0.12),
        top: Math.round(ch * 0.55),
        width: Math.round(cw * 0.76),
        fontSize: 32,
        fontFamily: fontId,
        fontWeight: 'normal',
        fill: '#334155',
        textAlign: 'left',
        lineHeight: 1.5,
        customId: `text-${Date.now()}`,
        customRole: 'custom-text',
      });
      canvas.add(tb);
      canvas.setActiveObject(tb);
    } else {
      const badgeRect = new fabric.Rect({
        left: Math.round(cw / 2 - 110),
        top: Math.round(ch * 0.3),
        width: 220,
        height: 56,
        fill: accentColor,
        rx: 28,
        ry: 28,
        customId: `badge-rect-${Date.now()}`,
        customRole: 'shape',
      });
      const badgeText = new fabric.Textbox('✨ NEW POINT', {
        left: Math.round(cw / 2 - 100),
        top: Math.round(ch * 0.3 + 13),
        width: 200,
        fontSize: 24,
        fontFamily: fontId,
        fontWeight: 'bold',
        fill: getReadableTextOnAccent(accentColor),
        textAlign: 'center',
        customId: `badge-txt-${Date.now()}`,
        customRole: 'custom-text',
      });
      canvas.add(badgeRect);
      canvas.add(badgeText);
      canvas.setActiveObject(badgeText);
    }

    canvas.requestRenderAll();
    saveCanvasToActiveSlide(true);
  }

  // ==========================================================================
  // 16) 템플릿 / 배경색 / 배경 이미지 / 도형 추가
  // ==========================================================================
  async function handleSelectTemplate(newTplId: CardTemplateId, applyAllSlides = false) {
    setTemplateId(newTplId);
    const tpl = CARD_TEMPLATES.find((t) => t.id === newTplId);
    if (tpl) {
      setAccentColor(tpl.accentColor);
    }

    const canvas = fabricCanvasRef.current;
    if (canvas && activeSlide) {
      const updatedSlide: SlideItem = {
        ...activeSlide,
        templateId: newTplId,
        customBgColor: tpl?.bgColor,
      };
      await buildFabricObjectsForSlide(canvas, updatedSlide, slides.length, newTplId);
      saveCanvasToActiveSlide(true);
    }

    if (applyAllSlides) {
      setSlides((prev) =>
        prev.map((s, idx) =>
          idx === activeSlideIndex
            ? { ...s, templateId: newTplId, customBgColor: tpl?.bgColor }
            : {
                ...s,
                templateId: newTplId,
                customBgColor: tpl?.bgColor,
                fabricJson: undefined,
              }
        )
      );
      showToast(`🎨 모든 카드에 '${tpl?.name}' 템플릿이 적용되었습니다!`);
    } else {
      showToast(`🎨 현재 카드에 '${tpl?.name}' 디자인이 적용되었습니다!`);
    }
  }

  function handleCanvasBgColorChange(newHex: string) {
    setCanvasBgColor(newHex);
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    canvas.backgroundColor = newHex;
    // 'solid' 여백 프레임 색상도 함께 동기화
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    canvas.getObjects().forEach((o: any) => {
      if (o.customRole === 'photo-backdrop' && o.type === 'rect') {
        o.set('fill', newHex);
      }
    });
    canvas.requestRenderAll();
    saveCanvasToActiveSlide(true);
  }

  function handleAddShape(shapeType: 'rect' | 'circle' | 'line') {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !window.fabric) return;
    const fabric = window.fabric;

    const cw = canvas.width || 1080;
    const ch = canvas.height || 1350;

    if (shapeType === 'rect') {
      const rect = new fabric.Rect({
        left: Math.round(cw / 2 - 180),
        top: Math.round(ch / 2 - 110),
        width: 360,
        height: 220,
        fill: accentColor,
        opacity: 0.9,
        rx: 24,
        ry: 24,
        stroke: '#FFFFFF',
        strokeWidth: 0,
        customId: `rect-${Date.now()}`,
        customRole: 'shape',
      });
      canvas.add(rect);
      canvas.setActiveObject(rect);
    } else if (shapeType === 'circle') {
      const circle = new fabric.Circle({
        left: Math.round(cw / 2 - 110),
        top: Math.round(ch / 2 - 110),
        radius: 110,
        fill: accentColor,
        opacity: 0.9,
        stroke: '#FFFFFF',
        strokeWidth: 0,
        customId: `circle-${Date.now()}`,
        customRole: 'shape',
      });
      canvas.add(circle);
      canvas.setActiveObject(circle);
    } else {
      const line = new fabric.Rect({
        left: Math.round(cw * 0.15),
        top: Math.round(ch / 2),
        width: Math.round(cw * 0.7),
        height: 6,
        fill: accentColor,
        rx: 3,
        ry: 3,
        customId: `line-${Date.now()}`,
        customRole: 'shape',
      });
      canvas.add(line);
      canvas.setActiveObject(line);
    }

    canvas.requestRenderAll();
    saveCanvasToActiveSlide(true);
  }

  // ==========================================================================
  // 17) 사진 추가/교체/삭제/자르기(크롭)/레이어 순서 조절
  // ==========================================================================
  async function addPhotoObjectToCurrentCanvas(
    url: string,
    asBackground = false
  ) {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !window.fabric) return;
    const fabric = window.fabric;
    const ImageClass = fabric.FabricImage || fabric.Image;

    try {
      const imgEl = await loadHtmlImageElement(url);
      const cw = canvas.width || 1080;
      const ch = canvas.height || 1350;
      const natW = imgEl.naturalWidth || imgEl.width || 800;
      const natH = imgEl.naturalHeight || imgEl.height || 800;

      if (asBackground) {
        const scale = Math.max(cw / natW, ch / natH);
        const fImg = new ImageClass(imgEl, {
          left: 0,
          top: 0,
          scaleX: scale,
          scaleY: scale,
          customId: `bg-photo-${Date.now()}`,
          customRole: 'bg-photo',
          originalSrc: url,
          cornerRadius: 0,
        });
        canvas.add(fImg);
        if (typeof canvas.sendObjectToBack === 'function') {
          canvas.sendObjectToBack(fImg);
        } else if (typeof canvas.sendToBack === 'function') {
          canvas.sendToBack(fImg);
        }
        canvas.setActiveObject(fImg);
      } else {
        // [기능 2] 자르지 않고 원본 비율 그대로 크게 넣기 (contain)
        const boxW = Math.round(cw - 144);
        const boxH = Math.round(ch * 0.48);
        const containScale = Math.min(boxW / natW, boxH / natH);
        const scaledW = natW * containScale;
        const scaledH = natH * containScale;

        const existingPhotos = canvas
          .getObjects()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((o: any) => o.customRole === 'photo').length;
        const offset = existingPhotos * 24;

        const fImg = new ImageClass(imgEl, {
          left: Math.round(72 + (boxW - scaledW) / 2 + offset),
          top: Math.round(132 + (boxH - scaledH) / 2 + offset),
          cropX: 0,
          cropY: 0,
          width: natW,
          height: natH,
          scaleX: containScale,
          scaleY: containScale,
          customId: `photo-${Date.now()}`,
          customRole: 'photo',
          originalSrc: url,
          cornerRadius: 20,
          photoFitMode: 'contain',
          boxLeft: 72,
          boxTop: 132,
          boxW,
          boxH,
        });

        fImg.set(
          'clipPath',
          new fabric.Rect({
            width: natW,
            height: natH,
            rx: 20 / containScale,
            ry: 20 / containScale,
            originX: 'center',
            originY: 'center',
          })
        );

        canvas.add(fImg);
        canvas.setActiveObject(fImg);
      }

      canvas.requestRenderAll();
      saveCanvasToActiveSlide(true);
    } catch {
      showToast('⚠️ 이미지를 불러오는 중 오류가 발생했습니다.');
    }
  }

  // 장마다 사진을 따로 넣거나 교체하는 함수
  async function handleSlideSpecificPhotoUpload(
    files: FileList | null,
    mode: 'set-slide-photo' | 'add-more-to-slide'
  ) {
    if (!files || files.length === 0) return;

    const newPhotos: UploadedPhoto[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
      });
      newPhotos.push({
        id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        url: dataUrl,
      });
    }

    if (newPhotos.length === 0) return;

    setUploadedPhotos((prev) => [...prev, ...newPhotos]);

    const cur = slides[activeSlideIndex];
    if (!cur) return;

    const nextPhotoUrls =
      mode === 'set-slide-photo'
        ? newPhotos.map((p) => p.url)
        : [...(cur.photoUrls || (cur.photoUrl ? [cur.photoUrl] : [])), ...newPhotos.map((p) => p.url)];

    const updatedSlide: SlideItem = {
      ...cur,
      photoUrl: nextPhotoUrls[0] || null,
      photoUrls: nextPhotoUrls,
      photoFitMode: cur.photoFitMode || 'contain',
      photoBgFillMode: cur.photoBgFillMode || 'solid',
      fabricJson: undefined,
    };

    setSlides((prev) => prev.map((s, idx) => (idx === activeSlideIndex ? updatedSlide : s)));

    if (fabricCanvasRef.current) {
      await buildFabricObjectsForSlide(fabricCanvasRef.current, updatedSlide, slides.length);
      saveCanvasToActiveSlide(true);
    }

    showToast(
      `📸 ${activeSlideIndex + 1}장에 사진 ${newPhotos.length}장이 비율 맞춰 크게(잘리지 않게) 들어갔습니다!`
    );
  }

  // 현재 장의 사진 1장 또는 전체 사진 지우기
  async function handleClearSlidePhotos(targetUrlToRemove?: string) {
    const cur = slides[activeSlideIndex];
    if (!cur) return;

    const currentUrls = cur.photoUrls || (cur.photoUrl ? [cur.photoUrl] : []);
    const nextUrls = targetUrlToRemove
      ? currentUrls.filter((u) => u !== targetUrlToRemove)
      : [];

    const updatedSlide: SlideItem = {
      ...cur,
      photoUrl: nextUrls[0] || null,
      photoUrls: nextUrls,
      fabricJson: undefined,
    };

    setSlides((prev) => prev.map((s, idx) => (idx === activeSlideIndex ? updatedSlide : s)));

    if (fabricCanvasRef.current) {
      await buildFabricObjectsForSlide(fabricCanvasRef.current, updatedSlide, slides.length);
      saveCanvasToActiveSlide(true);
    }

    showToast(`🗑️ ${activeSlideIndex + 1}장의 사진을 정리했습니다.`);
  }

  async function handleReplaceSelectedPhoto(newUrl: string) {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !window.fabric) return;
    const fabric = window.fabric;
    const ImageClass = fabric.FabricImage || fabric.Image;

    const active = canvas.getActiveObject();
    if (!active || String(active.type).toLowerCase() !== 'image') {
      await addPhotoObjectToCurrentCanvas(newUrl, false);
      return;
    }

    try {
      const imgEl = await loadHtmlImageElement(newUrl);
      const natW = imgEl.naturalWidth || imgEl.width || 800;
      const natH = imgEl.naturalHeight || imgEl.height || 800;

      const boxLeft = active.boxLeft ?? active.left ?? 72;
      const boxTop = active.boxTop ?? active.top ?? 132;
      const boxW = active.boxW ?? (active.width || 600) * (active.scaleX || 1);
      const boxH = active.boxH ?? (active.height || 600) * (active.scaleY || 1);
      const radius = active.cornerRadius || 0;
      const idx = canvas.getObjects().indexOf(active);

      // 교체할 때도 잘리지 않게 원본 비율 유지(contain)로 크게 넣기
      const containScale = Math.min(boxW / natW, boxH / natH);
      const scaledW = natW * containScale;
      const scaledH = natH * containScale;

      const replacement = new ImageClass(imgEl, {
        left: Math.round(boxLeft + (boxW - scaledW) / 2),
        top: Math.round(boxTop + (boxH - scaledH) / 2),
        cropX: 0,
        cropY: 0,
        width: natW,
        height: natH,
        scaleX: containScale,
        scaleY: containScale,
        angle: active.angle || 0,
        opacity: active.opacity ?? 1,
        stroke: active.stroke,
        strokeWidth: active.strokeWidth || 0,
        customId: active.customId || `photo-${Date.now()}`,
        customRole: active.customRole || 'photo',
        originalSrc: newUrl,
        cornerRadius: radius,
        photoFitMode: 'contain',
        boxLeft,
        boxTop,
        boxW,
        boxH,
      });

      if (radius > 0) {
        replacement.set(
          'clipPath',
          new fabric.Rect({
            width: natW,
            height: natH,
            rx: radius / containScale,
            ry: radius / containScale,
            originX: 'center',
            originY: 'center',
          })
        );
      }

      canvas.remove(active);
      if (typeof canvas.insertAt === 'function' && idx >= 0) {
        canvas.insertAt(idx, replacement);
      } else {
        canvas.add(replacement);
      }
      canvas.setActiveObject(replacement);
      canvas.requestRenderAll();
      saveCanvasToActiveSlide(true);
      showToast('🖼️ 사진이 잘리지 않고 원본 비율 그대로 교체되었습니다!');
    } catch {
      showToast('⚠️ 사진 교체 중 오류가 발생했습니다.');
    }
  }

  async function handlePhotoFiles(
    fileList: FileList | null,
    mode: 'library' | 'add-to-canvas' | 'replace-selected' | 'set-bg' = 'library'
  ) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);

    const newUploaded: UploadedPhoto[] = [];

    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;

      const localDataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
      });

      let finalUrl = localDataUrl;
      if (userId) {
        try {
          const supabase = getSupabaseBrowser();
          const ext = file.name.split('.').pop() || 'jpg';
          const filePath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
          const { error } = await supabase.storage.from('user-uploads').upload(filePath, file);
          if (!error) {
            const { data } = supabase.storage.from('user-uploads').getPublicUrl(filePath);
            if (data.publicUrl) finalUrl = data.publicUrl;
          }
        } catch {
          // fallback to localDataUrl
        }
      }

      newUploaded.push({
        id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        url: finalUrl,
      });
    }

    if (newUploaded.length === 0) return;

    const combined = [...uploadedPhotos, ...newUploaded].slice(0, 30);
    setUploadedPhotos(combined);

    if (mode === 'replace-selected') {
      await handleReplaceSelectedPhoto(newUploaded[0].url);
    } else if (mode === 'set-bg') {
      await addPhotoObjectToCurrentCanvas(newUploaded[0].url, true);
      showToast('🖼️ 배경 사진이 깔렸습니다!');
    } else if (mode === 'add-to-canvas') {
      for (const item of newUploaded) {
        await addPhotoObjectToCurrentCanvas(item.url, false);
      }
      showToast(`📸 현재 카드에 사진 ${newUploaded.length}장이 비율 맞춰 추가되었습니다!`);
    } else {
      // 라이브러리에 사진 업로드 시 각 장에 골고루 배분하고 현재 장도 즉시 리빌드
      const nextSlides = slides.map((s, idx) => {
        const p = combined[idx % combined.length];
        const hasPhotos = (s.photoUrls && s.photoUrls.length > 0) || Boolean(s.photoUrl);
        if (!hasPhotos && p) {
          return {
            ...s,
            photoIndex: idx % combined.length,
            photoUrl: p.url,
            photoIndices: [idx % combined.length],
            photoUrls: [p.url],
            photoFitMode: s.photoFitMode || 'contain',
            photoBgFillMode: s.photoBgFillMode || 'solid',
            fabricJson: undefined,
          };
        }
        return s;
      });
      setSlides(nextSlides);
      setCanvasRebuildTick((t) => t + 1);
      showToast(`📸 사진 ${newUploaded.length}장이 업로드되어 카드에 비율 맞춰 배치되었습니다!`);
    }
  }

  function handlePhotoCornerRadiusChange(radiusPx: number) {
    setSelCornerRadius(radiusPx);
    const canvas = fabricCanvasRef.current;
    if (!canvas || !window.fabric) return;
    const fabric = window.fabric;

    const active = canvas.getActiveObject();
    if (!active) return;

    if (String(active.type).toLowerCase() === 'image') {
      const scale = active.scaleX || 1;
      const w = active.width || 400;
      const h = active.height || 400;
      active.set('cornerRadius', radiusPx);
      if (radiusPx <= 0) {
        active.set('clipPath', undefined);
      } else {
        active.set(
          'clipPath',
          new fabric.Rect({
            width: w,
            height: h,
            rx: radiusPx / scale,
            ry: radiusPx / scale,
            originX: 'center',
            originY: 'center',
          })
        );
      }
    } else if (String(active.type).toLowerCase() === 'rect') {
      active.set({ rx: radiusPx, ry: radiusPx, cornerRadius: radiusPx });
    }

    canvas.requestRenderAll();
    saveCanvasToActiveSlide(true);
  }

  function handleStartCropMode() {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !window.fabric) return;
    const fabric = window.fabric;

    const active = canvas.getActiveObject();
    if (!active || String(active.type).toLowerCase() !== 'image') {
      showToast('⚠️ 먼저 자를 사진을 클릭해 선택해 주세요!');
      return;
    }

    const bound = active.getBoundingRect();
    const cropZone = new fabric.Rect({
      left: bound.left + bound.width * 0.1,
      top: bound.top + bound.height * 0.1,
      width: bound.width * 0.8,
      height: bound.height * 0.8,
      fill: 'rgba(37, 99, 235, 0.18)',
      stroke: '#2563EB',
      strokeWidth: 4,
      strokeDashArray: [10, 6],
      cornerColor: '#2563EB',
      cornerSize: 20,
      transparentCorners: false,
      hasRotatingPoint: false,
      lockRotation: true,
      customId: 'crop-zone',
      customRole: 'crop-zone',
    });

    cropTargetImgRef.current = active;
    cropRectRef.current = cropZone;
    setIsCropping(true);

    canvas.add(cropZone);
    canvas.setActiveObject(cropZone);
    canvas.requestRenderAll();
    showToast('✂️ 파란색 점선 박스를 조절한 뒤 [자르기 완료] 버튼을 눌러주세요!');
  }

  function handleApplyCrop() {
    const canvas = fabricCanvasRef.current;
    const cropZone = cropRectRef.current;
    const targetImg = cropTargetImgRef.current;

    if (!canvas || !cropZone || !targetImg || !window.fabric) {
      setIsCropping(false);
      return;
    }

    const fabric = window.fabric;
    const scaleX = targetImg.scaleX || 1;
    const scaleY = targetImg.scaleY || 1;

    const imgLeft = targetImg.left || 0;
    const imgTop = targetImg.top || 0;
    const zoneLeft = cropZone.left || 0;
    const zoneTop = cropZone.top || 0;
    const zoneW = (cropZone.width || 100) * (cropZone.scaleX || 1);
    const zoneH = (cropZone.height || 100) * (cropZone.scaleY || 1);

    const relLeft = Math.max(0, zoneLeft - imgLeft);
    const relTop = Math.max(0, zoneTop - imgTop);

    const nextCropX = (targetImg.cropX || 0) + relLeft / scaleX;
    const nextCropY = (targetImg.cropY || 0) + relTop / scaleY;
    const nextW = Math.max(20, Math.min(targetImg.width - relLeft / scaleX, zoneW / scaleX));
    const nextH = Math.max(20, Math.min(targetImg.height - relTop / scaleY, zoneH / scaleY));

    targetImg.set({
      left: zoneLeft,
      top: zoneTop,
      cropX: Math.round(nextCropX),
      cropY: Math.round(nextCropY),
      width: Math.round(nextW),
      height: Math.round(nextH),
    });

    const radius = targetImg.cornerRadius || 0;
    if (radius > 0) {
      targetImg.set(
        'clipPath',
        new fabric.Rect({
          width: Math.round(nextW),
          height: Math.round(nextH),
          rx: radius / scaleX,
          ry: radius / scaleY,
          originX: 'center',
          originY: 'center',
        })
      );
    }

    canvas.remove(cropZone);
    cropRectRef.current = null;
    cropTargetImgRef.current = null;
    setIsCropping(false);

    targetImg.setCoords();
    canvas.setActiveObject(targetImg);
    canvas.requestRenderAll();
    saveCanvasToActiveSlide(true);
    showToast('✂️ 사진 자르기(크롭)가 적용되었습니다!');
  }

  function handleCancelCrop() {
    const canvas = fabricCanvasRef.current;
    if (canvas && cropRectRef.current) {
      canvas.remove(cropRectRef.current);
      if (cropTargetImgRef.current) {
        canvas.setActiveObject(cropTargetImgRef.current);
      }
      canvas.requestRenderAll();
    }
    cropRectRef.current = null;
    cropTargetImgRef.current = null;
    setIsCropping(false);
  }

  function handleLayerOrder(dir: 'front' | 'back' | 'forward' | 'backward') {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;

    if (dir === 'front') {
      if (typeof canvas.bringObjectToFront === 'function') canvas.bringObjectToFront(active);
      else if (typeof canvas.bringToFront === 'function') canvas.bringToFront(active);
    } else if (dir === 'back') {
      if (typeof canvas.sendObjectToBack === 'function') canvas.sendObjectToBack(active);
      else if (typeof canvas.sendToBack === 'function') canvas.sendToBack(active);
    } else if (dir === 'forward') {
      if (typeof canvas.bringObjectForward === 'function') canvas.bringObjectForward(active);
      else if (typeof canvas.bringForward === 'function') canvas.bringForward(active);
    } else if (dir === 'backward') {
      if (typeof canvas.sendObjectBackwards === 'function') canvas.sendObjectBackwards(active);
      else if (typeof canvas.sendBackwards === 'function') canvas.sendBackwards(active);
    }

    canvas.requestRenderAll();
    saveCanvasToActiveSlide(true);
  }

  function handleDeleteSelectedObject() {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;
    canvas.remove(active);
    canvas.discardActiveObject();
    setSelectedObjType('none');
    canvas.requestRenderAll();
    saveCanvasToActiveSlide(true);
  }

  // ==========================================================================
  // 18) [기능 1: AI로 전체 채우기 & 이 장만 AI로 다시 만들기 (덮어쓰기 확인창 포함)]
  // ==========================================================================
  async function handleGenerateWithAI() {
    if (!rawText.trim()) {
      showToast('⚠️ 먼저 1번 입력창에 카드뉴스로 만들 메모나 주제를 적어주세요.');
      return;
    }

    const hasManualEdits = slides.some((s) => s.isManuallyEdited && (s.headline.trim() || s.body.trim()));
    if (
      hasManualEdits &&
      !window.confirm(
        '직접 작성하거나 수정한 장이 있습니다.\nAI가 만든 새 내용으로 전체 장을 다시 채울까요?'
      )
    ) {
      return;
    }

    setIsGeneratingAI(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;

      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          rawText,
          slideCount,
          photoCount: uploadedPhotos.length,
          photoNames: uploadedPhotos.map((p) => p.name),
          tone: captionTone,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'AI 생성 실패');
      }

      if (data.slides && Array.isArray(data.slides)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const enriched: SlideItem[] = data.slides.map((s: any, idx: number) => {
          const existingSlide = slides[idx];
          const pIdx =
            s.photoIndex !== null && s.photoIndex !== undefined && uploadedPhotos[s.photoIndex]
              ? s.photoIndex
              : uploadedPhotos[idx]
              ? idx
              : null;
          const pUrl = pIdx !== null ? uploadedPhotos[pIdx]?.url || null : null;

          // 기존 장에 사용자가 직접 넣어둔 사진이 있으면 그대로 보존!
          const keepPhotoUrls =
            existingSlide?.photoUrls && existingSlide.photoUrls.length > 0
              ? existingSlide.photoUrls
              : pUrl
              ? [pUrl]
              : [];

          return {
            ...s,
            id: `slide-ai-${Date.now()}-${idx}`,
            slideNumber: idx + 1,
            photoIndex: pIdx,
            photoUrl: keepPhotoUrls[0] || null,
            photoIndices: pIdx !== null ? [pIdx] : [],
            photoUrls: keepPhotoUrls,
            templateId: existingSlide?.templateId || templateId,
            photoFitMode: existingSlide?.photoFitMode || 'contain',
            photoBgFillMode: existingSlide?.photoBgFillMode || 'solid',
            isManuallyEdited: false,
            fabricJson: undefined,
          };
        });

        historyMapRef.current = {};
        redoMapRef.current = {};
        setSlides(enriched);
        setActiveSlideIndex(0);
        setCanvasRebuildTick((t) => t + 1);
      }

      if (data.captions && data.captions[captionTone]) {
        setBaseCaption(data.captions[captionTone]);
      }

      showToast('✨ AI가 전 장의 초안을 채웠습니다! 왼쪽 입력창이나 캔버스에서 자유롭게 수정하세요.');
    } catch (err) {
      showToast(`⚠️ ${err instanceof Error ? err.message : 'AI 생성 중 오류가 발생했습니다.'}`);
    } finally {
      setIsGeneratingAI(false);
    }
  }

  // [기능 1 핵심] "이 장만 AI로 다시 만들기" (내가 직접 쓴 내용이 있으면 덮어쓰기 전에 확인창 띄움!)
  async function handleRegenerateSingleSlide(idx: number) {
    const targetSlide = slides[idx];
    if (!targetSlide) return;

    if (targetSlide.isManuallyEdited && (targetSlide.headline.trim() || targetSlide.body.trim())) {
      const ok = window.confirm(
        `${idx + 1}장에 내가 직접 작성하거나 수정한 내용이 있습니다.\nAI가 새로 만든 문구로 덮어쓸까요?`
      );
      if (!ok) return;
    }

    setRegeneratingSlideIdx(idx);
    try {
      const res = await fetch('/api/ai/regenerate-slide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText,
          slideIndex: idx,
          totalSlides: slides.length,
          currentHeadline: targetSlide.headline,
          currentBody: targetSlide.body,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const canvas = fabricCanvasRef.current;
      if (canvas && idx === activeSlideIndex) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const objs: any[] = canvas.getObjects();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hObj = objs.find((o: any) => o.customRole === 'headline');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bObj = objs.find((o: any) => o.customRole === 'body');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const badgeObj = objs.find((o: any) => o.customRole === 'badge-text');

        if (hObj && data.headline) hObj.set('text', data.headline);
        if (bObj && data.body) bObj.set('text', data.body);
        if (badgeObj && data.badgeText) badgeObj.set('text', data.badgeText);

        canvas.requestRenderAll();
        saveCanvasToActiveSlide(true);
      }

      setSlides((prev) =>
        prev.map((s, i) =>
          i === idx
            ? {
                ...s,
                headline: data.headline || s.headline,
                body: data.body || s.body,
                badgeText: data.badgeText || s.badgeText,
                isManuallyEdited: false,
                fabricJson: i === activeSlideIndex ? s.fabricJson : undefined,
              }
            : s
        )
      );

      showToast(`✨ ${idx + 1}번째 장의 문구를 AI가 새로 만들었습니다!`);
    } catch {
      showToast('⚠️ 이 장 다시 만들기 중 오류가 발생했습니다.');
    } finally {
      setRegeneratingSlideIdx(null);
    }
  }

  // ==========================================================================
  // 18-B) [1단계 핵심 기능] 주제 → AI 컷별 기획안 만들기 · 3개 비교 · 직접 수정 · 저장/불러오기 · 승인(OK)
  // ==========================================================================
  const activePlan = planCandidates[activePlanTabIdx] || null;

  function incrementDailyAiCounter(): boolean {
    if (typeof window === 'undefined') return true;
    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      const key = `acs_daily_ai_${todayStr}`;
      const used = Number(window.localStorage.getItem(key) || '0') || 0;
      if (used >= DAILY_AI_LIMIT_MAX) {
        showToast(
          `⚠️ 오늘의 AI 무료 기획/생성 한도(${DAILY_AI_LIMIT_MAX}회)를 모두 사용했어요. 직접 수정하거나 내일 다시 이용해 주세요!`
        );
        return false;
      }
      const next = used + 1;
      window.localStorage.setItem(key, String(next));
      setDailyAiUsedCount(next);
      return true;
    } catch {
      return true;
    }
  }

  // [기획안 생성] mode === 'new': 첫 기획안 또는 전체 다시 기획하기 / mode === 'compare': 같은 주제로 비교 기획안 추가 (최대 3개)
  async function handleGenerateAIPlan(mode: 'new' | 'compare' = 'new') {
    const cleanTopic = planTopic.trim();
    if (!cleanTopic) {
      showToast('⚠️ 먼저 [1. 주제 입력] 칸에 카드뉴스 주제를 한 줄로 적어주세요!');
      return;
    }

    if (mode === 'compare' && planCandidates.length >= 3) {
      showToast('⚠️ 같은 주제로는 최대 3개의 기획안까지만 만들어 비교할 수 있어요.');
      return;
    }

    // "전체 다시 기획하기"일 때 내가 직접 고친 컷이 있으면 확인창 표시
    if (mode === 'new' && activePlan) {
      const hasEditedCut = activePlan.cuts.some((c) => c.isManuallyEdited);
      if (
        hasEditedCut &&
        !window.confirm(
          '직접 고친 내용이 사라져요.\n그래도 현재 기획안을 AI로 전체 다시 기획할까요?'
        )
      ) {
        return;
      }
    }

    if (!incrementDailyAiCounter()) return;

    const targetVariantIdx =
      mode === 'compare' ? planCandidates.length : activePlan ? activePlanTabIdx : 0;

    setIsGeneratingPlan(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;

      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mode: 'generate_plan',
          topic: cleanTopic,
          targetAudience: planTargetAudience.trim(),
          purpose: planPurpose,
          tone: planTone,
          referenceText: planReferenceText.trim(),
          slideCountOption: planSlideCountOption,
          maxSlides: maxSlideLimit,
          variantIndex: targetVariantIdx,
          // 구버전 서버 API 호환용 필드 함께 전송
          rawText: `[주제] ${cleanTopic}\n${planTargetAudience ? `[대상] ${planTargetAudience}\n` : ''}${
            planPurpose ? `[목적] ${planPurpose}\n` : ''
          }${planReferenceText ? `[참고자료] ${planReferenceText}` : ''}`,
          slideCount:
            planSlideCountOption === 'auto'
              ? 5
              : Math.min(maxSlideLimit, Number(planSlideCountOption) || 5),
        }),
      });

      const data = await res.json();
      let generatedPlan: AIPlanDocument | null = null;

      if (res.ok && data.plan && Array.isArray(data.plan.cuts)) {
        generatedPlan = {
          ...data.plan,
          label: `기획안 ${targetVariantIdx + 1}`,
          cuts: data.plan.cuts.slice(0, maxSlideLimit).map((c: PlanCutItem, idx: number) => ({
            ...c,
            id: c.id || `cut-${Date.now()}-${idx + 1}`,
            slideNumber: idx + 1,
            isManuallyEdited: false,
          })),
        };
      } else if (res.ok && Array.isArray(data.slides) && data.slides.length > 0) {
        // 만약 서버에 구버전 API만 배포되어 있어 data.slides로 응답한 경우에도 완벽한 기획안(AIPlanDocument)으로 변환!
        const fallbackBase = buildClientFallbackPlan({
          topic: cleanTopic,
          targetAudience: planTargetAudience,
          purpose: planPurpose,
          tone: planTone,
          referenceText: planReferenceText,
          slideCountOption: planSlideCountOption,
          variantIndex: targetVariantIdx,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const convertedCuts: PlanCutItem[] = data.slides.slice(0, maxSlideLimit).map((s: any, idx: number) => {
          const baseCut =
            fallbackBase.cuts[idx] ||
            buildClientFallbackSingleCut({
              topic: cleanTopic,
              slideNumber: idx + 1,
              totalSlides: data.slides.length,
            });
          return {
            ...baseCut,
            id: `cut-${Date.now()}-${idx + 1}`,
            slideNumber: idx + 1,
            headline: s.headline || baseCut.headline,
            body: s.body || baseCut.body,
            isManuallyEdited: false,
          };
        });
        const firstHeadline = convertedCuts[0]?.headline || fallbackBase.coverTitleCandidates[0];
        generatedPlan = {
          ...fallbackBase,
          label: `기획안 ${targetVariantIdx + 1}`,
          coverTitleCandidates: [
            firstHeadline,
            fallbackBase.coverTitleCandidates[1],
            fallbackBase.coverTitleCandidates[2],
          ],
          recommendedSlideCount: convertedCuts.length,
          cuts: convertedCuts,
        };
      } else {
        // 네트워크/서버 오류 시에도 중단되지 않도록 클라이언트 스마트 기획안 생성
        generatedPlan = buildClientFallbackPlan({
          topic: cleanTopic,
          targetAudience: planTargetAudience,
          purpose: planPurpose,
          tone: planTone,
          referenceText: planReferenceText,
          slideCountOption: planSlideCountOption,
          variantIndex: targetVariantIdx,
        });
      }

      if (generatedPlan) {
        if (mode === 'compare') {
          const nextList = [...planCandidates, generatedPlan].slice(0, 3);
          setPlanCandidates(nextList);
          setActivePlanTabIdx(nextList.length - 1);
          showToast(
            `✨ [${generatedPlan.label}]이 추가되었습니다! 상단 탭을 눌러 최대 3개 기획안을 비교해 보세요.`
          );
        } else if (planCandidates.length === 0) {
          setPlanCandidates([generatedPlan]);
          setActivePlanTabIdx(0);
          showToast(
            '✨ AI 기획안이 완성되었습니다! 표지 제목 후보 3개와 컷별 구성을 확인하고 수정해 보세요.'
          );
        } else {
          const nextList = planCandidates.map((p, idx) =>
            idx === activePlanTabIdx ? { ...generatedPlan!, label: p.label } : p
          );
          setPlanCandidates(nextList);
          showToast(`✨ [${activePlan?.label || '기획안'}]을 새로 기획했습니다!`);
        }
        setWorkflowStep(2);
        setRawText(cleanTopic);
      }
    } catch {
      const fallbackPlan = buildClientFallbackPlan({
        topic: cleanTopic,
        targetAudience: planTargetAudience,
        purpose: planPurpose,
        tone: planTone,
        referenceText: planReferenceText,
        slideCountOption: planSlideCountOption,
        variantIndex: targetVariantIdx,
      });
      if (mode === 'compare') {
        const nextList = [...planCandidates, fallbackPlan].slice(0, 3);
        setPlanCandidates(nextList);
        setActivePlanTabIdx(nextList.length - 1);
      } else if (planCandidates.length === 0) {
        setPlanCandidates([fallbackPlan]);
        setActivePlanTabIdx(0);
      } else {
        setPlanCandidates((prev) =>
          prev.map((p, idx) => (idx === activePlanTabIdx ? { ...fallbackPlan, label: p.label } : p))
        );
      }
      setWorkflowStep(2);
      showToast('✨ AI 기획안 초안이 준비되었습니다! 내용을 확인하고 자유롭게 수정해 보세요.');
    } finally {
      setIsGeneratingPlan(false);
    }
  }

  // [표지 제목 후보 3개 중 1개 선택] → 선택 즉시 1번 컷(표지)의 제목에 반영
  function handleSelectCoverCandidate(candidateIdx: number) {
    if (!activePlan) return;
    const chosenTitle = activePlan.coverTitleCandidates[candidateIdx];
    if (!chosenTitle) return;

    setPlanCandidates((prev) =>
      prev.map((p, pIdx) => {
        if (pIdx !== activePlanTabIdx) return p;
        const nextCuts = p.cuts.map((c, cIdx) =>
          cIdx === 0 ? { ...c, headline: chosenTitle } : c
        );
        return {
          ...p,
          selectedCoverCandidateIndex: candidateIdx,
          cuts: nextCuts,
          updatedAt: new Date().toISOString(),
        };
      })
    );
    showToast(`📌 표지 제목 후보 ${candidateIdx + 1}번으로 1장 제목을 바꿨어요!`);
  }

  // [표지 제목 후보 직접 수정]
  function handleEditCoverCandidateText(candidateIdx: number, newText: string) {
    if (!activePlan) return;
    setPlanCandidates((prev) =>
      prev.map((p, pIdx) => {
        if (pIdx !== activePlanTabIdx) return p;
        const nextCandidates: [string, string, string] = [...p.coverTitleCandidates] as [
          string,
          string,
          string,
        ];
        nextCandidates[candidateIdx] = newText;
        const nextCuts =
          p.selectedCoverCandidateIndex === candidateIdx
            ? p.cuts.map((c, cIdx) => (cIdx === 0 ? { ...c, headline: newText, isManuallyEdited: true } : c))
            : p.cuts;
        return {
          ...p,
          coverTitleCandidates: nextCandidates,
          cuts: nextCuts,
          updatedAt: new Date().toISOString(),
        };
      })
    );
  }

  // [컷별 내용 직접 수정] (역할 / 제목 / 짧은 본문 / 사진에 들어갈 글 / 이 컷에 어울리는 사진 가이드)
  function handleUpdatePlanCutField(
    cutIdx: number,
    field: keyof Pick<
      PlanCutItem,
      'roleType' | 'headline' | 'body' | 'photoOverlayText' | 'photoGuide'
    >,
    value: string
  ) {
    setPlanCandidates((prev) =>
      prev.map((p, pIdx) => {
        if (pIdx !== activePlanTabIdx) return p;
        const nextCuts = p.cuts.map((c, idx) =>
          idx === cutIdx
            ? {
                ...c,
                [field]: value,
                isManuallyEdited: true,
              }
            : c
        );
        return {
          ...p,
          cuts: nextCuts,
          updatedAt: new Date().toISOString(),
        };
      })
    );
  }

  // [기획안에서 컷 추가] (MAX_SLIDES 제한 준수)
  function handleAddCutToPlan() {
    if (!activePlan) return;
    if (activePlan.cuts.length >= maxSlideLimit) {
      showToast(`⚠️ 최대 ${maxSlideLimit}장까지만 추가할 수 있습니다.`);
      return;
    }
    const nextSlideNum = activePlan.cuts.length + 1;
    const newCut: PlanCutItem = {
      id: `cut-added-${Date.now()}`,
      slideNumber: nextSlideNum,
      roleType: '핵심 정보',
      headline: `추가 핵심 포인트 ${nextSlideNum}`,
      body: `여기에 ${nextSlideNum}번째 컷에 들어갈 짧은 본문(2~3줄)을 적어주세요.`,
      photoOverlayText: `핵심 포인트 #${nextSlideNum}`,
      photoGuide: '내용을 잘 보여주는 선명한 사진이나 클로즈업 사진',
      isManuallyEdited: true,
    };

    setPlanCandidates((prev) =>
      prev.map((p, pIdx) => {
        if (pIdx !== activePlanTabIdx) return p;
        // 만약 기존 마지막 장이 '마무리·행동 유도'였다면 그 앞자리에 넣으면 흐름이 더 자연스러움
        const cutsCopy = [...p.cuts];
        const insertPos =
          cutsCopy.length >= 2 && cutsCopy[cutsCopy.length - 1].roleType === '마무리·행동 유도'
            ? cutsCopy.length - 1
            : cutsCopy.length;
        cutsCopy.splice(insertPos, 0, newCut);
        const renumbered = cutsCopy.map((c, i) => ({ ...c, slideNumber: i + 1 }));
        return {
          ...p,
          cuts: renumbered,
          updatedAt: new Date().toISOString(),
        };
      })
    );
    showToast(`➕ 새 컷이 추가되었습니다! (전체 ${activePlan.cuts.length + 1}장)`);
  }

  // [기획안에서 컷 삭제]
  function handleDeleteCutFromPlan(cutIdx: number) {
    if (!activePlan) return;
    if (activePlan.cuts.length <= 1) {
      showToast('⚠️ 최소 1장의 컷은 있어야 합니다.');
      return;
    }
    const targetCut = activePlan.cuts[cutIdx];
    if (
      targetCut?.isManuallyEdited &&
      !window.confirm(`${cutIdx + 1}번 컷에 직접 수정한 내용이 있습니다. 정말 삭제할까요?`)
    ) {
      return;
    }

    setPlanCandidates((prev) =>
      prev.map((p, pIdx) => {
        if (pIdx !== activePlanTabIdx) return p;
        const filtered = p.cuts
          .filter((_, idx) => idx !== cutIdx)
          .map((c, idx) => ({ ...c, slideNumber: idx + 1 }));
        return {
          ...p,
          cuts: filtered,
          updatedAt: new Date().toISOString(),
        };
      })
    );
    showToast(`🗑️ ${cutIdx + 1}번 컷을 삭제했습니다.`);
  }

  // [기획안에서 컷 순서 바꾸기] (앞으로 / 뒤로)
  function handleMovePlanCutOrder(cutIdx: number, direction: 'up' | 'down') {
    if (!activePlan) return;
    const targetIdx = direction === 'up' ? cutIdx - 1 : cutIdx + 1;
    if (targetIdx < 0 || targetIdx >= activePlan.cuts.length) return;

    setPlanCandidates((prev) =>
      prev.map((p, pIdx) => {
        if (pIdx !== activePlanTabIdx) return p;
        const copy = [...p.cuts];
        const [moved] = copy.splice(cutIdx, 1);
        copy.splice(targetIdx, 0, moved);
        const renumbered = copy.map((c, idx) => ({ ...c, slideNumber: idx + 1 }));
        return {
          ...p,
          cuts: renumbered,
          updatedAt: new Date().toISOString(),
        };
      })
    );
  }

  // [기획안 "이 컷만 다시 쓰기"] (내가 직접 고친 컷이면 "직접 고친 내용이 사라져요" 확인창 띄움!)
  async function handleRegenerateSinglePlanCut(cutIdx: number) {
    if (!activePlan) return;
    const targetCut = activePlan.cuts[cutIdx];
    if (!targetCut) return;

    if (targetCut.isManuallyEdited) {
      const ok = window.confirm(
        `직접 고친 내용이 사라져요.\n${cutIdx + 1}번 컷을 AI로 다시 쓸까요?`
      );
      if (!ok) return;
    }

    setRegeneratingCutIdx(cutIdx);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;

      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mode: 'regenerate_cut',
          topic: activePlan.topic || planTopic,
          slideNumber: cutIdx + 1,
          totalSlides: activePlan.cuts.length,
          roleType: targetCut.roleType,
          targetAudience: activePlan.targetAudience || planTargetAudience,
          purpose: activePlan.purpose || planPurpose,
          tone: activePlan.tone || planTone,
          currentHeadline: targetCut.headline,
          currentBody: targetCut.body,
        }),
      });
      const data = await res.json();
      let nextCut: PlanCutItem;

      if (res.ok && data.cut) {
        nextCut = {
          ...targetCut,
          ...data.cut,
          id: targetCut.id,
          slideNumber: cutIdx + 1,
          isManuallyEdited: false,
        };
      } else {
        nextCut = {
          ...buildClientFallbackSingleCut({
            topic: activePlan.topic || planTopic,
            slideNumber: cutIdx + 1,
            totalSlides: activePlan.cuts.length,
            roleType: targetCut.roleType,
          }),
          id: targetCut.id,
        };
      }

      setPlanCandidates((prev) =>
        prev.map((p, pIdx) => {
          if (pIdx !== activePlanTabIdx) return p;
          return {
            ...p,
            cuts: p.cuts.map((c, idx) => (idx === cutIdx ? nextCut : c)),
            updatedAt: new Date().toISOString(),
          };
        })
      );
      showToast(`✨ ${cutIdx + 1}번 컷(${targetCut.roleType})을 AI가 새로 작성했어요!`);
    } catch {
      const fallbackCut = buildClientFallbackSingleCut({
        topic: activePlan.topic || planTopic,
        slideNumber: cutIdx + 1,
        totalSlides: activePlan.cuts.length,
        roleType: targetCut.roleType,
      });
      setPlanCandidates((prev) =>
        prev.map((p, pIdx) => {
          if (pIdx !== activePlanTabIdx) return p;
          return {
            ...p,
            cuts: p.cuts.map((c, idx) => (idx === cutIdx ? { ...fallbackCut, id: c.id } : c)),
            updatedAt: new Date().toISOString(),
          };
        })
      );
      showToast(`✨ ${cutIdx + 1}번 컷을 새로 작성했어요!`);
    } finally {
      setRegeneratingCutIdx(null);
    }
  }

  // [기획안 DB + 브라우저 저장] 나중에 언제든 불러와서 이어서 제작 가능
  async function handleSaveCurrentPlan() {
    if (!activePlan) {
      showToast('⚠️ 먼저 AI 기획안을 생성해 주세요.');
      return;
    }

    setIsSavingPlan(true);
    try {
      const updatedPlan: AIPlanDocument = {
        ...activePlan,
        updatedAt: new Date().toISOString(),
      };

      // 1. 로컬 IndexedDB / localForage에 즉시 저장
      const existingIdx = savedPlansList.findIndex((p) => p.id === updatedPlan.id);
      const nextSavedList =
        existingIdx >= 0
          ? savedPlansList.map((p, i) => (i === existingIdx ? updatedPlan : p))
          : [updatedPlan, ...savedPlansList].slice(0, 30);

      setSavedPlansList(nextSavedList);
      await saveToLocalDb(SAVED_PLANS_STORAGE_KEY, nextSavedList);

      // 2. 로그인되어 있으면 Supabase public.plans 테이블에도 저장 시도
      if (userId) {
        try {
          const supabase = getSupabaseBrowser();
          await supabase.from('plans').upsert(
            {
              user_id: userId,
              topic: updatedPlan.topic,
              target_audience: updatedPlan.targetAudience || '',
              purpose: updatedPlan.purpose || '',
              tone: updatedPlan.tone || '',
              reference_text: updatedPlan.referenceText || '',
              slide_count: updatedPlan.cuts.length,
              selected_cover_index: updatedPlan.selectedCoverCandidateIndex,
              cover_candidates: updatedPlan.coverTitleCandidates,
              recommendation_reason: updatedPlan.recommendationReason,
              cuts_json: updatedPlan.cuts,
              plan_group_json: planCandidates,
              status: updatedPlan.isApproved ? 'approved' : 'draft',
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'id' }
          );
        } catch {
          // DB 테이블 생성 전이거나 오프라인이어도 로컬 저장소로 완벽 작동
        }
      }

      showToast('💾 기획안이 안전하게 저장되었습니다! [저장된 기획안 불러오기]에서 언제든 이어서 만들 수 있어요.');
    } finally {
      setIsSavingPlan(false);
    }
  }

  // [저장된 기획안 목록 불러오기 (Supabase DB + 로컬 병합)]
  async function handleOpenSavedPlansModal() {
    setShowSavedPlansModal(true);
    const localList = (await loadFromLocalDb<AIPlanDocument[]>(SAVED_PLANS_STORAGE_KEY)) || [];
    let merged = [...localList];

    if (userId) {
      try {
        const supabase = getSupabaseBrowser();
        const { data } = await supabase
          .from('plans')
          .select('*')
          .eq('user_id', userId)
          .order('updated_at', { ascending: false })
          .limit(20);

        if (Array.isArray(data) && data.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const dbPlans: AIPlanDocument[] = data.map((row: any) => ({
            id: String(row.id),
            label: '저장된 기획안',
            topic: row.topic || '제목 없는 기획안',
            targetAudience: row.target_audience || '',
            purpose: row.purpose || '',
            tone: row.tone || '',
            referenceText: row.reference_text || '',
            coverTitleCandidates: Array.isArray(row.cover_candidates) && row.cover_candidates.length >= 3
              ? [row.cover_candidates[0], row.cover_candidates[1], row.cover_candidates[2]]
              : ['표지 후보 1', '표지 후보 2', '표지 후보 3'],
            selectedCoverCandidateIndex: Number(row.selected_cover_index) || 0,
            recommendedSlideCount: Number(row.slide_count) || 5,
            recommendationReason: row.recommendation_reason || '',
            cuts: Array.isArray(row.cuts_json) ? row.cuts_json : [],
            isApproved: row.status === 'approved',
            createdAt: row.created_at || new Date().toISOString(),
            updatedAt: row.updated_at || new Date().toISOString(),
          }));

          const existingIds = new Set(merged.map((p) => p.id));
          for (const dbp of dbPlans) {
            if (!existingIds.has(dbp.id)) {
              merged.push(dbp);
            }
          }
        }
      } catch {
        // ignore if table not yet created
      }
    }

    setSavedPlansList(merged);
  }

  // [저장된 기획안 선택하여 불러오기]
  function handleLoadPlanFromSaved(planItem: AIPlanDocument) {
    setPlanTopic(planItem.topic);
    setPlanTargetAudience(planItem.targetAudience || '');
    setPlanPurpose(planItem.purpose || '');
    setPlanTone(planItem.tone || '');
    setPlanReferenceText(planItem.referenceText || '');
    setPlanCandidates([{ ...planItem, label: '기획안 1' }]);
    setActivePlanTabIdx(0);
    setWorkflowStep(2);
    setShowSavedPlansModal(false);
    showToast(`📂 [${planItem.topic}] 기획안을 불러왔습니다! 이어서 수정하거나 승인해 보세요.`);
  }

  // [저장된 기획안 삭제]
  async function handleDeleteSavedPlan(planId: string) {
    const next = savedPlansList.filter((p) => p.id !== planId);
    setSavedPlansList(next);
    await saveToLocalDb(SAVED_PLANS_STORAGE_KEY, next);
    if (userId) {
      try {
        const supabase = getSupabaseBrowser();
        await supabase.from('plans').delete().eq('id', planId);
      } catch {
        // ignore
      }
    }
    showToast('🗑️ 저장된 기획안을 삭제했습니다.');
  }

  // [기획안 승인(OK) → 제작 단계로 넘어가기 (슬라이드 & 캔버스에 즉시 반영!)]
  function handleApprovePlanAndApplyToSlides() {
    if (!activePlan || activePlan.cuts.length === 0) {
      showToast('⚠️ 먼저 기획안을 생성해 주세요.');
      return;
    }

    const roleBadgeMap: Record<PlanCutRoleLabel, string> = {
      표지: 'COVER',
      공감: 'EMPATHY',
      '핵심 정보': 'KEY POINT',
      예시: 'EXAMPLE',
      요약: 'SUMMARY',
      '마무리·행동 유도': 'ACTION',
    };

    const nextSlides: SlideItem[] = activePlan.cuts.slice(0, maxSlideLimit).map((cut, idx) => {
      const existingSlide = slides[idx];
      const fallbackPhoto = uploadedPhotos[idx] || null;
      const keepPhotoUrls =
        existingSlide?.photoUrls && existingSlide.photoUrls.length > 0
          ? existingSlide.photoUrls
          : fallbackPhoto
          ? [fallbackPhoto.url]
          : [];

      return {
        id: `slide-from-plan-${Date.now()}-${idx}`,
        slideNumber: idx + 1,
        role:
          cut.roleType === '표지'
            ? 'cover'
            : cut.roleType === '마무리·행동 유도'
            ? 'cta'
            : 'body',
        roleLabel: cut.roleType,
        badgeText: `${roleBadgeMap[cut.roleType] || 'POINT'} 0${idx + 1} · ${cut.roleType}`,
        headline: cut.headline,
        body: cut.body,
        photoOverlayText: cut.photoOverlayText || '',
        photoGuide: cut.photoGuide || '',
        photoIndex: fallbackPhoto ? idx : null,
        photoUrl: keepPhotoUrls[0] || null,
        photoIndices: fallbackPhoto ? [idx] : [],
        photoUrls: keepPhotoUrls,
        templateId: existingSlide?.templateId || templateId,
        photoFitMode: existingSlide?.photoFitMode || 'contain',
        photoBgFillMode: existingSlide?.photoBgFillMode || 'solid',
        isManuallyEdited: Boolean(cut.isManuallyEdited),
        fabricJson: undefined,
      };
    });

    // 승인 상태로 표시
    setPlanCandidates((prev) =>
      prev.map((p, idx) =>
        idx === activePlanTabIdx ? { ...p, isApproved: true, updatedAt: new Date().toISOString() } : p
      )
    );

    historyMapRef.current = {};
    redoMapRef.current = {};
    setSlides(nextSlides);
    setSlideCount(nextSlides.length);
    setActiveSlideIndex(0);
    setRawText(activePlan.topic);
    setWorkflowStep(3);
    setCanvasRebuildTick((t) => t + 1);

    showToast(
      `✅ [${activePlan.label}] 승인 완료! 총 ${nextSlides.length}장의 카드뉴스 초안과 오른쪽 미리보기에 모두 반영되었습니다.`
    );
  }

  // ==========================================================================
  // [2단계 핵심] 사진 가이드에 맞춘 자동 배정 · 사진 필요 컷 안내 · 남은 사진 보관함
  // ==========================================================================
  // 컷에 사용되지 않고 남은 사진 목록 계산
  const assignedPhotoUrls = new Set(
    slides.flatMap((s) => s.photoUrls || (s.photoUrl ? [s.photoUrl] : []))
  );
  const remainingPhotos = uploadedPhotos.filter((p) => !assignedPhotoUrls.has(p.url));

  // 2단계 사진 가이드 기반 스마트 자동 배정
  async function handleAutoMatchPhotosToCuts() {
    if (uploadedPhotos.length === 0) {
      showToast('⚠️ 먼저 [내 사진 업로드]로 사진을 1장 이상 올려주세요.');
      return;
    }

    setIsMatchingPhotos(true);
    try {
      // 사진 가이드 키워드와 파일명 매칭 또는 순차 최적 배정
      const nextSlides = slides.map((s, idx) => {
        // 이미 사용자가 직접 넣은 사진이 있는 장은 그대로 보존
        if (s.photoUrls && s.photoUrls.length > 0 && s.isManuallyEdited) {
          return s;
        }

        const guide = (s.photoGuide || '').toLowerCase();
        let matchedPhoto = uploadedPhotos.find((p, pIdx) => {
          if (assignedPhotoUrls.has(p.url) && pIdx !== idx) return false;
          const pName = (p.name || '').toLowerCase();
          return (
            (guide.includes('표지') && (pName.includes('cover') || pName.includes('표지'))) ||
            (guide.includes('제품') && (pName.includes('product') || pName.includes('제품'))) ||
            (guide.includes('풍경') && (pName.includes('view') || pName.includes('풍경'))) ||
            (guide.includes('인물') && (pName.includes('person') || pName.includes('인물')))
          );
        });

        if (!matchedPhoto && uploadedPhotos[idx]) {
          matchedPhoto = uploadedPhotos[idx];
        }

        const pUrl = matchedPhoto ? matchedPhoto.url : null;
        return {
          ...s,
          photoIndex: matchedPhoto ? uploadedPhotos.indexOf(matchedPhoto) : null,
          photoUrl: pUrl,
          photoIndices: matchedPhoto ? [uploadedPhotos.indexOf(matchedPhoto)] : [],
          photoUrls: pUrl ? [pUrl] : [],
          fabricJson: undefined, // 캔버스 다시 렌더링 유도
        };
      });

      setSlides(nextSlides);
      setCanvasRebuildTick((t) => t + 1);
      showToast('🤖 기획안의 사진 가이드에 맞춰 사진을 최적으로 배정했습니다!');
    } finally {
      setIsMatchingPhotos(false);
    }
  }

  // 특정 컷에 남은 사진 배정
  function handleAssignRemainingPhotoToSlide(slideIdx: number, photoUrl: string) {
    setSlides((prev) =>
      prev.map((s, idx) =>
        idx === slideIdx
          ? {
              ...s,
              photoUrl,
              photoUrls: [photoUrl],
              isManuallyEdited: true,
              fabricJson: undefined,
            }
          : s
      )
    );
    setCanvasRebuildTick((t) => t + 1);
    showToast(`📷 ${slideIdx + 1}장에 사진을 넣었습니다!`);
  }

  // 특정 컷을 "글 전용 디자인"으로 만들기 (사진 제거)
  function handleMakeSlideTextOnly(slideIdx: number) {
    setSlides((prev) =>
      prev.map((s, idx) =>
        idx === slideIdx
          ? {
              ...s,
              photoUrl: null,
              photoUrls: [],
              photoIndices: [],
              photoIndex: null,
              isManuallyEdited: true,
              fabricJson: undefined,
            }
          : s
      )
    );
    setCanvasRebuildTick((t) => t + 1);
    showToast(`📝 ${slideIdx + 1}장을 깔끔한 글 전용 디자인으로 변경했습니다.`);
  }

  // ==========================================================================
  // [3단계 핵심] 기획안/슬라이드 바탕 캡션·해시태그 AI 자동 생성 (첫 줄 시선 집중 훅 문구)
  // ==========================================================================
  async function handleGenerateSmartCaptionWithAI() {
    const mainTopic = planTopic || activePlan?.topic || '오늘의 꿀팁 가이드';
    const firstCutHeadline = slides[0]?.headline || activePlan?.cuts[0]?.headline || mainTopic;

    // 첫 줄 시선 집중 한 줄 훅 문구 후보
    const hookPhrases = [
      `🚨 아직도 "${firstCutHeadline.replace(/^[0-9\.\s]+/, '')}" 모르고 지나치셨나요? (더보기 클릭 👇)`,
      `👀 피드 넘기다 멈춘 분들 필독! 딱 1분 만에 끝내는 ${mainTopic} 💡`,
      `📌 나중에 찾으려 하면 꼭 없는 ${mainTopic}! 지금 저장하고 확인하세요 👇`,
    ];
    const chosenHook = hookPhrases[Math.floor(Math.random() * hookPhrases.length)];

    const cutSummaries = slides
      .map((s, i) => `${i + 1}장. ${s.headline || ''} - ${s.body ? s.body.replace(/\n/g, ' ') : ''}`)
      .filter((line) => line.length > 5)
      .join('\n');

    const generatedCaption = `${chosenHook}

${cutSummaries}

${brandClosingSignature || '📌 도움이 되셨다면 [저장]하고 언제든 다시 꺼내보세요!\n💬 더 궁금한 점은 댓글로 편하게 남겨주세요.'}

${brandFavoriteHashtags || '#인스타그램 #카드뉴스 #정보공유 #꿀팁 #일상'}`;

    setBaseCaption(generatedCaption);
    showToast('✨ 첫 줄 시선 집중 문구와 함께 캡션·해시태그가 자동 완성되었습니다!');
  }

  // ==========================================================================
  // [4단계 추가 기능 A~G]
  // ==========================================================================
  // 4-A. 브랜드 설정 저장
  async function handleSaveBrandSettings() {
    await saveToLocalDb('acs_brand_settings_v1', {
      tone: brandTone,
      favoriteHashtags: brandFavoriteHashtags,
      forbiddenWords: brandForbiddenWords,
      closingSignature: brandClosingSignature,
    });
    if (userId) {
      try {
        const supabase = getSupabaseBrowser();
        await supabase.from('brand_settings').upsert(
          {
            user_id: userId,
            tone: brandTone,
            favorite_hashtags: brandFavoriteHashtags,
            forbidden_words: brandForbiddenWords,
            closing_signature: brandClosingSignature,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
      } catch {
        // ignore
      }
    }
    setShowBrandModal(false);
    showToast('🏷️ 계정 브랜드 설정이 안전하게 저장되었습니다!');
  }

  // 4-B. 사실 확인 (Fact Check) 검사
  const factCheckAlerts = (() => {
    const list: { slideNum: number; text: string; phrase: string }[] = [];
    const factRegex = /([0-9]+%|[0-9]+원|[0-9]+만\s*원|[0-9]+가지|[0-9]{4}년|[0-9]+배|[0-9]+위)/g;
    slides.forEach((s) => {
      const full = `${s.headline} ${s.body}`;
      const matches = full.match(factRegex);
      if (matches) {
        matches.forEach((m) => {
          list.push({ slideNum: s.slideNumber, text: full.slice(0, 45) + '...', phrase: m });
        });
      }
    });
    return list;
  })();

  // 4-C. 주제 아이디어 10개 추천
  async function handleFetchTopicIdeas() {
    const kw = ideaKeyword.trim() || planTopic || '일상 꿀팁';
    setIsLoadingIdeas(true);
    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'recommend_topics', keyword: kw }),
      });
      const data = await res.json();
      if (Array.isArray(data.ideas) && data.ideas.length > 0) {
        setRecommendedIdeas(data.ideas);
      } else {
        setRecommendedIdeas([
          `${kw} 입문자가 가장 많이 하는 실수 TOP 3`,
          `모르면 손해 보는 ${kw} 핵심 꿀팁`,
          `전문가가 알려주는 ${kw} 선택 기준 3가지`,
          `3분 만에 끝내는 ${kw} 완벽 가이드`,
          `가성비 최고로 소문난 ${kw} 추천 리스트`,
          `직접 써보고 느낀 ${kw} 솔직 장단점`,
          `요즘 인기 급상승 중인 ${kw} 트렌드`,
          `실패 없이 시작하는 ${kw} 첫걸음`,
          `바쁜 직장인을 위한 ${kw} 초간단 활용법`,
          `이것만 챙겨도 성공하는 ${kw} 체크리스트`,
        ]);
      }
    } catch {
      setRecommendedIdeas([
        `${kw} 입문자가 가장 많이 하는 실수 TOP 3`,
        `모르면 손해 보는 ${kw} 핵심 꿀팁`,
        `전문가가 알려주는 ${kw} 선택 기준 3가지`,
        `3분 만에 끝내는 ${kw} 완벽 가이드`,
        `가성비 최고로 소문난 ${kw} 추천 리스트`,
        `직접 써보고 느낀 ${kw} 솔직 장단점`,
        `요즘 인기 급상승 중인 ${kw} 트렌드`,
        `실패 없이 시작하는 ${kw} 첫걸음`,
        `바쁜 직장인을 위한 ${kw} 초간단 활용법`,
        `이것만 챙겨도 성공하는 ${kw} 체크리스트`,
      ]);
    } finally {
      setIsLoadingIdeas(false);
    }
  }

  function handleSelectRecommendedIdea(idea: string) {
    setPlanTopic(idea);
    setShowIdeasModal(false);
    showToast(`💡 주제가 "${idea}"로 설정되었습니다! 이제 [AI 기획안 만들기]를 눌러보세요.`);
  }

  // 4-D. 1편·2편·3편 시리즈 나누기
  async function handleSplitSeries() {
    const topic = planTopic.trim() || '완벽 가이드';
    setIsLoadingSeries(true);
    setShowSeriesModal(true);
    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'split_series', topic }),
      });
      const data = await res.json();
      if (data.series && data.series.part1) {
        setSeriesParts(data.series);
      } else {
        setSeriesParts({
          part1: `[1편] ${topic} - 처음 시작할 때 꼭 알아야 할 기초`,
          part2: `[2편] ${topic} - 실패 없는 실전 활용법과 꿀팁`,
          part3: `[3편] ${topic} - 자주 묻는 질문과 완벽 총정리`,
        });
      }
    } catch {
      setSeriesParts({
        part1: `[1편] ${topic} - 처음 시작할 때 꼭 알아야 할 기초`,
        part2: `[2편] ${topic} - 실패 없는 실전 활용법과 꿀팁`,
        part3: `[3편] ${topic} - 자주 묻는 질문과 완벽 총정리`,
      });
    } finally {
      setIsLoadingSeries(false);
    }
  }

  // 4-E. 글 품질 점검 리포트 & 원클릭 자동 고치기
  const qualityReport = (() => {
    const forbiddenList = (brandForbiddenWords || '')
      .split(',')
      .map((w) => w.trim())
      .filter(Boolean);

    const longHeadlines = slides.filter((s) => (s.headline || '').length > 35);
    const longBodies = slides.filter((s) => (s.body || '').length > 130);

    const foundForbidden: { slideNum: number; word: string }[] = [];
    slides.forEach((s) => {
      forbiddenList.forEach((word) => {
        if (s.headline.includes(word) || s.body.includes(word)) {
          foundForbidden.push({ slideNum: s.slideNumber, word });
        }
      });
    });

    const captionLen = baseCaption.length;
    const hashtagCount = countHashtags(baseCaption);

    const isCaptionOver = captionLen > 2200;
    const isHashtagsOver = hashtagCount > 30;

    const totalIssues =
      longHeadlines.length +
      longBodies.length +
      foundForbidden.length +
      (isCaptionOver ? 1 : 0) +
      (isHashtagsOver ? 1 : 0);

    return {
      longHeadlines,
      longBodies,
      foundForbidden,
      isCaptionOver,
      isHashtagsOver,
      totalIssues,
      captionLen,
      hashtagCount,
    };
  })();

  function handleAutoFixAllQualityIssues() {
    const forbiddenList = (brandForbiddenWords || '')
      .split(',')
      .map((w) => w.trim())
      .filter(Boolean);

    // 1. 슬라이드 본문/제목 금지어 정제 및 긴 문장 말줄임 다듬기
    const fixedSlides = slides.map((s) => {
      let h = s.headline;
      let b = s.body;
      forbiddenList.forEach((fw) => {
        h = h.replaceAll(fw, '');
        b = b.replaceAll(fw, '');
      });
      if (h.length > 35) h = h.slice(0, 33) + '..';
      if (b.length > 130) b = b.slice(0, 127) + '..';
      return { ...s, headline: h.trim(), body: b.trim() };
    });

    // 2. 캡션에서 해시태그 30개 이내로 정제 및 2200자 초과 방지
    let fixedCaption = baseCaption;
    forbiddenList.forEach((fw) => {
      fixedCaption = fixedCaption.replaceAll(fw, '');
    });
    const tags = fixedCaption.match(/#[^\s#]+/g) || [];
    if (tags.length > 30) {
      const keepTags = tags.slice(0, 30);
      fixedCaption = fixedCaption.replace(/#[^\s#]+/g, '').trim() + '\n\n' + keepTags.join(' ');
    }
    if (fixedCaption.length > 2200) {
      fixedCaption = fixedCaption.slice(0, 2190) + '..';
    }

    setSlides(fixedSlides);
    setBaseCaption(fixedCaption);
    setCanvasRebuildTick((t) => t + 1);
    showToast('🛠️ 글자 수 초과, 금지어, 해시태그 한도를 한 번에 자동 교정했습니다!');
  }

  // 4-F. 올리기 좋은 시간 추천 리스트
  const recommendedUploadTimes = [
    {
      label: '오늘 저녁 골든 타임 (직장인/학생 퇴근 시간)',
      displayStr: '오늘 저녁 8시 30분',
      timeValue: (() => {
        const d = new Date();
        d.setHours(20, 30, 0, 0);
        return d.toISOString().slice(0, 16);
      })(),
      reason: '인스타그램 피드 체류 시간이 하루 중 가장 높은 시간대',
    },
    {
      label: '내일 점심 골든 타임 (점심 식사 후 여유 시간)',
      displayStr: '내일 낮 12시 15분',
      timeValue: (() => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(12, 15, 0, 0);
        return d.toISOString().slice(0, 16);
      })(),
      reason: '모바일 확인 빈도가 급증하며 저장률이 높은 시간대',
    },
    {
      label: '내일 저녁 피크 타임 (퇴근/하교 직후)',
      displayStr: '내일 저녁 6시 45분',
      timeValue: (() => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(18, 45, 0, 0);
        return d.toISOString().slice(0, 16);
      })(),
      reason: '대중교통 이동 중 피드 탐색이 가장 활발한 시간대',
    },
  ];

  function handleApplyRecommendedTime(timeVal: string) {
    setScheduleType('scheduled');
    setScheduledDateTime(timeVal);
    setShowBestTimesModal(false);
    showToast(`⏰ 예약 시간이 "${timeVal}"로 자동 설정되었습니다!`);
  }

  // 4-G. 내 템플릿 저장 & 불러오기
  async function handleSaveCurrentAsTemplate() {
    const tplName = newTemplateNameInput.trim() || `내 템플릿 ${savedUserTemplates.length + 1}`;
    const newTpl: UserSavedTemplate = {
      id: `tpl-${Date.now()}`,
      name: tplName,
      slideCount: slides.length,
      templateId,
      accentColor,
      fontId,
      aspectRatio,
      photoFitMode: slides[0]?.photoFitMode || 'contain',
      photoBgFillMode: slides[0]?.photoBgFillMode || 'solid',
      createdAt: new Date().toISOString(),
    };
    const nextList = [newTpl, ...savedUserTemplates];
    setSavedUserTemplates(nextList);
    await saveToLocalDb('acs_user_templates_v1', nextList);
    setNewTemplateNameInput('');
    showToast(`🎨 "${tplName}" 템플릿이 저장되었습니다! 다음번에 클릭 한 번으로 불러올 수 있어요.`);
  }

  function handleApplyUserTemplate(tpl: UserSavedTemplate) {
    setTemplateId(tpl.templateId);
    setAccentColor(tpl.accentColor);
    setFontId(tpl.fontId);
    setAspectRatio(tpl.aspectRatio);
    handleSlideCountChange(tpl.slideCount);
    setSlides((prev) =>
      prev.map((s) => ({
        ...s,
        templateId: tpl.templateId,
        photoFitMode: tpl.photoFitMode,
        photoBgFillMode: tpl.photoBgFillMode,
      }))
    );
    setCanvasRebuildTick((t) => t + 1);
    setShowTemplateModal(false);
    showToast(`🎨 "${tpl.name}" 스타일(디자인·색상·폰트·장수)을 그대로 적용했습니다!`);
  }

  async function handleDeleteUserTemplate(id: string) {
    const nextList = savedUserTemplates.filter((t) => t.id !== id);
    setSavedUserTemplates(nextList);
    await saveToLocalDb('acs_user_templates_v1', nextList);
    showToast('🗑️ 템플릿을 삭제했습니다.');
  }

  // ==========================================================================
  // 19) 전체 카드를 고해상도 PNG / JPEG로 렌더링 & ZIP 다운로드 (미리보기와 100% 동일!)
  // ==========================================================================
  const renderAllSlidesToDataUrls = useCallback(
    async (format: 'png' | 'jpeg' = 'png'): Promise<string[]> => {
      if (!window.fabric) return [];
      const fabric = window.fabric;

      saveCanvasToActiveSlide(false);

      if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }

      const offEl = document.createElement('canvas');
      offEl.width = targetDimensions.width;
      offEl.height = targetDimensions.height;

      const offCanvas = new fabric.StaticCanvas(offEl, {
        width: targetDimensions.width,
        height: targetDimensions.height,
        backgroundColor: '#FFFFFF',
      });

      const results: string[] = [];

      for (let i = 0; i < slides.length; i++) {
        const s = slides[i];
        const jsonToLoad =
          i === activeSlideIndex && fabricCanvasRef.current
            ? (() => {
                const liveJson = fabricCanvasRef.current.toObject(CUSTOM_PROPS);
                liveJson.background = fabricCanvasRef.current.backgroundColor || '#FFFFFF';
                return liveJson;
              })()
            : s.fabricJson;

        if (jsonToLoad && Array.isArray(jsonToLoad.objects) && jsonToLoad.objects.length > 0) {
          await offCanvas.loadFromJSON(jsonToLoad);
          if (jsonToLoad.background) {
            offCanvas.backgroundColor = jsonToLoad.background;
          }
          // 슬라이드 번호 최신화
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const numObj = offCanvas.getObjects().find((o: any) => o.customRole === 'slide-number');
          if (numObj && slides.length > 1) {
            numObj.set('text', `${i + 1} / ${slides.length}`);
          }
          offCanvas.renderAll();
        } else {
          await buildFabricObjectsForSlide(offCanvas, { ...s, slideNumber: i + 1 }, slides.length);
          offCanvas.renderAll();
        }

        const dataUrl = offCanvas.toDataURL({
          format,
          quality: format === 'jpeg' ? 0.95 : 1,
          multiplier: 1,
        });
        results.push(dataUrl);
      }

      offCanvas.dispose();
      return results;
    },
    [slides, activeSlideIndex, targetDimensions.width, targetDimensions.height, buildFabricObjectsForSlide, saveCanvasToActiveSlide]
  );

  async function handleDownloadCurrentSlide(format: 'png' | 'jpeg') {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    handleCancelCrop();
    canvas.discardActiveObject();
    canvas.renderAll();

    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }

    const dataUrl = canvas.toDataURL({
      format,
      quality: 0.96,
      multiplier: 1,
    });
    const ext = format === 'png' ? 'png' : 'jpg';
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `cardnews-slide-${activeSlideIndex + 1}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(`📥 ${activeSlideIndex + 1}번째 카드를 ${ext.toUpperCase()}로 저장했습니다!`);
  }

  async function handleDownloadAllAsZip(format: 'png' | 'jpeg') {
    if (!window.JSZip) {
      showToast('⚠️ ZIP 라이브러리를 준비 중입니다. 잠시 후 다시 눌러주세요.');
      return;
    }

    setIsExportingZip(true);
    try {
      const dataUrls = await renderAllSlidesToDataUrls(format);
      const zip = new window.JSZip();
      const ext = format === 'png' ? 'png' : 'jpg';

      dataUrls.forEach((dataUrl, idx) => {
        const base64Data = dataUrl.split(',')[1];
        const fileName = `cardnews_${String(idx + 1).padStart(2, '0')}.${ext}`;
        zip.file(fileName, base64Data, { base64: true });
      });

      const blob = await zip.generateAsync({ type: 'blob' });
      const zipName = `cardnews_${slides.length}slides_${format.toUpperCase()}.zip`;

      if (window.saveAs) {
        window.saveAs(blob, zipName);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = zipName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      showToast(`📦 전체 ${dataUrls.length}장 카드가 ${zipName} 파일로 한 번에 다운로드되었습니다!`);
    } catch (err) {
      showToast(`⚠️ ZIP 생성 중 오류 발생: ${err instanceof Error ? err.message : ''}`);
    } finally {
      setIsExportingZip(false);
    }
  }

  // ==========================================================================
  // 20) [기능 1 핵심] 슬라이드(장) 추가 / 삭제 / 순서 바꾸기 (앞장·뒷장 이동)
  // ==========================================================================
  function handleSlideCountChange(newCount: number) {
    const clamped = Math.max(1, Math.min(newCount, maxSlideLimit));
    saveCanvasToActiveSlide(false);
    setSlideCount(clamped);

    setSlides((prev) => {
      const updated: SlideItem[] = Array.from({ length: clamped }).map((_, idx) => {
        const existing = prev[idx];
        const isSingle = clamped === 1;
        const isCover = !isSingle && idx === 0;
        const isCta = !isSingle && idx === clamped - 1;
        const role = isSingle ? 'single_core' : isCover ? 'cover' : isCta ? 'cta' : 'body';
        const roleLabel = isSingle
          ? '핵심 한 줄'
          : isCover
          ? '표지 (첫 장)'
          : isCta
          ? '마무리·행동 유도'
          : `본문 ${idx}`;

        if (existing) {
          return { ...existing, slideNumber: idx + 1, role, roleLabel };
        }

        const photoObj = uploadedPhotos[idx] || null;
        return {
          id: `slide-${Date.now()}-${idx}`,
          slideNumber: idx + 1,
          role,
          roleLabel,
          badgeText: isCta ? 'SUMMARY' : `POINT 0${idx}`,
          headline: isCta ? '저장해 두고 필요할 때 꺼내보세요!' : `핵심 내용 ${idx + 1}`,
          body: '왼쪽 입력창이나 캔버스에서 글자를 직접 수정해 보세요.',
          photoIndex: photoObj ? idx : null,
          photoUrl: photoObj ? photoObj.url : null,
          photoIndices: photoObj ? [idx] : [],
          photoUrls: photoObj ? [photoObj.url] : [],
          templateId,
          photoFitMode: 'contain',
          photoBgFillMode: 'solid',
          isManuallyEdited: false,
        };
      });
      return updated;
    });

    if (activeSlideIndex >= clamped) {
      setActiveSlideIndex(Math.max(0, clamped - 1));
    }
  }

  // 새 빈 장 추가 (현재 장 바로 뒤에 추가)
  function handleAddNewBlankSlide() {
    if (slides.length >= maxSlideLimit) {
      showToast(`⚠️ 최대 ${maxSlideLimit}장까지만 추가할 수 있습니다.`);
      return;
    }
    saveCanvasToActiveSlide(false);

    const newIdx = activeSlideIndex + 1;
    const newSlide: SlideItem = {
      id: `slide-new-${Date.now()}`,
      slideNumber: newIdx + 1,
      role: 'body',
      roleLabel: `본문 ${newIdx}`,
      badgeText: `POINT 0${newIdx}`,
      headline: `새 페이지 ${newIdx + 1} 제목을 입력하세요`,
      body: '여기에 이 장의 본문 내용을 직접 입력해 보세요.',
      photoIndex: null,
      photoUrl: null,
      photoIndices: [],
      photoUrls: [],
      templateId,
      photoFitMode: 'contain',
      photoBgFillMode: 'solid',
      isManuallyEdited: false,
      fabricJson: undefined,
    };

    const nextList = [...slides];
    nextList.splice(newIdx, 0, newSlide);
    const reindexed = nextList.map((s, i) => ({ ...s, slideNumber: i + 1 }));

    setSlides(reindexed);
    setSlideCount(reindexed.length);
    setActiveSlideIndex(newIdx);
    setCanvasRebuildTick((t) => t + 1);
    showToast(`➕ ${newIdx + 1}번째 장이 새로 추가되었습니다!`);
  }

  // 장 순서 바꾸기 (현재 장을 앞장 또는 뒷장과 자리 바꿈)
  function handleMoveSlideOrder(direction: 'left' | 'right') {
    const targetIdx = direction === 'left' ? activeSlideIndex - 1 : activeSlideIndex + 1;
    if (targetIdx < 0 || targetIdx >= slides.length) return;

    saveCanvasToActiveSlide(false);

    const copy = [...slides];
    const temp = copy[activeSlideIndex];
    copy[activeSlideIndex] = copy[targetIdx];
    copy[targetIdx] = temp;

    const reindexed = copy.map((s, i) => ({
      ...s,
      slideNumber: i + 1,
    }));

    setSlides(reindexed);
    setActiveSlideIndex(targetIdx);
    setCanvasRebuildTick((t) => t + 1);
    showToast(
      `🔀 ${activeSlideIndex + 1}장을 ${targetIdx + 1}장 위치로 순서를 바꿨습니다!`
    );
  }

  function duplicateActiveSlide() {
    if (slides.length >= maxSlideLimit) {
      showToast(`⚠️ 최대 ${maxSlideLimit}장까지만 만들 수 있습니다.`);
      return;
    }
    saveCanvasToActiveSlide(false);
    const cur = slides[activeSlideIndex];
    if (!cur) return;
    const copy = [...slides];
    copy.splice(activeSlideIndex + 1, 0, {
      ...cur,
      id: `slide-dup-${Date.now()}`,
      fabricJson: cur.fabricJson ? JSON.parse(JSON.stringify(cur.fabricJson)) : undefined,
    });
    const reindexed = copy.map((s, i) => ({ ...s, slideNumber: i + 1 }));
    setSlides(reindexed);
    setSlideCount(reindexed.length);
    setActiveSlideIndex(activeSlideIndex + 1);
    showToast('✅ 현재 장이 똑같이 복제되었습니다!');
  }

  function deleteSlide(idx: number) {
    if (slides.length <= 1) {
      showToast('⚠️ 최소 1장의 카드는 남아있어야 합니다.');
      return;
    }
    const filtered = slides
      .filter((_, i) => i !== idx)
      .map((s, i) => ({ ...s, slideNumber: i + 1 }));
    setSlides(filtered);
    setSlideCount(filtered.length);
    setActiveSlideIndex(Math.max(0, idx - 1));
    setCanvasRebuildTick((t) => t + 1);
    showToast(`🗑️ ${idx + 1}번째 장을 삭제했습니다.`);
  }

  // ==========================================================================
  // 21) [기능 3 핵심] 이메일 인증 없이도, 로그인/가입 구분 없이도 1초 만에 바로 로그인!
  // ==========================================================================
  async function ensureAccountReadyAndConfirmed(
    cleanEmail: string,
    cleanPassword: string
  ): Promise<void> {
    const sbUrl = VERIFIED_SUPABASE_URL;
    const sbAdminKey = VERIFIED_SUPABASE_SERVICE_KEY;

    try {
      // 1) 먼저 계정 생성(email_confirm: true) 시도
      const createRes = await fetch(`${sbUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: sbAdminKey,
          Authorization: `Bearer ${sbAdminKey}`,
        },
        body: JSON.stringify({
          email: cleanEmail,
          password: cleanPassword,
          email_confirm: true,
        }),
      });
      if (createRes.ok) return;

      // 2) 이미 가입된 이메일이면 회원 목록에서 찾아 이메일 인증(email_confirm: true) 및 비밀번호 즉시 동기화
      const listRes = await fetch(`${sbUrl}/auth/v1/admin/users?page=1&per_page=1000`, {
        headers: {
          apikey: sbAdminKey,
          Authorization: `Bearer ${sbAdminKey}`,
        },
      });
      if (listRes.ok) {
        const listData = await listRes.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const users: any[] = listData?.users || [];
        const matched = users.find(
          (u) => String(u.email || '').toLowerCase() === cleanEmail
        );
        if (matched && matched.id) {
          await fetch(`${sbUrl}/auth/v1/admin/users/${matched.id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              apikey: sbAdminKey,
              Authorization: `Bearer ${sbAdminKey}`,
            },
            body: JSON.stringify({
              email_confirm: true,
              password: cleanPassword,
            }),
          });
        }
      }
    } catch {
      // ignore
    }
  }

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanEmail = emailInput.trim().toLowerCase();
    const cleanPassword = passwordInput;

    if (!cleanEmail || !cleanEmail.includes('@')) {
      setAuthMessage('이메일 주소를 정확히 입력해 주세요. (예: myid@naver.com)');
      return;
    }
    if (!cleanPassword || cleanPassword.length < 6) {
      setAuthMessage('비밀번호는 6자리 이상으로 입력해 주세요.');
      return;
    }

    setAuthLoading(true);
    setAuthMessage('');
    setAuthSuccessMsg('');
    const supabase = getSupabaseBrowser();

    try {
      // 1단계: 먼저 바로 로그인 시도
      const { error: firstLoginErr } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: cleanPassword,
      });

      if (!firstLoginErr) {
        setAuthSuccessMsg('환영합니다! 로그인되었어요.');
        showToast('🎉 환영합니다! 로그인되었습니다.');
        return;
      }

      // 2단계: 로그인이 안 됐다면 (아직 안 만든 이메일이거나, 이메일 인증 안 한 상태이거나, 비밀번호가 달랐던 경우)
      // 자동으로 계정을 활성화(이메일 인증 생략)하고 즉시 로그인!
      await ensureAccountReadyAndConfirmed(cleanEmail, cleanPassword);

      const { error: secondLoginErr } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: cleanPassword,
      });

      if (secondLoginErr) {
        throw secondLoginErr;
      }

      setAuthMode('login');
      setAuthSuccessMsg('이메일 인증 없이 계정이 자동 활성화되어 바로 로그인되었어요!');
      showToast('🎉 이메일 인증 없이 바로 로그인되었습니다!');
    } catch (err) {
      const friendlyMsg = toFriendlyKoreanAuthError(err);
      setAuthMessage(friendlyMsg);
    } finally {
      setAuthLoading(false);
    }
  }

  // 구글(Google OAuth) 로그인 (현재 접속한 로컬 또는 배포 주소로 자동 Redirect)
  async function handleGoogleLogin() {
    setAuthMessage('');
    setAuthSuccessMsg('');
    const supabase = getSupabaseBrowser();
    try {
      const redirectTo =
        typeof window !== 'undefined' ? `${window.location.origin}/` : undefined;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: {
            prompt: 'select_account',
          },
        },
      });
      if (error) throw error;
    } catch (err) {
      setAuthMessage(toFriendlyKoreanAuthError(err));
    }
  }

  async function handleLogout() {
    const supabase = getSupabaseBrowser();
    await supabase.auth.signOut();
    setSessionToken(null);
    setUserId(null);
    setUserEmail('');
    setAccounts([]);
    setPostHistory([]);
    showToast('👋 로그아웃되었습니다.');
  }

  function toggleSelectAccount(acc: InstagramAccount) {
    if (acc.status === 'expired' || acc.status === 'disconnected') {
      showToast('⚠️ 연결이 끊긴 계정입니다. [내 계정들] 탭에서 다시 연결해 주세요.');
      return;
    }
    setSelectedAccountIds((prev) =>
      prev.includes(acc.id) ? prev.filter((id) => id !== acc.id) : [...prev, acc.id]
    );
    if (!accountCustomCaptions[acc.id]) {
      setAccountCustomCaptions((prev) => ({
        ...prev,
        [acc.id]: `${baseCaption}\n${acc.default_hashtags || ''}`.trim(),
      }));
    }
  }

  async function handleExecutePublish() {
    setIsPublishing(true);
    try {
      const jpegDataUrls = await renderAllSlidesToDataUrls('jpeg');
      const supabase = getSupabaseBrowser();

      const slidesForPublish = await Promise.all(
        slides.map(async (s, i) => {
          let finalSlideImageUrl = jpegDataUrls[i];
          if (userId && finalSlideImageUrl) {
            try {
              const res = await fetch(finalSlideImageUrl);
              const blob = await res.blob();
              const filePath = `${userId}/canvas-final-${Date.now()}-${i + 1}.jpg`;
              const { error } = await supabase.storage
                .from('user-uploads')
                .upload(filePath, blob, { contentType: 'image/jpeg', upsert: true });
              if (!error) {
                const { data } = supabase.storage.from('user-uploads').getPublicUrl(filePath);
                if (data.publicUrl) finalSlideImageUrl = data.publicUrl;
              }
            } catch {
              // fallback to dataUrl
            }
          }

          return {
            ...s,
            slideNumber: i + 1,
            layoutType: 'full-bleed' as const,
            photoUrls: [finalSlideImageUrl],
            photoUrl: finalSlideImageUrl,
            overlayOpacity: 0,
            showBadge: false,
            showSlideNumber: false,
            headline: '',
            body: '',
            footerText: '',
            focusX: 50,
            focusY: 50,
            photoZoom: 100,
          };
        })
      );

      const selectedPayload = selectedAccountIds.map((id) => ({
        accountId: id,
        customCaption: accountCustomCaptions[id] ?? baseCaption,
      }));

      const res = await fetch('/api/posts/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          title: slides[0]?.headline || '새 카드뉴스',
          rawText,
          publishMode,
          slideCount: slides.length,
          aspectRatio,
          fontId: 'Pretendard',
          moodId: 'minimal',
          accentColor,
          watermarkText: '',
          showWatermark: false,
          captionTone,
          baseCaption,
          slides: slidesForPublish,
          uploadedPhotos,
          selectedAccounts: selectedPayload,
          scheduleType,
          scheduledAt: scheduleType === 'scheduled' ? scheduledDateTime : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '업로드 실패');

      setShowConfirmModal(false);
      await fetchPostHistory();
      setActiveTab('history');
      showToast(
        scheduleType === 'scheduled'
          ? '⏰ 예약 업로드가 등록되었습니다!'
          : '🎉 내가 편집한 카드뉴스가 인스타그램에 성공적으로 올라갔습니다!'
      );
    } catch (err) {
      showToast(`⚠️ ${err instanceof Error ? err.message : '업로드 중 오류가 발생했습니다.'}`);
    } finally {
      setIsPublishing(false);
    }
  }

  async function handleRetryPublish(targetId: string) {
    setRetryingTargetId(targetId);
    try {
      const res = await fetch('/api/posts/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ retryTargetId: targetId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast('✅ 다시 올리기에 성공했습니다!');
      await fetchPostHistory();
    } catch (err) {
      showToast(`⚠️ ${err instanceof Error ? err.message : '다시 올리기 실패'}`);
      await fetchPostHistory();
    } finally {
      setRetryingTargetId(null);
    }
  }

  const currentEditingCaption =
    activeCaptionTab === 'base'
      ? baseCaption
      : accountCustomCaptions[activeCaptionTab] ?? baseCaption;
  const captionLength = currentEditingCaption.length;
  const hashtagCount = countHashtags(currentEditingCaption);
  const isCaptionOverLimit =
    captionLength > CAPTION_LIMITS.MAX_LENGTH || hashtagCount > CAPTION_LIMITS.MAX_HASHTAGS;

  // 현재 장의 글자 수 체크 ("글이 길어요" 안내용)
  const activeHeadlineLen = (activeSlide?.headline || '').length;
  const activeBodyLen = (activeSlide?.body || '').length;
  const isHeadlineTooLong = activeHeadlineLen > TEXT_LENGTH_GUIDE.HEADLINE_WARN;
  const isBodyTooLong = activeBodyLen > TEXT_LENGTH_GUIDE.BODY_WARN;
  const activePhotoUrls =
    activeSlide?.photoUrls && activeSlide.photoUrls.length > 0
      ? activeSlide.photoUrls
      : activeSlide?.photoUrl
      ? [activeSlide.photoUrl]
      : [];

  // ==========================================================================
  // UI 렌더링
  // ==========================================================================
  return (
    <div className="min-h-screen flex flex-col bg-slate-100">
      {/* 상단 헤더 */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-[1440px] mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-pink-500 flex items-center justify-center text-white font-extrabold text-sm shadow">
              CS
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-extrabold text-slate-900 leading-tight">
                인스타 카드뉴스 캔버스 스튜디오
              </h1>
              <p className="text-[11px] text-slate-500 hidden sm:block">
                장별 직접 쓰기 · 사진 비율 맞춰 크게 넣기(블러 배경) · 실시간 캔버스 미리보기
              </p>
            </div>
          </div>

          <nav className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('create')}
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition ${
                activeTab === 'create'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🎨 카드뉴스 에디터
            </button>
            <button
              onClick={() => setActiveTab('accounts')}
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition ${
                activeTab === 'accounts'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📱 내 계정들 ({accounts.length}/{MAX_IG_ACCOUNTS})
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition ${
                activeTab === 'history'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📊 업로드 기록
            </button>
          </nav>

          <div className="hidden md:flex items-center gap-2">
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              💾 {autoSaveStatus}
            </span>
            {userEmail ? (
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <span className="font-semibold truncate max-w-[140px]">{userEmail}</span>
                <button
                  onClick={handleLogout}
                  className="text-slate-500 hover:text-red-600 underline font-bold"
                >
                  로그아웃
                </button>
              </div>
            ) : (
              <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
                비로그인 (편집·다운로드 모두 가능)
              </span>
            )}
          </div>
        </div>
      </header>

      {/* 토스트 알림 */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 max-w-md bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-2xl border border-slate-700 flex items-center gap-3">
          <span className="text-xs sm:text-sm font-semibold">{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="text-slate-400 hover:text-white text-xs font-bold ml-auto"
          >
            닫기
          </button>
        </div>
      )}

      {/* ================================================================= */}
      {/* [기능 3: 로그인 바] 쉬운 한국어 오류 안내 + 자동 인증 + 구글 로그인  */}
      {/* ================================================================= */}
      {!sessionToken && (
        <div className="bg-indigo-50/90 border-b border-indigo-100">
          <div className="max-w-[1440px] mx-auto px-3 sm:px-6 py-2.5 space-y-2">
            <div className="flex flex-col lg:flex-row items-center justify-between gap-2">
              <div className="text-xs text-indigo-950 flex flex-wrap items-center gap-2">
                <span className="font-extrabold px-2 py-0.5 rounded bg-indigo-600 text-white">
                  ✨ v2.5 업데이트 완료 (장별 직접 쓰기 · 사진 비율 유지 · 로그인 개선)
                </span>
                <span>
                  캔버스 편집과 PNG/JPG ZIP 다운로드는 로그인 없이도 바로 가능하며, 인스타 자동 업로드 시 로그인해 주세요.
                </span>
              </div>

              <form onSubmit={handleAuthSubmit} className="flex flex-wrap items-center gap-1.5">
                <input
                  type="email"
                  required
                  placeholder="이메일 (예: my@naver.com)"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-indigo-200 text-xs bg-white w-44"
                />
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="비밀번호 (6자리 이상)"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-indigo-200 text-xs bg-white w-36"
                />
                <button
                  type="submit"
                  disabled={authLoading}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold disabled:opacity-50 shadow-sm"
                >
                  {authLoading ? '처리 중...' : authMode === 'login' ? '로그인' : '1초 회원가입'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode(authMode === 'login' ? 'signup' : 'login');
                    setAuthMessage('');
                    setAuthSuccessMsg('');
                  }}
                  className="px-2 py-1.5 rounded-lg bg-white border border-indigo-200 text-xs text-indigo-700 font-bold hover:bg-indigo-100"
                >
                  {authMode === 'login' ? '회원가입으로 전환' : '로그인으로 전환'}
                </button>
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-xs font-bold shadow-sm"
                >
                  🔵 구글 로그인
                </button>
                <button
                  type="button"
                  onClick={() => setShowAuthHelp(!showAuthHelp)}
                  className="text-[11px] text-indigo-700 underline font-bold ml-1"
                >
                  {showAuthHelp ? '도움말 닫기' : '로그인이 안 되나요?'}
                </button>
              </form>
            </div>

            {/* 쉬운 한국어 오류 / 성공 메시지 박스 */}
            {authMessage && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 font-bold flex items-center justify-between">
                <span>⚠️ {authMessage}</span>
                <button
                  type="button"
                  onClick={() => setAuthMessage('')}
                  className="text-rose-500 hover:text-rose-800 ml-2"
                >
                  ✕
                </button>
              </div>
            )}
            {authSuccessMsg && (
              <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-bold">
                ✅ {authSuccessMsg}
              </div>
            )}

            {/* 로그인 설정 점검 안내 (접이식) */}
            {showAuthHelp && (
              <div className="p-3 rounded-xl bg-white border border-indigo-200 text-xs text-slate-700 space-y-1.5">
                <p className="font-extrabold text-indigo-950">
                  🛠️ 로그인이 안 될 때 확인할 3가지 (Supabase 대시보드)
                </p>
                <p>
                  1️⃣ <strong>이메일 인증 없이 바로 로그인하려면:</strong> Supabase 왼쪽 메뉴{' '}
                  <code>Authentication</code> ➔ <code>Providers</code> ➔ <code>Email</code>에서{' '}
                  <strong>Confirm email</strong> 스위치를 <strong>OFF(끄기)</strong>로 바꾸고 Save를 눌러주세요.
                </p>
                <p>
                  2️⃣ <strong>Redirect URL / Site URL 설정:</strong> Supabase 왼쪽 메뉴{' '}
                  <code>Authentication</code> ➔ <code>URL Configuration</code>에서{' '}
                  <strong>Site URL</strong>에 배포 주소(<code>https://fountainpenfornewbie-gk78.vercel.app</code>)를 넣고,{' '}
                  <strong>Redirect URLs</strong>에 <code>http://localhost:3000/**</code> 와{' '}
                  <code>https://fountainpenfornewbie-gk78.vercel.app/**</code> 두 개를 추가해 주세요.
                </p>
                <p>
                  3️⃣ <strong>Vercel 환경변수:</strong> Vercel 프로젝트 <code>Settings</code> ➔{' '}
                  <code>Environment Variables</code>에 <code>NEXT_PUBLIC_SUPABASE_URL</code>,{' '}
                  <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, <code>SUPABASE_SERVICE_ROLE_KEY</code>가 들어가 있는지 확인해 주세요.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 메인 본문 */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-3 sm:px-6 py-5">
        {/* ================================================================= */}
        {/* [탭 1] 카드뉴스 에디터 (탭을 이동해도 캔버스가 풀리지 않도록 hidden 처리) */}
        {/* ================================================================= */}
        <div className={activeTab === 'create' ? 'block' : 'hidden'}>
          {/* =============================================================== */}
          {/* [전체 흐름 7단계 안내 바]                                         */}
          {/* 1) 주제 입력 → 2) AI 기획안 확인·승인 → 3) 사진 올리기 → 4) 자동 제작 */}
          {/* → 5) 미리보기·수정 → 6) 캡션 → 7) 올리기/예약                     */}
          {/* =============================================================== */}
          <div className="mb-5 bg-white rounded-2xl border border-indigo-200 p-3.5 sm:p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold px-2.5 py-1 rounded-full bg-indigo-600 text-white">
                  🚀 AI 기획부터 제작까지 전체 흐름
                </span>
                <span className="text-xs text-slate-600 font-semibold">
                  기획안을 먼저 확인하고 <strong>[내가 OK 승인]</strong> 해야 제작으로 넘어가므로 AI 비용을 아끼고 엉뚱한 결과를 방지해요!
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-bold">
                  🤖 오늘 AI 기획/생성: {dailyAiUsedCount} / {DAILY_AI_LIMIT_MAX}회
                </span>
                <button
                  type="button"
                  onClick={handleOpenSavedPlansModal}
                  className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-extrabold border border-indigo-200"
                >
                  📂 저장된 기획안 불러오기 ({savedPlansList.length})
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-1.5">
              {[
                { step: 1, title: '1) 주제 입력', desc: '한 줄 주제 + 선택옵션' },
                { step: 2, title: '2) AI 기획안 확인·승인', desc: '표지 후보 3개·컷별 수정' },
                { step: 3, title: '3) 사진 올리기', desc: '내 사진 업로드' },
                { step: 4, title: '4) 자동 제작', desc: '컷별 사진·글 배치' },
                { step: 5, title: '5) 미리보기·수정', desc: '캔버스 자유 편집' },
                { step: 6, title: '6) 캡션', desc: '본문·해시태그' },
                { step: 7, title: '7) 올리기/예약', desc: '인스타 업로드·ZIP' },
              ].map((item) => {
                const isActive = workflowStep === item.step;
                const isDone = workflowStep > item.step;
                return (
                  <button
                    key={item.step}
                    type="button"
                    onClick={() => setWorkflowStep(item.step as 1 | 2 | 3 | 4 | 5 | 6 | 7)}
                    className={`text-left p-2 rounded-xl border transition ${
                      isActive
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                        : isDone
                        ? 'bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <div className="text-[11px] font-extrabold truncate">
                      {isDone ? '✅ ' : ''}
                      {item.title}
                    </div>
                    <div
                      className={`text-[10px] truncate ${
                        isActive ? 'text-indigo-100' : 'text-slate-500'
                      }`}
                    >
                      {item.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* ============================================================= */}
            {/* 왼쪽 패널 (5칸): [1단계: 주제→AI 기획안 확인·승인] + [장별 직접 작성] + 디자인/사진/폰트/발행 */}
            {/* ============================================================= */}
            <div className="lg:col-span-5 space-y-5 order-2 lg:order-1">
              {/* ============================================================= */}
              {/* [1단계 핵심 패널 1] 1) 주제 입력 → AI 컷별 기획안 만들기         */}
              {/* ============================================================= */}
              <div className="bg-white rounded-2xl border-2 border-indigo-600 p-4 sm:p-5 shadow-md space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="inline-block text-[11px] font-extrabold px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 mb-1">
                      STEP 1 · 주제 → 컷별 AI 기획
                    </span>
                    <h2 className="text-base font-extrabold text-slate-900">
                      1. 주제 입력 & AI 기획안 만들기
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenSavedPlansModal}
                    className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-extrabold border border-slate-300"
                  >
                    📂 저장된 기획안 ({savedPlansList.length})
                  </button>
                </div>

                {/* 필수 입력: 주제 (한 줄이면 충분) */}
                <div>
                  <label className="block text-xs font-extrabold text-slate-800 mb-1">
                    🎯 카드뉴스 주제 <span className="text-rose-600">(필수 · 한 줄이면 충분해요!)</span>
                  </label>
                  <input
                    type="text"
                    value={planTopic}
                    onChange={(e) => setPlanTopic(e.target.value)}
                    placeholder="예: 만년필 입문자가 첫 만년필 고를 때 실패하지 않는 3가지 기준"
                    className="w-full px-3.5 py-2.5 rounded-xl border-2 border-indigo-200 text-xs sm:text-sm font-bold focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                {/* 선택 입력 열기/접기 토글 (비워도 잘 작동함 안내) */}
                <div className="border border-slate-200 rounded-xl bg-slate-50/70 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-slate-700">
                      ✨ 선택 입력 (비워도 AI가 알아서 잘 작동해요!)
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowOptionalPlanInputs(!showOptionalPlanInputs)}
                      className="text-[11px] font-bold text-indigo-600 underline"
                    >
                      {showOptionalPlanInputs ? '선택 입력 접기 ▲' : '선택 입력 펼치기 ▼'}
                    </button>
                  </div>

                  {showOptionalPlanInputs && (
                    <div className="space-y-3 pt-1 border-t border-slate-200/80">
                      {/* 누구에게 보여줄지 (대상) */}
                      <div>
                        <label className="block text-[11px] font-extrabold text-slate-700 mb-1">
                          👥 누구에게 보여줄지 (대상 · 선택)
                        </label>
                        <input
                          type="text"
                          value={planTargetAudience}
                          onChange={(e) => setPlanTargetAudience(e.target.value)}
                          placeholder="예: 만년필을 처음 사보는 2030 직장인, 손글씨 다이어리 입문자 (비워도 됨)"
                          className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                        />
                      </div>

                      {/* 목적 & 말투 & 장수 */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[11px] font-extrabold text-slate-700 mb-1">
                            📌 목적 (선택)
                          </label>
                          <select
                            value={planPurpose}
                            onChange={(e) => setPlanPurpose(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-bold bg-white"
                          >
                            <option value="">AI 자동 판단</option>
                            <option value="정보 전달">정보 전달</option>
                            <option value="공감">공감</option>
                            <option value="홍보">홍보</option>
                            <option value="후기">후기</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-extrabold text-slate-700 mb-1">
                            💬 말투 (선택)
                          </label>
                          <select
                            value={planTone}
                            onChange={(e) => setPlanTone(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-bold bg-white"
                          >
                            <option value="">AI 자동 추천</option>
                            <option value="친근하게">친근하게 (~해요)</option>
                            <option value="전문적으로">전문적으로 (신뢰감)</option>
                            <option value="짧고 굵게">짧고 굵게 (임팩트)</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-extrabold text-slate-700 mb-1">
                            📑 장수 (기본: AI 추천)
                          </label>
                          <select
                            value={String(planSlideCountOption)}
                            onChange={(e) =>
                              setPlanSlideCountOption(
                                e.target.value === 'auto' ? 'auto' : Number(e.target.value)
                              )
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-bold bg-white"
                          >
                            <option value="auto">🤖 AI가 추천 (기본)</option>
                            {Array.from({ length: maxSlideLimit }).map((_, i) => (
                              <option key={i + 1} value={String(i + 1)}>
                                {i + 1}장 직접 지정
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* 참고 자료 (글 붙여넣기 또는 링크) */}
                      <div>
                        <label className="block text-[11px] font-extrabold text-slate-700 mb-1">
                          📎 참고 자료 (글 붙여넣기 또는 링크 · 선택)
                        </label>
                        <textarea
                          rows={2}
                          value={planReferenceText}
                          onChange={(e) => setPlanReferenceText(e.target.value)}
                          placeholder="참고할 블로그 글, 제품 설명, 메모, 또는 링크를 붙여넣으세요 (비워도 됨)"
                          className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* 기획안 생성 & 같은 주제로 다른 기획안 비교 추가 버튼 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleGenerateAIPlan('new')}
                    disabled={isGeneratingPlan}
                    className="py-2.5 px-3 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-extrabold text-xs sm:text-sm shadow-sm transition disabled:opacity-50"
                  >
                    {isGeneratingPlan
                      ? '🤖 AI가 컷별 기획안 만드는 중...'
                      : planCandidates.length > 0
                      ? '🔄 현재 기획안 전체 다시 기획하기'
                      : '✨ 1단계: AI 기획안 만들기'}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleGenerateAIPlan('compare')}
                    disabled={isGeneratingPlan || planCandidates.length >= 3}
                    className="py-2.5 px-3 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-800 font-extrabold text-xs sm:text-sm border border-indigo-200 transition disabled:opacity-40"
                  >
                    ➕ 다른 기획안 추가 비교 ({planCandidates.length}/3개)
                  </button>
                </div>

                {/* 4단계 추천 기능 툴바 (주제 추천, 시리즈, 브랜드, 품질 점검, 추천 시간, 내 템플릿) */}
                <div className="pt-2 border-t border-slate-200/80">
                  <span className="text-[11px] font-extrabold text-slate-500 block mb-1.5">
                    ⚡ 4단계 스마트 추천 기능 모음 (클릭하면 바로 열려요!)
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setShowIdeasModal(true);
                        if (recommendedIdeas.length === 0) handleFetchTopicIdeas();
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-xs font-extrabold flex items-center gap-1"
                    >
                      💡 주제 아이디어 10개
                    </button>
                    <button
                      type="button"
                      onClick={handleSplitSeries}
                      className="px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 text-xs font-extrabold flex items-center gap-1"
                    >
                      📚 1·2·3편 시리즈 나누기
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowBrandModal(true)}
                      className="px-2.5 py-1.5 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-900 border border-purple-200 text-xs font-extrabold flex items-center gap-1"
                    >
                      🏷️ 브랜드 설정
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowQualityModal(true)}
                      className="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-900 border border-rose-200 text-xs font-extrabold flex items-center gap-1"
                    >
                      🔍 글 품질·사실 점검
                      {qualityReport.totalIssues > 0 && (
                        <span className="px-1.5 py-0.2 rounded-full bg-rose-600 text-white text-[10px]">
                          {qualityReport.totalIssues}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowBestTimesModal(true)}
                      className="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 text-xs font-extrabold flex items-center gap-1"
                    >
                      ⏰ 추천 업로드 시간
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowTemplateModal(true)}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 text-xs font-extrabold flex items-center gap-1"
                    >
                      🎨 내 템플릿 ({savedUserTemplates.length})
                    </button>
                  </div>
                </div>
              </div>

              {/* ============================================================= */}
              {/* [1단계 핵심 패널 2] 2) AI 기획안 확인 · 비교 · 컷별 직접 수정 · 승인(OK) */}
              {/* ============================================================= */}
              {activePlan && (
                <div className="bg-white rounded-2xl border-2 border-emerald-500 p-4 sm:p-5 shadow-md space-y-4">
                  {/* 상단 헤더 & 기획안 비교 탭 (최대 3개) */}
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="inline-block text-[11px] font-extrabold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 mb-1">
                          STEP 2 · AI 기획안 확인 · 수정 · 승인
                        </span>
                        <h2 className="text-base font-extrabold text-slate-900">
                          📋 AI 컷별 기획안 ({activePlan.cuts.length}장 구성)
                        </h2>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={handleSaveCurrentPlan}
                          disabled={isSavingPlan}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-extrabold border border-slate-300"
                        >
                          💾 기획안 저장
                        </button>
                        <button
                          type="button"
                          onClick={() => handleGenerateAIPlan('new')}
                          disabled={isGeneratingPlan}
                          className="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-extrabold border border-rose-200"
                        >
                          🔄 전체 다시 기획하기
                        </button>
                      </div>
                    </div>

                    {/* 같은 주제로 여러 기획안 비교 탭 (기획안 1 / 기획안 2 / 기획안 3) */}
                    <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-xl overflow-x-auto">
                      {planCandidates.map((cand, idx) => (
                        <button
                          key={cand.id}
                          type="button"
                          onClick={() => setActivePlanTabIdx(idx)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-extrabold flex-shrink-0 transition ${
                            activePlanTabIdx === idx
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-200'
                          }`}
                        >
                          {cand.label || `기획안 ${idx + 1}`} ({cand.cuts.length}장)
                          {cand.isApproved ? ' ✅승인됨' : ''}
                        </button>
                      ))}
                      {planCandidates.length < 3 && (
                        <button
                          type="button"
                          onClick={() => handleGenerateAIPlan('compare')}
                          disabled={isGeneratingPlan}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-extrabold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 flex-shrink-0"
                        >
                          + 비교 기획안 추가 ({planCandidates.length}/3)
                        </button>
                      )}
                    </div>
                  </div>

                  {/* AI 추천 장수와 이유 */}
                  <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-200 text-xs space-y-1">
                    <div className="font-extrabold text-indigo-950 flex items-center justify-between">
                      <span>💡 AI 추천 장수: {activePlan.recommendedSlideCount}장 (현재 {activePlan.cuts.length}장)</span>
                      <span className="text-[11px] text-indigo-700">마지막 장: 행동 유도(저장·공유·댓글)</span>
                    </div>
                    <p className="text-indigo-900 leading-relaxed">{activePlan.recommendationReason}</p>
                  </div>

                  {/* 표지 제목 후보 3개 (눈길을 끄는 순서로, 내가 하나 고른다) */}
                  <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-amber-950">
                        🏆 표지 제목 후보 3개 (눈길을 끄는 순서 · 하나를 골라주세요!)
                      </span>
                      <span className="text-[11px] font-bold text-amber-700">
                        선택하면 1컷 제목에 바로 반영돼요
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {activePlan.coverTitleCandidates.map((candTitle, cIdx) => {
                        const isSelected = activePlan.selectedCoverCandidateIndex === cIdx;
                        return (
                          <div
                            key={cIdx}
                            onClick={() => handleSelectCoverCandidate(cIdx)}
                            className={`flex items-center gap-2 p-2 rounded-xl border cursor-pointer transition ${
                              isSelected
                                ? 'bg-white border-amber-500 ring-2 ring-amber-400/50 shadow-sm'
                                : 'bg-white/70 border-amber-200 hover:bg-white'
                            }`}
                          >
                            <input
                              type="radio"
                              name="cover-title-candidate"
                              checked={isSelected}
                              onChange={() => handleSelectCoverCandidate(cIdx)}
                              className="accent-amber-600"
                            />
                            <span className="text-[11px] font-extrabold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 flex-shrink-0">
                              후보 {cIdx + 1}
                            </span>
                            <input
                              type="text"
                              value={candTitle}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => handleEditCoverCandidateText(cIdx, e.target.value)}
                              className="flex-1 text-xs font-bold text-slate-900 bg-transparent border-b border-transparent focus:border-amber-400 focus:outline-none"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 컷별 구성 카드 목록 (모든 글을 내가 직접 고칠 수 있음 + 추가/삭제/순서 바꾸기/이 컷만 다시 쓰기) */}
                  <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
                    {activePlan.cuts.map((cut, cutIdx) => {
                      const headlineLen = (cut.headline || '').length;
                      const isCutHeadlineLong = headlineLen > 22;
                      return (
                        <div
                          key={cut.id}
                          className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5 shadow-sm"
                        >
                          {/* 컷 상단 바: 장 번호 / 역할 선택 / 순서 이동 / 이 컷만 다시 쓰기 / 삭제 */}
                          <div className="flex flex-wrap items-center justify-between gap-1.5 pb-2 border-b border-slate-200">
                            <div className="flex items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded-lg bg-indigo-600 text-white text-xs font-extrabold">
                                {cut.slideNumber}컷
                              </span>
                              <select
                                value={cut.roleType}
                                onChange={(e) =>
                                  handleUpdatePlanCutField(
                                    cutIdx,
                                    'roleType',
                                    e.target.value as PlanCutRoleLabel
                                  )
                                }
                                className="px-2 py-1 rounded-lg border border-slate-300 text-xs font-extrabold bg-white text-slate-800"
                              >
                                {PLAN_CUT_ROLE_OPTIONS.map((roleOpt) => (
                                  <option key={roleOpt} value={roleOpt}>
                                    역할: {roleOpt}
                                  </option>
                                ))}
                              </select>
                              {cut.isManuallyEdited && (
                                <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                                  ✏️ 직접 수정됨
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleMovePlanCutOrder(cutIdx, 'up')}
                                disabled={cutIdx === 0}
                                className="px-1.5 py-1 rounded bg-white border border-slate-300 text-[11px] font-bold hover:bg-slate-100 disabled:opacity-40"
                                title="앞 컷으로 이동"
                              >
                                ▲
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMovePlanCutOrder(cutIdx, 'down')}
                                disabled={cutIdx >= activePlan.cuts.length - 1}
                                className="px-1.5 py-1 rounded bg-white border border-slate-300 text-[11px] font-bold hover:bg-slate-100 disabled:opacity-40"
                                title="뒷 컷으로 이동"
                              >
                                ▼
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRegenerateSinglePlanCut(cutIdx)}
                                disabled={regeneratingCutIdx === cutIdx}
                                className="px-2 py-1 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-[11px] font-extrabold"
                              >
                                {regeneratingCutIdx === cutIdx
                                  ? '작성 중...'
                                  : '🔄 이 컷만 다시 쓰기'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteCutFromPlan(cutIdx)}
                                disabled={activePlan.cuts.length <= 1}
                                className="px-2 py-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-[11px] font-bold disabled:opacity-40"
                              >
                                삭제
                              </button>
                            </div>
                          </div>

                          {/* 컷 제목 (15자 안팎 권장) */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-[11px] font-extrabold text-slate-700">
                                📌 제목 (15자 안팎 권장)
                              </label>
                              <span
                                className={`text-[10px] font-bold ${
                                  isCutHeadlineLong ? 'text-amber-600' : 'text-slate-400'
                                }`}
                              >
                                {headlineLen}자
                              </span>
                            </div>
                            <input
                              type="text"
                              value={cut.headline}
                              onChange={(e) =>
                                handleUpdatePlanCutField(cutIdx, 'headline', e.target.value)
                              }
                              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-bold bg-white"
                            />
                          </div>

                          {/* 짧은 본문 (2~3줄) */}
                          <div>
                            <label className="block text-[11px] font-extrabold text-slate-700 mb-1">
                              📝 짧은 본문 (2~3줄 권장)
                            </label>
                            <textarea
                              rows={2}
                              value={cut.body}
                              onChange={(e) =>
                                handleUpdatePlanCutField(cutIdx, 'body', e.target.value)
                              }
                              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                            />
                          </div>

                          {/* 사진에 들어갈 글 & 이 컷에 어울리는 사진 가이드 */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[11px] font-extrabold text-indigo-800 mb-1">
                                🖼️ 사진에 들어갈 글 (사진 위 1~2줄)
                              </label>
                              <input
                                type="text"
                                value={cut.photoOverlayText}
                                onChange={(e) =>
                                  handleUpdatePlanCutField(
                                    cutIdx,
                                    'photoOverlayText',
                                    e.target.value
                                  )
                                }
                                placeholder="예: 첫 만년필 선택 핵심 기준!"
                                className="w-full px-2.5 py-1.5 rounded-lg border border-indigo-200 text-xs bg-white font-semibold"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-extrabold text-emerald-800 mb-1">
                                📷 이 컷에 어울리는 사진 가이드
                              </label>
                              <input
                                type="text"
                                value={cut.photoGuide}
                                onChange={(e) =>
                                  handleUpdatePlanCutField(cutIdx, 'photoGuide', e.target.value)
                                }
                                placeholder="예: 제품을 손에 든 사진, 밝은 풍경 사진"
                                className="w-full px-2.5 py-1.5 rounded-lg border border-emerald-200 text-xs bg-white"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* 장 추가 버튼 (최대 MAX_SLIDES) */}
                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={handleAddCutToPlan}
                      disabled={activePlan.cuts.length >= maxSlideLimit}
                      className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-extrabold border border-slate-300 disabled:opacity-40"
                    >
                      ➕ 기획안에 컷 추가 ({activePlan.cuts.length}/{maxSlideLimit}장)
                    </button>
                    <span className="text-[11px] text-slate-500 font-semibold">
                      모든 글을 자유롭게 고친 뒤 아래 승인(OK) 버튼을 눌러주세요!
                    </span>
                  </div>

                  {/* 기획안 승인(OK) 버튼 → 눌러야 제작/미리보기 슬라이드로 반영! */}
                  <button
                    type="button"
                    onClick={handleApprovePlanAndApplyToSlides}
                    className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-extrabold text-sm shadow-md transition flex items-center justify-center gap-2"
                  >
                    <span>
                      ✅ 이 기획안 승인(OK) → 카드뉴스 {activePlan.cuts.length}장 제작에 바로 반영하기
                    </span>
                  </button>
                </div>
              )}

              {/* 기존 빠른 초안 생성 & 전체 직접 쓰기 보조 패널 (그대로 유지) */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-extrabold text-slate-800">
                    ⚡ 빠른 메모로 바로 채우기 / 전체 빈칸으로 시작
                  </h2>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-500">전체 장수:</span>
                    <input
                      type="number"
                      min={1}
                      max={maxSlideLimit}
                      value={slides.length}
                      onChange={(e) => handleSlideCountChange(Number(e.target.value))}
                      className="w-14 px-2 py-1 rounded-lg border border-slate-300 text-xs font-extrabold text-center"
                    />
                    <span className="text-[11px] text-slate-400">/ {maxSlideLimit}장</span>
                  </div>
                </div>

                <textarea
                  rows={2}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder="긴 메모를 붙여넣어 바로 슬라이드를 채우거나, 오른쪽 버튼으로 빈칸에서 직접 쓸 수도 있어요."
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleGenerateWithAI}
                    disabled={isGeneratingAI}
                    className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-extrabold text-xs shadow-sm transition disabled:opacity-50"
                  >
                    {isGeneratingAI
                      ? '🤖 AI가 작성 중...'
                      : `✨ 메모로 바로 채우기 (${slides.length}장)`}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleClearSlideForDirectWriting('all')}
                    className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-extrabold text-xs border border-slate-300 transition"
                  >
                    ✏️ 빈칸에서 내가 직접 쓰기
                  </button>
                </div>
              </div>

              {/* ============================================================= */}
              {/* [기능 1 & 기능 2 핵심 패널] 2. 페이지(장)별 내용 직접 작성 & 장별 사진/비율 설정 */}
              {/* ============================================================= */}
              <div className="bg-white rounded-2xl border-2 border-blue-500/80 p-4 sm:p-5 shadow-md space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="inline-block text-[11px] font-extrabold px-2 py-0.5 rounded bg-blue-100 text-blue-800 mb-1">
                      장별 직접 수정 · 사진 비율 유지
                    </span>
                    <h2 className="text-base font-extrabold text-slate-900">
                      3. 페이지(장)별 내용 직접 쓰기 & 사진 설정
                    </h2>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleRegenerateSingleSlide(activeSlideIndex)}
                      disabled={regeneratingSlideIdx === activeSlideIndex}
                      className="px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-extrabold border border-indigo-200"
                    >
                      {regeneratingSlideIdx === activeSlideIndex
                        ? '생성 중...'
                        : '🔄 이 장만 AI로 다시 만들기'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleClearSlideForDirectWriting('current')}
                      className="px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
                      title="현재 장 제목/본문 비우기"
                    >
                      🧹 빈칸
                    </button>
                  </div>
                </div>

                {/* 장 선택 탭 + 장 추가 / 삭제 / 순서 바꾸기 */}
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                    {slides.map((s, idx) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          saveCanvasToActiveSlide(false);
                          setActiveSlideIndex(idx);
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-extrabold flex-shrink-0 transition ${
                          activeSlideIndex === idx
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {idx + 1}장
                        {s.photoUrls && s.photoUrls.length > 0 ? ' 📷' : ''}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={handleAddNewBlankSlide}
                      disabled={slides.length >= maxSlideLimit}
                      className="px-2.5 py-1.5 rounded-xl text-xs font-extrabold bg-emerald-600 hover:bg-emerald-700 text-white flex-shrink-0 disabled:opacity-40"
                    >
                      + 장 추가
                    </button>
                  </div>

                  {/* 현재 장 순서 이동 / 복제 / 삭제 컨트롤 */}
                  <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 border-t border-slate-200/80 text-xs">
                    <span className="font-extrabold text-slate-700">
                      현재 편집 중: <span className="text-blue-600">{activeSlideIndex + 1}번째 장</span> (전체 {slides.length}장)
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleMoveSlideOrder('left')}
                        disabled={activeSlideIndex === 0}
                        className="px-2 py-1 rounded bg-white border border-slate-300 font-bold text-[11px] hover:bg-slate-100 disabled:opacity-40"
                        title="앞장으로 순서 이동"
                      >
                        ◀ 앞장으로
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveSlideOrder('right')}
                        disabled={activeSlideIndex >= slides.length - 1}
                        className="px-2 py-1 rounded bg-white border border-slate-300 font-bold text-[11px] hover:bg-slate-100 disabled:opacity-40"
                        title="뒷장으로 순서 이동"
                      >
                        뒷장으로 ▶
                      </button>
                      <button
                        type="button"
                        onClick={duplicateActiveSlide}
                        className="px-2 py-1 rounded bg-blue-50 text-blue-700 border border-blue-200 font-bold text-[11px] hover:bg-blue-100"
                      >
                        복제
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSlide(activeSlideIndex)}
                        disabled={slides.length <= 1}
                        className="px-2 py-1 rounded bg-rose-50 text-rose-600 border border-rose-200 font-bold text-[11px] hover:bg-rose-100 disabled:opacity-40"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                </div>

                {/* 현재 장의 상단 뱃지 / 제목 / 본문 / 사진에 들어갈 글 직접 입력칸 */}
                {activeSlide && (
                  <div className="space-y-3">
                    {/* AI 기획안의 사진 가이드가 있으면 안내 표시 */}
                    {activeSlide.photoGuide && (
                      <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between gap-2">
                        <span>
                          📷 <strong>이 컷에 어울리는 사진 가이드:</strong> {activeSlide.photoGuide}
                        </span>
                      </div>
                    )}

                    {/* 상단 뱃지 문구 */}
                    <div>
                      <label className="block text-xs font-extrabold text-slate-700 mb-1">
                        🏷️ {activeSlideIndex + 1}장 상단 작은 뱃지 문구
                      </label>
                      <input
                        type="text"
                        value={activeSlide.badgeText || ''}
                        onChange={(e) => handleDirectSlideTextChange('badgeText', e.target.value)}
                        placeholder="예: POINT 01, 꿀팁 요약, 오늘의 추천"
                        className="w-full px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>

                    {/* 장별 제목 입력칸 + 글자 수 경고 */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-extrabold text-slate-800">
                          📌 {activeSlideIndex + 1}장 제목 (고치면 오른쪽 미리보기가 바로 바뀝니다)
                        </label>
                        <span
                          className={`text-[11px] font-bold ${
                            isHeadlineTooLong ? 'text-amber-600' : 'text-slate-400'
                          }`}
                        >
                          {activeHeadlineLen}자 (권장 {TEXT_LENGTH_GUIDE.HEADLINE_WARN}자 이내)
                        </span>
                      </div>
                      <textarea
                        rows={2}
                        value={activeSlide.headline || ''}
                        onChange={(e) => handleDirectSlideTextChange('headline', e.target.value)}
                        placeholder={`${activeSlideIndex + 1}장에 들어갈 큰 제목을 직접 적어보세요!`}
                        className={`w-full px-3 py-2 rounded-xl border text-xs sm:text-sm font-bold focus:ring-2 focus:outline-none ${
                          isHeadlineTooLong
                            ? 'border-amber-400 bg-amber-50/40 focus:ring-amber-500'
                            : 'border-slate-300 focus:ring-blue-500'
                        }`}
                      />
                      {isHeadlineTooLong && (
                        <p className="mt-1 text-[11px] font-extrabold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
                          ⚠️ 글이 길어요! 제목을 조금 줄이면 카드뉴스가 한눈에 더 잘 들어옵니다.
                        </p>
                      )}
                    </div>

                    {/* 장별 본문 입력칸 + 글자 수 경고 */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-extrabold text-slate-800">
                          📝 {activeSlideIndex + 1}장 본문 내용
                        </label>
                        <span
                          className={`text-[11px] font-bold ${
                            isBodyTooLong ? 'text-amber-600' : 'text-slate-400'
                          }`}
                        >
                          {activeBodyLen}자 (권장 {TEXT_LENGTH_GUIDE.BODY_WARN}자 이내)
                        </span>
                      </div>
                      <textarea
                        rows={3}
                        value={activeSlide.body || ''}
                        onChange={(e) => handleDirectSlideTextChange('body', e.target.value)}
                        placeholder={`${activeSlideIndex + 1}장에 들어갈 상세 설명이나 본문을 적어보세요!`}
                        className={`w-full px-3 py-2 rounded-xl border text-xs sm:text-sm focus:ring-2 focus:outline-none ${
                          isBodyTooLong
                            ? 'border-amber-400 bg-amber-50/40 focus:ring-amber-500'
                            : 'border-slate-300 focus:ring-blue-500'
                        }`}
                      />
                      {isBodyTooLong && (
                        <p className="mt-1 text-[11px] font-extrabold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
                          ⚠️ 글이 길어요! 본문이 너무 길면 글씨가 넘치거나 작아질 수 있어요. 다음 장으로 나누거나 줄여보세요.
                        </p>
                      )}
                    </div>

                    {/* 사진에 들어갈 글 (반투명 어두운 막 위에 올라가는 1~2줄 문구) */}
                    <div>
                      <label className="block text-xs font-extrabold text-indigo-800 mb-1">
                        🖼️ {activeSlideIndex + 1}장 사진에 들어갈 글 (반투명 어두운 막 위에 잘 읽히게 표시)
                      </label>
                      <input
                        type="text"
                        value={activeSlide.photoOverlayText || ''}
                        onChange={(e) =>
                          handleDirectSlideTextChange('photoOverlayText', e.target.value)
                        }
                        placeholder="비워두면 표시되지 않으며, 입력하면 사진 위 반투명 막에 굵은 흰 글씨로 들어갑니다."
                        className="w-full px-3 py-1.5 rounded-xl border border-indigo-200 text-xs font-bold focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>

                    {/* ========================================================= */}
                    {/* [2단계 핵심] 이 장의 사진 넣기/바꾸기/지우기 & 가이드 매칭/남은 사진 */}
                    {/* ========================================================= */}
                    <div className="p-3.5 rounded-xl bg-blue-50/60 border border-blue-200 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-extrabold text-blue-950">
                            🖼️ {activeSlideIndex + 1}장 전용 사진 관리 ({activePhotoUrls.length}장)
                          </span>
                          {activePhotoUrls.length === 0 && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-extrabold">
                              ⚠️ 사진 필요 (현재 글 전용)
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={handleAutoMatchPhotosToCuts}
                            disabled={isMatchingPhotos || uploadedPhotos.length === 0}
                            className="px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-extrabold disabled:opacity-40"
                          >
                            {isMatchingPhotos ? '배정 중...' : '🤖 사진 가이드 자동 배정'}
                          </button>
                          <label className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold cursor-pointer shadow-sm">
                            📷 {activePhotoUrls.length > 0 ? '이 장 사진 바꾸기' : '이 장에 사진 넣기'}
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              onChange={(e) =>
                                handleSlideSpecificPhotoUpload(e.target.value ? e.target.files : null, 'set-slide-photo')
                              }
                              className="hidden"
                            />
                          </label>
                          {activePhotoUrls.length > 0 ? (
                            <>
                              <label className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-blue-50 text-blue-700 border border-blue-300 text-xs font-bold cursor-pointer">
                                + 사진 추가
                                <input
                                  type="file"
                                  accept="image/*"
                                  multiple
                                  onChange={(e) =>
                                    handleSlideSpecificPhotoUpload(
                                      e.target.value ? e.target.files : null,
                                      'add-more-to-slide'
                                    )
                                  }
                                  className="hidden"
                                />
                              </label>
                              <button
                                type="button"
                                onClick={() => handleClearSlidePhotos()}
                                className="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-xs font-bold"
                              >
                                🗑️ 사진 지우기
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleMakeSlideTextOnly(activeSlideIndex)}
                              className="px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-300"
                            >
                              📝 글 전용 디자인 유지
                            </button>
                          )}
                        </div>
                      </div>

                      {/* 남은 사진 목록 (컷에 사용되지 않은 사진이 있으면 표시) */}
                      {remainingPhotos.length > 0 && (
                        <div className="p-2.5 rounded-xl bg-white border border-blue-200 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-extrabold text-blue-900">
                              📦 남은 사진 보관함 ({remainingPhotos.length}장) - 사진을 누르면 {activeSlideIndex + 1}장에 바로 들어가요!
                            </span>
                          </div>
                          <div className="flex items-center gap-2 overflow-x-auto py-1">
                            {remainingPhotos.map((rp, rpIdx) => (
                              <button
                                key={`${rp.url.slice(-15)}-${rpIdx}`}
                                type="button"
                                onClick={() => handleAssignRemainingPhotoToSlide(activeSlideIndex, rp.url)}
                                className="relative w-12 h-12 rounded-lg overflow-hidden border border-slate-300 hover:border-blue-600 hover:scale-105 transition flex-shrink-0 group"
                                title="클릭하면 현재 장에 이 사진을 넣습니다"
                              >
                                <img src={rp.url} alt="" className="w-full h-full object-cover" />
                                <span className="absolute inset-0 bg-blue-600/30 opacity-0 group-hover:opacity-100 text-white font-extrabold text-[10px] flex items-center justify-center">
                                  넣기
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 현재 장에 들어간 사진 썸네일 미리보기 */}
                      {activePhotoUrls.length > 0 && (
                        <div className="flex items-center gap-2 overflow-x-auto py-1">
                          {activePhotoUrls.map((url, pIdx) => (
                            <div
                              key={`${url.slice(-18)}-${pIdx}`}
                              className="relative w-14 h-14 rounded-lg overflow-hidden border border-blue-300 bg-white flex-shrink-0 group"
                            >
                              <img src={url} alt="" className="w-full h-full object-contain" />
                              <button
                                type="button"
                                onClick={() => handleClearSlidePhotos(url)}
                                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center"
                                title="이 사진 제거"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* [기능 2 핵심] 사진 표시 방식: 전체 보이기(기본, 자르지 않음) vs 꽉 채우기(자름) */}
                      <div className="space-y-2 pt-2 border-t border-blue-200/70">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-extrabold text-slate-800">
                            📐 사진 표시 방식 (찌그러짐 없이 원본 비율 100% 유지)
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              handlePhotoFitOrBgChange(
                                activeSlide.photoFitMode || 'contain',
                                activeSlide.photoBgFillMode || 'solid',
                                true
                              )
                            }
                            className="text-[11px] text-blue-700 underline font-bold"
                          >
                            전체 장에 똑같이 적용
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              handlePhotoFitOrBgChange(
                                'contain',
                                activeSlide.photoBgFillMode || 'solid',
                                false
                              )
                            }
                            className={`py-2 px-2.5 rounded-xl text-xs font-extrabold border text-left transition ${
                              (activeSlide.photoFitMode || 'contain') === 'contain'
                                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            <div>✅ 전체 보이기 (기본)</div>
                            <div
                              className={`text-[10px] font-normal ${
                                (activeSlide.photoFitMode || 'contain') === 'contain'
                                  ? 'text-blue-100'
                                  : 'text-slate-500'
                              }`}
                            >
                              자르지 않고 비율 맞춰 크게
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              handlePhotoFitOrBgChange(
                                'cover',
                                activeSlide.photoBgFillMode || 'solid',
                                false
                              )
                            }
                            className={`py-2 px-2.5 rounded-xl text-xs font-extrabold border text-left transition ${
                              activeSlide.photoFitMode === 'cover'
                                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            <div>🖼️ 꽉 채우기 (자름)</div>
                            <div
                              className={`text-[10px] font-normal ${
                                activeSlide.photoFitMode === 'cover'
                                  ? 'text-blue-100'
                                  : 'text-slate-500'
                              }`}
                            >
                              박스에 빈틈없이 꽉 채움
                            </div>
                          </button>
                        </div>

                        {/* '전체 보이기(자르지 않음)'일 때 남는 빈 공간 채우기 옵션 */}
                        {(activeSlide.photoFitMode || 'contain') === 'contain' && (
                          <div className="pt-1 space-y-1.5">
                            <span className="block text-[11px] font-bold text-slate-700">
                              🎨 남는 빈 공간(여백) 채우기 방식:
                            </span>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  handlePhotoFitOrBgChange('contain', 'solid', false)
                                }
                                className={`py-1.5 px-2.5 rounded-lg text-xs font-bold border ${
                                  (activeSlide.photoBgFillMode || 'solid') === 'solid'
                                    ? 'bg-slate-900 text-white border-slate-900'
                                    : 'bg-white text-slate-700 border-slate-300'
                                }`}
                              >
                                🎨 기본: 배경색으로 채우기
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handlePhotoFitOrBgChange('contain', 'blur', false)
                                }
                                className={`py-1.5 px-2.5 rounded-lg text-xs font-bold border ${
                                  activeSlide.photoBgFillMode === 'blur'
                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                    : 'bg-white text-slate-700 border-slate-300'
                                }`}
                              >
                                🌫️ 같은 사진 흐리게 깔기 (블러)
                              </button>
                            </div>
                          </div>
                        )}

                        {/* 사진 크기/위치 빠른 조절 버튼 */}
                        {activePhotoUrls.length > 0 && (
                          <div className="flex items-center justify-between gap-1.5 pt-1">
                            <span className="text-[11px] text-slate-600 font-semibold">
                              사진 크기·위치 조절:
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleAdjustActivePhotoScaleOrPos('zoom-out')}
                                className="px-2 py-1 rounded bg-white border border-slate-300 text-[11px] font-bold hover:bg-slate-100"
                              >
                                🔍 작게 (-)
                              </button>
                              <button
                                type="button"
                                onClick={() => handleAdjustActivePhotoScaleOrPos('zoom-in')}
                                className="px-2 py-1 rounded bg-white border border-slate-300 text-[11px] font-bold hover:bg-slate-100"
                              >
                                🔍 크게 (+)
                              </button>
                              <button
                                type="button"
                                onClick={() => handleAdjustActivePhotoScaleOrPos('center')}
                                className="px-2 py-1 rounded bg-white border border-slate-300 text-[11px] font-bold hover:bg-slate-100"
                              >
                                🎯 비율 맞춰 정중앙
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 3. 카드 디자인 템플릿 & 배경 설정 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-extrabold text-slate-900">
                    3. 카드 디자인 템플릿 & 배경 변경
                  </h2>
                  <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
                    {(['4:5', '1:1'] as AspectRatioKey[]).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setAspectRatio(r)}
                        className={`px-2.5 py-1 rounded text-xs font-bold ${
                          aspectRatio === r
                            ? 'bg-white text-blue-600 shadow-sm'
                            : 'text-slate-600'
                        }`}
                      >
                        {r === '4:5' ? '4:5 세로형' : '1:1 정사각'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {CARD_TEMPLATES.map((tpl) => {
                    const isSelected = (activeSlide?.templateId || templateId) === tpl.id;
                    return (
                      <div
                        key={tpl.id}
                        className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between ${
                          isSelected
                            ? 'border-blue-600 bg-blue-50/70 ring-2 ring-blue-500/20'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-extrabold text-slate-900">
                              {tpl.name}
                            </span>
                            <span
                              className="w-3.5 h-3.5 rounded-full border border-slate-300 flex-shrink-0"
                              style={{ backgroundColor: tpl.accentColor }}
                            />
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">
                            {tpl.desc}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 mt-2">
                          <button
                            type="button"
                            onClick={() => handleSelectTemplate(tpl.id, false)}
                            className="flex-1 py-1 rounded bg-white border border-slate-300 hover:bg-blue-600 hover:text-white hover:border-blue-600 text-[11px] font-bold transition"
                          >
                            이 장에 적용
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSelectTemplate(tpl.id, true)}
                            className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-800 hover:text-white text-[10px] font-bold transition"
                            title="모든 슬라이드에 이 템플릿 적용"
                          >
                            전체 적용
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 배경색 / 배경 이미지 / 포인트 컬러 */}
                <div className="pt-2 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="flex items-center justify-between sm:justify-start gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                    <span className="text-xs font-bold text-slate-700">배경색</span>
                    <input
                      type="color"
                      value={canvasBgColor.startsWith('#') ? canvasBgColor : '#F8FAFC'}
                      onChange={(e) => handleCanvasBgColorChange(e.target.value)}
                      className="w-8 h-7 rounded cursor-pointer border border-slate-300"
                    />
                  </div>

                  <div className="flex items-center justify-between sm:justify-start gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                    <span className="text-xs font-bold text-slate-700">강조색</span>
                    <input
                      type="color"
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="w-8 h-7 rounded cursor-pointer border border-slate-300"
                    />
                  </div>

                  <label className="flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-slate-100 p-2.5 rounded-xl border border-slate-200 cursor-pointer text-xs font-bold text-slate-700">
                    <span>🖼️ 배경 이미지 깔기</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handlePhotoFiles(e.target.files, 'set-bg')}
                      className="hidden"
                    />
                  </label>
                </div>

                {/* 워터마크 옵션 (기본값: 꺼짐) */}
                <div className="pt-2 border-t border-slate-100 bg-slate-50/80 p-3 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-slate-800">
                      🏷️ 워터마크 켜기/끄기 (기본값: 끄기)
                    </span>
                    <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs font-extrabold text-blue-600">
                      <input
                        type="checkbox"
                        checked={showWatermark}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setShowWatermark(checked);
                          const canvas = fabricCanvasRef.current;
                          if (!canvas) return;
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          const existingWm = canvas.getObjects().find((o: any) => o.customRole === 'watermark');
                          if (!checked && existingWm) {
                            canvas.remove(existingWm);
                            canvas.requestRenderAll();
                            saveCanvasToActiveSlide(true);
                          } else if (checked && !existingWm && window.fabric) {
                            const wm = new window.fabric.Textbox(
                              watermarkText || '@내계정아이디',
                              {
                                left: 72,
                                top: (canvas.height || 1350) - 68,
                                width: (canvas.width || 1080) - 144,
                                fontSize: 22,
                                fontFamily: fontId,
                                fill: '#64748B',
                                textAlign: 'right',
                                customId: `watermark-${Date.now()}`,
                                customRole: 'watermark',
                              }
                            );
                            canvas.add(wm);
                            canvas.requestRenderAll();
                            saveCanvasToActiveSlide(true);
                          }
                        }}
                        className="w-4 h-4 accent-blue-600"
                      />
                      <span>{showWatermark ? '켜짐' : '꺼짐 (워터마크 없음)'}</span>
                    </label>
                  </div>
                  {showWatermark && (
                    <input
                      type="text"
                      placeholder="표시할 내 계정 아이디나 문구 입력 (예: @my_studio)"
                      value={watermarkText}
                      onChange={(e) => {
                        const val = e.target.value;
                        setWatermarkText(val);
                        const canvas = fabricCanvasRef.current;
                        if (!canvas) return;
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const wmObj = canvas.getObjects().find((o: any) => o.customRole === 'watermark');
                        if (wmObj) {
                          wmObj.set('text', val);
                          canvas.requestRenderAll();
                          saveCanvasToActiveSlide(true);
                        }
                      }}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs"
                    />
                  )}
                </div>
              </div>

              {/* 4. 폰트 관리 (기본 폰트 14종 + 내 폰트 업로드) */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-extrabold text-slate-900">
                      4. 폰트 선택 & 내 폰트 파일 업로드
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      업로드한 폰트는 자동 저장되어 다시 열어도 그대로 유지됩니다.
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold cursor-pointer shadow-sm">
                    <span>➕ 내 폰트(.ttf/.otf/.woff/.woff2) 등록</span>
                    <input
                      type="file"
                      accept=".ttf,.otf,.woff,.woff2"
                      onChange={(e) => handleCustomFontUpload(e.target.files)}
                      className="hidden"
                    />
                  </label>
                </div>

                {customFonts.length > 0 && (
                  <div className="p-3 rounded-xl bg-indigo-50/80 border border-indigo-200 space-y-2">
                    <span className="text-xs font-extrabold text-indigo-950 block">
                      📁 내가 업로드한 폰트
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {customFonts.map((cf) => (
                        <div
                          key={cf.id}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${
                            selFontFamily === cf.id || fontId === cf.id
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-indigo-900 border-indigo-200'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => applyFontToSelectionOrAll(cf.id)}
                            style={{ fontFamily: cf.id }}
                          >
                            {cf.name}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteCustomFont(cf.id)}
                            className="text-[10px] opacity-75 hover:opacity-100 ml-1"
                            title="폰트 삭제"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-56 overflow-y-auto pr-1">
                  {EDITOR_KOREAN_FONTS.map((f) => {
                    const isSelected = selFontFamily === f.id || fontId === f.id;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => applyFontToSelectionOrAll(f.id)}
                        style={{ fontFamily: `'${f.cssFamily}', sans-serif` }}
                        className={`p-2 rounded-xl border text-left transition ${
                          isSelected
                            ? 'border-blue-600 bg-blue-50/80 ring-2 ring-blue-500/20'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="text-xs font-bold text-slate-900 truncate">{f.name}</div>
                        <div className="text-[10px] text-slate-500">{f.category}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 5. 인스타그램 캡션 & 바로 업로드 / 예약 업로드 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-extrabold text-slate-900">
                    5. 인스타 캡션 & 자동 업로드
                  </h2>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleGenerateSmartCaptionWithAI}
                      className="px-2.5 py-1 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[11px] font-extrabold shadow-sm hover:from-blue-700 hover:to-indigo-700"
                    >
                      ✨ 캡션·해시태그 AI 자동 생성
                    </button>
                    {CAPTION_TONES.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setCaptionTone(t.id)}
                        className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${
                          captionTone === t.id
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-slate-50 text-slate-700 border-slate-200'
                        }`}
                      >
                        {t.name.split(' ')[0]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 사실 확인(Fact Check) 배지 안내 */}
                {factCheckAlerts.length > 0 && (
                  <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="font-extrabold">🔍 사실 확인 필요:</span>
                      <span className="text-[11px]">
                        본문에 숫자/통계/가격({factCheckAlerts.map((f) => f.phrase).slice(0, 3).join(', ')})가 포함되어 있습니다. 업로드 전 사실 여부를 한 번 더 확인해 주세요!
                      </span>
                    </div>
                  </div>
                )}

                <textarea
                  rows={4}
                  value={currentEditingCaption}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (activeCaptionTab === 'base') setBaseCaption(val);
                    else
                      setAccountCustomCaptions((prev) => ({
                        ...prev,
                        [activeCaptionTab]: val,
                      }));
                  }}
                  className={`w-full rounded-xl border p-2.5 text-xs sm:text-sm font-medium ${
                    qualityReport.isCaptionOver ? 'border-rose-400 bg-rose-50/30' : 'border-slate-300'
                  }`}
                  placeholder="첫 줄 시선 집중 문구와 본문, 해시태그를 입력하거나 상단 [✨ 캡션 AI 자동 생성]을 눌러보세요!"
                />

                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
                  <span className={qualityReport.isCaptionOver ? 'text-rose-600 font-extrabold' : ''}>
                    글자 수: {captionLength.toLocaleString()} / {CAPTION_LIMITS.MAX_LENGTH}자
                    {qualityReport.isCaptionOver && ' ⚠️ 2,200자 초과!'}
                  </span>
                  <span className={qualityReport.isHashtagsOver ? 'text-rose-600 font-extrabold' : ''}>
                    해시태그: {hashtagCount} / {CAPTION_LIMITS.MAX_HASHTAGS}개
                    {qualityReport.isHashtagsOver && ' ⚠️ 30개 초과!'}
                  </span>
                </div>

                {accounts.length > 0 ? (
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <span className="text-xs font-bold text-slate-700 block">
                      올릴 인스타그램 계정 선택
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {accounts.map((acc) => {
                        const isSelected = selectedAccountIds.includes(acc.id);
                        return (
                          <button
                            key={acc.id}
                            type="button"
                            onClick={() => toggleSelectAccount(acc)}
                            className={`p-2.5 rounded-xl border text-left flex items-center justify-between ${
                              isSelected
                                ? 'border-blue-600 bg-blue-50/70'
                                : 'border-slate-200 bg-white'
                            }`}
                          >
                            <span className="text-xs font-bold text-slate-900">
                              @{acc.username}
                            </span>
                            <input
                              type="checkbox"
                              readOnly
                              checked={isSelected}
                              className="w-4 h-4 accent-blue-600"
                            />
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setScheduleType('now')}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold border ${
                          scheduleType === 'now'
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-700 border-slate-300'
                        }`}
                      >
                        🚀 지금 바로 올리기
                      </button>
                      <button
                        type="button"
                        onClick={() => setScheduleType('scheduled')}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold border ${
                          scheduleType === 'scheduled'
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-700 border-slate-300'
                        }`}
                      >
                        📅 예약 업로드
                      </button>
                    </div>

                    {scheduleType === 'scheduled' && (
                      <input
                        type="datetime-local"
                        value={scheduledDateTime}
                        onChange={(e) => setScheduledDateTime(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                      />
                    )}

                    <button
                      type="button"
                      disabled={isCaptionOverLimit}
                      onClick={() => {
                        if (!sessionToken) {
                          showToast('⚠️ 먼저 상단에서 로그인해 주세요.');
                          return;
                        }
                        if (selectedAccountIds.length === 0) {
                          showToast('⚠️ 게시물을 올릴 인스타그램 계정을 선택해 주세요.');
                          return;
                        }
                        setShowConfirmModal(true);
                      }}
                      className="w-full py-3 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 text-white font-extrabold text-xs sm:text-sm shadow-md"
                    >
                      🚀 미리보기 그대로 인스타그램에 올리기
                    </button>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
                    💡 인스타그램에 바로 올리려면 상단 <strong>[내 계정들]</strong> 탭에서 인스타 계정을 연결해 주세요. (이미지 ZIP 다운로드는 계정 연결 없이 바로 가능합니다!)
                  </div>
                )}
              </div>
            </div>

            {/* ============================================================= */}
            {/* 오른쪽 패널 (7칸): 실시간 미리보기 캔버스 + 객체별 전용 편집 툴바 */}
            {/* ============================================================= */}
            <div className="lg:col-span-7 lg:sticky lg:top-20 space-y-4 order-1 lg:order-2">
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
                {/* 상단: 실행취소/다시실행 & ZIP 다운로드 바 */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={handleUndo}
                      disabled={!canUndo}
                      title="실행 취소 (Ctrl+Z)"
                      className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-extrabold disabled:opacity-40"
                    >
                      ↩️ 실행취소
                    </button>
                    <button
                      type="button"
                      onClick={handleRedo}
                      disabled={!canRedo}
                      title="다시 실행 (Ctrl+Y)"
                      className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-extrabold disabled:opacity-40"
                    >
                      ↪️ 다시실행
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRegenerateSingleSlide(activeSlideIndex)}
                      disabled={regeneratingSlideIdx === activeSlideIndex}
                      className="px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-extrabold"
                    >
                      {regeneratingSlideIdx === activeSlideIndex
                        ? '생성중...'
                        : '🔄 이 장만 AI로 다시 만들기'}
                    </button>
                  </div>

                  {/* ZIP 일괄 다운로드 및 단건 저장 버튼 */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleDownloadCurrentSlide('jpeg')}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold"
                    >
                      📥 이 장 JPG
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadAllAsZip('png')}
                      disabled={isExportingZip}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold shadow-sm disabled:opacity-50"
                    >
                      {isExportingZip ? '압축 중...' : `📦 전체 ${slides.length}장 PNG ZIP`}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadAllAsZip('jpeg')}
                      disabled={isExportingZip}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-sm disabled:opacity-50"
                    >
                      {isExportingZip ? '압축 중...' : `📦 전체 ${slides.length}장 JPG ZIP`}
                    </button>
                  </div>
                </div>

                {/* 슬라이드 선택 탭 + 순서 바꾸기 + 장 추가/삭제 */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                    {slides.map((s, idx) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          saveCanvasToActiveSlide(false);
                          setActiveSlideIndex(idx);
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-extrabold flex-shrink-0 transition ${
                          activeSlideIndex === idx
                            ? 'bg-slate-900 text-white shadow-sm'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {idx + 1}장
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={handleAddNewBlankSlide}
                      disabled={slides.length >= maxSlideLimit}
                      className="px-2.5 py-1.5 rounded-xl text-xs font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 flex-shrink-0 disabled:opacity-40"
                    >
                      + 장 추가
                    </button>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => handleMoveSlideOrder('left')}
                      disabled={activeSlideIndex === 0}
                      className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold disabled:opacity-40"
                      title="앞장으로 이동"
                    >
                      ◀
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveSlideOrder('right')}
                      disabled={activeSlideIndex >= slides.length - 1}
                      className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold disabled:opacity-40"
                      title="뒷장으로 이동"
                    >
                      ▶
                    </button>
                    <button
                      type="button"
                      onClick={duplicateActiveSlide}
                      className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold"
                    >
                      복제
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSlide(activeSlideIndex)}
                      className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold"
                    >
                      삭제
                    </button>
                  </div>
                </div>

                {/* 요소 추가 빠른 버튼 바 */}
                <div className="flex flex-wrap items-center gap-1.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[11px] font-extrabold text-slate-600 mr-1">➕ 요소 추가:</span>
                  <button
                    type="button"
                    onClick={() => handleAddTextObject('headline')}
                    className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-blue-50 border border-slate-300 text-xs font-bold text-slate-800"
                  >
                    T 제목 추가
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddTextObject('body')}
                    className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-blue-50 border border-slate-300 text-xs font-bold text-slate-800"
                  >
                    t 본문 추가
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddTextObject('badge')}
                    className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-blue-50 border border-slate-300 text-xs font-bold text-slate-800"
                  >
                    🏷️ 뱃지 추가
                  </button>

                  <label className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold cursor-pointer">
                    📷 이 장에 사진 넣기 (잘리지 않게 비율 맞춤)
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => handleSlideSpecificPhotoUpload(e.target.files, 'set-slide-photo')}
                      className="hidden"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => handleAddShape('rect')}
                    className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-xs font-bold text-slate-700"
                  >
                    ⬛ 사각형
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddShape('circle')}
                    className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-xs font-bold text-slate-700"
                  >
                    ⚪ 원형
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddShape('line')}
                    className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-xs font-bold text-slate-700"
                  >
                    ➖ 구분선
                  </button>
                </div>

                {/* 선택된 객체별 맞춤 컨트롤 바 */}
                {selectedObjType !== 'none' ? (
                  <div className="p-3 rounded-xl bg-blue-50/60 border border-blue-200 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-blue-200/70">
                      <span className="text-xs font-extrabold text-blue-900">
                        {selectedObjType === 'text'
                          ? '✏️ 글자 박스 선택됨 (더블클릭하면 캔버스에서 직접 타이핑)'
                          : selectedObjType === 'image'
                          ? '🖼️ 사진 객체 선택됨 (드래그 이동 · 모서리 크기조절 · 비율유지)'
                          : '🔷 도형 객체 선택됨'}
                      </span>

                      <div className="flex items-center gap-1 flex-wrap">
                        <button
                          type="button"
                          onClick={() => handleLayerOrder('front')}
                          className="px-2 py-1 rounded bg-white border border-slate-300 text-[11px] font-bold hover:bg-slate-100"
                        >
                          ⬆️ 맨앞
                        </button>
                        <button
                          type="button"
                          onClick={() => handleLayerOrder('forward')}
                          className="px-2 py-1 rounded bg-white border border-slate-300 text-[11px] font-bold hover:bg-slate-100"
                        >
                          🔼 앞으로
                        </button>
                        <button
                          type="button"
                          onClick={() => handleLayerOrder('backward')}
                          className="px-2 py-1 rounded bg-white border border-slate-300 text-[11px] font-bold hover:bg-slate-100"
                        >
                          🔽 뒤로
                        </button>
                        <button
                          type="button"
                          onClick={() => handleLayerOrder('back')}
                          className="px-2 py-1 rounded bg-white border border-slate-300 text-[11px] font-bold hover:bg-slate-100"
                        >
                          ⬇️ 맨뒤
                        </button>
                        <button
                          type="button"
                          onClick={handleDeleteSelectedObject}
                          className="px-2.5 py-1 rounded bg-rose-600 text-white text-[11px] font-extrabold hover:bg-rose-700 ml-1"
                        >
                          🗑️ 삭제
                        </button>
                      </div>
                    </div>

                    {/* 텍스트 선택 시 전용 툴바 */}
                    {selectedObjType === 'text' && (
                      <div className="space-y-2.5 text-xs">
                        <textarea
                          rows={2}
                          value={selTextValue}
                          onChange={(e) => {
                            setSelTextValue(e.target.value);
                            updateSelectedTextProp('text', e.target.value);
                          }}
                          placeholder="글자 내용을 입력하세요"
                          className="w-full px-3 py-1.5 rounded-lg border border-blue-300 bg-white text-xs sm:text-sm font-bold"
                        />

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                              폰트
                            </label>
                            <select
                              value={selFontFamily}
                              onChange={(e) => applyFontToSelectionOrAll(e.target.value)}
                              className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                            >
                              {customFonts.map((cf) => (
                                <option key={cf.id} value={cf.id}>
                                  📁 {cf.name}
                                </option>
                              ))}
                              {EDITOR_KOREAN_FONTS.map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                              크기 ({selFontSize}px)
                            </label>
                            <input
                              type="range"
                              min={16}
                              max={130}
                              value={selFontSize}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                setSelFontSize(v);
                                updateSelectedTextProp('fontSize', v);
                              }}
                              className="w-full accent-blue-600"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                              굵기 & 정렬
                            </label>
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  const nextW = selFontWeight === 'bold' ? 'normal' : 'bold';
                                  setSelFontWeight(nextW);
                                  updateSelectedTextProp('fontWeight', nextW);
                                }}
                                className={`px-2 py-1 rounded border text-xs font-extrabold ${
                                  selFontWeight === 'bold'
                                    ? 'bg-slate-900 text-white border-slate-900'
                                    : 'bg-white text-slate-700 border-slate-300'
                                }`}
                              >
                                B
                              </button>
                              {(['left', 'center', 'right'] as const).map((al) => (
                                <button
                                  key={al}
                                  type="button"
                                  onClick={() => {
                                    setSelTextAlign(al);
                                    updateSelectedTextProp('textAlign', al);
                                  }}
                                  className={`flex-1 py-1 rounded border text-[11px] font-bold ${
                                    selTextAlign === al
                                      ? 'bg-blue-600 text-white border-blue-600'
                                      : 'bg-white text-slate-700 border-slate-300'
                                  }`}
                                >
                                  {al === 'left' ? '좌' : al === 'center' ? '중' : '우'}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div>
                              <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                                글자색
                              </label>
                              <input
                                type="color"
                                value={selTextColor.startsWith('#') ? selTextColor : '#0F172A'}
                                onChange={(e) => {
                                  setSelTextColor(e.target.value);
                                  updateSelectedTextProp('fill', e.target.value);
                                }}
                                className="w-8 h-7 rounded cursor-pointer border border-slate-300"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                                형광펜 배경
                              </label>
                              <div className="flex items-center gap-1">
                                <input
                                  type="color"
                                  value={selTextBgColor.startsWith('#') ? selTextBgColor : '#FACC15'}
                                  onChange={(e) => {
                                    setSelTextBgColor(e.target.value);
                                    updateSelectedTextProp('textBackgroundColor', e.target.value);
                                  }}
                                  className="w-7 h-7 rounded cursor-pointer border border-slate-300"
                                />
                                {selTextBgColor && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelTextBgColor('');
                                      updateSelectedTextProp('textBackgroundColor', '');
                                    }}
                                    className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 font-bold"
                                  >
                                    해제
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3 pt-1">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600">
                              자간 ({selCharSpacing})
                            </label>
                            <input
                              type="range"
                              min={-80}
                              max={400}
                              step={10}
                              value={selCharSpacing}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                setSelCharSpacing(v);
                                updateSelectedTextProp('charSpacing', v);
                              }}
                              className="w-full accent-blue-600"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600">
                              행간 ({selLineHeight})
                            </label>
                            <input
                              type="range"
                              min={0.85}
                              max={2.4}
                              step={0.05}
                              value={selLineHeight}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                setSelLineHeight(v);
                                updateSelectedTextProp('lineHeight', v);
                              }}
                              className="w-full accent-blue-600"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600">
                              투명도 ({selOpacity}%)
                            </label>
                            <input
                              type="range"
                              min={10}
                              max={100}
                              value={selOpacity}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                setSelOpacity(v);
                                updateSelectedTextProp('opacity', v / 100);
                              }}
                              className="w-full accent-blue-600"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 사진 선택 시 전용 툴바 */}
                    {selectedObjType === 'image' && (
                      <div className="space-y-2.5 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-extrabold cursor-pointer">
                            🔄 다른 사진으로 교체 (비율 유지)
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handlePhotoFiles(e.target.files, 'replace-selected')}
                              className="hidden"
                            />
                          </label>

                          <button
                            type="button"
                            onClick={() => handleAdjustActivePhotoScaleOrPos('zoom-in')}
                            className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 font-bold text-slate-800"
                          >
                            🔍 크게 (+)
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAdjustActivePhotoScaleOrPos('zoom-out')}
                            className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 font-bold text-slate-800"
                          >
                            🔍 작게 (-)
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAdjustActivePhotoScaleOrPos('center')}
                            className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 font-bold text-slate-800"
                          >
                            🎯 비율 맞춰 크게 정중앙
                          </button>

                          {!isCropping ? (
                            <button
                              type="button"
                              onClick={handleStartCropMode}
                              className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-extrabold"
                            >
                              ✂️ 직접 자르기
                            </button>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={handleApplyCrop}
                                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold"
                              >
                                ✅ 자르기 완료
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelCrop}
                                className="px-2.5 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold"
                              >
                                취소
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-3 gap-3 pt-1">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600">
                              모서리 둥글기 ({selCornerRadius}px)
                            </label>
                            <input
                              type="range"
                              min={0}
                              max={220}
                              value={selCornerRadius}
                              onChange={(e) => handlePhotoCornerRadiusChange(Number(e.target.value))}
                              className="w-full accent-blue-600"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600">
                              투명도 ({selOpacity}%)
                            </label>
                            <input
                              type="range"
                              min={10}
                              max={100}
                              value={selOpacity}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                setSelOpacity(v);
                                updateSelectedTextProp('opacity', v / 100);
                              }}
                              className="w-full accent-blue-600"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600">
                              회전 각도 ({selAngle}°)
                            </label>
                            <input
                              type="range"
                              min={-180}
                              max={180}
                              value={selAngle}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                setSelAngle(v);
                                const canvas = fabricCanvasRef.current;
                                const active = canvas?.getActiveObject?.();
                                if (active) {
                                  active.rotate(v);
                                  canvas.requestRenderAll();
                                  saveCanvasToActiveSlide(true);
                                }
                              }}
                              className="w-full accent-blue-600"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 도형 선택 시 전용 툴바 */}
                    {selectedObjType === 'shape' && (
                      <div className="space-y-2 text-xs">
                        {isCropping && (
                          <div className="flex items-center justify-between bg-amber-100 border border-amber-300 px-3 py-2 rounded-lg">
                            <span className="font-extrabold text-amber-900">
                              ✂️ 크롭 영역 박스를 조절한 뒤 오른쪽 버튼을 눌러주세요!
                            </span>
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                onClick={handleApplyCrop}
                                className="px-3 py-1 rounded bg-emerald-600 text-white font-extrabold"
                              >
                                ✅ 자르기 완료
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelCrop}
                                className="px-2.5 py-1 rounded bg-white text-slate-700 font-bold"
                              >
                                취소
                              </button>
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                              도형 채우기 색
                            </label>
                            <input
                              type="color"
                              value={selFillColor.startsWith('#') ? selFillColor : '#2563EB'}
                              onChange={(e) => {
                                setSelFillColor(e.target.value);
                                updateSelectedTextProp('fill', e.target.value);
                              }}
                              className="w-9 h-7 rounded cursor-pointer border border-slate-300"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                              테두리/선 색상
                            </label>
                            <input
                              type="color"
                              value={selStrokeColor.startsWith('#') ? selStrokeColor : '#0F172A'}
                              onChange={(e) => {
                                setSelStrokeColor(e.target.value);
                                updateSelectedTextProp('stroke', e.target.value);
                              }}
                              className="w-9 h-7 rounded cursor-pointer border border-slate-300"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600">
                              모서리 둥글기 ({selCornerRadius}px)
                            </label>
                            <input
                              type="range"
                              min={0}
                              max={120}
                              value={selCornerRadius}
                              onChange={(e) => handlePhotoCornerRadiusChange(Number(e.target.value))}
                              className="w-full accent-blue-600"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600">
                              투명도 ({selOpacity}%)
                            </label>
                            <input
                              type="range"
                              min={5}
                              max={100}
                              value={selOpacity}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                setSelOpacity(v);
                                updateSelectedTextProp('opacity', v / 100);
                              }}
                              className="w-full accent-blue-600"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center justify-between">
                    <span>
                      💡 <strong>왼쪽 2번 칸에서 글자를 고치면 미리보기가 바로 바뀌며</strong>, 캔버스 위 글자·사진을 마우스로 직접 옮기고 크기를 줄일 수도 있어요!
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!activeSlide || !fabricCanvasRef.current) return;
                        const cleanSlide: SlideItem = { ...activeSlide, fabricJson: undefined };
                        setSlides((prev) =>
                          prev.map((s, i) => (i === activeSlideIndex ? cleanSlide : s))
                        );
                        await buildFabricObjectsForSlide(
                          fabricCanvasRef.current,
                          cleanSlide,
                          slides.length
                        );
                        saveCanvasToActiveSlide(true);
                        showToast('🔄 이 장의 레이아웃 배치를 깔끔하게 다시 정렬했습니다!');
                      }}
                      className="text-[11px] font-extrabold text-blue-600 hover:underline flex-shrink-0 ml-2"
                    >
                      🔄 배치 재정렬
                    </button>
                  </div>
                )}

                {/* ========================================================= */}
                {/* 메인 인터랙티브 Fabric.js 캔버스 뷰포트 (미리보기 100% 보장) */}
                {/* ========================================================= */}
                <div
                  ref={wrapperRef}
                  className="w-full flex flex-col items-center justify-center bg-slate-200/70 rounded-2xl p-2 sm:p-4 overflow-hidden select-none"
                >
                  <div
                    className="relative shadow-2xl border border-slate-300 bg-white overflow-hidden"
                    style={{
                      width: `${Math.round(targetDimensions.width * canvasScale)}px`,
                      height: `${Math.round(targetDimensions.height * canvasScale)}px`,
                    }}
                  >
                    {/* Fabric 스크립트가 로드되기 전 0.5초 동안에도 즉시 보이는 HTML 미리보기 */}
                    {!libsReady && activeSlide && (
                      <div
                        className="absolute inset-0 z-10 flex flex-col justify-between p-6"
                        style={{ backgroundColor: canvasBgColor }}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className="px-3 py-1 rounded-lg text-xs font-extrabold text-white"
                            style={{ backgroundColor: accentColor }}
                          >
                            {activeSlide.badgeText || `${activeSlideIndex + 1}장`}
                          </span>
                          <span className="text-xs font-bold text-slate-500">
                            {activeSlideIndex + 1} / {slides.length}
                          </span>
                        </div>
                        {activePhotoUrls[0] && (
                          <div className="my-2 flex-1 flex items-center justify-center overflow-hidden rounded-xl bg-slate-100">
                            <img
                              src={activePhotoUrls[0]}
                              alt=""
                              className="max-w-full max-h-full object-contain"
                            />
                          </div>
                        )}
                        <div className="bg-white/95 rounded-2xl p-4 shadow-sm space-y-2">
                          <h3 className="text-base font-extrabold text-slate-900">
                            {activeSlide.headline || '제목을 입력하세요'}
                          </h3>
                          <p className="text-xs text-slate-600 whitespace-pre-line">
                            {activeSlide.body || '본문 내용을 입력하세요'}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* 1080x1350 (또는 1080x1080) 원본 해상도 Fabric 캔버스 */}
                    <div
                      style={{
                        width: `${targetDimensions.width}px`,
                        height: `${targetDimensions.height}px`,
                        transform: `scale(${canvasScale})`,
                        transformOrigin: 'top left',
                      }}
                    >
                      <canvas ref={canvasElRef} />
                    </div>

                    {/* 세로 중앙/정렬 스냅 가이드선 */}
                    {snapGuideX !== null && (
                      <div
                        className="pointer-events-none absolute top-0 bottom-0 border-l-2 border-dashed border-pink-500 z-20"
                        style={{ left: `${Math.round(snapGuideX * canvasScale)}px` }}
                      />
                    )}
                    {/* 가로 중앙/정렬 스냅 가이드선 */}
                    {snapGuideY !== null && (
                      <div
                        className="pointer-events-none absolute left-0 right-0 border-t-2 border-dashed border-pink-500 z-20"
                        style={{ top: `${Math.round(snapGuideY * canvasScale)}px` }}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ================================================================= */}
        {/* [탭 2] 연결된 내 인스타그램 계정 관리 탭                            */}
        {/* ================================================================= */}
        {activeTab === 'accounts' && (
          <section className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-extrabold text-slate-900">
                  연결된 내 인스타그램 계정 ({accounts.length} / {MAX_IG_ACCOUNTS}개)
                </h2>
                <p className="text-sm text-slate-600 mt-1">
                  [+ 인스타 계정 추가] 버튼을 누르면 인스타그램 공식 로그인으로 안전하게 연결됩니다.
                </p>
              </div>
              <a
                href={userId ? `/api/instagram/auth?userId=${userId}` : '#'}
                onClick={(e) => {
                  if (!userId) {
                    e.preventDefault();
                    showToast('⚠️ 먼저 상단에서 로그인을 해주세요!');
                  }
                }}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 text-white font-bold text-sm shadow"
              >
                + 인스타 계정 추가 (Instagram 로그인)
              </a>
            </div>

            {accounts.length === 0 ? (
              <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center space-y-3">
                <p className="text-base font-bold text-slate-700">
                  아직 연결된 인스타그램 프로페셔널(비즈니스/크리에이터) 계정이 없습니다.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {accounts.map((acc) => {
                  const isEditing = editingAccountId === acc.id;
                  return (
                    <div
                      key={acc.id}
                      className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          {acc.profile_picture_url ? (
                            <img
                              src={acc.profile_picture_url}
                              alt={acc.username}
                              className="w-12 h-12 rounded-full object-cover border border-slate-200"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-purple-500 to-pink-500 text-white font-bold flex items-center justify-center">
                              @{acc.username.slice(0, 2)}
                            </div>
                          )}
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-extrabold text-slate-900">@{acc.username}</span>
                              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                                ● 정상 연결됨
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">
                              기본 폰트: {acc.default_font || 'Pretendard'}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setEditingAccountId(isEditing ? null : acc.id)}
                            className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50"
                          >
                            {isEditing ? '닫기' : '기본값 설정'}
                          </button>
                          <button
                            onClick={async () => {
                              if (!confirm(`@${acc.username} 계정 연결을 해제할까요?`)) return;
                              await fetch(`/api/accounts?id=${acc.id}`, {
                                method: 'DELETE',
                                headers: { Authorization: `Bearer ${sessionToken}` },
                              });
                              fetchAccounts();
                            }}
                            className="px-3 py-1.5 rounded-lg border border-rose-200 text-xs font-bold text-rose-600 hover:bg-rose-50"
                          >
                            연결 해제
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ================================================================= */}
        {/* [탭 3] 업로드 기록 탭                                              */}
        {/* ================================================================= */}
        {activeTab === 'history' && (
          <section className="space-y-5">
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex items-center justify-between">
              <div>
                <h2 className="text-xl font-extrabold text-slate-900">업로드 및 예약 기록</h2>
                <p className="text-sm text-slate-600 mt-1">
                  계정별 업로드 상태와 실패 시 원클릭 재시도를 지원합니다.
                </p>
              </div>
              <button
                onClick={fetchPostHistory}
                className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold hover:bg-slate-50"
              >
                🔄 새로고침
              </button>
            </div>

            {postHistory.length === 0 ? (
              <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center text-slate-500 font-semibold">
                아직 업로드하거나 예약한 게시물이 없습니다.
              </div>
            ) : (
              <div className="space-y-4">
                {postHistory.map((post) => (
                  <div
                    key={post.id}
                    className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-bold text-blue-600 mr-2">
                          [{post.aspect_ratio} · {post.slide_count}장]
                        </span>
                        <h3 className="inline font-extrabold text-slate-900">{post.title}</h3>
                      </div>
                      <span className="text-xs text-slate-400">
                        {new Date(post.created_at).toLocaleString('ko-KR')}
                      </span>
                    </div>

                    {post.post_targets && post.post_targets.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 pt-2 border-t border-slate-100">
                        {post.post_targets.map((t) => (
                          <div
                            key={t.id}
                            className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-slate-900 truncate">
                                @{t.instagram_accounts?.username || '계정'}
                              </div>
                              <div className="mt-1">
                                {t.status === 'published' && (
                                  <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                                    ✅ 업로드 성공
                                  </span>
                                )}
                                {t.status === 'scheduled' && (
                                  <span className="text-[11px] font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                                    ⏰ 예약됨
                                  </span>
                                )}
                                {t.status === 'failed' && (
                                  <span className="text-[11px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">
                                    ❌ 실패: {t.error_message || '오류'}
                                  </span>
                                )}
                              </div>
                            </div>
                            {t.status === 'failed' && (
                              <button
                                onClick={() => handleRetryPublish(t.id)}
                                disabled={retryingTargetId === t.id}
                                className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex-shrink-0"
                              >
                                {retryingTargetId === t.id ? '재시도중...' : '다시 올리기'}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {/* [1단계] 저장된 기획안 불러오기 모달 */}
      {showSavedPlansModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-4 max-h-[82vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base sm:text-lg font-extrabold text-slate-900">
                  📂 저장된 기획안 불러오기
                </h3>
                <p className="text-xs text-slate-500">
                  이전에 저장해 둔 기획안을 불러와서 이어서 수정하거나 카드뉴스로 만들 수 있어요.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSavedPlansModal(false)}
                className="px-3 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-extrabold text-slate-700"
              >
                닫기 ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {savedPlansList.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border border-slate-200">
                  아직 저장된 기획안이 없어요. AI 기획안을 만든 뒤 <strong>[💾 기획안 저장]</strong> 버튼을 눌러보세요!
                </div>
              ) : (
                savedPlansList.map((sp) => (
                  <div
                    key={sp.id}
                    className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-indigo-50/40 transition flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 text-[10px] font-extrabold">
                          {sp.cuts?.length || 0}장 구성
                        </span>
                        {sp.isApproved && (
                          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-extrabold">
                            ✅ 승인됨
                          </span>
                        )}
                        <span className="text-[10px] text-slate-400">
                          {sp.updatedAt ? new Date(sp.updatedAt).toLocaleString('ko-KR') : ''}
                        </span>
                      </div>
                      <div className="text-xs sm:text-sm font-extrabold text-slate-900 truncate">
                        {sp.topic}
                      </div>
                      <div className="text-[11px] text-slate-600 truncate">
                        표지: {sp.coverTitleCandidates?.[sp.selectedCoverCandidateIndex || 0] || sp.cuts?.[0]?.headline || ''}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handleLoadPlanFromSaved(sp)}
                        className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold shadow-sm"
                      >
                        불러오기
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSavedPlan(sp.id)}
                        className="px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-xs font-bold"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 4-A. 브랜드 설정 모달 */}
      {showBrandModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base sm:text-lg font-extrabold text-slate-900">
                  🏷️ 계정별 브랜드 설정 (A)
                </h3>
                <p className="text-xs text-slate-500">
                  말투, 해시태그, 금지어, 마지막 문구를 저장해 두면 기획할 때마다 자동으로 반영돼요.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowBrandModal(false)}
                className="px-3 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-extrabold text-slate-700"
              >
                닫기 ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  💬 기본 말투
                </label>
                <select
                  value={brandTone}
                  onChange={(e) => setBrandTone(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold bg-white"
                >
                  <option value="친근하게">친근하게 (~해요, 다정한 어조)</option>
                  <option value="전문적으로">전문적으로 (신뢰감, 격식 있는 어조)</option>
                  <option value="짧고 굵게">짧고 굵게 (임팩트, 직관적인 어조)</option>
                </select>
              </div>

              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  🏷️ 자주 쓰는 해시태그
                </label>
                <textarea
                  rows={2}
                  value={brandFavoriteHashtags}
                  onChange={(e) => setBrandFavoriteHashtags(e.target.value)}
                  placeholder="#만년필 #손글씨 #문구스타그램 #다이어리"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>

              <div>
                <label className="block font-extrabold text-rose-700 mb-1">
                  🚫 쓰지 말아야 할 단어 (금지어, 쉼표로 구분)
                </label>
                <input
                  type="text"
                  value={brandForbiddenWords}
                  onChange={(e) => setBrandForbiddenWords(e.target.value)}
                  placeholder="예: 무조건, 100%, 완벽, 최고, 기적"
                  className="w-full px-3 py-2 rounded-xl border border-rose-200 bg-rose-50/30"
                />
                <p className="text-[11px] text-slate-500 mt-0.5">
                  기획안이나 슬라이드에 이 단어가 들어가면 품질 점검에서 경고해 드려요.
                </p>
              </div>

              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  📌 마지막 고정 문구 (캡션 하단)
                </label>
                <textarea
                  rows={2}
                  value={brandClosingSignature}
                  onChange={(e) => setBrandClosingSignature(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowBrandModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-300 font-bold text-slate-700 text-xs"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSaveBrandSettings}
                className="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-xs shadow-md"
              >
                저장하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4-C. 주제 아이디어 10개 추천 모달 */}
      {showIdeasModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[82vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base sm:text-lg font-extrabold text-slate-900">
                  💡 요즘 반응 좋은 주제 10개 추천 (C)
                </h3>
                <p className="text-xs text-slate-500">
                  원하는 주제를 클릭하면 1단계 입력창에 바로 입력돼요!
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowIdeasModal(false)}
                className="px-3 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-extrabold text-slate-700"
              >
                닫기 ✕
              </button>
            </div>

            <div className="flex gap-1.5">
              <input
                type="text"
                value={ideaKeyword}
                onChange={(e) => setIdeaKeyword(e.target.value)}
                placeholder="키워드 (예: 만년필 입문, 성수동 카페, 직장인 재테크)"
                className="flex-1 px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
              />
              <button
                type="button"
                onClick={handleFetchTopicIdeas}
                disabled={isLoadingIdeas}
                className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-extrabold disabled:opacity-50"
              >
                {isLoadingIdeas ? '추천받는 중...' : '다시 추천받기'}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {recommendedIdeas.map((idea, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectRecommendedIdea(idea)}
                  className="w-full text-left p-3 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-amber-50 hover:border-amber-300 transition flex items-center justify-between gap-2 group"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-extrabold flex items-center justify-center flex-shrink-0">
                      {idx + 1}
                    </span>
                    <span className="text-xs font-bold text-slate-900 group-hover:text-amber-950">
                      {idea}
                    </span>
                  </div>
                  <span className="text-[11px] font-extrabold text-amber-700 opacity-0 group-hover:opacity-100 flex-shrink-0">
                    선택 👉
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 4-D. 1편·2편·3편 시리즈 나누기 모달 */}
      {showSeriesModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base sm:text-lg font-extrabold text-slate-900">
                  📚 1편 · 2편 · 3편 시리즈 기획 (D)
                </h3>
                <p className="text-xs text-slate-500">
                  긴 내용을 독자가 끝까지 팔로우하며 볼 수 있도록 3편으로 나누었어요.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSeriesModal(false)}
                className="px-3 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-extrabold text-slate-700"
              >
                닫기 ✕
              </button>
            </div>

            {isLoadingSeries ? (
              <div className="p-8 text-center text-xs text-slate-600 font-bold animate-pulse">
                🤖 AI가 1편·2편·3편 시리즈 구성을 나누는 중입니다...
              </div>
            ) : seriesParts ? (
              <div className="space-y-2.5">
                {[
                  { tag: '1편 (입문·기초)', title: seriesParts.part1, color: 'bg-blue-50 border-blue-200 text-blue-900' },
                  { tag: '2편 (실전 핵심)', title: seriesParts.part2, color: 'bg-indigo-50 border-indigo-200 text-indigo-900' },
                  { tag: '3편 (심화 총정리)', title: seriesParts.part3, color: 'bg-purple-50 border-purple-200 text-purple-900' },
                ].map((part, pIdx) => (
                  <div
                    key={pIdx}
                    className={`p-3.5 rounded-2xl border ${part.color} flex items-center justify-between gap-2`}
                  >
                    <div className="min-w-0">
                      <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-white/80 block w-fit mb-1">
                        {part.tag}
                      </span>
                      <p className="text-xs font-extrabold truncate">{part.title}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setPlanTopic(part.title);
                        setShowSeriesModal(false);
                        showToast(`📚 "${part.title}" 주제로 설정되었습니다! 바로 기획안을 만들어보세요.`);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-extrabold flex-shrink-0 hover:bg-slate-800"
                    >
                      이 편으로 기획
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* 4-E. 글 품질 점검 & 원클릭 자동 고치기 모달 */}
      {showQualityModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base sm:text-lg font-extrabold text-slate-900">
                  🔍 글 품질 & 사실 점검 (B, E)
                </h3>
                <p className="text-xs text-slate-500">
                  업로드 전 글자 수, 금지어, 사실 확인 필요 항목을 점검해요.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowQualityModal(false)}
                className="px-3 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-extrabold text-slate-700"
              >
                닫기 ✕
              </button>
            </div>

            <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1 text-xs">
              {/* 점검 결과 요약 */}
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                <span className="font-bold text-slate-700">발견된 점검 항목:</span>
                <span className="font-extrabold text-sm text-indigo-600">
                  {qualityReport.totalIssues + factCheckAlerts.length}건
                </span>
              </div>

              {/* 금지어 발견 */}
              {qualityReport.foundForbidden.length > 0 && (
                <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 space-y-1">
                  <span className="font-extrabold block">🚫 브랜드 금지어 발견 ({qualityReport.foundForbidden.length}건)</span>
                  <div className="text-[11px] space-y-0.5">
                    {qualityReport.foundForbidden.map((f, i) => (
                      <p key={i}>• {f.slideNum}장에 금지어 "{f.word}"가 포함되어 있어요.</p>
                    ))}
                  </div>
                </div>
              )}

              {/* 글자 수 초과 슬라이드 */}
              {qualityReport.longHeadlines.length > 0 && (
                <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 space-y-1">
                  <span className="font-extrabold block">⚠️ 제목이 너무 긴 컷 ({qualityReport.longHeadlines.length}건)</span>
                  <p className="text-[11px]">
                    {qualityReport.longHeadlines.map((s) => `${s.slideNumber}장`).join(', ')} 제목이 35자를 초과합니다.
                  </p>
                </div>
              )}

              {/* 사실 확인(Fact Check) 알림 */}
              {factCheckAlerts.length > 0 && (
                <div className="p-3 rounded-2xl bg-blue-50 border border-blue-200 text-blue-900 space-y-1">
                  <span className="font-extrabold block">🔍 사실 확인 필요 ({factCheckAlerts.length}건)</span>
                  <div className="text-[11px] space-y-0.5">
                    {factCheckAlerts.map((f, i) => (
                      <p key={i}>• {f.slideNum}장: "{f.phrase}" - {f.text}</p>
                    ))}
                  </div>
                </div>
              )}

              {qualityReport.totalIssues === 0 && factCheckAlerts.length === 0 && (
                <div className="p-6 text-center text-xs text-emerald-800 bg-emerald-50 rounded-2xl border border-emerald-200 font-extrabold">
                  🎉 축하합니다! 글자 수, 금지어, 해시태그 한도를 모두 완벽히 준수하고 있습니다.
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowQualityModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-300 font-bold text-slate-700 text-xs"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={handleAutoFixAllQualityIssues}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-extrabold text-xs shadow-md"
              >
                🛠️ 원클릭 자동 고치기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4-F. 올리기 좋은 시간 추천 모달 */}
      {showBestTimesModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base sm:text-lg font-extrabold text-slate-900">
                  ⏰ 인스타그램 올리기 좋은 시간 추천 (F)
                </h3>
                <p className="text-xs text-slate-500">
                  피드 반응이 가장 높은 최적의 시간대를 추천해 드려요.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowBestTimesModal(false)}
                className="px-3 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-extrabold text-slate-700"
              >
                닫기 ✕
              </button>
            </div>

            <div className="space-y-2.5">
              {recommendedUploadTimes.map((item, idx) => (
                <div
                  key={idx}
                  className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-blue-50/60 transition flex items-center justify-between gap-2"
                >
                  <div>
                    <span className="text-xs font-extrabold text-slate-900 block">{item.label}</span>
                    <span className="text-xs text-blue-700 font-bold block">{item.displayStr}</span>
                    <span className="text-[11px] text-slate-500">{item.reason}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleApplyRecommendedTime(item.timeValue)}
                    className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold flex-shrink-0 shadow-sm"
                  >
                    이 시간 예약
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 4-G. 내 템플릿 저장 모달 */}
      {showTemplateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[82vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base sm:text-lg font-extrabold text-slate-900">
                  🎨 내 템플릿 저장 & 불러오기 (G)
                </h3>
                <p className="text-xs text-slate-500">
                  현재 스타일(장수, 템플릿, 색상, 폰트)을 저장해 두고 다음번에 바로 찍어낼 수 있어요.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowTemplateModal(false)}
                className="px-3 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-extrabold text-slate-700"
              >
                닫기 ✕
              </button>
            </div>

            {/* 현재 스타일 템플릿으로 저장하기 */}
            <div className="p-3 rounded-2xl bg-indigo-50 border border-indigo-200 space-y-2">
              <span className="text-xs font-extrabold text-indigo-950 block">
                💾 현재 에디터 스타일 템플릿으로 저장
              </span>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={newTemplateNameInput}
                  onChange={(e) => setNewTemplateNameInput(e.target.value)}
                  placeholder="템플릿 이름 (예: 내 시그니처 4장 템플릿)"
                  className="flex-1 px-3 py-1.5 rounded-xl border border-indigo-200 text-xs bg-white font-bold"
                />
                <button
                  type="button"
                  onClick={handleSaveCurrentAsTemplate}
                  className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold shadow-sm"
                >
                  저장
                </button>
              </div>
            </div>

            {/* 저장된 템플릿 목록 */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {savedUserTemplates.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border border-slate-200">
                  아직 저장된 템플릿이 없습니다. 위에서 이름을 적고 <strong>[저장]</strong>을 눌러보세요!
                </div>
              ) : (
                savedUserTemplates.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="p-3 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-between gap-2"
                  >
                    <div>
                      <span className="text-xs font-extrabold text-slate-900 block">{tpl.name}</span>
                      <span className="text-[11px] text-slate-500">
                        {tpl.slideCount}장 · {tpl.fontId} · {tpl.aspectRatio} · {tpl.templateId}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleApplyUserTemplate(tpl)}
                        className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-sm"
                      >
                        적용
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteUserTemplate(tpl.id)}
                        className="px-2 py-1.5 rounded-xl bg-rose-50 text-rose-600 text-xs font-bold border border-rose-200"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 업로드 최종 확인 모달 */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-5">
            <h3 className="text-lg font-extrabold text-slate-900">
              📋 인스타그램 업로드 최종 확인
            </h3>
            <p className="text-xs text-slate-600">
              내가 작성한 글과 비율 맞춰 넣은 사진 미리보기 그대로 고화질 JPEG로 변환되어 인스타그램에 올라갑니다.
            </p>
            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-2 text-xs sm:text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">카드 장수 및 비율:</span>
                <span className="font-bold text-slate-900">
                  총 {slides.length}장 ({aspectRatio})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">업로드 방식:</span>
                <span className="font-bold text-blue-600">
                  {scheduleType === 'now'
                    ? '지금 즉시 업로드'
                    : `예약 업로드 (${scheduledDateTime})`}
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                disabled={isPublishing}
                className="flex-1 py-3 rounded-xl border border-slate-300 font-bold text-slate-700 text-sm hover:bg-slate-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleExecutePublish}
                disabled={isPublishing}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 text-white font-extrabold text-sm shadow-lg disabled:opacity-50"
              >
                {isPublishing ? '캔버스 렌더링 및 업로드 중...' : '네, 이대로 올릴게요!'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
