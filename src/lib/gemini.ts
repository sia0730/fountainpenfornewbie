// src/lib/gemini.ts
// [기능 3 & 기능 5] Gemini AI REST API를 사용해 장수별 슬라이드 내용 분할, 사진 자동 매칭, 피사체 위치 분석, 캡션 생성을 수행합니다.
import { CaptionToneId } from '@/config/constants';
import { SlideItem, SlideRole } from '@/types';

function getGeminiApiKey(): string | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your-gemini-api-key' || apiKey.startsWith('여기에_')) {
    return null;
  }
  return apiKey.trim();
}

async function callGeminiApi(parts: Array<Record<string, unknown>>): Promise<string> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
    apiKey
  )}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

function getRoleInfo(index: number, totalSlides: number): { role: SlideRole; roleLabel: string } {
  if (totalSlides === 1) {
    return { role: 'single_core', roleLabel: '핵심 한 줄' };
  }
  if (index === 0) {
    return { role: 'cover', roleLabel: '표지 (시선 집중)' };
  }
  if (index === totalSlides - 1) {
    return { role: 'cta', roleLabel: '마무리·행동 유도' };
  }
  return { role: 'body', roleLabel: `본문 ${index}` };
}

async function fetchImageAsInlinePart(url: string): Promise<Record<string, unknown> | null> {
  try {
    if (url.startsWith('data:')) {
      const [meta, base64Data] = url.split(',');
      const mimeMatch = meta.match(/data:(.*?);/);
      return {
        inline_data: {
          mime_type: mimeMatch ? mimeMatch[1] : 'image/jpeg',
          data: base64Data,
        },
      };
    }
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      inline_data: {
        mime_type: contentType,
        data: buf.toString('base64'),
      },
    };
  } catch {
    return null;
  }
}

