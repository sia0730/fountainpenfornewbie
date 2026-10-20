// src/app/api/render/route.ts
// [기능 3 & 기능 4] 서버에서 satori + sharp로 모든 슬라이드를 고화질 JPEG로 생성하고,
// 인스타그램이 읽을 수 있도록 Supabase Storage 공개 URL로 업로드하여 반환합니다.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin, getUserFromRequest } from '@/lib/supabase';
import { renderSlideToJpegBuffer } from '@/lib/renderer';
import { AspectRatioKey, FontId, MoodId } from '@/config/constants';
import { SlideItem } from '@/types';

export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const body = await req.json();
    const {
      slides = [],
      aspectRatio = '4:5',
      fontId = 'Pretendard',
      moodId = 'minimal',
      accentColor = '#2563EB',
      accountName = '',
      uploadToStorage = false,
    }: {
      slides: SlideItem[];
      aspectRatio: AspectRatioKey;
      fontId: FontId;
      moodId: MoodId;
      accentColor: string;
      accountName?: string;
      uploadToStorage?: boolean;
    } = body;

    if (!Array.isArray(slides) || slides.length === 0) {
      return NextResponse.json({ error: '렌더링할 슬라이드가 없습니다.' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const renderedUrls: string[] = [];

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const jpegBuffer = await renderSlideToJpegBuffer({
        slide: { ...slide, slideNumber: i + 1 },
        totalSlides: slides.length,
        aspectRatio,
        fontId,
        moodId,
        accentColor,
        accountName,
      });

      if (uploadToStorage) {
        // 인스타 API가 외부에서 읽을 수 있도록 Supabase Storage 공개 버킷(post-images)에 JPEG 저장
        const filePath = `${user.id}/post-${Date.now()}-slide-${i + 1}.jpg`;
        const { error: uploadErr } = await admin.storage
          .from('post-images')
          .upload(filePath, jpegBuffer, {
            contentType: 'image/jpeg',
            upsert: true,
          });

        if (!uploadErr) {
          const { data: pubData } = admin.storage.from('post-images').getPublicUrl(filePath);
          renderedUrls.push(pubData.publicUrl);
          continue;
        }
      }

      // 미리보기 또는 다운로드 전용일 때는 즉각적인 Data URI 반환
      renderedUrls.push(`data:image/jpeg;base64,${jpegBuffer.toString('base64')}`);
    }

    return NextResponse.json({ renderedUrls });
  } catch (err) {
    console.error('[서버 JPEG 렌더링 오류]:', err);
    const message = err instanceof Error ? err.message : '이미지 생성 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
