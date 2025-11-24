// lib/auth.js
import jwt from 'jsonwebtoken';

const ONE_WEEK = 60 * 60 * 24 * 7;

export function signToken(payload) {
  const secret = process.env.JWT_SECRET || 'dev-secret';
  return jwt.sign(payload, secret, { expiresIn: ONE_WEEK }); // 7 días
}

export function verifyToken(token) {
  const secret = process.env.JWT_SECRET || 'dev-secret';
  return jwt.verify(token, secret);
}

export function setAuthCookie(res, token, maxAgeSecs = ONE_WEEK) {
  // Cookie para todo el sitio, segura en prod
  const parts = [
    `token=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSecs}`
  ];
  if (process.env.VERCEL === '1' || process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', 'token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}
