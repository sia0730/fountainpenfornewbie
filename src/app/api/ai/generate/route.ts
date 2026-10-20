// src/app/api/ai/generate/route.ts
// [기능 3 & 기능 5] 사진과 메모를 받아 장수에 맞춰 내용을 나누고 캡션을 자동 생성합니다.
import { NextResponse } from 'next/server';
import { checkAndIncrementDailyUsage, getUserFromRequest } from '@/lib/supabase';
import { generateSlidesAndCaptionsWithAI } from '@/lib/gemini';
import { MAX_SLIDES } from '@/config/constants';

export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    // 하루 AI 생성 횟수 제한 확인
    const usage = await checkAndIncrementDailyUsage(user.id);
    if (!usage.allowed) {
      return NextResponse.json(
        {
          error: `하루 AI 자동 제작 한도(${usage.limit}회)를 모두 사용하셨습니다. 내일 다시 이용해 주세요!`,
        },
        { status: 429 }
      );
    }

    const body = await req.json();
    const {
      rawText = '',
      slideCount = 4,
      publishMode = 'auto_publish',
      photoUrls = [],
      captionTone = 'friendly',
      defaultHashtags = '',
    } = body;

    const maxAllowed =
      publishMode === 'download_only' ? MAX_SLIDES.DOWNLOAD_ONLY : MAX_SLIDES.AUTO_PUBLISH;
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
    const message = err instanceof Error ? err.message : 'AI 자동 제작 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
