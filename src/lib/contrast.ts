// src/lib/contrast.ts
// [기능 4] 글자와 배경의 색 차이가 너무 작으면 자동으로 읽기 쉽게 조정하는 명도 대비 유틸리티입니다.

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '').trim();
  const fullHex =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const num = parseInt(fullHex, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function getRelativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const transform = (v: number) => {
    const sRGB = v / 255;
    return sRGB <= 0.03928 ? sRGB / 12.92 : Math.pow((sRGB + 0.055) / 1.055, 2.4);
  };
  const R = transform(r);
  const G = transform(g);
  const B = transform(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

export function getContrastRatio(hex1: string, hex2: string): number {
  const lum1 = getRelativeLuminance(hex1);
  const lum2 = getRelativeLuminance(hex2);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

/**
 * 배경색(bgHex) 대비 글자색 또는 포인트색(fgHex)의 명도 차이가 부족할 때
 * 자동으로 가독성이 높은 색상을 반환합니다.
 */
export function ensureReadableColor(fgHex: string, bgHex: string, minRatio = 4.2): string {
  try {
    const ratio = getContrastRatio(fgHex, bgHex);
    if (ratio >= minRatio) {
      return fgHex;
    }
    const bgLuminance = getRelativeLuminance(bgHex);
    // 배경이 밝으면 진한 색으로, 배경이 어두우면 밝은 색으로 자동 보정
    return bgLuminance > 0.45 ? '#111827' : '#F9FAFB';
  } catch {
    return fgHex;
  }
}

/**
 * 포인트 색상(accentHex) 위에 올라가는 뱃지 글자색을 자동 결정합니다.
 */
export function getReadableTextOnAccent(accentHex: string): string {
  try {
    const lum = getRelativeLuminance(accentHex);
    return lum > 0.42 ? '#111827' : '#FFFFFF';
  } catch {
    return '#FFFFFF';
  }
}
