import { API_ENDPOINTS, DEFAULT_HEADERS } from '../common/constants.js';
import { apiFetch, RateLimitError } from './apiClient.js';

export async function nicknameToUid(nickname) {
  if (!nickname) return null;
  const url = `https://m.weibo.cn/n/${encodeURIComponent(nickname)}`;
  try {
    const resp = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      redirect: 'follow',
      headers: DEFAULT_HEADERS
    });
    if (resp.ok && resp.url) {
      const match = /\/u\/(\d+)/.exec(resp.url);
      if (match) return match[1];
    }
  } catch {
    // Ignore fetch errors
  }
  return null;
}

export async function uidToContainerId(uid) {
  const url = buildUrl(API_ENDPOINTS.CONTAINER, { type: 'uid', value: uid });
  const { data } = await apiFetch(url, { redirect: 'follow' });
  const tabs = data?.data?.tabsInfo?.tabs || [];
  for (const tab of tabs) {
    if (tab?.tab_type === 'weibo' && tab.containerid) {
      return tab.containerid;
    }
  }
  return `107603${uid}`;
}

export async function searchSupertopic(keyword) {
  if (!keyword) return null;
  const encoded = encodeURIComponent(keyword);
  const url = `https://m.weibo.cn/api/container/getIndex?containerid=100103type%3D98%26q%3D${encoded}&page_type=searchall`;
  const { data } = await apiFetch(url);
  const cards = data?.data?.cards || [];

  for (const card of cards) {
    const group = Array.isArray(card?.card_group) ? card.card_group : [];
    for (const item of group) {
      const scheme = item?.scheme || '';
      const match = String(scheme).match(/100808[0-9a-zA-Z]+/);
      if (match) {
        const supertopicName = item?.title_sub || item?.title || item?.desc1 || keyword;
        return { containerid: match[0], supertopicName };
      }
    }
  }
  return null;
}

export async function fetchUserFeed(uid, options = {}) {
  const { video = false, pageStart = 1, pageEnd = 0, intervalPage = 1, dateRange } = options;
  const limit = normalizeLimit(dateRange);
  const containerid = await uidToContainerId(uid);
  const resources = [];
  const containerUrls = [];
  const seenMids = new Set();
  let username = null;
  let page = Math.max(1, pageStart);
  let emptyCount = 0;
  let finish = false;

  while (!finish && emptyCount < 3 && (pageEnd === 0 || page <= pageEnd)) {
    const url = buildUrl(API_ENDPOINTS.CONTAINER, { containerid, page });
    containerUrls.push(url);
    const { data } = await apiFetch(url);

    if (!username) {
      const screenName = data?.data?.userInfo?.screen_name;
      if (screenName) username = screenName;
    }

    if (data?.ok === -100) {
      throw new RateLimitError('Blocked or login required', { status: 200, data });
    }
    if (data?.ok !== 1) break;

    const cards = data?.data?.cards || [];
    if (!cards.length) {
      emptyCount++;
      page++;
      continue;
    }
    emptyCount = 0;

    for (const card of cards) {
      if (Number(card?.card_type) !== 9) continue;
      const mblog = card.mblog;
      if (!mblog) continue;

      const mid = String(mblog.mid || mblog.id || '');
      if (mid && seenMids.has(mid)) continue;
      if (mid) seenMids.add(mid);

      if (!username && mblog.user?.screen_name && String(mblog.user?.id) === String(uid)) {
        username = mblog.user.screen_name;
      }

      const pinned = card.profile_type_id === 'proweibotop_' || mblog.title === '置顶';
      const { base, media } = extractMedia(mblog, { video });

      if (!pinned) {
        if (limit.end && base.date > limit.end) continue;
        if (limit.start && base.date < limit.start) {
          finish = true;
          break;
        }
      }

      resources.push(...media);
    }

    page++;
    if (intervalPage > 0) await wait(intervalPage * 1000);
  }

  return { containerid, resources, containerUrls: containerUrls.slice(-50), username };
}

export async function fetchSupertopicFeed(containerid, options = {}) {
  const { video = false, pageStart = 1, pageEnd = 0, intervalPage = 1, dateRange } = options;
  const limit = normalizeLimit(dateRange);
  const resources = [];
  const containerUrls = [];
  let supertopicName = null;
  let page = Math.max(1, pageStart);
  let emptyCount = 0;
  let finish = false;

  while (!finish && emptyCount < 3 && (pageEnd === 0 || page <= pageEnd)) {
    const url = buildUrl(API_ENDPOINTS.CONTAINER, { containerid: `${containerid}_-_feed`, page });
    containerUrls.push(url);
    const { data } = await apiFetch(url);

    if (!supertopicName) {
      const titleTop = data?.data?.pageInfo?.title_top;
      if (titleTop && typeof titleTop === 'string') supertopicName = titleTop;
    }

    if (data?.ok === -100) {
      throw new RateLimitError('Blocked or login required', { status: 200, data });
    }
    if (data?.ok !== 1) break;

    const cards = flattenCards(data?.data?.cards || []);
    if (!cards.length) {
      emptyCount++;
      page++;
      continue;
    }
    emptyCount = 0;

    for (const card of cards) {
      if (Number(card?.card_type) !== 9) continue;
      const mblog = card.mblog;
      if (!mblog) continue;

      const { base, media } = extractMedia(mblog, { video });
      if (limit.end && base.date > limit.end) continue;
      if (limit.start && base.date < limit.start) {
        finish = true;
        break;
      }

      resources.push(...media);
    }

    page++;
    if (intervalPage > 0) await wait(intervalPage * 1000);
  }

  return { containerid, resources, containerUrls: containerUrls.slice(-50), supertopicName };
}

