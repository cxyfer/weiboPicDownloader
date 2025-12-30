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

export function formatFilename(resource, template = '{date}_{name}', userName = '') {
  const urlPath = safeUrlPath(resource.url);
  const filename = urlPath?.split('/').pop() || `${resource.mid || 'item'}_${resource.index || 1}.jpg`;
  const [fileRoot, fileExt] = splitExt(filename);

  const map = {
    name: fileRoot,
    date: formatDate(resource.date),
    id: resource.mid || resource.id || '',
    index: padIndex(resource.index),
    type: resource.type || '',
    text: truncateText(stripHtml(resource.text || '')),
    username: userName
  };

  const resolved = template.replace(/{(\w+)}/g, (_, key) => safeValue(map[key]));
  return sanitizeFilename(resolved) + fileExt;
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

function formatDate(dateInput) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput || Date.now());
  return date.toISOString().split('T')[0];
}

function padIndex(idx) {
  return String(Number.isFinite(idx) ? idx : 1).padStart(2, '0');
}

function stripHtml(text) {
  return text.replace(/<[^>]+>/g, '');
}

function truncateText(text, limit = 50) {
  return text.length > limit ? text.slice(0, limit) : text;
}

function safeValue(val) {
  return val == null ? '' : String(val);
}
