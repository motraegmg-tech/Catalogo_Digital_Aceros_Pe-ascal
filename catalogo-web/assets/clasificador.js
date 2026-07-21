/* ===== Aceros Peñascal · Clasificador de Catálogo · clasificador.js =====
   Herramienta interna (MOTRAE) para curar manualmente la clasificación de los
   3,222 productos. Corre bajo file:// igual que el prototipo: los datos entran
   por window.CATALOGO (data/productos.js) y el avance vive en localStorage
   como deltas (asignaciones/ediciones), reimportable y exportable.

   Modelo v2: taxonomía de 3 niveles (categoría → subcategoría → sub-sub),
   productos con campo efectivo sub2. Los avances v1 se migran solos. */

const POR = 'POR CLASIFICAR';
const LS_KEY = 'ap_clasificador_v1';
const SEP = '';                 // separador interno (valores compuestos)
const PAGE_LISTA = 100, PAGE_PREVIA = 60;
const FOTO_EXTS = ['webp','jpg','jpeg','png'];

/* ---------- marcas de gestión (las "categorías extra") ----------
   Un producto sigue teniendo UNA categoría real, pero además puede llevar
   estas marcas para rastrear lo que todavía no está 100% configurado. Viven en
   el arreglo `etq` y se sincronizan a Supabase (columna `etiquetas`). */
const ETIQUETAS = [
  { id:'sin-foto',         label:'Productos sin foto o foto errónea', corto:'Sin foto' },
  { id:'sin-conocimiento', label:'Productos sin conocimiento',        corto:'Sin conocimiento' },
];
const ETQMAP = new Map(ETIQUETAS.map(e=>[e.id,e]));
function etqDe(p){ return Array.isArray(p.etq) ? p.etq : []; }
function tieneEtq(p,id){ return etqDe(p).includes(id); }
function etqKey(p){ return etqDe(p).slice().sort().join(','); }

const DATA = window.CATALOGO || { generado:'', total:0, productos:[], categorias:[] };

/* ---------- utils ---------- */
function load(k, def){ try{ return JSON.parse(localStorage.getItem(k)) ?? def; }catch{ return def; } }
function norm(s){ return (s||'').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,''); }
function esc(s){ return (s||'').toString().replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function $(s,r=document){ return r.querySelector(s); }
function el(tag, cls, html){ const n=document.createElement(tag); if(cls)n.className=cls; if(html!=null)n.innerHTML=html; return n; }
function fmt(n){ return (n||0).toLocaleString('es-MX'); }
function hoyISO(){ return new Date().toISOString().slice(0,10); }
function asArray(v){ return Array.isArray(v) ? v : (v==null ? [] : [v]); }
function alfa(a,b){ return a.localeCompare(b,'es',{sensitivity:'base'}); }
function alfaN(a,b){ return alfa(a.nombre,b.nombre); }
function parseSubVal(v){ const i=(v||'').indexOf(SEP); return i<0 ? {sub:v||'', sub2:''} : {sub:v.slice(0,i), sub2:v.slice(i+1)}; }
function subVal(sub, sub2){ return sub2 ? sub+SEP+sub2 : (sub||''); }
function rutaTxt(cat, sub, sub2){ return cat + (sub&&sub!==cat?' › '+sub:'') + (sub2?' › '+sub2:''); }

/* ---------- estado persistente (WORK) ---------- */
/* Taxonomía v2: [{nombre, subs:[{nombre, subs:[string]}]}] (3er nivel = strings) */
function taxDesdeBase(){
  return DATA.categorias
    .filter(c=>c.nombre!==POR)
    .map(c=>({ nombre:c.nombre,
      subs: asArray(c.subs).map(s=>s.nombre).filter(s=>s!==c.nombre)
        .sort(alfa).map(s=>({nombre:s, subs:[]})) }));
}
function nuevoTrabajo(){
  return { version:2, creado:hoyISO(), guardado:null, baseGenerado:DATA.generado||'',
    taxonomia:taxDesdeBase(), asignaciones:{}, ediciones:{}, etiquetas:{}, bitacora:[] };
}
function migrar(w){
  // v1 → v2: subs de strings a objetos {nombre, subs:[]}
  w.taxonomia = (w.taxonomia||[]).map(c=>({
    nombre:c.nombre,
    subs:(c.subs||[]).map(s=> typeof s==='string'
      ? {nombre:s, subs:[]}
      : {nombre:s.nombre, subs:(s.subs||[]).map(x=>typeof x==='string'?x:x.nombre)}),
  }));
  w.version = 2;
  w.asignaciones = w.asignaciones||{}; w.ediciones = w.ediciones||{};
  w.etiquetas = w.etiquetas||{}; w.bitacora = w.bitacora||[];
  return w;
}
let WORK = load(LS_KEY, null);
WORK = (WORK && (WORK.version===1||WORK.version===2) && Array.isArray(WORK.taxonomia))
  ? migrar(WORK) : nuevoTrabajo();

let PERSIST = true;
function persistir(){
  if (!PERSIST) return;
  WORK.guardado = new Date().toISOString();
  try{ localStorage.setItem(LS_KEY, JSON.stringify(WORK)); }
  catch(e){ aviso('⚠ No se pudo autoguardar: '+e.message); return; }
  const h = $('#saveHint');
  h.textContent = 'Guardado ✓ ' + new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'});
  h.classList.add('on');
  clearTimeout(persistir._t); persistir._t = setTimeout(()=>h.classList.remove('on'), 2200);
  programarGuardadoCatalogo();   // conexión directa: reescribe productos.js/.json
  programarSyncSupabase();       // sincronización en línea: sube cambios a Supabase
}

/* ---------- conexión directa con el catálogo (File System Access) ----------
   Con la carpeta catalogo-web/data/ conectada (elegida UNA vez por el usuario),
   cada cambio reescribe productos.js y productos.json ahí mismo: los cambios
   viven en el código original del catálogo. El permiso queda recordado en
   IndexedDB; al reabrir, el navegador puede pedir reconfirmar con un clic. */
const FS = { dir:null, estado:'off', ultimo:null }; // off | prompt | on | error | nosoporte
const IDB_NOMBRE = 'ap_clasificador_fs', IDB_STORE = 'handles';

function idbAbrir(){
  return new Promise((res,rej)=>{
    const r = indexedDB.open(IDB_NOMBRE, 1);
    r.onupgradeneeded = ()=>r.result.createObjectStore(IDB_STORE);
    r.onsuccess = ()=>res(r.result);
    r.onerror = ()=>rej(r.error);
  });
}
async function idbSet(k,v){
  const db = await idbAbrir();
  return new Promise((res,rej)=>{
    const tx = db.transaction(IDB_STORE,'readwrite');
    tx.objectStore(IDB_STORE).put(v,k);
    tx.oncomplete = ()=>{ db.close(); res(); };
    tx.onerror = ()=>{ db.close(); rej(tx.error); };
  });
}
async function idbGet(k){
  const db = await idbAbrir();
  return new Promise((res,rej)=>{
    const rq = db.transaction(IDB_STORE,'readonly').objectStore(IDB_STORE).get(k);
    rq.onsuccess = ()=>{ db.close(); res(rq.result); };
    rq.onerror = ()=>{ db.close(); rej(rq.error); };
  });
}
async function idbDel(k){
  const db = await idbAbrir();
  return new Promise((res,rej)=>{
    const tx = db.transaction(IDB_STORE,'readwrite');
    tx.objectStore(IDB_STORE).delete(k);
    tx.oncomplete = ()=>{ db.close(); res(); };
    tx.onerror = ()=>{ db.close(); rej(tx.error); };
  });
}

async function initFs(){
  if (!window.showDirectoryPicker){ FS.estado='nosoporte'; renderFsEstado(); return; }
  try{
    const dir = await idbGet('dir');
    if (!dir){ FS.estado='off'; renderFsEstado(); return; }
    FS.dir = dir;
    const p = await dir.queryPermission({mode:'readwrite'});
    FS.estado = (p==='granted') ? 'on' : 'prompt';
  }catch{ FS.estado='off'; }
  renderFsEstado();
  if (FS.estado==='on') aviso('● Catálogo conectado: guardado directo activo');
}

async function conectarCatalogo(){
  if (!window.showDirectoryPicker){ aviso('⚠ Este navegador no soporta guardado directo; usa Edge o Chrome.'); return; }
  try{
    const dir = await window.showDirectoryPicker({ id:'ap-catalogo-data', mode:'readwrite' });
    let existia = true;
    try{ await dir.getFileHandle('productos.js'); }catch{ existia = false; }
    if (!existia){
      const ok = await dialogo({ titulo:'Carpeta sin productos.js',
        texto:`La carpeta "${dir.name}" no contiene productos.js. La carpeta correcta es catalogo-web/data. ¿Escribir los archivos aquí de todos modos?`,
        okTxt:'Usar esta carpeta' });
      if (!ok) return;
    }
    FS.dir = dir; FS.estado='on';
    try{ await idbSet('dir', dir); }catch{}
    bitacora('Catálogo conectado (carpeta "'+dir.name+'")');
    const ok = await guardarEnCatalogo('conexión');
    if (ok) aviso('✓ Catálogo conectado: tus cambios se escriben solos en productos.js');
  }catch(e){
    if (e && e.name==='AbortError') return;
    aviso('⚠ No se pudo conectar: '+(e.message||e.name));
  }
  renderFsEstado();
}

async function reconectarCatalogo(){
  if (!FS.dir){ conectarCatalogo(); return; }
  try{
    const p = await FS.dir.requestPermission({mode:'readwrite'});
    if (p==='granted'){
      FS.estado='on';
      await guardarEnCatalogo('reconexión');
      aviso('✓ Catálogo reconectado');
    } else {
      aviso('Permiso denegado: el guardado directo queda pausado.');
    }
  }catch(e){ aviso('⚠ '+(e.message||e.name)); }
  renderFsEstado();
}

async function desconectarCatalogo(){
  const ok = await dialogo({ titulo:'Desconectar catálogo',
    texto:'El guardado directo se detiene (tu avance local no se toca). Podrás volver a conectar cuando quieras.', okTxt:'Desconectar' });
  if (!ok) return;
  FS.dir=null; FS.estado='off'; FS.ultimo=null;
  try{ await idbDel('dir'); }catch{}
  bitacora('Catálogo desconectado');
  renderFsEstado();
  aviso('Conexión con el catálogo eliminada');
}

async function escribirArchivo(dir, nombre, contenido){
  const fh = await dir.getFileHandle(nombre, {create:true});
  const w = await fh.createWritable();
  await w.write(contenido); await w.close();
}

let FS_T = null;
function programarGuardadoCatalogo(){
  if (FS.estado!=='on') return;
  clearTimeout(FS_T);
  FS_T = setTimeout(()=>guardarEnCatalogo('auto'), 1600);
}

async function guardarEnCatalogo(origen){
  if (!FS.dir || (FS.estado!=='on' && origen!=='conexión' && origen!=='reconexión')) return false;
  try{
    const ex = construirExport();
    await escribirArchivo(FS.dir, 'productos.js', 'window.CATALOGO = '+JSON.stringify(ex)+';');
    await escribirArchivo(FS.dir, 'productos.json', JSON.stringify(ex));
    // El archivo base ahora es nuestro: sincroniza la referencia sin re-disparar
    WORK.baseGenerado = ex.generado;
    try{ localStorage.setItem(LS_KEY, JSON.stringify(WORK)); }catch{}
    FS.estado='on'; FS.ultimo = new Date();
    renderFsEstado();
    return true;
  }catch(e){
    FS.estado = (e && (e.name==='NotAllowedError'||e.name==='SecurityError')) ? 'prompt' : 'error';
    renderFsEstado();
    aviso('⚠ No se pudo escribir el catálogo: '+(e.message||e.name));
    return false;
  }
}

function renderFsEstado(){
  const btn = $('#fsBtn'), txt = $('#fsTxt');
  if (!btn || !txt) return;
  const hora = FS.ultimo ? FS.ultimo.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}) : null;
  btn.hidden = false; btn.className='fs-btn'; btn.onclick = null;
  if (FS.estado==='nosoporte'){
    btn.hidden = true;
    txt.textContent = 'Guardado directo no disponible en este navegador (usa Edge o Chrome); exporta productos.js manualmente.';
  } else if (FS.estado==='off'){
    btn.textContent = '🔗 Conectar con el catálogo'; btn.onclick = conectarCatalogo;
    txt.textContent = 'Conéctalo una vez y cada cambio se escribirá solo en data/productos.js.';
  } else if (FS.estado==='prompt'){
    btn.classList.add('prompt');
    btn.textContent = '🔄 Reconectar catálogo (1 clic)'; btn.onclick = reconectarCatalogo;
    txt.textContent = 'El navegador pide reconfirmar el permiso de escritura.';
  } else if (FS.estado==='on'){
    btn.hidden = true;
    txt.innerHTML = '<span class="fs-on">● Catálogo conectado</span> — guardado automático' + (hora ? ' · escrito '+hora : '');
  } else { // error
    btn.classList.add('err');
    btn.textContent = '⚠ Reintentar escritura'; btn.onclick = ()=>guardarEnCatalogo('manual');
    txt.textContent = 'No se pudo escribir en la carpeta del catálogo.';
  }
  if (!$('#modalDatos').hidden) pintarFsDatos();
}

function pintarFsDatos(){
  const d = $('#fsDatosTxt'); if (!d) return;
  const hora = FS.ultimo ? FS.ultimo.toLocaleString('es-MX') : '—';
  const estados = {
    nosoporte:'<b style="color:var(--oxido)">No soportado en este navegador</b> (usa Edge o Chrome).',
    off:'Sin conexión. Conecta la carpeta <code>catalogo-web/data/</code> para que los cambios se escriban solos.',
    prompt:'<b style="color:#8a6414">Pausado</b>: el navegador pide reconfirmar el permiso (botón Reconectar).',
    on:`<b style="color:var(--zintro-2)">● Conectado${FS.dir?' a "'+esc(FS.dir.name)+'"':''}</b> — cada cambio reescribe productos.js y productos.json.`,
    error:'<b style="color:var(--oxido)">Error al escribir</b>: revisa que la carpeta exista y reintenta.',
  };
  d.innerHTML = (estados[FS.estado]||'') + `<br>Última escritura: ${hora}`;
  $('#btnFsConectar').textContent = FS.estado==='prompt' ? '🔄 Reconectar' : '🔗 Conectar carpeta data/';
  $('#btnFsGuardar').disabled = FS.estado!=='on';
  $('#btnFsDesconectar').disabled = (FS.estado==='off'||FS.estado==='nosoporte');
}

/* ---------- sincronización en línea con Supabase ----------
   Login seguro (Supabase Auth): sólo un usuario autenticado puede reclasificar
   la tabla `productos`. Cada cambio marca el producto como "sucio" (por código);
   con sesión activa se empuja a Supabase en lotes agrupados por destino. El
   catálogo público lo refleja al refrescar. La escritura al archivo local la
   sigue haciendo la conexión directa (File System Access) de arriba. */
