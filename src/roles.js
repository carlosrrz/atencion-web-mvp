// src/roles.js
// Manejo simple de sesión en front + verificación opcional al backend

const KEY = 'proctor.session.v1';

// Guarda usuario en localStorage y en window.__currentUser
export function setSession(user) {
  try {
    if (!user || typeof user !== 'object') return;
    localStorage.setItem(KEY, JSON.stringify(user));
    window.__currentUser = user;
    console.log('[roles] sesión guardada:', user);
  } catch (e) {
    console.warn('[roles] no se pudo guardar sesión:', e);
  }
}

// Lee usuario desde localStorage
export function getSession() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const u = JSON.parse(raw);
    if (!u || typeof u !== 'object') return null;
    window.__currentUser = u;
    return u;
  } catch (e) {
    console.warn('[roles] no se pudo leer sesión:', e);
    return null;
  }
}

// Borra sesión local
export function clearSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
  window.__currentUser = null;
  console.log('[roles] sesión limpiada');
}

// Intenta refrescar desde /api/auth/me usando la cookie "token"
export async function refreshFromServer() {
  try {
    const res = await fetch('/api/auth/me');
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok || !j.user) {
      console.warn('[roles] /api/auth/me no válido:', res.status, j);
      return null;
    }
    setSession(j.user);
    return j.user;
  } catch (e) {
    console.warn('[roles] error consultando /api/auth/me:', e);
    return null;
  }
}

/**
 * Gate de rol.
 * - Primero intenta leer de localStorage (lo que setea login.html con setSession).
 * - Si no hay nada, intenta /api/auth/me.
 * - Si sigue sin haber user, redirige a login.
 * - Si el rol no coincide, redirige según el caso.
 */
export async function requireRole(expectedRole) {
  try {
    // 1) Intenta sesión local (lo que setSession guardó al hacer login)
    let user = getSession();

    // 2) Si no hay nada local, intenta con el backend (/api/auth/me)
    if (!user) {
      user = await refreshFromServer();
    }

    // 3) Si sigue sin haber usuario → no está logueado
    if (!user) {
      console.warn('[roles] sin sesión → login');
      location.replace('login.html');
      return;
    }

    // 4) Validar rol (si se pide uno)
    if (expectedRole && user.role !== expectedRole) {
      console.warn('[roles] rol no permitido. Esperado:', expectedRole, 'tiene:', user.role);
      if (user.role === 'prof') {
        // Si es prof y trata de entrar a vista de estudiante → mandarlo a encargado
        location.replace('encargado.html');
      } else if (user.role === 'student') {
        // Si es student y trata de ir a vista prof → mandarlo a estudiante
        location.replace('estudiante.html');
      } else {
        // Rol raro → al login
        location.replace('login.html');
      }
      return;
    }

    // 5) Exponerlo globalmente
    window.__currentUser = user;
    console.log('[roles] requireRole OK para', expectedRole || '(cualquiera)', '→', user);
    return user;
  } catch (e) {
    console.error('[roles] error inesperado en requireRole:', e);
    location.replace('login.html');
  }
}
