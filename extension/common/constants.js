export const MOBILE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1';

export const DEFAULT_HEADERS = Object.freeze({
  'User-Agent': MOBILE_USER_AGENT,
  'Referer': 'https://m.weibo.cn/',
  'Accept': 'application/json, text/plain, */*',
  'X-Requested-With': 'XMLHttpRequest',
  'MWeibo-Pwa': '1'
});

export const API_ENDPOINTS = Object.freeze({
  CONTAINER: 'https://m.weibo.cn/api/container/getIndex',
  STATUS: 'https://m.weibo.cn/statuses/show'
});

export const DEFAULT_SETTINGS = Object.freeze({
  video: false,
  pageStart: 1,
  pageEnd: 0,
  intervalPage: 1,
  intervalDownload: 0,
  retry: 2,
  concurrency: 3,
  maxConcurrency: 10,
  autoDownload: false,
  dateRange: { start: null, end: null },
  overwrite: false,
  pathTemplateUser: 'weiboPic/{nickname}/{date:yyyy-MM-dd}_{filename}{ext}',
  pathTemplateSupertopic: 'weiboPic/SuperTopic/{nickname}/{date:yyyy-MM-dd}_{filename}{ext}'
});

export const STORAGE_KEYS = Object.freeze({
  SETTINGS: 'settings',
  TASKS: 'tasks',
  LOGIN_STATUS: 'loginStatus'
});
