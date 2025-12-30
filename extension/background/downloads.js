import { formatPath } from './naming.js';
import { logger } from './logger.js';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../common/constants.js';

const MAX_RETRIES = 2;

export class DownloadManager {
  constructor(concurrency = 3) {
    this.concurrency = concurrency;
    this.intervalDownload = 0;
    this.lastDownloadTime = 0;
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
  }

  setConcurrency(value) {
    const old = this.concurrency;
    this.concurrency = Math.max(1, Math.min(10, value));
    if (old !== this.concurrency) {
      logger.info(`Concurrency updated from ${old} to ${this.concurrency}`);
      this.pump();
    }
  }

  setIntervalDownload(value) {
    this.intervalDownload = Math.max(0, Number(value) || 0);
    logger.info(`IntervalDownload set to ${this.intervalDownload}s`);
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

    if (this.intervalDownload > 0) {
      const elapsed = Date.now() - this.lastDownloadTime;
      const wait = this.intervalDownload * 1000 - elapsed;
      if (wait > 0) {
        logger.info(`Waiting ${wait}ms for download interval`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
    this.lastDownloadTime = Date.now();

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
  const { pathTemplate = DEFAULT_SETTINGS.pathTemplateUser, nickname = '', id = '', overwrite = false } = options;
  const filename = formatPath(resource, pathTemplate, { nickname, id });

  return {
    url: blobUrl || resource.url,
    filename,
    saveAs: false,
    conflictAction: overwrite ? 'overwrite' : 'uniquify'
  };
}

function sanitizePathSegment(name) {
  return (name || '').replace(/[<>:"/\\|?*\n\r]+/g, '_').trim() || 'unknown';
}
