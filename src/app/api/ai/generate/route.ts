// src/app/api/ai/generate/route.ts
// 1) mode === 'generate_plan': 주제 기반 컷별 기획안(JSON) 생성 (표지 후보 3개, 추천 장수, 컷별 내용/사진 글/사진 가이드)
// 2) mode === 'regenerate_cut': 기획안의 특정 컷 1장만 다시 쓰기
// 3) 기본 모드: 슬라이드 및 캡션 생성
import { NextResponse } from 'next/server';
import { checkAndIncrementDailyUsage, getUserFromRequest } from '@/lib/supabase';
import {
  generateCardNewsPlanWithAI,
  generateSlidesAndCaptionsWithAI,
  recommendTopicIdeasAI,
  regenerateSinglePlanCutWithAI,
  splitSeriesAI,
} from '@/lib/gemini';
import { MAX_SLIDES } from '@/config/constants';

export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    const body = await req.json();
    const mode = body.mode || 'slides';

    // 로그인한 경우 DB 기반 하루 10회 생성 한도 체크
    let usage = { allowed: true, currentCount: 1, limit: 10 };
    if (user && mode !== 'regenerate_cut') {
      usage = await checkAndIncrementDailyUsage(user.id);
      if (!usage.allowed) {
        return NextResponse.json(
          {
            error: `하루 AI 기획·제작 한도(${usage.limit}회)를 모두 사용했어요. 내일 다시 이용해 주세요!`,
          },
          { status: 429 }
        );
      }
    }

    const publishMode = body.publishMode || 'auto_publish';
    const maxAllowed =
      publishMode === 'download_only' ? MAX_SLIDES.DOWNLOAD_ONLY : MAX_SLIDES.AUTO_PUBLISH;

    // [1단계] 주제 → 컷별 기획안(JSON) 생성
    if (mode === 'generate_plan') {
      const plan = await generateCardNewsPlanWithAI({
        topic: String(body.topic || body.rawText || '').trim(),
        targetAudience: String(body.targetAudience || '').trim(),
        purpose: String(body.purpose || '').trim(),
        tone: body.tone || body.captionTone || 'friendly',
        referenceText: String(body.referenceText || '').trim(),
        requestedSlideCount: body.requestedSlideCount ?? 'auto',
        variationIndex: Number(body.variationIndex) || 1,
        maxAllowedSlides: maxAllowed,
      });

      return NextResponse.json({
        plan,
        usage,
      });
    }

    // [4단계-C] 주제 아이디어 10개 추천 (mode === 'recommend_topics')
    if (mode === 'recommend_topics') {
      const keyword = String(body.keyword || body.topic || '일상 꿀팁').trim();
      const ideas = await recommendTopicIdeasAI(keyword);
      return NextResponse.json({ ideas });
    }

    // [4단계-D] 1편·2편·3편 시리즈 나누기 (mode === 'split_series')
    if (mode === 'split_series') {
      const topic = String(body.topic || '').trim();
      const series = await splitSeriesAI(topic);
      return NextResponse.json({ series });
    }

    // [1단계] 기획안 화면에서 "이 컷만 다시 쓰기"
    if (mode === 'regenerate_cut') {
      const updatedCut = await regenerateSinglePlanCutWithAI({
        topic: String(body.topic || '').trim(),
        targetAudience: String(body.targetAudience || '').trim(),
        purpose: String(body.purpose || '').trim(),
        tone: body.tone || 'friendly',
        cut: body.cut,
        totalSlides: Number(body.totalSlides) || 5,
      });

      return NextResponse.json({
        cut: updatedCut,
      });
    }

    // 기존 슬라이드 생성 호환
    const {
      rawText = '',
      slideCount = 4,
      photoUrls = [],
      captionTone = 'friendly',
      defaultHashtags = '',
    } = body;

    const clampedSlideCount = Math.max(1, Math.min(Number(slideCount) || 1, maxAllowed));

    const result = await generateSlidesAndCaptionsWithAI({
      rawText,
      slideCount: clampedSlideCount,
      photoUrls,
      captionTone,
      defaultHashtags,
    });

    return NextResponse.json({
      slides: result.slides,
      caption: result.caption,
      usage,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'AI 기획안 생성 중 문제가 발생했어요. 다시 시도해 주세요.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
