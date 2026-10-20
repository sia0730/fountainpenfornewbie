// src/app/api/ai/regenerate-slide/route.ts
// [기능 3] 미리보기에서 "이 장만 다시 만들기" 버튼을 눌렀을 때 해당 장의 제목과 본문만 새로 만듭니다.
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/supabase';
import { regenerateSingleSlideWithAI } from '@/lib/gemini';

export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const body = await req.json();
    const { rawText = '', slide, totalSlides = 1 } = body;

    if (!slide) {
      return NextResponse.json({ error: '다시 만들 슬라이드 정보가 없습니다.' }, { status: 400 });
    }

    const updated = await regenerateSingleSlideWithAI({
      rawText,
      slide,
      totalSlides,
    });

    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : '슬라이드 다시 만들기 실패';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
