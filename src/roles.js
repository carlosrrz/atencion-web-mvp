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
  if (!r || !roles.includes(r)) location.replace('login.html');
}

export function logout(){
  localStorage.removeItem('user');
  localStorage.removeItem('role');
  location.replace('login.html');
}
