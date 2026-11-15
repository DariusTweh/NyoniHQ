import { getToken, startAuthorization } from '@vercel/connect';

export const GOOGLE_CONNECTOR = 'google/nyoni-gmail';
const GOOGLE_SUBJECT = { type: 'user', id: 'nyoni-studio-founder' };
export const GMAIL_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
];

export async function beginGoogleAuthorization() {
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || 'nyoni-hq.vercel.app';
  return startAuthorization(
    GOOGLE_CONNECTOR,
    { subject: GOOGLE_SUBJECT, scopes: GMAIL_SCOPES },
    { callbackUrl: `https://${productionHost}/?google=connected`, prompt: 'consent' },
  );
}

export async function getGoogleAccessToken() {
  return getToken(GOOGLE_CONNECTOR, { subject: GOOGLE_SUBJECT, scopes: GMAIL_SCOPES });
}

export async function googleConnectionStatus() {
  try {
    const token = await getGoogleAccessToken();
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function gmailRequest(path) {
  const token = await getGoogleAccessToken();
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const error = new Error(detail?.error?.message || `Gmail returned HTTP ${response.status}.`);
    error.statusCode = response.status;
    throw error;
  }
  return response.json();
}

function headerValue(message, name) {
  return message?.payload?.headers?.find((header) => header.name?.toLowerCase() === name)?.value || '';
}

function decodeBase64Url(value = '') {
  if (!value) return '';
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function readableMessageBody(payload) {
  const candidates = [];
  const visit = (part) => {
    if (!part) return;
    if (part.body?.data && ['text/plain', 'text/html'].includes(part.mimeType)) {
      candidates.push({ mimeType: part.mimeType, text: decodeBase64Url(part.body.data) });
    }
    for (const child of part.parts || []) visit(child);
  };
  visit(payload);
  const selected = candidates.find((item) => item.mimeType === 'text/plain') || candidates[0];
  return String(selected?.text || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1800);
}

export async function getRecentInbox({ maxResults = 8 } = {}) {
  const count = Math.max(1, Math.min(Number(maxResults) || 8, 15));
  const search = new URLSearchParams({
    q: 'in:inbox newer_than:14d -category:promotions -category:social',
    maxResults: String(count),
  });
  const list = await gmailRequest(`messages?${search}`);
  const messages = await Promise.all((list.messages || []).map(({ id }) =>
    gmailRequest(`messages/${encodeURIComponent(id)}?format=full`),
  ));
  return messages.map((message) => ({
    id: message.id,
    threadId: message.threadId,
    from: headerValue(message, 'from'),
    subject: headerValue(message, 'subject') || '(No subject)',
    date: headerValue(message, 'date'),
    snippet: String(message.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 280),
    body: readableMessageBody(message.payload),
  }));
}

export async function getHunterInboxContext() {
  try {
    const messages = await getRecentInbox({ maxResults: 8 });
    if (!messages.length) return 'GMAIL INBOX: Connected. No recent primary inbox messages were found.';
    return [
      'GMAIL INBOX — RECENT CONTEXT (private; do not quote sensitive details unnecessarily)',
      ...messages.map((message, index) => `${index + 1}. From: ${message.from}\nDate: ${message.date}\nSubject: ${message.subject}\nMessage: ${message.body || message.snippet}`),
      'You may analyze this context and prepare suggested replies or outreach drafts. Never claim a message was sent.',
    ].join('\n\n');
  } catch (error) {
    return `GMAIL INBOX: Unavailable for this run (${error?.message || 'connection error'}). Do not claim email was checked.`;
  }
}
