import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../common/constants.js';
import { parseWeiboUrl } from './urlParser.js';
import { nicknameToUid, fetchUserFeed, fetchSupertopicFeed, fetchSinglePost } from './weiboParser.js';
import { DownloadManager } from './downloads.js';
import { sanitizeFilename } from './naming.js';
import { logger } from './logger.js';

const debug = (...args) => logger.info('[DEBUG]', ...args);

const TASK_STATUS = {
  PENDING: 'pending',
  FETCHING: 'fetching',
  READY: 'ready',
  DOWNLOADING: 'downloading',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

const state = { tasks: [] };
const downloadManager = new DownloadManager(DEFAULT_SETTINGS.concurrency);

const REFERER_RULES = [
  {
    id: 1,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Referer', operation: 'set', value: 'https://m.weibo.cn/' },
        { header: 'Origin', operation: 'set', value: 'https://m.weibo.cn/' },
        { header: 'User-Agent', operation: 'set', value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1' },
        { header: 'Accept', operation: 'set', value: 'application/json, text/plain, */*' },
        { header: 'X-Requested-With', operation: 'set', value: 'XMLHttpRequest' },
        { header: 'MWeibo-Pwa', operation: 'set', value: '1' },
        { header: 'Sec-Fetch-Mode', operation: 'set', value: 'cors' },
        { header: 'Sec-Fetch-Site', operation: 'set', value: 'same-origin' }
      ],
      responseHeaders: [
        { header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' },
        { header: 'Access-Control-Allow-Methods', operation: 'set', value: 'GET, POST, OPTIONS' }
      ]
    },
    condition: {
      urlFilter: '*://*.sinaimg.cn/*',
      resourceTypes: ['xmlhttprequest', 'image', 'media', 'other', 'object']
    }
  },
  {
    id: 2,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Referer', operation: 'set', value: 'https://m.weibo.cn/' },
        { header: 'Origin', operation: 'set', value: 'https://m.weibo.cn/' },
        { header: 'User-Agent', operation: 'set', value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1' },
        { header: 'Accept', operation: 'set', value: 'application/json, text/plain, */*' },
        { header: 'X-Requested-With', operation: 'set', value: 'XMLHttpRequest' },
        { header: 'MWeibo-Pwa', operation: 'set', value: '1' },
        { header: 'Sec-Fetch-Mode', operation: 'set', value: 'cors' },
        { header: 'Sec-Fetch-Site', operation: 'set', value: 'same-origin' }
      ],
      responseHeaders: [
        { header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' },
        { header: 'Access-Control-Allow-Methods', operation: 'set', value: 'GET, POST, OPTIONS' }
      ]
    },
    condition: {
      urlFilter: '*://*.weibocdn.com/*',
      resourceTypes: ['xmlhttprequest', 'image', 'media', 'other', 'object']
    }
  }
];

async function setupRefererRule() {
  const ruleIds = REFERER_RULES.map(rule => rule.id);
  debug('Setting referer rules', ruleIds);
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: ruleIds,
      addRules: REFERER_RULES
    });
    console.log('[WPD] Referer rules set:', ruleIds);
  } catch (err) {
    console.error('[WPD] Failed to set referer rule', err);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await logger.init();
  logger.info('Extension installed/updated');
  debug('onInstalled: init defaults');
  await ensureDefaults();
  await setupRefererRule();
  await loadConcurrency();
  chrome.alarms.create('checkStatus', { periodInMinutes: 30 });
  chrome.alarms.create('taskPump', { periodInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(async () => {
  await logger.init();
  logger.info('Extension startup');
  debug('onStartup: load tasks');
  await ensureDefaults();
  await setupRefererRule();
  await loadTasks();
  await loadConcurrency();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  debug('Message received', msg?.type);
  const handler = handlers[msg?.type];
  if (!handler) {
    sendResponse({ ok: false, error: 'Unknown type' });
    return;
  }
  handler(msg.payload, sender)
    .then(data => sendResponse({ ok: true, data }))
    .catch(err => sendResponse({ ok: false, error: err?.message || String(err) }));
  return true;
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'checkStatus') refreshLogin();
  if (alarm.name === 'taskPump') refreshProgress();
});

chrome.downloads.onChanged.addListener(() => refreshProgress());

const handlers = {
  PING: async () => ({ ts: Date.now() }),
  CHECK_LOGIN: async () => {
    const status = await checkLogin();
    await chrome.storage.local.set({ [STORAGE_KEYS.LOGIN_STATUS]: status });
    return status;
  },
  START_TASK: async payload => startTask(payload),
  LIST_TASKS: async () => state.tasks,
  PAUSE_TASK: async ({ taskId }) => pauseTask(taskId),
  RESUME_TASK: async ({ taskId }) => resumeTask(taskId),
  CANCEL_TASK: async ({ taskId }) => cancelTask(taskId),
  RETRY_FAILED: async ({ taskId }) => retryFailed(taskId),
  CONFIRM_DOWNLOAD: async ({ taskId, selectedIndexes }) => confirmDownload(taskId, selectedIndexes),
  GET_SETTINGS: async () => {
    const data = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    return data[STORAGE_KEYS.SETTINGS] || DEFAULT_SETTINGS;
  },
  UPDATE_SETTINGS: async (payload) => {
    debug('Update settings payload', payload);
    const current = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    const settings = { ...(current[STORAGE_KEYS.SETTINGS] || DEFAULT_SETTINGS), ...payload };
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
    if (typeof payload.concurrency === 'number') {
      downloadManager.setConcurrency(payload.concurrency);
    }
    debug('Settings updated', settings);
    logger.info('Settings updated:', settings);
    return settings;
  },
  GET_LOGS: async () => {
    return logger.getLogs();
  },
  CLEAR_LOGS: async () => {
    logger.clear();
    return true;
  }
};

async function getSettings() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.SETTINGS] || {}) };
}

