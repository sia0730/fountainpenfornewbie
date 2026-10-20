// src/lib/gemini.ts
// Gemini AI REST API를 사용해
// 1) 주제 기반 컷별 기획안(JSON) 자동 생성 (표지 후보 3개, 추천 장수·이유, 컷별 제목·본문·사진 글·사진 가이드)
// 2) JSON 파싱 실패 시 1회 자동 재시도
// 3) 단일 컷 다시 쓰기 및 슬라이드/캡션 생성을 수행합니다.
import { CaptionToneId } from '@/config/constants';
import { SlideItem, SlideRole } from '@/types';

export type PlanCutRoleLabel =
  | '표지'
  | '공감'
  | '핵심 정보'
  | '예시'
  | '요약'
  | '마무리·행동 유도';

export interface PlanCutItem {
  id: string;
  slideNumber: number;
  roleType: PlanCutRoleLabel;
  headline: string; // 제목 (15자 안팎 권장)
  body: string; // 짧은 본문 (2~3줄)
  photoOverlayText: string; // 사진에 들어갈 글 (사진 위에 얹는 한두 줄 문구)
  photoGuide: string; // 이 컷에 어울리는 사진 가이드
  isManuallyEdited?: boolean;
}

export interface AIPlanDocument {
  id: string;
  versionLabel: string;
  topic: string;
  targetAudience: string;
  purpose: string;
  tone: CaptionToneId;
  referenceText: string;
  coverTitleCandidates: [string, string, string];
  selectedCoverIndex: number;
  recommendedSlideCount: number;
  recommendationReason: string;
  cuts: PlanCutItem[];
  captionDraft: string;
  createdAt: string;
}

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

function getDefaultCutRoleLabel(idx: number, total: number): PlanCutRoleLabel {
  if (idx === 0) return '표지';
  if (idx === total - 1) return '마무리·행동 유도';
  if (idx === 1) return '공감';
  if (idx === total - 2 && total >= 5) return '요약';
  if (idx % 2 === 1) return '예시';
  return '핵심 정보';
}

// ============================================================================
// [1단계 핵심] 주제 → 컷별 기획안(JSON) 생성 (JSON 깨지면 1회 자동 재시도 포함)
// ============================================================================
export async function generateCardNewsPlanWithAI(params: {
  topic: string;
  targetAudience?: string;
  purpose?: string;
  tone?: CaptionToneId;
  referenceText?: string;
  requestedSlideCount?: number | 'auto';
  variationIndex?: number;
  maxAllowedSlides?: number;
}): Promise<AIPlanDocument> {
  const {
    topic,
    targetAudience = '',
    purpose = '',
    tone = 'friendly',
    referenceText = '',
    requestedSlideCount = 'auto',
    variationIndex = 1,
    maxAllowedSlides = 10,
  } = params;

  const cleanTopic = topic.trim() || '오늘의 인스타그램 추천 이야기';
  const apiKey = getGeminiApiKey();

  const toneDesc =
    tone === 'friendly'
      ? '친근하고 다정한 해요체 (쉬운 일상 대화체)'
      : tone === 'professional'
      ? '신뢰감 있고 깔끔한 전문가 설명 말투 (어려운 전문용어는 쉬운 말로 풀어서)'
      : '짧고 굵게 핵심만 전달하는 임팩트 있는 말투';

  const countInstruction =
    requestedSlideCount === 'auto' || !requestedSlideCount
      ? `주제의 깊이에 맞춰 4장~7장 사이에서 가장 효과적인 장수(recommendedSlideCount)를 추천하고 그 이유(recommendationReason)를 적어주세요.`
      : `총 장수(recommendedSlideCount)는 정확히 ${Math.min(
          Number(requestedSlideCount),
          maxAllowedSlides
        )}장으로 구성하고, 이 장수가 좋은 이유(recommendationReason)를 적어주세요.`;

  const variationHint =
    variationIndex === 2
      ? '이번 기획안(버전 2)은 독자의 호기심과 질문("왜 그럴까?")으로 시작하는 스토리텔링 방식으로 구성해 주세요.'
      : variationIndex === 3
      ? '이번 기획안(버전 3)은 핵심 숫자와 체크리스트 중심의 실용적인 요약 방식으로 구성해 주세요.'
      : '이번 기획안(버전 1)은 가장 대중적이고 공감하기 쉬운 정석 카드뉴스 구조로 구성해 주세요.';

  const buildPrompt = (strictRetry = false) => `
당신은 인스타그램 카드뉴스 수석 기획자입니다.
사용자가 입력한 주제를 바탕으로 카드뉴스 기획안을 JSON 형식으로 작성하세요.
${strictRetry ? '주의: 반드시 마크다운 코드블록(```)이나 부연 설명 없이 순수 JSON 객체만 출력하세요!' : ''}

