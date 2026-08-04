import { fetchCatalogo, agruparCategorias } from '../core/catalogService.js';
import { state, DATA, setCatalogData, cargarFotosManifest, CAT_OCULTA, ETQ_OBSOLETO } from '../core/store.js';
import { addToCartLogic, addManyToCartLogic, setQtyLogic, buildWhatsAppUrl, getCartItems } from '../core/cartService.js';
import { cargarFamilias, indexarFamilias } from '../core/familiaService.js';
import { AJUSTES, cargarAjustes } from '../core/ajustesService.js';
import { setSinonimos } from '../core/searchService.js';
import { registrarVista, registrarAgregado, registrarPedido, registrarBusqueda } from '../core/metricsService.js';
import { supabase } from '../core/supabaseClient.js';
import { $, renderGrid, renderSidebar, renderSubchips, refreshCartUI, applyView, setView, openCart, closeCart, closeCats, toggleCats, pulseCart, toggleAdminUI, esMovil, el, esc, thumb, trasElegirCat, buildFichaFamilia, PIN_SVG, getSearchResults } from './ui.js';

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
  registrarAgregado([{ p, qty: 1 }]);
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
    registrarAgregado(lineas, entry.fam.id);
    refreshCartUI(id => handleSetQty(id, -1), id => handleSetQty(id, 1), id => handleSetQty(id, -9999));
    $('#modal').hidden = true;
    pulseCart();
    openCart();
  }));
  abrirModal(true);
}

