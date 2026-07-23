import { state, DATA, CONFIG, saveLS, LS_OVR, LS_VIEW } from '../core/store.js';
import { getCartItems } from '../core/cartService.js';
import { searchAndSortProducts } from '../core/searchService.js';

export const $ = (s, r = document) => r.querySelector(s);
export const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
export const esc = (s) => (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const esMovil = () => window.matchMedia('(max-width:880px)').matches;

const PLACEHOLDER = `<div class="ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/></svg><span>Sin foto</span></div>`;
export const PIN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;

export function asArray(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }

function fuentesFoto(p) {
  const out = [];
  if (typeof p.foto === 'string' && /^https?:\/\//i.test(p.foto)) out.push(p.foto);
  CONFIG.fotoExts.forEach(e => out.push(`fotos/${p.id}.${e}`));
  return out;
}

export function thumb(p, onImageClick) {
  const box = el('div', 'thumb');
  const img = new Image();
  let i = 0;
  const fuentes = fuentesFoto(p);
  const tryNext = () => { if (i < fuentes.length) img.src = fuentes[i++]; else box.innerHTML = PLACEHOLDER; };
  img.onerror = tryNext;
  img.onload = () => { box.innerHTML = ''; box.appendChild(img); };
  box.innerHTML = PLACEHOLDER;
  tryNext();
  if (onImageClick) box.addEventListener('click', () => onImageClick(p));
  return box;
}

// Lógica de filtrado y búsqueda
export function getSearchResults() {
  return state.q ? searchAndSortProducts(state.q, DATA.productos) : DATA.productos;
}

export function filteredProducts() {
  return getSearchResults().filter(p => {
    if (state.cat && p.cat !== state.cat) return false;
    if (state.sub && p.sub !== state.sub) return false;
    return true;
  });
}

export function conteoPorCategoria(lista) {
  const m = new Map();
  lista.forEach(p => { if (p.cat) m.set(p.cat, (m.get(p.cat) || 0) + 1); });
  return m;
}

// Renderizados de Sidebar y Chips
export function renderSidebar(onCatSelect) {
  const s = $('#sidebar'); s.innerHTML = '';
  s.appendChild(el('div', 'cat-title', 'Categorías'));

  const res = state.q ? getSearchResults() : null;
  const conteos = res ? conteoPorCategoria(res) : null;
  const total = res ? res.length : DATA.total;

  const all = el('button', 'cat-btn' + (state.cat ? '' : ' on'), `<span>Todas</span><span class="n">${total.toLocaleString('es-MX')}</span>`);
  all.onclick = () => onCatSelect(null);
  s.appendChild(all);

  DATA.categorias.forEach(c => {
    const n = conteos ? (conteos.get(c.nombre) || 0) : c.n;
    if (!n) return;
    const b = el('button', 'cat-btn' + (state.cat === c.nombre ? ' on' : ''), `<span>${esc(c.nombre)}</span><span class="n">${n.toLocaleString('es-MX')}</span>`);
    b.onclick = () => onCatSelect(c.nombre);
    s.appendChild(b);
  });
}

export function renderSubchips(onCatSelect, onSubSelect) {
  const wrap = $('#subchips'); wrap.innerHTML = '';
  
  if (state.q) {
    const res = getSearchResults();
    const conteos = conteoPorCategoria(res);
    if (conteos.size <= 1) return; 
    const all = el('button', 'chip' + (state.cat ? '' : ' on'), `Todo el catálogo · ${res.length.toLocaleString('es-MX')}`);
    all.onclick = () => onCatSelect(null);
    wrap.appendChild(all);
    [...conteos.entries()].sort((a, b) => b[1] - a[1]).forEach(([nombre, n]) => {
      const c = el('button', 'chip' + (state.cat === nombre ? ' on' : ''), `${esc(nombre)} · ${n.toLocaleString('es-MX')}`);
      c.onclick = () => onCatSelect(nombre);
      wrap.appendChild(c);
    });
    return;
  }

  if (!state.cat) return;
  const cat = DATA.categorias.find(c => c.nombre === state.cat);
  const subs = cat ? asArray(cat.subs) : [];
  if (subs.length <= 1) return;
  
  const all = el('button', 'chip' + (state.sub ? '' : ' on'), 'Todas');
  all.onclick = () => onSubSelect(null);
  wrap.appendChild(all);
  
  subs.forEach(su => {
    const c = el('button', 'chip' + (state.sub === su.nombre ? ' on' : ''), `${esc(su.nombre)} · ${su.n}`);
    c.onclick = () => onSubSelect(su.nombre);
    wrap.appendChild(c);
  });
}

// Renderizado del Grid
export function renderGrid(onAdd, onView) {
  const list = filteredProducts();
  const grid = $('#grid');
  const limit = state.page * CONFIG.pageSize;
  grid.innerHTML = '';
  
  if (!list.length) {
    grid.appendChild(el('div', 'empty', DATA.total ? 'Sin resultados en todo el catálogo. Prueba con otro término, el código o la medida.' : 'No se pudo cargar el catálogo. Revisa tu conexión e inténtalo de nuevo.'));
  }
  
  list.slice(0, limit).forEach(p => {
    const c = el('div', 'card');
    c.appendChild(thumb(p, onView));
    const body = el('div', 'card-body');
    const name = el('div', 'card-name', esc(p.nom)); name.onclick = () => onView(p);
    body.appendChild(name);
    
    const meta = el('div', 'card-meta');
    if (p.sub && p.sub !== 'POR CLASIFICAR') meta.appendChild(el('span', 'tag sub', esc(p.sub)));
    if (p.med) meta.appendChild(el('span', 'tag med', esc(p.med)));
    body.appendChild(meta);
    body.appendChild(el('div', 'card-cod', 'Cód: ' + esc(p.cod)));
    
    const foot = el('div', 'card-foot');
    const add = el('button', 'btn-add', 'Agregar'); add.onclick = () => onAdd(p);
    const view = el('button', 'btn-view', 'Ver'); view.onclick = () => onView(p);
    foot.append(add, view); body.appendChild(foot); c.appendChild(body);
    grid.appendChild(c);
  });

  $('#count').textContent = `${list.length.toLocaleString('es-MX')} productos`;
  const q = state.q.trim();
  $('#crumbs').textContent = q ? (state.cat ? `«${q}» en ${state.cat}` : `«${q}» en todo el catálogo`) : (state.cat || 'Todas las categorías');
  
  const more = $('#btnMore');
  if (list.length > limit) { more.hidden = false; more.textContent = `Cargar más (${(list.length - limit).toLocaleString('es-MX')} restantes)`; }
  else { more.hidden = true; }
}

export function refreshCartUI(onSub, onAdd, onDel) {
  const items = getCartItems();
  $('#cartCount').textContent = items.reduce((a, b) => a + b.qty, 0);
  const box = $('#cartItems');
  if (!items.length) { box.innerHTML = '<div class="cart-empty">Tu pedido está vacío.<br>Agrega productos para cotizar.</div>'; return; }
  
  box.innerHTML = '';
  items.forEach(it => {
    const row = el('div', 'ci');
    row.innerHTML = `<div class="ci-name">${esc(it.nom)}<div class="ci-cod">${esc(it.cod)}</div></div>`;
    const qty = el('div', 'qty');
    const minus = el('button', null, '−'); minus.onclick = () => onSub(it.id);
    const span = el('span', null, it.qty);
    const plus = el('button', null, '+'); plus.onclick = () => onAdd(it.id);
    qty.append(minus, span, plus);
    const del = el('button', 'ci-del', '×'); del.onclick = () => onDel(it.id);
    row.append(qty, del); box.appendChild(row);
  });
}

// Utilidades visuales
export const catsAbierto = () => document.body.classList.contains('cats-open');
export const toggleAdminUI = () => { state.edit = !state.edit; $('#btnAdmin').classList.toggle('on', state.edit); $('#adminBanner').hidden = !state.edit; };
export const pulseCart = () => $('#btnCart').animate([{transform:'scale(1)'},{transform:'scale(1.12)'},{transform:'scale(1)'}],{duration:220});
export const openCart = () => { closeCats(); $('#cart').hidden = false; $('#overlay').hidden = false; };
export const closeCart = () => { $('#cart').hidden = true; if(!catsAbierto()) $('#overlay').hidden = true; };
export const openCats = () => { closeCart(); document.body.classList.add('cats-open'); $('#btnCats').setAttribute('aria-expanded','true'); $('#overlay').hidden = false; };
export const closeCats = () => { if(!catsAbierto()) return; document.body.classList.remove('cats-open'); $('#btnCats').setAttribute('aria-expanded','false'); if ($('#cart').hidden) $('#overlay').hidden = true; };
export const toggleCats = () => { catsAbierto() ? closeCats() : openCats(); };
export const trasElegirCat = () => { closeCats(); window.scrollTo({ top:0, behavior:'smooth' }); };
export const applyView = () => { $('#grid').className = 'grid ' + (state.view === 'list' ? 'view-list' : 'view-grid'); document.querySelectorAll('.vt').forEach(b => { const on = b.dataset.view === state.view; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }); };
export const setView = (v) => { state.view = (v === 'list') ? 'list' : 'grid'; saveLS(LS_VIEW, state.view); applyView(); };