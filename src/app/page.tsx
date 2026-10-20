'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ASPECT_RATIOS,
  AspectRatioKey,
  CAPTION_LIMITS,
  CAPTION_TONES,
  CaptionToneId,
  MAX_IG_ACCOUNTS,
  MAX_SLIDES,
  MoodId,
} from '@/config/constants';
import { ensureReadableColor, getReadableTextOnAccent } from '@/lib/contrast';
import { getSupabaseBrowser } from '@/lib/supabase';
import {
  InstagramAccount,
  PostRecord,
  SlideItem as BaseSlideItem,
  UploadedPhoto,
} from '@/types';

// ============================================================================
// [전역 타입 선언] 브라우저 전용(SSR 끔)으로 로드되는 Fabric.js v6, JSZip, FileSaver, localForage
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
// [안전 규칙 1] 투자 권유 금지어 목록 & 캡션 마지막 필수 면책 문구
// ============================================================================
const MANDATORY_DISCLAIMER = '투자 권유가 아닌 재미용 콘텐츠예요';

const BANNED_INVESTMENT_WORDS = [
  '사라',
  '팔아라',
  '매수 추천',
  '매도 추천',
  '무조건 오른다',
  '무조건 간다',
  '원금 보장',
  '수익 보장',
  '100% 수익',
  '풀매수',
  '몰빵',
  '지금 사세요',
  '당장 파세요',
];

function findBannedWords(text: string): string[] {
  if (!text) return [];
  return BANNED_INVESTMENT_WORDS.filter((word) => text.includes(word));
}

function ensureMandatoryDisclaimer(caption: string): string {
  const trimmed = (caption || '').trim();
  if (trimmed.includes(MANDATORY_DISCLAIMER)) return trimmed;
  return `${trimmed}\n\n※ ${MANDATORY_DISCLAIMER}`.trim();
}

// ============================================================================
// [폰트 설정] 상업적 무료 사용 가능 기본 한글 폰트 14종
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
  { id: 'Black Han Sans', name: '검은고딕 (Black Han Sans)', category: '짤 대표 굵은체', cssFamily: 'Black Han Sans' },
  { id: 'Jua', name: '배민 주아체 (Jua)', category: '둥근 짤 타이틀', cssFamily: 'Jua' },
  { id: 'Gowun Batang', name: '고운바탕 (Gowun Batang)', category: '감성 바탕체', cssFamily: 'Gowun Batang' },
  { id: 'Nanum Pen Script', name: '나눔펜체 (Nanum Pen)', category: '손글씨 펜체', cssFamily: 'Nanum Pen Script' },
  { id: 'Do Hyeon', name: '배민 도현체 (Do Hyeon)', category: '단단한 제목', cssFamily: 'Do Hyeon' },
  { id: 'Noto Serif KR', name: '본명조 (Noto Serif KR)', category: '정통 명조', cssFamily: 'Noto Serif KR' },
  { id: 'Nanum Gothic', name: '나눔고딕 (Nanum Gothic)', category: '친숙한 고딕', cssFamily: 'Nanum Gothic' },
  { id: 'Nanum Myeongjo', name: '나눔명조 (Nanum Myeongjo)', category: '감성 명조', cssFamily: 'Nanum Myeongjo' },
  { id: 'Gowun Dodum', name: '고운돋움 (Gowun Dodum)', category: '단정한 돋움', cssFamily: 'Gowun Dodum' },
  { id: 'Nanum Brush Script', name: '나눔붓체 (Nanum Brush)', category: '캘리그라피', cssFamily: 'Nanum Brush Script' },
  { id: 'Hi Melody', name: '하이멜로디 (Hi Melody)', category: '귀여운 손글씨', cssFamily: 'Hi Melody' },
  { id: 'Poor Story', name: '푸어스토리 (Poor Story)', category: '동화 감성체', cssFamily: 'Poor Story' },
];

// ============================================================================
// [카드/짤 템플릿 8종] 언제든 변경 가능
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
    id: 'full-bleed-poster',
    name: '1. 짤 기본형 (전체 배경 + 짤 문구)',
    desc: '글씨 없는 배경 그림 위에 외곽선 짤 문구와 캐릭터 배치',
    bgColor: '#0F172A',
    cardBoxColor: 'rgba(15, 23, 42, 0.45)',
    textColor: '#FFFFFF',
    subTextColor: '#F8FAFC',
    accentColor: '#FACC15',
  },
  {
    id: 'top-photo-card',
    name: '2. 상단 그림 + 하단 요약형',
    desc: '위에 그림/캐릭터, 아래에 깔끔한 요약 박스',
    bgColor: '#F8FAFC',
    cardBoxColor: '#FFFFFF',
    textColor: '#0F172A',
    subTextColor: '#475569',
    accentColor: '#2563EB',
  },
  {
    id: 'bottom-photo-card',
    name: '3. 상단 짤 제목 + 하단 그림형',
    desc: '임팩트 있는 제목이 위에 먼저 나오는 짤 구조',
    bgColor: '#FFFFFF',
    cardBoxColor: '#F1F5F9',
    textColor: '#111827',
    subTextColor: '#4B5563',
    accentColor: '#0284C7',
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
    name: '5. 좌우 분할 매거진형',
    desc: '왼쪽에는 그림/캐릭터, 오른쪽에는 대사/문구',
    bgColor: '#FFF5F7',
    cardBoxColor: '#FFFFFF',
    textColor: '#1F2937',
    subTextColor: '#6B7280',
    accentColor: '#EC4899',
  },
  {
    id: 'center-focus-box',
    name: '6. 중앙 말풍선 집중형',
    desc: '가운데 둥근 박스 안에 핵심 대사를 강조',
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
    name: '8. 다중 컷툰/콜라주 그리드',
    desc: '여러 장의 그림/사진을 격자로 배치하는 컷툰형',
    bgColor: '#FFFFFF',
    cardBoxColor: '#F8FAFC',
    textColor: '#0F172A',
    subTextColor: '#475569',
    accentColor: '#10B981',
  },
];

export interface CustomFontItem {
  id: string;
  name: string;
  base64Data: string;
  publicUrl?: string;
  fileExt?: string;
  fileSize?: number;
}

// "내 스타일 저장" 데이터 구조 (사용자별 저장)
interface UserSavedStyle {
  fontFamily: string;
  titleFontSize: number;
  bodyFontSize: number;
  fontWeight: string;
  textColor: string;
  strokeColor: string;
  strokeWidth: number;
  useShadow: boolean;
  shadowBlur: number;
  textAlign: 'left' | 'center' | 'right';
  charSpacing: number;
  lineHeight: number;
  titleLeft: number;
  titleTop: number;
  bodyLeft: number;
  bodyTop: number;
  bgColor: string;
  templateId: CardTemplateId;
}

export interface SlideItem extends BaseSlideItem {
  photoIndices?: number[];
  photoUrls?: string[];
  templateId?: CardTemplateId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fabricJson?: any; // design_json 설계도 (배경, 캐릭터, 글씨, 도형 분리 저장)
  previewDataUrl?: string;
}

