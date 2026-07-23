import { state, saveLS, CONFIG, LS_CART } from './store.js';

export function addToCartLogic(p) {
  const c = state.cart[p.id] || { id: p.id, cod: p.cod, nom: p.nom, qty: 0 };
  c.qty += 1;
  state.cart[p.id] = c;
  saveLS(LS_CART, state.cart);
}

export function setQtyLogic(id, d) {
  const c = state.cart[id];
  if (!c) return;
  c.qty += d;
  if (c.qty <= 0) delete state.cart[id];
  saveLS(LS_CART, state.cart);
}

export function getCartItems() {
  return Object.values(state.cart);
}

export function buildWhatsAppUrl(sucursalId) {
  const items = getCartItems();
  if (!items.length) return null;
  const suc = CONFIG.sucursales.find(s => s.id === sucursalId) || CONFIG.sucursales[0];
  const lines = items.map(it => `• ${it.qty} x ${it.nom}  (Cód: ${it.cod})`).join('\n');
  const msg = `Hola, Aceros Peñascal — ${suc.nombre}.\nQuisiera cotizar este pedido:\n\n${lines}\n\nQuedo atento a precio y disponibilidad. ¡Gracias!`;
  return `https://wa.me/${suc.wa}?text=${encodeURIComponent(msg)}`;
}