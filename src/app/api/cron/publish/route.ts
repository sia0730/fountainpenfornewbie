// src/app/api/cron/publish/route.ts
// [기능 2 & 기술] GitHub Actions가 매시간 호출하는 자동 예약 실행기입니다.
// 1) 예약 시간이 된 게시물을 서버에서 직접 렌더링/업로드합니다.
// 2) 실패했던 작업(retry_pending)은 자동으로 딱 한 번(retry_count < 1) 다시 시도합니다.
// 3) 만료 15일 전인 인스타 토큰을 찾아 자동으로 연장합니다.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { decryptToken, encryptToken } from '@/lib/crypto';
import {
  publishToInstagramAccount,
  refreshInstagramToken,
  translateIgError,
} from '@/lib/instagram';
import { renderSlideToJpegBuffer } from '@/lib/renderer';

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: '권한이 없는 크론 호출입니다.' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  // 1. 만료 15일 이내인 인스타 계정 토큰 자동 갱신
  const fifteenDaysLater = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();
  const { data: expiringAccounts } = await admin
    .from('instagram_accounts')
    .select('*')
    .lte('token_expires_at', fifteenDaysLater)
    .gt('token_expires_at', nowIso);

  let refreshedCount = 0;
  for (const acc of expiringAccounts || []) {
    try {
      const plain = decryptToken(acc.encrypted_access_token);
      const refreshed = await refreshInstagramToken(plain);
      await admin
        .from('instagram_accounts')
        .update({
          encrypted_access_token: encryptToken(refreshed.accessToken),
          token_expires_at: refreshed.expiresAt,
          status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', acc.id);
      refreshedCount++;
    } catch {
      await admin
        .from('instagram_accounts')
        .update({ status: 'expiring_soon' })
        .eq('id', acc.id);
    }
  }

  // 2. 예약 시간이 도래한 작업(scheduled) 또는 1회 자동 재시도 대기 중인 작업(retry_pending, retry_count < 1) 조회
  const { data: dueTargets } = await admin
    .from('post_targets')
    .select('*, posts(*), instagram_accounts(*)')
    .in('status', ['scheduled', 'retry_pending'])
    .lte('scheduled_at', nowIso)
    .lt('retry_count', 2)
    .limit(15);

  const processedResults = [];

  for (const target of dueTargets || []) {
    const isRetry = target.status === 'retry_pending';
    if (isRetry && target.retry_count >= 1) {
      // 이미 1번 재시도했는데도 실패한 경우 최종 실패(failed)로 마감
      await admin
        .from('post_targets')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', target.id);
      continue;
    }

    try {
      await admin
        .from('post_targets')
        .update({ status: 'publishing', updated_at: new Date().toISOString() })
        .eq('id', target.id);

      const post = target.posts;
      const account = target.instagram_accounts;
      const accessToken = decryptToken(account.encrypted_access_token);

      let imageUrls: string[] = post.rendered_image_urls || [];

      // 만약 렌더링된 공개 이미지 URL이 비어있다면 서버에서 즉시 satori + sharp로 JPEG 생성 후 업로드
      if (!imageUrls.length && Array.isArray(post.slides)) {
        for (let i = 0; i < post.slides.length; i++) {
          const jpegBuf = await renderSlideToJpegBuffer({
            slide: { ...post.slides[i], slideNumber: i + 1 },
            totalSlides: post.slides.length,
            aspectRatio: post.aspect_ratio || '4:5',
            fontId: post.font_family || 'Pretendard',
            moodId: post.mood_preset || 'minimal',
            accentColor: post.accent_color || '#2563EB',
            accountName: account.username,
          });
          const filePath = `${post.user_id}/cron-${post.id}-slide-${i + 1}.jpg`;
          await admin.storage.from('post-images').upload(filePath, jpegBuf, {
            contentType: 'image/jpeg',
            upsert: true,
          });
          const { data: pubData } = admin.storage.from('post-images').getPublicUrl(filePath);
          imageUrls.push(pubData.publicUrl);
        }
      }

      const published = await publishToInstagramAccount({
        igUserId: account.ig_user_id,
        accessToken,
        imageUrls,
        caption: target.custom_caption || post.base_caption,
      });

      await admin
        .from('post_targets')
        .update({
          status: 'published',
          published_at: new Date().toISOString(),
          ig_media_id: published.mediaId,
          ig_permalink: published.permalink,
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', target.id);

      processedResults.push({ id: target.id, status: 'published' });
    } catch (err) {
      const friendlyError = translateIgError(err);
      const nextRetryCount = (target.retry_count || 0) + 1;
      const nextStatus = nextRetryCount === 1 ? 'retry_pending' : 'failed';

      await admin
        .from('post_targets')
        .update({
          status: nextStatus,
          retry_count: nextRetryCount,
          error_message:
            nextStatus === 'retry_pending'
              ? `${friendlyError} (자동으로 1회 다시 시도 예정)`
              : friendlyError,
          updated_at: new Date().toISOString(),
        })
        .eq('id', target.id);

      processedResults.push({ id: target.id, status: nextStatus, error: friendlyError });
    }
  }

  return NextResponse.json({
    ok: true,
    refreshedTokens: refreshedCount,
    processedTargets: processedResults,
  });
}
