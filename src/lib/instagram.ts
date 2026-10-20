// src/lib/instagram.ts
// [기능 2 & 지켜야 할 것] Instagram API with Instagram Login OAuth, 장기 토큰 갱신,
// 하루 게시 한도(content_publishing_limit) 확인, 컨테이너 생성 → 완료 대기 → media_publish 전체 과정 구현
import { IG_DAILY_PUBLISH_LIMIT } from '@/config/constants';

const GRAPH_BASE = 'https://graph.instagram.com/v21.0';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 인스타그램 API 오류 메시지를 초보자도 이해하기 쉬운 한국어 안내문으로 변환합니다.
 */
export function translateIgError(rawError: unknown): string {
  const msg = rawError instanceof Error ? rawError.message : String(rawError);
  if (msg.includes('190') || msg.toLowerCase().includes('access token')) {
    return '인스타그램 로그인 연결이 만료되었습니다. [내 계정들] 메뉴에서 계정을 다시 연결해 주세요.';
  }
  if (msg.includes('9007') || msg.toLowerCase().includes('media') || msg.includes('36003')) {
    return '이미지를 인스타그램 서버에서 읽지 못했습니다. 공개 이미지 주소(URL)인지 확인 후 다시 시도해 주세요.';
  }
  if (msg.includes('4') || msg.toLowerCase().includes('limit') || msg.includes('quota')) {
    return '인스타그램 하루 자동 게시 한도를 초과했습니다. 내일 다시 시도하거나 인스타 앱에서 직접 올려주세요.';
  }
  if (msg.includes('2207026') || msg.toLowerCase().includes('aspect ratio')) {
    return '이미지 비율이 인스타그램 규격(4:5 또는 1:1)과 맞지 않습니다.';
  }
  return `인스타그램 업로드 중 일시적인 오류가 발생했습니다: ${msg}`;
}

/**
 * 1) Instagram OAuth 인가 코드를 단기 토큰 → 60일 장기 토큰으로 교환하고 프로필 정보를 가져옵니다.
 */
export async function exchangeCodeForLongLivedToken(code: string, redirectUri: string) {
  const clientId = process.env.INSTAGRAM_APP_ID || '';
  const clientSecret = process.env.INSTAGRAM_APP_SECRET || '';

  // Step A: 단기 액세스 토큰 발급
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code,
  });

  const shortRes = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    body: form,
  });
  const shortData = await shortRes.json();
  if (!shortRes.ok || !shortData.access_token) {
    throw new Error(shortData.error_message || '인스타그램 단기 토큰 발급에 실패했습니다.');
  }

  // Step B: 60일 장기 액세스 토큰으로 교환
  const longUrl = new URL('https://graph.instagram.com/access_token');
  longUrl.searchParams.set('grant_type', 'ig_exchange_token');
  longUrl.searchParams.set('client_secret', clientSecret);
  longUrl.searchParams.set('access_token', shortData.access_token);

  const longRes = await fetch(longUrl.toString());
  const longData = await longRes.json();
  const finalToken = longData.access_token || shortData.access_token;
  const expiresInSeconds = longData.expires_in || 60 * 24 * 3600; // 기본 60일

  // Step C: 계정 프로필 정보 조회 (user_id, username, name, profile_picture_url)
  const meUrl = new URL(`${GRAPH_BASE}/me`);
  meUrl.searchParams.set('fields', 'user_id,username,name,profile_picture_url');
  meUrl.searchParams.set('access_token', finalToken);

  const meRes = await fetch(meUrl.toString());
  const meData = await meRes.json();
  if (!meRes.ok || !meData.username) {
    throw new Error(meData.error?.message || '인스타그램 계정 프로필 정보를 가져오지 못했습니다.');
  }

  return {
    igUserId: String(meData.user_id || meData.id || shortData.user_id),
    username: String(meData.username),
    name: String(meData.name || meData.username),
    profilePictureUrl: String(meData.profile_picture_url || ''),
    accessToken: finalToken,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
  };
}

/**
 * 2) 만료 15일 전인 장기 토큰을 자동으로 60일 연장합니다.
 */
export async function refreshInstagramToken(currentToken: string): Promise<{
  accessToken: string;
  expiresAt: string;
}> {
  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', currentToken);

  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error?.message || '토큰 갱신 실패');
  }
  const expiresIn = data.expires_in || 60 * 24 * 3600;
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

/**
 * 3) [기능 2] 계정별 하루 게시 한도(Instagram content_publishing_limit) 확인
 */
export async function checkPublishingLimit(
  igUserId: string,
  accessToken: string
): Promise<{ quotaUsage: number; quotaTotal: number; canPublish: boolean }> {
  try {
    const url = new URL(`${GRAPH_BASE}/${igUserId}/content_publishing_limit`);
    url.searchParams.set('fields', 'config,quota_usage');
    url.searchParams.set('access_token', accessToken);

    const res = await fetch(url.toString());
    const json = await res.json();
    const item = json?.data?.[0];
    const quotaUsage = typeof item?.quota_usage === 'number' ? item.quota_usage : 0;
    const quotaTotal =
      typeof item?.config?.quota_total === 'number'
        ? item.config.quota_total
        : IG_DAILY_PUBLISH_LIMIT;

    return {
      quotaUsage,
      quotaTotal,
      canPublish: quotaUsage < quotaTotal,
    };
  } catch {
    return {
      quotaUsage: 0,
      quotaTotal: IG_DAILY_PUBLISH_LIMIT,
      canPublish: true,
    };
  }
}

