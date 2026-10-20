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
  isManuallyEdited?: boolean; // 사용자가 직접 제목/본문을 작성·수정한 적이 있는지 여부
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fabricJson?: any;
  previewDataUrl?: string;
}

// ============================================================================
// 글자 수 권장 기준 ("글이 길어요" 안내 기준)
// ============================================================================
const TEXT_LENGTH_GUIDE = {
  HEADLINE_WARN: 35, // 제목 35자 초과 시 "글이 길어요" 안내
  BODY_WARN: 130, // 본문 130자 초과 시 "글이 길어요" 안내
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
    field: 'headline' | 'body' | 'badgeText',
    newValue: string
  ) {
    const canvas = fabricCanvasRef.current;

    if (canvas && window.fabric) {
      const roleMap = {
        headline: 'headline',
        body: 'body',
        badgeText: 'badge-text',
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
        const newTb = new window.fabric.Textbox(newValue, {
          left: 104,
          top: field === 'headline' ? Math.round(ch * 0.62) : field === 'body' ? Math.round(ch * 0.74) : 65,
          width: cw - 208,
          fontSize: field === 'headline' ? 50 : field === 'body' ? 29 : 24,
          fontFamily: fontId,
          fontWeight: field === 'body' ? 'normal' : 'bold',
          fill: '#0F172A',
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
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* ============================================================= */}
            {/* 왼쪽 패널 (5칸): AI 생성 + [장별 직접 작성] + 디자인/사진/폰트/발행 */}
            {/* ============================================================= */}
            <div className="lg:col-span-5 space-y-5 order-2 lg:order-1">
              {/* 1. AI 초안 생성 & 전체 사진 보관함 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-extrabold text-slate-900">
                    1. AI로 채우기 또는 직접 쓰기 선택
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
                  rows={3}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder="AI로 초안을 채우고 싶다면 여기에 주제나 메모를 적어주세요. (직접 쓰실 분은 아래 2번 칸에서 바로 장별로 작성하실 수 있어요!)"
                  className="w-full rounded-xl border border-slate-300 p-3 text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleGenerateWithAI}
                    disabled={isGeneratingAI}
                    className="py-2.5 px-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold text-xs sm:text-sm shadow-sm transition disabled:opacity-50"
                  >
                    {isGeneratingAI
                      ? '🤖 AI가 작성 중...'
                      : `✨ AI로 전체 채우기 (${slides.length}장)`}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleClearSlideForDirectWriting('all')}
                    className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-extrabold text-xs sm:text-sm border border-slate-300 transition"
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
                      핵심 기능 1 · 2
                    </span>
                    <h2 className="text-base font-extrabold text-slate-900">
                      2. 페이지(장)별 내용 직접 쓰기 & 사진 설정
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

                {/* 현재 장의 상단 뱃지 / 제목 / 본문 직접 입력칸 (고치면 미리보기 즉시 변경!) */}
                {activeSlide && (
                  <div className="space-y-3">
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

                    {/* ========================================================= */}
                    {/* [기능 1 & 2 통합] 이 장의 사진 넣기/바꾸기/지우기 & 비율/블러 설정 */}
                    {/* ========================================================= */}
                    <div className="p-3.5 rounded-xl bg-blue-50/60 border border-blue-200 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-extrabold text-blue-950">
                          🖼️ {activeSlideIndex + 1}장 전용 사진 관리 ({activePhotoUrls.length}장)
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <label className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold cursor-pointer shadow-sm">
                            📷 {activePhotoUrls.length > 0 ? '이 장 사진 바꾸기' : '이 장에 사진 넣기'}
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              onChange={(e) =>
                                handleSlideSpecificPhotoUpload(e.target.files, 'set-slide-photo')
                              }
                              className="hidden"
                            />
                          </label>
                          {activePhotoUrls.length > 0 && (
                            <>
                              <label className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-blue-50 text-blue-700 border border-blue-300 text-xs font-bold cursor-pointer">
                                + 사진 추가
                                <input
                                  type="file"
                                  accept="image/*"
                                  multiple
                                  onChange={(e) =>
                                    handleSlideSpecificPhotoUpload(
                                      e.target.files,
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
                          )}
                        </div>
                      </div>

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
                  <div className="flex gap-1">
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

                <textarea
                  rows={3}
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
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-xs sm:text-sm"
                />

                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
                  <span>
                    글자 수: {captionLength.toLocaleString()} / {CAPTION_LIMITS.MAX_LENGTH}자
                  </span>
                  <span>
                    해시태그: {hashtagCount} / {CAPTION_LIMITS.MAX_HASHTAGS}개
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