[입력 정보]
- 주제(필수): ${cleanTopic}
- 보여줄 대상(선택): ${targetAudience || '인스타그램 일반 사용자 (AI가 주제에 맞게 자동 설정)'}
- 목적(선택): ${purpose || '정보 전달 및 공감'}
- 말투: ${toneDesc}
- 참고 자료(선택): ${referenceText || '없음'}
- 장수 설정: ${countInstruction}
- 기획 방향: ${variationHint}

[반드시 지켜야 할 기획 및 안전 규칙]
1. 표지 제목 후보 3개(coverTitleCandidates)를 눈길을 끄는 순서대로 3개 작성하세요.
2. 한 장에 글이 많지 않게 하세요:
   - 제목(headline): 15자 안팎 (최대 22자 이내)
   - 짧은 본문(body): 2~3줄 이내 (45~75자 안팎)
   - 사진에 들어갈 글(photoOverlayText): 사진 위에 얹을 짧고 강렬한 한두 줄 문구 (15~28자 안팎)
   - 사진 가이드(photoGuide): 사용자가 어떤 사진을 넣으면 좋을지 구체적이고 쉬운 가이드 (예: "제품을 손에 든 밝은 클로즈업 사진", "따뜻한 조명의 카페 창가 자리 사진")
3. 각 컷의 역할(roleType)은 다음 6가지 중 하나로 지정하세요:
   "표지", "공감", "핵심 정보", "예시", "요약", "마무리·행동 유도"