/**
 * 4) 컨테이너 처리 상태가 FINISHED가 될 때까지 폴링하며 기다립니다.
 */
async function waitUntilContainerReady(containerId: string, accessToken: string) {
  const maxAttempts = 15;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const statusUrl = new URL(`${GRAPH_BASE}/${containerId}`);
    statusUrl.searchParams.set('fields', 'status_code,status');
    statusUrl.searchParams.set('access_token', accessToken);

    const res = await fetch(statusUrl.toString());
    const data = await res.json();

    if (data.status_code === 'FINISHED' || data.status_code === 'PUBLISHED') {
      return;
    }
    if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED') {
      throw new Error(`인스타그램 이미지 컨테이너 처리 실패 (${data.status || data.status_code})`);
    }
    await sleep(2200);
  }
}

/**
 * 5) [지켜야 할 것] 인스타에 올리는 정석 순서:
 * - 1장일 때: 단일 이미지 컨테이너 만들기 → 처리 완료 대기 → media_publish
 * - 2장 이상일 때: 장마다 이미지 컨테이너(is_carousel_item=true) 만들기 → 캐러셀 컨테이너 만들기 → 처리 완료 대기 → media_publish
 */
export async function publishToInstagramAccount(params: {
  igUserId: string;
  accessToken: string;
  imageUrls: string[]; // 반드시 외부에서 접근 가능한 공개 JPEG URL이어야 함
  caption: string;
}): Promise<{ mediaId: string; permalink: string }> {
  const { igUserId, accessToken, imageUrls, caption } = params;

  if (!imageUrls.length) {
    throw new Error('업로드할 이미지가 없습니다.');
  }

  // 하루 게시 한도 먼저 확인
  const quota = await checkPublishingLimit(igUserId, accessToken);
  if (!quota.canPublish) {
    throw new Error(
      `오늘 인스타그램 업로드 한도(${quota.quotaTotal}회)를 모두 사용했습니다. 내일 다시 시도해 주세요.`
    );
  }

  let creationId = '';

  if (imageUrls.length === 1) {
    // [1장: 단일 이미지 게시물]
    const singleUrl = new URL(`${GRAPH_BASE}/${igUserId}/media`);
    singleUrl.searchParams.set('image_url', imageUrls[0]);
    singleUrl.searchParams.set('caption', caption);
    singleUrl.searchParams.set('access_token', accessToken);

    const res = await fetch(singleUrl.toString(), { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.id) {
      throw new Error(data.error?.message || '단일 이미지 컨테이너 생성 실패');
    }
    creationId = data.id;
    await waitUntilContainerReady(creationId, accessToken);
  } else {
    // [2장 ~ 10장: 캐러셀(여러 장 넘겨보는) 게시물]
    const childContainerIds: string[] = [];

    for (const imgUrl of imageUrls.slice(0, 10)) {
      const itemUrl = new URL(`${GRAPH_BASE}/${igUserId}/media`);
      itemUrl.searchParams.set('image_url', imgUrl);
      itemUrl.searchParams.set('is_carousel_item', 'true');
      itemUrl.searchParams.set('access_token', accessToken);

      const itemRes = await fetch(itemUrl.toString(), { method: 'POST' });
      const itemData = await itemRes.json();
      if (!itemRes.ok || !itemData.id) {
        throw new Error(itemData.error?.message || '캐러셀 개별 이미지 컨테이너 생성 실패');
      }
      await waitUntilContainerReady(itemData.id, accessToken);
      childContainerIds.push(itemData.id);
    }

    // 캐러셀 묶음 컨테이너 생성
    const carouselUrl = new URL(`${GRAPH_BASE}/${igUserId}/media`);
    carouselUrl.searchParams.set('media_type', 'CAROUSEL');
    carouselUrl.searchParams.set('children', childContainerIds.join(','));
    carouselUrl.searchParams.set('caption', caption);
    carouselUrl.searchParams.set('access_token', accessToken);

    const carouselRes = await fetch(carouselUrl.toString(), { method: 'POST' });
    const carouselData = await carouselRes.json();
    if (!carouselRes.ok || !carouselData.id) {
      throw new Error(carouselData.error?.message || '캐러셀 컨테이너 생성 실패');
    }
    creationId = carouselData.id;
    await waitUntilContainerReady(creationId, accessToken);
  }

  // 최종 게시 (media_publish)
  const publishUrl = new URL(`${GRAPH_BASE}/${igUserId}/media_publish`);
  publishUrl.searchParams.set('creation_id', creationId);
  publishUrl.searchParams.set('access_token', accessToken);

  const publishRes = await fetch(publishUrl.toString(), { method: 'POST' });
  const publishData = await publishRes.json();
  if (!publishRes.ok || !publishData.id) {
    throw new Error(publishData.error?.message || '인스타그램 최종 게시(media_publish) 실패');
  }

  const mediaId = String(publishData.id);

  // 게시된 인스타그램 게시물의 실제 링크(permalink) 조회
  let permalink = 'https://www.instagram.com/';
  try {
    const linkUrl = new URL(`${GRAPH_BASE}/${mediaId}`);
    linkUrl.searchParams.set('fields', 'permalink');
    linkUrl.searchParams.set('access_token', accessToken);
    const linkRes = await fetch(linkUrl.toString());
    const linkData = await linkRes.json();
    if (linkData.permalink) {
      permalink = linkData.permalink;
    }
  } catch {
    // permalink 조회 실패 시 기본 인스타 주소 유지
  }

  return { mediaId, permalink };
}