async function ensureDefaults() {
  const saved = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  if (!saved?.[STORAGE_KEYS.SETTINGS]) {
    debug('Seeding default settings');
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS });
  }
}

async function loadConcurrency() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const settings = data[STORAGE_KEYS.SETTINGS] || DEFAULT_SETTINGS;
  downloadManager.setConcurrency(settings.concurrency || DEFAULT_SETTINGS.concurrency);
  console.log('[WPD] Loaded concurrency:', settings.concurrency);
  debug('Loaded concurrency', settings.concurrency);
}

async function loadTasks() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.TASKS);
  const tasks = data[STORAGE_KEYS.TASKS] || [];
  tasks.forEach(task => {
    if (task.status === TASK_STATUS.FETCHING || task.status === TASK_STATUS.DOWNLOADING) {
      task.status = TASK_STATUS.PAUSED;
      task.message = '已暫停（重啟後需手動恢復）';
    }
  });
  state.tasks = tasks;
  await persistTasks();
  debug('Loaded tasks', { count: tasks.length });
}

async function persistTasks() {
  await chrome.storage.local.set({ [STORAGE_KEYS.TASKS]: state.tasks });
}

function findTask(taskId) {
  return state.tasks.find(t => t.id === taskId);
}

async function startTask(payload = {}) {
  const settings = await getSettings();
  const url = payload.url?.trim();
  if (!url) throw new Error('請提供有效網址');

  const parsed = parseWeiboUrl(url);
  if (!parsed) throw new Error('無法解析網址');

  debug('Start task', { url, parsed, autoDownload: settings.autoDownload });

  const nameTemplate = settings.nameTemplate || DEFAULT_SETTINGS.nameTemplate;
  const dateRange = settings.dateRange || DEFAULT_SETTINGS.dateRange;

  const task = {
    id: crypto.randomUUID(),
    url,
    type: parsed.type,
    parsed,
    options: {
      video: !!payload.video,
      nameTemplate,
      dateRange,
      overwrite: !!payload.overwrite,
      autoDownload: !!settings.autoDownload
    },
    status: TASK_STATUS.PENDING,
    createdAt: Date.now(),
    stats: { total: 0, done: 0, failed: 0 },
    resources: [],
    meta: {},
    message: ''
  };

  state.tasks.unshift(task);
  await persistTasks();
  broadcast(task);

  runTask(task).catch(err => setTaskStatus(task, TASK_STATUS.FAILED, err?.message));
  debug('Task queued', { taskId: task.id, type: task.type });
  return { taskId: task.id };
}