4. 마지막 장은 반드시 저장, 공유, 댓글, 팔로우 등 "마무리·행동 유도"로 끝내세요.
5. 어려운 한자어나 전문용어 대신 초보자도 바로 이해하는 쉬운 말만 쓰세요.
6. 과장 광고("100% 무조건", "세상에서 제일"), 근거 없는 효과 주장, 의료·금융 단정 표현("완치 보장", "무조건 수익", "원금 보장")은 절대 쓰지 마세요.
7. 캡션 초안(captionDraft)의 첫 줄은 눈길을 끄는 한 줄로 시작하고, 끝에 주제에 맞는 해시태그 8~12개를 붙이세요.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "coverTitleCandidates": [
    "눈길을 사로잡는 표지 제목 후보 1 (15자 안팎)",
    "호기심을 자극하는 표지 제목 후보 2 (15자 안팎)",
    "핵심 혜택을 강조한 표지 제목 후보 3 (15자 안팎)"
  ],
  "recommendedSlideCount": 5,
  "recommendationReason": "이 주제는 5장으로 구성할 때 표지-공감-핵심 2가지-마무리 흐름이 가장 매끄럽고 끝까지 읽히기 좋습니다.",
  "cuts": [
    {
      "slideNumber": 1,
      "roleType": "표지",
      "headline": "15자 안팎의 표지 제목",
      "body": "오른쪽으로 넘겨서 핵심 내용을 바로 확인해 보세요!",
      "photoOverlayText": "사진 위에 얹을 한 줄 핵심 문구",
      "photoGuide": "주제를 가장 잘 보여주는 대표 사진이나 밝은 배경 사진"
    }
  ],
  "captionDraft": "첫 줄 시선 집중 문구\\n\\n본문 요약 설명\\n\\n#해시태그1 #해시태그2"
}
`;

  if (apiKey) {
    // 최대 2회 시도 (첫 시도 JSON 파싱 실패 시 자동으로 1회 재시도!)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const rawOut = await callGeminiApi([{ text: buildPrompt(attempt === 1) }]);
        const jsonMatch = rawOut.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('JSON 블록을 찾지 못했습니다.');

        const parsed = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(parsed.cuts) || parsed.cuts.length === 0) {
          throw new Error('컷별 기획 배열(cuts)이 비어 있습니다.');
        }

        const count = Math.max(
          1,
          Math.min(
            maxAllowedSlides,
            requestedSlideCount !== 'auto' && requestedSlideCount
              ? Number(requestedSlideCount)
              : Number(parsed.recommendedSlideCount) || parsed.cuts.length || 5
          )
        );

        const rawCandidates: string[] = Array.isArray(parsed.coverTitleCandidates)
          ? parsed.coverTitleCandidates.map((c: unknown) => String(c || '').trim()).filter(Boolean)
          : [];

        const candidates: [string, string, string] = [
          rawCandidates[0] || `${cleanTopic.slice(0, 14)} 핵심 정리`,
          rawCandidates[1] || `요즘 뜨는 ${cleanTopic.slice(0, 12)} 꿀팁`,
          rawCandidates[2] || `모르면 아쉬운 ${cleanTopic.slice(0, 10)} 가이드`,
        ];

        const cuts: PlanCutItem[] = Array.from({ length: count }).map((_, idx) => {
          const item = parsed.cuts[idx] || {};
          const defaultRole = getDefaultCutRoleLabel(idx, count);
          const validRoles: PlanCutRoleLabel[] = [
            '표지',
            '공감',
            '핵심 정보',
            '예시',
            '요약',
            '마무리·행동 유도',
          ];
          const roleType: PlanCutRoleLabel = validRoles.includes(item.roleType)
            ? item.roleType
            : defaultRole;

          return {
            id: `cut-${Date.now()}-${idx + 1}`,
            slideNumber: idx + 1,
            roleType,
            headline:
              idx === 0
                ? String(item.headline || candidates[0]).slice(0, 32)
                : String(item.headline || `${cleanTopic.slice(0, 10)} 포인트 ${idx}`).slice(0, 32),
            body: String(
              item.body ||
                (idx === count - 1
                  ? '도움이 되셨다면 저장해 두고 필요할 때 꺼내보세요! 친구에게 공유해도 좋아요.'
                  : '핵심 내용을 한눈에 보기 쉽게 정리했습니다.')
            ).slice(0, 120),
            photoOverlayText: String(
              item.photoOverlayText ||
                (idx === 0 ? candidates[0] : `${idx + 1}번째 핵심 포인트`)
            ).slice(0, 50),
            photoGuide: String(
              item.photoGuide ||
                (idx === 0
                  ? '시선을 사로잡는 전체 분위기 대표 사진'
                  : idx === count - 1
                  ? '깔끔한 마무리 감성 사진 또는 로고/매장 사진'
                  : `${idx + 1}번째 내용을 보여주는 상세 사진`)
            ).slice(0, 80),
            isManuallyEdited: false,
          };
        });

        return {
          id: `plan-${Date.now()}-v${variationIndex}`,
          versionLabel: `기획안 ${variationIndex}`,
          topic: cleanTopic,
          targetAudience,
          purpose,
          tone,
          referenceText,
          coverTitleCandidates: candidates,
          selectedCoverIndex: 0,
          recommendedSlideCount: count,
          recommendationReason: String(
            parsed.recommendationReason ||
              `이 주제는 ${count}장으로 나누었을 때 표지부터 핵심 정보, 마무리 행동 유도까지 독자가 지루하지 않게 읽을 수 있어요.`
          ),
          cuts,
          captionDraft: String(
            parsed.captionDraft ||
              `✨ ${candidates[0]}\n\n${cleanTopic}에 대해 꼭 알아두면 좋은 핵심 내용을 카드뉴스로 정리했어요!\n이미지를 넘겨서 확인해 보세요 👉\n\n#카드뉴스 #인스타꿀팁 #정보공유`
          ),
          createdAt: new Date().toISOString(),
        };
      } catch (err) {
        console.warn(`[Gemini 기획안 생성 시도 ${attempt + 1} 실패]:`, err);
      }
    }
  }

  // 폴백 기획안 생성 (API 키가 없거나 2회 연속 파싱 실패 시에도 주제 맞춤형 기획안 반환)
  const fallbackCount =
    requestedSlideCount !== 'auto' && requestedSlideCount
      ? Math.max(1, Math.min(maxAllowedSlides, Number(requestedSlideCount)))
      : 5;

  const fallbackCandidates: [string, string, string] = [
    `${cleanTopic.slice(0, 12)}, 이것만 알면 끝!`,
    `한눈에 보는 ${cleanTopic.slice(0, 12)} 핵심 요약`,
    `실패 없는 ${cleanTopic.slice(0, 12)} 실전 가이드`,
  ];

  const fallbackCuts: PlanCutItem[] = Array.from({ length: fallbackCount }).map((_, idx) => {
    const roleType = getDefaultCutRoleLabel(idx, fallbackCount);
    if (idx === 0) {
      return {
        id: `cut-${Date.now()}-1`,
        slideNumber: 1,
        roleType: '표지',
        headline: fallbackCandidates[0],
        body: `${cleanTopic}의 가장 중요한 핵심만 모았습니다.\n오른쪽으로 넘겨 확인해 보세요 👉`,
        photoOverlayText: fallbackCandidates[0],
        photoGuide: '주제를 가장 잘 보여주는 밝고 선명한 대표 사진',
        isManuallyEdited: false,
      };
    }
    if (idx === fallbackCount - 1) {
      return {
        id: `cut-${Date.now()}-${idx + 1}`,
        slideNumber: idx + 1,
        roleType: '마무리·행동 유도',
        headline: '저장해 두고 필요할 때 꺼내보세요!',
        body: '오늘 내용이 도움이 되셨다면 [저장]과 [공유]를 눌러주세요.\n궁금한 점은 댓글로 남겨주세요!',
        photoOverlayText: '저장 & 공유하고 언제든 다시 보기 📌',
        photoGuide: '깔끔한 분위기 사진이나 전체 요약 느낌의 사진',
        isManuallyEdited: false,
      };
    }
    if (roleType === '공감') {
      return {
        id: `cut-${Date.now()}-${idx + 1}`,
        slideNumber: idx + 1,
        roleType: '공감',
        headline: '혹시 이런 고민 해보셨나요?',
        body: `${cleanTopic}을 준비할 때 어디서부터 시작해야 할지 막막했던 분들을 위해 준비했어요.`,
        photoOverlayText: '누구나 한 번쯤 겪는 고민!',
        photoGuide: '일상적인 순간이나 공감을 부르는 자연스러운 사진',
        isManuallyEdited: false,
      };
    }
    return {
      id: `cut-${Date.now()}-${idx + 1}`,
      slideNumber: idx + 1,
      roleType,
      headline: `핵심 포인트 ${idx}: 꼭 기억하세요`,
      body: `${cleanTopic}에서 놓치기 쉬운 핵심 포인트를 실천하기 쉽게 정리했습니다.`,
      photoOverlayText: `핵심 포인트 0${idx}`,
      photoGuide: `포인트 ${idx}의 실제 모습이나 특징이 잘 보이는 클로즈업 사진`,
      isManuallyEdited: false,
    };
  });

  return {
    id: `plan-${Date.now()}-v${variationIndex}`,
    versionLabel: `기획안 ${variationIndex}`,
    topic: cleanTopic,
    targetAudience,
    purpose,
    tone,
    referenceText,
    coverTitleCandidates: fallbackCandidates,
    selectedCoverIndex: 0,
    recommendedSlideCount: fallbackCount,
    recommendationReason: `${cleanTopic} 주제는 표지(시선 집중) → 공감 → 핵심 정보 → 마무리(저장 유도)의 ${fallbackCount}장 구조가 가장 읽기 편해요.`,
    cuts: fallbackCuts,
    captionDraft: `✨ ${fallbackCandidates[0]}\n\n${cleanTopic} 핵심 내용을 한눈에 볼 수 있게 정리했어요!\n도움이 되셨다면 저장해 두고 필요할 때 꺼내보세요 📌\n\n#인스타그램 #카드뉴스 #정보공유 #꿀팁`,
    createdAt: new Date().toISOString(),
  };
}

