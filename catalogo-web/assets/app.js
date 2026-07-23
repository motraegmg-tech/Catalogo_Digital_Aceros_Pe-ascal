import { fetchCatalogo, agruparCategorias } from '../core/catalogService.js';
import { state, DATA, setCatalogData, CONFIG } from '../core/store.js';
import { addToCartLogic, setQtyLogic, buildWhatsAppUrl } from '../core/cartService.js';
import { $, renderGrid, renderSidebar, renderSubchips, refreshCartUI, applyView, setView, openCart, closeCart, closeCats, toggleCats, pulseCart, toggleAdminUI, esMovil, el, esc, thumb, trasElegirCat, PIN_SVG } from './ui.js';

// --- Orquestador Principal de UI ---
function renderAllUI() {
  renderSidebar((cat) => { state.cat = cat; state.sub = null; state.page = 1; renderAllUI(); trasElegirCat(); });
  renderSubchips(
    (cat) => { state.cat = cat; state.sub = null; state.page = 1; renderAllUI(); },
    (sub) => { state.sub = sub; state.page = 1; renderAllUI(); }
  );
  renderGrid(handleAddToCart, handleViewProduct);
}

// --- Controladores delegados ---
function handleAddToCart(p) {
  addToCartLogic(p);
  refreshCartUI(id => handleSetQty(id, -1), id => handleSetQty(id, 1), id => handleSetQty(id, -9999));
  pulseCart();
}

function handleSetQty(id, delta) {
  setQtyLogic(id, delta);
  refreshCartUI(id => handleSetQty(id, -1), id => handleSetQty(id, 1), id => handleSetQty(id, -9999));
}

function handleViewProduct(p) {
  const b = $('#modalBody');
  b.innerHTML = '';
  const photo = el('div','modal-photo');
  const ph = thumb(p); ph.style.cursor = 'default';
  photo.appendChild(ph);
  
  const info = el('div','modal-info');
  const ovrName = state.edit ? ' editable' : '';
  info.innerHTML = `
    <div class="modal-cat">${esc(p.cat)}</div>
    <div class="modal-name${ovrName}">${esc(p.nom)}</div>
    <div class="spec"><b>Código</b><span>${esc(p.cod)}</span></div>
    <div class="spec"><b>Tipo</b><span class="${ovrName}">${esc(p.sub||'—')}</span></div>
    <div class="spec"><b>Medidas</b><span class="${ovrName}">${esc(p.med||'—')}</span></div>
    ${state.edit ? `<div class="spec"><b>Proveedor</b><span>${esc(p.prov||'—')}</span></div><div class="fname">Foto esperada: fotos/${p.id}.webp</div>` : ''}
    <div class="modal-cta"><button class="btn-quote" id="mQuote">Agregar al pedido y cotizar</button></div>`;
  
  b.append(photo, info);
  $('#mQuote').onclick = () => { handleAddToCart(p); $('#modal').hidden=true; openCart(); };
  $('#modal').hidden = false;
}

// --- Utilidades Sucursales ---
function sucById(id){ return CONFIG.sucursales.find(s=>s.id===id) || CONFIG.sucursales[0]; }
function mapsUrl(su){ return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Aceros Peñascal '+su.dir)}`; }

function updateSucInfo(){
  const su = sucById(state.sucursal);
  ['#sucursal','#sucursalCart'].forEach(sel=>{ const s=$(sel); if(s) s.title = su.dir; });
  const a = $('#sucDir');
  if (a){ a.href = mapsUrl(su); a.innerHTML = PIN_SVG + `<span>${esc(su.dir)}</span>`; }
}

// --- Carga Local de Respaldo ---
function cargarRespaldoLocal(){
  return new Promise(resolve => {
    if (window.CATALOGO) return resolve(window.CATALOGO);
    const s = document.createElement('script');
    s.src = '../data/productos.js';
    s.onload  = () => resolve(window.CATALOGO || null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
}

// --- Inicialización Principal ---
async function init() {
  applyView();
  refreshCartUI(id => handleSetQty(id, -1), id => handleSetQty(id, 1), id => handleSetQty(id, -9999));

  ['#sucursal','#sucursalCart'].forEach(sel => {
    const s = $(sel); s.innerHTML = '';
    CONFIG.sucursales.forEach(su => { const o = el('option',null,su.nombre); o.value=su.id; o.title=su.dir; s.appendChild(o); });
    s.value = state.sucursal;
    s.onchange = () => { state.sucursal = s.value; $('#sucursal').value = s.value; $('#sucursalCart').value = s.value; updateSucInfo(); };
  });
  updateSucInfo();

  let datos = await fetchCatalogo();
  if (!datos.productos.length) {
    const local = await cargarRespaldoLocal();
    if (local && local.productos.length) {
      datos = { productos: local.productos, categorias: agruparCategorias(local.productos), total: local.productos.length };
    }
  }
  
  if (datos.productos.length) {
    setCatalogData(datos);
    renderAllUI();
  }

  let t; $('#q').addEventListener('input', e => { 
    clearTimeout(t); 
    t = setTimeout(() => { state.q = e.target.value; state.cat = null; state.sub = null; state.page = 1; renderAllUI(); }, 140); 
  });
  
  $('#btnMore').onclick = () => { state.page++; renderGrid(handleAddToCart, handleViewProduct); };
  $('#btnCart').onclick = openCart;
  $('#cartClose').onclick = closeCart;
  $('#overlay').onclick = () => { closeCart(); closeCats(); };
  $('#modalClose').onclick = () => $('#modal').hidden = true;
  $('#modal').addEventListener('click', e => { if(e.target.id === 'modal') $('#modal').hidden = true; });
  $('#btnWhats').onclick = () => {
    const url = buildWhatsAppUrl(state.sucursal);
    if (url) window.open(url, '_blank'); else alert('Tu pedido está vacío.');
  };

  $('#btnCats').onclick = toggleCats;
  $('#catsClose').onclick = closeCats;
  document.querySelectorAll('.vt').forEach(b => { b.onclick = () => setView(b.dataset.view); });
  window.addEventListener('resize', () => { if(!esMovil()) closeCats(); });
  
  const admin = $('#btnAdmin'); if (admin) admin.onclick = toggleAdminUI;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('#modal').hidden = true; closeCart(); closeCats(); } });
}

init();