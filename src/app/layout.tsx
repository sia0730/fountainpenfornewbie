import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '인스타 오토 스튜디오 | AI 카드뉴스 자동 제작 & 예약 업로드',
  description:
    '사진과 메모만 올리면 AI가 인스타그램 카드뉴스를 자동으로 디자인하고 원하는 계정에 바로 올려드립니다.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