// ============================================================================
// [IndexedDB / localForage 저장소 도우미]
// ============================================================================
const DB_NAME = 'AutoCardStudioDB';
const STORE_NAME = 'editor_store';

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
// [AI 글씨 없는 배경 생성기]
// "AI 배경 다시 만들기" 버튼 클릭 시 글씨가 전혀 없는 감성 일러스트/배경을 생성
// ============================================================================
function generateTextFreeAiBackgroundDataUrl(
  width: number,
  height: number,
  seedTopic: string,
  variantIdx: number
): string {
  const offCanvas = document.createElement('canvas');
  offCanvas.width = width;
  offCanvas.height = height;
  const ctx = offCanvas.getContext('2d');
  if (!ctx) return '';

  const palettes = [
    ['#0F172A', '#1E3A8A', '#3B82F6', '#93C5FD'],
    ['#18181B', '#3F3F46', '#71717A', '#F4F4F5'],
    ['#31102F', '#701A75', '#C026D3', '#F5D0FE'],
    ['#064E3B', '#047857', '#10B981', '#A7F3D0'],
    ['#451A03', '#92400E', '#F59E0B', '#FDE68A'],
    ['#1E1B4B', '#3730A3', '#6366F1', '#C7D2FE'],
  ];
  const pal = palettes[(variantIdx + seedTopic.length) % palettes.length];

  // 1) 부드러운 그라데이션 배경 (글씨 없음)
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, pal[0]);
  grad.addColorStop(0.55, pal[1]);
  grad.addColorStop(1, pal[2]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // 2) 은은한 빛 망울(보케/앰비언트 일러스트 효과, 글씨 0%)
  for (let i = 0; i < 9; i++) {
    const rx = ((i * 197 + variantIdx * 131) % 85) * 0.01 * width + width * 0.08;
    const ry = ((i * 263 + variantIdx * 97) % 85) * 0.01 * height + height * 0.08;
    const rad = 110 + ((i * 73) % 220);
    const radial = ctx.createRadialGradient(rx, ry, 10, rx, ry, rad);
    radial.addColorStop(0, `${pal[3]}38`);
    radial.addColorStop(1, `${pal[3]}00`);
    ctx.fillStyle = radial;
    ctx.beginPath();
    ctx.arc(rx, ry, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  return offCanvas.toDataURL('image/jpeg', 0.92);
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
  const [authLoading, setAuthLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<'create' | 'accounts' | 'history'>('create');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [postHistory, setPostHistory] = useState<PostRecord[]>([]);
  const [retryingTargetId, setRetryingTargetId] = useState<string | null>(null);

  // ==========================================================================
  // 2) 오늘 짤/카드 만들기 & 에디터 전역 상태
  // ==========================================================================
  const [publishMode, setPublishMode] = useState<'auto_publish' | 'download_only'>('auto_publish');
  const maxSlideLimit =
    publishMode === 'download_only' ? MAX_SLIDES.DOWNLOAD_ONLY : MAX_SLIDES.AUTO_PUBLISH;
  const [slideCount, setSlideCount] = useState<number>(4);
  const [aspectRatio, setAspectRatio] = useState<AspectRatioKey>('4:5');
  const [fontId, setFontId] = useState<string>('Pretendard');
  const [customFonts, setCustomFonts] = useState<CustomFontItem[]>([]);
  const [moodId] = useState<MoodId>('minimal');
  const [templateId, setTemplateId] = useState<CardTemplateId>('full-bleed-poster');
  const [accentColor, setAccentColor] = useState<string>('#FACC15');

  // [워터마크 제거]: 로고/워터마크는 이미지에 넣지 않음
  const [showWatermark] = useState<boolean>(false);
  const [watermarkText] = useState<string>('');

  // 내 스타일 저장 상태 (사용자별 분리 보관)
  const [savedUserStyle, setSavedUserStyle] = useState<UserSavedStyle | null>(null);
  const [autoApplyMyStyle, setAutoApplyMyStyle] = useState<boolean>(true);
  const [showJsonModal, setShowJsonModal] = useState<boolean>(false);

  // 배경 사진 보관함 & 내 캐릭터 원본 보관함
  const [uploadedPhotos, setUploadedPhotos] = useState<UploadedPhoto[]>([]);
  const [characterAssets, setCharacterAssets] = useState<UploadedPhoto[]>([]);
  const [rawText, setRawText] = useState<string>(
    '월급날 통장을 스쳐 지나가는 내 월급 이야기!\n출근길 커피 한 잔으로 버티는 직장인의 유쾌한 일상 공감 짤'
  );
  const [isDragging, setIsDragging] = useState(false);
  const [bgSeedCounter, setBgSeedCounter] = useState<number>(1);

  // 슬라이드 목록 & 현재 슬라이드 인덱스
  const [slides, setSlides] = useState<SlideItem[]>([]);
  const [activeSlideIndex, setActiveSlideIndex] = useState<number>(0);
  const [isGeneratingAI, setIsGeneratingAI] = useState<boolean>(false);
  const [regeneratingSlideIdx, setRegeneratingSlideIdx] = useState<number | null>(null);
  const [isExportingZip, setIsExportingZip] = useState<boolean>(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<string>('자동 저장 준비됨');

  // 캡션 및 발행 상태 (마지막 필수 문구 기본 포함)
  const [captionTone, setCaptionTone] = useState<CaptionToneId>('friendly');
  const [baseCaption, setBaseCaption] = useState<string>(
    `✨ 오늘의 공감 한 줄! 이미지를 넘겨 확인해 보세요.\n\n#인스타툰 #공감짤 #일상툰 #직장인일상\n\n※ ${MANDATORY_DISCLAIMER}`
  );
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [accountCustomCaptions, setAccountCustomCaptions] = useState<Record<string, string>>({});
  const [activeCaptionTab, setActiveCaptionTab] = useState<string>('base');
  const [scheduleType, setScheduleType] = useState<'now' | 'scheduled'>('now');
  const [scheduledDateTime, setScheduledDateTime] = useState<string>('');

  // 업로드 직전 "이 내용으로 올릴까요?" 최종 JPEG 확인 모달 상태
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [isPreparingPreviewJpegs, setIsPreparingPreviewJpegs] = useState<boolean>(false);
  const [finalPreviewJpegs, setFinalPreviewJpegs] = useState<string[]>([]);
  const [finalPreviewSizesKb, setFinalPreviewSizesKb] = useState<number[]>([]);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);

  // ==========================================================================
  // 3) Fabric.js v6 캔버스 및 선택된 객체 편집 상태
  // ==========================================================================
  const [libsReady, setLibsReady] = useState<boolean>(false);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fabricCanvasRef = useRef<any>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [canvasScale, setCanvasScale] = useState<number>(0.42);

  // 실행 취소(Undo) / 다시 실행(Redo) 스택
  const historyMapRef = useRef<Record<string, string[]>>({});
  const redoMapRef = useRef<Record<string, string[]>>({});
  const isRestoringRef = useRef<boolean>(false);
  const [canUndo, setCanUndo] = useState<boolean>(false);
  const [canRedo, setCanRedo] = useState<boolean>(false);

  // 스냅 가이드선
  const [snapGuideX, setSnapGuideX] = useState<number | null>(null);
  const [snapGuideY, setSnapGuideY] = useState<number | null>(null);

  // 선택된 객체 속성 상태
  const [selectedObjType, setSelectedObjType] = useState<'none' | 'text' | 'image' | 'shape'>('none');
  const [selTextValue, setSelTextValue] = useState<string>('');
  const [selFontFamily, setSelFontFamily] = useState<string>('Pretendard');
  const [selFontSize, setSelFontSize] = useState<number>(56);
  const [selFontWeight, setSelFontWeight] = useState<string>('bold');
  const [selTextColor, setSelTextColor] = useState<string>('#FFFFFF');
  const [selTextBgColor, setSelTextBgColor] = useState<string>('');
  const [selTextAlign, setSelTextAlign] = useState<'left' | 'center' | 'right'>('center');
  const [selCharSpacing, setSelCharSpacing] = useState<number>(0);
  const [selLineHeight, setSelLineHeight] = useState<number>(1.3);
  // [추가] 짤 글씨 테두리(외곽선) & 그림자 상태
  const [selTextStrokeColor, setSelTextStrokeColor] = useState<string>('#000000');
  const [selTextStrokeWidth, setSelTextStrokeWidth] = useState<number>(4);
  const [selTextShadowOn, setSelTextShadowOn] = useState<boolean>(true);
  const [selTextShadowBlur, setSelTextShadowBlur] = useState<number>(12);

  // 사진/캐릭터/도형 속성
  const [selOpacity, setSelOpacity] = useState<number>(100);
  const [selCornerRadius, setSelCornerRadius] = useState<number>(0);
  const [selFillColor, setSelFillColor] = useState<string>('#2563EB');
  const [selStrokeColor, setSelStrokeColor] = useState<string>('#0F172A');
  const [selAngle, setSelAngle] = useState<number>(0);
  const [isCropping, setIsCropping] = useState<boolean>(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cropRectRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cropTargetImgRef = useRef<any>(null);

  const [canvasBgColor, setCanvasBgColor] = useState<string>('#0F172A');

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 5000);
  }, []);

  // 사용자별 로컬 저장소 키 (로그인 시 userId별로 완전히 분리)
  const storageKeyPrefix = useMemo(() => (userId ? `acs_u_${userId}_` : 'acs_anon_'), [userId]);

  // ==========================================================================
  // 4) 브라우저 전용(SSR 끔)으로 Fabric.js v6, Google Fonts, localForage, JSZip 로드
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
        showToast('⚠️ 편집 도구를 불러오는 중 일시적인 네트워크 지연이 발생했습니다. 새로고침해 주세요.');
      }
    }

    initLibraries();
  }, [showToast]);

  // ==========================================================================
  // 5) 사용자별 폰트 · 내 스타일 · 캐릭터 · 편집 중 작업 내용 복원 (localForage + Supabase)
  // ==========================================================================
  useEffect(() => {
    if (!libsReady) return;
    let cancelled = false;

    async function restoreUserWorkspace() {
      // 1) 내 폰트 목록 복원 (localForage + 로그인 시 Supabase user_fonts 테이블 조회)
      let loadedFonts =
        (await loadFromLocalDb<CustomFontItem[]>(`${storageKeyPrefix}custom_fonts`)) || [];

      if (userId) {
        try {
          const supabase = getSupabaseBrowser();
          const { data: dbFonts } = await supabase
            .from('user_fonts')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

          if (Array.isArray(dbFonts) && dbFonts.length > 0) {
            const mapped: CustomFontItem[] = dbFonts.map((row) => ({
              id: row.font_family,
              name: row.font_name,
              base64Data: row.public_url,
              publicUrl: row.public_url,
              fileExt: row.file_ext,
              fileSize: row.file_size,
            }));
            const mapById = new Map<string, CustomFontItem>();
            [...loadedFonts, ...mapped].forEach((f) => mapById.set(f.id, f));
            loadedFonts = Array.from(mapById.values());
          }
        } catch {
          // user_fonts 테이블 생성 전에도 localForage로 정상 동작
        }
      }

      if (loadedFonts.length > 0 && !cancelled) {
        for (const cf of loadedFonts) {
          try {
            const srcUrl = cf.publicUrl || cf.base64Data;
            if (srcUrl && 'FontFace' in window) {
              const res = await fetch(srcUrl);
              const buf = await res.arrayBuffer();
              const face = new FontFace(cf.id, buf);
              await face.load();
              document.fonts.add(face);
            }
          } catch {
            // 폰트 로딩 실패 시 무시하고 진행
          }
        }
        setCustomFonts(loadedFonts);
      }

      // 2) 내 스타일 복원 (localForage + Supabase user_styles 테이블)
      let loadedStyle = await loadFromLocalDb<UserSavedStyle>(`${storageKeyPrefix}my_style`);
      if (userId) {
        try {
          const supabase = getSupabaseBrowser();
          const { data: dbStyle } = await supabase
            .from('user_styles')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();
          if (dbStyle && dbStyle.style_json && Object.keys(dbStyle.style_json).length > 0) {
            loadedStyle = dbStyle.style_json as UserSavedStyle;
          }
        } catch {
          // ignore
        }
      }
      if (loadedStyle && !cancelled) {
        setSavedUserStyle(loadedStyle);
      }

      // 3) 업로드 사진 및 캐릭터 원본 복원
      const savedPhotos = await loadFromLocalDb<UploadedPhoto[]>(`${storageKeyPrefix}photos`);
      if (savedPhotos && Array.isArray(savedPhotos) && !cancelled) {
        setUploadedPhotos(savedPhotos);
      }
      const savedChars = await loadFromLocalDb<UploadedPhoto[]>(`${storageKeyPrefix}characters`);
      if (savedChars && Array.isArray(savedChars) && !cancelled) {
        setCharacterAssets(savedChars);
      }

      // 4) 편집 중이던 design_json 슬라이드 상태 복원
      const savedState = await loadFromLocalDb<{
        slides: SlideItem[];
        aspectRatio: AspectRatioKey;
        fontId: string;
        templateId: CardTemplateId;
        accentColor: string;
        rawText: string;
        baseCaption: string;
      }>(`${storageKeyPrefix}editor_state`);

      if (savedState && Array.isArray(savedState.slides) && savedState.slides.length > 0 && !cancelled) {
        setSlides(savedState.slides);
        setSlideCount(savedState.slides.length);
        if (savedState.aspectRatio) setAspectRatio(savedState.aspectRatio);
        if (savedState.fontId) setFontId(savedState.fontId);
        if (savedState.templateId) setTemplateId(savedState.templateId);
        if (savedState.accentColor) setAccentColor(savedState.accentColor);
        if (savedState.rawText) setRawText(savedState.rawText);
        if (savedState.baseCaption) {
          setBaseCaption(ensureMandatoryDisclaimer(savedState.baseCaption));
        }
        setAutoSaveStatus('이전 작업 자동 복원됨');
      } else if (!cancelled) {
        buildDefaultSlides(4);
      }
    }

    restoreUserWorkspace();
    return () => {
      cancelled = true;
    };
  }, [libsReady, storageKeyPrefix, userId]);

  // 작업 중 자동 저장 (localForage)
  useEffect(() => {
    if (!libsReady || slides.length === 0) return;
    const timer = setTimeout(async () => {
      await saveToLocalDb(`${storageKeyPrefix}editor_state`, {
        slides,
        aspectRatio,
        fontId,
        templateId,
        accentColor,
        rawText,
        baseCaption,
      });
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(
        now.getMinutes()
      ).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      setAutoSaveStatus(`자동 저장됨 (${timeStr})`);
    }, 600);
    return () => clearTimeout(timer);
  }, [
    libsReady,
    storageKeyPrefix,
    slides,
    aspectRatio,
    fontId,
    templateId,
    accentColor,
    rawText,
    baseCaption,
  ]);

  useEffect(() => {
    if (!libsReady) return;
    saveToLocalDb(`${storageKeyPrefix}photos`, uploadedPhotos);
  }, [libsReady, storageKeyPrefix, uploadedPhotos]);

  useEffect(() => {
    if (!libsReady) return;
    saveToLocalDb(`${storageKeyPrefix}characters`, characterAssets);
  }, [libsReady, storageKeyPrefix, characterAssets]);

  // ==========================================================================
  // 6) 모바일 / PC 반응형 캔버스 배율 계산
  // ==========================================================================
  const targetDimensions = ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS['4:5'];

  useEffect(() => {
    const updateScale = () => {
      if (!wrapperRef.current) return;
      const availableW = wrapperRef.current.clientWidth - 16;
      const scale = Math.min(1, Math.max(0.24, availableW / targetDimensions.width));
      setCanvasScale(scale);
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [targetDimensions.width, activeTab]);

  // ==========================================================================
  // 7) Supabase 로그인 세션 및 인스타 계정 로드
  // ==========================================================================
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setSessionToken(data.session.access_token);
        setUserId(data.session.user.id);
        setUserEmail(data.session.user.email || '');
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setSessionToken(session.access_token);
        setUserId(session.user.id);
        setUserEmail(session.user.email || '');
      } else {
        setSessionToken(null);
        setUserId(null);
        setUserEmail('');
      }
    });

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab');
      const errParam = params.get('error');
      const okParam = params.get('success');
      if (tabParam === 'accounts' || tabParam === 'history' || tabParam === 'create') {
        setActiveTab(tabParam);
      }
      if (errParam) showToast(`⚠️ ${errParam}`);
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
  // 8) 초기 짤/카드뉴스 초안 생성기
  // ==========================================================================
  function buildDefaultSlides(count: number, resetCanvas = false) {
    const nextSlides: SlideItem[] = Array.from({ length: count }).map((_, idx) => {
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

      const photoObj = uploadedPhotos[idx] || null;

      return {
        id: `slide-${Date.now()}-${idx}`,
        slideNumber: idx + 1,
        role,
        roleLabel,
        badgeText: isSingle ? '오늘의 짤' : isCover ? 'EPISODE' : isCta ? 'SUMMARY' : `POINT 0${idx}`,
        headline: isSingle
          ? '출근하자마자 퇴근하고 싶은 사람 손!'
          : isCover
          ? '월급날 통장을 스쳐 지나가는 내 월급 이야기'
          : isCta
          ? '공감하셨다면 저장하고 친구에게 공유해 보세요!'
          : `직장인이라면 누구나 공감하는 순간 ${idx}`,
        body: isSingle
          ? '글씨를 더블클릭해 수정하거나 내 캐릭터를 얹어 나만의 짤을 완성하세요!'
          : isCover
          ? '오른쪽으로 넘겨서 오늘의 짤을 확인해 보세요 👉'
          : isCta
          ? '내 스타일 저장 버튼을 누르면 다음 짤에도 내 폰트와 글씨 위치가 자동 적용됩니다.'
          : 'AI 배경 다시 만들기를 눌러も 내가 고친 글씨와 배치는 그대로 유지됩니다.',
        photoIndex: photoObj ? idx : null,
        photoUrl: photoObj ? photoObj.url : null,
        photoIndices: photoObj ? [idx] : [],
        photoUrls: photoObj ? [photoObj.url] : [],
        templateId,
        fabricJson: undefined,
      };
    });

    if (resetCanvas) {
      historyMapRef.current = {};
      redoMapRef.current = {};
    }
    setSlides(nextSlides);
    setSlideCount(count);
    setActiveSlideIndex(0);
  }

  // ==========================================================================
  // 9) Fabric.js 캔버스 상태 저장 (`design_json`) & 선택 객체 동기화
  // ==========================================================================
  const saveCanvasToActiveSlide = useCallback(
    (pushHistory = true) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas || isRestoringRef.current) return;

      const slide = slides[activeSlideIndex];
      if (!slide) return;
      if (cropRectRef.current) return;

      const jsonObj = canvas.toObject(CUSTOM_PROPS);
      jsonObj.background = canvas.backgroundColor || '#0F172A';
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
      const objs: any[] = canvas.getObjects ? canvas.getObjects() : [];
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
                headline: headlineObj?.text ?? s.headline,
                body: bodyObj?.text ?? s.body,
                badgeText: badgeObj?.text ?? s.badgeText,
                customBgColor: String(canvas.backgroundColor || '#0F172A'),
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
      setSelFontSize(Math.round(obj.fontSize || 52));
      setSelFontWeight(String(obj.fontWeight || 'bold'));
      setSelTextColor(String(obj.fill || '#FFFFFF'));
      setSelTextBgColor(String(obj.textBackgroundColor || ''));
      setSelTextAlign((obj.textAlign as 'left' | 'center' | 'right') || 'center');
      setSelCharSpacing(Math.round(obj.charSpacing || 0));
      setSelLineHeight(Number((obj.lineHeight || 1.3).toFixed(2)));
      setSelTextStrokeColor(String(obj.stroke || '#000000'));
      setSelTextStrokeWidth(Math.round(obj.strokeWidth || 0));
      setSelTextShadowOn(Boolean(obj.shadow));
      setSelTextShadowBlur(Math.round(obj.shadow?.blur ?? 12));
    } else if (type === 'image') {
      setSelectedObjType('image');
      setSelCornerRadius(Math.round(obj.cornerRadius || 0));
      setSelStrokeColor(String(obj.stroke || '#FFFFFF'));
    } else {
      setSelectedObjType('shape');
      setSelFillColor(String(obj.fill || '#2563EB'));
      setSelStrokeColor(String(obj.stroke || '#0F172A'));
      setSelCornerRadius(Math.round(obj.rx || obj.cornerRadius || 0));
    }
  }, []);

  // Fabric.js 캔버스 인스턴스 초기화
  useEffect(() => {
    if (!libsReady || !window.fabric || !canvasElRef.current) return;

    const fabric = window.fabric;
    if (fabric.FabricObject && fabric.FabricObject.ownDefaults) {
      fabric.FabricObject.ownDefaults.transparentCorners = false;
      fabric.FabricObject.ownDefaults.cornerColor = '#2563EB';
      fabric.FabricObject.ownDefaults.cornerStrokeColor = '#FFFFFF';
      fabric.FabricObject.ownDefaults.borderColor = '#2563EB';
      fabric.FabricObject.ownDefaults.cornerSize = 20;
      fabric.FabricObject.ownDefaults.cornerStyle = 'circle';
      fabric.FabricObject.ownDefaults.padding = 8;
    }

    const canvas = new fabric.Canvas(canvasElRef.current, {
      width: targetDimensions.width,
      height: targetDimensions.height,
      backgroundColor: '#0F172A',
      preserveObjectStacking: true,
      selection: true,
    });

    fabricCanvasRef.current = canvas;

    return () => {
      canvas.dispose();
      fabricCanvasRef.current = null;
    };
  }, [libsReady]);

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

  // 캔버스 이벤트 리스너 (정렬 가이드선 스냅, 선택/수정 감지)
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
        obj.set('left', obj.left + (cw / 2 - center.x));
        snappedX = cw / 2;
      }
      if (Math.abs(center.y - ch / 2) < SNAP_DIST) {
        obj.set('top', obj.top + (ch / 2 - center.y));
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
  // 10) [핵심] 슬라이드 데이터를 분리된 Fabric 객체들(글씨 없는 배경 + 캐릭터 + 외곽선 짤 문구)로 배치
  //     ("내 스타일 자동 적용"이 켜져 있으면 저장된 내 스타일의 폰트/색상/테두리/위치를 자동 반영!)
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
      const useMyStyle = Boolean(autoApplyMyStyle && savedUserStyle && !overrideTemplateId);
      const tplId =
        overrideTemplateId ||
        (useMyStyle ? savedUserStyle?.templateId : undefined) ||
        slide.templateId ||
        templateId ||
        'full-bleed-poster';
      const tpl = CARD_TEMPLATES.find((t) => t.id === tplId) || CARD_TEMPLATES[0];

      const bgHex =
        (useMyStyle && savedUserStyle?.bgColor) || slide.customBgColor || tpl.bgColor;
      const effectiveAccent = accentColor || tpl.accentColor;
      const badgeFg = getReadableTextOnAccent(effectiveAccent);
      const mainTextColor = ensureReadableColor(tpl.textColor, bgHex, 4.5);
      const subTextColor = ensureReadableColor(tpl.subTextColor, bgHex, 3.5);

      targetCanvas.clear();
      targetCanvas.backgroundColor = bgHex;
      setCanvasBgColor(bgHex);

      // 슬라이드에 배정된 사진 목록 (없으면 글씨 없는 AI 감성 배경 자동 생성!)
      let photoUrls: string[] =
        Array.isArray(slide.photoUrls) && slide.photoUrls.length > 0
          ? slide.photoUrls.filter(Boolean)
          : slide.photoUrl
          ? [slide.photoUrl]
          : [];

      if (photoUrls.length === 0 && tplId === 'full-bleed-poster') {
        const aiTextFreeBg = generateTextFreeAiBackgroundDataUrl(
          cw,
          ch,
          slide.headline || rawText,
          slide.slideNumber + bgSeedCounter
        );
        if (aiTextFreeBg) {
          photoUrls = [aiTextFreeBg];
        }
      }

      const createPhotoObject = async (
        url: string,
        boxLeft: number,
        boxTop: number,
        boxW: number,
        boxH: number,
        radius = 24,
        slotIdx = 0,
        roleName = 'photo'
      ) => {
        try {
          const imgEl = await loadHtmlImageElement(url);
          const natW = imgEl.naturalWidth || imgEl.width || 800;
          const natH = imgEl.naturalHeight || imgEl.height || 800;
          const scale = Math.max(boxW / natW, boxH / natH);

          const cropW = Math.min(natW, Math.round(boxW / scale));
          const cropH = Math.min(natH, Math.round(boxH / scale));
          const cropX = Math.max(0, Math.round((natW - cropW) / 2));
          const cropY = Math.max(0, Math.round((natH - cropH) / 2));

          const fImg = new ImageClass(imgEl, {
            left: boxLeft,
            top: boxTop,
            cropX,
            cropY,
            width: cropW,
            height: cropH,
            scaleX: scale,
            scaleY: scale,
            customId: `photo-${Date.now()}-${slotIdx}`,
            customRole: roleName,
            originalSrc: url,
            cornerRadius: radius,
            photoSlotIndex: slotIdx,
          });

          if (radius > 0) {
            fImg.set(
              'clipPath',
              new fabric.Rect({
                width: cropW,
                height: cropH,
                rx: radius / scale,
                ry: radius / scale,
                originX: 'center',
                originY: 'center',
              })
            );
          }

          if (tplId === 'polaroid-frame') {
            fImg.set({
              stroke: '#FFFFFF',
              strokeWidth: Math.round(14 / scale),
            });
          }

          targetCanvas.add(fImg);
        } catch (e) {
          console.warn('이미지 로드 실패:', e);
        }
      };

      const placePhotosInBox = async (
        boxLeft: number,
        boxTop: number,
        boxW: number,
        boxH: number,
        radius = 24,
        roleName = 'photo'
      ) => {
        if (photoUrls.length === 0) return;
        const gap = 16;
        if (photoUrls.length === 1) {
          await createPhotoObject(photoUrls[0], boxLeft, boxTop, boxW, boxH, radius, 0, roleName);
        } else if (photoUrls.length === 2) {
          const w = Math.round((boxW - gap) / 2);
          await createPhotoObject(photoUrls[0], boxLeft, boxTop, w, boxH, radius, 0, roleName);
          await createPhotoObject(
            photoUrls[1],
            boxLeft + w + gap,
            boxTop,
            w,
            boxH,
            radius,
            1,
            roleName
          );
        } else if (photoUrls.length === 3) {
          const leftW = Math.round((boxW - gap) * 0.56);
          const rightW = boxW - gap - leftW;
          const halfH = Math.round((boxH - gap) / 2);
          await createPhotoObject(photoUrls[0], boxLeft, boxTop, leftW, boxH, radius, 0, roleName);
          await createPhotoObject(
            photoUrls[1],
            boxLeft + leftW + gap,
            boxTop,
            rightW,
            halfH,
            radius,
            1,
            roleName
          );
          await createPhotoObject(
            photoUrls[2],
            boxLeft + leftW + gap,
            boxTop + halfH + gap,
            rightW,
            halfH,
            radius,
            2,
            roleName
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
              i,
              roleName
            );
          }
        }
      };

      const pad = 72;
      const innerW = cw - pad * 2;

      if (tplId === 'full-bleed-poster') {
        if (photoUrls.length > 0) {
          await placePhotosInBox(0, 0, cw, ch, 0, 'bg-photo');
        }
      } else if (
        tplId === 'top-photo-card' ||
        tplId === 'polaroid-frame' ||
        tplId === 'dark-neon-card'
      ) {
        const photoH = photoUrls.length > 0 ? Math.round(ch * 0.46) : 0;
        if (photoUrls.length > 0) {
          await placePhotosInBox(
            pad,
            136,
            innerW,
            photoH,
            tplId === 'polaroid-frame' ? 8 : 28
          );
        }
        const cardTop = photoUrls.length > 0 ? 136 + photoH + 28 : 160;
        const cardH = ch - cardTop - pad;
        const cardRect = new fabric.Rect({
          left: pad,
          top: cardTop,
          width: innerW,
          height: Math.max(240, cardH),
          fill: tpl.cardBoxColor,
          rx: 28,
          ry: 28,
          customId: `cardbox-${Date.now()}`,
          customRole: 'shape-card',
        });
        targetCanvas.add(cardRect);
      } else if (tplId === 'bottom-photo-card') {
        const photoH = photoUrls.length > 0 ? Math.round(ch * 0.46) : 0;
        if (photoUrls.length > 0) {
          await placePhotosInBox(pad, ch - pad - photoH, innerW, photoH, 28);
        }
      } else if (tplId === 'split-magazine') {
        if (photoUrls.length > 0) {
          const leftW = Math.round(innerW * 0.46);
          await placePhotosInBox(pad, 140, leftW, ch - 140 - pad, 28);
        }
      } else if (tplId === 'center-focus-box') {
        if (photoUrls.length > 0) {
          await placePhotosInBox(0, 0, cw, ch, 0, 'bg-photo');
        }
        const boxW = cw - 120;
        const boxH = Math.round(ch * 0.52);
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
          await placePhotosInBox(pad, 136, innerW, photoH, 20);
        }
      }

      // 내가 등록한 캐릭터 원본이 있으면 첫 캐릭터를 우측 하단에 스티커 객체로 자동 배치 가능
      if (characterAssets.length > 0) {
        const charItem = characterAssets[(slide.slideNumber - 1) % characterAssets.length];
        if (charItem) {
          try {
            const charImgEl = await loadHtmlImageElement(charItem.url);
            const charScale = 280 / (charImgEl.naturalWidth || 400);
            const charFabricObj = new ImageClass(charImgEl, {
              left: cw - 340,
              top: ch - 360,
              scaleX: charScale,
              scaleY: charScale,
              customId: `char-${Date.now()}`,
              customRole: 'character',
              originalSrc: charItem.url,
            });
            targetCanvas.add(charFabricObj);
          } catch {
            // ignore
          }
        }
      }

      // 상단 뱃지 도형 + 뱃지 글씨
      if (slide.badgeText) {
        const badgeW = Math.max(150, slide.badgeText.length * 24 + 52);
        const badgeBg = new fabric.Rect({
          left: pad,
          top: 56,
          width: badgeW,
          height: 54,
          fill: effectiveAccent,
          rx: 16,
          ry: 16,
          customId: `badge-bg-${Date.now()}`,
          customRole: 'badge-bg',
        });
        const badgeTxt = new fabric.Textbox(slide.badgeText, {
          left: pad + 12,
          top: 68,
          width: badgeW - 24,
          fontSize: 25,
          fontFamily: useMyStyle ? savedUserStyle!.fontFamily : fontId,
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
          top: 66,
          width: 130,
          fontSize: 26,
          fontFamily: useMyStyle ? savedUserStyle!.fontFamily : fontId,
          fontWeight: 'bold',
          fill: tplId === 'full-bleed-poster' ? '#FFFFFF' : subTextColor,
          textAlign: 'right',
          customId: `slidenum-${Date.now()}`,
          customRole: 'slide-number',
        });
        targetCanvas.add(numTxt);
      }

      // 제목(headline) & 본문(body) 위치 및 스타일 ("내 스타일" 우선 적용!)
      let textLeft = pad + 24;
      let textWidth = innerW - 48;
      let headlineTop = Math.round(ch * 0.56);
      let align: 'left' | 'center' | 'right' =
        tplId === 'full-bleed-poster' ? 'center' : 'left';

      if (tplId === 'bottom-photo-card') {
        textLeft = pad;
        textWidth = innerW;
        headlineTop = 160;
      } else if (tplId === 'split-magazine' && photoUrls.length > 0) {
        const leftW = Math.round(innerW * 0.46);
        textLeft = pad + leftW + 40;
        textWidth = innerW - leftW - 40;
        headlineTop = Math.round(ch * 0.34);
      } else if (tplId === 'center-focus-box') {
        textLeft = 110;
        textWidth = cw - 220;
        headlineTop = Math.round(ch * 0.35);
        align = 'center';
      }

      if (useMyStyle && savedUserStyle) {
        textLeft = savedUserStyle.titleLeft ?? textLeft;
        headlineTop = savedUserStyle.titleTop ?? headlineTop;
        align = savedUserStyle.textAlign ?? align;
      }

      const defaultTitleColor =
        useMyStyle && savedUserStyle
          ? savedUserStyle.textColor
          : tplId === 'full-bleed-poster'
          ? '#FFFFFF'
          : tplId === 'center-focus-box'
          ? '#0F172A'
          : mainTextColor;

      const defaultStrokeColor =
        useMyStyle && savedUserStyle
          ? savedUserStyle.strokeColor
          : tplId === 'full-bleed-poster'
          ? '#000000'
          : '';

      const defaultStrokeWidth =
        useMyStyle && savedUserStyle
          ? savedUserStyle.strokeWidth
          : tplId === 'full-bleed-poster'
          ? 6
          : 0;

      const shadowObj =
        (useMyStyle ? savedUserStyle?.useShadow : tplId === 'full-bleed-poster') &&
        fabric.Shadow
          ? new fabric.Shadow({
              color: 'rgba(0,0,0,0.65)',
              blur: useMyStyle ? savedUserStyle?.shadowBlur ?? 12 : 14,
              offsetX: 0,
              offsetY: 4,
            })
          : null;

      const headlineTextbox = new fabric.Textbox(slide.headline || '짤 제목을 입력하세요', {
        left: textLeft,
        top: headlineTop,
        width: textWidth,
        fontSize: useMyStyle
          ? savedUserStyle!.titleFontSize
          : tplId === 'full-bleed-poster'
          ? 64
          : 52,
        fontFamily: useMyStyle ? savedUserStyle!.fontFamily : fontId,
        fontWeight: useMyStyle ? savedUserStyle!.fontWeight : 'bold',
        fill: defaultTitleColor,
        stroke: defaultStrokeColor || null,
        strokeWidth: defaultStrokeWidth,
        paintFirst: 'stroke',
        strokeLineJoin: 'round',
        shadow: shadowObj,
        textAlign: align,
        lineHeight: useMyStyle ? savedUserStyle!.lineHeight : 1.28,
        charSpacing: useMyStyle ? savedUserStyle!.charSpacing : 0,
        customId: `headline-${Date.now()}`,
        customRole: 'headline',
      });
      targetCanvas.add(headlineTextbox);

      const headlineHeight = headlineTextbox.calcTextHeight
        ? headlineTextbox.calcTextHeight()
        : 130;

      const bodyTextbox = new fabric.Textbox(slide.body || '본문 대사를 입력하세요', {
        left: useMyStyle && savedUserStyle ? savedUserStyle.bodyLeft : textLeft,
        top:
          useMyStyle && savedUserStyle
            ? savedUserStyle.bodyTop
            : headlineTop + headlineHeight + 28,
        width: textWidth,
        fontSize: useMyStyle ? savedUserStyle!.bodyFontSize : 32,
        fontFamily: useMyStyle ? savedUserStyle!.fontFamily : fontId,
        fontWeight: 'bold',
        fill:
          tplId === 'full-bleed-poster'
            ? '#F8FAFC'
            : tplId === 'center-focus-box'
            ? '#334155'
            : subTextColor,
        stroke: tplId === 'full-bleed-poster' ? '#000000' : null,
        strokeWidth: tplId === 'full-bleed-poster' ? 4 : 0,
        paintFirst: 'stroke',
        strokeLineJoin: 'round',
        shadow: shadowObj,
        textAlign: align,
        lineHeight: 1.45,
        charSpacing: 0,
        customId: `body-${Date.now()}`,
        customRole: 'body',
      });
      targetCanvas.add(bodyTextbox);

      targetCanvas.requestRenderAll();
    },
    [
      targetDimensions.width,
      targetDimensions.height,
      autoApplyMyStyle,
      savedUserStyle,
      templateId,
      accentColor,
      fontId,
      rawText,
      bgSeedCounter,
      characterAssets,
    ]
  );

  // ==========================================================================
  // 11) 슬라이드 전환 시 `design_json`(`fabricJson`) 복원 또는 초기 객체 생성
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
      if (activeSlide.fabricJson && activeSlide.fabricJson.objects) {
        try {
          const res = canvas.loadFromJSON(activeSlide.fabricJson, () => {
            if (activeSlide.fabricJson.background) {
              canvas.backgroundColor = activeSlide.fabricJson.background;
              setCanvasBgColor(String(activeSlide.fabricJson.background));
            }
            canvas.requestRenderAll();
          });
          if (res && typeof res.then === 'function') {
            await res;
            if (activeSlide.fabricJson.background) {
              canvas.backgroundColor = activeSlide.fabricJson.background;
              setCanvasBgColor(String(activeSlide.fabricJson.background));
            }
            canvas.requestRenderAll();
          }
        } catch {
          await buildFabricObjectsForSlide(canvas, activeSlide, slides.length);
        }
      } else {
        await buildFabricObjectsForSlide(canvas, activeSlide, slides.length);
      }

      if (cancelled) return;
      isRestoringRef.current = false;

      const jsonObj = canvas.toObject(CUSTOM_PROPS);
      jsonObj.background = canvas.backgroundColor || '#0F172A';
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
  }, [libsReady, activeSlide?.id, activeSlideIndex]);

  // ==========================================================================
  // 12) 실행 취소 (Undo) / 다시 실행 (Redo)
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

    const parsed = JSON.parse(prevJson);
    const res = canvas.loadFromJSON(parsed, () => {
      if (parsed.background) {
        canvas.backgroundColor = parsed.background;
        setCanvasBgColor(String(parsed.background));
      }
      canvas.requestRenderAll();
    });
    if (res && typeof res.then === 'function') {
      await res;
      if (parsed.background) {
        canvas.backgroundColor = parsed.background;
        setCanvasBgColor(String(parsed.background));
      }
      canvas.requestRenderAll();
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

    const parsed = JSON.parse(nextJson);
    const res = canvas.loadFromJSON(parsed, () => {
      if (parsed.background) {
        canvas.backgroundColor = parsed.background;
        setCanvasBgColor(String(parsed.background));
      }
      canvas.requestRenderAll();
    });
    if (res && typeof res.then === 'function') {
      await res;
      if (parsed.background) {
        canvas.backgroundColor = parsed.background;
        setCanvasBgColor(String(parsed.background));
      }
      canvas.requestRenderAll();
    }

    isRestoringRef.current = false;
    setCanUndo(historyMapRef.current[activeSlide.id].length > 1);
    setCanRedo(redoMapRef.current[activeSlide.id].length > 0);
    saveCanvasToActiveSlide(false);
  }, [activeSlide, saveCanvasToActiveSlide]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const canvas = fabricCanvasRef.current;
      const activeObj = canvas?.getActiveObject?.();
      if (activeObj && activeObj.isEditing) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
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
  // 13) [기능 1: 내 폰트 업로드 (10MB 제한, 확장자 검사, Supabase Storage & user_fonts 기록)]
  // ==========================================================================
  async function handleCustomFontUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];

    // 1) 파일 형식 검사 (.ttf, .otf, .woff, .woff2)
    const extMatch = file.name.match(/\.(ttf|otf|woff2?)$/i);
    if (!extMatch) {
      showToast(
        '⚠️ 지원하지 않는 파일 형식입니다. .ttf, .otf, .woff, .woff2 폰트 파일만 올릴 수 있어요!'
      );
      return;
    }

    // 2) 파일 크기 제한 검사 (10MB = 10 * 1024 * 1024 bytes)
    const MAX_FONT_BYTES = 10 * 1024 * 1024;
    if (file.size > MAX_FONT_BYTES) {
      showToast(
        `⚠️ 폰트 파일 크기가 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(
          1
        )}MB). 10MB 이하의 폰트 파일만 올려주세요.`
      );
      return;
    }

    const fileExt = extMatch[1].toLowerCase();
    const cleanName = file.name.replace(/\.(ttf|otf|woff2?)$/i, '');
    const customFontId = `UserFont_${cleanName.replace(/[^a-zA-Z0-9가-힣_-]/g, '_')}`;

    try {
      const arrayBuf = await file.arrayBuffer();
      const base64Data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
      });

      // 브라우저 FontFace API 등록
      if (typeof window !== 'undefined' && 'FontFace' in window) {
        const fontFace = new FontFace(customFontId, arrayBuf);
        await fontFace.load();
        document.fonts.add(fontFace);
      }

      let publicFontUrl = '';
      // 로그인 상태면 Supabase Storage(사용자별 폴더) 및 user_fonts 테이블에 기록
      if (userId) {
        try {
          const supabase = getSupabaseBrowser();
          const storagePath = `${userId}/font-${Date.now()}.${fileExt}`;

          // user-fonts 버킷 시도 후 없으면 user-uploads 버킷에 안전 업로드
          let bucketUsed = 'user-fonts';
          const { error: fontBucketErr } = await supabase.storage
            .from('user-fonts')
            .upload(storagePath, file, { upsert: true });

          if (fontBucketErr) {
            bucketUsed = 'user-uploads';
            await supabase.storage
              .from('user-uploads')
              .upload(`fonts/${storagePath}`, file, { upsert: true });
          }

          const { data: urlData } = supabase.storage
            .from(bucketUsed)
            .getPublicUrl(bucketUsed === 'user-fonts' ? storagePath : `fonts/${storagePath}`);

          if (urlData?.publicUrl) {
            publicFontUrl = urlData.publicUrl;
          }

          await supabase.from('user_fonts').insert({
            user_id: userId,
            font_name: cleanName,
            font_family: customFontId,
            storage_path: storagePath,
            public_url: publicFontUrl || base64Data,
            file_size: file.size,
            file_ext: fileExt,
          });
        } catch {
          // 테이블 생성 전에도 localForage로 정상 저장
        }
      }

      const newFont: CustomFontItem = {
        id: customFontId,
        name: `${cleanName} (내 폰트)`,
        base64Data,
        publicUrl: publicFontUrl || undefined,
        fileExt,
        fileSize: file.size,
      };

      const nextList = [...customFonts.filter((f) => f.id !== customFontId), newFont];
      setCustomFonts(nextList);
      await saveToLocalDb(`${storageKeyPrefix}custom_fonts`, nextList);

      applyFontToSelectionOrAll(customFontId);
      showToast(`✅ '${cleanName}' 폰트가 등록되었습니다! (상업적 사용 허가를 꼭 확인해 주세요)`);
    } catch {
      showToast('⚠️ 폰트 파일을 읽지 못했습니다. 손상되지 않은 .ttf, .otf, .woff 파일을 사용해 주세요.');
    }
  }

  async function handleDeleteCustomFont(id: string) {
    const nextList = customFonts.filter((f) => f.id !== id);
    setCustomFonts(nextList);
    await saveToLocalDb(`${storageKeyPrefix}custom_fonts`, nextList);
    if (userId) {
      try {
        await getSupabaseBrowser()
          .from('user_fonts')
          .delete()
          .eq('user_id', userId)
          .eq('font_family', id);
      } catch {
        // ignore
      }
    }
    showToast('내 폰트가 삭제되었습니다.');
  }

  function applyFontToSelectionOrAll(targetFontId: string) {
    setFontId(targetFontId);
    setSelFontFamily(targetFontId);
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (active && (active.type === 'textbox' || active.type === 'i-text' || active.type === 'text')) {
      active.set('fontFamily', targetFontId);
      canvas.requestRenderAll();
      saveCanvasToActiveSlide(true);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      canvas.getObjects().forEach((o: any) => {
        if (o.type === 'textbox' || o.type === 'i-text' || o.type === 'text') {
          o.set('fontFamily', targetFontId);
        }
      });
      canvas.requestRenderAll();
      saveCanvasToActiveSlide(true);
    }
  }

  // ==========================================================================
  // 14) [핵심 기능 3: "내 스타일 저장" & 불러오기 (사용자별 분리 저장)]
  // ==========================================================================
  async function handleSaveMyStyle() {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const objs: any[] = canvas.getObjects();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const headlineObj = objs.find((o: any) => o.customRole === 'headline') ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      objs.find((o: any) => o.type === 'textbox');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bodyObj = objs.find((o: any) => o.customRole === 'body');

    const newStyle: UserSavedStyle = {
      fontFamily: String(headlineObj?.fontFamily || fontId).replace(/['"]/g, ''),
      titleFontSize: Math.round(headlineObj?.fontSize || 60),
      bodyFontSize: Math.round(bodyObj?.fontSize || 32),
      fontWeight: String(headlineObj?.fontWeight || 'bold'),
      textColor: String(headlineObj?.fill || '#FFFFFF'),
      strokeColor: String(headlineObj?.stroke || '#000000'),
      strokeWidth: Math.round(headlineObj?.strokeWidth || 0),
      useShadow: Boolean(headlineObj?.shadow),
      shadowBlur: Math.round(headlineObj?.shadow?.blur ?? 12),
      textAlign: (headlineObj?.textAlign as 'left' | 'center' | 'right') || 'center',
      charSpacing: Math.round(headlineObj?.charSpacing || 0),
      lineHeight: Number(headlineObj?.lineHeight || 1.28),
      titleLeft: Math.round(headlineObj?.left ?? 96),
      titleTop: Math.round(headlineObj?.top ?? 720),
      bodyLeft: Math.round(bodyObj?.left ?? 96),
      bodyTop: Math.round(bodyObj?.top ?? 880),
      bgColor: String(canvas.backgroundColor || '#0F172A'),
      templateId,
    };

    setSavedUserStyle(newStyle);
    await saveToLocalDb(`${storageKeyPrefix}my_style`, newStyle);

    if (userId) {
      try {
        await getSupabaseBrowser()
          .from('user_styles')
          .upsert(
            {
              user_id: userId,
              style_name: '내 기본 짤 스타일',
              style_json: newStyle,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          );
      } catch {
        // user_styles 테이블 생성 전에도 localForage에 안전 저장됨
      }
    }

    showToast(
      '⭐ 내가 고친 글씨 위치·폰트·크기·색상·테두리가 [내 스타일]로 저장되었습니다! 다음 짤에도 자동 적용됩니다.'
    );
  }

  function handleApplySavedStyleToCurrentCanvas() {
    if (!savedUserStyle) {
      showToast('⚠️ 아직 저장된 [내 스타일]이 없습니다. 먼저 [⭐ 내 스타일로 저장]을 눌러주세요!');
      return;
    }
    const canvas = fabricCanvasRef.current;
    if (!canvas || !window.fabric) return;
    const fabric = window.fabric;

    canvas.backgroundColor = savedUserStyle.bgColor;
    setCanvasBgColor(savedUserStyle.bgColor);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    canvas.getObjects().forEach((o: any) => {
      if (o.type === 'textbox' || o.type === 'i-text' || o.type === 'text') {
        const isHeadline = o.customRole === 'headline';
        const isBody = o.customRole === 'body';
        o.set({
          fontFamily: savedUserStyle.fontFamily,
          fontSize: isHeadline
            ? savedUserStyle.titleFontSize
            : isBody
            ? savedUserStyle.bodyFontSize
            : o.fontSize,
          fontWeight: savedUserStyle.fontWeight,
          fill: savedUserStyle.textColor,
          stroke: savedUserStyle.strokeColor || null,
          strokeWidth: savedUserStyle.strokeWidth,
          paintFirst: 'stroke',
          strokeLineJoin: 'round',
          shadow:
            savedUserStyle.useShadow && fabric.Shadow
              ? new fabric.Shadow({
                  color: 'rgba(0,0,0,0.65)',
                  blur: savedUserStyle.shadowBlur,
                  offsetX: 0,
                  offsetY: 4,
                })
              : null,
          textAlign: savedUserStyle.textAlign,
          charSpacing: savedUserStyle.charSpacing,
          lineHeight: savedUserStyle.lineHeight,
        });
        if (isHeadline) {
          o.set({ left: savedUserStyle.titleLeft, top: savedUserStyle.titleTop });
        } else if (isBody) {
          o.set({ left: savedUserStyle.bodyLeft, top: savedUserStyle.bodyTop });
        }
        o.setCoords();
      }
    });

    canvas.requestRenderAll();
    saveCanvasToActiveSlide(true);
    showToast('✨ 현재 카드에 저장된 [내 스타일]을 그대로 입혔습니다!');
  }

  // ==========================================================================
  // 15) [기능 2: 글씨 세부 편집 + 글씨 테두리(외곽선)/그림자]
  // ==========================================================================
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function updateSelectedTextProp(prop: string, value: any) {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;

    active.set(prop, value);
    if (prop === 'stroke' || prop === 'strokeWidth') {
      active.set({ paintFirst: 'stroke', strokeLineJoin: 'round' });
    }
    if (prop === 'text') {
      active.initDimensions?.();
    }
    canvas.requestRenderAll();
    saveCanvasToActiveSlide(true);
  }

  function handleUpdateTextShadow(enabled: boolean, blurVal: number) {
    setSelTextShadowOn(enabled);
    setSelTextShadowBlur(blurVal);
    const canvas = fabricCanvasRef.current;
    if (!canvas || !window.fabric) return;
    const active = canvas.getActiveObject();
    if (!active) return;

    if (!enabled) {
      active.set('shadow', null);
    } else {
      active.set(
        'shadow',
        new window.fabric.Shadow({
          color: 'rgba(0,0,0,0.75)',
          blur: blurVal,
          offsetX: 0,
          offsetY: 4,
        })
      );
    }
    canvas.requestRenderAll();
    saveCanvasToActiveSlide(true);
  }

  // 원클릭 짤 글씨 테두리 프리셋
  function applyMemeTextPreset(preset: 'white-black' | 'yellow-black' | 'black-white' | 'clean') {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !window.fabric) return;
    const active = canvas.getActiveObject();
    if (!active) return;

    if (preset === 'white-black') {
      active.set({
        fill: '#FFFFFF',
        stroke: '#000000',
        strokeWidth: 7,
        paintFirst: 'stroke',
        strokeLineJoin: 'round',
      });
      setSelTextColor('#FFFFFF');
      setSelTextStrokeColor('#000000');
      setSelTextStrokeWidth(7);
    } else if (preset === 'yellow-black') {
      active.set({
        fill: '#FACC15',
        stroke: '#000000',
        strokeWidth: 8,
        paintFirst: 'stroke',
        strokeLineJoin: 'round',
      });
      setSelTextColor('#FACC15');
      setSelTextStrokeColor('#000000');
      setSelTextStrokeWidth(8);
    } else if (preset === 'black-white') {
      active.set({
        fill: '#0F172A',
        stroke: '#FFFFFF',
        strokeWidth: 7,
        paintFirst: 'stroke',
        strokeLineJoin: 'round',
      });
      setSelTextColor('#0F172A');
      setSelTextStrokeColor('#FFFFFF');
      setSelTextStrokeWidth(7);
    } else {
      active.set({
        stroke: null,
        strokeWidth: 0,
      });
      setSelTextStrokeWidth(0);
    }
    canvas.requestRenderAll();
    saveCanvasToActiveSlide(true);
  }

  function handleAddTextObject(preset: 'headline' | 'body' | 'badge') {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !window.fabric) return;
    const fabric = window.fabric;

    const isTitle = preset === 'headline';
    const isBadge = preset === 'badge';

    const textbox = new fabric.Textbox(
      isTitle
        ? '새 짤 문구를 더블클릭해 수정하세요'
        : isBadge
        ? '오늘의 핵심'
        : '보조 대사를 입력하세요',
      {
        left: Math.round((canvas.width || 1080) / 2 - 340),
        top: Math.round((canvas.height || 1350) / 2 - 60),
        width: isBadge ? 260 : 680,
        fontSize: isTitle ? 60 : isBadge ? 28 : 34,
        fontFamily: fontId,
        fontWeight: 'bold',
        fill: '#FFFFFF',
        stroke: isBadge ? null : '#000000',
        strokeWidth: isBadge ? 0 : 6,
        paintFirst: 'stroke',
        strokeLineJoin: 'round',
        textBackgroundColor: isBadge ? accentColor : '',
        textAlign: 'center',
        lineHeight: 1.32,
        charSpacing: 0,
        customId: `text-${Date.now()}`,
        customRole: isTitle ? 'headline' : 'custom-text',
      }
    );

    canvas.add(textbox);
    canvas.setActiveObject(textbox);
    canvas.requestRenderAll();
    syncSelectionState(textbox);
    saveCanvasToActiveSlide(true);
    showToast('✏️ 새 짤 글씨가 추가되었습니다! 드래그하거나 더블클릭해 수정하세요.');
  }

  // ==========================================================================
  // 16) [기능 3: AI 배경만 다시 만들기 (글씨와 내가 고친 배치는 100% 그대로 유지!)]
  // ==========================================================================
  async function handleRegenerateAiBackgroundOnly() {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !window.fabric) return;
    const fabric = window.fabric;
    const ImageClass = fabric.FabricImage || fabric.Image;

    const nextSeed = bgSeedCounter + 1;
    setBgSeedCounter(nextSeed);

    const cw = canvas.width || 1080;
    const ch = canvas.height || 1350;

    // 업로드된 배경 사진이 여러 장 있으면 다음 사진으로 순환, 없으면 글씨 없는 새 AI 배경 생성
    let nextBgUrl = '';
    if (uploadedPhotos.length > 0) {
      nextBgUrl = uploadedPhotos[nextSeed % uploadedPhotos.length].url;
    } else {
      nextBgUrl = generateTextFreeAiBackgroundDataUrl(
        cw,
        ch,
        activeSlide?.headline || rawText,
        nextSeed
      );
    }

    try {
      const imgEl = await loadHtmlImageElement(nextBgUrl);
      // 기존 배경 사진 객체만 찾아서 교체 (글씨, 캐릭터, 도형 위치는 전혀 건드리지 않음!)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existingBg = canvas.getObjects().find((o: any) => o.customRole === 'bg-photo' || o.customRole === 'photo');

      if (existingBg) {
        const prevW = existingBg.getScaledWidth();
        const prevH = existingBg.getScaledHeight();
        const scale = Math.max(prevW / imgEl.naturalWidth, prevH / imgEl.naturalHeight);
        const cropW = Math.min(imgEl.naturalWidth, Math.round(prevW / scale));
        const cropH = Math.min(imgEl.naturalHeight, Math.round(prevH / scale));
        const cropX = Math.max(0, Math.round((imgEl.naturalWidth - cropW) / 2));
        const cropY = Math.max(0, Math.round((imgEl.naturalHeight - cropH) / 2));

        if (typeof existingBg.setElement === 'function') {
          existingBg.setElement(imgEl);
        }
        existingBg.set({
          cropX,
          cropY,
          width: cropW,
          height: cropH,
          scaleX: scale,
          scaleY: scale,
          originalSrc: nextBgUrl,
        });
      } else {
        const scale = Math.max(cw / imgEl.naturalWidth, ch / imgEl.naturalHeight);
        const bgImg = new ImageClass(imgEl, {
          left: 0,
          top: 0,
          scaleX: scale,
          scaleY: scale,
          customId: `bg-photo-${Date.now()}`,
          customRole: 'bg-photo',
          originalSrc: nextBgUrl,
        });
        canvas.add(bgImg);
        if (typeof canvas.sendObjectToBack === 'function') canvas.sendObjectToBack(bgImg);
        else if (typeof canvas.sendToBack === 'function') canvas.sendToBack(bgImg);
      }

      canvas.requestRenderAll();
      saveCanvasToActiveSlide(true);
      showToast('🎨 글씨와 내가 고친 배치는 그대로 두고 배경 그림만 새로 바꿨습니다!');
    } catch {
      showToast('⚠️ 배경 이미지를 불러오는 중 오류가 발생했습니다.');
    }
  }

  // ==========================================================================
  // 17) [기능 3: 캐릭터 원본 추가 · 사진 여러 장 추가 · 교체 · 회전 · 크롭 · 레이어]
  // ==========================================================================
  async function handleAddPhotoToCanvas(
    url: string,
    role: 'photo' | 'character' = 'photo'
  ) {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !window.fabric) return;
    const fabric = window.fabric;
    const ImageClass = fabric.FabricImage || fabric.Image;

    try {
      const imgEl = await loadHtmlImageElement(url);
      const targetW = role === 'character' ? 360 : 560;
      const scale = targetW / (imgEl.naturalWidth || 600);
      const offset =
        (canvas.getObjects().filter((o: { type: string }) => o.type === 'image').length % 5) * 32;

      const fImg = new ImageClass(imgEl, {
        left: role === 'character' ? 360 + offset : 220 + offset,
        top: role === 'character' ? 420 + offset : 240 + offset,
        scaleX: scale,
        scaleY: scale,
        cornerRadius: role === 'character' ? 0 : 20,
        customId: `${role}-${Date.now()}`,
        customRole: role,
        originalSrc: url,
      });

      if (role !== 'character') {
        fImg.set(
          'clipPath',
          new fabric.Rect({
            width: imgEl.naturalWidth,
            height: imgEl.naturalHeight,
            rx: 20 / scale,
            ry: 20 / scale,
            originX: 'center',
            originY: 'center',
          })
        );
      }

      canvas.add(fImg);
      canvas.setActiveObject(fImg);
      canvas.requestRenderAll();
      syncSelectionState(fImg);
      saveCanvasToActiveSlide(true);
      showToast(
        role === 'character'
          ? '🐻 내 캐릭터 원본이 캔버스 위에 올라갔습니다! 원하는 위치와 크기로 맞춰보세요.'
          : '🖼️ 사진/스티커가 추가되었습니다!'
      );
    } catch {
      showToast('⚠️ 이미지를 불러오지 못했습니다. 다른 이미지 파일로 다시 시도해 주세요.');
    }
  }

  async function handleReplaceSelectedPhoto(newUrl: string) {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !window.fabric) return;
    const active = canvas.getActiveObject();
    if (!active || active.type !== 'image') {
      await handleAddPhotoToCanvas(newUrl, 'photo');
      return;
    }

    try {
      const imgEl = await loadHtmlImageElement(newUrl);
      const prevDisplayW = active.getScaledWidth();
      const prevDisplayH = active.getScaledHeight();
      const natW = imgEl.naturalWidth || imgEl.width || 800;
      const natH = imgEl.naturalHeight || imgEl.height || 800;

      const scale = Math.max(prevDisplayW / natW, prevDisplayH / natH);
      const cropW = Math.min(natW, Math.round(prevDisplayW / scale));
      const cropH = Math.min(natH, Math.round(prevDisplayH / scale));
      const cropX = Math.max(0, Math.round((natW - cropW) / 2));
      const cropY = Math.max(0, Math.round((natH - cropH) / 2));

      if (typeof active.setElement === 'function') {
        active.setElement(imgEl);
      }
      active.set({
        cropX,
        cropY,
        width: cropW,
        height: cropH,
        scaleX: scale,
        scaleY: scale,
        originalSrc: newUrl,
      });

      const radius = active.cornerRadius || 0;
      if (radius > 0) {
        active.set(
          'clipPath',
          new window.fabric.Rect({
            width: cropW,
            height: cropH,
            rx: radius / scale,
            ry: radius / scale,
            originX: 'center',
            originY: 'center',
          })
        );
      }

      canvas.requestRenderAll();
      saveCanvasToActiveSlide(true);
      showToast('🔄 선택한 그림/캐릭터가 교체되었습니다!');
    } catch {
      showToast('⚠️ 이미지 교체 중 오류가 발생했습니다.');
    }
  }

  function handlePhotoCornerRadiusChange(radius: number) {
    setSelCornerRadius(radius);
    const canvas = fabricCanvasRef.current;
    if (!canvas || !window.fabric) return;
    const active = canvas.getActiveObject();
    if (!active) return;

    if (active.type === 'image') {
      const scale = active.scaleX || 1;
      active.set('cornerRadius', radius);
      if (radius <= 0) {
        active.set('clipPath', null);
      } else {
        active.set(
          'clipPath',
          new window.fabric.Rect({
            width: active.width,
            height: active.height,
            rx: radius / scale,
            ry: radius / scale,
            originX: 'center',
            originY: 'center',
          })
        );
      }
    } else if (active.type === 'rect') {
      active.set({ rx: radius, ry: radius, cornerRadius: radius });
    }
    canvas.requestRenderAll();
    saveCanvasToActiveSlide(true);
  }

  function handleStartCropMode() {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !window.fabric) return;
    const active = canvas.getActiveObject();
    if (!active || active.type !== 'image') {
      showToast('⚠️ 먼저 자를 그림이나 캐릭터를 클릭해 주세요!');
      return;
    }

    const fabric = window.fabric;
    cropTargetImgRef.current = active;
    const bound = active.getBoundingRect();

    const cropRect = new fabric.Rect({
      left: bound.left + bound.width * 0.1,
      top: bound.top + bound.height * 0.1,
      width: bound.width * 0.8,
      height: bound.height * 0.8,
      fill: 'rgba(37, 99, 235, 0.18)',
      stroke: '#2563EB',
      strokeWidth: 4,
      strokeDashArray: [12, 8],
      cornerColor: '#2563EB',
      customRole: 'crop-zone',
    });

    cropRectRef.current = cropRect;
    setIsCropping(true);
    canvas.add(cropRect);
    canvas.setActiveObject(cropRect);
    canvas.requestRenderAll();
    showToast('✂️ 파란색 점선 박스를 조절한 뒤 [자르기 완료]를 누르세요!');
  }

  function handleApplyCrop() {
    const canvas = fabricCanvasRef.current;
    const cropRect = cropRectRef.current;
    const imgObj = cropTargetImgRef.current;
    if (!canvas || !cropRect || !imgObj) return;

    const scaleX = imgObj.scaleX || 1;
    const scaleY = imgObj.scaleY || 1;

    const relLeft = Math.max(0, (cropRect.left - imgObj.left) / scaleX);
    const relTop = Math.max(0, (cropRect.top - imgObj.top) / scaleY);
    const newW = Math.max(40, Math.min(imgObj.width - relLeft, cropRect.getScaledWidth() / scaleX));
    const newH = Math.max(40, Math.min(imgObj.height - relTop, cropRect.getScaledHeight() / scaleY));

    imgObj.set({
      cropX: (imgObj.cropX || 0) + relLeft,
      cropY: (imgObj.cropY || 0) + relTop,
      left: cropRect.left,
      top: cropRect.top,
      width: newW,
      height: newH,
    });

    if (imgObj.cornerRadius > 0 && window.fabric) {
      imgObj.set(
        'clipPath',
        new window.fabric.Rect({
          width: newW,
          height: newH,
          rx: imgObj.cornerRadius / scaleX,
          ry: imgObj.cornerRadius / scaleY,
          originX: 'center',
          originY: 'center',
        })
      );
    }

    canvas.remove(cropRect);
    cropRectRef.current = null;
    cropTargetImgRef.current = null;
    setIsCropping(false);
    canvas.setActiveObject(imgObj);
    canvas.requestRenderAll();
    saveCanvasToActiveSlide(true);
    showToast('✅ 선택한 영역으로 깔끔하게 잘렸습니다!');
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

  function handleLayerOrder(dir: 'front' | 'forward' | 'backward' | 'back') {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;

    if (dir === 'front') {
      if (typeof canvas.bringObjectToFront === 'function') canvas.bringObjectToFront(active);
      else if (typeof canvas.bringToFront === 'function') canvas.bringToFront(active);
    } else if (dir === 'forward') {
      if (typeof canvas.bringObjectForward === 'function') canvas.bringObjectForward(active);
      else if (typeof canvas.bringForward === 'function') canvas.bringForward(active);
    } else if (dir === 'backward') {
      if (typeof canvas.sendObjectBackwards === 'function') canvas.sendObjectBackwards(active);
      else if (typeof canvas.sendBackwards === 'function') canvas.sendBackwards(active);
    } else if (dir === 'back') {
      if (typeof canvas.sendObjectToBack === 'function') canvas.sendObjectToBack(active);
      else if (typeof canvas.sendToBack === 'function') canvas.sendToBack(active);
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
    canvas.requestRenderAll();
    setSelectedObjType('none');
    saveCanvasToActiveSlide(true);
  }

  function handleAddShape(shapeType: 'rect' | 'circle' | 'line') {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !window.fabric) return;
    const fabric = window.fabric;

    const cx = Math.round((canvas.width || 1080) / 2);
    const cy = Math.round((canvas.height || 1350) / 2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let shapeObj: any;

    if (shapeType === 'rect') {
      shapeObj = new fabric.Rect({
        left: cx - 220,
        top: cy - 110,
        width: 440,
        height: 220,
        fill: accentColor,
        rx: 28,
        ry: 28,
        opacity: 0.9,
        customId: `rect-${Date.now()}`,
        customRole: 'shape',
      });
    } else if (shapeType === 'circle') {
      shapeObj = new fabric.Circle({
        left: cx - 120,
        top: cy - 120,
        radius: 120,
        fill: accentColor,
        opacity: 0.9,
        customId: `circle-${Date.now()}`,
        customRole: 'shape',
      });
    } else {
      shapeObj = new fabric.Line([cx - 260, cy, cx + 260, cy], {
        stroke: accentColor,
        strokeWidth: 8,
        customId: `line-${Date.now()}`,
        customRole: 'shape',
      });
    }

    canvas.add(shapeObj);
    canvas.setActiveObject(shapeObj);
    canvas.requestRenderAll();
    syncSelectionState(shapeObj);
    saveCanvasToActiveSlide(true);
  }

  async function handleApplyTemplate(newTplId: CardTemplateId, applyToAll = false) {
    setTemplateId(newTplId);
    const tpl = CARD_TEMPLATES.find((t) => t.id === newTplId) || CARD_TEMPLATES[0];
    setAccentColor(tpl.accentColor);

    const canvas = fabricCanvasRef.current;
    if (!canvas || !activeSlide) return;

    await buildFabricObjectsForSlide(
      canvas,
      { ...activeSlide, templateId: newTplId },
      slides.length,
      newTplId
    );
    saveCanvasToActiveSlide(true);

    if (applyToAll) {
      setSlides((prev) =>
        prev.map((s, idx) =>
          idx === activeSlideIndex
            ? { ...s, templateId: newTplId }
            : { ...s, templateId: newTplId, fabricJson: undefined }
        )
      );
      showToast(`✨ '${tpl.name}' 디자인을 전체 카드에 적용했습니다!`);
    } else {
      showToast(`✨ 현재 카드에 '${tpl.name}' 디자인이 적용되었습니다!`);
    }
  }

  function handleChangeCanvasBgColor(hex: string) {
    setCanvasBgColor(hex);
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    canvas.backgroundColor = hex;
    canvas.requestRenderAll();
    saveCanvasToActiveSlide(true);
  }

  // 사진 / 캐릭터 파일 업로드 처리 (사용자별 폴더 분리 저장)
  async function handlePhotoFiles(
    fileList: FileList | null,
    mode: 'pool' | 'add-to-canvas' | 'replace-selected' | 'character' = 'pool'
  ) {
    if (!fileList || fileList.length === 0) return;

    const newItems: UploadedPhoto[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (!file.type.startsWith('image/')) {
        showToast('⚠️ 이미지 파일(.png, .jpg, .webp 등)만 올릴 수 있습니다.');
        continue;
      }

      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
      });

      let finalUrl = dataUrl;
      if (userId) {
        try {
          const supabase = getSupabaseBrowser();
          const ext = file.name.split('.').pop() || 'png';
          const folder = mode === 'character' ? 'characters' : 'raw';
          const path = `${userId}/${folder}-${Date.now()}-${i}.${ext}`;
          const { error } = await supabase.storage.from('user-uploads').upload(path, file, {
            upsert: true,
          });
          if (!error) {
            const { data } = supabase.storage.from('user-uploads').getPublicUrl(path);
            if (data.publicUrl) finalUrl = data.publicUrl;
          }
        } catch {
          // keep local dataUrl
        }
      }

      newItems.push({
        id: `${mode}-${Date.now()}-${i}`,
        url: finalUrl,
        name: file.name,
      });
    }

    if (newItems.length === 0) return;

    if (mode === 'character') {
      setCharacterAssets((prev) => [...prev, ...newItems]);
      for (const chItem of newItems) {
        await handleAddPhotoToCanvas(chItem.url, 'character');
      }
      return;
    }

    const merged = [...uploadedPhotos, ...newItems];
    setUploadedPhotos(merged);

    if (mode === 'replace-selected') {
      await handleReplaceSelectedPhoto(newItems[0].url);
    } else if (mode === 'add-to-canvas') {
      for (const p of newItems) {
        await handleAddPhotoToCanvas(p.url, 'photo');
      }
    } else {
      const canvas = fabricCanvasRef.current;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hasImgOnCanvas = canvas?.getObjects?.().some((o: any) => o.type === 'image');
      if (!hasImgOnCanvas && newItems[0]) {
        await handleAddPhotoToCanvas(newItems[0].url, 'photo');
      } else {
        showToast(`📸 이미지 ${newItems.length}장이 보관함에 추가되었습니다!`);
      }
    }
  }

  // ==========================================================================
  // 18) AI 초안 생성 (글씨 없는 배경 + 별도 글씨 객체 + 투자 권유 표현 자동 방지)
  // ==========================================================================
  async function handleGenerateWithAI() {
    if (!rawText.trim()) {
      showToast('⚠️ 짤/게시물에 들어갈 주제나 메모를 먼저 입력해 주세요.');
      return;
    }

    setIsGeneratingAI(true);
    try {
      const selectedAcc = accounts.find((a) => selectedAccountIds.includes(a.id));
      const defaultHashtags = selectedAcc?.default_hashtags || '';

      if (sessionToken) {
        const res = await fetch('/api/ai/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({
            rawText: `${rawText}\n(주의: '사라/팔아라/매수추천' 같은 투자 권유 문구는 절대 쓰지 말고, 초등학생도 이해할 수 있는 쉬운 말만 사용해 작성할 것)`,
            slideCount,
            publishMode,
            photoUrls: uploadedPhotos.map((p) => p.url),
            captionTone,
            defaultHashtags,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'AI 생성 실패');

        const aiSlides: SlideItem[] = (data.slides || []).map((s: SlideItem, idx: number) => ({
          ...s,
          id: `slide-ai-${Date.now()}-${idx}`,
          photoIndices: s.photoIndex !== null ? [s.photoIndex] : [],
          photoUrls: s.photoUrl
            ? [s.photoUrl]
            : uploadedPhotos[idx]
            ? [uploadedPhotos[idx].url]
            : [],
          templateId: autoApplyMyStyle && savedUserStyle ? savedUserStyle.templateId : templateId,
          fabricJson: undefined,
        }));

        historyMapRef.current = {};
        redoMapRef.current = {};
        setSlides(aiSlides);
        setBaseCaption(ensureMandatoryDisclaimer(data.caption || baseCaption));
        setActiveSlideIndex(0);
        showToast(
          autoApplyMyStyle && savedUserStyle
            ? '✨ AI 초안이 완성되었고 [내 스타일]이 자동 적용되었습니다!'
            : '✨ AI가 글씨 없는 배경과 짤 문구 객체를 분리해 초안을 만들었습니다!'
        );
      } else {
        buildDefaultSlides(slideCount, true);
        showToast('✨ 짤 초안이 생성되었습니다! (로그인하면 AI 맞춤 생성이 작동합니다)');
      }
    } catch (err) {
      showToast(`⚠️ ${err instanceof Error ? err.message : 'AI 생성 중 오류 발생'}`);
    } finally {
      setIsGeneratingAI(false);
    }
  }

  async function handleRegenerateSingleSlide(idx: number) {
    const targetSlide = slides[idx];
    if (!targetSlide) return;

    setRegeneratingSlideIdx(idx);
    try {
      if (sessionToken) {
        const res = await fetch('/api/ai/regenerate-slide', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({
            rawText,
            slide: targetSlide,
            totalSlides: slides.length,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        const canvas = fabricCanvasRef.current;
        if (canvas && idx === activeSlideIndex) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          canvas.getObjects().forEach((o: any) => {
            if (o.customRole === 'headline' && data.headline) o.set('text', data.headline);
            if (o.customRole === 'body' && data.body) o.set('text', data.body);
            if (o.customRole === 'badge-text' && data.badgeText) o.set('text', data.badgeText);
          });
          canvas.requestRenderAll();
          saveCanvasToActiveSlide(true);
        }
        showToast(`✅ ${idx + 1}번째 짤의 문구만 새로 바꿨습니다! (내 배치·배경 유지)`);
      } else {
        showToast('⚠️ AI 문구 다시 추천은 로그인 후 이용할 수 있습니다.');
      }
    } catch (err) {
      showToast(`⚠️ ${err instanceof Error ? err.message : '다시 추천 실패'}`);
    } finally {
      setRegeneratingSlideIdx(null);
    }
  }

  // ==========================================================================
  // 19) [Fabric.js 단일 통일 렌더링]
  //     document.fonts.ready 대기 후 가로 1080px, 8MB 이하 고화질 JPEG/PNG 생성
  // ==========================================================================
  const renderAllSlidesToDataUrls = useCallback(
    async (format: 'png' | 'jpeg' = 'jpeg'): Promise<{ urls: string[]; sizesKb: number[] }> => {
      if (!window.fabric) return { urls: [], sizesKb: [] };
      const fabric = window.fabric;

      // [필수 규칙]: 폰트가 모두 로드된 뒤에 그린다 (document.fonts.ready 확인)
      if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }

      const liveCanvas = fabricCanvasRef.current;
      const latestSlides = [...slides];
      if (liveCanvas && latestSlides[activeSlideIndex]) {
        liveCanvas.discardActiveObject();
        liveCanvas.requestRenderAll();
        const curJson = liveCanvas.toObject(CUSTOM_PROPS);
        curJson.background = liveCanvas.backgroundColor || '#0F172A';
        latestSlides[activeSlideIndex] = {
          ...latestSlides[activeSlideIndex],
          fabricJson: curJson,
        };
      }

      const tempCanvasEl = document.createElement('canvas');
      tempCanvasEl.width = targetDimensions.width; // 가로 1080px 고정
      tempCanvasEl.height = targetDimensions.height;
      const offCanvas = new fabric.Canvas(tempCanvasEl, {
        width: targetDimensions.width,
        height: targetDimensions.height,
        backgroundColor: '#0F172A',
      });

      const urls: string[] = [];
      const sizesKb: number[] = [];

      for (let i = 0; i < latestSlides.length; i++) {
        const s = latestSlides[i];
        if (s.fabricJson && s.fabricJson.objects) {
          const res = offCanvas.loadFromJSON(s.fabricJson, () => {
            if (s.fabricJson.background) {
              offCanvas.backgroundColor = s.fabricJson.background;
            }
            offCanvas.requestRenderAll();
          });
          if (res && typeof res.then === 'function') {
            await res;
            if (s.fabricJson.background) {
              offCanvas.backgroundColor = s.fabricJson.background;
            }
            offCanvas.requestRenderAll();
          }
        } else {
          await buildFabricObjectsForSlide(offCanvas, s, latestSlides.length);
        }

        // 8MB 이하 인스타 규격 보장 (0.92 품질 JPEG -> 만약 7.5MB 초과 시 품질 자동 조정)
        let quality = 0.92;
        let dataUrl = offCanvas.toDataURL({
          format,
          quality,
          multiplier: 1,
        });

        let byteSize = Math.round(((dataUrl.length - (dataUrl.indexOf(',') + 1)) * 3) / 4);
        while (format === 'jpeg' && byteSize > 7.5 * 1024 * 1024 && quality > 0.6) {
          quality -= 0.1;
          dataUrl = offCanvas.toDataURL({ format, quality, multiplier: 1 });
          byteSize = Math.round(((dataUrl.length - (dataUrl.indexOf(',') + 1)) * 3) / 4);
        }

        urls.push(dataUrl);
        sizesKb.push(Math.max(1, Math.round(byteSize / 1024)));
      }

      offCanvas.dispose();
      return { urls, sizesKb };
    },
    [
      slides,
      activeSlideIndex,
      targetDimensions.width,
      targetDimensions.height,
      buildFabricObjectsForSlide,
    ]
  );

  async function handleDownloadCurrentSlide(format: 'png' | 'jpeg') {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      await document.fonts.ready;
    }
    canvas.discardActiveObject();
    canvas.requestRenderAll();

    const dataUrl = canvas.toDataURL({
      format,
      quality: 0.94,
      multiplier: 1,
    });
    const ext = format === 'png' ? 'png' : 'jpg';
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `meme-slide-${activeSlideIndex + 1}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(`📥 현재 짤을 고화질 ${ext.toUpperCase()}로 저장했습니다!`);
  }

  async function handleDownloadAllAsZip(format: 'png' | 'jpeg') {
    if (!window.JSZip) {
      showToast('⚠️ 압축 도구를 불러오는 중입니다. 잠시 후 다시 눌러주세요.');
      return;
    }

    setIsExportingZip(true);
    try {
      const { urls } = await renderAllSlidesToDataUrls(format);
      const zip = new window.JSZip();
      const ext = format === 'png' ? 'png' : 'jpg';

      urls.forEach((dataUrl, idx) => {
        const base64Data = dataUrl.split(',')[1];
        zip.file(`meme_${String(idx + 1).padStart(2, '0')}.${ext}`, base64Data, { base64: true });
      });

      const blob = await zip.generateAsync({ type: 'blob' });
      const zipName = `memes_${slides.length}p_${format.toUpperCase()}.zip`;

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

      showToast(`📦 전체 ${urls.length}장 짤이 ${zipName}으로 다운로드되었습니다!`);
    } catch (err) {
      showToast(`⚠️ 다운로드 중 오류 발생: ${err instanceof Error ? err.message : ''}`);
    } finally {
      setIsExportingZip(false);
    }
  }

  // ==========================================================================
  // 20) 슬라이드 관리 & 투자 권유 금지어 실시간 검사
  // ==========================================================================
  function handleSlideCountChange(newCount: number) {
    const clamped = Math.max(1, Math.min(newCount, maxSlideLimit));
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
          headline: isCta ? '공감하셨다면 저장 & 공유!' : `핵심 내용 ${idx + 1}`,
          body: '캔버스에서 글자를 더블클릭하거나 드래그해서 자유롭게 수정하세요.',
          photoIndex: photoObj ? idx : null,
          photoUrl: photoObj ? photoObj.url : null,
          photoIndices: photoObj ? [idx] : [],
          photoUrls: photoObj ? [photoObj.url] : [],
          templateId,
        };
      });
      return updated;
    });

    if (activeSlideIndex >= clamped) {
      setActiveSlideIndex(Math.max(0, clamped - 1));
    }
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
    showToast('✅ 현재 짤이 똑같이 복제되었습니다!');
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
  }

  const currentEditingCaption =
    activeCaptionTab === 'base'
      ? baseCaption
      : accountCustomCaptions[activeCaptionTab] ?? baseCaption;
  const captionLength = currentEditingCaption.length;
  const hashtagCount = countHashtags(currentEditingCaption);
  const isCaptionOverLimit =
    captionLength > CAPTION_LIMITS.MAX_LENGTH || hashtagCount > CAPTION_LIMITS.MAX_HASHTAGS;

  // 모든 슬라이드 텍스트 + 캡션에서 투자 권유 금지어("사라/팔아라" 등) 검출
  const detectedBannedWords = useMemo(() => {
    const allTexts = [
      rawText,
      currentEditingCaption,
      selTextValue,
      ...slides.map((s) => `${s.badgeText || ''} ${s.headline || ''} ${s.body || ''}`),
    ].join(' ');
    return findBannedWords(allTexts);
  }, [rawText, currentEditingCaption, selTextValue, slides]);

  // ==========================================================================
  // 21) 업로드 직전 "이 내용으로 올릴까요?" 최종 JPEG 생성 및 확인 모달 열기
  // ==========================================================================
  async function handleOpenConfirmModalWithFinalJpeg() {
    if (!sessionToken) {
      showToast('⚠️ 인스타그램에 업로드하려면 먼저 상단에서 로그인해 주세요.');
      return;
    }
    if (selectedAccountIds.length === 0) {
      showToast('⚠️ 게시물을 올릴 인스타그램 계정을 선택해 주세요.');
      return;
    }
    if (scheduleType === 'scheduled' && !scheduledDateTime) {
      showToast('⚠️ 예약할 날짜와 시간을 선택해 주세요.');
      return;
    }

    // 캡션 마지막에 "투자 권유가 아닌 재미용 콘텐츠예요" 필수 문구 자동 보장
    setBaseCaption((prev) => ensureMandatoryDisclaimer(prev));

    setShowConfirmModal(true);
    setIsPreparingPreviewJpegs(true);
    try {
      const { urls, sizesKb } = await renderAllSlidesToDataUrls('jpeg');
      setFinalPreviewJpegs(urls);
      setFinalPreviewSizesKb(sizesKb);
    } catch {
      showToast('⚠️ 최종 JPEG 미리보기를 생성하는 중 오류가 발생했습니다.');
    } finally {
      setIsPreparingPreviewJpegs(false);
    }
  }

  // Cloudinary 설정이 있으면 Cloudinary로, 없으면 Supabase Storage 공개 URL로 업로드
  async function uploadFinalJpegAndGetUrl(dataUrl: string, slideIndex: number): Promise<string> {
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

    if (cloudName && uploadPreset) {
      try {
        const formData = new FormData();
        formData.append('file', dataUrl);
        formData.append('upload_preset', uploadPreset);
        const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (data.secure_url) return data.secure_url;
      } catch {
        // Cloudinary 실패 시 Supabase Storage로 안전 폴백
      }
    }

    if (userId) {
      try {
        const supabase = getSupabaseBrowser();
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const filePath = `${userId}/fabric-jpeg-${Date.now()}-${slideIndex + 1}.jpg`;
        const { error } = await supabase.storage
          .from('user-uploads')
          .upload(filePath, blob, { contentType: 'image/jpeg', upsert: true });
        if (!error) {
          const { data } = supabase.storage.from('user-uploads').getPublicUrl(filePath);
          if (data.publicUrl) return data.publicUrl;
        }
      } catch {
        // fallback to dataUrl
      }
    }
    return dataUrl;
  }

  async function handleExecutePublish() {
    setIsPublishing(true);
    try {
      const jpegDataUrls =
        finalPreviewJpegs.length === slides.length
          ? finalPreviewJpegs
          : (await renderAllSlidesToDataUrls('jpeg')).urls;

      const safeBaseCaption = ensureMandatoryDisclaimer(baseCaption);

      // 1) Fabric.js가 만든 고화질 JPEG를 업로드하여 공개 주소 확보
      const slidesForPublish = await Promise.all(
        slides.map(async (s, i) => {
          const publicUrl = await uploadFinalJpegAndGetUrl(jpegDataUrls[i], i);
          return {
            ...s,
            slideNumber: i + 1,
            layoutType: 'full-bleed' as const,
            photoUrls: [publicUrl],
            photoUrl: publicUrl,
            renderedUrl: publicUrl,
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

      // 2) memes 테이블에도 design_json 설계도와 최종 이미지 URL 저장 (테이블이 있을 때 자동 기록)
      if (userId) {
        try {
          await getSupabaseBrowser().from('memes').insert({
            user_id: userId,
            title: slides[0]?.headline || '오늘의 짤',
            caption: safeBaseCaption,
            design_json: {
              aspectRatio,
              slides: slides.map((s) => s.fabricJson || {}),
            },
            image_url: slidesForPublish[0]?.photoUrl || '',
            status: scheduleType === 'scheduled' ? 'scheduled' : 'published',
          });
        } catch {
          // ignore if memes table not yet created
        }
      }

      const selectedPayload = selectedAccountIds.map((id) => ({
        accountId: id,
        customCaption: ensureMandatoryDisclaimer(accountCustomCaptions[id] ?? safeBaseCaption),
      }));

      const res = await fetch('/api/posts/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          title: slides[0]?.headline || '오늘의 짤',
          rawText,
          publishMode,
          slideCount: slides.length,
          aspectRatio,
          fontId: 'Pretendard',
          moodId,
          accentColor,
          watermarkText: '',
          showWatermark: false,
          captionTone,
          baseCaption: safeBaseCaption,
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
          ? '⏰ 예약 업로드가 등록되었습니다! 내가 편집한 Fabric.js 이미지 그대로 올라갑니다.'
          : '🎉 인스타그램에 성공적으로 업로드되었습니다!'
      );
    } catch (err) {
      showToast(`⚠️ ${err instanceof Error ? err.message : '업로드 중 오류가 발생했습니다.'}`);
    } finally {
      setIsPublishing(false);
    }
  }

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthLoading(true);
    setAuthMessage('');
    const supabase = getSupabaseBrowser();

    try {
      if (authMode === 'signup') {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: emailInput, password: passwordInput }),
        });
        const resData = await res.json();
        if (!res.ok) throw new Error(resData.error || '회원가입 실패');
        const { error: loginErr } = await supabase.auth.signInWithPassword({
          email: emailInput,
          password: passwordInput,
        });
        if (loginErr) throw loginErr;
        showToast('🎉 회원가입과 로그인이 완료되었습니다!');
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: emailInput,
          password: passwordInput,
        });
        if (error) throw error;
        showToast('환영합니다! 로그인되었습니다.');
      }
    } catch (err) {
      setAuthMessage(`오류: ${err instanceof Error ? err.message : '로그인 오류'}`);
    } finally {
      setAuthLoading(false);
    }
  }

  function toggleSelectAccount(acc: InstagramAccount) {
    if (acc.status === 'expired' || acc.status === 'disconnected') {
      showToast('⚠️ 연결이 끊긴 계정입니다. [인스타 계정] 탭에서 다시 연결해 주세요.');
      return;
    }
    setSelectedAccountIds((prev) =>
      prev.includes(acc.id) ? prev.filter((id) => id !== acc.id) : [...prev, acc.id]
    );
    if (!accountCustomCaptions[acc.id]) {
      setAccountCustomCaptions((prev) => ({
        ...prev,
        [acc.id]: ensureMandatoryDisclaimer(
          `${baseCaption}\n${acc.default_hashtags || ''}`.trim()
        ),
      }));
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

  // ==========================================================================
  // UI 렌더링
  // ==========================================================================
  return (
    <div className="min-h-screen flex flex-col bg-slate-100 pb-20 lg:pb-6">
      {/* 상단 헤더 */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-[1440px] mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-pink-500 flex items-center justify-center text-white font-extrabold text-sm shadow">
              짤
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-extrabold text-slate-900 leading-tight">
                오늘 짤 만들기 · 인스타 자동 스튜디오
              </h1>
              <p className="text-[11px] text-slate-500 hidden sm:block">
                Fabric.js v6 단일 통합 에디터 · 내 스타일 저장 · 캐릭터 원본 추가 · 워터마크 없음
              </p>
            </div>
          </div>

          <nav className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('create')}
              className={`px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition ${
                activeTab === 'create'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🎨 오늘 짤 만들기
            </button>
            <button
              onClick={() => setActiveTab('accounts')}
              className={`px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition ${
                activeTab === 'accounts'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🔗 인스타 계정 ({accounts.length})
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition ${
                activeTab === 'history'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📋 업로드 기록
            </button>
          </nav>

          <div className="hidden lg:flex items-center gap-3">
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
              💾 {autoSaveStatus}
            </span>
            {sessionToken ? (
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <span className="font-semibold text-slate-800">{userEmail}</span>
                <button
                  onClick={() => getSupabaseBrowser().auth.signOut()}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold"
                >
                  로그아웃
                </button>
              </div>
            ) : (
              <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 font-bold">
                로그인 전
              </span>
            )}
          </div>
        </div>
      </header>

      {/* 토스트 알림 */}
      {toastMessage && (
        <div className="fixed bottom-20 lg:bottom-6 right-4 z-50 max-w-md bg-slate-900 text-white px-5 py-3.5 rounded-2xl shadow-2xl border border-slate-700 text-xs sm:text-sm font-bold flex items-center justify-between gap-4">
          <span>{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="text-slate-400 hover:text-white text-xs"
          >
            닫기
          </button>
        </div>
      )}

      <main className="max-w-[1440px] w-full mx-auto px-3 sm:px-6 py-5 flex-1 space-y-5">
        {/* 투자 권유 금지어 감지 시 실시간 경고 배너 */}
        {detectedBannedWords.length > 0 && (
          <div className="bg-rose-50 border-2 border-rose-400 rounded-2xl p-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs sm:text-sm font-extrabold text-rose-800">
                ⚠️ 투자 권유로 오해받을 수 있는 표현이 포함되어 있습니다: [
                {detectedBannedWords.join(', ')}]
              </p>
              <p className="text-xs text-rose-700 mt-0.5">
                안전한 계정 운영을 위해 직접적인 매수/매도 권유 표현(&ldquo;사라&rdquo;, &ldquo;팔아라&rdquo; 등)을 부드럽고 쉬운 일상 표현으로 고쳐주세요!
              </p>
            </div>
          </div>
        )}

        {/* 로그인 안내 */}
        {!sessionToken && (
          <section className="bg-white rounded-2xl border border-blue-200 p-4 sm:p-5 shadow-sm">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <span className="inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700">
                  🔒 내 사진·폰트·스타일은 내 계정에만 분리 저장되어 다른 사람은 절대 볼 수 없어요
                </span>
                <h2 className="text-base font-extrabold text-slate-900 mt-1">
                  AI 짤 초안 생성과 내 스타일 클라우드 동기화, 인스타 업로드를 위해 로그인해 주세요
                </h2>
              </div>

              <form
                onSubmit={handleAuthSubmit}
                className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
              >
                <input
                  type="email"
                  required
                  placeholder="이메일 주소"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-300 text-xs sm:text-sm"
                />
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="비밀번호 (6자 이상)"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-300 text-xs sm:text-sm"
                />
                <button
                  type="submit"
                  disabled={authLoading}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-bold"
                >
                  {authLoading ? '처리 중...' : authMode === 'login' ? '로그인' : '회원가입'}
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
                  className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
                >
                  {authMode === 'login' ? '회원가입 전환' : '로그인 전환'}
                </button>
              </form>
            </div>
            {authMessage && <p className="mt-2 text-xs font-bold text-rose-600">{authMessage}</p>}
          </section>
        )}

        {/* ================================================================= */}
        {/* [탭 1] 오늘 짤 만들기 (Fabric.js 단일 에디터)                        */}
        {/* ================================================================= */}
        {activeTab === 'create' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* ============================================================= */}
            {/* 왼쪽 패널 (5칸): AI 초안 · 캐릭터 원본 · 내 스타일 · 폰트 · 발행 */}
            {/* ============================================================= */}
            <div className="lg:col-span-5 space-y-5 order-2 lg:order-1">
              {/* 1. AI 초안 만들기 + 캐릭터 원본 보관함 + 배경 사진 보관함 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-extrabold text-slate-900">
                    1. 오늘 짤 주제 & 캐릭터 원본 / 배경 추가
                  </h2>
                  <span className="text-[11px] font-bold text-blue-600">
                    AI는 글씨 없는 배경과 문구를 분리 생성!
                  </span>
                </div>

                {/* 캐릭터 원본 추가 & 배경 사진 업로드 버튼 2열 배치 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <label className="flex flex-col items-center justify-center border-2 border-dashed border-amber-400 bg-amber-50/60 hover:bg-amber-50 rounded-2xl p-3.5 cursor-pointer transition text-center">
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => handlePhotoFiles(e.target.files, 'character')}
                      className="hidden"
                    />
                    <span className="text-xs sm:text-sm font-extrabold text-amber-900">
                      🐻 캐릭터 원본 추가
                    </span>
                    <span className="text-[10px] text-amber-700 mt-0.5">
                      내가 올린 캐릭터/스티커를 짤 위에 따로 얹기
                    </span>
                  </label>

                  <label
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      handlePhotoFiles(e.dataTransfer.files, 'pool');
                    }}
                    className={`flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-3.5 cursor-pointer transition text-center ${
                      isDragging
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-slate-300 hover:border-blue-400 bg-slate-50/70'
                    }`}
                  >
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => handlePhotoFiles(e.target.files, 'pool')}
                      className="hidden"
                    />
                    <span className="text-xs sm:text-sm font-extrabold text-slate-800">
                      🖼️ 배경 그림/사진 업로드
                    </span>
                    <span className="text-[10px] text-slate-500 mt-0.5">
                      여러 장 올려두고 클릭해서 배치/교체
                    </span>
                  </label>
                </div>

                {/* 내 캐릭터 원본 목록 */}
                {characterAssets.length > 0 && (
                  <div className="p-2.5 rounded-xl bg-amber-50/60 border border-amber-200 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-bold text-amber-900">
                      <span>🐻 내 캐릭터 원본 ({characterAssets.length}개) — 누르면 캔버스에 추가</span>
                      <button
                        type="button"
                        onClick={() => setCharacterAssets([])}
                        className="text-rose-600 hover:underline text-[10px]"
                      >
                        전체 비우기
                      </button>
                    </div>
                    <div className="flex items-center gap-2 overflow-x-auto pb-1">
                      {characterAssets.map((ch) => (
                        <div
                          key={ch.id}
                          className="relative w-14 h-14 rounded-xl overflow-hidden border border-amber-300 bg-white flex-shrink-0"
                        >
                          <img
                            src={ch.url}
                            alt={ch.name}
                            onClick={() => handleAddPhotoToCanvas(ch.url, 'character')}
                            className="w-full h-full object-contain cursor-pointer hover:scale-105 transition p-1"
                            title="클릭하면 캐릭터를 캔버스에 얹습니다"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setCharacterAssets((prev) => prev.filter((item) => item.id !== ch.id))
                            }
                            className="absolute top-0.5 right-0.5 bg-rose-600 text-white text-[9px] w-3.5 h-3.5 rounded-full flex items-center justify-center"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 업로드된 배경/사진 목록 */}
                {uploadedPhotos.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-600">
                      <span>🖼️ 배경/사진 보관함 ({uploadedPhotos.length}장) — 누르면 추가/교체</span>
                      <button
                        type="button"
                        onClick={() => setUploadedPhotos([])}
                        className="text-rose-600 hover:underline text-[10px]"
                      >
                        전체 비우기
                      </button>
                    </div>
                    <div className="flex items-center gap-2 overflow-x-auto pb-1">
                      {uploadedPhotos.map((p, idx) => (
                        <div
                          key={p.id}
                          className="relative w-14 h-14 rounded-xl overflow-hidden border border-slate-300 flex-shrink-0 bg-slate-100"
                        >
                          <img
                            src={p.url}
                            alt={p.name}
                            onClick={() => {
                              if (selectedObjType === 'image') {
                                handleReplaceSelectedPhoto(p.url);
                              } else {
                                handleAddPhotoToCanvas(p.url, 'photo');
                              }
                            }}
                            className="w-full h-full object-cover cursor-pointer hover:scale-105 transition"
                          />
                          <span className="absolute top-0.5 left-0.5 bg-black/70 text-white text-[9px] font-bold px-1 rounded pointer-events-none">
                            #{idx + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setUploadedPhotos((prev) => prev.filter((item) => item.id !== p.id))
                            }
                            className="absolute top-0.5 right-0.5 bg-rose-600 text-white text-[9px] w-3.5 h-3.5 rounded-full flex items-center justify-center"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 짤 주제 / 메모 입력 */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    오늘 만들 짤 내용 / 메모 (쉬운 말로 작성 · 투자 권유 표현 자동 차단)
                  </label>
                  <textarea
                    rows={3}
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    placeholder="예: 월급날 스쳐 지나가는 내 통장 잔고 이야기!"
                    className="w-full rounded-xl border border-slate-300 p-2.5 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-700">장수:</span>
                    <input
                      type="number"
                      min={1}
                      max={maxSlideLimit}
                      value={slideCount}
                      onChange={(e) => handleSlideCountChange(Number(e.target.value))}
                      className="w-16 px-2 py-1 rounded-lg border border-slate-300 text-xs font-extrabold text-center"
                    />
                  </div>

                  <div className="flex gap-1">
                    {(Object.keys(ASPECT_RATIOS) as AspectRatioKey[]).map((rk) => (
                      <button
                        key={rk}
                        type="button"
                        onClick={() => setAspectRatio(rk)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${
                          aspectRatio === rk
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-700 border-slate-300'
                        }`}
                      >
                        {rk} (1080px)
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleGenerateWithAI}
                  disabled={isGeneratingAI}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold text-xs sm:text-sm shadow-md disabled:opacity-50"
                >
                  {isGeneratingAI
                    ? '🤖 AI가 글씨 없는 배경과 짤 문구를 따로 만드는 중...'
                    : `✨ AI로 ${slideCount}장 짤 초안 만들기 (내 스타일 자동 반영)`}
                </button>
              </div>

              {/* 2. "내 스타일 저장" & 템플릿 선택 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-extrabold text-slate-900">
                      2. 내 스타일 저장 & 짤 레이아웃 템플릿
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      내가 고친 글씨 위치·폰트·크기·색·테두리를 저장하면 다음 짤에도 자동 적용됩니다.
                    </p>
                  </div>
                </div>

                {/* 내 스타일 저장/불러오기 박스 */}
                <div className="p-3.5 rounded-xl bg-amber-50/80 border border-amber-300 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-amber-950">
                      ⭐ 내 스타일 ({savedUserStyle ? `${savedUserStyle.fontFamily} · ${savedUserStyle.titleFontSize}px 저장됨` : '아직 저장 전'})
                    </span>
                    <label className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-900 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoApplyMyStyle}
                        onChange={(e) => setAutoApplyMyStyle(e.target.checked)}
                        className="accent-amber-600"
                      />
                      <span>새 짤 만들 때 내 스타일 자동 적용</span>
                    </label>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleSaveMyStyle}
                      className="flex-1 py-2 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-extrabold shadow-sm"
                    >
                      ⭐ 지금 글씨 위치·폰트·색상을 [내 스타일]로 저장
                    </button>
                    {savedUserStyle && (
                      <button
                        type="button"
                        onClick={handleApplySavedStyleToCurrentCanvas}
                        className="py-2 px-3 rounded-xl bg-white hover:bg-amber-100 text-amber-900 border border-amber-400 text-xs font-extrabold"
                      >
                        ✨ 이 카드에 내 스타일 입히기
                      </button>
                    )}
                  </div>
                </div>

                {/* 템플릿 8종 */}
                <div className="grid grid-cols-2 gap-2">
                  {CARD_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => handleApplyTemplate(tpl.id, false)}
                      className={`p-2.5 rounded-xl border text-left transition ${
                        templateId === tpl.id
                          ? 'border-blue-600 bg-blue-50/70 ring-2 ring-blue-500/20'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-3.5 h-3.5 rounded-full border border-slate-300 flex-shrink-0"
                          style={{ backgroundColor: tpl.bgColor }}
                        />
                        <span className="text-xs font-extrabold text-slate-900 truncate">
                          {tpl.name}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5 truncate">{tpl.desc}</p>
                    </button>
                  ))}
                </div>

                {/* 배경색 변경 */}
                <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  <span className="text-xs font-bold text-slate-700">🎨 단색 배경 색상</span>
                  <div className="flex items-center gap-1.5">
                    {['#0F172A', '#121214', '#FFFFFF', '#F8FAFC', '#F6F1E7', '#FFF5F7'].map(
                      (hex) => (
                        <button
                          key={hex}
                          type="button"
                          onClick={() => handleChangeCanvasBgColor(hex)}
                          className="w-5 h-5 rounded-full border border-slate-300"
                          style={{ backgroundColor: hex }}
                        />
                      )
                    )}
                    <input
                      type="color"
                      value={canvasBgColor.startsWith('#') ? canvasBgColor : '#0F172A'}
                      onChange={(e) => handleChangeCanvasBgColor(e.target.value)}
                      className="w-6 h-6 rounded cursor-pointer border border-slate-300"
                    />
                  </div>
                </div>
              </div>

              {/* 3. 폰트 (상업용 무료 한글 폰트 14종 + 내 폰트 업로드 & 라이선스 안내) */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-extrabold text-slate-900">
                      3. 폰트 선택 & 내 폰트 파일 업로드
                    </h2>
                    <p className="text-[11px] text-amber-700 font-bold mt-0.5">
                      ⚠️ 내 폰트 업로드 시 폰트 사용 허가(상업적 이용 가능 여부)를 직접 확인하세요. (최대 10MB)
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold cursor-pointer shadow-sm">
                    <span>➕ 내 폰트(.ttf/.otf/.woff/.woff2) 업로드</span>
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
                      📁 내가 올린 전용 폰트 (내 계정에만 분리 저장됨)
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
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-52 overflow-y-auto pr-1">
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

              {/* 4. 인스타 캡션 (마지막 면책 문구 자동 포함) & 업로드 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-extrabold text-slate-900">
                    4. 인스타 캡션 & 업로드
                  </h2>
                  <button
                    type="button"
                    onClick={() => setBaseCaption((prev) => ensureMandatoryDisclaimer(prev))}
                    className="text-[11px] font-bold text-blue-600 hover:underline"
                  >
                    + 필수 안내문구 자동 넣기
                  </button>
                </div>

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
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-xs sm:text-sm"
                />

                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
                  <span>
                    글자 수: {captionLength.toLocaleString()} / {CAPTION_LIMITS.MAX_LENGTH}자
                  </span>
                  <span className="text-emerald-700 font-bold">
                    ✓ 마지막 문구: &ldquo;{MANDATORY_DISCLAIMER}&rdquo; 자동 포함
                  </span>
                </div>

                <div className="space-y-2.5 pt-2 border-t border-slate-100">
                  <span className="text-xs font-bold text-slate-700 block">
                    올릴 인스타그램 계정 선택
                  </span>
                  {accounts.length === 0 ? (
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center justify-between">
                      <span>연결된 인스타 계정이 없습니다.</span>
                      <button
                        type="button"
                        onClick={() => setActiveTab('accounts')}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 text-white font-bold"
                      >
                        계정 연결하기 →
                      </button>
                    </div>
                  ) : (
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
                  )}

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
                    onClick={handleOpenConfirmModalWithFinalJpeg}
                    className="w-full py-3.5 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 text-white font-extrabold text-xs sm:text-sm shadow-md"
                  >
                    🔍 최종 JPEG 확인하고 인스타그램에 올리기
                  </button>
                </div>
              </div>
            </div>

            {/* ============================================================= */}
            {/* 오른쪽 패널 (7칸): Fabric.js 캔버스 + 글씨 테두리/그림자/크롭 툴바 */}
            {/* ============================================================= */}
            <div className="lg:col-span-7 lg:sticky lg:top-20 space-y-4 order-1 lg:order-2">
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
                {/* 상단: 실행취소/다시실행 · AI 배경 다시 만들기 · JPEG/PNG 다운로드 */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={handleUndo}
                      disabled={!canUndo}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-extrabold disabled:opacity-40"
                    >
                      ↩️ 실행취소
                    </button>
                    <button
                      type="button"
                      onClick={handleRedo}
                      disabled={!canRedo}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-extrabold disabled:opacity-40"
                    >
                      ↪️ 다시실행
                    </button>
                    <button
                      type="button"
                      onClick={handleRegenerateAiBackgroundOnly}
                      className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-extrabold shadow-sm"
                    >
                      🎨 AI 배경 다시 만들기 (내 글씨·배치 유지)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRegenerateSingleSlide(activeSlideIndex)}
                      disabled={regeneratingSlideIdx === activeSlideIndex}
                      className="px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-extrabold"
                    >
                      {regeneratingSlideIdx === activeSlideIndex ? '생성중...' : '🔄 AI 문구만 교체'}
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleDownloadCurrentSlide('jpeg')}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold"
                    >
                      📥 이 짤 JPEG 저장
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadCurrentSlide('png')}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold"
                    >
                      PNG 저장
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadAllAsZip('jpeg')}
                      disabled={isExportingZip}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold shadow-sm"
                    >
                      {isExportingZip ? '압축 중...' : `📦 전체 ${slides.length}장 JPG ZIP`}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        saveCanvasToActiveSlide(false);
                        setShowJsonModal(true);
                      }}
                      className="px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-bold"
                      title="design_json 설계도 확인"
                    >
                      {`{ } JSON`}
                    </button>
                  </div>
                </div>

                {/* 슬라이드 선택 탭 */}
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
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={duplicateActiveSlide}
                      className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold"
                    >
                      + 복제
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

                {/* 요소 추가 바 (글씨, 캐릭터 원본, 사진/스티커, 도형) */}
                <div className="flex flex-wrap items-center gap-1.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[11px] font-extrabold text-slate-600 mr-1">➕ 요소 추가:</span>
                  <button
                    type="button"
                    onClick={() => handleAddTextObject('headline')}
                    className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-blue-50 border border-slate-300 text-xs font-extrabold text-slate-800"
                  >
                    T 짤 글씨 추가
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddTextObject('body')}
                    className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-blue-50 border border-slate-300 text-xs font-bold text-slate-800"
                  >
                    t 보조 대사
                  </button>

                  <label className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-extrabold cursor-pointer">
                    🐻 캐릭터 원본 추가
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => handlePhotoFiles(e.target.files, 'character')}
                      className="hidden"
                    />
                  </label>

                  <label className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold cursor-pointer">
                    🖼️ 사진/스티커 추가
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => handlePhotoFiles(e.target.files, 'add-to-canvas')}
                      className="hidden"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => handleAddShape('rect')}
                    className="px-2 py-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-xs font-bold text-slate-700"
                  >
                    ⬛ 사각형
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddShape('circle')}
                    className="px-2 py-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-xs font-bold text-slate-700"
                  >
                    ⚪ 원
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddShape('line')}
                    className="px-2 py-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-xs font-bold text-slate-700"
                  >
                    ➖ 선
                  </button>
                </div>

                {/* ========================================================= */}
                {/* 선택된 객체별 맞춤 편집 툴바 (글씨 테두리/그림자 · 사진 크롭) */}
                {/* ========================================================= */}
                {selectedObjType !== 'none' ? (
                  <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-200 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-blue-200/70">
                      <span className="text-xs font-extrabold text-blue-900">
                        {selectedObjType === 'text'
                          ? '✏️ 짤 글씨 편집 (테두리·그림자·폰트·자간·행간)'
                          : selectedObjType === 'image'
                          ? '🖼️ 배경/캐릭터 편집 (교체·크롭·회전·투명도·순서)'
                          : '🔷 도형 편집'}
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

                    {/* 1) 글씨 선택 시: 내용 + 원클릭 짤 글씨 테두리 프리셋 + 테두리 두께/색 + 그림자 */}
                    {selectedObjType === 'text' && (
                      <div className="space-y-2.5 text-xs">
                        <textarea
                          rows={2}
                          value={selTextValue}
                          onChange={(e) => {
                            setSelTextValue(e.target.value);
                            updateSelectedTextProp('text', e.target.value);
                          }}
                          placeholder="짤 문구를 입력하세요"
                          className="w-full px-3 py-1.5 rounded-lg border border-blue-300 bg-white text-xs sm:text-sm font-bold"
                        />

                        {/* 짤 글씨 테두리 원클릭 프리셋 */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-extrabold text-slate-700">
                            🔥 짤 글씨 빠른 효과:
                          </span>
                          <button
                            type="button"
                            onClick={() => applyMemeTextPreset('white-black')}
                            className="px-2.5 py-1 rounded-lg bg-slate-900 text-white font-extrabold text-[11px]"
                          >
                            흰 글씨 + 검은 테두리
                          </button>
                          <button
                            type="button"
                            onClick={() => applyMemeTextPreset('yellow-black')}
                            className="px-2.5 py-1 rounded-lg bg-slate-900 text-yellow-300 font-extrabold text-[11px]"
                          >
                            노란 글씨 + 검은 테두리
                          </button>
                          <button
                            type="button"
                            onClick={() => applyMemeTextPreset('black-white')}
                            className="px-2.5 py-1 rounded-lg bg-white border border-slate-400 text-slate-900 font-extrabold text-[11px]"
                          >
                            검은 글씨 + 흰 테두리
                          </button>
                          <button
                            type="button"
                            onClick={() => applyMemeTextPreset('clean')}
                            className="px-2.5 py-1 rounded-lg bg-slate-200 text-slate-700 font-bold text-[11px]"
                          >
                            테두리 끄기
                          </button>
                        </div>

                        {/* 글씨 테두리(외곽선) 색상·두께 & 그림자 조절 */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2.5 rounded-lg bg-white/90 border border-blue-200">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                              글자색 / 테두리색
                            </label>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={selTextColor.startsWith('#') ? selTextColor : '#FFFFFF'}
                                onChange={(e) => {
                                  setSelTextColor(e.target.value);
                                  updateSelectedTextProp('fill', e.target.value);
                                }}
                                className="w-8 h-7 rounded cursor-pointer border border-slate-300"
                                title="글자 색상"
                              />
                              <input
                                type="color"
                                value={
                                  selTextStrokeColor.startsWith('#')
                                    ? selTextStrokeColor
                                    : '#000000'
                                }
                                onChange={(e) => {
                                  setSelTextStrokeColor(e.target.value);
                                  updateSelectedTextProp('stroke', e.target.value);
                                }}
                                className="w-8 h-7 rounded cursor-pointer border border-slate-300"
                                title="글자 테두리(외곽선) 색상"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold text-slate-600">
                              테두리 두께 ({selTextStrokeWidth}px)
                            </label>
                            <input
                              type="range"
                              min={0}
                              max={18}
                              value={selTextStrokeWidth}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                setSelTextStrokeWidth(v);
                                updateSelectedTextProp('strokeWidth', v);
                                if (v > 0 && !selTextStrokeColor) {
                                  updateSelectedTextProp('stroke', '#000000');
                                }
                              }}
                              className="w-full accent-blue-600"
                            />
                          </div>

                          <div>
                            <label className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selTextShadowOn}
                                onChange={(e) =>
                                  handleUpdateTextShadow(e.target.checked, selTextShadowBlur)
                                }
                                className="accent-blue-600"
                              />
                              <span>글씨 그림자 ({selTextShadowBlur}px)</span>
                            </label>
                            <input
                              type="range"
                              min={0}
                              max={30}
                              value={selTextShadowBlur}
                              onChange={(e) =>
                                handleUpdateTextShadow(true, Number(e.target.value))
                              }
                              className="w-full accent-blue-600"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold text-slate-600">
                              글자 크기 ({selFontSize}px)
                            </label>
                            <input
                              type="range"
                              min={18}
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
                        </div>

                        {/* 폰트, 굵기, 정렬, 자간, 행간 */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600">폰트</label>
                            <select
                              value={selFontFamily}
                              onChange={(e) => applyFontToSelectionOrAll(e.target.value)}
                              className="w-full px-2 py-1 rounded border border-slate-300 bg-white text-xs font-bold"
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
                            <label className="block text-[10px] font-bold text-slate-600">
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
                              max={2.3}
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
                        </div>
                      </div>
                    )}

                    {/* 2) 사진/캐릭터 선택 시 */}
                    {selectedObjType === 'image' && (
                      <div className="space-y-2.5 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-extrabold cursor-pointer">
                            🔄 다른 이미지로 교체
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handlePhotoFiles(e.target.files, 'replace-selected')}
                              className="hidden"
                            />
                          </label>

                          {!isCropping ? (
                            <button
                              type="button"
                              onClick={handleStartCropMode}
                              className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-extrabold"
                            >
                              ✂️ 자르기 (크롭)
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

                          <button
                            type="button"
                            onClick={() => {
                              const canvas = fabricCanvasRef.current;
                              const active = canvas?.getActiveObject?.();
                              if (!active) return;
                              const nextAngle = ((active.angle || 0) + 90) % 360;
                              active.rotate(nextAngle);
                              setSelAngle(nextAngle);
                              canvas.requestRenderAll();
                              saveCanvasToActiveSlide(true);
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 font-bold text-slate-800"
                          >
                            🔄 90° 회전
                          </button>
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
                              onChange={(e) =>
                                handlePhotoCornerRadiusChange(Number(e.target.value))
                              }
                              className="w-full accent-blue-600"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600">
                              불투명도 ({selOpacity}%)
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
                              회전 ({selAngle}°)
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

                    {/* 3) 도형 선택 시 */}
                    {selectedObjType === 'shape' && (
                      <div className="space-y-2 text-xs">
                        {isCropping && (
                          <div className="flex items-center justify-between bg-amber-100 border border-amber-300 px-3 py-2 rounded-lg">
                            <span className="font-extrabold text-amber-900">
                              ✂️ 파란색 크롭 박스를 조절한 뒤 오른쪽 버튼을 눌러주세요!
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
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                              도형 색상
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
                            <label className="block text-[10px] font-bold text-slate-600">
                              모서리 둥글기 ({selCornerRadius}px)
                            </label>
                            <input
                              type="range"
                              min={0}
                              max={120}
                              value={selCornerRadius}
                              onChange={(e) =>
                                handlePhotoCornerRadiusChange(Number(e.target.value))
                              }
                              className="w-full accent-blue-600"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600">
                              불투명도 ({selOpacity}%)
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
                      💡 <strong>캔버스 위의 글씨·배경·캐릭터를 클릭</strong>하면 이동, 크기 조절, 회전, 테두리/그림자, 크롭 편집창이 열립니다!
                    </span>
                  </div>
                )}

                {/* ========================================================= */}
                {/* 메인 Fabric.js 캔버스 뷰포트                                */}
                {/* ========================================================= */}
                <div
                  ref={wrapperRef}
                  className="w-full flex flex-col items-center justify-center bg-slate-200/70 rounded-2xl p-2 sm:p-4 overflow-hidden select-none"
                >
                  {!libsReady && (
                    <div className="py-24 text-center text-sm font-bold text-slate-600">
                      🎨 Fabric.js v6 캔버스 에디터를 불러오는 중입니다...
                    </div>
                  )}

                  <div
                    className="relative shadow-2xl border border-slate-300 bg-white overflow-hidden"
                    style={{
                      width: `${Math.round(targetDimensions.width * canvasScale)}px`,
                      height: `${Math.round(targetDimensions.height * canvasScale)}px`,
                    }}
                  >
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

                    {snapGuideX !== null && (
                      <div
                        className="pointer-events-none absolute top-0 bottom-0 border-l-2 border-dashed border-pink-500 z-20"
                        style={{ left: `${Math.round(snapGuideX * canvasScale)}px` }}
                      />
                    )}
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
        )}

        {/* ================================================================= */}
        {/* [탭 2] 인스타그램 계정 연결 탭                                      */}
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
              <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center">
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
                              {acc.username.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <h3 className="font-bold text-slate-900 text-base">@{acc.username}</h3>
                            <p className="text-xs text-slate-500">{acc.name}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setEditingAccountId(isEditing ? null : acc.id)}
                            className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                          >
                            {isEditing ? '닫기' : '⚙️ 기본 해시태그'}
                          </button>
                          <button
                            onClick={async () => {
                              if (!confirm(`@${acc.username} 계정 연결을 해제할까요?`)) return;
                              await fetch(`/api/accounts?id=${acc.id}`, {
                                method: 'DELETE',
                                headers: { Authorization: `Bearer ${sessionToken}` },
                              });
                              fetchAccounts();
                              showToast('계정 연결이 해제되었습니다.');
                            }}
                            className="text-xs px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 font-semibold"
                          >
                            연결 해제
                          </button>
                        </div>
                      </div>

                      {isEditing && (
                        <div className="pt-3 border-t border-slate-100 space-y-2">
                          <label className="block text-xs text-slate-500">기본 해시태그 묶음</label>
                          <input
                            type="text"
                            value={acc.default_hashtags}
                            onChange={(e) =>
                              setAccounts((prev) =>
                                prev.map((a) =>
                                  a.id === acc.id ? { ...a, default_hashtags: e.target.value } : a
                                )
                              )
                            }
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                          />
                          <button
                            onClick={async () => {
                              await fetch('/api/accounts', {
                                method: 'PATCH',
                                headers: {
                                  'Content-Type': 'application/json',
                                  Authorization: `Bearer ${sessionToken}`,
                                },
                                body: JSON.stringify({
                                  accountId: acc.id,
                                  default_font: acc.default_font,
                                  default_mood: acc.default_mood,
                                  default_accent_color: acc.default_accent_color,
                                  default_hashtags: acc.default_hashtags,
                                }),
                              });
                              setEditingAccountId(null);
                              showToast(`✅ @${acc.username} 설정이 저장되었습니다!`);
                            }}
                            className="w-full py-2 rounded-lg bg-blue-600 text-white text-xs font-bold"
                          >
                            저장하기
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ================================================================= */}
        {/* [탭 3] 업로드 기록 탭                                               */}
        {/* ================================================================= */}
        {activeTab === 'history' && (
          <section className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex items-center justify-between">
              <h2 className="text-xl font-extrabold text-slate-900">내 게시물 업로드 · 예약 기록</h2>
              <button
                onClick={fetchPostHistory}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700"
              >
                🔄 새로고침
              </button>
            </div>

            {postHistory.length === 0 ? (
              <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center">
                <p className="text-base font-bold text-slate-700">
                  아직 업로드하거나 예약한 게시물이 없습니다.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {postHistory.map((post) => (
                  <div
                    key={post.id}
                    className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4"
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <div>
                        <span className="text-xs font-bold text-blue-600">
                          총 {post.slide_count}장 ({post.aspect_ratio})
                        </span>
                        <h3 className="text-base font-extrabold text-slate-900">{post.title}</h3>
                      </div>
                      <span className="text-xs text-slate-400">
                        {new Date(post.created_at).toLocaleString('ko-KR')}
                      </span>
                    </div>

                    {Array.isArray(post.rendered_image_urls) &&
                      post.rendered_image_urls.length > 0 && (
                        <div className="flex gap-2 overflow-x-auto pb-2">
                          {post.rendered_image_urls.map((url, idx) => (
                            <img
                              key={idx}
                              src={url}
                              alt={`slide-${idx}`}
                              className="w-24 h-30 object-cover rounded-lg border border-slate-200 flex-shrink-0"
                            />
                          ))}
                        </div>
                      )}

                    <div className="space-y-2">
                      {(post.post_targets || []).map((t) => (
                        <div
                          key={t.id}
                          className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2 text-xs"
                        >
                          <div>
                            <span className="font-bold text-slate-900">
                              @{t.instagram_accounts?.username || '계정'}
                            </span>
                            <span className="ml-2 text-slate-600">{t.status}</span>
                            {t.error_message && (
                              <p className="text-rose-600 font-semibold mt-0.5">
                                {t.error_message}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {t.ig_permalink && (
                              <a
                                href={t.ig_permalink}
                                target="_blank"
                                rel="noreferrer"
                                className="px-2.5 py-1 rounded bg-blue-50 text-blue-700 font-bold"
                              >
                                인스타에서 보기 ↗
                              </a>
                            )}
                            {t.status === 'failed' && (
                              <button
                                onClick={() => handleRetryPublish(t.id)}
                                disabled={retryingTargetId === t.id}
                                className="px-3 py-1 rounded bg-rose-600 text-white font-bold"
                              >
                                다시 올리기
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {/* =================================================================== */}
      {/* 모바일 전용 하단 고정 빠른 편집 도구바                                */}
      {/* =================================================================== */}
      {activeTab === 'create' && (
        <div className="fixed bottom-0 left-0 right-0 z-30 lg:hidden bg-white border-t border-slate-200 px-3 py-2 flex items-center justify-around shadow-lg">
          <button
            type="button"
            onClick={handleUndo}
            disabled={!canUndo}
            className="flex flex-col items-center text-[11px] font-bold text-slate-700 disabled:opacity-30"
          >
            <span>↩️</span>
            <span>실행취소</span>
          </button>
          <button
            type="button"
            onClick={() => handleAddTextObject('headline')}
            className="flex flex-col items-center text-[11px] font-bold text-slate-700"
          >
            <span>✏️</span>
            <span>글씨추가</span>
          </button>
          <button
            type="button"
            onClick={handleRegenerateAiBackgroundOnly}
            className="flex flex-col items-center text-[11px] font-bold text-purple-700"
          >
            <span>🎨</span>
            <span>AI배경교체</span>
          </button>
          <button
            type="button"
            onClick={handleSaveMyStyle}
            className="flex flex-col items-center text-[11px] font-bold text-amber-700"
          >
            <span>⭐</span>
            <span>내스타일저장</span>
          </button>
          <button
            type="button"
            onClick={() => handleDownloadCurrentSlide('jpeg')}
            className="flex flex-col items-center text-[11px] font-bold text-blue-600"
          >
            <span>📥</span>
            <span>JPEG저장</span>
          </button>
        </div>
      )}

      {/* =================================================================== */}
      {/* [필수 확인 단계] 업로드 직전 "이 내용으로 올릴까요?" 최종 JPEG 확인 모달 */}
      {/* =================================================================== */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-lg font-extrabold text-slate-900">
                  🔍 이 내용으로 인스타그램에 올릴까요?
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  폰트 로딩 완료(`document.fonts.ready`) 후 Fabric.js가 생성한 최종 JPEG(가로 1080px, 8MB 이하)입니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="text-slate-400 hover:text-slate-700 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* 투자 권유 금지어 경고 */}
            {detectedBannedWords.length > 0 && (
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-xs text-rose-800 space-y-1">
                <p className="font-extrabold">
                  ⚠️ 주의: 투자 권유로 보일 수 있는 표현({detectedBannedWords.join(', ')})이 감지되었습니다!
                </p>
                <p>취소를 눌러 쉬운 일상 표현으로 수정한 뒤 올리는 것을 권장합니다.</p>
              </div>
            )}

            {/* 최종 JPEG 이미지 미리보기 목록 */}
            {isPreparingPreviewJpegs ? (
              <div className="py-16 text-center text-sm font-bold text-slate-600">
                ⏳ 폰트를 확인하고 최종 고화질 JPEG(1080px)를 만들고 있습니다...
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-80 overflow-y-auto p-2 bg-slate-100 rounded-xl">
                {finalPreviewJpegs.map((jpegUrl, idx) => (
                  <div
                    key={idx}
                    className="bg-white rounded-xl p-1.5 border border-slate-200 shadow-sm space-y-1"
                  >
                    <img
                      src={jpegUrl}
                      alt={`final-jpeg-${idx + 1}`}
                      className="w-full rounded-lg object-contain"
                    />
                    <div className="flex items-center justify-between text-[10px] font-bold text-slate-600 px-1">
                      <span>#{idx + 1}장 (1080px JPEG)</span>
                      <span className="text-emerald-700">
                        {finalPreviewSizesKb[idx] || 180}KB (8MB 이하 ✓)
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 최종 캡션 확인 */}
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <span className="text-[11px] font-extrabold text-slate-700 block">
                📝 함께 올라갈 인스타 캡션 (마지막 필수 문구 자동 포함)
              </span>
              <p className="text-xs text-slate-700 whitespace-pre-line max-h-28 overflow-y-auto">
                {ensureMandatoryDisclaimer(baseCaption)}
              </p>
            </div>

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                disabled={isPublishing}
                className="flex-1 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs sm:text-sm font-bold"
              >
                다시 고치기 (취소)
              </button>
              <button
                type="button"
                onClick={handleExecutePublish}
                disabled={isPublishing || isPreparingPreviewJpegs}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 text-white text-xs sm:text-sm font-extrabold shadow-md disabled:opacity-50"
              >
                {isPublishing
                  ? '인스타그램에 업로드 중...'
                  : scheduleType === 'scheduled'
                  ? '📅 네, 이 JPEG로 예약 등록할게요!'
                  : '🚀 네, 이 JPEG로 지금 바로 올릴게요!'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* design_json 설계도 확인 모달 */}
      {showJsonModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-900">
                📋 현재 짤의 JSON 설계도 (`design_json`)
              </h3>
              <button
                type="button"
                onClick={() => setShowJsonModal(false)}
                className="text-xs font-bold text-slate-500"
              >
                닫기 ✕
              </button>
            </div>
            <pre className="text-[11px] bg-slate-900 text-emerald-300 p-3 rounded-xl max-h-80 overflow-auto">
              {JSON.stringify(activeSlide?.fabricJson || {}, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
