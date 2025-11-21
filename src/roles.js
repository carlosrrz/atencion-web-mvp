// src/roles.js
function safeParse(s){ try { return JSON.parse(s); } catch { return null; } }

export function setSession(user){
  if (!user) return;
  // normaliza por si viene "profesor"/"estudiante"
  const r = String(user.role || '').toLowerCase();
  const role = r === 'profesor' ? 'prof' : r === 'estudiante' ? 'student' : r;
  const u = { ...user, role };
  localStorage.setItem('user', JSON.stringify(u));
  localStorage.setItem('role', role); // compat con código antiguo
}

export function getSession(){
  return safeParse(localStorage.getItem('user'));
}
export function getRole(){
  const u = getSession();
  return u?.role || localStorage.getItem('role') || null;
}

export function requireRole(roles){
  const r = getRole();
  // permitir string o array
  const list = Array.isArray(roles) ? roles : [roles];
  if (!r || !list.includes(r)) {
    location.replace('login.html');
  }
}

export function logout(){
  try {
    localStorage.removeItem('user');
    localStorage.removeItem('role');
    localStorage.removeItem('proctor.user');
    sessionStorage.removeItem('proctor.user');
  } catch {}
  location.replace('login.html');
}

export function clearSession() {
  // misma limpieza que logout, pero SIN redirigir
  try {
    localStorage.removeItem('user');
    localStorage.removeItem('role');
    localStorage.removeItem('proctor.user');
    sessionStorage.removeItem('proctor.user');
  } catch {}
}
