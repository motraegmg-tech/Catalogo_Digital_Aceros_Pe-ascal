import { state, saveLS, LS_CART } from './store.js';
// Las sucursales las edita el encargado desde el clasificador; AJUSTES arranca
// con las de core/config.js, así que esto funciona aunque la base no responda.
import { AJUSTES } from './ajustesService.js';

export function addToCartLogic(p) {
  addManyToCartLogic([{ p, qty: 1 }]);
}

/**
 * Agrega varias medidas de una vez (ficha de familia). Cada medida entra como su
 * propia línea con su propio código: la agrupación es de presentación, el pedido
 * y el mensaje de WhatsApp siguen siendo producto por producto.
 * Guarda una sola vez al final en vez de una por línea.
 */
export function addManyToCartLogic(lineas) {
  let cambio = false;
  lineas.forEach(({ p, qty }) => {
    const n = Math.trunc(qty);
    if (!p || !(n > 0)) return;
    const c = state.cart[p.id] || { id: p.id, cod: p.cod, nom: p.nom, qty: 0 };
    c.qty += n;
    state.cart[p.id] = c;
    cambio = true;
  });
  if (cambio) saveLS(LS_CART, state.cart);
  return cambio;
}

/** Cuánto hay ya en el pedido de este producto (se muestra en la ficha de familia). */
export const cantidadEnCarrito = (id) => (state.cart[id] || {}).qty || 0;

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
  const suc = AJUSTES.sucursales.find(s => s.id === sucursalId) || AJUSTES.sucursales[0];
  if (!suc) return null;
  const lines = items.map(it => `• ${it.qty} x ${it.nom}  (Cód: ${it.cod})`).join('\n');
  const msg = `Hola, Aceros Peñascal — ${suc.nombre}.\nQuisiera cotizar este pedido:\n\n${lines}\n\nQuedo atento a precio y disponibilidad. ¡Gracias!`;
  return `https://wa.me/${suc.wa}?text=${encodeURIComponent(msg)}`;
}