// 단일 컷 다시 쓰기 (1회 자동 재시도 포함)
export async function regenerateSinglePlanCutWithAI(params: {
  topic: string;
  targetAudience?: string;
  purpose?: string;
  tone?: CaptionToneId;
  cut: PlanCutItem;
  totalSlides: number;
}): Promise<PlanCutItem> {
  const { topic, targetAudience = '', purpose = '', tone = 'friendly', cut, totalSlides } = params;
  const apiKey = getGeminiApiKey();

  if (apiKey) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const prompt = `
카드뉴스 주제: "${topic}"
대상: "${targetAudience || '일반 사용자'}" / 목적: "${purpose || '정보 전달'}" / 말투: "${tone}"
현재 컷 번호: ${cut.slideNumber} / 총 ${totalSlides}장 (역할: ${cut.roleType})
기존 제목: "${cut.headline}"
기존 본문: "${cut.body}"

이 컷 1장만 기존과 다른 새롭고 매력적인 표현으로 다시 기획해 주세요.
- 제목(headline): 15자 안팎
- 짧은 본문(body): 2~3줄 이내 (쉬운 말 사용, 과장/단정 표현 금지)
- 사진에 들어갈 글(photoOverlayText): 사진 위에 얹는 한두 줄 문구
- 사진 가이드(photoGuide): 이 컷에 어울리는 구체적인 사진 설명

순수 JSON만 출력하세요:
{
  "headline": "새 제목 (15자 안팎)",
  "body": "새 본문 (2~3줄)",
  "photoOverlayText": "사진 위 짧은 문구",
  "photoGuide": "이 컷에 어울리는 사진 가이드"
}
`;
        const rawOut = await callGeminiApi([{ text: prompt }]);
        const match = rawOut.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          return {
            ...cut,
            headline: String(parsed.headline || cut.headline).slice(0, 32),
            body: String(parsed.body || cut.body).slice(0, 120),
            photoOverlayText: String(parsed.photoOverlayText || cut.photoOverlayText).slice(0, 50),
            photoGuide: String(parsed.photoGuide || cut.photoGuide).slice(0, 80),
            isManuallyEdited: false,
          };
        }
      } catch {
        // retry once
      }
    }
  }

  return {
    ...cut,
    headline: `${cut.headline.replace(/ ✨$/, '')} ✨`,
    body: `${cut.body}\n(핵심 포인트를 더 보기 쉽게 다듬었어요!)`,
    isManuallyEdited: false,
  };
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
    : '- 1번째 장(index 0): 호기심을 자극하는 "표지" 제목\n- 중간 장: 핵심 내용을 나누어 설명하는 "본문" (한 장에 글이 너무 많지 않게 제목 15자 안팎, 본문 2~3줄)\n- 마지막 장(index ' +
      (slideCount - 1) +
      '): 저장·공유·팔로우·방문을 유도하는 "마무리·행동 유도(CTA)"'
}

