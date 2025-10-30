// roles.js — guard de rol súper simple (frontend, NO seguro para producción)
const ROLE_KEY = 'proctor.role.v1';

export function setRole(role){ try{ localStorage.setItem(ROLE_KEY, role); }catch{} }
export function getRole(){ try{ return localStorage.getItem(ROLE_KEY); }catch{ return null; } }
export function clearRole(){ try{ localStorage.removeItem(ROLE_KEY); }catch{} }

export function requireRole(expected){
  const r = getRole();
  if (r !== expected){
    // si no coincide, regresamos a la entrada
    location.replace('index.html');
    throw new Error('forbidden');
  }
}
