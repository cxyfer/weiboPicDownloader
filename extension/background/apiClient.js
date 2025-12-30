import { DEFAULT_HEADERS } from '../common/constants.js';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export class RateLimitError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'RateLimitError';
    this.details = details;
  }
}

export async function apiFetch(url, options = {}, attempt = 0) {
  const { headers: userHeaders = {}, redirect = 'manual', ...rest } = options;
  const headers = mergeHeaders(DEFAULT_HEADERS, userHeaders);

  try {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      redirect,
      headers,
      ...rest
    });
    return await parseResponse(response);
  } catch (error) {
    if (attempt + 1 < MAX_RETRIES) {
      const delayMs = Math.pow(2, attempt) * BASE_DELAY_MS;
      await delay(delayMs);
      return apiFetch(url, options, attempt + 1);
    }
    throw error;
  }
}

function mergeHeaders(base = {}, extra = {}) {
  const headers = new Headers();
  for (const [key, value] of Object.entries({ ...base, ...extra })) {
    try {
      headers.set(key, value);
    } catch {
      // Ignore restricted headers
    }
  }
  return headers;
}

async function parseResponse(response) {
  if (response.status === 302 || response.type === 'opaqueredirect') {
    return {
      status: response.status,
      redirect: true,
      location: response.headers.get('Location'),
      headers: response.headers
    };
  }

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  let data = null;

  // Try to parse as JSON regardless of content-type (Weibo sometimes returns wrong headers)
  try {
    const text = await response.clone().text();
    data = JSON.parse(text);
  } catch {
    // If JSON parse fails and we got HTML, it's likely a login redirect
    const text = await response.text();
    if (text.includes('<!DOCTYPE') || text.includes('<html')) {
      throw new RateLimitError('Received HTML instead of JSON - likely login required', {
        status: response.status,
        isHtml: true
      });
    }
    data = text;
  }

  if (response.status === 403 || response.status === 418 || data?.ok === -100) {
    throw new RateLimitError('Rate limited or blocked', { status: response.status, data });
  }

  if (!response.ok) {
    const error = new Error(`Request failed: ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return { status: response.status, data, url: response.url };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