export async function generateSlidesAndCaptionsWithAI(params: {
  rawText: string;
  slideCount: number;
  photoUrls: string[];
  captionTone: CaptionToneId;
  defaultHashtags?: string;
}): Promise<{
  slides: SlideItem[];
  caption: string;
}> {
  const { rawText, slideCount, photoUrls, captionTone, defaultHashtags = '' } = params;
  const apiKey = getGeminiApiKey();

  const toneDescription =
    captionTone === 'friendly'
      ? '친근하고 다정한 해요체와 적절한 이모지를 사용한 말투'
      : captionTone === 'professional'
      ? '신뢰감 있고 정중한 전문적인 안내 말투'
      : '짧고 굵게 핵심만 찌르는 트렌디한 말투';

  if (apiKey) {
    try {
      const imageParts: Array<Record<string, unknown>> = [];
      for (let i = 0; i < Math.min(photoUrls.length, 6); i++) {
        const part = await fetchImageAsInlinePart(photoUrls[i]);
        if (part) imageParts.push(part);
      }

      const prompt = `
당신은 인스타그램 카드뉴스 전문 에디터입니다.
사용자가 입력한 내용과 업로드한 사진(${photoUrls.length}장)을 바탕으로 정확히 ${slideCount}장의 인스타그램 슬라이드와 캡션을 JSON 형식으로 작성하세요.

[사용자 입력 내용]
${rawText || '오늘의 특별한 순간과 핵심 이야기를 소개합니다.'}

[장수 규칙 - 반드시 지킬 것]
- 총 장수: 정확히 ${slideCount}장
${
  slideCount === 1
    ? '- 1장 구성이므로 가장 강렬한 "핵심 한 줄" 요약과 짧은 보조 설명으로 작성하세요.'
    : '- 1번째 장(index 0): 호기심을 자극하는 "표지" 제목\n- 중간 장: 핵심 내용을 나누어 설명하는 "본문" (한 장에 글이 너무 많지 않게 제목 22자 이내, 본문 65자 이내)\n- 마지막 장(index ' +
      (slideCount - 1) +
      '): 저장·공유·팔로우·방문을 유도하는 "마무리·행동 유도(CTA)"'
}

[사진 배정 규칙]
- 업로드된 사진 개수: ${photoUrls.length}장 (인덱스: 0부터 ${Math.max(0, photoUrls.length - 1)}까지)
- 각 장의 내용과 가장 잘 어울리는 사진 번호(photoIndex)를 배정하세요.
- 만약 사진 개수(${photoUrls.length}장)가 슬라이드 장수(${slideCount}장)보다 적다면, 사진이 없는 장은 photoIndex를 null로 설정하여 깔끔한 '글 전용 슬라이드'로 만드세요.
- 사진 속에 인물 얼굴이나 주요 피사체가 있다면 잘리지 않도록 중심 좌표(focusX: 0~100, focusY: 0~100)와 글자가 겹치지 않는 위치(textPosition: "bottom" | "top")를 지정하세요.

[캡션 규칙]
- 말투: ${toneDescription}
- 인스타 한도(2,200자 이내), 해시태그는 10~15개 이내로 본문 끝에 포함하세요.
${defaultHashtags ? `- 필수 포함 해시태그: ${defaultHashtags}` : ''}

반드시 아래 JSON 스키마만 출력하세요 (코드블록 없이 순수 JSON):
{
  "slides": [
    {
      "badgeText": "짧은 소제목/키워드 (10자 이내)",
      "headline": "핵심 제목 (22자 이내)",
      "body": "짧고 읽기 쉬운 본문 (65자 이내)",
      "photoIndex": 0,
      "focusX": 50,
      "focusY": 40,
      "textPosition": "bottom"
    }
  ],
  "caption": "인스타그램 본문 캡션 + 해시태그"
}
`;

      const rawOutput = await callGeminiApi([...imageParts, { text: prompt }]);
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.slides) && parsed.slides.length > 0) {
          const normalizedSlides: SlideItem[] = Array.from({ length: slideCount }).map((_, idx) => {
            const item = parsed.slides[idx] || {};
            const { role, roleLabel } = getRoleInfo(idx, slideCount);
            const validPhotoIdx =
              typeof item.photoIndex === 'number' &&
              item.photoIndex >= 0 &&
              item.photoIndex < photoUrls.length
                ? item.photoIndex
                : idx < photoUrls.length
                ? idx
                : null;

            return {
              id: `slide-${Date.now()}-${idx}`,
              slideNumber: idx + 1,
              role,
              roleLabel,
              badgeText: String(item.badgeText || roleLabel).slice(0, 16),
              headline: String(item.headline || `핵심 포인트 ${idx + 1}`).slice(0, 40),
              body: String(item.body || '').slice(0, 110),
              photoIndex: validPhotoIdx,
              photoUrl: validPhotoIdx !== null ? photoUrls[validPhotoIdx] : null,
              focusX: typeof item.focusX === 'number' ? item.focusX : 50,
              focusY: typeof item.focusY === 'number' ? item.focusY : 40,
              textPosition: item.textPosition === 'top' ? 'top' : 'bottom',
            };
          });

          return {
            slides: normalizedSlides,
            caption: String(parsed.caption || '').trim(),
          };
        }
      }
    } catch (err) {
      console.error('[Gemini AI 생성 예외 발생 - 안전 폴백 작동]:', err);
    }
  }

  const lines = rawText
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const fallbackSlides: SlideItem[] = Array.from({ length: slideCount }).map((_, idx) => {
    const { role, roleLabel } = getRoleInfo(idx, slideCount);
    const validPhotoIdx = idx < photoUrls.length ? idx : null;
    const sourceLine = lines[idx] || lines[0] || '나만의 특별한 인스타그램 스토리';

    let headline = sourceLine.slice(0, 24);
    let body = sourceLine.length > 24 ? sourceLine.slice(24, 90) : '슬라이드를 넘겨 자세한 내용을 확인해 보세요.';

    if (role === 'single_core') {
      headline = sourceLine.slice(0, 28);
      body = lines.slice(1).join(' ').slice(0, 80) || '핵심 내용을 한 장에 담았습니다.';
    } else if (role === 'cover') {
      headline = sourceLine.slice(0, 24);
      body = '지금 꼭 알아야 할 핵심 내용을 정리했습니다 👉';
    } else if (role === 'cta') {
      headline = '도움이 되셨다면 저장 & 공유!';
      body = '더 많은 소식이 궁금하다면 지금 프로필을 방문하고 팔로우해 주세요.';
    }

    return {
      id: `slide-${Date.now()}-${idx}`,
      slideNumber: idx + 1,
      role,
      roleLabel,
      badgeText: role === 'cover' ? 'START' : role === 'cta' ? 'SUMMARY' : `POINT 0${idx}`,
      headline,
      body,
      photoIndex: validPhotoIdx,
      photoUrl: validPhotoIdx !== null ? photoUrls[validPhotoIdx] : null,
      focusX: 50,
      focusY: 40,
      textPosition: 'bottom',
    };
  });

  const fallbackCaption = `${rawText.slice(0, 300)}\n\n✨ 더 자세한 이야기는 이미지를 넘겨서 확인해 보세요!\n\n${
    defaultHashtags || '#인스타그램 #카드뉴스 #일상 #꿀팁 #추천'
  }`;

  return {
    slides: fallbackSlides,
    caption: fallbackCaption,
  };
}

export async function regenerateSingleSlideWithAI(params: {
  rawText: string;
  slide: SlideItem;
  totalSlides: number;
}): Promise<{ badgeText: string; headline: string; body: string }> {
  const { rawText, slide, totalSlides } = params;
  const apiKey = getGeminiApiKey();

  if (apiKey) {
    try {
      const prompt = `
전체 게시물 메모: "${rawText}"
현재 슬라이드 번호: ${slide.slideNumber} / 총 ${totalSlides}장 (역할: ${slide.roleLabel})
기존 제목: "${slide.headline}"
기존 본문: "${slide.body}"

이 슬라이드 1장만 기존과 다른 새로운 표현으로 더 매력적이고 읽기 쉽게 다시 작성해 주세요.
JSON 형식으로만 답하세요:
{
  "badgeText": "짧은 키워드(10자 이내)",
  "headline": "새 제목(22자 이내)",
  "body": "새 본문(65자 이내)"
}
`;
      const rawTextOut = await callGeminiApi([{ text: prompt }]);
      const match = rawTextOut.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return {
          badgeText: String(parsed.badgeText || slide.badgeText).slice(0, 16),
          headline: String(parsed.headline || slide.headline).slice(0, 40),
          body: String(parsed.body || slide.body).slice(0, 110),
        };
      }
    } catch (e) {
      console.error('[단일 슬라이드 재생성 폴백]:', e);
    }
  }

  return {
    badgeText: slide.badgeText,
    headline: `${slide.headline} ✨`,
    body: `${slide.body} (핵심 요약)`,
  };
}
