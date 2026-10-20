// src/lib/renderer.tsx
// 서버에서 satori + sharp를 사용하여 커스텀 폰트, 다중 사진(1~4장 콜라주), 사진 위치/확대,
// 글씨 위치/정렬/크기, 워터마크 제거까지 100% 반영한 고화질 JPEG 이미지를 생성합니다.
import React from 'react';
import satori from 'satori';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import {
  ASPECT_RATIOS,
  AspectRatioKey,
  KOREAN_FONTS,
  MOOD_PRESETS,
  MoodId,
} from '@/config/constants';
import { ensureReadableColor, getReadableTextOnAccent } from '@/lib/contrast';
import { SlideItem } from '@/types';

const fontMemoryCache = new Map<string, ArrayBuffer>();

async function loadFontBuffer(fontId: string, customFontBase64?: string): Promise<ArrayBuffer> {
  // 사용자가 직접 업로드한 폰트(.ttf, .otf, .woff)가 있으면 최우선 사용
  if (customFontBase64) {
    const cleanBase64 = customFontBase64.includes(',')
      ? customFontBase64.split(',')[1]
      : customFontBase64;
    const buf = Buffer.from(cleanBase64, 'base64');
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }

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

  const response = await fetch(fontMeta.fallbackUrl);
  if (!response.ok) {
    throw new Error(`폰트 로드 실패 (${fontMeta.name})`);
  }
  const arrayBuf = await response.arrayBuffer();
  fontMemoryCache.set(fontId, arrayBuf);
  return arrayBuf;
}

/**
 * 사용자가 조정한 사진 위치(focusX, focusY)와 확대 배율(photoZoom)을 반영하여 크롭합니다.
 */
