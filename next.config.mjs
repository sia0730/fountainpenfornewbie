import fs from 'fs';
import path from 'path';

// 초보자를 위해 눈에 보이는 'env.txt' 파일에 키를 입력하면 자동으로 환경 변수(.env.local)로 읽어오는 기능
const envTxtPath = path.join(process.cwd(), 'env.txt');
if (fs.existsSync(envTxtPath)) {
  const content = fs.readFileSync(envTxtPath, 'utf8');
  fs.writeFileSync(path.join(process.cwd(), '.env.local'), content, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['sharp', 'satori'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
};

export default nextConfig;
