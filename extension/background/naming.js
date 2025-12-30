const INVALID_CHARS = /[<>:"/\\|?*]/g;
const MAX_LENGTH = 120;

export function sanitizeFilename(name) {
  if (!name) return '';
  const cleaned = name.replace(INVALID_CHARS, '_').trim();
  if (cleaned.length <= MAX_LENGTH) return cleaned;
  const extIndex = cleaned.lastIndexOf('.');
  if (extIndex > 0) {
    const base = cleaned.slice(0, extIndex).slice(0, MAX_LENGTH - (cleaned.length - extIndex));
    return `${base}${cleaned.slice(extIndex)}`;
  }
  return cleaned.slice(0, MAX_LENGTH);
}

export function formatPath(resource, template = '{date:yyyy-MM-dd}_{filename}{ext}', context = {}) {
  const { nickname = '', id = '' } = context;
  const urlPath = safeUrlPath(resource.url);
  const rawFilename = urlPath?.split('/').pop() || `${resource.mid || 'item'}_${resource.index || 1}.jpg`;
  const [fileRoot, fileExt] = splitExt(rawFilename);
  const dateInput = resource?.date || Date.now();

  const resolved = String(template || '').replace(/{([^}]+)}/g, (_, token) => {
    if (token.startsWith('date:')) {
      return safeValue(formatDate(dateInput, token.slice(5)));
    }
    if (token === 'date') return safeValue(formatDate(dateInput));
    if (token === 'nickname') return safeValue(nickname);
    if (token === 'filename') return safeValue(fileRoot);
    if (token === 'ext') return safeValue(fileExt);
    if (token === 'id') return safeValue(id || resource?.mid || resource?.id || '');
    return '';
  });

  return sanitizePath(resolved);
}

function sanitizePath(path) {
  if (!path) return '';
  const parts = String(path).split(/[\\/]+/).filter(Boolean);
  return parts.map(part => sanitizeFilename(part)).filter(Boolean).join('/');
}

function safeUrlPath(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

function splitExt(filename) {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return [filename, ''];
  return [filename.slice(0, lastDot), filename.slice(lastDot)];
}

function formatDate(dateInput, format = 'yyyy-MM-dd') {
  const rawDate = dateInput instanceof Date ? dateInput : new Date(dateInput || Date.now());
  const date = Number.isNaN(rawDate.getTime()) ? new Date() : rawDate;
  const parts = {
    yyyy: String(date.getFullYear()),
    MM: String(date.getMonth() + 1).padStart(2, '0'),
    dd: String(date.getDate()).padStart(2, '0'),
    HH: String(date.getHours()).padStart(2, '0'),
    mm: String(date.getMinutes()).padStart(2, '0'),
    ss: String(date.getSeconds()).padStart(2, '0')
  };
  return String(format || 'yyyy-MM-dd').replace(/yyyy|MM|dd|HH|mm|ss/g, match => parts[match] || '');
}

function safeValue(val) {
  return val == null ? '' : String(val);
}