async function prepareUserPhotoDataUri(params: {
  photoUrl?: string | null;
  targetWidth: number;
  targetHeight: number;
  focusX?: number;
  focusY?: number;
  photoZoom?: number;
  filter?: string;
}): Promise<string | null> {
  const {
    photoUrl,
    targetWidth,
    targetHeight,
    focusX = 50,
    focusY = 50,
    photoZoom = 100,
    filter,
  } = params;
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

    const zoomFactor = Math.max(1, Math.min(2.5, (photoZoom || 100) / 100));
    const scaledW = Math.round(targetWidth * zoomFactor);
    const scaledH = Math.round(targetHeight * zoomFactor);

    // 먼저 확대 크기만큼 cover 리사이즈 후, 사용자가 지정한 중심(focusX, focusY) 기준으로 정확히 추출
    const resizedBuf = await sharp(inputBuffer)
      .resize(scaledW, scaledH, { fit: 'cover' })
      .toBuffer();

    const maxLeft = Math.max(0, scaledW - targetWidth);
    const maxTop = Math.max(0, scaledH - targetHeight);
    const left = Math.round((Math.max(0, Math.min(100, focusX)) / 100) * maxLeft);
    const top = Math.round((Math.max(0, Math.min(100, focusY)) / 100) * maxTop);

    let pipeline = sharp(resizedBuf).extract({
      left,
      top,
      width: targetWidth,
      height: targetHeight,
    });

    if (filter === 'warm') {
      pipeline = pipeline.modulate({ saturation: 0.9, brightness: 1.03 });
    } else if (filter === 'bright') {
      pipeline = pipeline.modulate({ saturation: 1.08, brightness: 1.05 });
    } else if (filter === 'contrast') {
      pipeline = pipeline.modulate({ brightness: 0.9, saturation: 1.1 });
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
  fontId: string;
  customFontBase64?: string;
  moodId: MoodId;
  accentColor: string;
  watermarkText?: string;
  showWatermark?: boolean;
}): Promise<Buffer> {
  const {
    slide,
    totalSlides,
    aspectRatio,
    fontId,
    customFontBase64,
    moodId,
    accentColor,
    watermarkText = '',
    showWatermark = false,
  } = params;

  const dimensions = ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS['4:5'];
  const { width, height } = dimensions;

  const mood = MOOD_PRESETS.find((m) => m.id === moodId) || MOOD_PRESETS[0];
  const fontBuffer = await loadFontBuffer(fontId, customFontBase64);

  const bgColor = slide.customBgColor || mood.bgColor;
  const rawTextColor = slide.customTextColor || mood.textColor;
  const safeTextColor = slide.customTextColor
    ? slide.customTextColor
    : ensureReadableColor(rawTextColor, bgColor, 4.5);
  const safeSubTextColor = slide.customTextColor
    ? slide.customTextColor
    : ensureReadableColor(mood.subTextColor, bgColor, 3.5);
  const safeAccent = ensureReadableColor(accentColor || mood.defaultAccent, bgColor, 2.8);
  const badgeTextColor = getReadableTextOnAccent(safeAccent);

  // 슬라이드에 들어간 사진 배열 정리 (다중 사진 지원)
  const rawPhotoUrls: string[] =
    Array.isArray(slide.photoUrls) && slide.photoUrls.length > 0
      ? slide.photoUrls.filter(Boolean)
      : slide.photoUrl
      ? [slide.photoUrl]
      : [];

  const effectiveLayout =
    slide.layoutType && slide.layoutType !== 'auto'
      ? slide.layoutType
      : mood.photoLayout === 'full-bleed'
      ? 'full-bleed'
      : 'top-photo';

  const titleFontSize = slide.titleSize || mood.titleSize;
  const bodyFontSize = slide.bodySize || mood.bodySize;
  const textAlign = slide.textAlign || 'left';
  const textPosition = slide.textPosition || 'bottom';
  const showBadge = slide.showBadge !== false;
  const showSlideNumber = slide.showSlideNumber !== false;
  const finalWatermark =
    slide.footerText !== undefined
      ? slide.footerText
      : showWatermark
      ? watermarkText
      : '';

  const innerWidth = width - mood.padding * 2;
  const photoBoxHeight =
    effectiveLayout === 'full-bleed'
      ? height
      : effectiveLayout === 'split-left'
      ? height - mood.padding * 2 - 120
      : Math.round(height * 0.48);
  const photoBoxWidth =
    effectiveLayout === 'full-bleed'
      ? width
      : effectiveLayout === 'split-left'
      ? Math.round(innerWidth * 0.48)
      : innerWidth;

  // 다중 사진 각각 전처리
  const preparedPhotos: string[] = [];
  const count = Math.min(rawPhotoUrls.length, 4);
  for (let i = 0; i < count; i++) {
    const subW =
      count === 1
        ? photoBoxWidth
        : count === 2
        ? Math.round((photoBoxWidth - 12) / 2)
        : count === 3 && i === 0
        ? Math.round((photoBoxWidth - 12) * 0.58)
        : count === 3
        ? Math.round((photoBoxWidth - 12) * 0.42)
        : Math.round((photoBoxWidth - 12) / 2);

    const subH =
      count === 1 || count === 2 || (count === 3 && i === 0)
        ? photoBoxHeight
        : Math.round((photoBoxHeight - 12) / 2);

    const uri = await prepareUserPhotoDataUri({
      photoUrl: rawPhotoUrls[i],
      targetWidth: Math.max(100, subW),
      targetHeight: Math.max(100, subH),
      focusX: slide.focusX ?? 50,
      focusY: slide.focusY ?? 50,
      photoZoom: slide.photoZoom ?? 100,
      filter: mood.photoFilter,
    });
    if (uri) preparedPhotos.push(uri);
  }

  // 다중 사진(1~4장) 그리드 렌더링 블록
  const renderPhotoCollage = (w: number, h: number, radius: number) => {
    if (preparedPhotos.length === 0) return null;

    if (preparedPhotos.length === 1) {
      return (
        <div
          style={{
            width: `${w}px`,
            height: `${h}px`,
            borderRadius: `${radius}px`,
            overflow: 'hidden',
            display: 'flex',
            border:
              mood.id === 'film'
                ? '14px solid #FFFFFF'
                : mood.id === 'cardnews'
                ? `3px solid ${safeAccent}`
                : 'none',
          }}
        >
          <img
            src={preparedPhotos[0]}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      );
    }

    if (preparedPhotos.length === 2) {
      return (
        <div
          style={{
            width: `${w}px`,
            height: `${h}px`,
            display: 'flex',
            flexDirection: 'row',
            gap: '12px',
          }}
        >
          {preparedPhotos.map((src, idx) => (
            <div
              key={idx}
              style={{
                flex: 1,
                height: '100%',
                borderRadius: `${radius}px`,
                overflow: 'hidden',
                display: 'flex',
              }}
            >
              <img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          ))}
        </div>
      );
    }

    if (preparedPhotos.length === 3) {
      return (
        <div
          style={{
            width: `${w}px`,
            height: `${h}px`,
            display: 'flex',
            flexDirection: 'row',
            gap: '12px',
          }}
        >
          <div
            style={{
              width: `${Math.round((w - 12) * 0.58)}px`,
              height: '100%',
              borderRadius: `${radius}px`,
              overflow: 'hidden',
              display: 'flex',
            }}
          >
            <img
              src={preparedPhotos[0]}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
          <div
            style={{
              flex: 1,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            {[preparedPhotos[1], preparedPhotos[2]].map((src, idx) => (
              <div
                key={idx}
                style={{
                  flex: 1,
                  width: '100%',
                  borderRadius: `${radius}px`,
                  overflow: 'hidden',
                  display: 'flex',
                }}
              >
                <img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            ))}
          </div>
        </div>
      );
    }

    // 4장 (2x2 바둑판 그리드)
    const cellW = Math.round((w - 12) / 2);
    const cellH = Math.round((h - 12) / 2);
    return (
      <div
        style={{
          width: `${w}px`,
          height: `${h}px`,
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'row', gap: '12px', height: `${cellH}px` }}>
          {[preparedPhotos[0], preparedPhotos[1]].map((src, idx) => (
            <div
              key={idx}
              style={{
                width: `${cellW}px`,
                height: `${cellH}px`,
                borderRadius: `${radius}px`,
                overflow: 'hidden',
                display: 'flex',
              }}
            >
              <img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', gap: '12px', height: `${cellH}px` }}>
          {[preparedPhotos[2], preparedPhotos[3]].map((src, idx) => (
            <div
              key={idx}
              style={{
                width: `${cellW}px`,
                height: `${cellH}px`,
                borderRadius: `${radius}px`,
                overflow: 'hidden',
                display: 'flex',
              }}
            >
              <img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          ))}
        </div>
      </div>
    );
  };

  let element: React.ReactElement;

  if (effectiveLayout === 'full-bleed' && preparedPhotos.length > 0) {
    const overlayAlpha =
      typeof slide.overlayOpacity === 'number' ? slide.overlayOpacity / 100 : 0.55;
    const justifyMap = {
      top: 'flex-start',
      center: 'center',
      bottom: 'flex-end',
    } as const;
    const alignItemsMap = {
      left: 'flex-start',
      center: 'center',
      right: 'flex-end',
    } as const;

    element = (
      <div
        style={{
          width: `${width}px`,
          height: `${height}px`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: justifyMap[textPosition],
          position: 'relative',
          backgroundColor: '#0F172A',
          fontFamily: 'SlideFont',
        }}
      >
        <div style={{ position: 'absolute', top: 0, left: 0, display: 'flex' }}>
          {renderPhotoCollage(width, height, 0)}
        </div>
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: `${width}px`,
            height: `${height}px`,
            backgroundColor: `rgba(10, 15, 28, ${overlayAlpha})`,
          }}
        />
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: alignItemsMap[textAlign],
            textAlign,
            padding: `${mood.padding}px`,
            width: '100%',
          }}
        >
          {(showBadge || showSlideNumber) && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                width: '100%',
                marginBottom: '24px',
              }}
            >
              {showBadge && slide.badgeText ? (
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
                  {slide.badgeText}
                </div>
              ) : (
                <div />
              )}
              {showSlideNumber && totalSlides > 1 ? (
                <div style={{ fontSize: '24px', color: '#E2E8F0', fontWeight: 700 }}>
                  {slide.slideNumber} / {totalSlides}
                </div>
              ) : null}
            </div>
          )}

          {slide.headline ? (
            <div
              style={{
                fontSize: `${titleFontSize}px`,
                fontWeight: 800,
                color: slide.customTextColor || '#FFFFFF',
                lineHeight: 1.28,
                marginBottom: '22px',
                wordBreak: 'keep-all',
              }}
            >
              {slide.headline}
            </div>
          ) : null}

          {slide.body ? (
            <div
              style={{
                fontSize: `${bodyFontSize}px`,
                color: slide.customTextColor || '#E2E8F0',
                lineHeight: 1.55,
                wordBreak: 'keep-all',
              }}
            >
              {slide.body}
            </div>
          ) : null}

          {finalWatermark ? (
            <div
              style={{
                display: 'flex',
                justifyContent: textAlign === 'center' ? 'center' : 'space-between',
                alignItems: 'center',
                width: '100%',
                marginTop: '36px',
                paddingTop: '18px',
                borderTop: '2px solid rgba(255,255,255,0.22)',
                color: '#CBD5E1',
                fontSize: '21px',
              }}
            >
              <span>{finalWatermark}</span>
            </div>
          ) : null}
        </div>
      </div>
    );
  } else {
    const alignItemsMap = {
      left: 'flex-start',
      center: 'center',
      right: 'flex-end',
    } as const;

    const textBlock = (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent:
            textPosition === 'top'
              ? 'flex-start'
              : textPosition === 'bottom'
              ? 'flex-end'
              : 'center',
          alignItems: alignItemsMap[textAlign],
          textAlign,
          flexGrow: 1,
          backgroundColor:
            mood.id === 'cardnews' || mood.id === 'pastel' || preparedPhotos.length === 0
              ? mood.cardBgColor
              : 'transparent',
          padding:
            mood.id === 'cardnews' || mood.id === 'pastel' || preparedPhotos.length === 0
              ? '38px'
              : '12px 4px',
          borderRadius: `${mood.borderRadius}px`,
          width: effectiveLayout === 'split-left' ? `${innerWidth - photoBoxWidth - 28}px` : '100%',
        }}
      >
        {slide.headline ? (
          <div
            style={{
              fontSize: `${titleFontSize}px`,
              fontWeight: 700,
              color: safeTextColor,
              lineHeight: 1.3,
              marginBottom: '20px',
              wordBreak: 'keep-all',
            }}
          >
            {slide.headline}
          </div>
        ) : null}
        {slide.body ? (
          <div
            style={{
              fontSize: `${bodyFontSize}px`,
              color: safeSubTextColor,
              lineHeight: 1.6,
              wordBreak: 'keep-all',
            }}
          >
            {slide.body}
          </div>
        ) : null}
      </div>
    );

    const photoBlock =
      preparedPhotos.length > 0 ? (
        <div
          style={{
            display: 'flex',
            marginBottom: effectiveLayout === 'top-photo' ? '26px' : '0px',
            marginTop: effectiveLayout === 'bottom-photo' ? '26px' : '0px',
          }}
        >
          {renderPhotoCollage(photoBoxWidth, photoBoxHeight, mood.borderRadius)}
        </div>
      ) : null;

    element = (
      <div
        style={{
          width: `${width}px`,
          height: `${height}px`,
          backgroundColor: bgColor,
          padding: `${mood.padding}px`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          fontFamily: 'SlideFont',
        }}
      >
        {(showBadge || showSlideNumber) && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
              marginBottom: '20px',
            }}
          >
            {showBadge && slide.badgeText ? (
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
                {slide.badgeText}
              </div>
            ) : (
              <div />
            )}
            {showSlideNumber && totalSlides > 1 ? (
              <div
                style={{
                  fontSize: '24px',
                  color: safeSubTextColor,
                  fontWeight: 600,
                }}
              >
                {slide.slideNumber} / {totalSlides}
              </div>
            ) : null}
          </div>
        )}

        {effectiveLayout === 'split-left' ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              gap: '28px',
              alignItems: 'stretch',
              flexGrow: 1,
            }}
          >
            {photoBlock}
            {textBlock}
          </div>
        ) : effectiveLayout === 'bottom-photo' ? (
          <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
            {textBlock}
            {photoBlock}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
            {photoBlock}
            {textBlock}
          </div>
        )}

        {finalWatermark ? (
          <div
            style={{
              display: 'flex',
              justifyContent: textAlign === 'center' ? 'center' : 'space-between',
              alignItems: 'center',
              marginTop: '18px',
              paddingTop: '14px',
              borderTop: `1px solid ${mood.id === 'dark' ? '#27272A' : '#E5E7EB'}`,
              fontSize: '21px',
              color: safeSubTextColor,
            }}
          >
            <span>{finalWatermark}</span>
          </div>
        ) : null}
      </div>
    );
  }

  const svg = await satori(element, {
    width,
    height,
    fonts: [
      {
        name: 'SlideFont',
        data: fontBuffer,
        weight: 400,
        style: 'normal',
      },
      {
        name: 'SlideFont',
        data: fontBuffer,
        weight: 700,
        style: 'normal',
      },
      {
        name: 'SlideFont',
        data: fontBuffer,
        weight: 800,
        style: 'normal',
      },
    ],
  });

  const jpegBuffer = await sharp(Buffer.from(svg))
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();

  return jpegBuffer;
}
