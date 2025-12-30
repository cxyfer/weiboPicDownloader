import { formatFilename } from './naming.js';
import { logger } from './logger.js';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../common/constants.js';

const DEFAULT_BASE_PATH = DEFAULT_SETTINGS.basePath || 'weiboPic';
let basePathCache = DEFAULT_BASE_PATH;
const MAX_RETRIES = 2;

export class DownloadManager {
  constructor(concurrency = 3) {
    this.concurrency = concurrency;
    this.pending = [];
    this.active = new Map();
    this.processing = new Map();
    this.completed = [];
    this.failed = [];

    this.handleDelta = this.handleDelta.bind(this);
    chrome.downloads.onChanged.addListener(this.handleDelta);

    chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
      for (const task of this.active.values()) {
        if (task.blobUrl === item.url) {
          suggestFilename(task, item.url, suggest);
          return true;
        }
      }
      if (this.processing.has(item.url)) {
        suggestFilename(this.processing.get(item.url), item.url, suggest);
        return true;
      }
      suggest();
    });

    const suggestFilename = (task, url, suggest) => {
      const { resource, options } = task;
      const opts = buildDownloadOptions(resource, options, url);
      logger.info(`[WPD] Enforcing filename via listener: ${opts.filename}`);
      suggest({ filename: opts.filename, conflictAction: opts.conflictAction });
    };

    logger.info('DownloadManager initialized, concurrency:', concurrency);

    loadBasePathFromStorage().catch(err => {
      logger.warn('Failed to load base path, using default:', err?.message || err);
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[STORAGE_KEYS.SETTINGS]) return;
      const next = changes[STORAGE_KEYS.SETTINGS].newValue || {};
      const nextPath = normalizeBasePath(next.basePath);
      if (nextPath !== basePathCache) {
        basePathCache = nextPath;
        logger.info('Base path updated:', basePathCache);
      }
    });
  }

  setConcurrency(value) {
    const old = this.concurrency;
    this.concurrency = Math.max(1, Math.min(10, value));
    if (old !== this.concurrency) {
      logger.info(`Concurrency updated from ${old} to ${this.concurrency}`);
      this.pump();
    }
  }

  enqueue(resource, options = {}) {
    const task = {
      resource,
      options,
      attempts: 0,
      id: crypto.randomUUID(),
      queuedAt: Date.now()
    };
    this.pending.push(task);
    logger.info(`Enqueued: ${resource.url} (Queue size: ${this.pending.length})`);
    this.pump();
    return task.id;
  }

  pump() {
    logger.info(`Pump check. Active: ${this.active.size}, Pending: ${this.pending.length}, Limit: ${this.concurrency}`);
    while (this.active.size < this.concurrency && this.pending.length > 0) {
      const task = this.pending.shift();
      this.startTask(task);
    }
  }

  async startTask(task) {
    task.attempts++;
    const { resource, options } = task;
    logger.info(`Starting download attempt ${task.attempts} for: ${resource.url}`);

    try {
      const blobUrl = await getBlobUrlFromOffscreen(resource.url);
      task.blobUrl = blobUrl;
      this.processing.set(blobUrl, task);

      const downloadOptions = buildDownloadOptions(resource, options, blobUrl);
      logger.info(`Download options generated for ${resource.index}:`, JSON.stringify(downloadOptions));
      logger.info(`[WPD] Final filename: ${downloadOptions.filename}`);

      let downloadId;
      try {
        downloadId = await chrome.downloads.download(downloadOptions);
      } finally {
        this.processing.delete(blobUrl);
      }

      if (downloadId === undefined) {
        const error = chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Unknown error starting download';
        throw new Error(error);
      }

      logger.info(`Chrome download started. ID: ${downloadId}, URL: ${resource.url}`);
      this.active.set(downloadId, task);

    } catch (error) {
      this.processing.delete(task.blobUrl);
      logger.error(`Start task failed for ${resource.url}: ${error.message}`);
      this.handleTaskFailure(task, error);
    }
  }

  handleDelta(delta) {
    const { id } = delta;
    if (!this.active.has(id)) return;

    const task = this.active.get(id);

    if (delta.state) {
      logger.info(`Download ${id} state changed: ${delta.state.current}`);
    }

    if (delta.state?.current === 'complete') {
      logger.info(`Download completed: ${id}`);
      this.cleanupTask(task);
      this.active.delete(id);
      this.completed.push(task);
      this.pump();
    } else if (delta.state?.current === 'interrupted') {
      const errorMsg = delta.error?.current || 'Interrupted';
      logger.error(`Download interrupted: ${id}, Reason: ${errorMsg}`);
      this.cleanupTask(task);
      this.active.delete(id);
      this.handleTaskFailure(task, new Error(errorMsg));
    }
  }

  cleanupTask(task) {
    if (task.blobUrl) {
      revokeBlobUrl(task.blobUrl);
      task.blobUrl = null;
    }
  }

  handleTaskFailure(task, error) {
    this.cleanupTask(task);
    if (task.attempts <= MAX_RETRIES) {
      logger.warn(`Retrying task ${task.id} (Attempt ${task.attempts})...`);
      this.pending.unshift(task);
      this.pump();
    } else {
      logger.error(`Task ${task.id} failed permanently after ${task.attempts} attempts.`);
      this.onTaskFailed(task, error);
      this.pump();
    }
  }

  onTaskFailed(task, error) {
    this.failed.push({ task, error: error?.message || String(error) });
  }

  stats() {
    return {
      pending: this.pending.length,
      active: this.active.size,
      completed: this.completed.length,
      failed: this.failed.length,
      concurrency: this.concurrency
    };
  }

  retryFailed() {
    logger.info(`Retrying ${this.failed.length} failed tasks.`);
    const toRetry = this.failed.splice(0);
    toRetry.forEach(({ task }) => {
      task.attempts = 0;
      this.pending.push(task);
    });
    this.pump();
  }
}