const SBC = (window.supabase && window.SUPA_CFG)
  ? window.supabase.createClient(window.SUPA_CFG.URL, window.SUPA_CFG.KEY)
  : null;
const SB = { user:null, estado: SBC ? 'anon' : 'nosoporte', ultimo:null, error:null };
// estado: nosoporte | anon (sin sesión) | on (sesión activa) | sync | error
const SB_SEP = '';
// Clave de comparación: categoría + subcategoría + marcas de gestión
function sbClave(p){ return (p.cat||'')+SB_SEP+(p.sub||'')+SB_SEP+etqKey(p); }
// Estado que asumimos ya está en Supabase (arranca == base local == BD desplegada)
const SB_BASE = new Map(DATA.productos.map(p => [p.cod, sbClave(p)]));
const SB_DIRTY = new Set();   // códigos cuya categoría/subcategoría difieren de Supabase

function marcarSucios(){
  if (!SBC) return;
  for (const p of PRODUCTOS){
    const key = sbClave(p);
    if (SB_BASE.get(p.cod) !== key) SB_DIRTY.add(p.cod);
    else SB_DIRTY.delete(p.cod);
  }
  renderSbEstado();
}

let SB_T = null;
function programarSyncSupabase(){
  if (!SBC || SB.estado==='nosoporte') return;
  clearTimeout(SB_T);
  SB_T = setTimeout(()=>sincronizarSupabase('auto'), 1600);
}

async function sincronizarSupabase(origen){
  if (!SBC) return false;
  if (!SB.user){ if (origen!=='auto') aviso('⚠ Inicia sesión para sincronizar en línea.'); return false; }
  if (!SB_DIRTY.size){ if (origen!=='auto') aviso('Todo al día: nada por sincronizar.'); return true; }
  // Agrupa por destino (categoria|subcategoria) para actualizar en lote
  const grupos = new Map();
  for (const p of PRODUCTOS){
    if (!SB_DIRTY.has(p.cod)) continue;
    const key = sbClave(p);
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(p.cod);
  }
  SB.estado='sync'; renderSbEstado();
  let escritos = 0, fallo = null;
  for (const [key, cods] of grupos){
    const [cat, sub, etqs] = key.split(SB_SEP);
    for (let i=0;i<cods.length;i+=200){          // trocea por límite de URL de .in()
      const lote = cods.slice(i, i+200);
      const { error } = await SBC.from('productos')
        .update({ categoria: cat, subcategoria: sub, etiquetas: etqs ? etqs.split(',') : [] })
        .in('codigo', lote);
      if (error){ fallo = error; break; }
      for (const c of lote){ SB_BASE.set(c, key); SB_DIRTY.delete(c); escritos++; }
    }
    if (fallo) break;
  }
  if (fallo){
    SB.estado='error'; SB.error = fallo.message || String(fallo); renderSbEstado();
    aviso('⚠ Error al sincronizar con Supabase: '+SB.error);
    return false;
  }
  SB.estado='on'; SB.ultimo=new Date(); SB.error=null; renderSbEstado();
  if (escritos && origen!=='auto') aviso('☁ Sincronizados '+fmt(escritos)+' producto(s) en línea.');
  return true;
}

function sbAplicarSesion(session){
  SB.user = session?.user || null;
  SB.estado = SB.user ? 'on' : 'anon';
  renderSbEstado();
  if (SB.user){ marcarSucios(); programarSyncSupabase(); }   // sube lo pendiente al entrar
}

async function sbLogin(){
  if (!SBC) return;
  const email = ($('#sbEmail')?.value||'').trim();
  const password = $('#sbPass')?.value||'';
  if (!email || !password){ aviso('Escribe correo y contraseña.'); return; }
  const btn = $('#sbLogin'); if (btn){ btn.disabled=true; btn.textContent='Entrando…'; }
  const { data, error } = await SBC.auth.signInWithPassword({ email, password });
  if (btn){ btn.disabled=false; btn.textContent='🔐 Iniciar sesión'; }
  if (error){ aviso('⚠ No se pudo iniciar sesión: '+error.message); return; }
  if ($('#sbPass')) $('#sbPass').value='';
  aviso('✓ Sesión iniciada: '+(data.user?.email||''));   // onAuthStateChange hará el flush
}

async function sbLogout(){
  if (!SBC) return;
  await SBC.auth.signOut();
  aviso('Sesión cerrada. Tus cambios se siguen guardando localmente (pendientes de subir).');
}

function renderSbEstado(){
  const head = $('#sbTxt'), full = $('#sbEstadoTxt');
  const loginRow = $('#sbLoginRow'), sessRow = $('#sbSessionRow');
  const pend = SB_DIRTY.size;
  const hora = SB.ultimo ? SB.ultimo.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}) : null;
  let h='', f='';
  switch (SB.estado){
    case 'nosoporte':
      f = 'Sincronización en línea no disponible (no cargó el cliente de Supabase; revisa tu conexión).'; break;
    case 'anon':
      h = '<b>○ Sin sesión</b>' + (pend?` · ${fmt(pend)} pend.`:'');
      f = 'Sin sesión: tus cambios NO se suben en línea. Inicia sesión abajo para activarlo.'
          + (pend?` Hay <b>${fmt(pend)}</b> cambio(s) pendiente(s) de subir.`:''); break;
    case 'sync':
      h = '<b style="color:var(--zintro-2)">↻ Sincronizando…</b>';
      f = 'Subiendo cambios a Supabase…'; break;
    case 'on':
      h = '<b style="color:var(--zintro-2)">● En línea</b>' + (SB.user?.email?' · '+esc(SB.user.email):'')
          + (pend?` · ${fmt(pend)} pend.`:'');
      f = `Conectado como <b>${esc(SB.user?.email||'')}</b>. `
          + (pend ? `<b>${fmt(pend)}</b> cambio(s) pendiente(s) de subir.`
                  : `Todo al día${hora?' · última subida '+hora:''}.`); break;
    case 'error':
      h = '<b style="color:var(--oxido)">⚠ Error al sincronizar</b>' + (pend?` · ${fmt(pend)} pend.`:'');
      f = 'Error al subir a Supabase: '+esc(SB.error||'')+(pend?` · ${fmt(pend)} pendiente(s).`:''); break;
  }
  if (head) head.innerHTML = h;
  if (full) full.innerHTML = f;
  if (loginRow) loginRow.hidden = !!SB.user || SB.estado==='nosoporte';
  if (sessRow)  sessRow.hidden  = !SB.user;
}

function initSb(){
  renderSbEstado();
  if (!SBC) return;
  SBC.auth.getSession().then(({data})=> sbAplicarSesion(data.session)).catch(()=>{});
  SBC.auth.onAuthStateChange((_ev, session)=> sbAplicarSesion(session));
}

/* ---------- productos efectivos (base + deltas) ---------- */
const BMAP = new Map(DATA.productos.map(p=>[p.id,p]));
let PRODUCTOS = [], IDX = new Map(), TAXMAP = new Map();
function construirProductos(){
  PRODUCTOS = DATA.productos.map(p=>{
    const q = Object.assign({}, p); q.sub2 = '';
    const e = WORK.ediciones[p.id]; if (e) Object.assign(q, e);
    const a = WORK.asignaciones[p.id]; if (a){ q.cat=a.cat; q.sub=a.sub; q.sub2=a.sub2||''; }
    q.etq = WORK.etiquetas[p.id] ? WORK.etiquetas[p.id].slice()
          : (Array.isArray(p.etq) ? p.etq.slice() : []);
    return q;
  });
  IDX = new Map(PRODUCTOS.map(p=>[p.id,p]));
  TAXMAP = new Map(WORK.taxonomia.map(c=>[c.nombre,c]));
  marcarSucios();   // recalcula qué productos difieren de Supabase (para sincronizar)
}
function buscarCat(nombre){ return WORK.taxonomia.find(c=>norm(c.nombre)===norm(nombre)); }
function buscarSub(entrada, nombre){ return entrada.subs.find(s=>norm(s.nombre)===norm(nombre)); }

/* ---------- estado de la interfaz ---------- */
const state = {
  q:'', cat:null, sub:null, sub2:null, etq:null, prov:'', estado:'todos',
  page:1, vista:'lista', sel:new Set(), lastIdx:null,
  expand:new Set(), expand2:new Set(),
};
const UNDO = []; // pila en memoria (máx 60)
let DRAGIDS = null;
// Selección por arrastre (clic izquierdo sostenido sobre las filas)
const PAINT = { downId:null, downIdx:null, base:null, active:false, suppressUntil:0 };

function irA(cat, sub, sub2){ state.etq=null; state.cat=cat; state.sub=sub; state.sub2=sub2; state.page=1; renderAll(); }
/* Filtra por una marca de gestión (independiente de la categoría real) */
function irAEtq(etqId){ state.etq=etqId; state.cat=null; state.sub=null; state.sub2=null; state.page=1; renderAll(); }

/* ---------- bitácora / deshacer ---------- */
function bitacora(txt){
  WORK.bitacora.push({ t:new Date().toISOString(), txt });
  if (WORK.bitacora.length>400) WORK.bitacora.splice(0, WORK.bitacora.length-400);
}
function pushUndo(a){ UNDO.push(a); if (UNDO.length>60) UNDO.shift(); actualizarBtnUndo(); }
function actualizarBtnUndo(){ $('#btnUndo').disabled = !UNDO.length; $('#btnUndo').style.opacity = UNDO.length?'1':'.45'; }
function restaurarAsig(cambios){
  for (const c of cambios){
    if (c.prev) WORK.asignaciones[c.id] = c.prev; else delete WORK.asignaciones[c.id];
  }
}
function restaurarEtq(cambios){
  for (const c of cambios){
    if (c.prev) WORK.etiquetas[c.id] = c.prev; else delete WORK.etiquetas[c.id];
  }
}
function undo(){
  const a = UNDO.pop();
  if (!a){ aviso('Nada que deshacer'); return; }
  if (a.tipo==='asig') restaurarAsig(a.cambios);
  else if (a.tipo==='etq') restaurarEtq(a.cambios);
  else if (a.tipo==='edic'){ if (a.prev) WORK.ediciones[a.id]=a.prev; else delete WORK.ediciones[a.id]; }
  else if (a.tipo==='tax'){ WORK.taxonomia = a.tax; restaurarAsig(a.asig); }
  bitacora('Deshacer: '+(a.label||''));
  actualizarBtnUndo();
  construirProductos(); persistir(); renderAll();
  aviso('Deshecho: '+(a.label||''));
}

/* ---------- motor de sugerencias (port de categorizar_v1.ps1) ---------- */
const REGLAS = [
  {cat:'Herramienta electrica', sub:'Herramienta electrica', kw:['COMPRESOR','ROTOMARTILLO','TALADRO','ESMERILADORA','PULIDORA','CORTADORA','SIERRA','GENERADOR','HIDROLAVADORA','LIJADORA','PLANTA DE SOLD','SOLDADORA','MAQUINA DE SOLD','MOTOSIERRA','DESBROZADORA','ROUTER','PISTOLA DE CALOR','DEMOLEDOR','BARRENADORA','ESMERIL','PLANTA ','MOTOBOMBA','REVOLVEDORA','VIBRADOR','PULIDOR']},
  {cat:'Herramienta manual', sub:'Herramienta manual', kw:['MARTILLO','LLAVE','PINZA','DESARMADOR','FLEXOMETRO','CINTA METRICA','CINCEL','SEGUETA','ARCO ','NIVEL','ESCUADRA','PRENSA','REMACHADORA','TIJERA','CARRETILLA',' PALA','MARRO','EXTRACTOR','JUEGO DE','JGO','DADO','MATRACA','CAUTIN','GATO ','BROCA','LIMA','MACHUELO','TENAZA','CORTACIRCULOS','PISTOLA','HOJA','LLANA','ESPATULA','PUNZON','ESCOFINA','CUTTER','NAVAJA','BERBIQUI','CUCHARA','PLANA','DESBASTE MAN','PINZON','PLATO GIRATORIO']},
  {cat:'Soldadura y abrasivos', sub:'Abrasivos / Discos', kw:['DISCO','LIJA','FLAP','PIEDRA ESMERIL','CEPILLO DE ALAMBRE','MONTADA','CONICO','CARDA','GRATA','RUEDA DE']},
  {cat:'Soldadura y abrasivos', sub:'Soldadura (consumibles)', kw:['SOLDADURA','ELECTRODO','MICROALAMBRE','FUNDENTE','VARILLA DE BRONCE','BOQUILLA','PUNTA DE CONTACTO']},
  {cat:'Soldadura y abrasivos', sub:'Equipo de soldadura', kw:['REGULADOR','PORTAELECTRODO','PINZA DE TIERRA','MANERAL DE SOLD','CARRETE DE ALAMBRE','CARETA DE SOLD']},
  {cat:'Izaje y maniobra', sub:'Izaje y maniobra', kw:['ESLINGA','GRILLETE','POLEA','MALACATE','DIFERENCIAL','GUARDACABO','MOTON','APAREJO','ESTROBO','CABLE DE ACERO','CABLE ACERO','SUJETACABLE','SUJETA CABLE','PERRO P/CABLE','PERRO PARA CABLE']},
  {cat:'Tornilleria y fijacion', sub:'Tornilleria y fijacion', kw:['TORNILLO','PIJA','BIRLO','TUERCA','RONDANA','ARANDELA','TAQUETE','TAQUET','ANCLA','REMACHE','ESPARRAGO','PERNO',' GRAPA','TENSOR','GANCHO']},
  {cat:'Alambre, malla y cercas', sub:'Alambre, malla y cercas', kw:['ALAMBRE','MALLA','CERCA','CICLONICA','GALLINERO','ELECTROSOLDADA','PUAS','CONCERTINA','CLAVO','HILO','SUPER PICO','PICOS','PICO ']},
  {cat:'Lamina y cubiertas', sub:'Lamina y cubiertas', kw:['LAMINA','TEJA','POLICARBONATO',' PVC','ACRILICO','TRANSPARENTE','ACANALAD','R101','R72','GALVATECHO','PINTRO','ZINTRO','MULTYTECHO','MULTYPANEL','CABALLETE','TRASLUCID','DUELA','DESPLEGADO','PANEL']},
  {cat:'Perfiles estructurales', sub:'Perfiles estructurales', kw:['PTR','MONTEN','POLIN','ANGULO','SOLERA','CANAL','IPR','IPS','IPN',' VIGA','PERFIL','TUBULAR']},
  {cat:'Tuberia y conexiones', sub:'Tuberia y conexiones', kw:['TUBO','TUBERIA','CONDUIT','CEDULA','COPLE','NIPLE','CODO','TEE','REDUCCION','VALVULA','CONEXION','BRIDA','UNION','CUELLO']},
  {cat:'Acero (barra y placa)', sub:'Acero (barra y placa)', kw:['REDONDO','VARILLA','BARRA','PLACA','COLD ROLL','HOT ROLL','CUADRADO','CORRUGAD',' LISO','BLINDAD','MUSGO','ESTRUCTURAL','INOX']},
  {cat:'Pintura y quimicos', sub:'Pintura y quimicos', kw:['PINTURA','PRIMER','ANTICORROSIVO','ESMALTE','THINNER','AGUARRAS','SOLVENTE','BARNIZ','BROCHA','RODILLO','SELLADOR','SILICON','PEGAMENTO','ADHESIVO','MASILLA','RESISTOL','AEROSOL','SPRAY',' LACA','EPOXICO','POXI','RESANA','PRIMARIO']},
  {cat:'Seguridad (EPP)', sub:'Seguridad (EPP)', kw:['GUANTE','CARETA','GOGGLE','LENTE','CASCO',' FAJA','MANDIL',' BOTA','RESPIRADOR','TAPON','CHALECO','ARNES','MASCARILLA','PANTALLA','PETO','POLAINA','OREJERA','GAFA','MASCARA']},
  {cat:'Electrico e iluminacion', sub:'Electrico e iluminacion', kw:['CABLE','EXTENSION',' FOCO','LAMPARA','CONTACTO','APAGADOR','SOQUET','REFLECTOR','BALASTRA','CINTA DE AISLAR','TABLERO','MODULO','CLAVIJA','PASTILLA','INTERRUPTOR','TIMBRE']},
];
const RX_FORJA = /ANGEL|\bSOL\b|SOLES|\bLUNA|ESTRELL|\bFLOR|ALCATRA|MARGARITA|\bGALLO|JINETE|\bLEON|CABALLITO|MEDALLON|RACIMO|\bUVA|MARIPOSA|CORONA|\bCRUZ|COROLA|\bADORNO|ORNAMENT|DRAGON|VENECIA|COLONIAL|BARROCO|HERRADURA|ROSETA|ROSETON|CHAPETON|\bESFERA|\bFIGURA|CANASTILL|\bCANASTA|CARACOL|\bPUNTA|ELEMENTO BALCON|GOTERO|CAPACETE|MOLDURA|BELLOTA|FLORON/;
const RX_HERRAJE = /HERRAJE|BISAGRA|CERRADUR|\bCHAPA\b|CERROJO|CANDADO|PORTACANDADO|PASADOR|ALDABA|JALADERA|MANIJA|PERILLA|MENSULA|ESQUINERO|GARRUCHA|GOZNE|CANCEL|BARROTE|REJILLA|\bNUMERO|ZOCLO|PORTON|CIERRA ?PUERTA|FIJA ?PUERTA|MIRILLA|\bTOPE|TOCA ?PUERTA|BUZON|PASAMANOS|\bPOSTE|TERMINAL|BIBEL|TEJUELO|CHAMBRANA|\bRUEDA|\bREG\b/;

