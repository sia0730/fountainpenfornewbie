// src/app/api/posts/publish/route.ts
// [기능 2 & 기능 5] 지금 바로 올리기 / 예약해서 올리기 / 내 게시물 기록에서 실패한 게시물 다시 올리기를 처리합니다.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin, getUserFromRequest } from '@/lib/supabase';
import { decryptToken } from '@/lib/crypto';
import { publishToInstagramAccount, translateIgError } from '@/lib/instagram';
import { renderSlideToJpegBuffer } from '@/lib/renderer';
import { CAPTION_LIMITS } from '@/config/constants';

function countHashtags(text: string): number {
  const matches = text.match(/#[^\s#]+/g);
  return matches ? matches.length : 0;
}

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const { data: posts, error } = await admin
    .from('posts')
    .select(
      `
      *,
      post_targets (
        *,
        instagram_accounts (
          username,
          profile_picture_url
        )
      )
    `
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ posts: posts || [] });
}

export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const body = await req.json();
    const {
      retryTargetId,
      title = '인스타 카드뉴스',
      rawText = '',
      publishMode = 'auto_publish',
      slideCount = 1,
      aspectRatio = '4:5',
      fontId = 'Pretendard',
      customFontBase64 = '',
      moodId = 'minimal',
      accentColor = '#2563EB',
      watermarkText = '',
      showWatermark = false,
      captionTone = 'friendly',
      baseCaption = '',
      slides = [],
      uploadedPhotos = [],
      selectedAccounts = [], // [{ accountId, customCaption }]
      scheduleType = 'now', // 'now' | 'scheduled'
      scheduledAt = null,
    } = body;

    const admin = getSupabaseAdmin();

    // [내 게시물 기록]에서 "다시 올리기" 버튼을 눌렀을 때 처리
    if (retryTargetId) {
      const { data: target } = await admin
        .from('post_targets')
        .select('*, posts(*), instagram_accounts(*)')
        .eq('id', retryTargetId)
        .eq('user_id', user.id)
        .single();

      if (!target) {
        return NextResponse.json({ error: '다시 올릴 게시물 정보를 찾을 수 없습니다.' }, { status: 404 });
      }

      const plainToken = decryptToken(target.instagram_accounts.encrypted_access_token);
      const imageUrls: string[] = target.posts.rendered_image_urls || [];

      try {
        const result = await publishToInstagramAccount({
          igUserId: target.instagram_accounts.ig_user_id,
          accessToken: plainToken,
          imageUrls,
          caption: target.custom_caption,
        });

        await admin
          .from('post_targets')
          .update({
            status: 'published',
            published_at: new Date().toISOString(),
            ig_media_id: result.mediaId,
            ig_permalink: result.permalink,
            error_message: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', target.id);

        return NextResponse.json({ success: true, permalink: result.permalink });
      } catch (err) {
        const friendlyError = translateIgError(err);
        await admin
          .from('post_targets')
          .update({
            status: 'failed',
            error_message: friendlyError,
            retry_count: (target.retry_count || 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', target.id);

        return NextResponse.json({ error: friendlyError }, { status: 400 });
      }
    }

    // 캡션 글자 수 (2,200자) 및 해시태그 개수 (30개) 검증
    for (const accItem of selectedAccounts) {
      const cap = String(accItem.customCaption || baseCaption || '');
      if (cap.length > CAPTION_LIMITS.MAX_LENGTH) {
        return NextResponse.json(
          { error: `캡션 글자 수가 인스타 한도(${CAPTION_LIMITS.MAX_LENGTH}자)를 초과했습니다.` },
          { status: 400 }
        );
      }
      if (countHashtags(cap) > CAPTION_LIMITS.MAX_HASHTAGS) {
        return NextResponse.json(
          { error: `해시태그 개수가 인스타 한도(최대 ${CAPTION_LIMITS.MAX_HASHTAGS}개)를 초과했습니다.` },
          { status: 400 }
        );
      }
    }

    // 1. 서버에서 최종 JPEG 이미지를 렌더링하여 Supabase Storage 공개 URL로 업로드
    const publicImageUrls: string[] = [];
    for (let i = 0; i < slides.length; i++) {
      const jpegBuf = await renderSlideToJpegBuffer({
        slide: { ...slides[i], slideNumber: i + 1 },
        totalSlides: slides.length,
        aspectRatio,
        fontId,
        customFontBase64: customFontBase64 || undefined,
        moodId,
        accentColor,
        watermarkText,
        showWatermark,
      });

      const filePath = `${user.id}/post-${Date.now()}-slide-${i + 1}.jpg`;
      const { error: storageErr } = await admin.storage
        .from('post-images')
        .upload(filePath, jpegBuf, {
          contentType: 'image/jpeg',
          upsert: true,
        });

      if (storageErr) {
        throw new Error(`최종 JPEG 이미지 공개 저장소 업로드 실패: ${storageErr.message}`);
      }

      const { data: pubUrlData } = admin.storage.from('post-images').getPublicUrl(filePath);
      publicImageUrls.push(pubUrlData.publicUrl);
    }

    // 2. posts 테이블에 게시물 저장
    const { data: createdPost, error: postError } = await admin
      .from('posts')
      .insert({
        user_id: user.id,
        title: slides[0]?.headline || title,
        raw_text: rawText,
        publish_mode: publishMode,
        slide_count: slideCount,
        aspect_ratio: aspectRatio,
        font_family: fontId,
        mood_preset: moodId,
        accent_color: accentColor,
        caption_tone: captionTone,
        base_caption: baseCaption,
        slides,
        uploaded_photos: uploadedPhotos,
        rendered_image_urls: publicImageUrls,
      })
      .select('*')
      .single();

    if (postError || !createdPost) {
      throw new Error(postError?.message || '게시물 데이터베이스 저장 실패');
    }

    // 3. 선택한 각 인스타그램 계정에 대해 즉시 업로드 또는 예약 등록 실행
    const results = [];
    for (const item of selectedAccounts) {
      const { data: account } = await admin
        .from('instagram_accounts')
        .select('*')
        .eq('id', item.accountId)
        .eq('user_id', user.id)
        .single();

      if (!account) continue;

      const captionToUse = item.customCaption ?? baseCaption;

      if (scheduleType === 'scheduled' && scheduledAt) {
        // [예약 업로드]: 서버가 지정된 시간에 자동으로 실행하도록 DB에 예약 상태로 등록
        const { data: targetRow } = await admin
          .from('post_targets')
          .insert({
            post_id: createdPost.id,
            user_id: user.id,
            instagram_account_id: account.id,
            custom_caption: captionToUse,
            status: 'scheduled',
            scheduled_at: new Date(scheduledAt).toISOString(),
          })
          .select('*')
          .single();

        results.push({
          username: account.username,
          status: 'scheduled',
          targetId: targetRow?.id,
        });
      } else {
        // [지금 올리기]: 즉시 Instagram API 호출
        const { data: targetRow } = await admin
          .from('post_targets')
          .insert({
            post_id: createdPost.id,
            user_id: user.id,
            instagram_account_id: account.id,
            custom_caption: captionToUse,
            status: 'publishing',
            scheduled_at: new Date().toISOString(),
          })
          .select('*')
          .single();

        try {
          const accessToken = decryptToken(account.encrypted_access_token);
          const published = await publishToInstagramAccount({
            igUserId: account.ig_user_id,
            accessToken,
            imageUrls: publicImageUrls,
            caption: captionToUse,
          });

          await admin
            .from('post_targets')
            .update({
              status: 'published',
              published_at: new Date().toISOString(),
              ig_media_id: published.mediaId,
              ig_permalink: published.permalink,
              updated_at: new Date().toISOString(),
            })
            .eq('id', targetRow.id);

          results.push({
            username: account.username,
            status: 'published',
            permalink: published.permalink,
          });
        } catch (err) {
          const friendlyMsg = translateIgError(err);
          // 실패 시 쉬운 말로 이유를 저장하고, 서버 크론이 1번 자동 재시도하도록 retry_pending 설정
          await admin
            .from('post_targets')
            .update({
              status: 'retry_pending',
              error_message: friendlyMsg,
              retry_count: 0,
              updated_at: new Date().toISOString(),
            })
            .eq('id', targetRow.id);

          results.push({
            username: account.username,
            status: 'failed',
            error: friendlyMsg,
          });
        }
      }
    }

    return NextResponse.json({
      postId: createdPost.id,
      renderedImageUrls: publicImageUrls,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '업로드 처리 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
