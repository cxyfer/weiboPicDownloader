const $ = id => document.getElementById(id);
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tab-panel');

const loginStatus = $('login-status');
const statusMessage = $('status-message');
const taskList = $('task-list');
const form = $('task-form');
const settingsForm = $('settings-form');
const concurrencyInput = $('concurrency-input');
const settingsStatus = $('settings-status');
const logsContainer = $('logs-container');
const btnRefreshLogs = $('btn-refresh-logs');
const btnClearLogs = $('btn-clear-logs');

const state = { tasks: [], expanded: {}, debugExpanded: {}, logs: [] };
const STATUS_TEXT = {
  pending: '等待中',
  fetching: '讀取中',
  ready: '待確認',
  downloading: '下載中',
  paused: '已暫停',
  completed: '已完成',
  failed: '失敗'
};

tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.target)));

// Logs handlers
btnRefreshLogs?.addEventListener('click', fetchLogs);
btnClearLogs?.addEventListener('click', async () => {
  if (confirm('確定要清除所有日誌嗎？')) {
    await chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' });
    fetchLogs();
  }
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  const url = $('url-input').value.trim();
  if (!url) {
    setStatus('請輸入網址', true);
    return;
  }

  const payload = {
    url,
    video: $('video-checkbox').checked,
    dateRange: {
      start: $('date-start').value || null,
      end: $('date-end').value || null
    },
    nameTemplate: $('name-template').value.trim() || '{date}_{name}'
  };

  setStatus('送出中...');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'START_TASK', payload });
    if (res?.ok) {
      setStatus('任務已加入');
      form.reset();
      refreshTasks();
    } else {
      setStatus(res?.error || '送出失敗', true);
    }
  } catch (err) {
    setStatus(err.message, true);
  }
});

chrome.runtime.onMessage.addListener(msg => {
  if (msg?.type === 'TASK_UPDATED' && msg.task) {
    upsertTask(msg.task);
    renderTasks();
  }
  if (msg?.type === 'LOG_ENTRY' && msg.entry) {
    state.logs.unshift(msg.entry);
    if (document.querySelector('#tab-logs.active')) {
      renderLogs();
    }
  }
});

function switchTab(targetId) {
  tabs.forEach(tab => {
    const active = tab.dataset.target === targetId;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active);
  });
  panels.forEach(panel => panel.classList.toggle('active', panel.id === targetId));

  if (targetId === 'tab-logs') {
    fetchLogs();
  }
}

async function checkLogin() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'CHECK_LOGIN' });
    const ok = res?.ok && res.data?.loggedIn;
    loginStatus.textContent = ok ? '已登入' : '未登入';
    loginStatus.className = ok ? 'ok' : 'warn';
  } catch {
    loginStatus.textContent = '無法檢查';
    loginStatus.className = 'warn';
  }
}

async function fetchLogs() {
  try {
    const logs = await chrome.runtime.sendMessage({ type: 'GET_LOGS' });
    state.logs = Array.isArray(logs) ? logs : [];
    renderLogs();
  } catch (err) {
    logsContainer.innerHTML = `<p class="muted">無法讀取日誌: ${err.message}</p>`;
  }
}

function renderLogs() {
  if (!state.logs.length) {
    logsContainer.innerHTML = '<p class="muted">暫無日誌。</p>';
    return;
  }

  const html = state.logs.map(log => {
    const date = new Date(log.ts).toLocaleTimeString();
    return `
      <div class="log-entry">
        <span class="log-ts">[${date}]</span>
        <span class="log-level ${log.level}">${log.level}</span>
        <span class="log-msg">${escapeHtml(log.msg)}</span>
      </div>
    `;
  }).join('');

  logsContainer.innerHTML = html;
}

async function refreshTasks() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'LIST_TASKS' });
    const tasks = res?.ok ? res.data : (Array.isArray(res) ? res : []);
    state.tasks = tasks;
    renderTasks();
  } catch (err) {
    taskList.innerHTML = `<p class="muted">錯誤：${err.message}</p>`;
  }
}

function upsertTask(task) {
  const idx = state.tasks.findIndex(t => t.id === task.id);
  if (idx >= 0) state.tasks[idx] = task;
  else state.tasks.unshift(task);
}