반드시 아래 JSON 스키마만 출력하세요:
{
  "slides": [
    {
      "badgeText": "짧은 소제목/키워드 (10자 이내)",
      "headline": "핵심 제목 (15자 안팎)",
      "body": "짧고 읽기 쉬운 본문 (2~3줄)",
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
    let body =
      sourceLine.length > 24
        ? sourceLine.slice(24, 90)
        : '슬라이드를 넘겨 자세한 내용을 확인해 보세요.';

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
  "headline": "새 제목(15자 안팎)",
  "body": "새 본문(2~3줄)"
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

// 4-C) 주제 아이디어 10개 추천
export async function recommendTopicIdeasAI(keyword: string): Promise<string[]> {
  const apiKey = getGeminiApiKey();
  const cleanKeyword = keyword.trim() || '일상 꿀팁';

  if (apiKey) {
    try {
      const prompt = `
분야/키워드: "${cleanKeyword}"
인스타그램에서 반응(저장/공유)이 폭발적으로 터질 만한 카드뉴스 주제 아이디어 10개를 작성하세요.
반드시 JSON 문자열 배열로만 출력하세요:
["주제 1", "주제 2", "주제 3", "주제 4", "주제 5", "주제 6", "주제 7", "주제 8", "주제 9", "주제 10"]
`;
      const raw = await callGeminiApi([{ text: prompt }]);
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) {
        const list = JSON.parse(match[0]);
        if (Array.isArray(list) && list.length > 0) {
          return list.slice(0, 10).map(String);
        }
      }
    } catch (e) {
      console.warn('[주제 아이디어 추천 폴백]:', e);
    }
  }

  return [
    `${cleanKeyword} 입문자가 가장 많이 하는 실수 TOP 3`,
    `모르면 손해 보는 ${cleanKeyword} 핵심 꿀팁`,
    `전문가가 알려주는 ${cleanKeyword} 선택 기준 3가지`,
    `3분 만에 끝내는 ${cleanKeyword} 완벽 정리`,
    `가성비 최고로 소문난 ${cleanKeyword} 추천 리스트`,
    `직접 써보고 느낀 ${cleanKeyword} 솔직 장단점`,
    `요즘 인기 급상승 중인 ${cleanKeyword} 트렌드`,
    `실패 없이 시작하는 ${cleanKeyword} 첫걸음 가이드`,
    `바쁜 직장인을 위한 ${cleanKeyword} 초간단 활용법`,
    `이것만 체크해도 성공하는 ${cleanKeyword} 체크리스트`,
  ];
}

// 4-D) 1편·2편·3편 시리즈 나누기
export async function splitSeriesAI(topic: string): Promise<{ part1: string; part2: string; part3: string }> {
  const apiKey = getGeminiApiKey();
  const cleanTopic = topic.trim() || '핵심 완벽 가이드';

  if (apiKey) {
    try {
      const prompt = `
주제: "${cleanTopic}"
이 방대한 주제를 인스타그램 독자가 흥미를 잃지 않고 팔로우하며 볼 수 있도록 1편(입문/기초), 2편(실전 핵심), 3편(심화/문제해결) 시리즈로 나누어 주세요.
반드시 JSON 형식으로만 답하세요:
{
  "part1": "1편 주제 제목",
  "part2": "2편 주제 제목",
  "part3": "3편 주제 제목"
}
`;
      const raw = await callGeminiApi([{ text: prompt }]);
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const p = JSON.parse(match[0]);
        return {
          part1: String(p.part1 || `[1편] ${cleanTopic} 입문편`),
          part2: String(p.part2 || `[2편] ${cleanTopic} 실전편`),
          part3: String(p.part3 || `[3편] ${cleanTopic} 심화 총정리`),
        };
      }
    } catch (e) {
      console.warn('[시리즈 분할 폴백]:', e);
    }
  }

  return {
    part1: `[1편] ${cleanTopic} - 처음 시작할 때 꼭 알아야 할 기초`,
    part2: `[2편] ${cleanTopic} - 실패 없는 실전 활용법과 꿀팁`,
    part3: `[3편] ${cleanTopic} - 자주 묻는 질문과 완벽 총정리`,
  };
}

