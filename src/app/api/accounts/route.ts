// src/app/api/accounts/route.ts
// [기능 2] 연결된 인스타 계정 상태(정상/만료 임박/끊김) 확인, 만료 15일 전 자동 갱신, 하루 게시 한도 조회, 계정별 기본 설정 저장
import { NextResponse } from 'next/server';
import { getSupabaseAdmin, getUserFromRequest } from '@/lib/supabase';
import { decryptToken, encryptToken } from '@/lib/crypto';
import { checkPublishingLimit, refreshInstagramToken } from '@/lib/instagram';

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const { data: accounts, error } = await admin
    .from('instagram_accounts')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = Date.now();
  const fifteenDaysMs = 15 * 24 * 60 * 60 * 1000;

  const enrichedAccounts = await Promise.all(
    (accounts || []).map(async (acc) => {
      const expiresAtMs = new Date(acc.token_expires_at).getTime();
      let currentStatus = acc.status;
      let plainToken = '';

      try {
        plainToken = decryptToken(acc.encrypted_access_token);
      } catch {
        currentStatus = 'disconnected';
      }

      // 만료 15일 전이면 자동으로 갱신 시도
      if (plainToken && expiresAtMs > now && expiresAtMs - now <= fifteenDaysMs) {
        try {
          const refreshed = await refreshInstagramToken(plainToken);
          plainToken = refreshed.accessToken;
          currentStatus = 'active';
          await admin
            .from('instagram_accounts')
            .update({
              encrypted_access_token: encryptToken(refreshed.accessToken),
              token_expires_at: refreshed.expiresAt,
              status: 'active',
              updated_at: new Date().toISOString(),
            })
            .eq('id', acc.id);
          acc.token_expires_at = refreshed.expiresAt;
        } catch {
          currentStatus = 'expiring_soon';
        }
      } else if (expiresAtMs <= now) {
        currentStatus = 'expired';
      } else if (plainToken) {
        currentStatus = 'active';
      }

      // 하루 게시 한도(content_publishing_limit) 확인
      let quotaUsage = 0;
      let quotaLimit = 25;
      if (plainToken && currentStatus === 'active') {
        const limitInfo = await checkPublishingLimit(acc.ig_user_id, plainToken);
        quotaUsage = limitInfo.quotaUsage;
        quotaLimit = limitInfo.quotaTotal;
      }

      return {
        id: acc.id,
        user_id: acc.user_id,
        ig_user_id: acc.ig_user_id,
        username: acc.username,
        name: acc.name,
        profile_picture_url: acc.profile_picture_url,
        token_expires_at: acc.token_expires_at,
        status: currentStatus,
        default_font: acc.default_font,
        default_mood: acc.default_mood,
        default_accent_color: acc.default_accent_color,
        default_hashtags: acc.default_hashtags,
        quota_usage: quotaUsage,
        quota_limit: quotaLimit,
      };
    })
  );

  return NextResponse.json({ accounts: enrichedAccounts });
}

export async function PATCH(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const body = await req.json();
  const { accountId, default_font, default_mood, default_accent_color, default_hashtags } = body;

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from('instagram_accounts')
    .update({
      default_font,
      default_mood,
      default_accent_color,
      default_hashtags,
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
    .eq('user_id', user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('id');

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from('instagram_accounts')
    .delete()
    .eq('id', accountId)
    .eq('user_id', user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
