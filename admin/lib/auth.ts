import { createHash, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const SESSION_COOKIE = 'admin_session';
const ADMIN_USERNAME = 'tongzai';

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function getSessionValue() {
  const password = process.env.ADMIN_PASSWORD || '';
  if (!password) return '';
  return createHash('sha256')
    .update(`${ADMIN_USERNAME}\0${password}\0shanghai-study-map-admin`)
    .digest('hex');
}

export function credentialsAreValid(username: string, password: string) {
  const configuredPassword = process.env.ADMIN_PASSWORD || '';
  return Boolean(configuredPassword)
    && safeEqual(username, ADMIN_USERNAME)
    && safeEqual(password, configuredPassword);
}

export function createAdminSessionValue() {
  return getSessionValue();
}

export async function isAdmin() {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE)?.value || '';
  const expected = getSessionValue();
  return Boolean(expected) && safeEqual(session, expected);
}

export async function isAdminRequest(request: Request) {
  if (await isAdmin()) return true;

  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Basic ')) return false;

  try {
    const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return false;
    return credentialsAreValid(decoded.slice(0, separator), decoded.slice(separator + 1));
  } catch {
    return false;
  }
}

export async function requireAdmin() {
  if (!(await isAdmin())) {
    redirect('/login');
  }
}
