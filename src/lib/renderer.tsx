// src/lib/renderer.tsx
// [기능 3 & 기능 4] 서버에서 satori + sharp를 사용하여 6가지 분위기 프리셋과 6가지 한국어 폰트로
// 최종 JPEG 이미지를 생성하는 엔진입니다. (인스타 API 필수 규격인 JPEG로 변환)
import React from 'react';
import satori from 'satori';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import {
  ASPECT_RATIOS,
  AspectRatioKey,
  FontId,
  KOREAN_FONTS,
  MOOD_PRESETS,
  MoodId,
} from '@/config/constants';
import { ensureReadableColor, getReadableTextOnAccent } from '@/lib/contrast';
import { SlideItem } from '@/types';

const fontMemoryCache = new Map<string, ArrayBuffer>();

async function loadFontBuffer(fontId: FontId): Promise<ArrayBuffer> {
  if (fontMemoryCache.has(fontId)) {
    return fontMemoryCache.get(fontId)!;
  }

  const fontMeta = KOREAN_FONTS.find((f) => f.id === fontId) || KOREAN_FONTS[0];
  const localPath = path.join(process.cwd(), 'public', 'fonts', fontMeta.file);

  if (fs.existsSync(localPath)) {
    const fileBuf = fs.readFileSync(localPath);
    const arrayBuf = fileBuf.buffer.slice(
      fileBuf.byteOffset,
      fileBuf.byteOffset + fileBuf.byteLength
    );
    fontMemoryCache.set(fontId, arrayBuf);
    return arrayBuf;
  }

  // 로컬 파일이 아직 없을 경우 CDN에서 즉시 로드 후 캐싱
  const response = await fetch(fontMeta.fallbackUrl);
  if (!response.ok) {
    throw new Error(`폰트 로드 실패 (${fontMeta.name})`);
  }
  const arrayBuf = await response.arrayBuffer();
  fontMemoryCache.set(fontId, arrayBuf);
  return arrayBuf;
}

/**
 * 사용자가 올린 원본 사진을 변경/왜곡하지 않고,
 * 슬라이드 내 사진 액자 비율에 맞춰 얼굴/중심 피사체(focusX, focusY)가 잘리지 않게 크롭 후 Base64로 변환합니다.
 */
async function prepareUserPhotoDataUri(params: {
  photoUrl?: string | null;
  targetWidth: number;
  targetHeight: number;
  focusX?: number;
  focusY?: number;
  filter?: string;
}): Promise<string | null> {
  const { photoUrl, targetWidth, targetHeight, filter } = params;
  if (!photoUrl) return null;

  try {
    let inputBuffer: Buffer;
    if (photoUrl.startsWith('data:')) {
      const base64Part = photoUrl.split(',')[1];
      inputBuffer = Buffer.from(base64Part, 'base64');
    } else {
      const res = await fetch(photoUrl);
      if (!res.ok) return null;
      inputBuffer = Buffer.from(await res.arrayBuffer());
    }

    // sharp.strategy.attention은 사진 속 사람의 얼굴이나 가장 눈에 띄는 피사체를 자동으로 찾아 잘리지 않게 중심을 맞춥니다.
    let pipeline = sharp(inputBuffer).resize(targetWidth, targetHeight, {
      fit: 'cover',
      position: sharp.strategy.attention,
    });

    if (filter === 'warm') {
      pipeline = pipeline.modulate({ saturation: 0.9, brightness: 1.03 });
    } else if (filter === 'bright') {
      pipeline = pipeline.modulate({ saturation: 1.08, brightness: 1.05 });
    } else if (filter === 'contrast') {
      pipeline = pipeline.modulate({ brightness: 0.85, saturation: 1.1 });
    } else if (filter === 'dim') {
      pipeline = pipeline.modulate({ brightness: 0.9 });
    }

    const jpegBuf = await pipeline.jpeg({ quality: 90 }).toBuffer();
    return `data:image/jpeg;base64,${jpegBuf.toString('base64')}`;
  } catch (err) {
    console.warn('[사진 전처리 폴백]:', err);
    return null;
  }
}

