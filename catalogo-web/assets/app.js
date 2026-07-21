/* ===== Aceros Peñascal · Catálogo Digital · app.js =====
   Prototipo autocontenido (datos en data/productos.js). Diseñado para migrar
   despues a Supabase sin reescribir la interfaz. */
import { fetchCatalogo, agruparCategorias } from '../core/catalogService.js';

const CONFIG = {
  // 5 sucursales con su WhatsApp (formato wa.me: solo digitos, lada 52) y ubicacion
  sucursales: [
    { id:'matriz',   nombre:'Matriz',          wa:'522283170708', dir:'Av. Antonio Chedraui Caram 190, Diez de Mayo, 91180, Xalapa, Ver.' },
    { id:'bodega',   nombre:'Sucursal Bodega', wa:'522288604502', dir:'Camino al Sumidero 12, Casa Blanca, 91180, Xalapa, Ver.' },
    { id:'trancas',  nombre:'Las Trancas',     wa:'522288357198', dir:'Carr. Las Trancas–Coatepec km 1.300, Santa Lucía, Emiliano Zapata, Ver.' },
    { id:'coatepec', nombre:'Coatepec',        wa:'522288398812', dir:'Hernández y Hernández 149, Centro, 91500, Coatepec, Ver.' },
    { id:'naolinco', nombre:'Naolinco',        wa:'522281947245', dir:'5 de Febrero 55, Centro, 91400, Naolinco, Ver.' },
  ],
  fotoExts: ['webp','jpg','jpeg','png'],
  pageSize: 48,
};

//const DATA = window.CATALOGO || { productos:[], categorias:[] };
let DATA = { productos:[], categorias:[], total: 0 };
const LS_CART = 'ap_cart', LS_OVR = 'ap_overrides', LS_VIEW = 'ap_view';

const state = {
  q:'', cat:null, sub:null, page:1,
  cart: load(LS_CART, {}),
  overrides: load(LS_OVR, {}),
  sucursal: CONFIG.sucursales[0].id,
  view: load(LS_VIEW, 'grid'),   // 'grid' (2 columnas) | 'list' — solo aplica en móvil/tableta
  edit: false,
};

// ¿Estamos en el layout de teléfono/tableta? Debe coincidir con el breakpoint de styles.css
const esMovil = () => window.matchMedia('(max-width:880px)').matches;

// Aplica overrides de edicion (demo local) sobre los productos en memoria
DATA.productos.forEach(p => {
  const o = state.overrides[p.id];
  if (o) Object.assign(p, o);
});

