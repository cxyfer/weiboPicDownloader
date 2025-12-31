const MOBILE_HOSTS = ['m.weibo.cn'];
const DESKTOP_HOSTS = ['weibo.com', 'www.weibo.com'];

export function parseWeiboUrl(input) {
  if (!input) return null;
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean).map(s => {
    try { return decodeURIComponent(s); } catch { return s; }
  });

  if (MOBILE_HOSTS.includes(host)) {
    return parseMobile(url, segments, input);
  }
  if (DESKTOP_HOSTS.includes(host)) {
    return parseDesktop(url, segments, input);
  }
  return null;
}

function parseMobile(url, segments, raw) {
  const first = segments[0];

  if (first === 'profile' && segments[1]) {
    return { type: 'user', raw, uid: segments[1], source: 'mobile' };
  }
  if (first === 'u' && segments[1]) {
    return { type: 'user', raw, uid: segments[1], source: 'mobile' };
  }
  if (first === 'n' && segments[1]) {
    return { type: 'user', raw, nickname: segments[1], source: 'mobile' };
  }
  if (first === 'p' && segments[1] === 'index') {
    const containerid = cleanContainerId(url.searchParams.get('containerid'));
    if (containerid) {
      return { type: 'supertopic', raw, containerid, source: 'mobile' };
    }
  }
  if (first === 'detail' && segments[1]) {
    return { type: 'post', raw, mid: segments[1], source: 'mobile' };
  }
  return null;
}

function parseDesktop(url, segments, raw) {
  const first = segments[0];

  if (first === 'u' && segments[1]) {
    return { type: 'user', raw, uid: segments[1], source: 'desktop' };
  }
  if (first === 'n' && segments[1]) {
    return { type: 'user', raw, nickname: segments[1], source: 'desktop' };
  }
  if (first === 'p' && segments[1]) {
    return { type: 'supertopic', raw, containerid: cleanContainerId(segments[1]), source: 'desktop' };
  }
  if (first === 'status' && segments[1]) {
    return { type: 'post', raw, bid: segments[1], source: 'desktop' };
  }
  if (segments.length === 2 && /^\d+$/.test(segments[0])) {
    return { type: 'post', raw, uid: segments[0], mid: segments[1], source: 'desktop' };
  }
  if (segments.length === 1 && segments[0]) {
    const token = segments[0];
    if (/^\d+$/.test(token)) {
      return { type: 'user', raw, uid: token, source: 'desktop' };
    }
    return { type: 'user', raw, nickname: token, source: 'desktop' };
  }
  return null;
}

function cleanContainerId(raw) {
  if (!raw) return null;
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { decoded = raw; }
  const match = decoded.match(/100808[0-9a-zA-Z]+/);
  return match ? match[0] : decoded.split('_')[0] || decoded;
}

export function parseWeiboInput(input) {
  if (!input) return null;
  const value = String(input).trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) {
    return parseWeiboUrl(value);
  }
  if (/^100808[0-9a-zA-Z]+$/.test(value)) {
    return { type: 'supertopic', raw: value, containerid: value, source: 'direct' };
  }
  if (/^\d+$/.test(value)) {
    return { type: 'user', raw: value, uid: value, source: 'direct' };
  }
  if (value.endsWith('超話') || value.endsWith('超话')) {
    const keyword = value.slice(0, -2).trim();
    if (keyword) {
      return { type: 'supertopic', raw: value, keyword, source: 'direct' };
    }
  }
  return { type: 'user', raw: value, nickname: value, source: 'direct' };
}
