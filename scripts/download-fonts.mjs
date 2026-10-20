// scripts/download-fonts.mjs
// 프로젝트 설치(npm install) 및 빌드 시 무료 상업용 한국어 폰트 6종을 public/fonts 폴더에 자동 저장합니다.
import fs from 'fs';
import path from 'path';

const FONTS_DIR = path.join(process.cwd(), 'public', 'fonts');

const FONT_SOURCES = [
  {
    file: 'Pretendard-Regular.woff',
    url: 'https://cdn.jsdelivr.net/gh/Project-Noonnu/noonfonts_2107@1.1/Pretendard-Regular.woff',
  },
  {
    file: 'Pretendard-Bold.woff',
    url: 'https://cdn.jsdelivr.net/gh/Project-Noonnu/noonfonts_2107@1.1/Pretendard-Bold.woff',
  },
  {
    file: 'NotoSerifKR-Regular.otf',
    url: 'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Serif/OTF/Korean/NotoSerifCJKkr-Regular.otf',
  },
  {
    file: 'BlackHanSans-Regular.ttf',
    url: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/blackhansans/BlackHanSans-Regular.ttf',
  },
  {
    file: 'Jua-Regular.ttf',
    url: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/jua/Jua-Regular.ttf',
  },
  {
    file: 'GowunBatang-Regular.ttf',
    url: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/gowunbatang/GowunBatang-Regular.ttf',
  },
  {
    file: 'NanumPenScript-Regular.ttf',
    url: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumpenscript/NanumPenScript-Regular.ttf',
  },
];

async function downloadFonts() {
  if (!fs.existsSync(FONTS_DIR)) {
    fs.mkdirSync(FONTS_DIR, { recursive: true });
  }

  for (const font of FONT_SOURCES) {
    const dest = path.join(FONTS_DIR, font.file);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 10000) {
      continue;
    }
    try {
      console.log(`[폰트 준비 중] ${font.file} 다운로드 중...`);
      const res = await fetch(font.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(dest, buffer);
      console.log(`[완료] ${font.file}`);
    } catch (err) {
      console.warn(`[안내] ${font.file} 사전 다운로드 생략 (서버 실행 시 자동 로드됩니다):`, err.message);
    }
  }
}

downloadFonts();