/* ---------- utils ---------- */
function load(k, def){ try{ return JSON.parse(localStorage.getItem(k)) ?? def; }catch{ return def; } }
function save(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} }
function norm(s){ return (s||'').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,''); }
function esc(s){ return (s||'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function $(s,r=document){ return r.querySelector(s); }
function el(tag, cls, html){ const n=document.createElement(tag); if(cls)n.className=cls; if(html!=null)n.innerHTML=html; return n; }

const PLACEHOLDER = `<div class="ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/></svg>
<span>Sin foto</span></div>`;

/* Foto: si el producto trae una URL (subida desde el clasificador a Supabase
   Storage) ésa manda; si no, se usan los archivos locales fotos/<id>.<ext>. */
function esUrlFoto(f){ return typeof f==='string' && /^https?:\/\//i.test(f); }
function fuentesFoto(p){
  const out = [];
  if (esUrlFoto(p.foto)) out.push(p.foto);
  for (const e of CONFIG.fotoExts) out.push(`fotos/${p.id}.${e}`);
  return out;
}

function thumb(p){
  const box = el('div','thumb');
  const img = new Image();
  let i = 0;
  const fuentes = fuentesFoto(p);
  const tryNext = () => {
    if (i < fuentes.length){ img.src = fuentes[i++]; }
    else { box.innerHTML = PLACEHOLDER; }
  };
  img.onerror = tryNext;
  img.onload = () => { box.innerHTML=''; box.appendChild(img); };
  box.innerHTML = PLACEHOLDER;
  tryNext();
  box.addEventListener('click', ()=>openModal(p));
  return box;
}

/* ---------- filtro ---------- */
function filtered(){
  const q = norm(state.q);
  return DATA.productos.filter(p=>{
    if (state.cat && p.cat !== state.cat) return false;
    if (state.sub && p.sub !== state.sub) return false;
    if (q){
      const hay = norm(p.nom)+' '+norm(p.cod)+' '+norm(p.sub)+' '+norm(p.med);
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* ---------- sidebar ---------- */
function renderSidebar(){
  const s = $('#sidebar'); s.innerHTML='';
  s.appendChild(el('div','cat-title','Categorías'));
  const all = el('button','cat-btn'+(state.cat?'':' on'),
    `<span>Todas</span><span class="n">${DATA.total}</span>`);
  all.onclick = ()=>{ state.cat=null; state.sub=null; state.page=1; renderAll(); trasElegirCat(); };
  s.appendChild(all);
  DATA.categorias.forEach(c=>{
    const b = el('button','cat-btn'+(state.cat===c.nombre?' on':''),
      `<span>${esc(c.nombre)}</span><span class="n">${c.n}</span>`);
    b.onclick = ()=>{ state.cat=c.nombre; state.sub=null; state.page=1; renderAll(); trasElegirCat(); };
    s.appendChild(b);
  });
}

/* Al elegir categoría en móvil: cierra el panel y sube al inicio de la lista */
function trasElegirCat(){
  closeCats();
  window.scrollTo({ top:0, behavior:'smooth' });
}

function asArray(v){ return Array.isArray(v) ? v : (v==null ? [] : [v]); }
function renderSubchips(){
  const wrap = $('#subchips'); wrap.innerHTML='';
  if (!state.cat) return;
  const cat = DATA.categorias.find(c=>c.nombre===state.cat);
  const subs = cat ? asArray(cat.subs) : [];
  if (subs.length<=1) return;
  const all = el('button','chip'+(state.sub?'':' on'),'Todas');
  all.onclick=()=>{ state.sub=null; state.page=1; renderAll(); };
  wrap.appendChild(all);
  subs.forEach(su=>{
    const c=el('button','chip'+(state.sub===su.nombre?' on':''), `${esc(su.nombre)} · ${su.n}`);
    c.onclick=()=>{ state.sub=su.nombre; state.page=1; renderAll(); };
    wrap.appendChild(c);
  });
}

/* ---------- grid ---------- */
function card(p){
  const c = el('div','card');
  c.appendChild(thumb(p));
  const body = el('div','card-body');
  const name = el('div','card-name', esc(p.nom)); name.onclick=()=>openModal(p);
  body.appendChild(name);
  const meta = el('div','card-meta');
  if (p.sub && p.sub!=='POR CLASIFICAR') meta.appendChild(el('span','tag sub', esc(p.sub)));
  if (p.med) meta.appendChild(el('span','tag med', esc(p.med)));
  body.appendChild(meta);
  body.appendChild(el('div','card-cod', 'Cód: '+esc(p.cod)));
  const foot = el('div','card-foot');
  const add = el('button','btn-add','Agregar'); add.onclick=()=>addToCart(p);
  const view = el('button','btn-view','Ver'); view.onclick=()=>openModal(p);
  foot.appendChild(add); foot.appendChild(view);
  body.appendChild(foot);
  c.appendChild(body);
  return c;
}

function renderGrid(){
  const list = filtered();
  const grid = $('#grid');
  const limit = state.page * CONFIG.pageSize;
  grid.innerHTML='';
  if (!list.length){
    grid.appendChild(el('div','empty', DATA.total
      ? 'Sin resultados. Prueba con otro término o cambia de categoría.'
      : 'No se pudo cargar el catálogo. Revisa tu conexión e inténtalo de nuevo.'));
  }
  list.slice(0, limit).forEach(p=>grid.appendChild(card(p)));
  $('#count').textContent = `${list.length.toLocaleString('es-MX')} productos`;
  $('#crumbs').textContent = state.cat ? state.cat : 'Todas las categorías';
  const more = $('#btnMore');
  if (list.length > limit){ more.hidden=false; more.textContent = `Cargar más (${(list.length-limit).toLocaleString('es-MX')} restantes)`; }
  else more.hidden=true;
}

function renderAll(){ renderSidebar(); renderSubchips(); renderGrid(); }

/* ---------- panel de categorías (móvil/tableta) ---------- */
function catsAbierto(){ return document.body.classList.contains('cats-open'); }
function openCats(){
  closeCart();
  document.body.classList.add('cats-open');
  $('#btnCats').setAttribute('aria-expanded','true');
  $('#overlay').hidden = false;
}
function closeCats(){
  if (!catsAbierto()) return;
  document.body.classList.remove('cats-open');
  $('#btnCats').setAttribute('aria-expanded','false');
  if ($('#cart').hidden) $('#overlay').hidden = true;
}
function toggleCats(){ catsAbierto() ? closeCats() : openCats(); }

/* ---------- formato de visualización (móvil/tableta) ---------- */
function setView(v){
  state.view = (v === 'list') ? 'list' : 'grid';
  save(LS_VIEW, state.view);
  applyView();
}
function applyView(){
  $('#grid').className = 'grid ' + (state.view === 'list' ? 'view-list' : 'view-grid');
  document.querySelectorAll('.vt').forEach(b=>{
    const on = b.dataset.view === state.view;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

/* ---------- modal ---------- */
function openModal(p){
  const b = $('#modalBody');
  const ovrName = state.edit ? ' editable' : '';
  b.innerHTML = '';
  const photo = el('div','modal-photo');
  const ph = thumb(p); ph.style.cursor='default';
  photo.appendChild(ph);
  const info = el('div','modal-info');
  info.innerHTML = `
    <div class="modal-cat">${esc(p.cat)}</div>
    <div class="modal-name${ovrName}" data-f="nom">${esc(p.nom)}</div>
    <div class="spec"><b>Código</b><span>${esc(p.cod)}</span></div>
    <div class="spec"><b>Tipo</b><span class="${ovrName}" data-f="sub">${esc(p.sub||'—')}</span></div>
    <div class="spec"><b>Medidas</b><span class="${ovrName}" data-f="med">${esc(p.med||'—')}</span></div>
    ${state.edit ? `<div class="spec"><b>Proveedor</b><span>${esc(p.prov||'—')}</span></div>
      <div class="fname">Foto esperada: fotos/${p.id}.webp (o .jpg/.png)</div>` : ''}
    <div class="modal-cta">
      <button class="btn-quote" id="mQuote">Agregar al pedido y cotizar</button>
    </div>`;
  b.appendChild(photo); b.appendChild(info);
  if (state.edit) enableInlineEdit(info, p);
  $('#mQuote').onclick = ()=>{ addToCart(p); closeModal(); openCart(); };
  $('#modal').hidden=false;
}
function closeModal(){ $('#modal').hidden=true; }

function enableInlineEdit(root, p){
  root.querySelectorAll('[data-f]').forEach(node=>{
    node.setAttribute('contenteditable','true');
    node.addEventListener('blur', ()=>{
      const f = node.dataset.f; const val = node.textContent.trim();
      p[f] = val;
      state.overrides[p.id] = Object.assign({}, state.overrides[p.id], {[f]:val});
      save(LS_OVR, state.overrides);
      renderGrid();
    });
  });
}

/* ---------- carrito ---------- */
function addToCart(p){
  const c = state.cart[p.id] || { id:p.id, cod:p.cod, nom:p.nom, qty:0 };
  c.qty += 1; state.cart[p.id]=c; save(LS_CART,state.cart); refreshCart(); pulseCart();
}
function setQty(id, d){
  const c = state.cart[id]; if(!c) return;
  c.qty += d; if (c.qty<=0) delete state.cart[id];
  save(LS_CART,state.cart); refreshCart();
}
function cartArray(){ return Object.values(state.cart); }
function refreshCart(){
  const items = cartArray();
  $('#cartCount').textContent = items.reduce((a,b)=>a+b.qty,0);
  const box = $('#cartItems');
  if (!items.length){ box.innerHTML = '<div class="cart-empty">Tu pedido está vacío.<br>Agrega productos para cotizar.</div>'; return; }
  box.innerHTML='';
  items.forEach(it=>{
    const row = el('div','ci');
    row.innerHTML = `<div class="ci-name">${esc(it.nom)}<div class="ci-cod">${esc(it.cod)}</div></div>`;
    const qty = el('div','qty');
    const minus=el('button',null,'−'); minus.onclick=()=>setQty(it.id,-1);
    const span=el('span',null,it.qty);
    const plus=el('button',null,'+'); plus.onclick=()=>setQty(it.id,1);
    qty.append(minus,span,plus);
    const del=el('button','ci-del','×'); del.onclick=()=>{ delete state.cart[it.id]; save(LS_CART,state.cart); refreshCart(); };
    row.append(qty,del); box.appendChild(row);
  });
}
function openCart(){ closeCats(); $('#cart').hidden=false; $('#overlay').hidden=false; }
function closeCart(){ $('#cart').hidden=true; if(!catsAbierto()) $('#overlay').hidden=true; }
function pulseCart(){ const b=$('#btnCart'); b.animate([{transform:'scale(1)'},{transform:'scale(1.12)'},{transform:'scale(1)'}],{duration:220}); }

function sendWhatsApp(){
  const items = cartArray();
  if (!items.length){ alert('Tu pedido está vacío.'); return; }
  const suc = CONFIG.sucursales.find(s=>s.id===$('#sucursalCart').value) || CONFIG.sucursales[0];
  const lines = items.map(it=>`• ${it.qty} x ${it.nom}  (Cód: ${it.cod})`).join('\n');
  const msg = `Hola, Aceros Peñascal — ${suc.nombre}.\nQuisiera cotizar este pedido:\n\n${lines}\n\nQuedo atento a precio y disponibilidad. ¡Gracias!`;
  window.open(`https://wa.me/${suc.wa}?text=${encodeURIComponent(msg)}`, '_blank');
}

/* ---------- selects sucursal ---------- */
const PIN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
function sucById(id){ return CONFIG.sucursales.find(s=>s.id===id) || CONFIG.sucursales[0]; }
function mapsUrl(su){ return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Aceros Peñascal '+su.dir)}`; }

// Refresca el tooltip de los selects y la línea de dirección (clic abre Maps)
function updateSucInfo(){
  const su = sucById(state.sucursal);
  ['#sucursal','#sucursalCart'].forEach(sel=>{ const s=$(sel); if(s) s.title = su.dir; });
  const a = $('#sucDir');
  if (a){ a.href = mapsUrl(su); a.innerHTML = PIN_SVG + `<span>${esc(su.dir)}</span>`; }
}

function fillSucursales(){
  ['#sucursal','#sucursalCart'].forEach(sel=>{
    const s=$(sel); s.innerHTML='';
    CONFIG.sucursales.forEach(su=>{ const o=el('option',null,su.nombre); o.value=su.id; o.title=su.dir; s.appendChild(o); });
    s.value = state.sucursal;
    s.onchange = ()=>{ state.sucursal=s.value; $('#sucursal').value=s.value; $('#sucursalCart').value=s.value; updateSucInfo(); };
  });
  updateSucInfo();
}

/* ---------- admin ---------- */
function toggleAdmin(){
  state.edit = !state.edit;
  $('#btnAdmin').classList.toggle('on', state.edit);
  $('#adminBanner').hidden = !state.edit;
}

/* ---------- respaldo local ----------
   data/productos.js pesa ~600 KB, así que ya no se carga en el arranque (era
   media pantalla de espera en el celular). Solo se pide si Supabase no responde. */
function cargarRespaldoLocal(){
  return new Promise(resolve=>{
    if (window.CATALOGO) return resolve(window.CATALOGO);
    const s = document.createElement('script');
    s.src = 'data/productos.js';
    s.onload  = ()=>resolve(window.CATALOGO || null);
    s.onerror = ()=>resolve(null);
    document.head.appendChild(s);
  });
}

/* ---------- init ---------- */
async function init(){
  fillSucursales();
  refreshCart();
  applyView();

  let datos = await fetchCatalogo();
  if (!datos.productos.length){
    const local = await cargarRespaldoLocal();
    if (local && local.productos && local.productos.length){
      console.warn('Supabase no respondió: catálogo servido desde el respaldo local.');
      datos = { productos: local.productos, categorias: agruparCategorias(local.productos), total: local.productos.length };
    }
  }
  if (datos.productos.length){
    DATA = datos;
    DATA.productos.forEach(p => {
      const o = state.overrides[p.id];
      if (o) Object.assign(p, o);
    });
  }

  renderAll();

  // Tus listeners originales intactos
  let t; $('#q').addEventListener('input', e=>{ clearTimeout(t); t=setTimeout(()=>{ state.q=e.target.value; state.page=1; renderGrid(); },140); });
  $('#btnMore').onclick = ()=>{ state.page++; renderGrid(); };
  $('#btnCart').onclick = openCart;
  $('#cartClose').onclick = closeCart;
  $('#overlay').onclick = ()=>{ closeCart(); closeCats(); };
  $('#modalClose').onclick = closeModal;
  $('#modal').addEventListener('click', e=>{ if(e.target.id==='modal') closeModal(); });
  $('#btnWhats').onclick = sendWhatsApp;

  // Controles de la barra móvil
  $('#btnCats').onclick = toggleCats;
  $('#catsClose').onclick = closeCats;
  document.querySelectorAll('.vt').forEach(b=>{ b.onclick = ()=>setView(b.dataset.view); });
  window.addEventListener('resize', ()=>{ if(!esMovil()) closeCats(); });

  // #btnAdmin solo existe en el prototipo con modo edición; sin esta guarda,
  // el error dejaba sin registrar el atajo Escape de abajo.
  const admin = $('#btnAdmin');
  if (admin) admin.onclick = toggleAdmin;

  document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ closeModal(); closeCart(); closeCats(); } });
}
init();
