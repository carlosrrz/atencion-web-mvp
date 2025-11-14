import jwt from 'jsonwebtoken';

const COOKIE = 'session';

export function signSession(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
}

export function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie',
    `session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie',
    'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
}

export function getUserFromReq(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  if (!m) return null;
  try {
    return jwt.verify(decodeURIComponent(m[1]), process.env.JWT_SECRET);
  } catch {
    return null;
  }
}