export async function fetchSinglePost(mid, options = {}) {
  const { video = false } = options;
  const url = buildUrl(API_ENDPOINTS.STATUS, { id: mid });
  const { data } = await apiFetch(url);
  const mblog = data?.data || data || {};
  const { base, media } = extractMedia(mblog, { video });
  return { ...base, resources: media };
}

export function parseWeiboDate(text) {
  const now = new Date();
  if (!text) return now;
  const val = String(text).trim();

  if (val.includes('前')) {
    const num = parseInt(val.match(/\d+/)?.[0] || '0', 10);
    if (val.includes('分钟') || val.includes('分鐘')) {
      return new Date(now.getTime() - num * 60 * 1000);
    }
    if (val.includes('小时') || val.includes('小時')) {
      return new Date(now.getTime() - num * 60 * 60 * 1000);
    }
    return now;
  }
  if (val.includes('昨天')) {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
  if (/^\d{2}-\d{2}$/.test(val)) {
    return new Date(`${now.getFullYear()}-${val}`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    return new Date(val);
  }

  const parsed = new Date(val);
  return Number.isNaN(parsed.getTime()) ? now : parsed;
}

function extractMedia(mblog, { video = false } = {}) {
  const mid = String(mblog?.id || mblog?.mid || '');
  const dateStr = mblog?.latest_update || mblog?.edit_at || mblog?.created_at || '';
  const date = parseWeiboDate(dateStr);
  const text = (mblog?.text || '').replace(/<[^>]+>/g, '').slice(0, 50);
  const base = { mid, date, text };
  const media = [];

  const primaryPics = Array.isArray(mblog?.pics) ? mblog.pics : [];
  const retweetPics = !primaryPics.length && Array.isArray(mblog?.retweeted_status?.pics)
    ? mblog.retweeted_status.pics : [];
  const picInfos = !primaryPics.length && !retweetPics.length ? mblog?.pic_infos : null;
  const retweetPicInfos = !primaryPics.length && !retweetPics.length
    ? mblog?.retweeted_status?.pic_infos : null;

  const photos = primaryPics.length ? primaryPics : retweetPics;
  if (photos.length) {
    photos.forEach((pic, idx) => {
      const normalized = normalizeUrl(pic?.large?.url || pic?.url);
      if (normalized && isValidMediaUrl(normalized)) {
        media.push({ ...base, type: 'photo', url: normalized, index: idx + 1 });
      }
    });
  } else {
    const infos = picInfos || retweetPicInfos;
    if (infos && typeof infos === 'object') {
      Object.values(infos).forEach((info, idx) => {
        const normalized = normalizeUrl(
          info?.largest?.url || info?.original?.url || info?.mw2000?.url ||
          info?.bmiddle?.url || info?.thumbnail?.url
        );
        if (normalized && isValidMediaUrl(normalized)) {
          media.push({ ...base, type: 'photo', url: normalized, index: idx + 1 });
        }
      });
    }
  }

  if (video && mblog?.page_info?.type === 'video') {
    const info = mblog.page_info.media_info || {};
    const videoUrl = normalizeUrl(
      info.stream_url_hd || info.mp4_720p_mp4 || info.mp4_hd_url || info.stream_url
    );
    if (videoUrl && isValidMediaUrl(videoUrl)) {
      media.push({ ...base, type: 'video', url: videoUrl, index: 1 });
    }
  }

  return { base, media };
}

function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function isValidMediaUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const normalized = normalizeUrl(url);
  if (!normalized) return false;

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    const allowed = ['sinaimg.cn', 'weibocdn.com', 'miaopai.com'];
    const allowedHost = allowed.some(d => host === d || host.endsWith(`.${d}`));
    if (!allowedHost) return false;

    const path = parsed.pathname.toLowerCase();
    if (path.endsWith('.html') || path.endsWith('.htm')) return false;
    return /\.(jpe?g|png|gif|webp|mp4|mov)$/i.test(path);
  } catch {
    return false;
  }
}

function flattenCards(cards) {
  const result = [];
  cards.forEach(card => {
    result.push(card);
    if (Array.isArray(card?.card_group)) {
      result.push(...card.card_group);
    }
  });
  return result;
}

function buildUrl(base, params = {}) {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null) url.searchParams.set(key, value);
  });
  return url.toString();
}

function normalizeLimit(range = {}) {
  const start = range?.start ? new Date(range.start) : null;
  const end = range?.end ? new Date(range.end) : null;
  return {
    start: start && !Number.isNaN(start.getTime()) ? start : null,
    end: end && !Number.isNaN(end.getTime()) ? end : null
  };
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