function sugerirPorReglas(nom){
  const d = (nom||'').toUpperCase();
  // Prioridad: Tubulares y Macizos
  if (/TUBULAR/.test(d) || /^\s*RECTANGULAR/.test(d)){
    let sub = 'Tubular';
    if (/RECTANG/.test(d)) sub='Tubular rectangular';
    else if (/CUADR/.test(d)) sub='Tubular cuadrado';
    else if (/REDOND/.test(d)) sub='Tubular redondo';
    return {cat:'Tubulares', sub};
  }
  if (/^\s*CARAMELO/.test(d)) return {cat:'Macizos', sub:'Caramelo'};
  if (/^\s*ANGULO/.test(d))   return {cat:'Macizos', sub:'Angulo'};
  if (/^\s*CUADRAD/.test(d))  return {cat:'Macizos', sub:'Cuadrado'};
  if (/^\s*REDOND/.test(d))   return {cat:'Macizos', sub:'Redondo'};
  // Reglas por palabra clave: primer match gana
  for (const r of REGLAS){
    for (const k of r.kw){ if (d.includes(k)) return {cat:r.cat, sub:r.sub}; }
  }
  // Fallback: Forja artistica / Herrajes
  if (RX_FORJA.test(d)){
    let sub = 'Figura ornamental';
    if (/CORONA|REMATE/.test(d)) sub='Remate';
    else if (/ROSETA|ROSETON|CHAPETON/.test(d)) sub='Roseta';
    return {cat:'Forja artistica', sub};
  }
  if (RX_HERRAJE.test(d)){
    let sub = 'Herraje';
    if (/CERRADUR|\bCHAPA\b|CERROJO|CANDADO|MIRILLA|CIERRA ?PUERTA|FIJA ?PUERTA|\bTOPE|TOCA ?PUERTA|ALDABA|PASADOR|PORTON/.test(d)) sub='Herraje de puerta';
    else if (/BISAGRA|GOZNE|BIBEL|TEJUELO/.test(d)) sub='Bisagra y pivote';
    else if (/JALADERA|MANIJA|PERILLA/.test(d)) sub='Jaladera y manija';
    else if (/CHAMBRANA/.test(d)) sub='Marco y chambrana';
    else if (/\bRUEDA|GARRUCHA/.test(d)) sub='Rodaja y garrucha';
    else if (/\bREG\b/.test(d)) sub='Regaton y contera';
    else if (/PASAMANOS|\bPOSTE|TERMINAL|BARROTE|REJILLA|CANCEL/.test(d)) sub='Barandal y pasamanos';
    else if (/MENSULA|ESQUINERO/.test(d)) sub='Soporte y mensula';
    return {cat:'Herrajes', sub};
  }
  return null;
}

/* Sugerencia por similitud: compara tokens del nombre contra los productos ya
   clasificados (para los residuales donde las reglas no alcanzan). */
function tokens(s){
  return [...new Set(norm(s).replace(/[^a-z0-9ñ]+/g,' ').split(' ')
    .filter(w=>w.length>=3 && !/^\d+$/.test(w)))];
}
let SIM_IDX = null;
function construirIndiceSimilitud(){
  SIM_IDX = new Map(); // token -> Map('cat SEP sub' -> conteo)
  for (const p of PRODUCTOS){
    if (p.cat===POR) continue;
    const combo = p.cat+SEP+p.sub;
    for (const t of tokens(p.nom)){
      let m = SIM_IDX.get(t); if(!m){ m=new Map(); SIM_IDX.set(t,m); }
      m.set(combo,(m.get(combo)||0)+1);
    }
  }
}
function sugerirPorSimilitud(p){
  if (!SIM_IDX) construirIndiceSimilitud();
  const score = new Map(), hits = new Map();
  for (const t of tokens(p.nom)){
    const m = SIM_IDX.get(t); if(!m) continue;
    let df = 0; m.forEach(n=>df+=n);
    const w = 1/Math.log(3+df);
    m.forEach((n,combo)=>{
      score.set(combo,(score.get(combo)||0)+w);
      hits.set(combo,(hits.get(combo)||0)+1);
    });
  }
  let best=null, bs=0;
  score.forEach((s,combo)=>{ if(s>bs){ bs=s; best=combo; } });
  if (!best || (hits.get(best)||0)<2) return null;
  const i = best.indexOf(SEP);
  return {cat:best.slice(0,i), sub:best.slice(i+1), aprox:true};
}

let SUG = new Map(); // id -> {cat, sub, aprox?}
function calcularSugerencia(p){
  const r = sugerirPorReglas(p.nom);
  if (r) return r;
  if (p.cat===POR) return sugerirPorSimilitud(p);
  return null;
}
function calcularSugerencias(){
  SUG = new Map();
  construirIndiceSimilitud();
  for (const p of PRODUCTOS){
    const s = calcularSugerencia(p);
    if (s) SUG.set(p.id, s);
  }
}
function sugVisible(p){
  if (WORK.asignaciones[p.id]) return null;      // ya decidiste tú: no molestar
  const s = SUG.get(p.id); if (!s) return null;
  if (s.cat===p.cat && s.sub===p.sub) return null;
  if (!TAXMAP.has(s.cat)) return null;           // apunta a categoría eliminada
  return s;
}

/* ---------- conteos ---------- */
function contar(){
  // cat -> {n, subs:Map(sub -> {n, subs2:Map(sub2|'' -> n)})}
  const cats = new Map();
  for (const c of WORK.taxonomia){
    cats.set(c.nombre, { n:0,
      subs:new Map(c.subs.map(s=>[s.nombre, {n:0, subs2:new Map(s.subs.map(x=>[x,0]))}])) });
  }
  const fantasmas = new Map();
  const etq = new Map(ETIQUETAS.map(e=>[e.id,0]));
  let pendientes=0, modificados=0, conSug=0;
  for (const p of PRODUCTOS){
    if (WORK.asignaciones[p.id] || WORK.ediciones[p.id]) modificados++;
    if (sugVisible(p)) conSug++;
    for (const t of etqDe(p)) if (etq.has(t)) etq.set(t, etq.get(t)+1);
    if (p.cat===POR){ pendientes++; continue; }
    const c = cats.get(p.cat);
    if (!c){ fantasmas.set(p.cat,(fantasmas.get(p.cat)||0)+1); continue; }
    c.n++;
    const sub = p.sub && p.sub!==p.cat ? p.sub : '';
    let se = c.subs.get(sub);
    if (!se){ se={n:0, subs2:new Map()}; c.subs.set(sub, se); }
    se.n++;
    const s2 = p.sub2||'';
    se.subs2.set(s2,(se.subs2.get(s2)||0)+1);
  }
  return { cats, fantasmas, etq, pendientes, modificados, conSug,
    total:PRODUCTOS.length, clasificados:PRODUCTOS.length-pendientes };
}
let CNT = null;