let creatingOffscreen;
async function setupOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: 'offscreen/offscreen.html',
    reasons: ['BLOBS'],
    justification: 'Fetching blobs for download to bypass CORS and naming restrictions'
  });

  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

async function getBlobUrlFromOffscreen(url) {
  await setupOffscreen();
  const maxRetries = 2;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'FETCH_BLOB_URL', url }, response => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response && response.ok) {
            resolve(response.blobUrl);
          } else {
            reject(new Error(response?.error || 'Unknown offscreen error'));
          }
        });
      });
    } catch (err) {
      if (i === maxRetries) throw err;
      logger.warn(`Retrying offscreen fetch... (${i + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

function revokeBlobUrl(url) {
  chrome.runtime.sendMessage({ type: 'REVOKE_BLOB_URL', url });
}

function buildDownloadOptions(resource, options = {}, blobUrl = null) {
  const { template = '{date}_{name}', userName = '', subfolderType = 'user', overwrite = false } = options;
  const filename = formatFilename(resource, template, userName);
  const subfolder = buildSubfolder(subfolderType, userName);

  return {
    url: blobUrl || resource.url,
    filename: `${subfolder}/${filename}`,
    saveAs: false,
    conflictAction: overwrite ? 'overwrite' : 'uniquify'
  };
}

function buildSubfolder(type, name) {
  const safeName = sanitizePathSegment(name || 'unknown');
  const basePath = normalizeBasePath(basePathCache);
  if (type === 'supertopic') {
    return `${basePath}/supertopic/${safeName}`;
  }
  return `${basePath}/${safeName}`;
}

function sanitizePathSegment(name) {
  return (name || '').replace(/[<>:"/\\|?*\n\r]+/g, '_').trim() || 'unknown';
}

function sanitizeBasePathSegment(name) {
  return (name || '').replace(/[<>:"|?*\n\r]+/g, '_').trim();
}

function normalizeBasePath(input) {
  const raw = (input || '').trim();
  if (!raw) return DEFAULT_BASE_PATH;
  const parts = raw.split(/[\\/]+/).map(sanitizeBasePathSegment).filter(Boolean);
  return parts.length ? parts.join('/') : DEFAULT_BASE_PATH;
}

async function loadBasePathFromStorage() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const settings = data[STORAGE_KEYS.SETTINGS] || DEFAULT_SETTINGS;
  basePathCache = normalizeBasePath(settings.basePath);
  logger.info('Base path loaded:', basePathCache);
}
