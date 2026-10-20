// src/app/api/render/route.ts
import { NextResponse } from 'next/server';
import { getSupabaseAdmin, getUserFromRequest } from '@/lib/supabase';
import { renderSlideToJpegBuffer } from '@/lib/renderer';
import { AspectRatioKey, MoodId } from '@/config/constants';
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
      customFontBase64 = '',
      moodId = 'minimal',
      accentColor = '#2563EB',
      watermarkText = '',
      showWatermark = false,
      uploadToStorage = false,
    }: {
      slides: SlideItem[];
      aspectRatio: AspectRatioKey;
      fontId: string;
      customFontBase64?: string;
      moodId: MoodId;
      accentColor: string;
      watermarkText?: string;
      showWatermark?: boolean;
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
        customFontBase64: customFontBase64 || undefined,
        moodId,
        accentColor,
        watermarkText,
        showWatermark,
      });

      if (uploadToStorage) {
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

      renderedUrls.push(`data:image/jpeg;base64,${jpegBuffer.toString('base64')}`);
    }

    return NextResponse.json({ renderedUrls });
  } catch (err) {
    console.error('[서버 JPEG 렌더링 오류]:', err);
    const message = err instanceof Error ? err.message : '이미지 생성 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
