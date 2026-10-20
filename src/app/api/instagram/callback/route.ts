// src/app/api/instagram/callback/route.ts
// [기능 2] Instagram 로그인 완료 후 돌아오면 자동으로 장기 토큰을 발급받아 암호화 저장합니다.
import { NextResponse } from 'next/server';
import { exchangeCodeForLongLivedToken } from '@/lib/instagram';
import { encryptToken } from '@/lib/crypto';
import { getSupabaseAdmin } from '@/lib/supabase';
import { MAX_IG_ACCOUNTS } from '@/config/constants';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const userId = searchParams.get('state');
  const errorParam = searchParams.get('error_description') || searchParams.get('error');

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const redirectUri = `${appUrl}/api/instagram/callback`;

  if (errorParam || !code || !userId) {
    return NextResponse.redirect(
      `${appUrl}/?tab=accounts&error=${encodeURIComponent(
        errorParam || '인스타그램 로그인이 취소되었거나 실패했습니다.'
      )}`
    );
  }

  try {
    const admin = getSupabaseAdmin();

    // 현재 연결된 계정 수 확인 (최대 5개)
    const { count } = await admin
      .from('instagram_accounts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if ((count ?? 0) >= MAX_IG_ACCOUNTS) {
      return NextResponse.redirect(
        `${appUrl}/?tab=accounts&error=${encodeURIComponent(
          `인스타그램 계정은 최대 ${MAX_IG_ACCOUNTS}개까지만 연결할 수 있습니다.`
        )}`
      );
    }

    const tokenInfo = await exchangeCodeForLongLivedToken(code.replace('#_', ''), redirectUri);
    const encryptedAccessToken = encryptToken(tokenInfo.accessToken);

    const { error } = await admin.from('instagram_accounts').upsert(
      {
        user_id: userId,
        ig_user_id: tokenInfo.igUserId,
        username: tokenInfo.username,
        name: tokenInfo.name,
        profile_picture_url: tokenInfo.profilePictureUrl,
        encrypted_access_token: encryptedAccessToken,
        token_expires_at: tokenInfo.expiresAt,
        status: 'active',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,ig_user_id' }
    );

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.redirect(
      `${appUrl}/?tab=accounts&success=${encodeURIComponent(
        `@${tokenInfo.username} 계정이 성공적으로 연결되었습니다!`
      )}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : '계정 연결 중 오류가 발생했습니다.';
    return NextResponse.redirect(`${appUrl}/?tab=accounts&error=${encodeURIComponent(message)}`);
  }
}
