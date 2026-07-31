import { fetchCatalogo, agruparCategorias } from '../core/catalogService.js';
import { state, DATA, setCatalogData, CONFIG, cargarFotosManifest, CAT_OCULTA } from '../core/store.js';
import { addToCartLogic, addManyToCartLogic, setQtyLogic, buildWhatsAppUrl } from '../core/cartService.js';
import { cargarFamilias, indexarFamilias } from '../core/familiaService.js';
import { $, renderGrid, renderSidebar, renderSubchips, refreshCartUI, applyView, setView, openCart, closeCart, closeCats, toggleCats, pulseCart, toggleAdminUI, esMovil, el, esc, thumb, trasElegirCat, buildFichaFamilia, PIN_SVG } from './ui.js';

// --- Orquestador Principal de UI ---
function renderAllUI() {
  renderSidebar((cat) => { state.cat = cat; state.sub = null; state.page = 1; renderAllUI(); trasElegirCat(); });
  renderSubchips(
    (cat) => { state.cat = cat; state.sub = null; state.page = 1; renderAllUI(); },
    (sub) => { state.sub = sub; state.page = 1; renderAllUI(); }
  );
  pintarGrid();
}

const pintarGrid = () => renderGrid(handleAddToCart, handleViewProduct, handleViewFamilia);

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

/* La ficha de producto y la de familia comparten el mismo modal; solo cambia el
   ancho y la retícula, porque una tabla de 32 medidas no cabe en dos columnas. */
function abrirModal(esFamilia) {
  $('#modalBody').className = 'modal-body' + (esFamilia ? ' modal-body-fam' : '');
  document.querySelector('#modal .modal-card').classList.toggle('modal-card-ancho', !!esFamilia);
  $('#modal').hidden = false;
}

function handleViewFamilia(entry) {
  const b = $('#modalBody');
  b.innerHTML = '';
  b.appendChild(buildFichaFamilia(entry, (lineas) => {
    addManyToCartLogic(lineas);
    refreshCartUI(id => handleSetQty(id, -1), id => handleSetQty(id, 1), id => handleSetQty(id, -9999));
    $('#modal').hidden = true;
    pulseCart();
    openCart();
  }));
  abrirModal(true);
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
    <div class="spec spec-med"><b>Medida</b><span class="${ovrName}">${esc(p.med||'—')}</span></div>
    ${p.prov ? `<div class="spec"><b>Proveedor</b><span>${esc(p.prov)}</span></div>` : ''}
    ${state.edit ? `<div class="fname">Foto esperada: fotos/${p.id}.webp</div>` : ''}
    <div class="modal-cta"><button class="btn-quote" id="mQuote">Agregar al pedido y cotizar</button></div>`;
  
  b.append(photo, info);
  $('#mQuote').onclick = () => { handleAddToCart(p); $('#modal').hidden=true; openCart(); };
  abrirModal(false);
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

// --- Carga del manifest de fotos disponibles ---
async function cargarManifestFotos() {
  try {
    const r = await fetch('data/fotos-manifest.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const stems = await r.json();
    cargarFotosManifest(stems);
    console.log(`[fotos-manifest] ${stems.length} fotos disponibles cargadas.`);
  } catch (e) {
    console.warn('[fotos-manifest] No se pudo cargar. Orden visual desactivado.', e.message);
  }
}

// --- Carga Local de Respaldo ---
function cargarScript(src, global){
  return new Promise(resolve => {
    if (window[global]) return resolve(window[global]);
    const s = document.createElement('script');
    s.src = src;
    s.onload  = () => resolve(window[global] || null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
}

const cargarRespaldoLocal = () => cargarScript('../data/productos.js', 'CATALOGO');

// --- Carga de las fichas de familia (qué productos van juntos en una tarjeta) ---
// Es opcional por diseño: si no carga, hayFamilias() queda en false y el catálogo
// se comporta como siempre, producto por producto. Nunca debe impedir el arranque.
async function cargarFichasFamilia() {
  let doc = null;
  try {
    const r = await fetch('data/familias.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    doc = await r.json();
  } catch (e) {
    doc = await cargarScript('../data/familias.js', 'FAMILIAS');   // camino sin servidor
    if (!doc) { console.warn('[familias] Sin agrupación por familias:', e.message); return; }
  }
  console.log(`[familias] ${cargarFamilias(doc)} fichas de familia cargadas.`);
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
      // El archivo local es la copia INTERNA: trae el proveedor de todos los
      // productos. Aquí se respeta el mismo interruptor que aplica la vista de
      // Supabase, para que el respaldo nunca publique lo que la base oculta.
      // Y se descartan los descontinuados: la vista de Supabase ya los filtra,
      // así que el respaldo no puede ser la vía por la que se cuelen.
      const productos = local.productos
        .filter(p => p.cat !== CAT_OCULTA)
        .map(p => Object.assign({}, p, { prov: p.mprov ? (p.prov || '') : '' }));
      datos = { productos, categorias: agruparCategorias(productos), total: productos.length };
    }
  }
  
  if (datos.productos.length) {
    setCatalogData(datos);
    // Saber qué fotos existen y qué productos van juntos ANTES de renderizar:
    // ambas cosas cambian lo que se pinta, así que se resuelven en paralelo.
    await Promise.all([cargarManifestFotos(), cargarFichasFamilia()]);
    indexarFamilias();             // cruza los códigos aprobados con este catálogo
    renderAllUI();
  }

  let t; $('#q').addEventListener('input', e => { 
    clearTimeout(t); 
    t = setTimeout(() => { state.q = e.target.value; state.cat = null; state.sub = null; state.page = 1; renderAllUI(); }, 140); 
  });
  
  $('#btnMore').onclick = () => { state.page++; pintarGrid(); };
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