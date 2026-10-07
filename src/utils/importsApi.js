// Book import API (see the import contract): uploads parse in the background
// into a resumable import record; the user reviews its sections with small
// ops, then creates the book once.

export const IMPORT_FORMATS = ['epub', 'docx', 'pdf', 'txt', 'md'];
export const IMPORT_ACCEPT = '.epub,.docx,.pdf,.txt,.md';
export const IMPORT_MAX_BYTES = 50 * 1024 * 1024;

const authHeaders = (json = false) => {
  const token = localStorage.getItem('token');
  return { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
};

const request = async (method, url, body) => {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const response = await fetch(url, {
    method,
    headers: authHeaders(!!body && !isForm),
    credentials: 'include',
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(data?.error || data?.message || `Request failed (${response.status})`);
    err.status = response.status;
    err.body = data;
    throw err;
  }
  return data;
};

export const fileFormat = (name) => {
  const ext = String(name || '').split('.').pop().toLowerCase();
  return IMPORT_FORMATS.includes(ext) ? ext : null;
};

export const importsApi = {
  upload: (file) => { const form = new FormData(); form.append('file', file, file.name); return request('POST', '/api/imports', form); },
  list: () => request('GET', '/api/imports'),
  get: (id) => request('GET', `/api/imports/${id}`),
  chapter: (id, index) => request('GET', `/api/imports/${id}/chapters/${index}`),
  ops: (id, ops) => request('PATCH', `/api/imports/${id}/chapters`, { ops }),
  update: (id, fields) => request('PATCH', `/api/imports/${id}`, fields),
  create: (id, options) => request('POST', `/api/imports/${id}/create`, options),
  discard: (id) => request('DELETE', `/api/imports/${id}`),
};

export const formatBytes = (n) => {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export const STATUS_LABEL = {
  parsing: 'Reading the file',
  review: 'Ready to review',
  creating: 'Creating the book',
  created: 'Book created',
  failed: 'Failed',
};

export const KIND_LABEL = { front: 'Front matter', chapter: 'Story', back: 'Back matter' };
export const SOURCE_LABEL = { toc: 'table of contents', heading: 'heading', pattern: 'pattern', ai: 'AI', whole: 'whole file' };