function handleViewProduct(p) {
  registrarVista(p);
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
// AJUSTES.sucursales sale de la base (editable desde el clasificador) y arranca
// con las de core/config.js, así que nunca queda vacío.
function sucById(id){ return AJUSTES.sucursales.find(s=>s.id===id) || AJUSTES.sucursales[0]; }
function mapsUrl(su){ return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Aceros Peñascal '+su.dir)}`; }

function updateSucInfo(){
  const su = sucById(state.sucursal);
  if (!su) return;
  ['#sucursal','#sucursalCart'].forEach(sel=>{ const s=$(sel); if(s) s.title = su.dir; });
  const a = $('#sucDir');
  if (a){
    a.href = mapsUrl(su);
    a.innerHTML = PIN_SVG + `<span>${esc(su.dir || 'Dirección no disponible')}</span>`;
    // Sin dirección no hay nada que abrir en el mapa: el recuadro entero se va,
    // antes que dejar un enlace que lleva a una búsqueda vacía.
    const caja = a.closest('.dir-caja');
    if (caja) caja.hidden = !su.dir;
  }
}

/* Los selectores de sucursal se rearman cuando llegan las de la base: pueden
   haber cambiado de nombre, haberse agregado una o haberse dado de baja. */
function pintarSucursales(){
  const lista = AJUSTES.sucursales;
  if (!lista.length) return;
  if (!lista.some(s=>s.id===state.sucursal)) state.sucursal = lista[0].id;
  ['#sucursal','#sucursalCart'].forEach(sel => {
    const s = $(sel); if (!s) return;
    s.innerHTML = '';
    lista.forEach(su => { const o = el('option',null,su.nombre); o.value=su.id; o.title=su.dir||''; s.appendChild(o); });
    s.value = state.sucursal;
    s.onchange = () => {
      state.sucursal = s.value;
      $('#sucursal').value = s.value; $('#sucursalCart').value = s.value;
      updateSucInfo();
    };
  });
  updateSucInfo();
}

/* Los textos que el encargado edita desde el clasificador. */
function pintarTextos(){
  const nota = $('#cartNota');
  if (nota && AJUSTES.textos.nota_sin_precios) nota.textContent = AJUSTES.textos.nota_sin_precios;
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

// --- Carga de las agrupaciones (qué productos van juntos en una tarjeta) ---
// Fuente de verdad: la tabla `familias` de Supabase, que el encargado edita
// desde el clasificador. El archivo del repositorio queda como respaldo para el
// modo sin conexión (doble clic en index.html).
//
// Es opcional por diseño: si no carga ninguna de las dos, hayFamilias() queda en
// false y el catálogo se comporta como siempre, producto por producto. Nunca
// debe impedir el arranque.
async function cargarFichasFamilia() {
  try {
    const { data, error } = await supabase.from('familias').select('*');
    if (!error && Array.isArray(data) && data.length) {
      console.log(`[familias] ${cargarFamilias(data)} agrupaciones cargadas de Supabase.`);
      return;
    }
    if (error) throw error;
  } catch (e) {
    console.warn('[familias] No se pudo leer de la base, se usa el respaldo:', e.message);
  }

  let doc = null;
  try {
    const r = await fetch('data/familias.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    doc = await r.json();
  } catch (e) {
    doc = await cargarScript('../data/familias.js', 'FAMILIAS');   // camino sin servidor
    if (!doc) { console.warn('[familias] Sin agrupación por familias:', e.message); return; }
  }
  console.log(`[familias] ${cargarFamilias(doc)} agrupaciones cargadas del respaldo local.`);
}

// --- Inicialización Principal ---
async function init() {
  applyView();
  refreshCartUI(id => handleSetQty(id, -1), id => handleSetQty(id, 1), id => handleSetQty(id, -9999));

  // Primero con las de core/config.js, para que la barra no salga vacía ni un
  // instante; cargarAjustes() las reemplaza por las de la base en cuanto llegan.
  pintarSucursales();

  let datos = await fetchCatalogo();
  if (!datos.productos.length) {
    const local = await cargarRespaldoLocal();
    if (local && local.productos.length) {
      // El archivo local es la copia INTERNA: trae el proveedor de todos los
      // productos. Aquí se respeta el mismo interruptor que aplica la vista de
      // Supabase, para que el respaldo nunca publique lo que la base oculta.
      // Y se descartan los descontinuados: la vista de Supabase ya los filtra,
      // así que el respaldo no puede ser la vía por la que se cuelen. Lo mismo
      // con la marca de gestión «obsoleto», que es la forma nueva de retirar un
      // producto sin perder la categoría en la que estaba clasificado.
      const productos = local.productos
        .filter(p => p.cat !== CAT_OCULTA && !(Array.isArray(p.etq) && p.etq.includes(ETQ_OBSOLETO)))
        .map(p => Object.assign({}, p, { prov: p.mprov ? (p.prov || '') : '' }));
      datos = { productos, categorias: agruparCategorias(productos), total: productos.length };
    }
  }
  
  if (datos.productos.length) {
    setCatalogData(datos);
    /* Tres cosas que cambian lo que se pinta, resueltas antes del primer render
       y en paralelo: qué fotos existen, qué productos van juntos y qué configuró
       el encargado (sucursales, textos y destacados de la portada). */
    await Promise.all([cargarManifestFotos(), cargarFichasFamilia(), cargarAjustes()]);
    indexarFamilias();             // cruza los códigos agrupados con este catálogo
    pintarSucursales();
    pintarTextos();
    // El diccionario de búsqueda tiene que estar puesto ANTES del primer render:
    // si alguien llega con una búsqueda ya escrita, debe traducirse igual.
    console.log(`[busqueda] ${setSinonimos(AJUSTES.sinonimos)} traducción(es) activas.`);
    renderAllUI();
  }

  let t; $('#q').addEventListener('input', e => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.q = e.target.value; state.cat = null; state.sub = null; state.page = 1;
      renderAllUI();
      // Lo que se busca y no aparece es el mejor mapa de huecos del catálogo:
      // se registra cuando el usuario deja de escribir, no letra por letra.
      registrarBusqueda(state.q, getSearchResults().length);
    }, 140);
  });
  
  $('#btnMore').onclick = () => { state.page++; pintarGrid(); };
  $('#btnCart').onclick = openCart;
  $('#cartClose').onclick = closeCart;
  $('#overlay').onclick = () => { closeCart(); closeCats(); };
  $('#modalClose').onclick = () => $('#modal').hidden = true;
  $('#modal').addEventListener('click', e => { if(e.target.id === 'modal') $('#modal').hidden = true; });
  $('#btnWhats').onclick = () => {
    const url = buildWhatsAppUrl(state.sucursal);
    if (!url) { alert('Tu pedido está vacío.'); return; }
    // El pedido enviado es LA señal buena de popularidad: se registra antes de
    // saltar a WhatsApp, porque después esta pestaña puede quedarse atrás.
    registrarPedido(getCartItems(), state.sucursal);
    window.open(url, '_blank');
  };

  $('#btnCats').onclick = toggleCats;
  $('#catsClose').onclick = closeCats;
  document.querySelectorAll('.vt').forEach(b => { b.onclick = () => setView(b.dataset.view); });
  window.addEventListener('resize', () => { if(!esMovil()) closeCats(); });
  
  const admin = $('#btnAdmin'); if (admin) admin.onclick = toggleAdminUI;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('#modal').hidden = true; closeCart(); closeCats(); } });
}

init();