/* ---------- filtro ---------- */
function filtered(){
  const q = norm(state.q);
  return PRODUCTOS.filter(p=>{
    if (state.etq && !tieneEtq(p, state.etq)) return false;
    if (state.cat && p.cat!==state.cat) return false;
    if (state.sub!==null && state.sub!==undefined){
      const sub = p.sub && p.sub!==p.cat ? p.sub : '';
      if (sub!==state.sub) return false;
      if (state.sub2!==null && state.sub2!==undefined){
        if ((p.sub2||'')!==state.sub2) return false;
      }
    }
    if (state.prov && p.prov!==state.prov) return false;
    if (state.estado==='pend' && p.cat!==POR) return false;
    if (state.estado==='sug' && !sugVisible(p)) return false;
    if (state.estado==='mod' && !WORK.asignaciones[p.id] && !WORK.ediciones[p.id]) return false;
    if (q){
      const hay = norm(p.nom)+' '+norm(p.cod)+' '+norm(p.sub)+' '+norm(p.sub2)+' '+norm(p.med)+' '+norm(p.prov);
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* ---------- acciones: asignación ---------- */
function asignar(ids, cat, sub, sub2, origen){
  sub = sub || cat; sub2 = sub2 || '';
  if (sub===cat || cat===POR) sub2 = '';   // (general) y pendientes no llevan 3er nivel
  const cambios = [];
  for (const id of ids){
    const p = IDX.get(id); if(!p) continue;
    if (p.cat===cat && p.sub===sub && (p.sub2||'')===sub2) continue;
    cambios.push({ id, prev: WORK.asignaciones[id] ? Object.assign({},WORK.asignaciones[id]) : null });
    WORK.asignaciones[id] = sub2 ? {cat, sub, sub2} : {cat, sub};
  }
  if (!cambios.length){ aviso('Sin cambios: ya estaban ahí.'); return 0; }
  // Autoregistra en taxonomía sub/sub2 nuevas que lleguen por sugerencia/ficha
  const tc = TAXMAP.get(cat);
  if (tc && sub!==cat){
    let se = buscarSub(tc, sub);
    if (!se){ se={nombre:sub, subs:[]}; tc.subs.push(se); tc.subs.sort(alfaN); }
    if (sub2 && !se.subs.some(x=>norm(x)===norm(sub2))){ se.subs.push(sub2); se.subs.sort(alfa); }
  }
  const label = `${fmt(cambios.length)} producto(s) → ${rutaTxt(cat, sub, sub2)}`;
  pushUndo({tipo:'asig', label, cambios});
  bitacora(label + (origen ? ` (${origen})` : ''));
  construirProductos(); persistir();
  state.sel.clear();
  renderAll();
  aviso('✓ '+label);
  return cambios.length;
}

/* Pone o quita una marca de gestión a varios productos. No toca su categoría. */
function marcarEtiqueta(ids, etqId, poner, origen){
  const meta = ETQMAP.get(etqId); if (!meta) return 0;
  const cambios = [];
  for (const id of ids){
    const p = IDX.get(id); if (!p) continue;
    const actual = etqDe(p);
    if (actual.includes(etqId) === !!poner) continue;      // ya estaba así
    cambios.push({ id, prev: WORK.etiquetas[id] ? WORK.etiquetas[id].slice() : null });
    WORK.etiquetas[id] = poner ? [...actual, etqId] : actual.filter(x=>x!==etqId);
  }
  if (!cambios.length){ aviso('Sin cambios: ya estaban así.'); return 0; }
  const label = `${fmt(cambios.length)} producto(s) ${poner?'marcados':'desmarcados'} · ${meta.label}`;
  pushUndo({tipo:'etq', label, cambios});
  bitacora(label + (origen ? ` (${origen})` : ''));
  construirProductos(); persistir();
  renderAll();
  aviso('✓ '+label);
  return cambios.length;
}

function aplicarSugerencias(ids, origen){
  const porDestino = new Map();
  for (const id of ids){
    const p = IDX.get(id); if(!p) continue;
    const s = sugVisible(p); if(!s) continue;
    const k = s.cat+SEP+s.sub;
    if (!porDestino.has(k)) porDestino.set(k, []);
    porDestino.get(k).push(id);
  }
  if (!porDestino.size){ aviso('Ninguno de los seleccionados tiene sugerencia.'); return; }
  for (const [k, grupo] of porDestino){
    const i = k.indexOf(SEP);
    asignar(grupo, k.slice(0,i), k.slice(i+1), '', origen||'sugerencia');
  }
}

/* ---------- mover contenido completo (categoría / sub / sub-sub) ---------- */
function productosDe(o){ // o = {cat, sub?, sub2?}  (sub===undefined → toda la categoría)
  return PRODUCTOS.filter(p=>{
    if (p.cat!==o.cat) return false;
    if (o.sub===undefined) return true;
    const ps = p.sub && p.sub!==p.cat ? p.sub : '';
    if (ps!==o.sub) return false;
    if (o.sub2===undefined) return true;
    return (p.sub2||'')===o.sub2;
  });
}
function descOrigen(o){
  if (o.sub===undefined) return `la categoría "${o.cat}"`;
  const s = o.sub===''? '(general)' : `"${o.sub}"`;
  if (o.sub2===undefined) return `${s} de "${o.cat}"`;
  return `${o.sub2===''?'(general)':'"'+o.sub2+'"'} de "${o.cat} › ${o.sub}"`;
}
async function moverContenido(o){
  const afectados = productosDe(o);
  if (!afectados.length){ aviso('No hay productos que mover aquí.'); return; }
  const dest = await elegirDestino({
    titulo:`Mover ${fmt(afectados.length)} producto(s)`,
    texto:`Se moverá todo el contenido de ${descOrigen(o)} al destino que elijas. El origen se conserva en la taxonomía (queda vacío); elimínalo desde el árbol si ya no lo necesitas.`,
    okTxt:'Mover todo' });
  if (!dest) return;
  asignar(afectados.map(p=>p.id), dest.cat, dest.sub||dest.cat, dest.sub2||'', 'movimiento masivo');
}
/* Diálogo destino: categoría + sub/sub-sub dependiente */
async function elegirDestino(cfg){
  const v = await dialogo({
    titulo:cfg.titulo, texto:cfg.texto, okTxt:cfg.okTxt||'Mover',
    campos:[
      {id:'cat', label:'Categoría destino', tipo:'select',
        opciones:[...WORK.taxonomia].sort(alfaN).map(c=>({v:c.nombre,t:c.nombre})).concat([{v:POR,t:POR+' (pendientes)'}])},
      {id:'subv', label:'Subcategoría destino', tipo:'select', opciones:[{v:'',t:'(general)'}]},
    ],
    alAbrir:(body)=>{
      const cs = body.querySelector('[data-campo="cat"]');
      const ss = body.querySelector('[data-campo="subv"]');
      const rellenar = ()=>opcionesSub(ss, cs.value, null, null);
      cs.onchange = rellenar; rellenar();
    },
  });
  if (!v) return null;
  const {sub, sub2} = parseSubVal(v.subv);
  return { cat:v.cat, sub, sub2 };
}

/* ---------- acciones: taxonomía ---------- */
function nombreValido(nombre){
  const n = (nombre||'').trim();
  if (!n){ aviso('Escribe un nombre.'); return null; }
  if (norm(n)===norm(POR)){ aviso('"POR CLASIFICAR" es un nombre reservado.'); return null; }
  return n;
}
function taxSnapshot(){ return JSON.parse(JSON.stringify(WORK.taxonomia)); }

async function nuevaCategoria(){
  const v = await dialogo({ titulo:'Nueva categoría',
    campos:[{id:'nombre', label:'Nombre de la categoría', tipo:'text', valor:'', placeholder:'p. ej. Refacciones'}] });
  if (!v) return;
  const nombre = nombreValido(v.nombre); if (!nombre) return;
  if (buscarCat(nombre)){ aviso('Ya existe una categoría con ese nombre.'); return; }
  const tax = taxSnapshot();
  WORK.taxonomia.push({nombre, subs:[], creada:sello()});
  pushUndo({tipo:'tax', label:'Nueva categoría "'+nombre+'"', tax, asig:[]});
  bitacora('Nueva categoría "'+nombre+'"');
  construirProductos(); persistir(); renderAll();
}

async function renombrarCategoria(viejo){
  const v = await dialogo({ titulo:'Renombrar categoría',
    texto:'Si escribes el nombre de otra categoría existente, se fusionarán.',
    campos:[{id:'nombre', label:'Nuevo nombre', tipo:'text', valor:viejo}] });
  if (!v) return;
  const nuevo = nombreValido(v.nombre); if (!nuevo || nuevo===viejo) return;
  const entrada = buscarCat(viejo); if (!entrada) return;
  const destino = buscarCat(nuevo);
  const afectados = PRODUCTOS.filter(p=>p.cat===viejo);
  if (destino && destino!==entrada){
    const ok = await dialogo({ titulo:'Fusionar categorías',
      texto:`"${viejo}" se fusionará con "${destino.nombre}". Sus ${fmt(afectados.length)} productos y sus subcategorías pasarán a "${destino.nombre}". ¿Continuar?`, okTxt:'Fusionar' });
    if (!ok) return;
    const tax = taxSnapshot();
    const cambios = afectados.map(p=>{
      const c = { id:p.id, prev: WORK.asignaciones[p.id] ? Object.assign({},WORK.asignaciones[p.id]) : null };
      const sub = p.sub===viejo ? destino.nombre : p.sub;
      WORK.asignaciones[p.id] = p.sub2 && sub!==destino.nombre ? {cat:destino.nombre, sub, sub2:p.sub2} : {cat:destino.nombre, sub};
      return c;
    });
    // Une subcategorías por nombre (y sus sub-subs)
    for (const s of entrada.subs){
      const d = buscarSub(destino, s.nombre);
      if (!d) destino.subs.push(s);
      else d.subs = [...new Set([...d.subs, ...s.subs])].sort(alfa);
    }
    destino.subs.sort(alfaN);
    WORK.taxonomia = WORK.taxonomia.filter(c=>c!==entrada);
    const label = `Fusión "${viejo}" → "${destino.nombre}" (${fmt(afectados.length)} productos)`;
    pushUndo({tipo:'tax', label, tax, asig:cambios});
    bitacora(label);
    if (state.cat===viejo){ state.cat=destino.nombre; state.sub=null; state.sub2=null; }
  } else {
    const tax = taxSnapshot();
    const cambios = afectados.map(p=>{
      const c = { id:p.id, prev: WORK.asignaciones[p.id] ? Object.assign({},WORK.asignaciones[p.id]) : null };
      const sub = p.sub===viejo ? nuevo : p.sub;
      WORK.asignaciones[p.id] = p.sub2 && sub!==nuevo ? {cat:nuevo, sub, sub2:p.sub2} : {cat:nuevo, sub};
      return c;
    });
    entrada.nombre = nuevo;
    const label = `Categoría "${viejo}" renombrada a "${nuevo}" (${fmt(afectados.length)} productos)`;
    pushUndo({tipo:'tax', label, tax, asig:cambios});
    bitacora(label);
    if (state.expand.delete(viejo)) state.expand.add(nuevo);
    if (state.cat===viejo) state.cat=nuevo;
  }
  construirProductos(); persistir(); renderAll();
}

async function eliminarCategoria(nombre){
  const entrada = buscarCat(nombre); if (!entrada) return;
  const afectados = PRODUCTOS.filter(p=>p.cat===nombre);
  let destinoNombre = null;
  if (afectados.length){
    const opciones = [{v:POR, t:POR+' (pendientes)'}]
      .concat(WORK.taxonomia.filter(c=>c!==entrada).map(c=>({v:c.nombre, t:c.nombre})));
    const v = await dialogo({ titulo:'Eliminar "'+nombre+'"',
      texto:`La categoría tiene ${fmt(afectados.length)} productos. Elige a dónde moverlos antes de eliminarla.`,
      campos:[{id:'destino', label:'Mover productos a', tipo:'select', opciones, valor:POR}], okTxt:'Mover y eliminar' });
    if (!v) return;
    destinoNombre = v.destino;
  } else {
    const ok = await dialogo({ titulo:'Eliminar categoría', texto:`¿Eliminar la categoría vacía "${nombre}"?`, okTxt:'Eliminar' });
    if (!ok) return;
  }
  const tax = taxSnapshot();
  const cambios = afectados.map(p=>{
    const c = { id:p.id, prev: WORK.asignaciones[p.id] ? Object.assign({},WORK.asignaciones[p.id]) : null };
    WORK.asignaciones[p.id] = { cat:destinoNombre, sub:destinoNombre };
    return c;
  });
  WORK.taxonomia = WORK.taxonomia.filter(c=>c!==entrada);
  const label = `Categoría "${nombre}" eliminada` + (afectados.length?` (${fmt(afectados.length)} productos → ${destinoNombre})`:'');
  pushUndo({tipo:'tax', label, tax, asig:cambios});
  bitacora(label);
  if (state.cat===nombre){ state.cat=null; state.sub=null; state.sub2=null; }
  construirProductos(); persistir(); renderAll();
}

async function nuevaSub(catNombre){
  const entrada = buscarCat(catNombre); if (!entrada) return;
  const v = await dialogo({ titulo:'Nueva subcategoría en "'+catNombre+'"',
    campos:[{id:'nombre', label:'Nombre de la subcategoría', tipo:'text', valor:''}] });
  if (!v) return;
  const nombre = nombreValido(v.nombre); if (!nombre) return;
  if (norm(nombre)===norm(catNombre)){ aviso('La subcategoría no puede llamarse igual que la categoría.'); return; }
  if (buscarSub(entrada, nombre)){ aviso('Ya existe esa subcategoría.'); return; }
  const tax = taxSnapshot();
  entrada.subs.push({nombre, subs:[], creada:sello()}); entrada.subs.sort(alfaN);
  pushUndo({tipo:'tax', label:`Nueva subcategoría "${nombre}" en "${catNombre}"`, tax, asig:[]});
  bitacora(`Nueva subcategoría "${nombre}" en "${catNombre}"`);
  state.expand.add(catNombre);
  construirProductos(); persistir(); renderAll();
}

async function renombrarSub(catNombre, viejo){
  const entrada = buscarCat(catNombre); if (!entrada) return;
  const v = await dialogo({ titulo:'Renombrar subcategoría',
    texto:'Si escribes el nombre de otra subcategoría de esta categoría, se fusionarán.',
    campos:[{id:'nombre', label:'Nuevo nombre', tipo:'text', valor:viejo}] });
  if (!v) return;
  const nuevo = nombreValido(v.nombre); if (!nuevo || nuevo===viejo) return;
  const aGeneral = norm(nuevo)===norm(catNombre);
  const afectados = PRODUCTOS.filter(p=>p.cat===catNombre && p.sub===viejo);
  const tax = taxSnapshot();
  const cambios = afectados.map(p=>{
    const c = { id:p.id, prev: WORK.asignaciones[p.id] ? Object.assign({},WORK.asignaciones[p.id]) : null };
    WORK.asignaciones[p.id] = aGeneral
      ? { cat:catNombre, sub:catNombre }
      : (p.sub2 ? { cat:catNombre, sub:nuevo, sub2:p.sub2 } : { cat:catNombre, sub:nuevo });
    return c;
  });
  const vieja = buscarSub(entrada, viejo);
  entrada.subs = entrada.subs.filter(s=>s!==vieja);
  if (!aGeneral){
    const existente = buscarSub(entrada, nuevo);
    if (existente && vieja) existente.subs = [...new Set([...existente.subs, ...vieja.subs])].sort(alfa);
    else entrada.subs.push({nombre:nuevo, subs: vieja ? vieja.subs : []});
  }
  entrada.subs.sort(alfaN);
  const label = `Sub "${viejo}" → "${nuevo}" en "${catNombre}" (${fmt(afectados.length)} productos)`;
  pushUndo({tipo:'tax', label, tax, asig:cambios});
  bitacora(label);
  if (state.cat===catNombre && state.sub===viejo){ state.sub = aGeneral ? '' : nuevo; state.sub2=null; }
  construirProductos(); persistir(); renderAll();
}

async function eliminarSub(catNombre, nombre){
  const entrada = buscarCat(catNombre); if (!entrada) return;
  const afectados = PRODUCTOS.filter(p=>p.cat===catNombre && p.sub===nombre);
  const ok = await dialogo({ titulo:'Eliminar subcategoría',
    texto:`¿Eliminar "${nombre}" de "${catNombre}"?` + (afectados.length?` Sus ${fmt(afectados.length)} productos quedarán en la categoría (general).`:''), okTxt:'Eliminar' });
  if (!ok) return;
  const tax = taxSnapshot();
  const cambios = afectados.map(p=>{
    const c = { id:p.id, prev: WORK.asignaciones[p.id] ? Object.assign({},WORK.asignaciones[p.id]) : null };
    WORK.asignaciones[p.id] = { cat:catNombre, sub:catNombre };
    return c;
  });
  entrada.subs = entrada.subs.filter(s=>s.nombre!==nombre);
  const label = `Sub "${nombre}" eliminada de "${catNombre}"` + (afectados.length?` (${fmt(afectados.length)} → general)`:'');
  pushUndo({tipo:'tax', label, tax, asig:cambios});
  bitacora(label);
  if (state.cat===catNombre && state.sub===nombre){ state.sub=null; state.sub2=null; }
  construirProductos(); persistir(); renderAll();
}

/* --- tercer nivel: sub-subcategorías --- */
async function nuevaSub2(catNombre, subNombre){
  const entrada = buscarCat(catNombre); if (!entrada) return;
  const se = buscarSub(entrada, subNombre); if (!se) return;
  const v = await dialogo({ titulo:`Nueva sub-subcategoría en "${catNombre} › ${subNombre}"`,
    campos:[{id:'nombre', label:'Nombre de la sub-subcategoría', tipo:'text', valor:''}] });
  if (!v) return;
  const nombre = nombreValido(v.nombre); if (!nombre) return;
  if (norm(nombre)===norm(subNombre) || norm(nombre)===norm(catNombre)){ aviso('Usa un nombre distinto al del nivel superior.'); return; }
  if (se.subs.some(x=>norm(x)===norm(nombre))){ aviso('Ya existe esa sub-subcategoría.'); return; }
  const tax = taxSnapshot();
  se.subs.push(nombre); se.subs.sort(alfa);
  pushUndo({tipo:'tax', label:`Nueva sub-sub "${nombre}" en "${catNombre} › ${subNombre}"`, tax, asig:[]});
  bitacora(`Nueva sub-sub "${nombre}" en "${catNombre} › ${subNombre}"`);
  state.expand.add(catNombre); state.expand2.add(catNombre+SEP+subNombre);
  construirProductos(); persistir(); renderAll();
}

async function renombrarSub2(catNombre, subNombre, viejo){
  const entrada = buscarCat(catNombre); if (!entrada) return;
  const se = buscarSub(entrada, subNombre); if (!se) return;
  const v = await dialogo({ titulo:'Renombrar sub-subcategoría',
    texto:'Si escribes el nombre de otra sub-sub de esta subcategoría, se fusionarán.',
    campos:[{id:'nombre', label:'Nuevo nombre', tipo:'text', valor:viejo}] });
  if (!v) return;
  const nuevo = nombreValido(v.nombre); if (!nuevo || nuevo===viejo) return;
  const afectados = PRODUCTOS.filter(p=>p.cat===catNombre && p.sub===subNombre && (p.sub2||'')===viejo);
  const tax = taxSnapshot();
  const cambios = afectados.map(p=>{
    const c = { id:p.id, prev: WORK.asignaciones[p.id] ? Object.assign({},WORK.asignaciones[p.id]) : null };
    WORK.asignaciones[p.id] = { cat:catNombre, sub:subNombre, sub2:nuevo };
    return c;
  });
  se.subs = se.subs.filter(x=>x!==viejo);
  if (!se.subs.some(x=>norm(x)===norm(nuevo))) se.subs.push(nuevo);
  se.subs.sort(alfa);
  const label = `Sub-sub "${viejo}" → "${nuevo}" en "${catNombre} › ${subNombre}" (${fmt(afectados.length)} productos)`;
  pushUndo({tipo:'tax', label, tax, asig:cambios});
  bitacora(label);
  if (state.cat===catNombre && state.sub===subNombre && state.sub2===viejo) state.sub2=nuevo;
  construirProductos(); persistir(); renderAll();
}

async function eliminarSub2(catNombre, subNombre, nombre){
  const entrada = buscarCat(catNombre); if (!entrada) return;
  const se = buscarSub(entrada, subNombre); if (!se) return;
  const afectados = PRODUCTOS.filter(p=>p.cat===catNombre && p.sub===subNombre && (p.sub2||'')===nombre);
  const ok = await dialogo({ titulo:'Eliminar sub-subcategoría',
    texto:`¿Eliminar "${nombre}" de "${catNombre} › ${subNombre}"?` + (afectados.length?` Sus ${fmt(afectados.length)} productos quedarán en la subcategoría.`:''), okTxt:'Eliminar' });
  if (!ok) return;
  const tax = taxSnapshot();
  const cambios = afectados.map(p=>{
    const c = { id:p.id, prev: WORK.asignaciones[p.id] ? Object.assign({},WORK.asignaciones[p.id]) : null };
    WORK.asignaciones[p.id] = { cat:catNombre, sub:subNombre };
    return c;
  });
  se.subs = se.subs.filter(x=>x!==nombre);
  const label = `Sub-sub "${nombre}" eliminada de "${catNombre} › ${subNombre}"` + (afectados.length?` (${fmt(afectados.length)} → subcategoría)`:'');
  pushUndo({tipo:'tax', label, tax, asig:cambios});
  bitacora(label);
  if (state.cat===catNombre && state.sub===subNombre && state.sub2===nombre) state.sub2=null;
  construirProductos(); persistir(); renderAll();
}

async function reasignarFantasma(nombre){
  const afectados = PRODUCTOS.filter(p=>p.cat===nombre);
  const dest = await elegirDestino({ titulo:'Categoría fuera de taxonomía',
    texto:`"${nombre}" no existe en tu taxonomía (${fmt(afectados.length)} productos). Muévelos a una categoría válida.`, okTxt:'Mover' });
  if (!dest) return;
  asignar(afectados.map(p=>p.id), dest.cat, dest.sub||dest.cat, dest.sub2||'', 'saneamiento');
}

/* ---------- edición de campos ---------- */
/* Fusiona: los campos que NO se envían conservan su edición previa. (Antes se
   reemplazaba la entrada completa, así que guardar la ficha borraba la foto
   recién subida, y viceversa.) */
function editarCampos(id, campos){ // campos = {nom?, med?, prov?, foto?}
  const base = BMAP.get(id); if (!base) return false;
  const prev = WORK.ediciones[id] ? Object.assign({},WORK.ediciones[id]) : null;
  const entrada = Object.assign({}, prev||{});
  for (const f of ['nom','med','prov','foto']){
    if (campos[f]===undefined) continue;              // no enviado → se respeta
    if (campos[f]!==base[f]) entrada[f]=campos[f];    // difiere de la base → se edita
    else delete entrada[f];                           // volvió al valor original
  }
  const igual = JSON.stringify(entrada)===JSON.stringify(prev||{});
  if (igual) return false;
  if (Object.keys(entrada).length) WORK.ediciones[id]=entrada; else delete WORK.ediciones[id];
  const label = `Ficha editada: ${id}`;
  pushUndo({tipo:'edic', label, id, prev});
  bitacora(label + ' ('+Object.keys(entrada).join(', ')+')');
  return true;
}

/* ---------- render: barra de progreso ---------- */
function renderProgreso(){
  const c = CNT;
  const pct = c.total ? Math.round(1000*c.clasificados/c.total)/10 : 0;
  $('#progNums').innerHTML =
    `<span><b>${fmt(c.clasificados)}</b> clasificados de <b>${fmt(c.total)}</b> (${pct}%)</span>` +
    `<span class="pend">${fmt(c.pendientes)} pendientes</span>`;
  $('#progFill').style.width = pct+'%';
}

/* ---------- resaltado de categorías nuevas (48 h) ----------
   Las categorías y subcategorías creadas se sellan con `creada`. Mientras no
   pasen 48 h se pintan en naranja; al cumplirse, vuelven solas a su color
   original (un vigilante re-dibuja el árbol cuando alguna deja de ser nueva).
   Es metadato del clasificador: en Supabase las categorías sólo existen como
   texto en cada producto, así que esta marca vive en localStorage. */
const MS_48H = 48*60*60*1000;
function sello(){ return new Date().toISOString(); }
function esNueva(e){
  if (!e || !e.creada) return false;
  const t = Date.parse(e.creada);
  return Number.isFinite(t) && (Date.now() - t) < MS_48H;
}
function tituloNueva(e){
  const restan = MS_48H - (Date.now() - Date.parse(e.creada));
  const h = Math.max(0, Math.round(restan/3600000));
  return `Creada hace poco · se resalta ${h} h más`;
}
function firmaNuevas(){
  const out = [];
  for (const c of WORK.taxonomia){
    if (esNueva(c)) out.push(c.nombre);
    for (const s of (c.subs||[])) if (esNueva(s)) out.push(c.nombre+SEP+s.nombre);
  }
  return out.sort().join('|');
}
let FIRMA_NUEVAS = null;
function vigilarNuevas(){
  setInterval(()=>{
    if (FIRMA_NUEVAS !== null && firmaNuevas() !== FIRMA_NUEVAS) renderTax();
  }, 60000);
}

/* ---------- render: árbol de taxonomía ---------- */
function filaTax(opts){
  const row = el('div','tax-row'+(opts.cls?' '+opts.cls:''));
  if (opts.title) row.title = opts.title;
  if (opts.twisty!==undefined){
    const tw = el('span','tw', opts.twisty ? '▼' : '▶');
    tw.onclick = (e)=>{ e.stopPropagation(); opts.onTwisty(); };
    row.appendChild(tw);
  }
  const nm = el('span','nm', esc(opts.nombre)); row.appendChild(nm);
  if (opts.acts && opts.acts.length){
    const acts = el('span','tax-acts');
    for (const a of opts.acts){
      const b = el('button',null,a.t); b.title=a.title;
      b.onclick = (e)=>{ e.stopPropagation(); a.fn(); };
      acts.appendChild(b);
    }
    row.appendChild(acts);
  }
  row.appendChild(el('span','n', fmt(opts.n)));
  row.onclick = opts.onSel;
  if (opts.drop){
    row.addEventListener('dragover', e=>{ if(DRAGIDS){ e.preventDefault(); row.classList.add('dropover'); } });
    row.addEventListener('dragleave', ()=>row.classList.remove('dropover'));
    row.addEventListener('drop', e=>{
      e.preventDefault(); row.classList.remove('dropover');
      if (DRAGIDS) asignar(DRAGIDS, opts.drop.cat, opts.drop.sub||opts.drop.cat, opts.drop.sub2||'', 'arrastre');
    });
  }
  if (opts.dropEtq){   // arrastrar productos aquí los MARCA (no los mueve)
    row.addEventListener('dragover', e=>{ if(DRAGIDS){ e.preventDefault(); row.classList.add('dropover'); } });
    row.addEventListener('dragleave', ()=>row.classList.remove('dropover'));
    row.addEventListener('drop', e=>{
      e.preventDefault(); row.classList.remove('dropover');
      if (DRAGIDS) marcarEtiqueta(DRAGIDS, opts.dropEtq, true, 'arrastre');
    });
  }
  return row;
}

function renderTax(){
  const c = CNT;
  FIRMA_NUEVAS = firmaNuevas();
  const root = $('#tax'); root.innerHTML='';

  root.appendChild(filaTax({ cls:(state.cat===null?'on':''), nombre:'Todas las categorías', n:c.total,
    onSel:()=>irA(null,null,null) }));

  root.appendChild(filaTax({ cls:'pend'+(state.cat===POR?' on':''), nombre:'⚠ '+POR, n:c.pendientes,
    onSel:()=>irA(POR,null,null),
    acts:[{t:'⇄', title:'Mover todos los pendientes a otra categoría', fn:()=>moverContenido({cat:POR})}],
    drop:{cat:POR, sub:POR} }));

  root.appendChild(el('div','tax-title','Marcas de gestión'));
  for (const e of ETIQUETAS){
    root.appendChild(filaTax({
      cls:'etq'+(state.etq===e.id?' on':''),
      nombre:e.label, n:(c.etq.get(e.id)||0),
      title:'Marca de gestión: convive con la categoría real. Arrastra productos aquí para marcarlos.',
      onSel:()=>irAEtq(e.id),
      dropEtq:e.id,
    }));
  }

  root.appendChild(el('div','tax-title','Categorías ('+WORK.taxonomia.length+')'));

  const orden = [...WORK.taxonomia].sort(alfaN);
  for (const t of orden){
    const info = c.cats.get(t.nombre) || {n:0, subs:new Map()};
    // subs visibles = taxonomía ∪ subs presentes en productos (nada queda oculto)
    const subsSet = new Set(t.subs.map(s=>s.nombre));
    info.subs.forEach((v,s)=>{ if (s) subsSet.add(s); });
    const subs = [...subsSet].sort(alfa);
    const general = info.subs.get('') ? info.subs.get('').n : 0;
    const abierta = state.expand.has(t.nombre);
    const cont = el('div','tax-cat');
    cont.appendChild(filaTax({
      cls:(state.cat===t.nombre && state.sub===null ? 'on' : '') + (esNueva(t) ? ' nueva' : ''),
      title: esNueva(t) ? tituloNueva(t) : undefined,
      nombre:t.nombre, n:info.n,
      twisty: subs.length ? abierta : undefined,
      onTwisty:()=>{ abierta ? state.expand.delete(t.nombre) : state.expand.add(t.nombre); renderTax(); },
      onSel:()=>{ if (subs.length) state.expand.add(t.nombre); irA(t.nombre,null,null); },
      acts:[
        {t:'✎', title:'Renombrar / fusionar', fn:()=>renombrarCategoria(t.nombre)},
        {t:'＋', title:'Nueva subcategoría', fn:()=>nuevaSub(t.nombre)},
        {t:'⇄', title:'Mover todos sus productos a otra categoría', fn:()=>moverContenido({cat:t.nombre})},
        {t:'✕', title:'Eliminar categoría', fn:()=>eliminarCategoria(t.nombre)},
      ],
      drop:{cat:t.nombre},
    }));
    if (subs.length && abierta){
      const wrap = el('div','tax-sub');
      if (general){
        wrap.appendChild(filaTax({
          cls:(state.cat===t.nombre && state.sub===''?'on':''),
          nombre:'(general)', n:general,
          onSel:()=>irA(t.nombre,'',null),
          acts:[{t:'⇄', title:'Mover los productos (general) a otro destino', fn:()=>moverContenido({cat:t.nombre, sub:''})}],
          drop:{cat:t.nombre},
        }));
      }
      for (const s of subs){
        const infoSub = info.subs.get(s) || {n:0, subs2:new Map()};
        const taxSub = buscarSub(t, s);
        const hijosSet = new Set(taxSub ? taxSub.subs : []);
        infoSub.subs2.forEach((n,x)=>{ if (x) hijosSet.add(x); });
        const hijos = [...hijosSet].sort(alfa);
        const key2 = t.nombre+SEP+s;
        const abierta2 = state.expand2.has(key2);
        wrap.appendChild(filaTax({
          cls:(state.cat===t.nombre && state.sub===s && state.sub2===null?'on':'') + (esNueva(taxSub) ? ' nueva' : ''),
          title: esNueva(taxSub) ? tituloNueva(taxSub) : undefined,
          nombre:s, n:infoSub.n,
          twisty: hijos.length ? abierta2 : undefined,
          onTwisty:()=>{ abierta2 ? state.expand2.delete(key2) : state.expand2.add(key2); renderTax(); },
          onSel:()=>{ if (hijos.length) state.expand2.add(key2); irA(t.nombre,s,null); },
          acts:[
            {t:'✎', title:'Renombrar / fusionar sub', fn:()=>renombrarSub(t.nombre, s)},
            {t:'＋', title:'Nueva sub-subcategoría', fn:()=>nuevaSub2(t.nombre, s)},
            {t:'⇄', title:'Mover todos sus productos a otro destino', fn:()=>moverContenido({cat:t.nombre, sub:s})},
            {t:'✕', title:'Eliminar subcategoría', fn:()=>eliminarSub(t.nombre, s)},
          ],
          drop:{cat:t.nombre, sub:s},
        }));
        if (hijos.length && abierta2){
          const wrap2 = el('div','tax-sub2');
          const gen2 = infoSub.subs2.get('')||0;
          if (gen2){
            wrap2.appendChild(filaTax({
              cls:(state.cat===t.nombre && state.sub===s && state.sub2===''?'on':''),
              nombre:'(general)', n:gen2,
              onSel:()=>irA(t.nombre,s,''),
              drop:{cat:t.nombre, sub:s},
            }));
          }
          for (const x of hijos){
            wrap2.appendChild(filaTax({
              cls:(state.cat===t.nombre && state.sub===s && state.sub2===x?'on':''),
              nombre:x, n:infoSub.subs2.get(x)||0,
              onSel:()=>irA(t.nombre,s,x),
              acts:[
                {t:'✎', title:'Renombrar / fusionar sub-sub', fn:()=>renombrarSub2(t.nombre, s, x)},
                {t:'⇄', title:'Mover todos sus productos a otro destino', fn:()=>moverContenido({cat:t.nombre, sub:s, sub2:x})},
                {t:'✕', title:'Eliminar sub-subcategoría', fn:()=>eliminarSub2(t.nombre, s, x)},
              ],
              drop:{cat:t.nombre, sub:s, sub2:x},
            }));
          }
          wrap.appendChild(wrap2);
        }
      }
      cont.appendChild(wrap);
    }
    root.appendChild(cont);
  }

  if (c.fantasmas.size){
    root.appendChild(el('div','tax-title','⚠ Fuera de taxonomía'));
    for (const [nombre,n] of [...c.fantasmas].sort((a,b)=>alfa(a[0],b[0]))){
      root.appendChild(filaTax({
        cls:'fantasma'+(state.cat===nombre?' on':''), nombre, n,
        onSel:()=>irA(nombre,null,null),
        acts:[{t:'✎', title:'Reasignar estos productos', fn:()=>reasignarFantasma(nombre)}],
      }));
    }
  }
}

/* ---------- render: toolbar ---------- */
function renderChips(){
  const c = CNT;
  const defs = [
    ['todos','Todos', c.total],
    ['pend','Pendientes', c.pendientes],
    ['sug','Con sugerencia', c.conSug],
    ['mod','Modificados', c.modificados],
  ];
  const wrap = $('#chipsEstado'); wrap.innerHTML='';
  for (const [id, txt, n] of defs){
    const b = el('button','chip'+(state.estado===id?' on':''), `${txt} · ${fmt(n)}`);
    b.onclick = ()=>{ state.estado=id; state.page=1; renderLista(); renderChips(); };
    wrap.appendChild(b);
  }
}
function llenarProveedores(){
  const provs = [...new Set(DATA.productos.map(p=>p.prov).filter(Boolean))].sort(alfa);
  const s = $('#fProv'); s.innerHTML='';
  const o0 = el('option',null,'Todos los proveedores'); o0.value=''; s.appendChild(o0);
  for (const pv of provs){ const o=el('option',null,esc(pv)); o.value=pv; s.appendChild(o); }
  s.onchange = ()=>{ state.prov=s.value; state.page=1; renderLista(); };
}

/* ---------- render: filas ---------- */
function tagClasif(p){
  const cls = p.cat===POR ? ' pend' : (!TAXMAP.has(p.cat) ? ' fantasma' : '');
  const ruta = rutaTxt(p.cat, p.sub, p.sub2);
  return `<span class="tagcat${cls}" title="${esc(ruta)}"><span>${esc(ruta)}</span></span>` + etqChips(p);
}
function etqChips(p){
  return etqDe(p).map(t=>{
    const e = ETQMAP.get(t); if (!e) return '';
    return `<span class="tagetq" title="${esc(e.label)}">${esc(e.corto)}</span>`;
  }).join('');
}
function pintarSeleccion(){
  // Actualiza clases/checkbox de las filas ya renderizadas (sin reconstruir)
  for (const row of $('#lista').children){
    const id = row.dataset && row.dataset.id; if (!id) continue;
    const on = state.sel.has(id);
    row.classList.toggle('sel', on);
    const cb = row.querySelector('input[type=checkbox]'); if (cb) cb.checked = on;
    row.draggable = on;
  }
  const lista = filtered();
  $('#countTxt').textContent = `${fmt(lista.length)} productos` + (state.sel.size?` · ${fmt(state.sel.size)} seleccionados`:'');
}
function fila(p, idx){
  const seleccionado = state.sel.has(p.id);
  const mod = WORK.asignaciones[p.id] || WORK.ediciones[p.id];
  const row = el('div','row'+(seleccionado?' sel':'')+(p.cat===POR?' espend':(mod?' mod':'')));
  row.dataset.id = p.id;
  // Solo las filas seleccionadas se arrastran al árbol; en las no seleccionadas
  // el arrastre con clic izquierdo funciona como selección por barrido.
  row.draggable = seleccionado;

  const cb = el('input'); cb.type='checkbox'; cb.checked=seleccionado; cb.style.pointerEvents='none';
  row.appendChild(cb);
  row.appendChild(el('span','cod', esc(p.cod)));

  const nomwrap = el('span',null);
  const nom = el('span','nom', esc(p.nom));
  nom.title = 'Abrir ficha';
  nom.onclick = (e)=>{ e.stopPropagation(); abrirFicha(p.id); };
  nomwrap.appendChild(nom);
  nomwrap.appendChild(el('span','prov', esc(p.prov)));
  row.appendChild(nomwrap);

  row.appendChild(el('span','med', esc(p.med)));

  const catwrap = el('span','catwrap', tagClasif(p));
  row.appendChild(catwrap);

  const sugwrap = el('span','sugwrap');
  const s = sugVisible(p);
  if (s){
    const chip = el('button','sug',
      `<span>${s.aprox?'<i class="aprox">≈</i> ':''}→ ${esc(s.cat)}${s.sub&&s.sub!==s.cat?' › '+esc(s.sub):''}</span>`);
    chip.title = (s.aprox?'Sugerencia aproximada (por similitud). ':'Sugerencia por reglas. ')+'Clic para aplicar';
    chip.onclick = (e)=>{ e.stopPropagation(); asignar([p.id], s.cat, s.sub, '', s.aprox?'similitud':'regla'); };
    sugwrap.appendChild(chip);
  }
  row.appendChild(sugwrap);

  const abrir = el('button','abrir','✎'); abrir.title='Abrir ficha';
  abrir.onclick = (e)=>{ e.stopPropagation(); abrirFicha(p.id); };
  row.appendChild(abrir);

  row.onclick = (e)=>{
    if (Date.now() < PAINT.suppressUntil) return;   // venimos de un barrido
    const lista = filtered();
    if (e.shiftKey && state.lastIdx!==null){
      const [a,b] = [Math.min(state.lastIdx, idx), Math.max(state.lastIdx, idx)];
      for (let i=a;i<=b;i++){ const q=lista[i]; if(q) state.sel.add(q.id); }
    } else {
      state.sel.has(p.id) ? state.sel.delete(p.id) : state.sel.add(p.id);
      state.lastIdx = idx;
    }
    renderLista(); renderSelbar();
  };

  // --- selección por barrido (clic izquierdo sostenido) ---
  row.addEventListener('mousedown', (e)=>{
    if (e.button!==0 || seleccionado) return;   // en seleccionadas manda el drag nativo
    PAINT.downId = p.id; PAINT.downIdx = idx;
    PAINT.base = new Set(state.sel); PAINT.active = false;
    e.preventDefault();
  });
  row.addEventListener('mouseenter', ()=>{
    if (PAINT.downId===null) return;
    if (!PAINT.active && p.id===PAINT.downId) return;
    PAINT.active = true;
    const lista = filtered();
    const [a,b] = [Math.min(PAINT.downIdx, idx), Math.max(PAINT.downIdx, idx)];
    state.sel = new Set(PAINT.base);
    for (let i=a;i<=b;i++){ const q=lista[i]; if(q) state.sel.add(q.id); }
    state.lastIdx = idx;
    pintarSeleccion(); renderSelbar();
  });

  // --- arrastre de la selección hacia el árbol ---
  row.addEventListener('dragstart', (e)=>{
    DRAGIDS = state.sel.has(p.id) ? [...state.sel] : [p.id];
    row.classList.add('drag');
    try{ e.dataTransfer.setData('text/plain', DRAGIDS.join(',')); }catch{}
    e.dataTransfer.effectAllowed='move';
  });
  row.addEventListener('dragend', ()=>{ DRAGIDS=null; row.classList.remove('drag'); });
  return row;
}

/* ---------- fotos: Storage (en línea) con respaldo a los archivos locales ----------
   Si el producto tiene una foto subida desde el clasificador, el campo `foto`
   guarda su URL pública de Supabase Storage y ésa manda. Si no, se usa la
   convención histórica fotos/<id>.<ext> que ya vive en el repositorio. */
function esUrlFoto(f){ return typeof f==='string' && /^https?:\/\//i.test(f); }
function fuentesFoto(p){
  const out = [];
  if (esUrlFoto(p.foto)) out.push(p.foto);
  for (const e of FOTO_EXTS) out.push(`fotos/${p.id}.${e}`);
  return out;
}

/* Sube una imagen al bucket `fotos`, apunta la columna `foto` del producto a su
   URL pública y refleja el cambio en el trabajo local (y por tanto en data/). */
async function subirFoto(id, blob, ext){
  const p = IDX.get(id); if (!p) return false;
  if (!SBC){ aviso('⚠ Supabase no disponible.'); return false; }
  if (!SB.user){ aviso('⚠ Inicia sesión (Guardar / Exportar) para cambiar fotos.'); return false; }
  if (blob.size > 5*1024*1024){ aviso('⚠ La imagen supera 5 MB.'); return false; }

  const ruta = `${id}-${Date.now()}.${ext||'webp'}`;   // nombre único: evita caché
  try{
    const { error: errUp } = await SBC.storage.from('fotos')
      .upload(ruta, blob, { cacheControl:'3600', upsert:true, contentType:blob.type });
    if (errUp) throw errUp;

    const url = SBC.storage.from('fotos').getPublicUrl(ruta).data.publicUrl;
    const { error: errDb } = await SBC.from('productos').update({ foto:url }).eq('codigo', p.cod);
    if (errDb) throw errDb;

    editarCampos(id, { foto:url });          // fusiona: no pisa otras ediciones
    construirProductos(); persistir();
    aviso('✓ Foto actualizada: en línea y en el catálogo local');
    if (FICHA_ID===id) abrirFicha(id);       // repinta la ficha con la imagen nueva
    renderAll();
    return true;
  }catch(e){
    aviso('⚠ No se pudo subir la foto: '+(e.message||e.name));
    return false;
  }
}

/* ---------- editor de foto (encuadre, recorte, tamaño y formato) ----------
   Lienzo WYSIWYG: lo que se ve en el marco es exactamente lo que se sube. El
   mismo dibujo se repite en un lienzo de salida multiplicando por el factor k,
   así que la vista previa y el archivo final no pueden desalinearse. */
const FED = { id:null, img:null, escala:1, dx:0, dy:0, rot:0, ratio:1, arrastre:null };
const FED_RATIOS = [{t:'1:1',v:1},{t:'4:3',v:4/3},{t:'3:4',v:3/4},{t:'16:9',v:16/9},{t:'Original',v:0}];
const FED_LADO = 300;   // lado mayor del lienzo en pantalla

function fedImgDims(){  // dimensiones efectivas de la imagen según la rotación
  const i = FED.img;
  return (FED.rot%180===0) ? {w:i.width, h:i.height} : {w:i.height, h:i.width};
}
function fedDims(){     // tamaño del marco en pantalla, según el encuadre
  let r = FED.ratio;
  if (!r){ const im = fedImgDims(); r = im.w/im.h; }
  return r>=1 ? {w:FED_LADO, h:Math.round(FED_LADO/r)} : {w:Math.round(FED_LADO*r), h:FED_LADO};
}
function fedEscalaCubrir(){
  const {w,h} = fedDims(), im = fedImgDims();
  return Math.max(w/im.w, h/im.h);
}
function fedAjustar(modo){
  const {w,h} = fedDims(), im = fedImgDims();
  FED.escala = modo==='contener' ? Math.min(w/im.w, h/im.h) : Math.max(w/im.w, h/im.h);
  FED.dx = 0; FED.dy = 0;
  $('#fedZoom').value = Math.round(FED.escala/fedEscalaCubrir()*100);
  fedPintar();
}
function fedSalida(){
  const {w,h} = fedDims();
  const k = parseInt($('#fedSize').value,10) / Math.max(w,h);
  return { w:Math.round(w*k), h:Math.round(h*k), k };
}
function fedDibujar(ctx, W, H, k){
  ctx.clearRect(0,0,W,H);
  const bg = $('#fedBg').value, fmt = $('#fedFmt').value;
  if (bg!=='transparente' || fmt==='jpeg'){          // JPEG no admite transparencia
    ctx.fillStyle = (bg==='transparente' ? '#ffffff' : bg);
    ctx.fillRect(0,0,W,H);
  }
  ctx.save();
  ctx.translate(W/2 + FED.dx*k, H/2 + FED.dy*k);
  ctx.rotate(FED.rot*Math.PI/180);
  const s = FED.escala*k, iw = FED.img.width*s, ih = FED.img.height*s;
  ctx.drawImage(FED.img, -iw/2, -ih/2, iw, ih);
  ctx.restore();
}
function fedPintar(){
  const c = $('#fedCanvas'); if (!c || !FED.img) return;
  const {w,h} = fedDims();
  c.width = w; c.height = h;
  fedDibujar(c.getContext('2d'), w, h, 1);
  const sal = fedSalida();
  $('#fedInfo').textContent =
    `${FED.img.width}×${FED.img.height} → ${sal.w}×${sal.h} ${$('#fedFmt').value.toUpperCase()}`;
}
function fedChips(){
  const cont = $('#fedRatios'); cont.innerHTML='';
  for (const r of FED_RATIOS){
    const b = el('button','fed-chip'+(FED.ratio===r.v?' on':''), r.t);
    b.onclick = ()=>{ FED.ratio=r.v; fedChips(); fedAjustar('cubrir'); };
    cont.appendChild(b);
  }
}
function abrirEditorFoto(id, file){
  if (!/^image\//.test(file.type||'')){ aviso('⚠ El archivo no es una imagen.'); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = ()=>{
    URL.revokeObjectURL(url);
    Object.assign(FED, {id, img, rot:0, ratio:1, dx:0, dy:0, arrastre:null});
    $('#modalFoto').hidden = false;
    fedChips(); fedAjustar('cubrir');
  };
  img.onerror = ()=>{ URL.revokeObjectURL(url); aviso('⚠ No se pudo leer la imagen.'); };
  img.src = url;
}
function cerrarEditorFoto(){ $('#modalFoto').hidden = true; FED.img=null; FED.id=null; }

async function fedGuardar(){
  if (!FED.img) return;
  const sal = fedSalida();
  const out = document.createElement('canvas');
  out.width = sal.w; out.height = sal.h;
  fedDibujar(out.getContext('2d'), sal.w, sal.h, sal.k);
  const fmt = $('#fedFmt').value;
  const mime = fmt==='jpeg' ? 'image/jpeg' : (fmt==='png' ? 'image/png' : 'image/webp');
  const btn = $('#fedSave'); btn.disabled = true; btn.textContent = 'Subiendo…';
  const blob = await new Promise(res=>out.toBlob(res, mime, 0.9));
  const ok = blob ? await subirFoto(FED.id, blob, fmt==='jpeg'?'jpg':fmt) : false;
  btn.disabled = false; btn.textContent = 'Guardar foto';
  if (ok) cerrarEditorFoto();
}

function initEditorFoto(){
  const c = $('#fedCanvas'); if (!c) return;
  c.addEventListener('pointerdown', e=>{
    if (!FED.img) return;
    FED.arrastre = {x:e.clientX, y:e.clientY, dx:FED.dx, dy:FED.dy};
    c.setPointerCapture(e.pointerId); c.classList.add('arrastrando');
  });
  c.addEventListener('pointermove', e=>{
    if (!FED.arrastre) return;
    FED.dx = FED.arrastre.dx + (e.clientX - FED.arrastre.x);
    FED.dy = FED.arrastre.dy + (e.clientY - FED.arrastre.y);
    fedPintar();
  });
  const fin = ()=>{ FED.arrastre=null; c.classList.remove('arrastrando'); };
  c.addEventListener('pointerup', fin); c.addEventListener('pointercancel', fin);
  c.addEventListener('wheel', e=>{
    if (!FED.img) return;
    e.preventDefault();
    const z = $('#fedZoom');
    z.value = Math.max(10, Math.min(400, (+z.value) + (e.deltaY<0 ? 6 : -6)));
    FED.escala = fedEscalaCubrir() * (+z.value)/100;
    fedPintar();
  }, {passive:false});

  $('#fedZoom').oninput = ()=>{ FED.escala = fedEscalaCubrir()*(+$('#fedZoom').value)/100; fedPintar(); };
  $('#fedCubrir').onclick   = ()=>fedAjustar('cubrir');
  $('#fedContener').onclick = ()=>fedAjustar('contener');
  $('#fedCentrar').onclick  = ()=>{ FED.dx=0; FED.dy=0; fedPintar(); };
  $('#fedRotar').onclick    = ()=>{ FED.rot=(FED.rot+90)%360; fedAjustar('cubrir'); };
  $('#fedSize').onchange = fedPintar;
  $('#fedFmt').onchange  = fedPintar;
  $('#fedBg').onchange   = fedPintar;
  $('#fedSave').onclick  = fedGuardar;
  $('#fedCancel').onclick = cerrarEditorFoto;
  $('#fotoClose').onclick = cerrarEditorFoto;
  $('#modalFoto').addEventListener('click', e=>{ if(e.target.id==='modalFoto') cerrarEditorFoto(); });
}

function thumbEl(p){
  const box = el('div','pthumb');
  const PH = `<div class="ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/></svg>
    <span>Sin foto</span></div>`;
  const img = new Image(); let i=0;
  const fuentes = fuentesFoto(p);
  const tryNext = ()=>{ if (i<fuentes.length){ img.src=fuentes[i++]; } else box.innerHTML=PH; };
  img.onerror = tryNext;
  img.onload = ()=>{ box.innerHTML=''; box.appendChild(img); };
  box.innerHTML = PH;
  tryNext();
  return box;
}
function pcard(p){
  const c = el('div','pcard');
  c.appendChild(thumbEl(p));
  const body = el('div','pcard-body');
  body.appendChild(el('div','pcard-name', esc(p.nom)));
  const meta = el('div','pcard-meta');
  if (p.sub && p.sub!==POR && p.sub!==p.cat) meta.appendChild(el('span','tag sub', esc(p.sub)));
  if (p.sub2) meta.appendChild(el('span','tag sub', esc(p.sub2)));
  if (p.med) meta.appendChild(el('span','tag med', esc(p.med)));
  body.appendChild(meta);
  body.appendChild(el('div','pcard-cod','Cód: '+esc(p.cod)));
  c.appendChild(body);
  c.onclick = ()=>abrirFicha(p.id);
  return c;
}

function renderLista(){
  const lista = filtered();
  const enLista = state.vista==='lista';
  $('#lista').hidden = !enLista;
  $('#previewGrid').hidden = enLista;
  $('#listhead').style.visibility = enLista ? 'visible' : 'hidden';

  const cont = enLista ? $('#lista') : $('#previewGrid');
  const pageSize = enLista ? PAGE_LISTA : PAGE_PREVIA;
  const limit = state.page*pageSize;
  cont.innerHTML='';
  if (!lista.length){
    cont.appendChild(el('div','vacio','No hay productos con este filtro.'));
  } else {
    lista.slice(0,limit).forEach((p,i)=>cont.appendChild(enLista ? fila(p,i) : pcard(p)));
  }

  const selVisibles = lista.filter(p=>state.sel.has(p.id)).length;
  $('#countTxt').textContent = `${fmt(lista.length)} productos` + (state.sel.size?` · ${fmt(state.sel.size)} seleccionados`:'');
  $('#selAll').checked = lista.length>0 && selVisibles===lista.length;

  const more = $('#btnMore');
  if (lista.length>limit){ more.hidden=false; more.textContent=`Cargar más (${fmt(lista.length-limit)} restantes)`; }
  else more.hidden=true;
}

/* ---------- render: barra de selección ---------- */
function opcionesCategoria(sel, incluirPOR){
  sel.innerHTML='';
  const orden = [...WORK.taxonomia].sort(alfaN);
  for (const c of orden){ const o=el('option',null,esc(c.nombre)); o.value=c.nombre; sel.appendChild(o); }
  if (incluirPOR){ const o=el('option',null,POR+' (pendiente)'); o.value=POR; sel.appendChild(o); }
}
/* Select de sub/sub-sub combinado: '(general)', subs y sub-subs indentadas.
   Valor: 'sub' o 'sub'+SEP+'sub2'. */
function opcionesSub(sel, catNombre, actualSub, actualSub2){
  sel.innerHTML='';
  const o0 = el('option',null,'(general)'); o0.value=''; sel.appendChild(o0);
  const t = TAXMAP.get(catNombre);
  const subs = t ? [...t.subs].sort(alfaN) : [];
  const nombres = new Set(subs.map(s=>s.nombre));
  if (actualSub && actualSub!==catNombre && actualSub!==POR && !nombres.has(actualSub))
    subs.push({nombre:actualSub, subs: actualSub2 ? [actualSub2] : []});
  for (const s of subs){
    const o = el('option',null,esc(s.nombre)); o.value=s.nombre; sel.appendChild(o);
    const hijos = new Set(s.subs);
    if (actualSub===s.nombre && actualSub2) hijos.add(actualSub2);
    for (const x of [...hijos].sort(alfa)){
      const o2 = el('option',null,' › '+esc(x)); o2.value = s.nombre+SEP+x; sel.appendChild(o2);
    }
  }
  sel.value = (actualSub && actualSub!==catNombre && actualSub!==POR)
    ? subVal(actualSub, actualSub2||'') : '';
  if (sel.selectedIndex<0) sel.value='';
}
function renderSelbar(){
  const bar = $('#selbar');
  if (!state.sel.size){ bar.hidden=true; return; }
  bar.hidden=false;
  $('#selTxt').textContent = fmt(state.sel.size)+' seleccionado'+(state.sel.size>1?'s':'');
  // Se reconstruye SIEMPRE: así cualquier alta/renombre/fusión/baja de la
  // taxonomía se refleja al instante también aquí. La selección previa se
  // conserva solo si la opción sigue existiendo.
  const se = $('#selEtq');
  if (se){
    se.innerHTML = '';
    for (const e of ETIQUETAS){
      const mas = el('button','btn-etq', '＋ '+esc(e.corto));
      mas.title = 'Marcar los seleccionados · '+e.label;
      mas.onclick = ()=>marcarEtiqueta([...state.sel], e.id, true, 'selección');
      const menos = el('button','btn-etq quitar', '－');
      menos.title = 'Quitar la marca a los seleccionados · '+e.label;
      menos.onclick = ()=>marcarEtiqueta([...state.sel], e.id, false, 'selección');
      se.appendChild(mas); se.appendChild(menos);
    }
  }
  const cs = $('#selCat'), fs = $('#selSub');
  const prevCat = cs.value, prevSub = fs.value;
  opcionesCategoria(cs, true);
  if (prevCat && cs.querySelector(`option[value="${CSS.escape(prevCat)}"]`)) cs.value = prevCat;
  opcionesSub(fs, cs.value, null, null);
  if (prevSub && fs.querySelector(`option[value="${CSS.escape(prevSub)}"]`)) fs.value = prevSub;
}

/* ---------- ficha de producto ---------- */
let FICHA_ID = null;
function abrirFicha(id){
  const p = IDX.get(id); if (!p) return;
  FICHA_ID = id;
  const lista = filtered();
  const pos = lista.findIndex(x=>x.id===id);
  const b = $('#modalBody'); b.innerHTML='';
  const photo = el('div','modal-photo'); photo.appendChild(thumbEl(p));
  photo.appendChild(el('div','foto-bar',
    `<button class="btn-datos" id="fFotoBtn" title="Sube una imagen: se guarda en línea y el catálogo la muestra al instante">🖼 Cambiar foto</button>
     <input type="file" id="fFotoFile" accept="image/*" hidden />
     <span id="fFotoEstado" class="foto-estado"></span>`));
  const info = el('div','modal-info');
  const s = sugVisible(p);
  info.innerHTML = `
    <div class="modal-cat">${esc(rutaTxt(p.cat, p.sub, p.sub2))}</div>
    <div class="f-field"><label>Nombre / descripción</label><input id="fNom" value="${esc(p.nom)}" /></div>
    <div class="f-2col">
      <div class="f-field"><label>Código</label><input value="${esc(p.cod)}" readonly /></div>
      <div class="f-field"><label>Medidas</label><input id="fMed" value="${esc(p.med)}" /></div>
    </div>
    <div class="f-field"><label>Proveedor</label><input id="fProvF" value="${esc(p.prov)}" /></div>
    <div class="f-2col">
      <div class="f-field"><label>Categoría</label><select id="fCat"></select></div>
      <div class="f-field"><label>Sub / sub-sub</label><select id="fSub"></select></div>
    </div>
    <div class="f-field"><label>Marcas de gestión (se aplican al instante)</label>
      <div class="f-etq">${ETIQUETAS.map(e=>
        `<label class="f-etq-item"><input type="checkbox" data-etq="${e.id}"${tieneEtq(p,e.id)?' checked':''} /> ${esc(e.label)}</label>`
      ).join('')}</div>
    </div>
    ${s ? `<div class="f-sug">${s.aprox?'≈':'Regla:'} sugerencia <b>${esc(s.cat)}${s.sub&&s.sub!==s.cat?' › '+esc(s.sub):''}</b>
      <button id="fAplicaSug">Aplicar</button></div>` : ''}
    <div class="f-cta">
      <button class="btn-asignar" id="fGuardar">Guardar cambios</button>
      <span class="f-nav">
        <button id="fPrev" title="Anterior (←)">←</button>
        <button id="fNext" title="Siguiente (→)">→</button>
      </span>
    </div>
    <div class="fname" style="font-size:11px;color:var(--gris);font-family:var(--mono);margin-top:12px">${
      esUrlFoto(p.foto) ? 'Foto en línea (Supabase Storage)' : `Foto local: fotos/${esc(p.id)}.webp (o .jpg/.png)`
    }</div>`;
  b.appendChild(photo); b.appendChild(info);

  info.querySelectorAll('[data-etq]').forEach(cb=>{
    cb.onchange = ()=>marcarEtiqueta([p.id], cb.dataset.etq, cb.checked, 'ficha');
  });

  $('#fFotoBtn').onclick = ()=>$('#fFotoFile').click();
  $('#fFotoFile').onchange = (e)=>{ const f=e.target.files[0]; e.target.value=''; if (f) abrirEditorFoto(p.id, f); };

  const fc = $('#fCat'), fs = $('#fSub');
  opcionesCategoria(fc, true);
  if (!TAXMAP.has(p.cat) && p.cat!==POR){ const o=el('option',null,esc(p.cat)+' (fuera de taxonomía)'); o.value=p.cat; fc.appendChild(o); }
  fc.value = p.cat;
  opcionesSub(fs, p.cat, p.sub, p.sub2||'');
  fc.onchange = ()=>opcionesSub(fs, fc.value, null, null);

  if (s) $('#fAplicaSug').onclick = ()=>{ fc.value=s.cat; opcionesSub(fs, s.cat, s.sub, ''); };

  $('#fGuardar').onclick = ()=>{
    let cambio = editarCampos(p.id, { nom:$('#fNom').value.trim(), med:$('#fMed').value.trim(), prov:$('#fProvF').value.trim() });
    if (cambio){
      construirProductos();
      const np = IDX.get(p.id);
      const ns = calcularSugerencia(np);
      if (ns) SUG.set(p.id, ns); else SUG.delete(p.id);
    }
    const nCat = fc.value;
    const {sub, sub2} = parseSubVal(fs.value);
    const nSub = sub || nCat;
    const q = IDX.get(p.id);
    if (q.cat!==nCat || q.sub!==nSub || (q.sub2||'')!==(sub2||'')){
      asignar([p.id], nCat, nSub, sub2, 'ficha'); cambio=true;
    }
    else if (cambio){ persistir(); renderAll(); aviso('✓ Ficha guardada'); }
    else aviso('Sin cambios.');
    cerrarFicha();
  };
  const nav = (d)=>{
    const l = filtered();
    const i = l.findIndex(x=>x.id===FICHA_ID);
    const nx = l[i+d]; if (nx) abrirFicha(nx.id);
  };
  $('#fPrev').onclick = ()=>nav(-1); $('#fNext').onclick = ()=>nav(1);
  $('#fPrev').disabled = pos<=0; $('#fNext').disabled = pos<0 || pos>=lista.length-1;

  $('#modal').hidden=false;
  $('#fNom').focus();
}
function cerrarFicha(){ $('#modal').hidden=true; FICHA_ID=null; }

/* ---------- diálogo genérico (promesa) ---------- */
let DLG_RESOLVE = null;
function dialogo(cfg){
  return new Promise(resolve=>{
    DLG_RESOLVE = resolve;
    $('#dlgTitle').textContent = cfg.titulo||'';
    const body = $('#dlgBody'); body.innerHTML='';
    if (cfg.texto) body.appendChild(el('p',null,esc(cfg.texto)));
    for (const c of (cfg.campos||[])){
      const w = el('div');
      w.appendChild(el('label',null,esc(c.label||'')));
      let inp;
      if (c.tipo==='select'){
        inp = el('select');
        for (const o of c.opciones){ const op=el('option',null,esc(o.t)); op.value=o.v; inp.appendChild(op); }
        if (c.valor!=null) inp.value=c.valor;
      } else {
        inp = el('input'); inp.type='text'; inp.value=c.valor||''; inp.placeholder=c.placeholder||'';
        inp.addEventListener('keydown', e=>{ if(e.key==='Enter') $('#dlgOk').click(); });
      }
      inp.dataset.campo = c.id;
      w.appendChild(inp);
      body.appendChild(w);
    }
    $('#dlgOk').textContent = cfg.okTxt||'Aceptar';
    $('#dlg').hidden=false;
    if (cfg.alAbrir) cfg.alAbrir(body);
    const first = body.querySelector('input,select'); if (first) first.focus();
  });
}
function cerrarDlg(valores){
  $('#dlg').hidden=true;
  if (DLG_RESOLVE){ const r=DLG_RESOLVE; DLG_RESOLVE=null; r(valores); }
}

/* ---------- bitácora (modal) ---------- */
function abrirLog(){
  const body = $('#logBody'); body.innerHTML='';
  const items = [...WORK.bitacora].reverse();
  if (!items.length){ body.appendChild(el('div','log-empty','Aún no hay cambios registrados.')); }
  for (const it of items){
    const d = new Date(it.t);
    const ts = d.toLocaleString('es-MX',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
    const row = el('div','log-item',`<time>${ts}</time><span>${esc(it.txt)}</span>`);
    body.appendChild(row);
  }
  $('#modalLog').hidden=false;
}

/* ---------- exportadores ---------- */
async function saveFile(nombre, contenido, mime){
  if (window.showSaveFilePicker){
    try{
      const h = await window.showSaveFilePicker({ suggestedName:nombre });
      const w = await h.createWritable(); await w.write(contenido); await w.close();
      aviso('✓ Guardado: '+h.name); return;
    }catch(e){ if (e && e.name==='AbortError') return; }
  }
  const blob = new Blob([contenido], {type:mime||'text/plain;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
  aviso('✓ Descargado: '+nombre);
}
function csvCampo(v){
  v = (v==null?'':v).toString();
  return /[",\r\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v;
}
function construirCSV(){
  const lineas = ['proveedor,codigo,descripcion,categoria,tipo,subtipo,medidas'];
  for (const p of PRODUCTOS){
    lineas.push([p.prov,p.cod,p.nom,p.cat,p.sub,p.sub2||'',p.med].map(csvCampo).join(','));
  }
  return '﻿'+lineas.join('\r\n')+'\r\n';
}
function construirExport(){
  const productos = PRODUCTOS.map(p=>({id:p.id,cod:p.cod,nom:p.nom,cat:p.cat,sub:p.sub,sub2:p.sub2||'',med:p.med,prov:p.prov,foto:p.foto||(p.id+'.webp'),etq:etqDe(p)}));
  const cuenta = new Map();
  for (const p of productos){
    let c = cuenta.get(p.cat); if(!c){ c={n:0,subs:new Map()}; cuenta.set(p.cat,c); }
    c.n++;
    let s = c.subs.get(p.sub); if(!s){ s={n:0,subs2:new Map()}; c.subs.set(p.sub,s); }
    s.n++;
    if (p.sub2) s.subs2.set(p.sub2,(s.subs2.get(p.sub2)||0)+1);
  }
  const categorias = [...cuenta].map(([nombre,c])=>({
    nombre, n:c.n,
    subs: [...c.subs].map(([sn,s])=>{
      const o = {nombre:sn, n:s.n};
      if (s.subs2.size) o.subs = [...s.subs2].map(([x,n])=>({nombre:x,n})).sort(alfaN);
      return o;
    }).sort(alfaN),
  })).sort((a,b)=>b.n-a.n);
  return { generado:hoyISO(), total:productos.length, productos, categorias };
}
function exportarAvance(){
  saveFile(`avance_clasificador_${hoyISO()}.json`, JSON.stringify(WORK), 'application/json');
}
function exportarCSV(){ saveFile('catalogo_categorizado.csv', construirCSV(), 'text/csv;charset=utf-8'); }
function exportarJS(){ saveFile('productos.js', 'window.CATALOGO = '+JSON.stringify(construirExport())+';', 'text/javascript'); }
function exportarJSON(){ saveFile('productos.json', JSON.stringify(construirExport()), 'application/json'); }

async function importarAvance(file){
  let data;
  try{ data = JSON.parse(await file.text()); }
  catch{ aviso('⚠ El archivo no es un JSON válido.'); return; }
  if (!data || (data.version!==1 && data.version!==2) || !Array.isArray(data.taxonomia) || typeof data.asignaciones!=='object'){
    aviso('⚠ El archivo no parece un avance del clasificador.'); return;
  }
  const nA = Object.keys(data.asignaciones||{}).length, nE = Object.keys(data.ediciones||{}).length;
  const ok = await dialogo({ titulo:'Importar avance',
    texto:`El archivo trae ${fmt(nA)} asignaciones y ${fmt(nE)} ediciones (guardado: ${data.guardado?new Date(data.guardado).toLocaleString('es-MX'):'—'}). Esto REEMPLAZA tu avance actual. ¿Continuar?`,
    okTxt:'Importar' });
  if (!ok) return;
  WORK = migrar(data);
  UNDO.length=0; actualizarBtnUndo();
  bitacora('Avance importado desde archivo');
  construirProductos(); calcularSugerencias(); persistir(); renderAll();
  aviso('✓ Avance importado');
}

async function reiniciarTrabajo(){
  const ok = await dialogo({ titulo:'Reiniciar trabajo',
    texto:'Se borrará TODO tu avance local (asignaciones, ediciones, taxonomía y bitácora) y volverás al estado de los datos base. Esta acción no se puede deshacer. ¿Seguro?',
    okTxt:'Borrar todo' });
  if (!ok) return;
  const ok2 = await dialogo({ titulo:'Confirmación final',
    texto:'Última confirmación: ¿borrar el avance definitivamente? Si tienes duda, exporta antes un respaldo con "Guardar avance".',
    okTxt:'Sí, borrar' });
  if (!ok2) return;
  localStorage.removeItem(LS_KEY);
  WORK = nuevoTrabajo();
  UNDO.length=0; actualizarBtnUndo();
  state.cat=null; state.sub=null; state.sub2=null; state.sel.clear(); state.page=1;
  construirProductos(); calcularSugerencias(); persistir(); renderAll();
  $('#modalDatos').hidden=true;
  aviso('Trabajo reiniciado');
}

function abrirDatos(){
  const nA = Object.keys(WORK.asignaciones).length, nE = Object.keys(WORK.ediciones).length;
  const kb = Math.round((localStorage.getItem(LS_KEY)||'').length/1024);
  const baseCambio = WORK.baseGenerado!==DATA.generado
    ? `<br><b style="color:var(--oxido)">⚠ Los datos base cambiaron</b> (avance iniciado con "${esc(WORK.baseGenerado)}", base actual "${esc(DATA.generado)}"). Tus cambios se aplican por código de producto.` : '';
  $('#datosStats').innerHTML =
    `<b>${fmt(nA)}</b> asignaciones de categoría · <b>${fmt(nE)}</b> fichas editadas · bitácora con <b>${fmt(WORK.bitacora.length)}</b> entradas` +
    `<br>Último autoguardado: ${WORK.guardado?new Date(WORK.guardado).toLocaleString('es-MX'):'—'} · tamaño del avance: ~${kb} KB` + baseCambio;
  pintarFsDatos();
  renderSbEstado();
  $('#modalDatos').hidden=false;
}

/* ---------- avisos ---------- */
function aviso(txt){
  const t = $('#toast'); t.textContent=txt; t.hidden=false;
  clearTimeout(aviso._t); aviso._t = setTimeout(()=>{ t.hidden=true; }, 2400);
}

/* ---------- render raíz ---------- */
function renderAll(){
  CNT = contar();
  renderProgreso();
  renderTax();
  renderChips();
  renderLista();
  renderSelbar();
}

/* ---------- init ---------- */
function init(){
  construirProductos();
  calcularSugerencias();
  llenarProveedores();
  actualizarBtnUndo();
  renderAll();

  let t; $('#q').addEventListener('input', e=>{
    clearTimeout(t); t=setTimeout(()=>{ state.q=e.target.value; state.page=1; renderLista(); },140);
  });
  $('#btnMore').onclick = ()=>{ state.page++; renderLista(); };
  $('#btnVista').onclick = ()=>{
    state.vista = state.vista==='lista' ? 'previa' : 'lista';
    state.page=1;
    $('#btnVista').textContent = state.vista==='lista' ? '🗂 Vista catálogo' : '☰ Vista lista';
    renderLista();
  };
  $('#selAll').onchange = (e)=>{
    const lista = filtered();
    if (e.target.checked) lista.forEach(p=>state.sel.add(p.id));
    else lista.forEach(p=>state.sel.delete(p.id));
    renderLista(); renderSelbar();
  };

  // Fin del barrido de selección (mouseup en cualquier parte)
  document.addEventListener('mouseup', ()=>{
    if (PAINT.downId===null) return;
    if (PAINT.active){
      PAINT.suppressUntil = Date.now()+320;
      renderLista(); renderSelbar();
    }
    PAINT.downId=null; PAINT.downIdx=null; PAINT.base=null; PAINT.active=false;
  });

  // Barra de asignación
  $('#selCat').onchange = ()=>opcionesSub($('#selSub'), $('#selCat').value, null, null);
  $('#btnAsignar').onclick = ()=>{
    const cat = $('#selCat').value; if(!cat) return;
    const {sub, sub2} = parseSubVal($('#selSub').value);
    asignar([...state.sel], cat, sub || cat, sub2, 'manual');
  };
  $('#btnSugSel').onclick = ()=>aplicarSugerencias([...state.sel]);
  $('#btnSelClear').onclick = ()=>{ state.sel.clear(); renderLista(); renderSelbar(); };

  // Topbar
  $('#btnUndo').onclick = undo;
  $('#btnLog').onclick = abrirLog;
  $('#btnDatos').onclick = abrirDatos;
  $('#btnNewCat').onclick = nuevaCategoria;

  // Modales
  $('#modalClose').onclick = cerrarFicha;
  $('#modal').addEventListener('click', e=>{ if(e.target.id==='modal') cerrarFicha(); });
  $('#logClose').onclick = ()=>{ $('#modalLog').hidden=true; };
  $('#modalLog').addEventListener('click', e=>{ if(e.target.id==='modalLog') $('#modalLog').hidden=true; });
  $('#datosClose').onclick = ()=>{ $('#modalDatos').hidden=true; };
  $('#modalDatos').addEventListener('click', e=>{ if(e.target.id==='modalDatos') $('#modalDatos').hidden=true; });
  $('#dlgOk').onclick = ()=>{
    const valores = {};
    $('#dlgBody').querySelectorAll('[data-campo]').forEach(n=>valores[n.dataset.campo]=n.value);
    cerrarDlg(Object.keys(valores).length?valores:true);
  };
  $('#dlgCancel').onclick = ()=>cerrarDlg(null);
  $('#dlg').addEventListener('click', e=>{ if(e.target.id==='dlg') cerrarDlg(null); });

  // Exportadores
  $('#expAvance').onclick = exportarAvance;
  $('#impAvance').onclick = ()=>$('#fileImport').click();
  $('#fileImport').onchange = (e)=>{ const f=e.target.files[0]; e.target.value=''; if(f) importarAvance(f); };
  $('#expCSV').onclick = exportarCSV;
  $('#expJS').onclick = exportarJS;
  $('#expJSON').onclick = exportarJSON;
  $('#btnReset').onclick = reiniciarTrabajo;

  // Conexión directa con el catálogo
  $('#btnFsConectar').onclick = ()=>{ FS.estado==='prompt' ? reconectarCatalogo() : conectarCatalogo(); };
  $('#btnFsGuardar').onclick = ()=>guardarEnCatalogo('manual');
  $('#btnFsDesconectar').onclick = desconectarCatalogo;
  initFs();

  // Sincronización en línea (Supabase)
  $('#sbLogin').onclick = sbLogin;
  $('#sbLogout').onclick = sbLogout;
  $('#sbSync').onclick = ()=>sincronizarSupabase('manual');
  $('#sbPass')?.addEventListener('keydown', e=>{ if(e.key==='Enter') sbLogin(); });
  initSb();

  vigilarNuevas();   // devuelve el color original a las categorías al cumplir 48 h
  initEditorFoto();

  // Teclado
  document.addEventListener('keydown', e=>{
    const enInput = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName||'');
    if (e.key==='Escape'){
      if (!$('#dlg').hidden){ cerrarDlg(null); return; }
      if (!$('#modalFoto').hidden){ cerrarEditorFoto(); return; }
      if (!$('#modal').hidden){ cerrarFicha(); return; }
      if (!$('#modalLog').hidden){ $('#modalLog').hidden=true; return; }
      if (!$('#modalDatos').hidden){ $('#modalDatos').hidden=true; return; }
      if (state.sel.size){ state.sel.clear(); renderLista(); renderSelbar(); }
      return;
    }
    if (!$('#modal').hidden && (e.key==='ArrowLeft'||e.key==='ArrowRight') && !enInput){
      (e.key==='ArrowLeft' ? $('#fPrev') : $('#fNext')).click(); return;
    }
    if (enInput) return;
    if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='z'){ e.preventDefault(); undo(); }
    if (e.key==='/'){ e.preventDefault(); $('#q').focus(); }
  });

  if (WORK.baseGenerado!==DATA.generado && Object.keys(WORK.asignaciones).length)
    aviso('⚠ Los datos base cambiaron desde tu último avance; revisa Guardar / Exportar.');

  if (new URLSearchParams(location.search).get('selftest')==='1') selfTest();
}

/* ---------- self-test (clasificador.html?selftest=1) ---------- */
function selfTest(){
  const res = [];
  const t = (nombre, ok)=>res.push((ok?'PASS':'FAIL')+' '+nombre);
  const lenBit = WORK.bitacora.length, lenUndo = UNDO.length;
  const taxSnap = taxSnapshot();
  PERSIST = false;
  try{
    const s1 = sugerirPorReglas('COMPRESOR 2.5 HP 23 LTS BYP');
    t('regla compresor', !!s1 && s1.cat==='Herramienta electrica');
    const s2 = sugerirPorReglas('TUBULAR CUADRADO 1" C.18');
    t('regla tubular', !!s2 && s2.cat==='Tubulares' && s2.sub==='Tubular cuadrado');
    const s3 = sugerirPorReglas('BISAGRA DE LIBRO 3X3');
    t('regla bisagra', !!s3 && s3.cat==='Herrajes' && s3.sub==='Bisagra y pivote');
    const s4 = sugerirPorReglas('XYZZY SIN PISTA ALGUNA');
    t('regla sin match', s4===null);
    t('csv escape', csvCampo('A "B", C')==='"A ""B"", C"');
    t('parse subval', (()=>{ const v=parseSubVal(subVal('Herraje','Cerraduras')); return v.sub==='Herraje'&&v.sub2==='Cerraduras'; })());
    const p = PRODUCTOS[0];
    const antes = {cat:p.cat, sub:p.sub, sub2:p.sub2||''};
    const prevAsig = WORK.asignaciones[p.id] ? JSON.stringify(WORK.asignaciones[p.id]) : null;
    asignar([p.id], 'Izaje y maniobra', 'Izaje y maniobra', '', 'selftest');
    t('asignar aplica', IDX.get(p.id).cat==='Izaje y maniobra');
    undo();
    let q = IDX.get(p.id);
    let asigRest = WORK.asignaciones[p.id] ? JSON.stringify(WORK.asignaciones[p.id]) : null;
    t('undo restaura', q.cat===antes.cat && q.sub===antes.sub && asigRest===prevAsig);
    // 3er nivel: asignación con sub2 + autoregistro en taxonomía + undo
    asignar([p.id], 'Herrajes', 'Herraje de puerta', 'PRUEBA-SUB2', 'selftest');
    q = IDX.get(p.id);
    const hj = buscarCat('Herrajes'), hp = hj && buscarSub(hj,'Herraje de puerta');
    t('sub2 aplica', q.sub2==='PRUEBA-SUB2' && !!hp && hp.subs.includes('PRUEBA-SUB2'));
    undo();
    q = IDX.get(p.id);
    asigRest = WORK.asignaciones[p.id] ? JSON.stringify(WORK.asignaciones[p.id]) : null;
    t('sub2 undo', q.cat===antes.cat && (q.sub2||'')===antes.sub2 && asigRest===prevAsig);
    const ex = construirExport();
    t('export total', ex.total===PRODUCTOS.length);
    t('export subs array', ex.categorias.every(c=>Array.isArray(c.subs) && c.subs.length>=1));
    t('export suma', ex.categorias.reduce((a,c)=>a+c.n,0)===ex.total);
    t('export campos', ['id','cod','nom','cat','sub','sub2','med','prov','foto'].every(f=>f in ex.productos[0]));
    const csv = construirCSV();
    const csvLineas = csv.trim().split('\r\n');
    t('csv filas', csvLineas.length===PRODUCTOS.length+1);
    t('csv encabezado', csvLineas[0].replace('﻿','')==='proveedor,codigo,descripcion,categoria,tipo,subtipo,medidas');
    t('csv bom', csv.charCodeAt(0)===0xFEFF);
  }catch(e){
    res.push('FAIL excepción: '+e.message);
  }
  WORK.bitacora.length = lenBit;
  UNDO.length = lenUndo; actualizarBtnUndo();
  WORK.taxonomia = taxSnap;      // revierte autoregistros de la prueba
  PERSIST = true;
  construirProductos(); renderAll();
  const div = el('div'); div.id='selftest';
  div.dataset.ok = res.every(r=>r.startsWith('PASS'));
  div.textContent = res.join(' | ');
  div.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99;background:#13171A;color:#7CE38B;font:11px monospace;padding:6px 10px';
  document.body.appendChild(div);
}

init();
