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
import { InstagramAccount, PostRecord, SlideItem, UploadedPhoto } from '@/types';

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

  // 상단 탭: 'create' (새 게시물 만들기) | 'accounts' (내 계정들) | 'history' (내 게시물 기록)
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
  const [fontId, setFontId] = useState<FontId>('Pretendard');
  const [moodId, setMoodId] = useState<MoodId>('minimal');
  const [accentColor, setAccentColor] = useState<string>('#2563EB');

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
  const [serverRenderedUrls, setServerRenderedUrls] = useState<string[]>([]);
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

  // 알림 토스트 헬퍼
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 5000);
  };

  // 초기 세션 확인 및 URL 파라미터(OAuth 콜백 결과) 처리
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

  // 로그인 시 내 계정 목록과 게시물 기록 불러오기
  useEffect(() => {
    if (sessionToken) {
      fetchAccounts();
      fetchPostHistory();
    }
  }, [sessionToken]);

  // 초기 기본 슬라이드 구성 생성
  useEffect(() => {
    if (slides.length === 0) {
      buildDefaultSlides(slideCount);
    }
  }, []);

  // 모드 변경 시 최대 장수 자동 조정
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
        badgeText: isSingle ? 'CORE' : isCover ? 'COVER' : isCta ? 'SAVE & SHARE' : `POINT 0${idx}`,
        headline: isSingle
          ? '오늘 꼭 기억해야 할 핵심 한 줄'
          : isCover
          ? '시선을 사로잡는 첫 장 표지 제목'
          : isCta
          ? '도움이 되셨다면 저장하고 팔로우하세요!'
          : `알기 쉽게 정리한 핵심 포인트 ${idx}`,
        body: isSingle
          ? '사진과 내용을 올리고 [AI로 자동 제작하기] 버튼을 눌러보세요.'
          : isCover
          ? '오른쪽으로 넘겨서 자세한 내용을 확인해 보세요 👉'
          : isCta
          ? '프로필 링크에서 더 많은 정보를 확인하실 수 있습니다.'
          : '한 장에 글이 너무 많지 않도록 AI가 핵심만 깔끔하게 요약해 줍니다.',
        photoIndex: photoObj ? idx : null,
        photoUrl: photoObj ? photoObj.url : null,
        focusX: 50,
        focusY: 40,
        textPosition: 'bottom',
      };
    });
    setSlides(nextSlides);
    setActiveSlideIndex(0);
    setBaseCaption(
      '✨ 오늘 준비한 카드뉴스 핵심 요약!\n이미지를 넘겨서 자세한 내용을 확인해 보세요.\n\n#인스타그램 #카드뉴스 #일상 #꿀팁 #정보공유'
    );
  }

  // 장수 변경 시 슬라이드 배열 동기화
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
          body: '이곳을 눌러 제목과 본문을 자유롭게 수정할 수 있습니다.',
          photoIndex: photoObj ? idx : null,
          photoUrl: photoObj ? photoObj.url : null,
          focusX: 50,
          focusY: 40,
          textPosition: 'bottom',
        };
      });
      return updated;
    });

    if (activeSlideIndex >= clamped) {
      setActiveSlideIndex(Math.max(0, clamped - 1));
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

  // 로그인 / 회원가입 처리
  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthLoading(true);
    setAuthMessage('');
    const supabase = getSupabaseBrowser();

    try {
      if (authMode === 'signup') {
        // Supabase 대시보드에서 이메일 인증을 끄지 않아도 즉시 가입+로그인이 되도록 서버 API 호출
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: emailInput, password: passwordInput }),
        });
        const resData = await res.json();
        if (!res.ok) {
          throw new Error(resData.error || '회원가입 실패');
        }
        // 가입 직후 자동 로그인
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

  // 사진 파일 드래그 앤 드롭 또는 파일 선택 처리
  async function handlePhotoFiles(fileList: FileList | null) {
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

      // 로그인 상태이고 Supabase가 연결되어 있으면 Storage에도 업로드 시도
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
          // 로컬 미리보기 Data URL 유지
        }
      }

      newPhotos.push({
        id: `photo-${Date.now()}-${i}`,
        url: finalUrl,
        name: file.name,
      });
    }

    const merged = [...uploadedPhotos, ...newPhotos];
    setUploadedPhotos(merged);

    // 슬라이드에 사진 자동 배정
    setSlides((prev) =>
      prev.map((s, idx) => {
        const matchedPhoto = merged[idx];
        return matchedPhoto
          ? { ...s, photoIndex: idx, photoUrl: matchedPhoto.url }
          : s;
      })
    );
    showToast(`📸 사진 ${newPhotos.length}장이 추가되었습니다!`);
  }

  // [기능 3 & 기능 5] AI로 슬라이드 전체 구성 + 캡션 자동 생성
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
        setSlides(data.slides);
        setBaseCaption(data.caption);
        setActiveSlideIndex(0);
        setServerRenderedUrls([]);
        showToast('✨ AI가 장수에 맞춰 카드뉴스와 캡션을 완성했습니다!');
      } else {
        // 데모 모드에서도 즉시 동작
        buildDefaultSlides(slideCount);
        showToast('✨ 슬라이드 초안이 생성되었습니다! (로그인 시 Gemini AI가 작동합니다)');
      }
    } catch (err) {
      showToast(`⚠️ ${err instanceof Error ? err.message : 'AI 생성 중 오류 발생'}`);
    } finally {
      setIsGeneratingAI(false);
    }
  }

  // [기능 3] "이 장만 다시 만들기" 버튼
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
      } else {
        setSlides((prev) =>
          prev.map((s, i) =>
            i === idx
              ? {
                  ...s,
                  headline: `${s.headline} (새 버전 ✨)`,
                }
              : s
          )
        );
      }
    } catch (err) {
      showToast(`⚠️ ${err instanceof Error ? err.message : '이 장만 다시 만들기 실패'}`);
    } finally {
      setRegeneratingSlideIdx(null);
    }
  }

  // 슬라이드 순서 바꾸기 (앞/뒤 이동)
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

  // 슬라이드 지우기
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

  // 서버(satori + sharp)에서 실제 JPEG 이미지 생성 및 다운로드
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
            moodId,
            accentColor,
            uploadToStorage: false,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setServerRenderedUrls(data.renderedUrls || []);

        // 각 장을 JPEG 파일로 즉시 다운로드
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

  // 계정 선택 토글 (계정의 기본 폰트/분위기/해시태그도 편리하게 적용 가능)
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
      const next = exists ? prev.filter((id) => id !== acc.id) : [...prev, acc.id];
      return next;
    });

    if (!accountCustomCaptions[acc.id]) {
      setAccountCustomCaptions((prev) => ({
        ...prev,
        [acc.id]: `${baseCaption}\n${acc.default_hashtags || ''}`.trim(),
      }));
    }
  }

  // 최종 업로드 또는 예약 실행 ("이 내용으로 올릴까요?" 모달에서 확인 클릭 시)
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
          moodId,
          accentColor,
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

  // 실패한 게시물 다시 올리기
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

  // 현재 선택된 폰트 & 분위기 프리셋 계산
  const currentFont = useMemo(
    () => KOREAN_FONTS.find((f) => f.id === fontId) || KOREAN_FONTS[0],
    [fontId]
  );
  const currentMood = useMemo(
    () => MOOD_PRESETS.find((m) => m.id === moodId) || MOOD_PRESETS[0],
    [moodId]
  );
  const activeSlide = slides[activeSlideIndex] || slides[0];

  // 명도 대비 자동 조정된 색상값
  const safeTextColor = ensureReadableColor(currentMood.textColor, currentMood.bgColor, 4.5);
  const safeSubTextColor = ensureReadableColor(currentMood.subTextColor, currentMood.bgColor, 3.5);
  const safeAccent = ensureReadableColor(accentColor, currentMood.bgColor, 2.8);
  const badgeTextColor = getReadableTextOnAccent(safeAccent);

  // 현재 편집 중인 캡션의 글자 수 및 해시태그 개수 검증
  const currentEditingCaption =
    activeCaptionTab === 'base'
      ? baseCaption
      : accountCustomCaptions[activeCaptionTab] ?? baseCaption;
  const captionLength = currentEditingCaption.length;
  const hashtagCount = countHashtags(currentEditingCaption);
  const isCaptionOverLimit =
    captionLength > CAPTION_LIMITS.MAX_LENGTH || hashtagCount > CAPTION_LIMITS.MAX_HASHTAGS;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* 상단 고정 네비게이션 바 */}
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
                사진과 글만 올리면 카드뉴스 제작부터 인스타 예약 업로드까지 한 번에
              </p>
            </div>
          </div>

          {/* 화면 전환 탭 (모바일 & 데스크톱 공용) */}
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

          {/* 우측 로그인 상태 표시 */}
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

      {/* 상단 알림 토스트 */}
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
        {/* [화면 1] 로그인 / 회원가입 배너 (로그인하지 않은 경우 상단에 친절하게 표시) */}
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

        {/* ========================================================= */}
        {/* [화면 2] 내 계정들: 인스타 계정 연결·해제·상태 보기 & 기본 설정 */}
        {/* ========================================================= */}
        {activeTab === 'accounts' && (
          <section className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-extrabold text-slate-900">
                  연결된 내 인스타그램 계정 ({accounts.length} / {MAX_IG_ACCOUNTS}개)
                </h2>
                <p className="text-sm text-slate-600 mt-1">
                  복잡한 토큰 복사 없이 [인스타 계정 추가] 버튼만 누르면 공식 인스타그램 로그인으로 안전하게 연결됩니다.
                  <br />
                  저장된 토큰은 암호화되며, 만료 15일 전에 서버가 자동으로 연장합니다.
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

                      {/* 계정별 기본 폰트, 분위기, 주 색상, 해시태그 묶음 설정창 */}
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
                              기본 해시태그 묶음 (게시물 올릴 때 자동으로 붙습니다)
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

        {/* ========================================================= */}
        {/* [화면 3] 새 게시물 만들기 (올인원 워크플로우) */}
        {/* ========================================================= */}
        {activeTab === 'create' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* 좌측 설정 영역 (7칸) */}
            <div className="lg:col-span-7 space-y-6">
              {/* STEP 1: 사진 + 내용 올리기 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base sm:text-lg font-extrabold text-slate-900">
                    1. 사진과 내용 올리기
                  </h2>
                  <span className="text-xs text-slate-500">
                    AI가 사진을 새로 그리지 않고 올린 원본 사진만 안전하게 씁니다
                  </span>
                </div>

                {/* 드래그 앤 드롭 사진 업로드 박s */}
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
                  className={`flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-6 cursor-pointer transition ${
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
                    여기에 사진 여러 장을 마우스로 끌어다 놓거나 눌러서 선택하세요
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    사진이 장수보다 모자라도 괜찮아요! 사진이 없는 장은 깔끔한 글 전용 카드로 만들어집니다.
                  </p>
                </label>

                {/* 업로드된 사진 썸네일 리스트 */}
                {uploadedPhotos.length > 0 && (
                  <div className="flex items-center gap-3 overflow-x-auto pb-2">
                    {uploadedPhotos.map((p, idx) => (
                      <div
                        key={p.id}
                        className="relative w-20 h-20 rounded-xl overflow-hidden border border-slate-200 flex-shrink-0 group"
                      >
                        <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
                        <span className="absolute top-1 left-1 bg-black/70 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                          사진 {idx + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setUploadedPhotos((prev) => prev.filter((item) => item.id !== p.id))
                          }
                          className="absolute top-1 right-1 bg-rose-600 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center opacity-90 hover:opacity-100"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* 글 / 메모 입력칸 */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    게시물에 들어갈 내용 (긴 글을 그대로 붙여넣거나 간단한 메모만 적어도 됩니다)
                  </label>
                  <textarea
                    rows={4}
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    placeholder="예: 오늘 새로 출시한 봄 시즌 딸기 케이크 소개! 100% 국내산 설향 딸기만 사용하고 동물성 생크림으로 만들었어요. 이번 주 금요일까지 방문 포장 10% 할인 이벤트 진행합니다."
                    className="w-full rounded-xl border border-slate-300 p-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* STEP 2: 게시물 장수 & 비율 고르기 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h2 className="text-base sm:text-lg font-extrabold text-slate-900">
                    2. 게시물 장수 고르기
                  </h2>
                  {/* 자동 업로드 모드(최대 10장) vs 다운로드 전용(최대 20장) */}
                  <div className="inline-flex rounded-xl bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => setPublishMode('auto_publish')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                        publishMode === 'auto_publish'
                          ? 'bg-white text-blue-600 shadow-sm'
                          : 'text-slate-600'
                      }`}
                    >
                      인스타 자동 업로드 (최대 {MAX_SLIDES.AUTO_PUBLISH}장)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPublishMode('download_only')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                        publishMode === 'download_only'
                          ? 'bg-white text-blue-600 shadow-sm'
                          : 'text-slate-600'
                      }`}
                    >
                      이미지 다운로드 전용 (최대 {MAX_SLIDES.DOWNLOAD_ONLY}장)
                    </button>
                  </div>
                </div>

                {/* 슬라이더 + 숫자 버튼 */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-800">
                      선택한 장수:{' '}
                      <strong className="text-blue-600 text-base">{slideCount}장</strong>{' '}
                      <span className="text-xs font-normal text-slate-500">
                        ({slideCount === 1 ? '단일 이미지 게시물' : '여러 장 넘겨보는 캐러셀 게시물'})
                      </span>
                    </span>
                    <span className="text-xs text-slate-500">
                      {slideCount === 1
                        ? '구성: 핵심 한 줄 요약'
                        : '구성: 첫 장(표지) → 중간(본문) → 마지막 장(마무리·행동 유도)'}
                    </span>
                  </div>

                  <input
                    type="range"
                    min={1}
                    max={maxSlideLimit}
                    value={slideCount}
                    onChange={(e) => handleSlideCountChange(Number(e.target.value))}
                    className="w-full accent-blue-600 cursor-pointer"
                  />

                  <div className="flex flex-wrap gap-1.5">
                    {Array.from({ length: maxSlideLimit }).map((_, i) => {
                      const num = i + 1;
                      return (
                        <button
                          key={num}
                          type="button"
                          onClick={() => handleSlideCountChange(num)}
                          className={`w-9 h-9 rounded-lg text-xs font-bold border transition ${
                            slideCount === num
                              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                              : 'bg-white text-slate-700 border-slate-200 hover:border-blue-400'
                          }`}
                        >
                          {num}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 비율 선택 (기본 4:5, 한 게시물 내 모든 장 동일 비율) */}
                <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <span className="text-xs font-bold text-slate-700">
                    슬라이드 비율 (한 게시물 안의 모든 장은 같은 비율로 만들어집니다)
                  </span>
                  <div className="flex gap-2">
                    {(Object.keys(ASPECT_RATIOS) as AspectRatioKey[]).map((ratioKey) => (
                      <button
                        key={ratioKey}
                        type="button"
                        onClick={() => setAspectRatio(ratioKey)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                          aspectRatio === ratioKey
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-700 border-slate-300'
                        }`}
                      >
                        {ASPECT_RATIOS[ratioKey].label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* AI 자동 제작 실행 버튼 */}
                <button
                  type="button"
                  onClick={handleGenerateWithAI}
                  disabled={isGeneratingAI}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold text-sm shadow-md transition disabled:opacity-50"
                >
                  {isGeneratingAI
                    ? '🤖 Gemini AI가 내용을 나누고 어울리는 사진을 배치하는 중...'
                    : `✨ AI로 ${slideCount}장 카드뉴스 + 캡션 자동 제작하기`}
                </button>
              </div>

              {/* STEP 3: 폰트와 분위기 고르기 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-5">
                <h2 className="text-base sm:text-lg font-extrabold text-slate-900">
                  3. 폰트와 분위기 고르기 (누르면 오른쪽 미리보기가 바로 바뀝니다)
                </h2>

                {/* 한국어 무료 상업용 폰트 6종 */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-2">
                    글꼴 (상업적 무료 한글 폰트 6종)
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {KOREAN_FONTS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFontId(f.id)}
                        style={{ fontFamily: f.cssFamily }}
                        className={`p-3 rounded-xl border text-left transition ${
                          fontId === f.id
                            ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-500/20'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="text-sm font-bold text-slate-900">{f.name}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{f.description}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 분위기 프리셋 6종 */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-2">
                    분위기 프리셋 6종 (색상 · 여백 · 글자 크기 · 사진 배치가 각각 달라집니다)
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {MOOD_PRESETS.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setMoodId(m.id);
                          setAccentColor(m.defaultAccent);
                        }}
                        className={`p-3 rounded-xl border text-left transition ${
                          moodId === m.id
                            ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-500/20'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="w-4 h-4 rounded-full border border-slate-300 flex-shrink-0"
                            style={{ backgroundColor: m.bgColor }}
                          />
                          <span className="text-xs font-extrabold text-slate-900">{m.name}</span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">{m.description}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 포인트 주 색상 직접 고르기 + 명도 대비 자동 보정 안내 */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100">
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">
                      포인트 주 색상 직접 고르기
                    </span>
                    <span className="text-[11px] text-slate-500">
                      글자와 배경의 색 차이가 너무 작으면 자동으로 읽기 쉽게 보정됩니다.
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {['#2563EB', '#EC4899', '#B45309', '#10B981', '#8B5CF6', '#F59E0B', '#DC2626'].map(
                      (hex) => (
                        <button
                          key={hex}
                          type="button"
                          onClick={() => setAccentColor(hex)}
                          className={`w-7 h-7 rounded-full border-2 transition ${
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
                      className="w-8 h-8 rounded cursor-pointer border border-slate-300"
                    />
                  </div>
                </div>
              </div>

              {/* STEP 4: 인스타 캡션 & 해시태그 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h2 className="text-base sm:text-lg font-extrabold text-slate-900">
                    4. 인스타 캡션 (글 + 해시태그)
                  </h2>
                  {/* 말투 선택 */}
                  <div className="flex gap-1.5">
                    {CAPTION_TONES.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setCaptionTone(t.id)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${
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

                {/* 계정을 여러 개 골랐을 때 계정별로 캡션을 따로 고칠 수 있는 탭 */}
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
                          @{acc.username} 전용 캡션
                        </button>
                      );
                    })}
                  </div>
                )}

                <textarea
                  rows={5}
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
                  className="w-full rounded-xl border border-slate-300 p-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />

                {/* 글자 수 (2,200자) 및 해시태그 개수 (30개) 실시간 카운터 */}
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

                {isCaptionOverLimit && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700">
                    ⚠️ 인스타그램 캡션 한도(2,200자 또는 해시태그 30개)를 초과했습니다. 글자 수나 해시태그를 줄여야 업로드할 수 있습니다.
                  </div>
                )}
              </div>

              {/* STEP 5: 올릴 인스타 계정 고르기 & 지금 올리기 / 예약 올리기 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-5">
                <h2 className="text-base sm:text-lg font-extrabold text-slate-900">
                  5. 올릴 인스타 계정 고르기 & 업로드
                </h2>

                {publishMode === 'download_only' ? (
                  <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 space-y-3">
                    <p className="text-xs font-bold text-blue-900">
                      현재 [이미지 다운로드 전용 (최대 20장)] 모드입니다. 아래 버튼을 눌러 고화질 JPEG 파일로 내려받아 인스타 앱에서 직접 올려보세요!
                    </p>
                    <button
                      type="button"
                      onClick={handleServerRenderAndDownload}
                      disabled={isRenderingJpeg}
                      className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-sm"
                    >
                      {isRenderingJpeg
                        ? '서버에서 고화질 JPEG 만드는 중...'
                        : `📥 전체 ${slides.length}장 JPEG 이미지 다운로드`}
                    </button>
                  </div>
                ) : (
                  <>
                    {/* 연결된 계정 체크박스 리스트 */}
                    {accounts.length === 0 ? (
                      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center justify-between">
                        <span>연결된 인스타 계정이 없습니다. 먼저 계정을 연결해 주세요.</span>
                        <button
                          type="button"
                          onClick={() => setActiveTab('accounts')}
                          className="px-3 py-1.5 rounded-lg bg-slate-900 text-white font-bold"
                        >
                          계정 연결하러 가기 →
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
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
                                  : 'border-slate-200 bg-white hover:border-slate-300'
                              }`}
                            >
                              <div>
                                <div className="text-sm font-bold text-slate-900">
                                  @{acc.username}
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  오늘 한도: {acc.quota_usage ?? 0}/{acc.quota_limit ?? 25} · 상태:{' '}
                                  {acc.status === 'active' ? '정상' : '확인 필요'}
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

                    {/* 지금 올리기 / 예약해서 올리기 선택 */}
                    <div className="space-y-3 pt-2 border-t border-slate-100">
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
                          📅 예약해서 올리기 (날짜·시간 지정)
                        </button>
                      </div>

                      {scheduleType === 'scheduled' && (
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">
                            예약 날짜와 시간 고르기 (컴퓨터를 꺼두어도 서버가 자동으로 올려줍니다)
                          </label>
                          <input
                            type="datetime-local"
                            value={scheduledDateTime}
                            onChange={(e) => setScheduledDateTime(e.target.value)}
                            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm"
                          />
                        </div>
                      )}
                    </div>

                    {/* 최종 업로드 확인창 열기 버튼 + JPEG 다운로드 버튼 */}
                    <div className="flex flex-col sm:flex-row gap-3 pt-2">
                      <button
                        type="button"
                        disabled={isCaptionOverLimit}
                        onClick={() => {
                          if (!sessionToken) {
                            showToast('⚠️ 인스타에 업로드하려면 먼저 로그인해 주세요.');
                            return;
                          }
                          if (selectedAccountIds.length === 0) {
                            showToast('⚠️ 게시물을 올릴 인스타그램 계정을 1개 이상 선택해 주세요.');
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
                        {isRenderingJpeg ? 'JPEG 생성 중...' : '📥 JPEG 파일만 다운로드'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* 우측 실시간 미리보기 & 슬라이드 직접 수정 패널 (5칸, 스크롤 고정) */}
            <div className="lg:col-span-5 lg:sticky lg:top-20 space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-extrabold text-slate-900">
                      실시간 카드뉴스 미리보기 ({activeSlideIndex + 1} / {slides.length}장)
                    </h3>
                    <p className="text-xs text-slate-500">
                      역할: <strong className="text-blue-600">{activeSlide?.roleLabel}</strong>
                    </p>
                  </div>

                  {/* 장 순서 바꾸기 & 장 지우기 버튼 */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveSlide(activeSlideIndex, -1)}
                      disabled={activeSlideIndex === 0}
                      title="앞 장으로 순서 이동"
                      className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold disabled:opacity-40"
                    >
                      ◀ 순서 앞으로
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSlide(activeSlideIndex, 1)}
                      disabled={activeSlideIndex === slides.length - 1}
                      title="뒤 장으로 순서 이동"
                      className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold disabled:opacity-40"
                    >
                      순서 뒤로 ▶
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSlide(activeSlideIndex)}
                      className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold"
                    >
                      이 장 지우기
                    </button>
                  </div>
                </div>

                {/* 실제 비율(4:5 또는 1:1) 실시간 캔버스 미리보기 */}
                {activeSlide && (
                  <div
                    className={`w-full overflow-hidden shadow-inner border border-slate-200 relative flex flex-col justify-between transition-all ${
                      aspectRatio === '4:5' ? 'aspect-[4/5]' : 'aspect-square'
                    }`}
                    style={{
                      backgroundColor: currentMood.bgColor,
                      fontFamily: currentFont.cssFamily,
                      padding: '24px',
                    }}
                  >
                    {/* 포스터형(full-bleed)이고 사진이 있을 때 배경 렌더링 */}
                    {currentMood.photoLayout === 'full-bleed' && activeSlide.photoUrl && (
                      <>
                        <img
                          src={activeSlide.photoUrl}
                          alt="slide background"
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                        <div
                          className="absolute inset-0"
                          style={{
                            background:
                              'linear-gradient(180deg, rgba(10,15,28,0.2) 0%, rgba(10,15,28,0.68) 55%, rgba(10,15,28,0.95) 100%)',
                          }}
                        />
                      </>
                    )}

                    {/* 상단 뱃지 & 페이지 번호 */}
                    <div className="relative z-10 flex items-center justify-between">
                      <span
                        className="px-3 py-1 text-xs font-bold"
                        style={{
                          backgroundColor: safeAccent,
                          color: badgeTextColor,
                          borderRadius: currentMood.id === 'pastel' ? '999px' : '6px',
                        }}
                      >
                        {activeSlide.badgeText || activeSlide.roleLabel}
                      </span>
                      <span
                        className="text-xs font-bold"
                        style={{
                          color:
                            currentMood.photoLayout === 'full-bleed' && activeSlide.photoUrl
                              ? '#E2E8F0'
                              : safeSubTextColor,
                        }}
                      >
                        {slides.length > 1 ? `${activeSlideIndex + 1} / ${slides.length}` : ''}
                      </span>
                    </div>

                    {/* 중단 사진 액자 (full-bleed가 아닐 때) */}
                    {currentMood.photoLayout !== 'full-bleed' && activeSlide.photoUrl && (
                      <div
                        className="relative z-10 w-full h-[46%] overflow-hidden my-2 shadow-sm"
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
                        <img
                          src={activeSlide.photoUrl}
                          alt="slide"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}

                    {/* 하단 텍스트 영역 */}
                    <div
                      className="relative z-10 flex flex-col justify-center"
                      style={{
                        backgroundColor:
                          currentMood.photoLayout !== 'full-bleed' &&
                          (currentMood.id === 'cardnews' ||
                            currentMood.id === 'pastel' ||
                            !activeSlide.photoUrl)
                            ? currentMood.cardBgColor
                            : 'transparent',
                        padding:
                          currentMood.photoLayout !== 'full-bleed' &&
                          (currentMood.id === 'cardnews' ||
                            currentMood.id === 'pastel' ||
                            !activeSlide.photoUrl)
                            ? '18px'
                            : '4px',
                        borderRadius: `${Math.min(20, currentMood.borderRadius)}px`,
                      }}
                    >
                      <h4
                        className="font-extrabold leading-snug break-keep mb-2"
                        style={{
                          fontSize: activeSlide.photoUrl ? '1.35rem' : '1.6rem',
                          color:
                            currentMood.photoLayout === 'full-bleed' && activeSlide.photoUrl
                              ? '#FFFFFF'
                              : safeTextColor,
                        }}
                      >
                        {activeSlide.headline}
                      </h4>
                      <p
                        className="text-xs sm:text-sm leading-relaxed break-keep"
                        style={{
                          color:
                            currentMood.photoLayout === 'full-bleed' && activeSlide.photoUrl
                              ? '#E2E8F0'
                              : safeSubTextColor,
                        }}
                      >
                        {activeSlide.body}
                      </p>
                    </div>

                    {/* 바닥글 */}
                    <div
                      className="relative z-10 flex items-center justify-between pt-2 border-t text-[11px]"
                      style={{
                        borderColor:
                          currentMood.id === 'dark' ||
                          (currentMood.photoLayout === 'full-bleed' && activeSlide.photoUrl)
                            ? 'rgba(255,255,255,0.2)'
                            : '#E2E8F0',
                        color:
                          currentMood.photoLayout === 'full-bleed' && activeSlide.photoUrl
                            ? '#CBD5E1'
                            : safeSubTextColor,
                      }}
                    >
                      <span>AUTO CARD STUDIO</span>
                      <span>{activeSlide.role === 'cta' ? '저장 & 공유 ♥' : ''}</span>
                    </div>
                  </div>
                )}

                {/* 슬라이드 페이지네이션 버튼 */}
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
                      {idx + 1}장 ({s.role === 'cover' ? '표지' : s.role === 'cta' ? '마무리' : '본문'})
                    </button>
                  ))}
                </div>

                {/* [기능 3] 현재 슬라이드 직접 수정 & "이 장만 다시 만들기" */}
                {activeSlide && (
                  <div className="pt-3 border-t border-slate-100 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-slate-800">
                        ✏️ {activeSlideIndex + 1}번째 장 직접 고치기
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRegenerateSingleSlide(activeSlideIndex)}
                        disabled={regeneratingSlideIdx === activeSlideIndex}
                        className="px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold"
                      >
                        {regeneratingSlideIdx === activeSlideIndex
                          ? '다시 만드는 중...'
                          : '🔄 이 장만 다시 만들기 (AI)'}
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="col-span-1">
                        <label className="block text-[11px] text-slate-500 mb-1">상단 뱃지</label>
                        <input
                          type="text"
                          value={activeSlide.badgeText}
                          onChange={(e) =>
                            setSlides((prev) =>
                              prev.map((s, i) =>
                                i === activeSlideIndex ? { ...s, badgeText: e.target.value } : s
                              )
                            )
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-[11px] text-slate-500 mb-1">
                          이 장에 넣을 사진 바꾸기
                        </label>
                        <select
                          value={activeSlide.photoIndex === null ? 'none' : activeSlide.photoIndex}
                          onChange={(e) => {
                            const val = e.target.value;
                            const nextIdx = val === 'none' ? null : Number(val);
                            const nextUrl =
                              nextIdx !== null && uploadedPhotos[nextIdx]
                                ? uploadedPhotos[nextIdx].url
                                : null;
                            setSlides((prev) =>
                              prev.map((s, i) =>
                                i === activeSlideIndex
                                  ? { ...s, photoIndex: nextIdx, photoUrl: nextUrl }
                                  : s
                              )
                            );
                          }}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
                        >
                          <option value="none">글만 있는 장 (사진 없음)</option>
                          {uploadedPhotos.map((p, pIdx) => (
                            <option key={p.id} value={pIdx}>
                              사진 {pIdx + 1} ({p.name.slice(0, 15)})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">제목 (Headline)</label>
                      <input
                        type="text"
                        value={activeSlide.headline}
                        onChange={(e) =>
                          setSlides((prev) =>
                            prev.map((s, i) =>
                              i === activeSlideIndex ? { ...s, headline: e.target.value } : s
                            )
                          )
                        }
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">본문 (Body)</label>
                      <textarea
                        rows={2}
                        value={activeSlide.body}
                        onChange={(e) =>
                          setSlides((prev) =>
                            prev.map((s, i) =>
                              i === activeSlideIndex ? { ...s, body: e.target.value } : s
                            )
                          )
                        }
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* [화면 4] 내 게시물 기록: 만든 게시물, 올린 계정, 상태, 인스타 링크, 다시 올리기 */}
        {/* ========================================================= */}
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

                    {/* 렌더링된 JPEG 미리보기 썸네일 */}
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

                    {/* 계정별 업로드 상태 리스트 */}
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

      {/* ========================================================= */}
      {/* [지켜야 할 것] 업로드 전 "이 내용으로 올릴까요?" 최종 확인 모달 */}
      {/* ========================================================= */}
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
                  {currentFont.name} / {currentMood.name}
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
