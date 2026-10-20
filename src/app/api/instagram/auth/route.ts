// src/app/api/instagram/auth/route.ts
// [기능 2] "계정 추가" 버튼 클릭 시 Instagram API with Instagram Login OAuth 화면으로 이동합니다.
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 400 });
  }

  const clientId = process.env.INSTAGRAM_APP_ID;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const redirectUri = `${appUrl}/api/instagram/callback`;

  if (!clientId || clientId === 'your-instagram-app-id') {
    return NextResponse.redirect(
      `${appUrl}/?tab=accounts&error=${encodeURIComponent(
        '.env 파일에 INSTAGRAM_APP_ID가 아직 설정되지 않았습니다. 하단 안내서를 참고해 설정해 주세요.'
      )}`
    );
  }

  // Instagram API with Instagram Login 공식 스코프
  const scope = 'instagram_business_basic,instagram_business_content_publish';

  const authUrl = new URL('https://www.instagram.com/oauth/authorize');
  authUrl.searchParams.set('enable_fb_login', '0');
  authUrl.searchParams.set('force_authentication', '1');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('state', userId);

  return NextResponse.redirect(authUrl.toString());
}