export async function renderSlideToJpegBuffer(params: {
  slide: SlideItem;
  totalSlides: number;
  aspectRatio: AspectRatioKey;
  fontId: FontId;
  moodId: MoodId;
  accentColor: string;
  accountName?: string;
}): Promise<Buffer> {
  const { slide, totalSlides, aspectRatio, fontId, moodId, accentColor, accountName } = params;
  const dimensions = ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS['4:5'];
  const { width, height } = dimensions;

  const mood = MOOD_PRESETS.find((m) => m.id === moodId) || MOOD_PRESETS[0];
  const fontBuffer = await loadFontBuffer(fontId);

  // [기능 4] 배경색과 글자색/포인트색의 명도 대비를 계산하여 읽기 쉽게 자동 보정
  const safeTextColor = ensureReadableColor(mood.textColor, mood.bgColor, 4.5);
  const safeSubTextColor = ensureReadableColor(mood.subTextColor, mood.bgColor, 3.5);
  const safeAccent = ensureReadableColor(accentColor || mood.defaultAccent, mood.bgColor, 2.8);
  const badgeTextColor = getReadableTextOnAccent(safeAccent);

  const hasPhoto = Boolean(slide.photoUrl);
  const photoDataUri = hasPhoto
    ? await prepareUserPhotoDataUri({
        photoUrl: slide.photoUrl,
        targetWidth: mood.photoLayout === 'full-bleed' ? width : width - mood.padding * 2,
        targetHeight:
          mood.photoLayout === 'full-bleed' ? height : Math.round(height * 0.5),
        focusX: slide.focusX,
        focusY: slide.focusY,
        filter: mood.photoFilter,
      })
    : null;

  // 분위기 프리셋별 맞춤 레이아웃 렌더링
  let element: React.ReactElement;

  if (mood.photoLayout === 'full-bleed' && photoDataUri) {
    // 4) 굵은 포스터형: 전체 배경 사진 + 진한 다크 그라데이션 오버레이 (글자와 얼굴이 겹쳐도 선명하게)
    element = (
      <div
        style={{
          width: `${width}px`,
          height: `${height}px`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: slide.textPosition === 'top' ? 'flex-start' : 'flex-end',
          position: 'relative',
          backgroundColor: '#0F172A',
          fontFamily: fontId,
        }}
      >
        <img
          src={photoDataUri}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: `${width}px`,
            height: `${height}px`,
            objectFit: 'cover',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: `${width}px`,
            height: `${height}px`,
            background:
              slide.textPosition === 'top'
                ? 'linear-gradient(180deg, rgba(10,15,28,0.88) 0%, rgba(10,15,28,0.5) 55%, rgba(10,15,28,0.2) 100%)'
                : 'linear-gradient(180deg, rgba(10,15,28,0.18) 0%, rgba(10,15,28,0.65) 52%, rgba(10,15,28,0.94) 100%)',
          }}
        />
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            padding: `${mood.padding}px`,
            width: '100%',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
            <div
              style={{
                backgroundColor: accentColor || mood.defaultAccent,
                color: getReadableTextOnAccent(accentColor || mood.defaultAccent),
                padding: '10px 24px',
                fontSize: '24px',
                fontWeight: 700,
                borderRadius: '8px',
              }}
            >
              {slide.badgeText || `SLIDE ${slide.slideNumber}`}
            </div>
          </div>
          <div
            style={{
              fontSize: `${mood.titleSize}px`,
              fontWeight: 800,
              color: '#FFFFFF',
              lineHeight: 1.25,
              marginBottom: '24px',
              wordBreak: 'keep-all',
            }}
          >
            {slide.headline}
          </div>
          {slide.body ? (
            <div
              style={{
                fontSize: `${mood.bodySize}px`,
                color: '#E2E8F0',
                lineHeight: 1.55,
                wordBreak: 'keep-all',
              }}
            >
              {slide.body}
            </div>
          ) : null}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '40px',
              paddingTop: '20px',
              borderTop: '2px solid rgba(255,255,255,0.25)',
              color: '#CBD5E1',
              fontSize: '22px',
            }}
          >
            <span>{accountName ? `@${accountName}` : 'INSTAGRAM CARD'}</span>
            <span>
              {slide.slideNumber} / {totalSlides}
            </span>
          </div>
        </div>
      </div>
    );
  } else {
    // 미니멀, 감성 필름, 귀여운 파스텔, 정보형 카드뉴스, 다크 시크 레이아웃
    // 사진 영역과 글자 영역을 명확히 분리하여 사진 속 얼굴이 글자에 절대 가려지지 않게 배치
    const innerWidth = width - mood.padding * 2;
    const photoBoxHeight = Math.round(height * 0.48);

    element = (
      <div
        style={{
          width: `${width}px`,
          height: `${height}px`,
          backgroundColor: mood.bgColor,
          padding: `${mood.padding}px`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          fontFamily: fontId,
        }}
      >
        {/* 상단 헤더 영역 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
            marginBottom: '20px',
          }}
        >
          <div
            style={{
              backgroundColor: safeAccent,
              color: badgeTextColor,
              padding: '10px 24px',
              borderRadius: mood.id === 'pastel' ? '999px' : '10px',
              fontSize: '23px',
              fontWeight: 700,
            }}
          >
            {slide.badgeText || slide.roleLabel}
          </div>
          <div
            style={{
              fontSize: '24px',
              color: safeSubTextColor,
              fontWeight: 600,
            }}
          >
            {totalSlides > 1 ? `${slide.slideNumber} / ${totalSlides}` : ''}
          </div>
        </div>

        {/* 사진 영역 (사진이 있을 때만 표시, 없으면 글 전용 중앙 강조 카드) */}
        {photoDataUri ? (
          <div
            style={{
              width: `${innerWidth}px`,
              height: `${photoBoxHeight}px`,
              borderRadius: `${mood.borderRadius}px`,
              overflow: 'hidden',
              display: 'flex',
              border:
                mood.id === 'film'
                  ? '14px solid #FFFFFF'
                  : mood.id === 'cardnews'
                  ? `3px solid ${safeAccent}`
                  : 'none',
              boxShadow: '0 12px 30px rgba(0,0,0,0.08)',
              marginBottom: '28px',
            }}
          >
            <img
              src={photoDataUri}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          </div>
        ) : (
          <div
            style={{
              width: '96px',
              height: '8px',
              backgroundColor: safeAccent,
              borderRadius: '999px',
              marginTop: '40px',
              marginBottom: '20px',
            }}
          />
        )}

        {/* 텍스트 카드 영역 */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            flexGrow: 1,
            backgroundColor:
              mood.id === 'cardnews' || mood.id === 'pastel' || !photoDataUri
                ? mood.cardBgColor
                : 'transparent',
            padding:
              mood.id === 'cardnews' || mood.id === 'pastel' || !photoDataUri ? '42px' : '12px 4px',
            borderRadius: `${mood.borderRadius}px`,
            border:
              mood.id === 'dark'
                ? '1px solid rgba(255,255,255,0.12)'
                : mood.id === 'cardnews'
                ? '1px solid #E2E8F0'
                : 'none',
          }}
        >
          <div
            style={{
              fontSize: `${photoDataUri ? mood.titleSize : Math.round(mood.titleSize * 1.15)}px`,
              fontWeight: 700,
              color: safeTextColor,
              lineHeight: 1.3,
              marginBottom: '22px',
              wordBreak: 'keep-all',
            }}
          >
            {slide.headline}
          </div>
          {slide.body ? (
            <div
              style={{
                fontSize: `${photoDataUri ? mood.bodySize : Math.round(mood.bodySize * 1.1)}px`,
                color: safeSubTextColor,
                lineHeight: 1.6,
                wordBreak: 'keep-all',
              }}
            >
              {slide.body}
            </div>
          ) : null}
        </div>

        {/* 하단 바닥글 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '20px',
            paddingTop: '16px',
            borderTop: `1px solid ${mood.id === 'dark' ? '#27272A' : '#E5E7EB'}`,
            fontSize: '21px',
            color: safeSubTextColor,
          }}
        >
          <span>{accountName ? `@${accountName}` : 'AUTO CARD STUDIO'}</span>
          <span>{slide.role === 'cta' ? '저장해 두고 필요할 때 꺼내보세요 ♥' : ''}</span>
        </div>
      </div>
    );
  }

  // 1) satori로 SVG 생성
  const svg = await satori(element, {
    width,
    height,
    fonts: [
      {
        name: fontId,
        data: fontBuffer,
        weight: 400,
        style: 'normal',
      },
      {
        name: fontId,
        data: fontBuffer,
        weight: 700,
        style: 'normal',
      },
    ],
  });

  // 2) sharp로 SVG를 고화질 JPEG 버퍼로 변환 (인스타그램 API 전용 포맷)
  const jpegBuffer = await sharp(Buffer.from(svg))
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();

  return jpegBuffer;
}