async function runTask(task) {
  if (!task || task.status === TASK_STATUS.PAUSED) {
    debug('runTask skipped', { taskId: task?.id, status: task?.status });
    return;
  }
  await setTaskStatus(task, TASK_STATUS.FETCHING, '正在取得資源...');
  debug('Fetching resources', { taskId: task.id, type: task.type });

  const result = await fetchResources(task);
  task.resources = result.resources;
  task.meta = result.meta;
  task.stats.total = task.resources.length;
  debug('Resources fetched', { taskId: task.id, total: task.resources.length, meta: task.meta });

  if (!task.resources.length) {
    await setTaskStatus(task, TASK_STATUS.FAILED, '找不到可下載的資源');
    return;
  }

  if (task.options.autoDownload) {
    debug('Auto-download enabled', { taskId: task.id, total: task.resources.length });
    await setTaskStatus(task, TASK_STATUS.DOWNLOADING, '自動下載中');
    enqueueResources(task);
    return;
  }

  await setTaskStatus(task, TASK_STATUS.READY, `已取得 ${task.resources.length} 項資源，請確認後下載`);
}

async function fetchResources(task) {
  const opts = {
    video: task.options.video,
    dateRange: task.options.dateRange
  };

  if (task.type === 'user') {
    const uid = task.parsed.uid || (task.parsed.nickname ? await nicknameToUid(task.parsed.nickname) : null);
    if (!uid) throw new Error('無法解析 UID');
    debug('Resolved UID', { uid, nickname: task.parsed.nickname });

    const result = await fetchUserFeed(uid, opts);
    // Fallback order: username → nickname → uid_{uid}
    const targetName = result.username || task.parsed.nickname || `uid_${uid}`;
    debug('User feed fetched', { uid, username: result.username, targetName, count: result.resources.length });

    return {
      resources: result.resources.map((r, i) => ({ ...r, _taskId: task.id, index: r.index || i + 1 })),
      meta: {
        uid,
        username: result.username,
        containerid: result.containerid,
        targetName,
        containerUrls: result.containerUrls || []
      }
    };
  }

  if (task.type === 'supertopic') {
    const { containerid } = task.parsed;
    if (!containerid) throw new Error('缺少 containerid');
    debug('Fetching supertopic feed', { containerid });
    const result = await fetchSupertopicFeed(containerid, opts);
    const targetName = result.supertopicName || containerid;
    debug('Supertopic feed fetched', { containerid, supertopicName: result.supertopicName, targetName, count: result.resources.length });
    return {
      resources: result.resources.map((r, i) => ({ ...r, _taskId: task.id, index: r.index || i + 1 })),
      meta: {
        containerid,
        supertopicName: result.supertopicName,
        targetName,
        containerUrls: result.containerUrls || []
      }
    };
  }

  if (task.type === 'post') {
    const mid = task.parsed.mid || bidToMid(task.parsed.bid);
    if (!mid) throw new Error('無法解析微博 ID');
    debug('Fetching single post', { mid });
    const result = await fetchSinglePost(mid, opts);
    return {
      resources: (result.resources || []).map((r, i) => ({ ...r, _taskId: task.id, index: r.index || i + 1 })),
      meta: { mid, targetName: mid, containerUrls: result.containerUrls || [] }
    };
  }

  throw new Error('不支援的類型');
}

function enqueueResources(task, selectedIndexes) {
  const subfolderType = task.type === 'supertopic' ? 'supertopic' : 'user';
  const targetName = sanitize(task.meta?.targetName || 'weibo');
  const allowed = Array.isArray(selectedIndexes) && selectedIndexes.length
    ? new Set(selectedIndexes.map(Number))
    : null;

  debug('Enqueue resources', {
    taskId: task.id,
    total: task.resources.length,
    selected: allowed ? allowed.size : task.resources.length
  });

  task.resources.forEach(res => {
    if (res._state === 'completed' || res._enqueued) return;
    if (allowed && !allowed.has(Number(res.index))) return;
    res._enqueued = true;
    downloadManager.enqueue(res, {
      template: task.options.nameTemplate,
      userName: targetName,
      subfolderType,
      overwrite: task.options.overwrite
    });
  });
}

async function confirmDownload(taskId, selectedIndexes) {
  const task = findTask(taskId);
  if (!task) throw new Error('任務不存在');
  if (task.status !== TASK_STATUS.READY) throw new Error('任務狀態錯誤，無法確認下載');
  debug('Confirm download', { taskId, selectedIndexes });

  const selected = Array.isArray(selectedIndexes) && selectedIndexes.length
    ? selectedIndexes : task.resources.map(r => r.index);
  task.stats.total = selected.length;

  await setTaskStatus(task, TASK_STATUS.DOWNLOADING, '下載中');
  enqueueResources(task, selected);
  return task;
}