function renderTasks() {
  if (!state.tasks.length) {
    taskList.innerHTML = '<p class="muted">目前沒有任務。</p>';
    return;
  }

  try {
    taskList.innerHTML = state.tasks.slice(0, 20).map(task => {
      const stats = task.stats || { total: 0, done: 0, failed: 0 };
      const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
      const badge = `status-badge status-${task.status || 'pending'}`;
      const metaText = task.status === 'ready'
        ? `已取得 ${stats.total} 項，請確認`
        : `${stats.done}/${stats.total}，失敗 ${stats.failed}`;
      const preview = task.status === 'ready' ? renderPreview(task) : '';

      return `
        <div class="task-card" data-id="${task.id}">
          <div class="task-head">
            <div class="task-url" title="${task.url}">${task.url || '未知'}</div>
            <span class="${badge}">${STATUS_TEXT[task.status] || task.status}</span>
          </div>
          <div class="task-meta">
            <span>${new Date(task.createdAt).toLocaleString()}</span>
            <span>${metaText}</span>
          </div>
          <div class="progress small"><div class="progress-bar" style="width:${pct}%"></div></div>
          <div class="task-actions">
            ${renderActions(task)}
          </div>
          ${preview}
          ${task.message ? `<p class="task-msg muted">${task.message}</p>` : ''}
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('renderTasks error:', err);
    taskList.innerHTML = `<p class="muted">渲染錯誤：${err.message}</p>`;
    return;
  }

  taskList.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const taskId = btn.closest('.task-card').dataset.id;
      sendAction(action, taskId);
    });
  });

  taskList.querySelectorAll('[data-confirm]').forEach(btn => {
    btn.addEventListener('click', () => {
      console.log('Confirm button clicked', btn.dataset.confirm);
      const taskId = btn.dataset.confirm;
      const card = btn.closest('.task-card');
      const checkboxes = card.querySelectorAll('.url-item input[type="checkbox"]');

      let selected;
      if (checkboxes.length === 0) {
        // 預覽未展開，下載全部
        selected = [];
      } else {
        // 預覽已展開，根據勾選決定
        selected = getSelectedIndexes(card);
        if (!selected.length) {
          setStatus('請至少選擇一個資源', true);
          return;
        }
      }
      console.log('Selected indexes:', selected);
      sendConfirmDownload(taskId, selected);
    });
  });

  taskList.querySelectorAll('[data-preview-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const taskId = btn.dataset.previewToggle;
      state.expanded[taskId] = !state.expanded[taskId];
      renderTasks();
    });
  });

  taskList.querySelectorAll('[data-select-all]').forEach(btn => {
    btn.addEventListener('click', () => toggleSelection(btn.closest('.task-card'), true));
  });

  taskList.querySelectorAll('[data-select-none]').forEach(btn => {
    btn.addEventListener('click', () => toggleSelection(btn.closest('.task-card'), false));
  });

  taskList.querySelectorAll('[data-debug-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const taskId = btn.dataset.debugToggle;
      state.debugExpanded[taskId] = !state.debugExpanded[taskId];
      renderTasks();
    });
  });

  taskList.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.copy;
      copyToClipboard(url);
    });
  });
}

function renderActions(task) {
  const btns = [];
  if (task.status === 'ready') {
    btns.push(`<button class="btn" data-confirm="${task.id}">確認下載</button>`);
    btns.push(`<button class="btn ghost" data-action="CANCEL_TASK">取消</button>`);
    return btns.join('');
  }
  if (['pending', 'fetching', 'downloading'].includes(task.status)) {
    btns.push(`<button class="btn" data-action="PAUSE_TASK">暫停</button>`);
  }
  if (['paused', 'failed'].includes(task.status)) {
    btns.push(`<button class="btn" data-action="RESUME_TASK">繼續</button>`);
  }
  if (!['completed'].includes(task.status)) {
    btns.push(`<button class="btn ghost" data-action="CANCEL_TASK">取消</button>`);
  }
  if (task.stats?.failed > 0) {
    btns.push(`<button class="btn ghost" data-action="RETRY_FAILED">重試失敗</button>`);
  }
  return btns.join('');
}

async function sendAction(type, taskId) {
  try {
    await chrome.runtime.sendMessage({ type, payload: { taskId } });
    refreshTasks();
  } catch (err) {
    setStatus(`操作失敗：${err.message}`, true);
  }
}

function setStatus(msg, isError = false) {
  statusMessage.textContent = msg;
  statusMessage.className = isError ? 'error' : 'muted';
}

function getUrlStats(resources) {
  let valid = 0;
  let suspicious = 0;
  resources.forEach(res => {
    if (isSuspiciousUrl(res.url)) suspicious++;
    else valid++;
  });
  return { valid, suspicious };
}

function renderDebugSection(task, resources) {
  const urls = Array.isArray(task.meta?.containerUrls) ? task.meta.containerUrls : [];
  if (!urls.length) return '';

  const debugExpanded = !!state.debugExpanded[task.id];
  const stats = getUrlStats(resources);

  const list = urls.map((url, idx) => `
    <div class="debug-item">
      <span class="muted">${idx + 1}.</span>
      <span class="debug-url" title="${escapeHtml(url)}">${escapeHtml(url)}</span>
      <button class="copy-btn" data-copy="${escapeHtml(url)}">📋</button>
    </div>
  `).join('');

  return `
    <div class="debug-section">
      <div class="debug-toggle" data-debug-toggle="${task.id}">
        ${debugExpanded ? '▼' : '▶'} Debug 資訊（容器網址：${urls.length}，合法：${stats.valid}，可疑：${stats.suspicious}）
      </div>
      ${debugExpanded ? `<div class="debug-list">${list}</div>` : ''}
    </div>
  `;
}

function renderPreview(task) {
  const resources = Array.isArray(task.resources) ? task.resources : [];
  const expanded = !!state.expanded[task.id];
  const listHtml = resources.map((res, idx) => renderPreviewItem(res, idx)).join('');
  const body = expanded ? (listHtml || '<div class="muted">沒有可預覽的資源</div>') : '';
  const debugSection = expanded ? renderDebugSection(task, resources) : '';

  return `
    <div class="preview-panel" data-task="${task.id}">
      <div class="preview-head">
        <button class="btn ghost" data-preview-toggle="${task.id}">
          ${expanded ? '收合' : '展開'}預覽（${resources.length}）
        </button>
        ${expanded ? `
          <div class="select-controls">
            <button class="btn ghost" data-select-all="${task.id}">全選</button>
            <button class="btn ghost" data-select-none="${task.id}">全不選</button>
          </div>
        ` : ''}
      </div>
      ${expanded ? `<div class="url-list">${body}</div>` : ''}
      ${debugSection}
    </div>
  `;
}

function renderPreviewItem(res, idx) {
  const index = res.index || idx + 1;
  const url = res.url || '';
  const safeUrl = escapeHtml(url || '未知');
  const type = res.type === 'video' ? 'VIDEO' : 'PHOTO';
  const warn = isSuspiciousUrl(url);

  return `
    <label class="url-item">
      <input type="checkbox" data-index="${index}" checked>
      <span class="url-badge">${type}</span>
      ${warn ? '<span class="url-warning" title="域名可能不是媒體 CDN">⚠</span>' : ''}
      <span class="url-text" title="${safeUrl}">${safeUrl}</span>
    </label>
  `;
}

function isSuspiciousUrl(url) {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const allowed = ['sinaimg.cn', 'weibocdn.com', 'miaopai.com'];
    return !allowed.some(d => host === d || host.endsWith(`.${d}`));
  } catch {
    return true;
  }
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function getSelectedIndexes(card) {
  return Array.from(card.querySelectorAll('.url-item input[type="checkbox"]:checked'))
    .map(cb => Number(cb.dataset.index))
    .filter(n => !Number.isNaN(n));
}

function toggleSelection(card, checked) {
  card.querySelectorAll('.url-item input[type="checkbox"]').forEach(cb => {
    cb.checked = checked;
  });
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    setStatus('已複製到剪貼簿');
  }).catch(err => {
    setStatus(`複製失敗：${err.message}`, true);
  });
}

async function sendConfirmDownload(taskId, selectedIndexes) {
  try {
    await chrome.runtime.sendMessage({ type: 'CONFIRM_DOWNLOAD', payload: { taskId, selectedIndexes } });
    setStatus('已送出下載');
    refreshTasks();
  } catch (err) {
    setStatus(`操作失敗：${err.message}`, true);
  }
}

checkLogin();
refreshTasks();
loadSettings();
setInterval(refreshTasks, 5000);

// Settings handlers
settingsForm.addEventListener('submit', async e => {
  e.preventDefault();
  const concurrency = parseInt(concurrencyInput.value, 10) || 3;
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      payload: { concurrency }
    });
    if (res?.ok) {
      setSettingsStatus('設定已儲存');
    } else {
      setSettingsStatus(res?.error || '儲存失敗', true);
    }
  } catch (err) {
    setSettingsStatus(`錯誤：${err.message}`, true);
  }
});

async function loadSettings() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    if (res?.ok && res.data) {
      concurrencyInput.value = res.data.concurrency || 3;
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

function setSettingsStatus(msg, isError = false) {
  settingsStatus.textContent = msg;
  settingsStatus.className = isError ? 'error' : 'muted';
  if (!isError) {
    setTimeout(() => { settingsStatus.textContent = ''; }, 2000);
  }
}
