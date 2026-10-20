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
  MOOD_PRESETS,
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
// [전역 타입 선언] CDN으로 로드되는 Fabric.js(v6), JSZip, FileSaver, localForage
// 별도의 npm 패키지 설치 없이 이 파일 하나만 올려도 100% 동작하도록 구성
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
// [1단계~4단계 통합 설정] 기본 한글 폰트 14종 (Google Fonts + 눈누 웹폰트)
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
// [2단계 & 4단계] 언제든 바꿔 낄 수 있는 카드뉴스 디자인 템플릿 8종
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
    desc: '사진이 전체 배경으로 깔리고 글씨가 올라가는 표지형',
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fabricJson?: any; // 이 슬라이드의 Fabric.js 객체 상태 JSON (자동저장 및 슬라이드 전환용)
  previewDataUrl?: string; // 썸네일 및 서버 전송용 이미지
}

// ============================================================================
// [IndexedDB / localForage 저장소 도우미]
// localForage가 로드되면 우선 사용하고, 로드 전에도 브라우저 기본 IndexedDB로 동작
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

// 외부 스크립트 로드 도우미
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

// 이미지 엘리먼트 로드 도우미 (CORS 안전 처리)
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
  // 2) 카드뉴스 생성 & 에디터 전역 상태
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

  // [워터마크 제거]: 기본값 false ("AUTO CARD STUDIO" 절대 넣지 않음!)
  const [showWatermark, setShowWatermark] = useState<boolean>(false);
  const [watermarkText, setWatermarkText] = useState<string>('');

  // 업로드 사진 & AI 원문 메모
  const [uploadedPhotos, setUploadedPhotos] = useState<UploadedPhoto[]>([]);
  const [rawText, setRawText] = useState<string>(
    '이번 주말에 다녀온 성수동 브런치 카페 후기!\n분위기도 너무 따뜻하고 시그니처 라떼가 정말 고소했어요.\n창가 자리는 오후 2시쯤 햇살이 가장 예쁘게 들어오니까 방문하실 분들은 꼭 참고하세요!'
  );
  const [isDragging, setIsDragging] = useState(false);

  // 슬라이드 목록 & 현재 슬라이드 인덱스
  const [slides, setSlides] = useState<SlideItem[]>([]);
  const [activeSlideIndex, setActiveSlideIndex] = useState<number>(0);
  const [isGeneratingAI, setIsGeneratingAI] = useState<boolean>(false);
  const [regeneratingSlideIdx, setRegeneratingSlideIdx] = useState<number | null>(null);
  const [isExportingZip, setIsExportingZip] = useState<boolean>(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<string>('자동 저장 준비됨');

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

  // 실행 취소(Undo) / 다시 실행(Redo) 스택 (슬라이드별 보관)
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
  const [selCharSpacing, setSelCharSpacing] = useState<number>(0); // 자간 (-100 ~ 500)
  const [selLineHeight, setSelLineHeight] = useState<number>(1.3); // 행간 (0.8 ~ 2.5)

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

    // 1. Google Fonts + Pretendard 스타일시트 주입
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

    // 2. 외부 스크립트 순차 로드 (Fabric v6, JSZip, FileSaver, localForage)
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

      // 3. 저장된 슬라이드(Fabric JSON 포함) 복원
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
      }>('acs_editor_state_v1');

      if (savedState && Array.isArray(savedState.slides) && savedState.slides.length > 0 && !cancelled) {
        setSlides(savedState.slides);
        setSlideCount(savedState.slides.length);
        if (savedState.aspectRatio) setAspectRatio(savedState.aspectRatio);
        if (savedState.fontId) setFontId(savedState.fontId);
        if (savedState.templateId) setTemplateId(savedState.templateId);
        if (savedState.accentColor) setAccentColor(savedState.accentColor);
        setShowWatermark(Boolean(savedState.showWatermark));
        setWatermarkText(savedState.watermarkText || '');
        if (savedState.rawText) setRawText(savedState.rawText);
        if (savedState.baseCaption) setBaseCaption(savedState.baseCaption);
        setAutoSaveStatus('이전 작업 자동 복원됨');
      } else if (!cancelled) {
        buildDefaultSlides(4);
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
      await saveToLocalDb('acs_editor_state_v1', {
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
    }, 600);
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
  // 6) 모바일 / PC 화면 크기에 맞춰 캔버스 표시 배율(scale) 자동 계산
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
  // 8) 기본 슬라이드 초안 데이터 생성기
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
        badgeText: isSingle ? 'CORE' : isCover ? 'COVER' : isCta ? 'SUMMARY' : `POINT 0${idx}`,
        headline: isSingle
          ? '오늘 꼭 기억해야 할 핵심 한 줄'
          : isCover
          ? '시선을 사로잡는 첫 장 표지 제목'
          : isCta
          ? '도움이 되셨다면 저장하고 팔로우하세요!'
          : `알기 쉽게 정리한 핵심 포인트 ${idx}`,
        body: isSingle
          ? '캔버스 위 글자와 사진을 마우스로 직접 드래그하고 더블클릭해 수정해 보세요!'
          : isCover
          ? '오른쪽으로 넘겨서 자세한 내용을 확인해 보세요 👉'
          : isCta
          ? '프로필 링크에서 더 많은 정보를 확인하실 수 있습니다.'
          : '사진을 여러 장 추가하거나 크롭, 회전, 글씨 폰트·자간·행간을 자유롭게 조절하세요.',
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
  // 9) Fabric.js 캔버스 초기화 및 이벤트 바인딩 (스냅 가이드선, 선택 동기화, 자동 저장)
  // ==========================================================================
  // 현재 캔버스 상태를 슬라이드 배열 및 Undo 히스토리에 기록
  const saveCanvasToActiveSlide = useCallback(
    (pushHistory = true) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas || isRestoringRef.current) return;

      const slide = slides[activeSlideIndex];
      if (!slide) return;

      // 크롭 가이드 박스가 떠 있는 중에는 저장 생략
      if (cropRectRef.current) return;

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

      // 텍스트 객체들의 최신 문자열을 slide.headline / slide.body 에도 동기화 (AI 재추천 등 호환)
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
                customBgColor: String(canvas.backgroundColor || '#FFFFFF'),
              }
            : s
        )
      );
    },
    [activeSlideIndex, slides]
  );

  // 선택된 Fabric 객체의 속성을 우측/상단 툴바 상태에 반영
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
    // 선택 컨트롤 핸들 디자인 개선 (모바일/PC에서도 잘 보이게)
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

    // [4단계 기능] 객체를 드래그할 때 캔버스 중앙 및 다른 객체에 자석처럼 붙는 스냅 가이드선
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

      // 1) 캔버스 가로 정중앙 스냅
      if (Math.abs(center.x - cw / 2) < SNAP_DIST) {
        const diffX = cw / 2 - center.x;
        obj.set('left', obj.left + diffX);
        snappedX = cw / 2;
      }

      // 2) 캔버스 세로 정중앙 스냅
      if (Math.abs(center.y - ch / 2) < SNAP_DIST) {
        const diffY = ch / 2 - center.y;
        obj.set('top', obj.top + diffY);
        snappedY = ch / 2;
      }

      // 3) 좌우 여백 가이드(72px) 스냅
      if (snappedX === null && Math.abs(obj.left - 72) < SNAP_DIST) {
        obj.set('left', 72);
        snappedX = 72;
      }

      // 4) 다른 객체들과의 중심선 정렬 스냅
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
  // 10) [핵심 1단계~4단계] 슬라이드 데이터를 독립된 Fabric 객체들로 캔버스에 생성/배치
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

      targetCanvas.clear();
      targetCanvas.backgroundColor = bgHex;
      setCanvasBgColor(bgHex);

      // 슬라이드에 포함된 사진 URL 목록
      const photoUrls: string[] =
        Array.isArray(slide.photoUrls) && slide.photoUrls.length > 0
          ? slide.photoUrls.filter(Boolean)
          : slide.photoUrl
          ? [slide.photoUrl]
          : [];

      // 사진 객체 생성 헬퍼 (모서리 둥글기 및 비율 맞춤 포함)
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
          const scale = Math.max(boxW / natW, boxH / natH);

          // 중앙 크롭 효과를 위해 이미지를 박스 크기에 맞게 cropX/cropY/width/height 설정
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
            customRole: 'photo',
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
          console.warn('사진 객체 생성 실패:', e);
        }
      };

      // 다중 사진(1~N장)을 지정된 영역 안에 그리드로 자동 배치
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

      // ======================================================================
      // 템플릿별 레이아웃 객체(사진, 배경 카드 도형, 텍스트) 배치
      // ======================================================================
      if (tplId === 'full-bleed-poster') {
        // 1) 전체 배경 사진 + 반투명 어두운 오버레이 사각형
        if (photoUrls.length > 0) {
          await placePhotosInBox(0, 0, cw, ch, 0);
          const overlayRect = new fabric.Rect({
            left: 0,
            top: 0,
            width: cw,
            height: ch,
            fill: '#0F172A',
            opacity: 0.52,
            selectable: true,
            customId: `overlay-${Date.now()}`,
            customRole: 'shape-card',
          });
          targetCanvas.add(overlayRect);
        }
      } else if (tplId === 'top-photo-card' || tplId === 'polaroid-frame' || tplId === 'dark-neon-card') {
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
        // 하단 텍스트 배경 카드 도형
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
          await placePhotosInBox(0, 0, cw, ch, 0);
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

      // ======================================================================
      // 상단 뱃지 도형 + 뱃지 글씨 + 슬라이드 번호 (각각 독립된 객체)
      // ======================================================================
      if (slide.badgeText) {
        const badgeW = Math.max(140, slide.badgeText.length * 24 + 48);
        const badgeBg = new fabric.Rect({
          left: pad,
          top: 56,
          width: badgeW,
          height: 52,
          fill: effectiveAccent,
          rx: 14,
          ry: 14,
          customId: `badge-bg-${Date.now()}`,
          customRole: 'badge-bg',
        });
        const badgeTxt = new fabric.Textbox(slide.badgeText, {
          left: pad + 12,
          top: 67,
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
          top: 66,
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

      // ======================================================================
      // 제목(headline) & 본문(body) 텍스트 객체 배치
      // ======================================================================
      let textLeft = pad + 32;
      let textWidth = innerW - 64;
      let headlineTop = Math.round(ch * 0.63);
      let align: 'left' | 'center' | 'right' = 'left';

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

      const headlineTextbox = new fabric.Textbox(slide.headline || '제목을 입력하세요', {
        left: textLeft,
        top: headlineTop,
        width: textWidth,
        fontSize: tplId === 'full-bleed-poster' ? 64 : 52,
        fontFamily: fontId,
        fontWeight: 'bold',
        fill: titleColor,
        textAlign: align,
        lineHeight: 1.28,
        charSpacing: 0,
        customId: `headline-${Date.now()}`,
        customRole: 'headline',
      });
      targetCanvas.add(headlineTextbox);

      const headlineHeight = headlineTextbox.calcTextHeight
        ? headlineTextbox.calcTextHeight()
        : 130;

      const bodyTextbox = new fabric.Textbox(slide.body || '본문 내용을 입력하세요', {
        left: textLeft,
        top: headlineTop + headlineHeight + 28,
        width: textWidth,
        fontSize: 30,
        fontFamily: fontId,
        fontWeight: 'normal',
        fill: bodyColor,
        textAlign: align,
        lineHeight: 1.5,
        charSpacing: 0,
        customId: `body-${Date.now()}`,
        customRole: 'body',
      });
      targetCanvas.add(bodyTextbox);

      // [6. 워터마크 설정]: 기본값은 꺼짐(false)이며, 켰을 때만 내가 적은 문구 표시
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
  // 11) 슬라이드 전환 시 해당 슬라이드의 Fabric JSON 로드 또는 초기 객체 생성
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
  }, [libsReady, activeSlide?.id, activeSlideIndex]);

  // ==========================================================================
  // 12) 실행 취소 (Undo: Ctrl+Z) / 다시 실행 (Redo: Ctrl+Y)
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

  // 키보드 단축키: Ctrl+Z / Ctrl+Y / Delete(선택 객체 삭제)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const canvas = fabricCanvasRef.current;
      const activeObj = canvas?.getActiveObject?.();
      // 캔버스 위에서 텍스트 더블클릭 타이핑 중일 때는 기본 키 동작 유지
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
  // 13) [기능 1: 폰트 추가 & 텍스트 세부 편집]
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

      // 현재 선택된 텍스트 또는 전체 기본 폰트로 즉시 반영
      applyFontToSelectionOrAll(customFontId);
      showToast(`✅ '${cleanName}' 폰트가 등록되어 localForage에 영구 저장되었습니다!`);
    } catch {
      showToast('⚠️ 폰트 파일을 읽는 중 오류가 발생했습니다. (.ttf, .otf, .woff, .woff2 지원)');
    }
  }

  async function handleDeleteCustomFont(id: string) {
    const nextList = customFonts.filter((f) => f.id !== id);
    setCustomFonts(nextList);
    await saveToLocalDb('acs_custom_fonts_v1', nextList);
    showToast('내 폰트가 목록에서 삭제되었습니다.');
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
      // 아무것도 선택 안 되어 있으면 현재 카드의 모든 글씨 폰트 변경
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

  // 선택된 텍스트 속성 변경 헬퍼
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function updateSelectedTextProp(prop: string, value: any) {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;

    active.set(prop, value);
    if (prop === 'text') {
      active.initDimensions?.();
    }
    canvas.requestRenderAll();
    saveCanvasToActiveSlide(true);
  }

  // 새 텍스트 박스 추가
  function handleAddTextObject(preset: 'headline' | 'body' | 'badge') {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !window.fabric) return;
    const fabric = window.fabric;

    const isTitle = preset === 'headline';
    const isBadge = preset === 'badge';

    const textbox = new fabric.Textbox(
      isTitle ? '새 제목을 입력하세요' : isBadge ? 'NEW POINT' : '새 텍스트 내용을 더블클릭해 수정하세요',
      {
        left: Math.round((canvas.width || 1080) / 2 - 320),
        top: Math.round((canvas.height || 1350) / 2 - 60),
        width: isBadge ? 240 : 640,
        fontSize: isTitle ? 56 : isBadge ? 28 : 32,
        fontFamily: fontId,
        fontWeight: isTitle || isBadge ? 'bold' : 'normal',
        fill: isBadge ? '#FFFFFF' : '#0F172A',
        textBackgroundColor: isBadge ? accentColor : '',
        textAlign: isBadge ? 'center' : 'left',
        lineHeight: 1.35,
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
    showToast('✏️ 새 글자 박스가 추가되었습니다! 드래그하거나 더블클릭해 수정하세요.');
  }

  // ==========================================================================
  // 14) [기능 2: 템플릿 변경 · 배경색 · 배경 이미지 · 도형(사각형/원/선) 추가]
  // ==========================================================================
  async function handleApplyTemplate(newTplId: CardTemplateId, applyToAll = false) {
    setTemplateId(newTplId);
    const tpl = CARD_TEMPLATES.find((t) => t.id === newTplId) || CARD_TEMPLATES[0];
    setAccentColor(tpl.accentColor);

    const canvas = fabricCanvasRef.current;
    if (!canvas || !activeSlide) return;

    await buildFabricObjectsForSlide(canvas, { ...activeSlide, templateId: newTplId }, slides.length, newTplId);
    saveCanvasToActiveSlide(true);

    if (applyToAll) {
      setSlides((prev) =>
        prev.map((s, idx) =>
          idx === activeSlideIndex
            ? { ...s, templateId: newTplId }
            : { ...s, templateId: newTplId, fabricJson: undefined }
        )
      );
      showToast(`✨ '${tpl.name}' 템플릿을 전체 카드에 적용했습니다!`);
    } else {
      showToast(`✨ 현재 카드에 '${tpl.name}' 템플릿이 적용되었습니다!`);
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

  async function handleSetBackgroundImageFromFile(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });
    await setCanvasBackgroundPhotoUrl(dataUrl);
  }

  async function setCanvasBackgroundPhotoUrl(url: string) {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !window.fabric) return;
    const fabric = window.fabric;
    const ImageClass = fabric.FabricImage || fabric.Image;

    try {
      // 기존 배경 전용 이미지가 있으면 제거
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const oldBg = canvas.getObjects().find((o: any) => o.customRole === 'bg-photo');
      if (oldBg) canvas.remove(oldBg);

      const imgEl = await loadHtmlImageElement(url);
      const cw = canvas.width || 1080;
      const ch = canvas.height || 1350;
      const scale = Math.max(cw / imgEl.naturalWidth, ch / imgEl.naturalHeight);

      const bgImg = new ImageClass(imgEl, {
        left: 0,
        top: 0,
        scaleX: scale,
        scaleY: scale,
        customId: `bg-photo-${Date.now()}`,
        customRole: 'bg-photo',
        originalSrc: url,
      });

      canvas.add(bgImg);
      if (typeof canvas.sendObjectToBack === 'function') {
        canvas.sendObjectToBack(bgImg);
      } else if (typeof canvas.sendToBack === 'function') {
        canvas.sendToBack(bgImg);
      }
      canvas.requestRenderAll();
      saveCanvasToActiveSlide(true);
      showToast('🖼️ 배경 이미지가 적용되었습니다!');
    } catch {
      showToast('⚠️ 배경 이미지를 불러오지 못했습니다.');
    }
  }

  // 도형 추가 (사각형, 원, 구분선)
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
        left: cx - 200,
        top: cy - 120,
        width: 400,
        height: 240,
        fill: accentColor,
        rx: 24,
        ry: 24,
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
      shapeObj = new fabric.Line([cx - 250, cy, cx + 250, cy], {
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

  // ==========================================================================
  // 15) [기능 3: 사진 자유 편집 — 여러 장 추가, 클릭 교체, 회전, 모서리 둥글기, 투명도, 크롭]
  // ==========================================================================
  // 현재 캔버스에 사진 객체 1장 추가 (한 카드에 여러 장 무제한 추가 가능)
  async function handleAddPhotoToCanvas(url: string) {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !window.fabric) return;
    const fabric = window.fabric;
    const ImageClass = fabric.FabricImage || fabric.Image;

    try {
      const imgEl = await loadHtmlImageElement(url);
      const targetW = 540;
      const scale = targetW / (imgEl.naturalWidth || 800);
      const offset = (canvas.getObjects().filter((o: { type: string }) => o.type === 'image').length % 5) * 36;

      const fImg = new ImageClass(imgEl, {
        left: 180 + offset,
        top: 220 + offset,
        scaleX: scale,
        scaleY: scale,
        cornerRadius: 20,
        customId: `photo-${Date.now()}`,
        customRole: 'photo',
        originalSrc: url,
      });

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

      canvas.add(fImg);
      canvas.setActiveObject(fImg);
      canvas.requestRenderAll();
      syncSelectionState(fImg);
      saveCanvasToActiveSlide(true);
      showToast('📸 카드에 사진이 추가되었습니다! 자유롭게 이동·크기 조절·회전해 보세요.');
    } catch {
      showToast('⚠️ 사진을 캔버스에 추가하는 중 오류가 발생했습니다.');
    }
  }

  // 현재 선택된 사진을 새 이미지 URL로 즉시 교체 (위치·크기·각도·둥글기 그대로 유지!)
  async function handleReplaceSelectedPhoto(newUrl: string) {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !window.fabric) return;
    const active = canvas.getActiveObject();
    if (!active || active.type !== 'image') {
      // 선택된 사진이 없으면 새로 추가
      await handleAddPhotoToCanvas(newUrl);
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
      showToast('🔄 선택한 사진이 교체되었습니다!');
    } catch {
      showToast('⚠️ 사진 교체 중 오류가 발생했습니다.');
    }
  }

  // 사진 모서리 둥글기 변경
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

  // 사진 크롭(자르기) 모드 시작
  function handleStartCropMode() {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !window.fabric) return;
    const active = canvas.getActiveObject();
    if (!active || active.type !== 'image') {
      showToast('⚠️ 먼저 자를 사진을 캔버스에서 클릭해 주세요!');
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
    showToast('✂️ 파란색 점선 박스를 원하는 영역으로 조절한 뒤 [자르기 완료]를 누르세요!');
  }

  // 크롭 적용
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
    showToast('✅ 선택한 영역으로 사진이 깔끔하게 잘렸습니다!');
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

  // 레이어 겹침 순서 변경 (앞으로 / 뒤로)
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

  // 선택 객체 삭제
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

  // ==========================================================================
  // 16) 파일 업로드 (사진 여러 장 보관함 등록 + 현재 카드 바로 배치 옵션)
  // ==========================================================================
  async function handlePhotoFiles(
    fileList: FileList | null,
    mode: 'pool' | 'add-to-canvas' | 'replace-selected' = 'pool'
  ) {
    if (!fileList || fileList.length === 0) return;

    const newPhotos: UploadedPhoto[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (!file.type.startsWith('image/')) continue;

      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
      });

      let finalUrl = dataUrl;
      if (userId) {
        try {
          const supabase = getSupabaseBrowser();
          const ext = file.name.split('.').pop() || 'jpg';
          const path = `${userId}/raw-${Date.now()}-${i}.${ext}`;
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

      newPhotos.push({
        id: `photo-${Date.now()}-${i}`,
        url: finalUrl,
        name: file.name,
      });
    }

    if (newPhotos.length === 0) return;
    const merged = [...uploadedPhotos, ...newPhotos];
    setUploadedPhotos(merged);

    if (mode === 'replace-selected') {
      await handleReplaceSelectedPhoto(newPhotos[0].url);
    } else if (mode === 'add-to-canvas') {
      for (const p of newPhotos) {
        await handleAddPhotoToCanvas(p.url);
      }
    } else {
      // 현재 카드에 사진이 하나도 없으면 첫 사진을 자동으로 넣어줌
      const canvas = fabricCanvasRef.current;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hasImgOnCanvas = canvas?.getObjects?.().some((o: any) => o.type === 'image');
      if (!hasImgOnCanvas && newPhotos[0]) {
        await handleAddPhotoToCanvas(newPhotos[0].url);
      } else {
        showToast(`📸 사진 ${newPhotos.length}장이 보관함에 추가되었습니다! 클릭하면 캔버스에 들어갑니다.`);
      }
    }
  }

  // ==========================================================================
  // 17) AI 카드뉴스 초안 자동 생성 (결과를 분리된 Fabric 객체들로 배치!)
  // ==========================================================================
  async function handleGenerateWithAI() {
    if (!rawText.trim()) {
      showToast('⚠️ 게시물에 들어갈 내용이나 간단한 메모를 먼저 입력해 주세요.');
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
            rawText,
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
          photoUrls: s.photoUrl ? [s.photoUrl] : uploadedPhotos[idx] ? [uploadedPhotos[idx].url] : [],
          templateId,
          fabricJson: undefined, // 캔버스에서 새 Fabric 객체들로 렌더링되도록 초기화
        }));

        historyMapRef.current = {};
        redoMapRef.current = {};
        setSlides(aiSlides);
        setBaseCaption(data.caption || baseCaption);
        setActiveSlideIndex(0);
        showToast('✨ AI가 카드뉴스 초안을 완성했습니다! 캔버스에서 글씨와 사진을 자유롭게 수정해 보세요!');
      } else {
        buildDefaultSlides(slideCount, true);
        showToast('✨ 카드뉴스 초안이 생성되었습니다! (로그인 시 Gemini AI 맞춤 문구가 생성됩니다)');
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
          // 캔버스 위의 제목/본문/뱃지 객체 텍스트만 깔끔하게 교체 (사용자 배치 유지!)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          canvas.getObjects().forEach((o: any) => {
            if (o.customRole === 'headline' && data.headline) o.set('text', data.headline);
            if (o.customRole === 'body' && data.body) o.set('text', data.body);
            if (o.customRole === 'badge-text' && data.badgeText) o.set('text', data.badgeText);
          });
          canvas.requestRenderAll();
          saveCanvasToActiveSlide(true);
        }
        showToast(`✅ ${idx + 1}번째 장의 AI 문구를 새로 바꿨습니다!`);
      } else {
        showToast('⚠️ AI 문구 추천을 사용하려면 먼저 로그인해 주세요.');
      }
    } catch (err) {
      showToast(`⚠️ ${err instanceof Error ? err.message : '다시 만들기 실패'}`);
    } finally {
      setRegeneratingSlideIdx(null);
    }
  }

  // ==========================================================================
  // 18) [기능 5: 전체 카드를 PNG / JPG로 렌더링하여 ZIP으로 한 번에 다운로드]
  // ==========================================================================
  // 모든 슬라이드를 순회하며 1080x1350(또는 1080x1080) 고해상도 DataURL 배열로 추출
  const renderAllSlidesToDataUrls = useCallback(
    async (format: 'png' | 'jpeg' = 'png'): Promise<string[]> => {
      if (!window.fabric) return [];
      const fabric = window.fabric;

      // 현재 편집 중인 슬라이드 상태 먼저 최신화
      const liveCanvas = fabricCanvasRef.current;
      let latestSlides = [...slides];
      if (liveCanvas && latestSlides[activeSlideIndex]) {
        liveCanvas.discardActiveObject();
        liveCanvas.requestRenderAll();
        const curJson = liveCanvas.toObject(CUSTOM_PROPS);
        curJson.background = liveCanvas.backgroundColor || '#FFFFFF';
        latestSlides[activeSlideIndex] = {
          ...latestSlides[activeSlideIndex],
          fabricJson: curJson,
        };
      }

      // 오프스크린 임시 캔버스 생성
      const tempCanvasEl = document.createElement('canvas');
      tempCanvasEl.width = targetDimensions.width;
      tempCanvasEl.height = targetDimensions.height;
      const offCanvas = new fabric.Canvas(tempCanvasEl, {
        width: targetDimensions.width,
        height: targetDimensions.height,
        backgroundColor: '#FFFFFF',
      });

      const dataUrls: string[] = [];
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

        const url = offCanvas.toDataURL({
          format,
          quality: 0.96,
          multiplier: 1,
        });
        dataUrls.push(url);
      }

      offCanvas.dispose();
      return dataUrls;
    },
    [slides, activeSlideIndex, targetDimensions.width, targetDimensions.height, buildFabricObjectsForSlide]
  );

  // 현재 보고 있는 카드 1장 즉시 다운로드
  function handleDownloadCurrentSlide(format: 'png' | 'jpeg') {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    canvas.discardActiveObject();
    canvas.requestRenderAll();

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

  // 전체 카드를 JSZip + FileSaver.js로 한 번에 ZIP 다운로드
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
  // 19) 슬라이드 개수/순서/복제/삭제 관리
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
          headline: isCta ? '저장해 두고 필요할 때 꺼내보세요!' : `핵심 내용 ${idx + 1}`,
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
    showToast('✅ 현재 카드가 똑같이 복제되었습니다!');
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

  // ==========================================================================
  // 20) 인스타그램 즉시 업로드 & 예약 업로드 (캔버스 편집본 100% 그대로 반영!)
  // ==========================================================================
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
        showToast('🎉 회원가입과 로그인이 한 번에 완료되었습니다!');
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
      // 1) 내가 Fabric.js 캔버스에서 직접 편집한 모든 슬라이드를 고해상도 JPEG로 렌더링
      const jpegDataUrls = await renderAllSlidesToDataUrls('jpeg');
      const supabase = getSupabaseBrowser();

      // 2) 각 슬라이드 JPEG를 Supabase Storage에 업로드하여 서버 렌더러가 1:1 그대로 사용하도록 전달
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

          // 서버 렌더러가 내가 캔버스에서 만든 이미지를 100% 원본 그대로 출력하도록 full-bleed 무보정 전달
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
                AI 초안 자동 생성 + Fabric.js 자유 캔버스 편집 (폰트·크롭·레이어·자동저장·ZIP 다운로드)
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
              🎨 캔버스 에디터
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
        <div className="fixed bottom-5 right-5 z-50 max-w-md bg-slate-900 text-white px-5 py-3.5 rounded-2xl shadow-2xl border border-slate-700 text-xs sm:text-sm font-bold flex items-center justify-between gap-4">
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
        {/* 로그인 배너 */}
        {!sessionToken && (
          <section className="bg-white rounded-2xl border border-blue-200 p-4 sm:p-5 shadow-sm">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <span className="inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700">
                  💡 로그인 없이도 캔버스 편집·폰트 추가·ZIP 다운로드를 모두 쓸 수 있어요!
                </span>
                <h2 className="text-base font-extrabold text-slate-900 mt-1">
                  AI 문구 생성 및 인스타그램 자동 업로드를 쓰려면 로그인해 주세요
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
        {/* [탭 1] 캔버스 에디터 (AI 초안 + Fabric.js 자유 편집 스튜디오)       */}
        {/* ================================================================= */}
        {activeTab === 'create' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* ============================================================= */}
            {/* 왼쪽 패널 (5칸): AI 초안 생성 · 사진 보관함 · 템플릿 · 폰트 · 발행 */}
            {/* ============================================================= */}
            <div className="lg:col-span-5 space-y-5 order-2 lg:order-1">
              {/* 1. AI 초안 자동 생성 & 사진 보관함 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-extrabold text-slate-900">
                    1. 사진 보관함 & AI 카드뉴스 초안 만들기
                  </h2>
                  <span className="text-[11px] font-bold text-blue-600">
                    클릭하면 캔버스에 사진 추가!
                  </span>
                </div>

                {/* 사진 드래그 앤 드롭 업로드 */}
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
                  className={`flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-4 cursor-pointer transition ${
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
                  <p className="text-xs sm:text-sm font-extrabold text-slate-800">
                    📸 여기에 사진 여러 장을 끌어다 놓거나 눌러서 업로드
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    업로드된 사진을 아래에서 누르면 현재 카드에 여러 장 겹쳐 넣거나 교체할 수 있어요!
                  </p>
                </label>

                {/* 업로드된 사진 보관함 목록 */}
                {uploadedPhotos.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-600">
                      <span>보관함 사진 ({uploadedPhotos.length}장) — 누르면 캔버스에 추가/교체</span>
                      <button
                        type="button"
                        onClick={() => setUploadedPhotos([])}
                        className="text-rose-600 hover:underline"
                      >
                        전체 비우기
                      </button>
                    </div>
                    <div className="flex items-center gap-2 overflow-x-auto pb-1.5">
                      {uploadedPhotos.map((p, idx) => (
                        <div
                          key={p.id}
                          className="relative group w-16 h-16 rounded-xl overflow-hidden border border-slate-300 flex-shrink-0 bg-slate-100"
                        >
                          <img
                            src={p.url}
                            alt={p.name}
                            onClick={() => {
                              if (selectedObjType === 'image') {
                                handleReplaceSelectedPhoto(p.url);
                              } else {
                                handleAddPhotoToCanvas(p.url);
                              }
                            }}
                            className="w-full h-full object-cover cursor-pointer hover:scale-105 transition"
                            title="클릭하면 캔버스에 추가 (사진 선택 중일 땐 교체)"
                          />
                          <span className="absolute top-0.5 left-0.5 bg-black/70 text-white text-[9px] font-bold px-1 rounded pointer-events-none">
                            #{idx + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setUploadedPhotos((prev) => prev.filter((item) => item.id !== p.id))
                            }
                            className="absolute top-0.5 right-0.5 bg-rose-600 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* AI 초안 메모 입력 */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    카드뉴스 주제 / 메모 (AI가 장수별로 제목·본문·뱃지를 나눠 초안을 잡아줍니다)
                  </label>
                  <textarea
                    rows={3}
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    placeholder="예: 만년필 입문자를 위한 3가지 관리 꿀팁 정리해줘"
                    className="w-full rounded-xl border border-slate-300 p-2.5 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* 장수 및 비율 선택 */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-700">카드 장수:</span>
                    <input
                      type="number"
                      min={1}
                      max={maxSlideLimit}
                      value={slideCount}
                      onChange={(e) => handleSlideCountChange(Number(e.target.value))}
                      className="w-16 px-2 py-1 rounded-lg border border-slate-300 text-xs font-extrabold text-center"
                    />
                    <span className="text-[11px] text-slate-500">(최대 {maxSlideLimit}장)</span>
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
                        {rk} 비율
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleGenerateWithAI}
                    disabled={isGeneratingAI}
                    className="flex-1 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold text-xs sm:text-sm shadow-md disabled:opacity-50"
                  >
                    {isGeneratingAI
                      ? '🤖 AI가 초안 만드는 중...'
                      : `✨ AI로 ${slideCount}장 초안 자동 생성 (캔버스에 객체로 배치)`}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm('현재 편집 중인 내용을 초기 기본 초안으로 리셋할까요?')) {
                        buildDefaultSlides(slideCount, true);
                      }
                    }}
                    className="px-3 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs"
                  >
                    🔄 초기화
                  </button>
                </div>
              </div>

              {/* 2. 템플릿 언제든 변경 & 배경 설정 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-extrabold text-slate-900">
                    2. 카드 디자인 템플릿 & 배경 설정
                  </h2>
                  <button
                    type="button"
                    onClick={() => handleApplyTemplate(templateId, true)}
                    className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-[11px] font-bold hover:bg-slate-800"
                  >
                    ✨ 선택 템플릿 전체 카드에 적용
                  </button>
                </div>

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

                {/* 배경색 / 배경 이미지 / 포인트 컬러 */}
                <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                    <span className="text-xs font-bold text-slate-700">🎨 카드 배경색</span>
                    <div className="flex items-center gap-1.5">
                      {['#FFFFFF', '#F8FAFC', '#F6F1E7', '#FFF5F7', '#0F172A', '#121214'].map(
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
                        value={canvasBgColor.startsWith('#') ? canvasBgColor : '#FFFFFF'}
                        onChange={(e) => handleChangeCanvasBgColor(e.target.value)}
                        className="w-6 h-6 rounded cursor-pointer border border-slate-300"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                    <span className="text-xs font-bold text-slate-700">🖼️ 배경 이미지</span>
                    <div className="flex items-center gap-1.5">
                      <label className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold cursor-pointer">
                        업로드
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleSetBackgroundImageFromFile(e.target.files)}
                          className="hidden"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const canvas = fabricCanvasRef.current;
                          if (!canvas) return;
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          const bgObj = canvas.getObjects().find((o: any) => o.customRole === 'bg-photo');
                          if (bgObj) {
                            canvas.remove(bgObj);
                            canvas.requestRenderAll();
                            saveCanvasToActiveSlide(true);
                          }
                        }}
                        className="px-2 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-[11px] font-bold"
                      >
                        제거
                      </button>
                    </div>
                  </div>
                </div>

                {/* 워터마크 켜기/끄기 (기본값: 꺼짐, AUTO CARD STUDIO 완전 제거) */}
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">
                      🏷️ 워터마크 켜기/끄기 (기본값: 끄기 · AUTO CARD STUDIO 제거됨)
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

              {/* 3. 폰트 관리 (기본 폰트 14종 + 내 폰트 업로드 & localForage 저장) */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-extrabold text-slate-900">
                      3. 폰트 선택 & 내 폰트 파일 업로드
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      업로드한 폰트는 브라우저(localForage)에 자동 저장되어 다시 열어도 유지됩니다.
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

                {/* 내가 업로드한 커스텀 폰트 목록 */}
                {customFonts.length > 0 && (
                  <div className="p-3 rounded-xl bg-indigo-50/80 border border-indigo-200 space-y-2">
                    <span className="text-xs font-extrabold text-indigo-950 block">
                      📁 내가 업로드한 폰트 (새로고침해도 유지됨)
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

                {/* 기본 제공 한글 폰트 14종 그리드 */}
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

              {/* 4. 인스타그램 캡션 & 바로 업로드 / 예약 업로드 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-extrabold text-slate-900">
                    4. 인스타 캡션 & 자동 업로드
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

                {accounts.length > 0 && (
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
                          showToast('⚠️ 먼저 로그인해 주세요.');
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
                      🚀 캔버스 편집본 그대로 인스타그램에 올리기
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* ============================================================= */}
            {/* 오른쪽 패널 (7칸): Fabric.js 캔버스 + 객체별 전용 편집 툴바     */}
            {/* ============================================================= */}
            <div className="lg:col-span-7 lg:sticky lg:top-20 space-y-4 order-1 lg:order-2">
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
                {/* 상단: 슬라이드 이동 탭 & 실행취소/다시실행 & ZIP 다운로드 바 */}
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
                      {regeneratingSlideIdx === activeSlideIndex ? '생성중...' : '🔄 AI 문구교체'}
                    </button>
                  </div>

                  {/* ZIP 일괄 다운로드 및 단건 저장 버튼 */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleDownloadCurrentSlide('png')}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold"
                    >
                      📥 이 장 PNG
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

                {/* 슬라이드 선택 탭 + 복제/삭제 */}
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
                      + 카드 복제
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

                {/* ========================================================= */}
                {/* 요소 추가 빠른 버튼 바 (글씨 추가 / 사진 여러 장 추가 / 도형 추가) */}
                {/* ========================================================= */}
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
                    🖼️ 이 카드에 사진 추가 (여러 장 가능)
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

                {/* ========================================================= */}
                {/* 선택된 객체별 맞춤 컨트롤 바 (글씨 / 사진 / 도형 / 레이어)   */}
                {/* ========================================================= */}
                {selectedObjType !== 'none' ? (
                  <div className="p-3 rounded-xl bg-blue-50/60 border border-blue-200 space-y-3">
                    {/* 공통 상단: 객체 종류 표시 + 레이어 순서(앞으로/뒤로) + 투명도 + 삭제 */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-blue-200/70">
                      <span className="text-xs font-extrabold text-blue-900">
                        {selectedObjType === 'text'
                          ? '✏️ 글자 박스 선택됨 (더블클릭하면 캔버스에서 직접 타이핑)'
                          : selectedObjType === 'image'
                          ? '🖼️ 사진 객체 선택됨 (드래그 이동 · 모서리 크기조절 · 회전 · 자르기)'
                          : '🔷 도형 객체 선택됨'}
                      </span>

                      <div className="flex items-center gap-1 flex-wrap">
                        <button
                          type="button"
                          onClick={() => handleLayerOrder('front')}
                          className="px-2 py-1 rounded bg-white border border-slate-300 text-[11px] font-bold hover:bg-slate-100"
                          title="맨 앞으로 가져오기"
                        >
                          ⬆️ 맨앞
                        </button>
                        <button
                          type="button"
                          onClick={() => handleLayerOrder('forward')}
                          className="px-2 py-1 rounded bg-white border border-slate-300 text-[11px] font-bold hover:bg-slate-100"
                          title="한 단계 앞으로"
                        >
                          🔼 앞으로
                        </button>
                        <button
                          type="button"
                          onClick={() => handleLayerOrder('backward')}
                          className="px-2 py-1 rounded bg-white border border-slate-300 text-[11px] font-bold hover:bg-slate-100"
                          title="한 단계 뒤로"
                        >
                          🔽 뒤로
                        </button>
                        <button
                          type="button"
                          onClick={() => handleLayerOrder('back')}
                          className="px-2 py-1 rounded bg-white border border-slate-300 text-[11px] font-bold hover:bg-slate-100"
                          title="맨 뒤로 보내기"
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

                    {/* 1) 텍스트 선택 시 전용 툴바: 내용, 폰트, 크기, 굵기, 색상, 정렬, 자간, 행간 */}
                    {selectedObjType === 'text' && (
                      <div className="space-y-2.5 text-xs">
                        {/* 모바일에서도 쉽게 글씨를 고칠 수 있는 빠른 입력창 */}
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
                          {/* 폰트 변경 */}
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

                          {/* 글자 크기 */}
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

                          {/* 굵기 & 정렬 */}
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

                          {/* 글자색 & 배경 하이라이트 */}
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

                        {/* 자간(charSpacing) · 행간(lineHeight) · 투명도 슬라이더 */}
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

                    {/* 2) 사진 선택 시 전용 툴바: 교체, 크롭(자르기), 회전, 모서리 둥글기, 투명도 */}
                    {selectedObjType === 'image' && (
                      <div className="space-y-2.5 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-extrabold cursor-pointer">
                            🔄 다른 사진으로 교체
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
                              ✂️ 사진 자르기 (크롭)
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

                          <button
                            type="button"
                            onClick={async () => {
                              const canvas = fabricCanvasRef.current;
                              const active = canvas?.getActiveObject?.();
                              if (!active || !active.originalSrc) return;
                              await handleReplaceSelectedPhoto(active.originalSrc);
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 font-bold text-slate-700"
                          >
                            ↺ 크롭 초기화
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

                    {/* 3) 도형(사각형/원/선) 선택 시 전용 툴바 */}
                    {selectedObjType === 'shape' && (
                      <div className="space-y-2 text-xs">
                        { isCropping && (
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
                      💡 <strong>캔버스 위의 글자·사진·도형을 클릭</strong>하면 이동, 크기 조절, 회전, 크롭, 폰트·자간·행간 편집창이 여기에 열립니다!
                    </span>
                    <span className="text-[11px] text-slate-400 hidden sm:inline">
                      단축키: Ctrl+Z / Ctrl+Y / Delete
                    </span>
                  </div>
                )}

                {/* ========================================================= */}
                {/* 메인 인터랙티브 Fabric.js 캔버스 뷰포트 (반응형 자동 스케일)  */}
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
                    {/* 1080x1350 (또는 1080x1080) 원본 해상도 캔버스를 CSS scale로 표시 */}
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
        )}

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
        {/* [탭 3] 내 게시물 업로드 · 예약 기록 탭                              */}
        {/* ================================================================= */}
        {activeTab === 'history' && (
          <section className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex items-center justify-between">
              <div>
                <h2 className="text-xl font-extrabold text-slate-900">내 게시물 업로드 · 예약 기록</h2>
              </div>
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

                    {Array.isArray(post.rendered_image_urls) && post.rendered_image_urls.length > 0 && (
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
                              <p className="text-rose-600 font-semibold mt-0.5">{t.error_message}</p>
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

      {/* 업로드 최종 확인 모달 */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-extrabold text-slate-900">
              {scheduleType === 'scheduled'
                ? '📅 예약 업로드를 등록할까요?'
                : '🚀 지금 바로 인스타그램에 올릴까요?'}
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              캔버스에서 직접 수정하신 <strong>총 {slides.length}장</strong>의 카드뉴스 디자인이 그대로 고화질 이미지로 변환되어 선택한 인스타그램 계정에 업로드됩니다.
            </p>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                disabled={isPublishing}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleExecutePublish}
                disabled={isPublishing}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 text-white text-xs font-extrabold"
              >
                {isPublishing ? '고화질 변환 및 업로드 중...' : '네, 지금 올릴게요!'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