async function pauseTask(taskId) {
  const task = findTask(taskId);
  if (!task) throw new Error('任務不存在');
  debug('Pause task', { taskId });
  await setTaskStatus(task, TASK_STATUS.PAUSED, '已暫停');
  return task;
}

async function resumeTask(taskId) {
  const task = findTask(taskId);
  if (!task) throw new Error('任務不存在');
  if (task.status !== TASK_STATUS.PAUSED && task.status !== TASK_STATUS.FAILED) return task;
  debug('Resume task', { taskId, status: task.status });

  if (!task.resources.length) {
    runTask(task).catch(err => setTaskStatus(task, TASK_STATUS.FAILED, err?.message));
    return task;
  }

  await setTaskStatus(task, TASK_STATUS.DOWNLOADING, '恢復下載中');
  enqueueResources(task);
  return task;
}

async function cancelTask(taskId) {
  const idx = state.tasks.findIndex(t => t.id === taskId);
  if (idx === -1) throw new Error('任務不存在');
  state.tasks.splice(idx, 1);
  await persistTasks();
  debug('Cancel task', { taskId });
  return { removed: true };
}

async function retryFailed(taskId) {
  const task = findTask(taskId);
  if (!task) throw new Error('任務不存在');
  debug('Retry failed', { taskId });

  task.resources.forEach(res => {
    if (res._state === 'failed') {
      res._state = null;
      res._enqueued = false;
    }
  });

  await setTaskStatus(task, TASK_STATUS.DOWNLOADING, '重試失敗項目');
  enqueueResources(task);
  return task;
}

async function setTaskStatus(task, status, message) {
  task.status = status;
  task.message = message || '';
  task.updatedAt = Date.now();
  await persistTasks();
  broadcast(task);
  debug('Task status updated', { taskId: task.id, status, message });
}

function refreshProgress() {
  downloadManager.completed.forEach(entry => {
    if (entry.resource) entry.resource._state = 'completed';
  });
  downloadManager.failed.forEach(({ task }) => {
    if (task?.resource) task.resource._state = 'failed';
  });

  state.tasks.forEach(task => {
    if (!task.resources.length) return;
    if (task.status === TASK_STATUS.READY) return;

    const done = task.resources.filter(r => r._state === 'completed').length;
    const failed = task.resources.filter(r => r._state === 'failed').length;
    const enqueued = task.resources.filter(r => r._enqueued).length;

    // Use enqueued count as total if partial selection was made
    const total = enqueued > 0 ? enqueued : task.resources.length;
    task.stats = { total, done, failed };

    if (task.status === TASK_STATUS.DOWNLOADING && done + failed >= total) {
      task.status = failed > 0 ? TASK_STATUS.FAILED : TASK_STATUS.COMPLETED;
      task.message = task.status === TASK_STATUS.COMPLETED ? '已完成' : '部分失敗';
      debug('Task finished', { taskId: task.id, status: task.status, done, failed });
      broadcast(task);
    }
  });

  persistTasks();
}

function bidToMid(bid) {
  if (!bid) return null;
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let mid = 0;
  for (const ch of bid) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) return null;
    mid = mid * alphabet.length + idx;
  }
  return String(mid);
}

function sanitize(text) {
  return sanitizeFilename((text || '').replace(/\//g, '_')).replace(/\.[^/.]+$/, '') || 'weibo';
}

async function checkLogin() {
  const [desktop, mobile] = await Promise.all([
    chrome.cookies.getAll({ domain: 'weibo.com', name: 'SUB' }),
    chrome.cookies.getAll({ domain: 'm.weibo.cn', name: 'SUB' })
  ]);
  debug('Check login', { desktop: desktop.length, mobile: mobile.length });
  return {
    loggedIn: desktop.length > 0 || mobile.length > 0,
    desktop: desktop.length > 0,
    mobile: mobile.length > 0,
    ts: Date.now()
  };
}

async function refreshLogin() {
  const status = await checkLogin();
  await chrome.storage.local.set({ [STORAGE_KEYS.LOGIN_STATUS]: status });
  debug('Login status refreshed', status);
}

function broadcast(task) {
  chrome.runtime.sendMessage({ type: 'TASK_UPDATED', task }).catch(() => { });
  debug('Broadcast task update', { taskId: task?.id, status: task?.status });
}
