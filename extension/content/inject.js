(function () {
  const BTN_ID = 'wpd-floating-download';
  const TOAST_ID = 'wpd-toast';

  if (!isWeiboHost(location.hostname)) return;
  const pageInfo = detectPage(location.href);
  if (!pageInfo) return;

  injectStyles();
  injectButton(pageInfo);

  function isWeiboHost(host) {
    return /(?:^|\.)weibo\.com$/.test(host) || /(?:^|\.)m\.weibo\.cn$/.test(host);
  }

  function detectPage(url) {
    try {
      const u = new URL(url);
      const segs = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const first = segs[0];
      const host = u.hostname;

      if (/m\.weibo\.cn$/.test(host)) {
        if ((first === 'u' || first === 'profile') && segs[1]) return { type: 'user', id: segs[1] };
        if (first === 'n' && segs[1]) return { type: 'user', nickname: segs[1] };
        if (first === 'p' && segs[1] === 'index') {
          const cid = u.searchParams.get('containerid');
          if (cid?.startsWith('100808')) return { type: 'supertopic', containerid: cid };
        }
        if (first === 'detail' && segs[1]) return { type: 'post', mid: segs[1] };
      }

      if (/weibo\.com$/.test(host)) {
        if (first === 'u' && segs[1]) return { type: 'user', id: segs[1] };
        if (first === 'p' && segs[1]?.startsWith('100808')) return { type: 'supertopic', containerid: segs[1] };
        if (first === 'status' && segs[1]) return { type: 'post', bid: segs[1] };
        if (segs.length === 2 && /^\d+$/.test(segs[0])) return { type: 'post', uid: segs[0], mid: segs[1] };
        if (segs.length === 1 && segs[0]) {
          return /^\d+$/.test(segs[0]) ? { type: 'user', id: segs[0] } : { type: 'user', nickname: segs[0] };
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  function injectStyles() {
    if (document.getElementById(`${BTN_ID}-style`)) return;
    const style = document.createElement('style');
    style.id = `${BTN_ID}-style`;
    style.textContent = `
      #${BTN_ID} {
        position: fixed;
        bottom: 20px;
        right: 20px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 10px 14px;
        border-radius: 999px;
        background: rgba(0, 91, 172, 0.95);
        color: #fff;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        z-index: 99999;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
        transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
        border: none;
      }
      #${BTN_ID}:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(0,0,0,0.25);
      }
      #${BTN_ID} .icon {
        width: 16px;
        height: 16px;
      }
      #${TOAST_ID} {
        position: fixed;
        bottom: 80px;
        right: 20px;
        background: rgba(0,0,0,0.85);
        color: #fff;
        padding: 10px 16px;
        border-radius: 8px;
        font-size: 13px;
        z-index: 99999;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s;
      }
      #${TOAST_ID}.show { opacity: 1; }
    `;
    document.head.appendChild(style);
  }

  function injectButton(pageInfo) {
    if (document.getElementById(BTN_ID)) return;
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.innerHTML = `
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
      </svg>
      <span>下載此頁</span>
    `;

    btn.addEventListener('click', async () => {
      showToast('送出下載任務...');
      try {
        await chrome.runtime.sendMessage({ type: 'START_TASK', payload: { url: location.href } });
        showToast('已送出，請在擴充功能查看進度');
      } catch (err) {
        showToast(`送出失敗：${err?.message || '未知錯誤'}`);
      }
    });

    document.body.appendChild(btn);
  }

  function showToast(text) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = TOAST_ID;
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }
})();
