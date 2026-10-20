'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  ASPECT_RATIOS,
  AspectRatioKey,
  CAPTION_LIMITS,
  CAPTION_TONES,
  CaptionToneId,
  FontId,
  KOREAN_FONTS,
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

export type SlideLayoutType = 'auto' | 'top-photo' | 'bottom-photo' | 'full-bleed' | 'split-left';

export interface CustomFontItem {
  id: string;
  name: string;
  base64Data: string;
  mimeType?: string;
}

export interface SlideItem extends BaseSlideItem {
  photoIndices?: number[];
  photoUrls?: string[];
  multiPhotoLayout?: 'auto' | 'row' | 'col' | 'grid' | 'collage';
  photoZoom?: number;
  overlayOpacity?: number;
  layoutType?: SlideLayoutType;
  textAlign?: 'left' | 'center' | 'right';
  titleSize?: number;
  bodySize?: number;
  customTextColor?: string;
  customBgColor?: string;
  showBadge?: boolean;
  showSlideNumber?: boolean;
  footerText?: string;
}

function countHashtags(text: string): number {
  const matches = text.match(/#[^\s#]+/g);
  return matches ? matches.length : 0;
}

export default function InstaAutoStudioPage() {
  // 1) 로그인 / 사용자 상태
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

  // 2) 내 인스타그램 계정 목록 상태
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);

  // 3) 새 게시물 만들기 상태
  const [publishMode, setPublishMode] = useState<'auto_publish' | 'download_only'>('auto_publish');
  const maxSlideLimit =
    publishMode === 'download_only' ? MAX_SLIDES.DOWNLOAD_ONLY : MAX_SLIDES.AUTO_PUBLISH;
  const [slideCount, setSlideCount] = useState<number>(4);
  const [aspectRatio, setAspectRatio] = useState<AspectRatioKey>('4:5');
  const [fontId, setFontId] = useState<string>('Pretendard');
  const [customFonts, setCustomFonts] = useState<CustomFontItem[]>([]);
  const [moodId, setMoodId] = useState<MoodId>('minimal');
  const [accentColor, setAccentColor] = useState<string>('#2563EB');

  // 하단 워터마크 설정 (기본값: 꺼짐 — AUTO CARD STUDIO 표시 안 함!)
  const [showWatermark, setShowWatermark] = useState<boolean>(false);
  const [watermarkText, setWatermarkText] = useState<string>('');

  // 사진 + 내용 입력
  const [uploadedPhotos, setUploadedPhotos] = useState<UploadedPhoto[]>([]);
  const [rawText, setRawText] = useState<string>(
    '이번 주말에 다녀온 성수동 브런치 카페 후기!\n분위기도 너무 따뜻하고 시그니처 라떼가 정말 고소했어요.\n창가 자리는 오후 2시쯤 햇살이 가장 예쁘게 들어오니까 방문하실 분들은 꼭 참고하세요!'
  );
  const [isDragging, setIsDragging] = useState(false);

  // AI 생성된 슬라이드 & 미리보기 상태
  const [slides, setSlides] = useState<SlideItem[]>([]);
  const [activeSlideIndex, setActiveSlideIndex] = useState<number>(0);
  const [isGeneratingAI, setIsGeneratingAI] = useState<boolean>(false);
  const [regeneratingSlideIdx, setRegeneratingSlideIdx] = useState<number | null>(null);
  const [isRenderingJpeg, setIsRenderingJpeg] = useState<boolean>(false);

  // 캡션 및 계정별 캡션 상태
  const [captionTone, setCaptionTone] = useState<CaptionToneId>('friendly');
  const [baseCaption, setBaseCaption] = useState<string>('');
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [accountCustomCaptions, setAccountCustomCaptions] = useState<Record<string, string>>({});
  const [activeCaptionTab, setActiveCaptionTab] = useState<string>('base');

  // 지금 올리기 vs 예약 올리기
  const [scheduleType, setScheduleType] = useState<'now' | 'scheduled'>('now');
  const [scheduledDateTime, setScheduledDateTime] = useState<string>('');
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);

  // 4) 내 게시물 기록
  const [postHistory, setPostHistory] = useState<PostRecord[]>([]);
  const [retryingTargetId, setRetryingTargetId] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 5000);
  };

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
  }, []);

  useEffect(() => {
    if (sessionToken) {
      fetchAccounts();
      fetchPostHistory();
    }
  }, [sessionToken]);

  useEffect(() => {
    if (slides.length === 0) {
      buildDefaultSlides(slideCount);
    }
  }, []);

  useEffect(() => {
    if (slideCount > maxSlideLimit) {
      handleSlideCountChange(maxSlideLimit);
    }
  }, [publishMode]);

  function buildDefaultSlides(count: number) {
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
        id: `slide-init-${idx}`,
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
          ? '미리보기 화면의 글자를 직접 클릭해서 내 마음대로 수정해 보세요!'
          : isCover
          ? '오른쪽으로 넘겨서 자세한 내용을 확인해 보세요 👉'
          : isCta
          ? '프로필 링크에서 더 많은 정보를 확인하실 수 있습니다.'
          : '사진을 여러 장 넣거나 글씨 위치·크기·색상을 자유롭게 바꿀 수 있습니다.',
        photoIndex: photoObj ? idx : null,
        photoUrl: photoObj ? photoObj.url : null,
        photoIndices: photoObj ? [idx] : [],
        photoUrls: photoObj ? [photoObj.url] : [],
        focusX: 50,
        focusY: 50,
        photoZoom: 100,
        overlayOpacity: 55,
        layoutType: 'auto',
        textPosition: 'bottom',
        textAlign: 'left',
        showBadge: true,
        showSlideNumber: true,
      };
    });
    setSlides(nextSlides);
    setActiveSlideIndex(0);
    setBaseCaption(
      '✨ 오늘 준비한 카드뉴스 핵심 요약!\n이미지를 넘겨서 자세한 내용을 확인해 보세요.\n\n#인스타그램 #카드뉴스 #일상 #꿀팁 #정보공유'
    );
  }

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
          return {
            ...existing,
            slideNumber: idx + 1,
            role,
            roleLabel,
          };
        }

        const photoObj = uploadedPhotos[idx] || null;
        return {
          id: `slide-${Date.now()}-${idx}`,
          slideNumber: idx + 1,
          role,
          roleLabel,
          badgeText: isCta ? 'SUMMARY' : `POINT 0${idx}`,
          headline: isCta ? '저장해 두고 필요할 때 꺼내보세요!' : `핵심 내용 ${idx + 1}`,
          body: '미리보기에서 글자를 클릭하거나 아래 입력칸에서 자유롭게 수정하세요.',
          photoIndex: photoObj ? idx : null,
          photoUrl: photoObj ? photoObj.url : null,
          photoIndices: photoObj ? [idx] : [],
          photoUrls: photoObj ? [photoObj.url] : [],
          focusX: 50,
          focusY: 50,
          photoZoom: 100,
          overlayOpacity: 55,
          layoutType: 'auto',
          textPosition: 'bottom',
          textAlign: 'left',
          showBadge: true,
          showSlideNumber: true,
        };
      });
      return updated;
    });

    if (activeSlideIndex >= clamped) {
      setActiveSlideIndex(Math.max(0, clamped - 1));
    }
  }

  // [신규 기능] 내 컴퓨터에 있는 폰트 파일(.ttf, .otf, .woff) 직접 추가하기
  async function handleCustomFontUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    const cleanName = file.name.replace(/\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/, '');
    const customFontId = `Custom_${cleanName}_${Date.now()}`;

    try {
      const arrayBuf = await file.arrayBuffer();
      const base64Data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
      });

      // 브라우저에 즉시 폰트 등록하여 실시간 미리보기에 바로 반영
      if (typeof window !== 'undefined' && 'FontFace' in window) {
        const fontFace = new FontFace(customFontId, arrayBuf);
        await fontFace.load();
        document.fonts.add(fontFace);
      }

      const newFont: CustomFontItem = {
        id: customFontId,
        name: `📁 ${cleanName} (내 폰트)`,
        base64Data,
      };

      setCustomFonts((prev) => [...prev, newFont]);
      setFontId(customFontId);
      showToast(`✅ '${cleanName}' 폰트가 추가되어 즉시 적용되었습니다!`);
    } catch {
      showToast('⚠️ 폰트 파일을 읽는 중 오류가 발생했습니다. (.ttf, .otf, .woff 파일을 사용해 주세요)');
    }
  }

  async function fetchAccounts() {
    if (!sessionToken) return;
    try {
      const res = await fetch('/api/accounts', {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const data = await res.json();
      if (data.accounts) {
        setAccounts(data.accounts);
      }
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
      if (data.posts) {
        setPostHistory(data.posts);
      }
    } catch {
      // ignore
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
        if (!res.ok) {
          throw new Error(resData.error || '회원가입 실패');
        }
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
      const msg = err instanceof Error ? err.message : '로그인 중 오류가 발생했습니다.';
      setAuthMessage(`오류: ${msg}`);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handlePhotoFiles(fileList: FileList | null, assignToActiveSlide = false) {
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

    const startIdx = uploadedPhotos.length;
    const merged = [...uploadedPhotos, ...newPhotos];
    setUploadedPhotos(merged);

    if (assignToActiveSlide) {
      // 현재 보고 있는 장에 방금 올린 사진들을 바로 추가 (최대 4장)
      const addedIndices = newPhotos.map((_, i) => startIdx + i);
      setSlides((prev) =>
        prev.map((s, idx) => {
          if (idx !== activeSlideIndex) return s;
          const prevIndices =
            Array.isArray(s.photoIndices) && s.photoIndices.length > 0
              ? s.photoIndices
              : s.photoIndex !== null
              ? [s.photoIndex]
              : [];
          const nextIndices = Array.from(new Set([...prevIndices, ...addedIndices])).slice(0, 4);
          const nextUrls = nextIndices.map((pIdx) => merged[pIdx]?.url).filter(Boolean);
          return {
            ...s,
            photoIndices: nextIndices,
            photoUrls: nextUrls,
            photoIndex: nextIndices[0] ?? null,
            photoUrl: nextUrls[0] ?? null,
          };
        })
      );
      showToast(`📸 현재 장에 사진 ${newPhotos.length}장이 추가되었습니다!`);
    } else {
      setSlides((prev) =>
        prev.map((s, idx) => {
          const matchedPhoto = merged[idx];
          if (!matchedPhoto) return s;
          const hasExisting = Array.isArray(s.photoUrls) && s.photoUrls.length > 0;
          if (hasExisting) return s;
          return {
            ...s,
            photoIndex: idx,
            photoUrl: matchedPhoto.url,
            photoIndices: [idx],
            photoUrls: [matchedPhoto.url],
          };
        })
      );
      showToast(`📸 사진 ${newPhotos.length}장이 업로드되었습니다!`);
    }
  }

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
        if (!res.ok) {
          throw new Error(data.error || 'AI 생성 실패');
        }
        const enrichedSlides: SlideItem[] = (data.slides || []).map((s: SlideItem) => ({
          ...s,
          photoIndices: s.photoIndex !== null ? [s.photoIndex] : [],
          photoUrls: s.photoUrl ? [s.photoUrl] : [],
          photoZoom: 100,
          overlayOpacity: 55,
          layoutType: 'auto',
          textAlign: 'left',
          showBadge: true,
          showSlideNumber: true,
        }));
        setSlides(enrichedSlides);
        setBaseCaption(data.caption);
        setActiveSlideIndex(0);
        showToast('✨ AI가 카드뉴스 초안을 완성했습니다! 오른쪽에서 마음대로 직접 수정해 보세요!');
      } else {
        buildDefaultSlides(slideCount);
        showToast('✨ 슬라이드 초안이 생성되었습니다! (로그인 시 Gemini AI가 작동합니다)');
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

        setSlides((prev) =>
          prev.map((s, i) =>
            i === idx
              ? { ...s, badgeText: data.badgeText, headline: data.headline, body: data.body }
              : s
          )
        );
        showToast(`✅ ${idx + 1}번째 장의 문구를 새롭게 다시 만들었습니다!`);
      }
    } catch (err) {
      showToast(`⚠️ ${err instanceof Error ? err.message : '이 장만 다시 만들기 실패'}`);
    } finally {
      setRegeneratingSlideIdx(null);
    }
  }

  // 현재 슬라이드 속성 변경 헬퍼
  function updateActiveSlide(patch: Partial<SlideItem>) {
    setSlides((prev) =>
      prev.map((s, idx) => (idx === activeSlideIndex ? { ...s, ...patch } : s))
    );
  }

  // 현재 슬라이드의 레이아웃/글자 설정을 모든 장에 일괄 적용
  function applyCurrentStyleToAllSlides() {
    const cur = slides[activeSlideIndex];
    if (!cur) return;
    setSlides((prev) =>
      prev.map((s) => ({
        ...s,
        layoutType: cur.layoutType,
        textPosition: cur.textPosition,
        textAlign: cur.textAlign,
        titleSize: cur.titleSize,
        bodySize: cur.bodySize,
        customTextColor: cur.customTextColor,
        customBgColor: cur.customBgColor,
        overlayOpacity: cur.overlayOpacity,
        showBadge: cur.showBadge,
        showSlideNumber: cur.showSlideNumber,
      }))
    );
    showToast('✅ 현재 장의 레이아웃·글자 위치·색상 스타일을 모든 장에 똑같이 적용했습니다!');
  }

  // 한 장에 사진 여러 장(최대 4장) 선택/해제 토글
  function togglePhotoInActiveSlide(photoIdx: number) {
    const cur = slides[activeSlideIndex];
    if (!cur) return;
    const currentIndices: number[] =
      Array.isArray(cur.photoIndices) && cur.photoIndices.length > 0
        ? cur.photoIndices
        : cur.photoIndex !== null && cur.photoIndex !== undefined
        ? [cur.photoIndex]
        : [];

    let nextIndices: number[];
    if (currentIndices.includes(photoIdx)) {
      nextIndices = currentIndices.filter((i) => i !== photoIdx);
    } else {
      if (currentIndices.length >= 4) {
        showToast('⚠️ 한 장에는 최대 4장까지 사진을 넣을 수 있습니다.');
        return;
      }
      nextIndices = [...currentIndices, photoIdx];
    }

    const nextUrls = nextIndices.map((i) => uploadedPhotos[i]?.url).filter(Boolean);
    updateActiveSlide({
      photoIndices: nextIndices,
      photoUrls: nextUrls,
      photoIndex: nextIndices[0] ?? null,
      photoUrl: nextUrls[0] ?? null,
    });
  }

  // 새 빈 슬라이드 추가 / 현재 슬라이드 복제
  function duplicateActiveSlide() {
    if (slides.length >= maxSlideLimit) {
      showToast(`⚠️ 최대 ${maxSlideLimit}장까지만 만들 수 있습니다.`);
      return;
    }
    const cur = slides[activeSlideIndex];
    if (!cur) return;
    const copy = [...slides];
    copy.splice(activeSlideIndex + 1, 0, {
      ...cur,
      id: `slide-dup-${Date.now()}`,
    });
    const reindexed = copy.map((s, i) => ({ ...s, slideNumber: i + 1 }));
    setSlides(reindexed);
    setSlideCount(reindexed.length);
    setActiveSlideIndex(activeSlideIndex + 1);
    showToast('✅ 현재 장이 복제되었습니다!');
  }

  function moveSlide(idx: number, direction: -1 | 1) {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= slides.length) return;
    const copy = [...slides];
    const [removed] = copy.splice(idx, 1);
    copy.splice(targetIdx, 0, removed);
    const reindexed = copy.map((s, i) => ({ ...s, slideNumber: i + 1 }));
    setSlides(reindexed);
    setActiveSlideIndex(targetIdx);
  }

  function deleteSlide(idx: number) {
    if (slides.length <= 1) {
      showToast('⚠️ 최소 1장의 슬라이드는 남아있어야 합니다.');
      return;
    }
    const filtered = slides
      .filter((_, i) => i !== idx)
      .map((s, i) => ({ ...s, slideNumber: i + 1 }));
    setSlides(filtered);
    setSlideCount(filtered.length);
    setActiveSlideIndex(Math.max(0, idx - 1));
  }

  const activeCustomFont = useMemo(
    () => customFonts.find((f) => f.id === fontId) || null,
    [customFonts, fontId]
  );

  async function handleServerRenderAndDownload() {
    setIsRenderingJpeg(true);
    try {
      if (sessionToken) {
        const res = await fetch('/api/render', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({
            slides,
            aspectRatio,
            fontId,
            customFontBase64: activeCustomFont?.base64Data || '',
            moodId,
            accentColor,
            watermarkText,
            showWatermark,
            uploadToStorage: false,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        (data.renderedUrls || []).forEach((url: string, i: number) => {
          const a = document.createElement('a');
          a.href = url;
          a.download = `instagram-slide-${i + 1}.jpg`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        });
        showToast(`✅ 총 ${slides.length}장의 고화질 JPEG 이미지가 다운로드되었습니다!`);
      } else {
        showToast('⚠️ 서버 JPEG 생성 및 다운로드를 위해 먼저 로그인해 주세요.');
      }
    } catch (err) {
      showToast(`⚠️ ${err instanceof Error ? err.message : 'JPEG 생성 중 오류 발생'}`);
    } finally {
      setIsRenderingJpeg(false);
    }
  }

  function toggleSelectAccount(acc: InstagramAccount) {
    if (acc.status === 'expired' || acc.status === 'disconnected') {
      showToast('⚠️ 연결이 끊긴 계정입니다. [내 계정들] 탭에서 다시 연결해 주세요.');
      return;
    }
    if ((acc.quota_usage ?? 0) >= (acc.quota_limit ?? 25)) {
      showToast(`⚠️ @${acc.username} 계정은 오늘 인스타 업로드 한도를 모두 사용했습니다.`);
      return;
    }

    setSelectedAccountIds((prev) => {
      const exists = prev.includes(acc.id);
      return exists ? prev.filter((id) => id !== acc.id) : [...prev, acc.id];
    });

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
          title: slides[0]?.headline || '새 게시물',
          rawText,
          publishMode,
          slideCount: slides.length,
          aspectRatio,
          fontId,
          customFontBase64: activeCustomFont?.base64Data || '',
          moodId,
          accentColor,
          watermarkText,
          showWatermark,
          captionTone,
          baseCaption,
          slides,
          uploadedPhotos,
          selectedAccounts: selectedPayload,
          scheduleType,
          scheduledAt: scheduleType === 'scheduled' ? scheduledDateTime : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '업로드 실패');
      }

      setShowConfirmModal(false);
      await fetchPostHistory();
      setActiveTab('history');
      showToast(
        scheduleType === 'scheduled'
          ? '⏰ 예약 업로드가 등록되었습니다! 지정된 시간에 서버가 자동으로 올려드립니다.'
          : '🎉 인스타그램에 게시물이 성공적으로 올라갔습니다!'
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

  const currentBuiltinFont = useMemo(
    () => KOREAN_FONTS.find((f) => f.id === fontId) || KOREAN_FONTS[0],
    [fontId]
  );
  const previewCssFontFamily = activeCustomFont
    ? `'${activeCustomFont.id}', sans-serif`
    : currentBuiltinFont.cssFamily;

  const currentMood = useMemo(
    () => MOOD_PRESETS.find((m) => m.id === moodId) || MOOD_PRESETS[0],
    [moodId]
  );
  const activeSlide = slides[activeSlideIndex] || slides[0];

  const effectiveBgColor = activeSlide?.customBgColor || currentMood.bgColor;
  const safeTextColor = activeSlide?.customTextColor
    ? activeSlide.customTextColor
    : ensureReadableColor(currentMood.textColor, effectiveBgColor, 4.5);
  const safeSubTextColor = activeSlide?.customTextColor
    ? activeSlide.customTextColor
    : ensureReadableColor(currentMood.subTextColor, effectiveBgColor, 3.5);
  const safeAccent = ensureReadableColor(accentColor, effectiveBgColor, 2.8);
  const badgeTextColor = getReadableTextOnAccent(safeAccent);

  // 현재 슬라이드에 선택된 사진 URL 목록 (1~4장)
  const activeSlidePhotos: string[] = useMemo(() => {
    if (!activeSlide) return [];
    if (Array.isArray(activeSlide.photoUrls) && activeSlide.photoUrls.length > 0) {
      return activeSlide.photoUrls.filter(Boolean);
    }
    return activeSlide.photoUrl ? [activeSlide.photoUrl] : [];
  }, [activeSlide]);

  const effectiveLayout: SlideLayoutType =
    activeSlide?.layoutType && activeSlide.layoutType !== 'auto'
      ? activeSlide.layoutType
      : currentMood.photoLayout === 'full-bleed'
      ? 'full-bleed'
      : 'top-photo';

  const currentEditingCaption =
    activeCaptionTab === 'base'
      ? baseCaption
      : accountCustomCaptions[activeCaptionTab] ?? baseCaption;
  const captionLength = currentEditingCaption.length;
  const hashtagCount = countHashtags(currentEditingCaption);
  const isCaptionOverLimit =
    captionLength > CAPTION_LIMITS.MAX_LENGTH || hashtagCount > CAPTION_LIMITS.MAX_HASHTAGS;

  // 미리보기용 다중 사진(1~4장) 그리드 렌더러
  function renderPreviewPhotoGrid(photos: string[], isFullBleed = false) {
    if (photos.length === 0) return null;
    const zoom = (activeSlide?.photoZoom ?? 100) / 100;
    const posX = activeSlide?.focusX ?? 50;
    const posY = activeSlide?.focusY ?? 50;

    const imgStyle: React.CSSProperties = {
      objectPosition: `${posX}% ${posY}%`,
      transform: `scale(${zoom})`,
      transformOrigin: `${posX}% ${posY}%`,
    };

    if (photos.length === 1) {
      return (
        <div className="w-full h-full overflow-hidden">
          <img src={photos[0]} alt="slide-1" className="w-full h-full object-cover transition-transform" style={imgStyle} />
        </div>
      );
    }

    if (photos.length === 2) {
      return (
        <div className="w-full h-full grid grid-cols-2 gap-1.5 overflow-hidden">
          {photos.map((url, idx) => (
            <div key={idx} className="w-full h-full overflow-hidden rounded-md">
              <img src={url} alt={`slide-${idx}`} className="w-full h-full object-cover" style={imgStyle} />
            </div>
          ))}
        </div>
      );
    }

    if (photos.length === 3) {
      return (
        <div className="w-full h-full grid grid-cols-12 gap-1.5 overflow-hidden">
          <div className="col-span-7 h-full overflow-hidden rounded-md">
            <img src={photos[0]} alt="slide-0" className="w-full h-full object-cover" style={imgStyle} />
          </div>
          <div className="col-span-5 h-full grid grid-rows-2 gap-1.5 overflow-hidden">
            <div className="w-full h-full overflow-hidden rounded-md">
              <img src={photos[1]} alt="slide-1" className="w-full h-full object-cover" style={imgStyle} />
            </div>
            <div className="w-full h-full overflow-hidden rounded-md">
              <img src={photos[2]} alt="slide-2" className="w-full h-full object-cover" style={imgStyle} />
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        className={`w-full h-full grid grid-cols-2 grid-rows-2 gap-1.5 overflow-hidden ${
          isFullBleed ? '' : 'rounded-md'
        }`}
      >
        {photos.slice(0, 4).map((url, idx) => (
          <div key={idx} className="w-full h-full overflow-hidden rounded-sm">
            <img src={url} alt={`slide-${idx}`} className="w-full h-full object-cover" style={imgStyle} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-pink-500 via-rose-500 to-amber-500 flex items-center justify-center text-white font-bold text-lg shadow">
              IG
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-slate-900 leading-tight">
                인스타 오토 스튜디오
              </h1>
              <p className="text-xs text-slate-500 hidden sm:block">
                자유로운 카드뉴스 커스텀 디자인 · 다중 사진 콜라주 · 인스타 자동 업로드
              </p>
            </div>
          </div>

          <nav className="flex items-center gap-1 sm:gap-2 bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('create')}
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition ${
                activeTab === 'create'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ✨ 새 게시물 만들기
            </button>
            <button
              onClick={() => setActiveTab('accounts')}
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition ${
                activeTab === 'accounts'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🔗 내 계정들 ({accounts.length}/{MAX_IG_ACCOUNTS})
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition ${
                activeTab === 'history'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📋 내 게시물 기록
            </button>
          </nav>

          <div className="hidden md:flex items-center gap-3">
            {sessionToken ? (
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <span className="font-medium text-slate-800">{userEmail}</span>
                <button
                  onClick={() => getSupabaseBrowser().auth.signOut()}
                  className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium"
                >
                  로그아웃
                </button>
              </div>
            ) : (
              <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 font-semibold">
                로그인 전 (아래에서 로그인하세요)
              </span>
            )}
          </div>
        </div>
      </header>

      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 max-w-md bg-slate-900 text-white px-5 py-3.5 rounded-2xl shadow-xl border border-slate-700 text-sm font-medium flex items-center justify-between gap-4">
          <span>{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="text-slate-400 hover:text-white text-xs"
          >
            닫기
          </button>
        </div>
      )}

      <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex-1 space-y-6">
        {!sessionToken && (
          <section className="bg-white rounded-2xl border border-blue-200 p-5 sm:p-6 shadow-sm">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="space-y-1">
                <span className="inline-block text-xs font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700">
                  🔒 개인 데이터 보호 (다른 사용자는 내 사진과 계정을 절대 볼 수 없어요)
                </span>
                <h2 className="text-lg font-bold text-slate-900">
                  1단계: 이메일로 간편 로그인 / 회원가입
                </h2>
                <p className="text-sm text-slate-600">
                  내 인스타 계정을 연결하고 예약 업로드를 사용하려면 먼저 로그인해 주세요.
                </p>
              </div>

              <form
                onSubmit={handleAuthSubmit}
                className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
              >
                <input
                  type="email"
                  required
                  placeholder="이메일 주소 입력"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="비밀번호 (6자리 이상)"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  className="px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={authLoading}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold shadow-sm disabled:opacity-50"
                >
                  {authLoading
                    ? '처리 중...'
                    : authMode === 'login'
                    ? '로그인하기'
                    : '회원가입하기'}
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
                  className="px-3 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
                >
                  {authMode === 'login' ? '처음이신가요? 회원가입' : '이미 계정이 있나요? 로그인'}
                </button>
              </form>
            </div>
            {authMessage && (
              <p className="mt-3 text-xs font-semibold text-rose-600">{authMessage}</p>
            )}
          </section>
        )}

        {activeTab === 'accounts' && (
          <section className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-extrabold text-slate-900">
                  연결된 내 인스타그램 계정 ({accounts.length} / {MAX_IG_ACCOUNTS}개)
                </h2>
                <p className="text-sm text-slate-600 mt-1">
                  복잡한 토큰 복사 없이 [인스타 계정 추가] 버튼만 누르면 공식 인스타그램 로그인으로 안전하게 연결됩니다.
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
                <p className="text-sm text-slate-500">
                  오른쪽 위의 [+ 인스타 계정 추가] 버튼을 눌러 최대 {MAX_IG_ACCOUNTS}개까지 계정을 연결해 보세요!
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {accounts.map((acc) => {
                  const isEditing = editingAccountId === acc.id;
                  const statusBadge =
                    acc.status === 'active'
                      ? { label: '🟢 정상 연결됨', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
                      : acc.status === 'expiring_soon'
                      ? { label: '🟡 만료 임박 (자동 갱신 예정)', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
                      : { label: '🔴 연결 끊김 (다시 로그인 필요)', cls: 'bg-rose-50 text-rose-700 border-rose-200' };

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
                            <span
                              className={`inline-block mt-1 text-xs font-semibold px-2.5 py-0.5 rounded-full border ${statusBadge.cls}`}
                            >
                              {statusBadge.label}
                            </span>
                          </div>
                        </div>

                        <div className="text-right space-y-1">
                          <div className="text-xs font-semibold text-slate-600">
                            오늘 업로드 한도: {acc.quota_usage ?? 0} / {acc.quota_limit ?? 25}회
                          </div>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setEditingAccountId(isEditing ? null : acc.id)}
                              className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                            >
                              {isEditing ? '설정 닫기' : '⚙️ 기본 스타일 설정'}
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
                      </div>

                      {isEditing && (
                        <div className="pt-4 border-t border-slate-100 space-y-3 text-sm">
                          <p className="text-xs font-bold text-slate-700">
                            이 계정의 기본 폰트 · 분위기 · 해시태그 묶음 저장
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs text-slate-500 mb-1">기본 폰트</label>
                              <select
                                value={acc.default_font}
                                onChange={(e) =>
                                  setAccounts((prev) =>
                                    prev.map((a) =>
                                      a.id === acc.id
                                        ? { ...a, default_font: e.target.value as FontId }
                                        : a
                                    )
                                  )
                                }
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                              >
                                {KOREAN_FONTS.map((f) => (
                                  <option key={f.id} value={f.id}>
                                    {f.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs text-slate-500 mb-1">기본 분위기</label>
                              <select
                                value={acc.default_mood}
                                onChange={(e) =>
                                  setAccounts((prev) =>
                                    prev.map((a) =>
                                      a.id === acc.id
                                        ? { ...a, default_mood: e.target.value as MoodId }
                                        : a
                                    )
                                  )
                                }
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                              >
                                {MOOD_PRESETS.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs text-slate-500 mb-1">
                              기본 해시태그 묶음
                            </label>
                            <input
                              type="text"
                              value={acc.default_hashtags}
                              onChange={(e) =>
                                setAccounts((prev) =>
                                  prev.map((a) =>
                                    a.id === acc.id
                                      ? { ...a, default_hashtags: e.target.value }
                                      : a
                                  )
                                )
                              }
                              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                            />
                          </div>
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
                              showToast(`✅ @${acc.username} 계정의 기본 설정이 저장되었습니다!`);
                            }}
                            className="w-full py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700"
                          >
                            이 계정의 기본 설정 저장하기
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

        {activeTab === 'create' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* 왼쪽: 입력, 폰트 추가, 프리셋, 캡션, 업로드 설정 (6칸) */}
            <div className="lg:col-span-6 space-y-6">
              {/* STEP 1: 사진 + 내용 올리기 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base sm:text-lg font-extrabold text-slate-900">
                    1. 사진과 내용 올리기
                  </h2>
                  <span className="text-xs text-blue-600 font-semibold">
                    한 장에 사진 1~4장 콜라주 배치 가능!
                  </span>
                </div>

                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    handlePhotoFiles(e.dataTransfer.files);
                  }}
                  className={`flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-5 cursor-pointer transition ${
                    isDragging
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-slate-300 hover:border-blue-400 bg-slate-50/60'
                  }`}
                >
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => handlePhotoFiles(e.target.files)}
                    className="hidden"
                  />
                  <div className="text-2xl mb-1">🖼️</div>
                  <p className="text-sm font-bold text-slate-800">
                    여기에 사진 여러 장을 끌어다 놓거나 눌러서 추가하세요
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    올린 사진들은 오른쪽 편집창에서 장마다 1~4장씩 마음대로 골라 넣을 수 있습니다.
                  </p>
                </label>

                {uploadedPhotos.length > 0 && (
                  <div className="flex items-center gap-2.5 overflow-x-auto pb-2">
                    {uploadedPhotos.map((p, idx) => (
                      <div
                        key={p.id}
                        className="relative w-16 h-16 rounded-xl overflow-hidden border border-slate-200 flex-shrink-0"
                      >
                        <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
                        <span className="absolute top-0.5 left-0.5 bg-black/75 text-white text-[10px] font-bold px-1.5 py-0.2 rounded">
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
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    게시물에 들어갈 내용 (AI 초안용 메모 · 생략하고 오른쪽에서 직접 타이핑해도 됩니다)
                  </label>
                  <textarea
                    rows={3}
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    placeholder="내용을 적고 아래 [AI로 자동 제작하기]를 누르면 초안을 잡아줍니다. 그 위에서 내 마음대로 수정하세요!"
                    className="w-full rounded-xl border border-slate-300 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* STEP 2: 장수 & 비율 & AI 초안 만들기 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h2 className="text-base sm:text-lg font-extrabold text-slate-900">
                    2. 장수 · 비율 고르기
                  </h2>
                  <div className="inline-flex rounded-xl bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => setPublishMode('auto_publish')}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                        publishMode === 'auto_publish'
                          ? 'bg-white text-blue-600 shadow-sm'
                          : 'text-slate-600'
                      }`}
                    >
                      자동 업로드 (최대 {MAX_SLIDES.AUTO_PUBLISH}장)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPublishMode('download_only')}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                        publishMode === 'download_only'
                          ? 'bg-white text-blue-600 shadow-sm'
                          : 'text-slate-600'
                      }`}
                    >
                      다운로드 전용 (최대 {MAX_SLIDES.DOWNLOAD_ONLY}장)
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-800">
                      장수: <strong className="text-blue-600">{slideCount}장</strong>
                    </span>
                    <div className="flex gap-1.5">
                      {(Object.keys(ASPECT_RATIOS) as AspectRatioKey[]).map((ratioKey) => (
                        <button
                          key={ratioKey}
                          type="button"
                          onClick={() => setAspectRatio(ratioKey)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                            aspectRatio === ratioKey
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white text-slate-700 border-slate-300'
                          }`}
                        >
                          {ratioKey} 비율
                        </button>
                      ))}
                    </div>
                  </div>

                  <input
                    type="range"
                    min={1}
                    max={maxSlideLimit}
                    value={slideCount}
                    onChange={(e) => handleSlideCountChange(Number(e.target.value))}
                    className="w-full accent-blue-600 cursor-pointer"
                  />

                  <div className="flex flex-wrap gap-1">
                    {Array.from({ length: maxSlideLimit }).map((_, i) => {
                      const num = i + 1;
                      return (
                        <button
                          key={num}
                          type="button"
                          onClick={() => handleSlideCountChange(num)}
                          className={`w-8 h-8 rounded-lg text-xs font-bold border transition ${
                            slideCount === num
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-slate-700 border-slate-200 hover:border-blue-400'
                          }`}
                        >
                          {num}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleGenerateWithAI}
                  disabled={isGeneratingAI}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold text-sm shadow-md transition disabled:opacity-50"
                >
                  {isGeneratingAI
                    ? '🤖 Gemini AI가 초안을 만드는 중...'
                    : `✨ AI로 ${slideCount}장 초안 자동 만들기 (만든 뒤 오른쪽에서 자유 수정)`}
                </button>
              </div>

              {/* STEP 3: 폰트 (내 폰트 추가 지원!) & 분위기 & 워터마크 설정 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h2 className="text-base sm:text-lg font-extrabold text-slate-900">
                    3. 폰트 (내 폰트 추가 가능!) · 분위기 · 워터마크
                  </h2>
                  {/* 내 폰트 파일(.ttf, .otf, .woff) 직접 업로드 버튼 */}
                  <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold cursor-pointer shadow-sm">
                    <span>➕ 내 폰트 파일(.ttf/.otf/.woff) 추가</span>
                    <input
                      type="file"
                      accept=".ttf,.otf,.woff,.woff2"
                      onChange={(e) => handleCustomFontUpload(e.target.files)}
                      className="hidden"
                    />
                  </label>
                </div>

                {/* 내가 추가한 커스텀 폰트 목록 */}
                {customFonts.length > 0 && (
                  <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-200 space-y-2">
                    <span className="text-xs font-extrabold text-indigo-900 block">
                      내가 추가한 폰트 (클릭하면 적용됩니다)
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {customFonts.map((cf) => (
                        <button
                          key={cf.id}
                          type="button"
                          onClick={() => setFontId(cf.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${
                            fontId === cf.id
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-indigo-900 border-indigo-200'
                          }`}
                        >
                          {cf.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 기본 한국어 폰트 6종 */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {KOREAN_FONTS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFontId(f.id)}
                      style={{ fontFamily: f.cssFamily }}
                      className={`p-2.5 rounded-xl border text-left transition ${
                        fontId === f.id
                          ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-500/20'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="text-xs font-bold text-slate-900">{f.name}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">{f.description}</div>
                    </button>
                  ))}
                </div>

                {/* 분위기 프리셋 6종 */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-2">
                    기본 분위기 프리셋 (고른 뒤 오른쪽에서 배경색·글자색·구조를 개별 수정할 수 있어요)
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {MOOD_PRESETS.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setMoodId(m.id);
                          setAccentColor(m.defaultAccent);
                        }}
                        className={`p-2.5 rounded-xl border text-left transition ${
                          moodId === m.id
                            ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-500/20'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-slate-300 flex-shrink-0"
                            style={{ backgroundColor: m.bgColor }}
                          />
                          <span className="text-xs font-extrabold text-slate-900">{m.name}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 포인트 주 색상 + 워터마크(하단 문구) 켜기/끄기 */}
                <div className="pt-3 border-t border-slate-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700">포인트 주 색상</span>
                    <div className="flex items-center gap-1.5">
                      {['#2563EB', '#EC4899', '#B45309', '#10B981', '#8B5CF6', '#F59E0B', '#DC2626'].map(
                        (hex) => (
                          <button
                            key={hex}
                            type="button"
                            onClick={() => setAccentColor(hex)}
                            className={`w-6 h-6 rounded-full border-2 ${
                              accentColor.toUpperCase() === hex
                                ? 'scale-110 border-slate-900'
                                : 'border-transparent'
                            }`}
                            style={{ backgroundColor: hex }}
                          />
                        )
                      )}
                      <input
                        type="color"
                        value={accentColor}
                        onChange={(e) => setAccentColor(e.target.value)}
                        className="w-7 h-7 rounded cursor-pointer border border-slate-300"
                      />
                    </div>
                  </div>

                  {/* AUTO CARD STUDIO 워터마크 완전 제거 / 내 서명 넣기 토글 */}
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800">
                        하단 워터마크 / 계정 서명 표시
                      </span>
                      <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-bold text-blue-600">
                        <input
                          type="checkbox"
                          checked={showWatermark}
                          onChange={(e) => setShowWatermark(e.target.checked)}
                          className="w-4 h-4 accent-blue-600"
                        />
                        <span>{showWatermark ? '표시함' : '표시 안 함 (깔끔하게 제거됨)'}</span>
                      </label>
                    </div>
                    {showWatermark && (
                      <input
                        type="text"
                        placeholder="예: @my_insta_id 또는 내 브랜드 이름 입력"
                        value={watermarkText}
                        onChange={(e) => setWatermarkText(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs"
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* STEP 4: 인스타 캡션 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-extrabold text-slate-900">
                    4. 인스타 캡션 (글 + 해시태그)
                  </h2>
                  <div className="flex gap-1">
                    {CAPTION_TONES.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setCaptionTone(t.id)}
                        className={`px-2 py-1 rounded-lg text-xs font-semibold border ${
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

                {selectedAccountIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 bg-slate-100 p-1.5 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setActiveCaptionTab('base')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold ${
                        activeCaptionTab === 'base'
                          ? 'bg-white text-blue-600 shadow-sm'
                          : 'text-slate-600'
                      }`}
                    >
                      기본 공통 캡션
                    </button>
                    {selectedAccountIds.map((accId) => {
                      const acc = accounts.find((a) => a.id === accId);
                      if (!acc) return null;
                      return (
                        <button
                          key={accId}
                          type="button"
                          onClick={() => setActiveCaptionTab(accId)}
                          className={`px-3 py-1 rounded-lg text-xs font-bold ${
                            activeCaptionTab === accId
                              ? 'bg-white text-blue-600 shadow-sm'
                              : 'text-slate-600'
                          }`}
                        >
                          @{acc.username} 전용
                        </button>
                      );
                    })}
                  </div>
                )}

                <textarea
                  rows={4}
                  value={currentEditingCaption}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (activeCaptionTab === 'base') {
                      setBaseCaption(val);
                    } else {
                      setAccountCustomCaptions((prev) => ({
                        ...prev,
                        [activeCaptionTab]: val,
                      }));
                    }
                  }}
                  className="w-full rounded-xl border border-slate-300 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />

                <div className="flex items-center justify-between text-xs font-semibold">
                  <span
                    className={
                      captionLength > CAPTION_LIMITS.MAX_LENGTH ? 'text-rose-600 font-bold' : 'text-slate-600'
                    }
                  >
                    글자 수: {captionLength.toLocaleString()} / {CAPTION_LIMITS.MAX_LENGTH.toLocaleString()}자
                  </span>
                  <span
                    className={
                      hashtagCount > CAPTION_LIMITS.MAX_HASHTAGS ? 'text-rose-600 font-bold' : 'text-slate-600'
                    }
                  >
                    해시태그(#): {hashtagCount} / {CAPTION_LIMITS.MAX_HASHTAGS}개
                  </span>
                </div>
              </div>

              {/* STEP 5: 계정 고르기 & 업로드 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-4">
                <h2 className="text-base font-extrabold text-slate-900">
                  5. 올릴 인스타 계정 고르기 & 업로드
                </h2>

                {publishMode === 'download_only' ? (
                  <button
                    type="button"
                    onClick={handleServerRenderAndDownload}
                    disabled={isRenderingJpeg}
                    className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-sm"
                  >
                    {isRenderingJpeg
                      ? '서버에서 고화질 JPEG 만드는 중...'
                      : `📥 전체 ${slides.length}장 JPEG 이미지 다운로드`}
                  </button>
                ) : (
                  <>
                    {accounts.length === 0 ? (
                      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center justify-between">
                        <span>연결된 인스타 계정이 없습니다.</span>
                        <button
                          type="button"
                          onClick={() => setActiveTab('accounts')}
                          className="px-3 py-1.5 rounded-lg bg-slate-900 text-white font-bold"
                        >
                          계정 연결하러 가기 →
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
                              className={`p-3 rounded-xl border text-left flex items-center justify-between transition ${
                                isSelected
                                  ? 'border-blue-600 bg-blue-50/70 ring-2 ring-blue-500/20'
                                  : 'border-slate-200 bg-white'
                              }`}
                            >
                              <div>
                                <div className="text-sm font-bold text-slate-900">
                                  @{acc.username}
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  오늘 한도: {acc.quota_usage ?? 0}/{acc.quota_limit ?? 25}
                                </div>
                              </div>
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

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setScheduleType('now')}
                        className={`flex-1 py-2.5 rounded-xl text-xs font-bold border ${
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
                        className={`flex-1 py-2.5 rounded-xl text-xs font-bold border ${
                          scheduleType === 'scheduled'
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-700 border-slate-300'
                        }`}
                      >
                        📅 예약해서 올리기
                      </button>
                    </div>

                    {scheduleType === 'scheduled' && (
                      <input
                        type="datetime-local"
                        value={scheduledDateTime}
                        onChange={(e) => setScheduledDateTime(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm"
                      />
                    )}

                    <div className="flex flex-col sm:flex-row gap-2.5">
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
                          if (scheduleType === 'scheduled' && !scheduledDateTime) {
                            showToast('⚠️ 예약할 날짜와 시간을 선택해 주세요.');
                            return;
                          }
                          setShowConfirmModal(true);
                        }}
                        className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 text-white font-extrabold text-sm shadow-md disabled:opacity-40"
                      >
                        {scheduleType === 'scheduled'
                          ? '📅 선택한 계정에 예약 업로드하기'
                          : '🚀 선택한 인스타 계정에 지금 올리기'}
                      </button>

                      <button
                        type="button"
                        onClick={handleServerRenderAndDownload}
                        disabled={isRenderingJpeg}
                        className="px-4 py-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs"
                      >
                        {isRenderingJpeg ? '생성 중...' : '📥 JPEG 다운로드'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* 오른쪽: 실시간 인터랙티브 미리보기 + 내 맘대로 자유 편집 스튜디오 (6칸) */}
            <div className="lg:col-span-6 lg:sticky lg:top-20 space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
                {/* 슬라이드 이동 및 추가/복제/삭제 바 */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-extrabold text-slate-900">
                      실시간 미리보기 & 직접 수정 ({activeSlideIndex + 1} / {slides.length}장)
                    </h3>
                    <p className="text-xs text-blue-600 font-semibold">
                      💡 미리보기 화면 안의 글자를 직접 클릭해서 바로 타이핑할 수 있어요!
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveSlide(activeSlideIndex, -1)}
                      disabled={activeSlideIndex === 0}
                      className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold disabled:opacity-40"
                    >
                      ◀ 앞으로
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSlide(activeSlideIndex, 1)}
                      disabled={activeSlideIndex === slides.length - 1}
                      className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold disabled:opacity-40"
                    >
                      뒤로 ▶
                    </button>
                    <button
                      type="button"
                      onClick={duplicateActiveSlide}
                      className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold"
                    >
                      + 이 장 복제
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

                {/* 슬라이드 탭 선택 */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  {slides.map((s, idx) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setActiveSlideIndex(idx)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold flex-shrink-0 transition ${
                        activeSlideIndex === idx
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {idx + 1}장 ({(s.photoUrls?.length || (s.photoUrl ? 1 : 0))}사진)
                    </button>
                  ))}
                </div>

                {/* ======================================================= */}
                {/* 실제 비율 실시간 캔버스 (클릭해서 바로 글자 수정 가능!) */}
                {/* ======================================================= */}
                {activeSlide && (
                  <div
                    className={`w-full overflow-hidden shadow-inner border border-slate-200 relative flex flex-col justify-between transition-all ${
                      aspectRatio === '4:5' ? 'aspect-[4/5]' : 'aspect-square'
                    }`}
                    style={{
                      backgroundColor: effectiveBgColor,
                      fontFamily: previewCssFontFamily,
                      padding: '24px',
                    }}
                  >
                    {/* 1) 배경 꽉 찬 포스터형(full-bleed)일 때 사진 + 어둡기 오버레이 */}
                    {effectiveLayout === 'full-bleed' && activeSlidePhotos.length > 0 && (
                      <>
                        <div className="absolute inset-0 w-full h-full">
                          {renderPreviewPhotoGrid(activeSlidePhotos, true)}
                        </div>
                        <div
                          className="absolute inset-0 pointer-events-none"
                          style={{
                            backgroundColor: `rgba(10, 15, 28, ${
                              (activeSlide.overlayOpacity ?? 55) / 100
                            })`,
                          }}
                        />
                      </>
                    )}

                    {/* 상단 뱃지 & 장수 표시 */}
                    {(activeSlide.showBadge !== false || activeSlide.showSlideNumber !== false) && (
                      <div className="relative z-10 flex items-center justify-between mb-2">
                        {activeSlide.showBadge !== false ? (
                          <input
                            type="text"
                            value={activeSlide.badgeText}
                            onChange={(e) => updateActiveSlide({ badgeText: e.target.value })}
                            placeholder="뱃지 입력"
                            className="px-3 py-1 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-white/80"
                            style={{
                              backgroundColor: safeAccent,
                              color: badgeTextColor,
                              borderRadius: currentMood.id === 'pastel' ? '999px' : '6px',
                              width: `${Math.max(6, (activeSlide.badgeText?.length || 4) + 3)}ch`,
                            }}
                          />
                        ) : (
                          <div />
                        )}
                        {activeSlide.showSlideNumber !== false && slides.length > 1 && (
                          <span
                            className="text-xs font-bold"
                            style={{
                              color:
                                effectiveLayout === 'full-bleed' && activeSlidePhotos.length > 0
                                  ? '#E2E8F0'
                                  : safeSubTextColor,
                            }}
                          >
                            {activeSlideIndex + 1} / {slides.length}
                          </span>
                        )}
                      </div>
                    )}

                    {/* 본문 + 사진 배치 영역 (top-photo / bottom-photo / split-left / full-bleed) */}
                    <div
                      className={`relative z-10 flex-1 flex ${
                        effectiveLayout === 'split-left'
                          ? 'flex-row gap-3 items-stretch'
                          : effectiveLayout === 'bottom-photo'
                          ? 'flex-col-reverse justify-between'
                          : 'flex-col justify-between'
                      } min-h-0`}
                    >
                      {/* 사진 영역 (full-bleed가 아닐 때) */}
                      {effectiveLayout !== 'full-bleed' && activeSlidePhotos.length > 0 && (
                        <div
                          className={`overflow-hidden shadow-sm flex-shrink-0 ${
                            effectiveLayout === 'split-left' ? 'w-[48%] h-full' : 'w-full h-[48%] my-1'
                          }`}
                          style={{
                            borderRadius: `${Math.min(24, currentMood.borderRadius)}px`,
                            border:
                              currentMood.id === 'film'
                                ? '6px solid #FFFFFF'
                                : currentMood.id === 'cardnews'
                                ? `2px solid ${safeAccent}`
                                : 'none',
                          }}
                        >
                          {renderPreviewPhotoGrid(activeSlidePhotos, false)}
                        </div>
                      )}

                      {/* 글자 영역 (직접 클릭해서 바로 수정 가능 + 상/중/하 위치 + 좌/중/우 정렬) */}
                      <div
                        className={`flex flex-col flex-1 ${
                          activeSlide.textPosition === 'top'
                            ? 'justify-start'
                            : activeSlide.textPosition === 'bottom'
                            ? 'justify-end'
                            : 'justify-center'
                        }`}
                        style={{
                          textAlign: activeSlide.textAlign || 'left',
                          backgroundColor:
                            effectiveLayout !== 'full-bleed' &&
                            (currentMood.id === 'cardnews' ||
                              currentMood.id === 'pastel' ||
                              activeSlidePhotos.length === 0)
                              ? currentMood.cardBgColor
                              : 'transparent',
                          padding:
                            effectiveLayout !== 'full-bleed' &&
                            (currentMood.id === 'cardnews' ||
                              currentMood.id === 'pastel' ||
                              activeSlidePhotos.length === 0)
                              ? '16px'
                              : '4px',
                          borderRadius: `${Math.min(20, currentMood.borderRadius)}px`,
                        }}
                      >
                        <textarea
                          rows={2}
                          value={activeSlide.headline}
                          onChange={(e) => updateActiveSlide({ headline: e.target.value })}
                          placeholder="제목을 입력하세요"
                          className="w-full bg-transparent font-extrabold leading-snug resize-none focus:outline-none focus:ring-1 focus:ring-blue-400 rounded p-1 mb-1"
                          style={{
                            textAlign: activeSlide.textAlign || 'left',
                            fontSize: `${Math.round((activeSlide.titleSize || currentMood.titleSize) * 0.42)}px`,
                            color:
                              effectiveLayout === 'full-bleed' && activeSlidePhotos.length > 0
                                ? activeSlide.customTextColor || '#FFFFFF'
                                : safeTextColor,
                          }}
                        />
                        <textarea
                          rows={3}
                          value={activeSlide.body}
                          onChange={(e) => updateActiveSlide({ body: e.target.value })}
                          placeholder="본문을 입력하세요 (비워두면 제목만 표시됩니다)"
                          className="w-full bg-transparent leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-blue-400 rounded p-1"
                          style={{
                            textAlign: activeSlide.textAlign || 'left',
                            fontSize: `${Math.round((activeSlide.bodySize || currentMood.bodySize) * 0.44)}px`,
                            color:
                              effectiveLayout === 'full-bleed' && activeSlidePhotos.length > 0
                                ? activeSlide.customTextColor || '#E2E8F0'
                                : safeSubTextColor,
                          }}
                        />
                      </div>
                    </div>

                    {/* 하단 워터마크 (켜져 있을 때만 표시!) */}
                    {showWatermark && watermarkText && (
                      <div
                        className="relative z-10 flex items-center justify-between pt-2 mt-2 border-t text-[11px]"
                        style={{
                          borderColor:
                            currentMood.id === 'dark' ||
                            (effectiveLayout === 'full-bleed' && activeSlidePhotos.length > 0)
                              ? 'rgba(255,255,255,0.2)'
                              : '#E2E8F0',
                          color:
                            effectiveLayout === 'full-bleed' && activeSlidePhotos.length > 0
                              ? '#CBD5E1'
                              : safeSubTextColor,
                        }}
                      >
                        <span>{watermarkText}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* ======================================================= */}
                {/* 내 맘대로 세부 편집 컨트롤 패널 (디자인/사진/글씨 위치) */}
                {/* ======================================================= */}
                {activeSlide && (
                  <div className="pt-3 border-t border-slate-200 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-extrabold text-slate-900">
                        🎨 {activeSlideIndex + 1}번째 장 디자인 · 사진 · 글씨 내 맘대로 편집
                      </span>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={applyCurrentStyleToAllSlides}
                          className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold"
                        >
                          ✨ 이 디자인을 모든 장에 똑같이 적용
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRegenerateSingleSlide(activeSlideIndex)}
                          disabled={regeneratingSlideIdx === activeSlideIndex}
                          className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-bold"
                        >
                          {regeneratingSlideIdx === activeSlideIndex
                            ? '생성 중...'
                            : '🔄 AI 문구 다시 추천'}
                        </button>
                      </div>
                    </div>

                    {/* 1) 이 장에 넣을 사진 여러 장(1~4장) 고르기 + 새 사진 바로 추가 */}
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800">
                          📸 이 장에 넣을 사진 선택 (여러 장 누르면 2~4분할 콜라주로 들어갑니다!)
                        </span>
                        <label className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold cursor-pointer">
                          + 이 장에 새 사진 추가
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={(e) => handlePhotoFiles(e.target.files, true)}
                            className="hidden"
                          />
                        </label>
                      </div>

                      <div className="flex items-center gap-2 overflow-x-auto pb-1">
                        <button
                          type="button"
                          onClick={() =>
                            updateActiveSlide({
                              photoIndices: [],
                              photoUrls: [],
                              photoIndex: null,
                              photoUrl: null,
                            })
                          }
                          className={`px-3 py-2 rounded-xl text-xs font-bold border flex-shrink-0 ${
                            activeSlidePhotos.length === 0
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white text-slate-700 border-slate-300'
                          }`}
                        >
                          글만 쓰기 (사진 없음)
                        </button>

                        {uploadedPhotos.map((p, pIdx) => {
                          const selectedOrder = (activeSlide.photoIndices || []).indexOf(pIdx);
                          const isChecked =
                            selectedOrder !== -1 ||
                            (!activeSlide.photoIndices && activeSlide.photoIndex === pIdx);
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => togglePhotoInActiveSlide(pIdx)}
                              className={`relative w-14 h-14 rounded-xl overflow-hidden border-2 flex-shrink-0 transition ${
                                isChecked
                                  ? 'border-blue-600 ring-2 ring-blue-500/30'
                                  : 'border-slate-200 opacity-70 hover:opacity-100'
                              }`}
                            >
                              <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
                              {isChecked && (
                                <span className="absolute inset-0 bg-blue-600/30 flex items-center justify-center text-white font-extrabold text-xs">
                                  ✓ {selectedOrder >= 0 ? selectedOrder + 1 : 1}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {/* 사진 위치(상하좌우) · 확대/축소 · 배경 어둡기 조절 슬라이더 */}
                      {activeSlidePhotos.length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-200 text-[11px]">
                          <div>
                            <label className="text-slate-600 font-semibold block">
                              사진 좌우 위치 ({activeSlide.focusX ?? 50}%)
                            </label>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={activeSlide.focusX ?? 50}
                              onChange={(e) =>
                                updateActiveSlide({ focusX: Number(e.target.value) })
                              }
                              className="w-full accent-blue-600"
                            />
                          </div>
                          <div>
                            <label className="text-slate-600 font-semibold block">
                              사진 상하 위치 ({activeSlide.focusY ?? 50}%)
                            </label>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={activeSlide.focusY ?? 50}
                              onChange={(e) =>
                                updateActiveSlide({ focusY: Number(e.target.value) })
                              }
                              className="w-full accent-blue-600"
                            />
                          </div>
                          <div>
                            <label className="text-slate-600 font-semibold block">
                              사진 확대 ({activeSlide.photoZoom ?? 100}%)
                            </label>
                            <input
                              type="range"
                              min={100}
                              max={200}
                              value={activeSlide.photoZoom ?? 100}
                              onChange={(e) =>
                                updateActiveSlide({ photoZoom: Number(e.target.value) })
                              }
                              className="w-full accent-blue-600"
                            />
                          </div>
                          <div>
                            <label className="text-slate-600 font-semibold block">
                              배경 사진 어둡기 ({activeSlide.overlayOpacity ?? 55}%)
                            </label>
                            <input
                              type="range"
                              min={0}
                              max={85}
                              value={activeSlide.overlayOpacity ?? 55}
                              onChange={(e) =>
                                updateActiveSlide({ overlayOpacity: Number(e.target.value) })
                              }
                              className="w-full accent-blue-600"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 2) 카드 디자인 구조 & 글씨 위치(상/중/하) & 글씨 정렬(좌/중/우) */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          카드 디자인 배치 구조
                        </label>
                        <select
                          value={activeSlide.layoutType || 'auto'}
                          onChange={(e) =>
                            updateActiveSlide({ layoutType: e.target.value as SlideLayoutType })
                          }
                          className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs font-semibold"
                        >
                          <option value="auto">프리셋 기본 구조</option>
                          <option value="top-photo">사진 위 + 글씨 아래</option>
                          <option value="bottom-photo">글씨 위 + 사진 아래</option>
                          <option value="full-bleed">사진 전체 배경 + 글씨 겹침</option>
                          <option value="split-left">사진 왼쪽 + 글씨 오른쪽</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          글씨 세로 위치 (상/중/하)
                        </label>
                        <div className="grid grid-cols-3 gap-1">
                          {(
                            [
                              { id: 'top', label: '⬆️ 상단' },
                              { id: 'center', label: '⏺️ 중앙' },
                              { id: 'bottom', label: '⬇️ 하단' },
                            ] as const
                          ).map((pos) => (
                            <button
                              key={pos.id}
                              type="button"
                              onClick={() => updateActiveSlide({ textPosition: pos.id })}
                              className={`py-2 rounded-lg font-bold border text-[11px] ${
                                (activeSlide.textPosition || 'bottom') === pos.id
                                  ? 'bg-blue-600 text-white border-blue-600'
                                  : 'bg-white text-slate-700 border-slate-300'
                              }`}
                            >
                              {pos.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          글씨 가로 정렬 (좌/중/우)
                        </label>
                        <div className="grid grid-cols-3 gap-1">
                          {(
                            [
                              { id: 'left', label: '왼쪽' },
                              { id: 'center', label: '가운데' },
                              { id: 'right', label: '오른쪽' },
                            ] as const
                          ).map((align) => (
                            <button
                              key={align.id}
                              type="button"
                              onClick={() => updateActiveSlide({ textAlign: align.id })}
                              className={`py-2 rounded-lg font-bold border text-[11px] ${
                                (activeSlide.textAlign || 'left') === align.id
                                  ? 'bg-blue-600 text-white border-blue-600'
                                  : 'bg-white text-slate-700 border-slate-300'
                              }`}
                            >
                              {align.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* 3) 글자 크기 · 글자색 · 배경색 · 뱃지/번호 표시 직접 조절 */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-100 text-[11px]">
                      <div>
                        <label className="font-bold text-slate-600 block">
                          제목 글자 크기 ({activeSlide.titleSize || currentMood.titleSize}px)
                        </label>
                        <input
                          type="range"
                          min={32}
                          max={96}
                          value={activeSlide.titleSize || currentMood.titleSize}
                          onChange={(e) =>
                            updateActiveSlide({ titleSize: Number(e.target.value) })
                          }
                          className="w-full accent-blue-600"
                        />
                      </div>

                      <div>
                        <label className="font-bold text-slate-600 block">
                          본문 글자 크기 ({activeSlide.bodySize || currentMood.bodySize}px)
                        </label>
                        <input
                          type="range"
                          min={18}
                          max={52}
                          value={activeSlide.bodySize || currentMood.bodySize}
                          onChange={(e) =>
                            updateActiveSlide({ bodySize: Number(e.target.value) })
                          }
                          className="w-full accent-blue-600"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <div>
                          <label className="font-bold text-slate-600 block mb-1">글자색</label>
                          <input
                            type="color"
                            value={activeSlide.customTextColor || safeTextColor}
                            onChange={(e) =>
                              updateActiveSlide({ customTextColor: e.target.value })
                            }
                            className="w-8 h-7 rounded cursor-pointer border border-slate-300"
                          />
                        </div>
                        <div>
                          <label className="font-bold text-slate-600 block mb-1">배경색</label>
                          <input
                            type="color"
                            value={activeSlide.customBgColor || currentMood.bgColor}
                            onChange={(e) =>
                              updateActiveSlide({ customBgColor: e.target.value })
                            }
                            className="w-8 h-7 rounded cursor-pointer border border-slate-300"
                          />
                        </div>
                      </div>

                      <div className="flex flex-col justify-center gap-1">
                        <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold text-slate-700">
                          <input
                            type="checkbox"
                            checked={activeSlide.showBadge !== false}
                            onChange={(e) => updateActiveSlide({ showBadge: e.target.checked })}
                            className="accent-blue-600"
                          />
                          <span>상단 뱃지 표시</span>
                        </label>
                        <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold text-slate-700">
                          <input
                            type="checkbox"
                            checked={activeSlide.showSlideNumber !== false}
                            onChange={(e) =>
                              updateActiveSlide({ showSlideNumber: e.target.checked })
                            }
                            className="accent-blue-600"
                          />
                          <span>장수 번호(1/4) 표시</span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <section className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex items-center justify-between">
              <div>
                <h2 className="text-xl font-extrabold text-slate-900">내 게시물 업로드 · 예약 기록</h2>
                <p className="text-sm text-slate-600 mt-1">
                  예약된 게시물은 매시간 서버가 자동으로 실행하며, 실패 시 쉬운 말로 이유를 알려드리고 자동으로 한 번 다시 시도합니다.
                </p>
              </div>
              <button
                onClick={fetchPostHistory}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700"
              >
                🔄 새로고침
              </button>
            </div>

            {postHistory.length === 0 ? (
              <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center space-y-2">
                <p className="text-base font-bold text-slate-700">아직 업로드하거나 예약한 게시물이 없습니다.</p>
                <p className="text-sm text-slate-500">
                  [새 게시물 만들기] 탭에서 첫 카드뉴스를 만들어 올려보세요!
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {postHistory.map((post) => (
                  <div
                    key={post.id}
                    className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                      <div>
                        <span className="text-xs font-bold text-blue-600">
                          총 {post.slide_count}장 ({post.aspect_ratio}) · 폰트: {post.font_family}
                        </span>
                        <h3 className="text-base font-extrabold text-slate-900 mt-0.5">
                          {post.title}
                        </h3>
                      </div>
                      <span className="text-xs text-slate-400">
                        제작일: {new Date(post.created_at).toLocaleString('ko-KR')}
                      </span>
                    </div>

                    {Array.isArray(post.rendered_image_urls) && post.rendered_image_urls.length > 0 && (
                      <div className="flex gap-2 overflow-x-auto pb-2">
                        {post.rendered_image_urls.map((url, i) => (
                          <img
                            key={i}
                            src={url}
                            alt={`slide-${i + 1}`}
                            className="w-20 h-24 rounded-lg object-cover border border-slate-200 flex-shrink-0"
                          />
                        ))}
                      </div>
                    )}

                    <div className="space-y-2">
                      {(post.post_targets || []).map((target) => {
                        const statusMap = {
                          scheduled: {
                            text: '⏰ 예약 대기 중',
                            cls: 'bg-blue-50 text-blue-700 border-blue-200',
                          },
                          publishing: {
                            text: '⏳ 인스타에 올리는 중...',
                            cls: 'bg-amber-50 text-amber-700 border-amber-200',
                          },
                          published: {
                            text: '✅ 업로드 성공',
                            cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                          },
                          retry_pending: {
                            text: '🔄 일시 실패 (서버가 1회 자동 재시도 예정)',
                            cls: 'bg-amber-50 text-amber-800 border-amber-300',
                          },
                          failed: {
                            text: '❌ 업로드 실패',
                            cls: 'bg-rose-50 text-rose-700 border-rose-200',
                          },
                        };
                        const badge = statusMap[target.status] || statusMap.scheduled;

                        return (
                          <div
                            key={target.id}
                            className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-slate-900">
                                  @{target.instagram_accounts?.username || '인스타 계정'}
                                </span>
                                <span
                                  className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${badge.cls}`}
                                >
                                  {badge.text}
                                </span>
                              </div>
                              <p className="text-xs text-slate-500">
                                예약/실행 시간: {new Date(target.scheduled_at).toLocaleString('ko-KR')}
                              </p>
                              {target.error_message && (
                                <p className="text-xs font-semibold text-rose-600">
                                  사유: {target.error_message}
                                </p>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              {target.ig_permalink && (
                                <a
                                  href={target.ig_permalink}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-xs font-bold text-slate-800"
                                >
                                  🔗 인스타 게시물 보러가기
                                </a>
                              )}
                              {(target.status === 'failed' || target.status === 'retry_pending') && (
                                <button
                                  type="button"
                                  onClick={() => handleRetryPublish(target.id)}
                                  disabled={retryingTargetId === target.id}
                                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold disabled:opacity-50"
                                >
                                  {retryingTargetId === target.id ? '올리는 중...' : '🔄 지금 다시 올리기'}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {showConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-5 border border-slate-200">
            <div className="space-y-1">
              <span className="text-xs font-extrabold px-2.5 py-1 rounded-full bg-pink-50 text-pink-600">
                최종 확인 단계
              </span>
              <h3 className="text-xl font-extrabold text-slate-900">
                이 내용으로 인스타그램에 올릴까요?
              </h3>
              <p className="text-xs text-slate-500">
                확인을 누르면 서버에서 고화질 JPEG 이미지를 만들어 선택한 계정에 전송합니다.
              </p>
            </div>

            <div className="bg-slate-50 rounded-2xl p-4 space-y-2.5 text-xs border border-slate-200">
              <div className="flex justify-between">
                <span className="text-slate-500">게시물 형태</span>
                <span className="font-bold text-slate-900">
                  총 {slides.length}장 ({slides.length === 1 ? '단일 이미지' : '캐러셀 슬라이드'} · {aspectRatio})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">디자인 스타일</span>
                <span className="font-bold text-slate-900">
                  {activeCustomFont ? activeCustomFont.name : currentBuiltinFont.name} / {currentMood.name}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">업로드할 계정</span>
                <span className="font-bold text-blue-600">
                  {selectedAccountIds
                    .map((id) => `@${accounts.find((a) => a.id === id)?.username}`)
                    .join(', ')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">업로드 방식</span>
                <span className="font-bold text-slate-900">
                  {scheduleType === 'scheduled'
                    ? `예약 업로드 (${new Date(scheduledDateTime).toLocaleString('ko-KR')})`
                    : '지금 즉시 업로드'}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200">
                <span className="text-slate-500 block mb-1">첫 장 제목 미리보기</span>
                <p className="font-bold text-slate-800">{slides[0]?.headline}</p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                disabled={isPublishing}
                className="flex-1 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm"
              >
                다시 수정하기
              </button>
              <button
                type="button"
                onClick={handleExecutePublish}
                disabled={isPublishing}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 text-white font-extrabold text-sm shadow-md disabled:opacity-50"
              >
                {isPublishing ? '서버에서 JPEG 제작 및 업로드 중...' : '네, 이 내용으로 올릴게요!'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
