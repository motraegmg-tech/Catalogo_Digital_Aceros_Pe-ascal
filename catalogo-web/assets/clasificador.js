/* ===== Aceros Peñascal · Clasificador de Catálogo · clasificador.js =====
   Herramienta interna (MOTRAE) para curar manualmente la clasificación de los
   3,222 productos. Corre bajo file:// igual que el prototipo: los datos entran
   por window.CATALOGO (data/productos.js) y el avance vive en localStorage
   como deltas (asignaciones/ediciones), reimportable y exportable.

   Modelo v2: taxonomía de 3 niveles (categoría → subcategoría → sub-sub),
   productos con campo efectivo sub2. Los avances v1 se migran solos. */

const POR = 'POR CLASIFICAR';
/* Categoría de retiro. Lo que se clasifique aquí desaparece del catálogo del
   cliente: la vista `catalogo_publico` de Supabase la filtra, así que esos
   productos ni siquiera se descargan. Aquí SÍ se siguen viendo y editando,
   para poder devolverlos al catálogo cuando haga falta. */
const CAT_OCULTA = 'Productos Descontinuados / Ocultos';
const LS_KEY = 'ap_clasificador_v1';
/* Cuánto historial guarda la bitácora. Se poda por fecha (dos meses) y no por
   cantidad: reclasificar una categoría entera generaba cientos de entradas en
   una tarde y borraba el rastro de la semana anterior. Estas constantes van
   aquí arriba porque podarBitacora() corre al cargar el avance, mucho antes de
   donde vive la bitácora en el archivo. */
const BITACORA_DIAS = 60;
const BITACORA_MS = BITACORA_DIAS*24*60*60*1000;
const BITACORA_MAX = 5000;          // red de seguridad para el tamaño en localStorage
const SEP = '';                 // separador interno (valores compuestos)
const PAGE_LISTA = 100, PAGE_PREVIA = 60;
const FOTO_EXTS = ['webp','jpg','jpeg','png'];

/* ---------- marcas de gestión (las "categorías extra") ----------
   Un producto sigue teniendo UNA categoría real, pero además puede llevar
   estas marcas para rastrear lo que todavía no está 100% configurado. Viven en
   el arreglo `etq` y se sincronizan a Supabase (columna `etiquetas`). */
const ETIQUETAS = [
  /* Los que la tienda dejó de vender (hoja OBSOLETOS del Excel de Aceros
     Peñascal). Esta marca ESCONDE: el producto sale de todas las listas del
     clasificador, del conteo de arriba y del catálogo público — sólo se ve
     entrando a esta marca. Ver ETQ_OCULTA. */
  { id:'obsoleto', label:'Productos obsoletos', corto:'Obsoleto',
    oculta:true, ayuda:'Ya no se venden. No aparecen en ninguna otra lista ni en el catálogo del cliente, ni cuentan en el total de arriba. Quítales la marca para devolverlos.' },
];

/* ---------- marcas retiradas del panel (2026-08-04, decisión de Gonzalo) ----
   `sin-foto`, `sin-conocimiento` y `proveedor-por-revisar` salieron de la lista
   de arriba: eran andamiaje de la curación inicial y ya sólo hacían ruido en el
   panel del encargado, que no las usa.

   El DATO se conserva a propósito. `sin-foto` no es sólo una fila del árbol: es
   lo que leen `pipeline/procesar_fotos_crudas.py`,
   `pipeline/limpiar_fotos_incorrectas.py` y `pipeline/catalogo_fuente.py` para
   saber a qué productos les falta imagen. Borrarla de `productos.etiquetas`
   dejaría esos scripts encontrando cero productos y nadie se enteraría hasta la
   siguiente tanda de fotos.

   Al no estar en ETIQUETAS, la marca deja de pintarse, de contarse y de poder
   ponerse o quitarse desde el panel; el valor sigue viajando intacto en cada
   sincronización porque `etqDe()` devuelve el arreglo tal cual. */
const ETIQUETAS_RETIRADAS = ['sin-foto', 'sin-conocimiento', 'proveedor-por-revisar'];
const ETQMAP = new Map(ETIQUETAS.map(e=>[e.id,e]));
/* Marca que esconde el producto de todo lo demás. Es una sola (`obsoleto`), pero
   se resuelve desde ETIQUETAS para que agregar otra en el futuro no obligue a
   perseguir cadenas sueltas por el archivo. */
const ETQ_OCULTA = (ETIQUETAS.find(e=>e.oculta)||{}).id || null;
function etqDe(p){ return Array.isArray(p.etq) ? p.etq : []; }
function tieneEtq(p,id){ return etqDe(p).includes(id); }
function etqKey(p){ return etqDe(p).slice().sort().join(','); }
/* ¿Está retirado por marca de gestión? Lo usan el filtro, los conteos y el
   selector de productos: si esto da true, el producto sólo existe dentro de su
   propia marca. */
function esObsoleto(p){ return !!ETQ_OCULTA && tieneEtq(p, ETQ_OCULTA); }

const DATA = window.CATALOGO || { generado:'', total:0, productos:[], categorias:[] };

/* Normaliza los campos de proveedor para que la base siempre los tenga definidos.
   `prov` = razón social (interna). `mprov` = interruptor "Mostrar en el Catálogo":
   mientras esté en false el catálogo público NO recibe el proveedor (la vista
   `catalogo_publico` lo devuelve como NULL). Arranca apagado en todo. */
for (const p of DATA.productos){
  if (typeof p.prov !== 'string') p.prov = p.prov==null ? '' : String(p.prov);
  p.mprov = !!p.mprov;
}

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
/* La categoría de retiro quedó JUBILADA el 2026-08-04: retirar es poner la marca
   «Productos obsoletos», que conserva la clasificación del producto. Aquí se
   quita del árbol para que nadie la vuelva a usar sin querer.

   Y sobre todo se BORRAN los deltas locales que apuntaban a ella. Esto no es
   cosmético: un avance guardado antes de la migración conserva
   `asignaciones[id] = {cat:"Productos Descontinuados / Ocultos"}`, y ese delta
   se reaplica encima de la base en cada sincronización. Pasó de verdad: un
   producto devuelto al catálogo en la base volvía a esconderse solo cada vez
   que la pestaña abierta sincronizaba, sin que nadie tocara nada. Al soltar el
   delta, manda la base, que es donde está la decisión buena. */
function jubilarCatOculta(w){
  let sueltos = 0;
  for (const [id, a] of Object.entries(w.asignaciones||{})){
    if (a && norm(a.cat)===norm(CAT_OCULTA)){ delete w.asignaciones[id]; sueltos++; }
  }
  w.taxonomia = (w.taxonomia||[]).filter(c => norm(c.nombre)!==norm(CAT_OCULTA));
  return sueltos;
}
function taxDesdeBase(){
  return (DATA.categorias
    .filter(c=>c.nombre!==POR && norm(c.nombre)!==norm(CAT_OCULTA))
    .map(c=>({ nombre:c.nombre,
      subs: asArray(c.subs).map(s=>s.nombre).filter(s=>s!==c.nombre)
        .sort(alfa).map(s=>({nombre:s, subs:[]})) })));
}

/* ---------- categorías que llegan de la base ----------
   El árbol de la izquierda se arma UNA vez, con las categorías del archivo local
   (data/productos.js), y desde entonces vive en localStorage. Cuando alguien
   crea una categoría desde otra máquina —"Placa", agosto 2026—, sus productos
   bajan por el pull con esa categoría, pero el árbol de acá nunca se enteró: la
   fila no existe y cada producto sale rotulado "(fuera de taxonomía)", que no le
   dice nada a quien no programa y hace pensar que algo se rompió.

   Esto registra en la taxonomía local lo que la base ya da por bueno. Se llama
   SÓLO al traer cambios del equipo, nunca al construir la lista: si corriera
   siempre, una categoría recién borrada aquí reaparecería sola. */
function registrarCatsDeLaBase(){
  let nuevas = 0;
  for (const p of DATA.productos){
    const cat = p.cat;
    if (!cat || cat===POR) continue;
    if (norm(cat)===norm(CAT_OCULTA)) continue;   // jubilada: no se vuelve a crear
    let entrada = WORK.taxonomia.find(c=>norm(c.nombre)===norm(cat));
    if (!entrada){
      entrada = { nombre:cat, subs:[], creada:new Date().toISOString() };
      WORK.taxonomia.push(entrada);
      nuevas++;
    }
    const sub = p.sub;
    if (!sub || sub===cat) continue;
    let se = entrada.subs.find(s=>norm(s.nombre)===norm(sub));
    if (!se){ se = {nombre:sub, subs:[]}; entrada.subs.push(se); entrada.subs.sort(alfaN); }
    const s2 = p.sub2;
    if (s2 && !se.subs.some(x=>norm(x)===norm(s2))){ se.subs.push(s2); se.subs.sort(alfa); }
  }
  return nuevas;
}
function nuevoTrabajo(){
  return { version:2, creado:hoyISO(), guardado:null, baseGenerado:DATA.generado||'',
    taxonomia:taxDesdeBase(), asignaciones:{}, ediciones:{}, etiquetas:{},
    nuevos:{}, borrados:{}, renombres:{}, bitacora:[] };
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
  jubilarCatOculta(w);              // ver la función: retirar ahora es una marca
  w.asignaciones = w.asignaciones||{}; w.ediciones = w.ediciones||{};
  w.etiquetas = w.etiquetas||{}; w.bitacora = w.bitacora||[];
  // Altas y bajas hechas desde el clasificador (v2.1). Un avance guardado antes
  // de que existieran simplemente no trae ninguna.
  w.nuevos = w.nuevos||{}; w.borrados = w.borrados||{};
  // Códigos corregidos (v2.2): id -> {de, a}. Ver renombrarCodigo().
  w.renombres = w.renombres||{};
  return w;
}
let WORK = load(LS_KEY, null);
WORK = (WORK && (WORK.version===1||WORK.version===2) && Array.isArray(WORK.taxonomia))
  ? migrar(WORK) : nuevoTrabajo();
// Al abrir, la bitácora se recorta a los dos últimos meses (ver BITACORA_DIAS).
podarBitacora();

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

/* ---------- modo MOTRAE (?dev=1) ----------
   El clasificador lo usa a diario el encargado de Aceros Peñascal, que no
   programa. Las herramientas que sólo tienen sentido con el repositorio
   delante —escribir en la carpeta data/, exportar los archivos del catálogo—
   se esconden salvo que se abra con `?dev=1`.

   No es seguridad (cualquiera puede escribir eso en la barra de direcciones):
   es quitar de en medio botones que a un trabajador sólo pueden confundirlo,
   como un selector de carpetas que le pregunta si escribir archivos ahí. */
const MODO_DEV = new URLSearchParams(location.search).get('dev') === '1';

/* ---------- conexión directa con el catálogo (File System Access) ----------
   Sólo en modo MOTRAE. Con la carpeta catalogo-web/data/ conectada (elegida UNA
   vez), cada cambio reescribe productos.js y productos.json ahí mismo. Hoy es
   un camino secundario: la fuente de verdad es Supabase y esos archivos son el
   respaldo del repositorio, que se regenera mejor con `node sync-local.mjs`. */
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
  /* Sin modo MOTRAE no se toca nada: ni se lee IndexedDB ni se comprueban
     permisos de carpeta. Así el navegador nunca le enseña a un trabajador un
     aviso de acceso a archivos que no sabría cómo interpretar. */
  if (!MODO_DEV){ FS.estado='off'; return; }
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
  if (!MODO_DEV) return;
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
  if (!MODO_DEV) return;
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
/* `puedeEditar`: estar autenticado ya NO basta para escribir — hay que estar en
   la lista `editores` de la base (el registro de Supabase es abierto y la anon
   key es pública, así que cualquiera podría crearse una cuenta). null = todavía
   no se ha preguntado. Sin esto, a un trabajador no autorizado se le guardaría
   todo "bien" en su navegador y no subiría nada, sin decirle por qué. */
const SB = { user:null, estado: SBC ? 'anon' : 'nosoporte', ultimo:null, error:null, puedeEditar:null };
// estado: nosoporte | anon (sin sesión) | on (sesión activa) | sync | error
const SB_SEP = '';
/* Identidad de esta pestaña. Viaja en `productos.updated_by` para que, cuando
   Realtime devuelva el eco de nuestra propia escritura, sepamos ignorarlo. */
const SB_YO = 'clasif-' + Math.random().toString(36).slice(2, 10);

/* La comparación va en DOS claves porque el push las trata distinto:
   - grupo: muchos productos comparten el mismo destino, así que se actualizan
     en lote con un solo update ... in (...).
   - fila: medida y descripción son propias de cada producto; no se agrupan y
     van en un update por producto. Antes NO se sincronizaban: por eso las
     medidas y los nombres solo existían en los archivos locales. */
function sbClaveGrupo(p){
  return (p.cat||'')+SB_SEP+(p.sub||'')+SB_SEP+(p.sub2||'')+SB_SEP+etqKey(p)
       + SB_SEP+(p.prov||'')+SB_SEP+(p.mprov?'1':'0');
}
function sbClaveFila(p){
  return (p.med||'')+SB_SEP+(p.nom||'');
}
function sbClave(p){ return { g: sbClaveGrupo(p), f: sbClaveFila(p) }; }

// Estado que asumimos ya está en Supabase (arranca == base local == BD desplegada)
const SB_BASE = new Map(DATA.productos.map(p => [p.cod, sbClave(p)]));
const SB_DIRTY = new Set();   // códigos cuyos datos difieren de Supabase

function marcarSucios(){
  if (!SBC) return;
  const vivos = new Set();
  for (const p of PRODUCTOS){
    vivos.add(p.cod);
    const b = SB_BASE.get(p.cod);
    if (!b || b.g !== sbClaveGrupo(p) || b.f !== sbClaveFila(p)) SB_DIRTY.add(p.cod);
    else SB_DIRTY.delete(p.cod);
  }
  // Un producto eliminado ya no está en PRODUCTOS: su código se quedaría marcado
  // como pendiente para siempre. La baja la lleva sincronizarAltasYBajas().
  for (const cod of [...SB_DIRTY]) if (!vivos.has(cod)) SB_DIRTY.delete(cod);
  renderSbEstado();
}

let SB_T = null;
function programarSyncSupabase(){
  if (!SBC || SB.estado==='nosoporte') return;
  clearTimeout(SB_T);
  SB_T = setTimeout(()=>sincronizarSupabase('auto'), 1600);
}

/* Filas pendientes de ALTA en Supabase. SB_BASE es "lo que creemos que hay en
   línea": todo producto que no esté ahí necesita un INSERT, no un UPDATE. Sirve
   igual para un alta recién capturada que para una baja deshecha. */
function altasPendientes(){
  return PRODUCTOS.filter(p => !SB_BASE.has(p.cod));
}
/* Filas pendientes de BAJA: eliminadas aquí y todavía presentes en Supabase. */
function bajasPendientes(){
  return Object.values(WORK.borrados).filter(b => b && b.cod && !b.subido && b.enBase !== false);
}

/* Sube las altas y las bajas antes que las reclasificaciones: un UPDATE sobre
   una fila que aún no existe no falla, simplemente no escribe nada — y el
   producto se quedaría "sincronizado" sin estar en la base. */
async function sincronizarAltasYBajas(){
  let altas = 0, bajas = 0;

  for (const p of altasPendientes()){
    const { error } = await SBC.from('productos').upsert({
      id: p.id, codigo: p.cod, descripcion: p.nom || '',
      categoria: p.cat || POR, subcategoria: p.sub || p.cat || POR, sub2: p.sub2 || null,
      medidas: p.med || '', foto: p.foto || null,
      proveedor: p.prov || '', mostrar_proveedor: !!p.mprov,
      etiquetas: etqDe(p), updated_by: SB_YO,
    }, { onConflict:'codigo' });
    if (error) return { error, altas, bajas };
    SB_BASE.set(p.cod, sbClave(p)); SB_DIRTY.delete(p.cod);
    if (WORK.nuevos[p.id]) WORK.nuevos[p.id].subido = true;
    altas++;
  }

  for (const b of bajasPendientes()){
    const { error } = await SBC.from('productos').delete().eq('codigo', b.cod);
    if (error) return { error, altas, bajas };
    SB_BASE.delete(b.cod); SB_DIRTY.delete(b.cod);
    b.subido = true;
    bajas++;
  }

  if (altas || bajas) try{ localStorage.setItem(LS_KEY, JSON.stringify(WORK)); }catch{}
  return { error:null, altas, bajas };
}

/* Sube los códigos corregidos. Dos pasos por producto, en este orden:
     1. `update productos set codigo=nuevo where id=…` — el id es la llave
        primaria y no cambia nunca, así que identifica la fila sin ambigüedad.
     2. reescribir los `cods` de las agrupaciones que lo mencionaban. Si esto se
        omitiera, el producto se caería de su ficha en silencio: la agrupación
        seguiría apuntando a un código que ya no existe.
   Si el paso 1 falla (p. ej. el código nuevo ya lo tiene otro), se aborta y el
   renombrado se queda pendiente: nada a medias. */
async function sincronizarRenombres(){
  const pend = renombresPendientes();
  if (!pend.length) return { error:null, hechos:0 };
  let hechos = 0;
  for (const r of pend){
    const { error } = await SBC.from('productos')
      .update({ codigo: r.a, updated_by: SB_YO }).eq('id', r.id);
    if (error) return { error, hechos };

    // Las agrupaciones guardan los códigos dentro de `subgrupos` (jsonb).
    const { data: fams, error: e2 } = await SBC.from('familias').select('id,subgrupos');
    if (e2) return { error:e2, hechos };
    for (const f of (fams||[])){
      const subs = Array.isArray(f.subgrupos) ? f.subgrupos : [];
      if (!subs.some(g => (g.cods||[]).includes(r.de))) continue;
      const nuevos = subs.map(g => Object.assign({}, g,
        { cods: (g.cods||[]).map(c => c === r.de ? r.a : c) }));
      const { error: e3 } = await SBC.from('familias')
        .update({ subgrupos: nuevos, updated_by: SB_YO }).eq('id', f.id);
      if (e3) return { error:e3, hechos };
      // El clasificador tiene su propia copia en memoria: hay que moverla igual.
      if (typeof window.plusRenombrarCodigo === 'function') window.plusRenombrarCodigo(f.id, r.de, r.a);
    }

    /* La base local pasa a tener el código nuevo, y el rastreo de "ya está en
       línea" se muda con él. A partir de aquí el renombrado deja de estar
       pendiente y el push normal puede localizar el producto. */
    const b = baseDe(r.id) || DATA.productos.find(x => x.id === r.id);
    if (b) b.cod = r.a;
    if (WORK.nuevos[r.id]) WORK.nuevos[r.id].cod = r.a;
    const clave = SB_BASE.get(r.de);
    SB_BASE.delete(r.de); SB_DIRTY.delete(r.de);
    if (clave) SB_BASE.set(r.a, clave);
    delete WORK.renombres[r.id];
    hechos++;
  }
  try{ localStorage.setItem(LS_KEY, JSON.stringify(WORK)); }catch{}
  construirProductos();
  return { error:null, hechos };
}

async function sincronizarSupabase(origen){
  if (!SBC) return false;
  if (!SB.user){ if (origen!=='auto') aviso('⚠ Inicia sesión para sincronizar en línea.'); return false; }
  if (SB.puedeEditar === false){
    if (origen!=='auto') aviso('⚠ Tu cuenta no está autorizada para editar. Tus cambios se quedan en esta computadora.');
    return false;
  }
  const pendientesAltaBaja = altasPendientes().length + bajasPendientes().length;
  const pendientesRenombre = renombresPendientes().length;
  if (!SB_DIRTY.size && !pendientesAltaBaja && !pendientesRenombre){
    if (origen!=='auto') aviso('Todo al día: nada por sincronizar.'); return true;
  }

  /* Los renombrados van PRIMERO: el resto del push localiza los productos por
     `codigo`, así que si se dejaran para el final buscarían un código que en
     línea todavía no existe y no escribirían nada. */
  if (pendientesRenombre){
    SB.estado='sync'; renderSbEstado();
    const r = await sincronizarRenombres();
    if (r.error){
      SB.estado='error'; SB.error = r.error.message || String(r.error); renderSbEstado();
      aviso('⚠ Error al cambiar el código en línea: '+SB.error);
      return false;
    }
    if (r.hechos && origen!=='auto') aviso(`☁ ${fmt(r.hechos)} código(s) corregido(s) en línea`);
  }

  if (pendientesAltaBaja){
    SB.estado='sync'; renderSbEstado();
    const r = await sincronizarAltasYBajas();
    if (r.error){
      SB.estado='error'; SB.error = r.error.message || String(r.error); renderSbEstado();
      aviso('⚠ Error al dar de alta/baja en línea: '+SB.error);
      return false;
    }
    if ((r.altas || r.bajas) && origen!=='auto')
      aviso(`☁ ${r.altas?fmt(r.altas)+' alta(s) ':''}${r.bajas?fmt(r.bajas)+' baja(s) ':''}en línea`);
  }
  if (!SB_DIRTY.size){ SB.estado='on'; SB.ultimo=new Date(); SB.error=null; renderSbEstado(); return true; }

  /* Dos pasadas. Los campos de destino (categoría, subcategoría, sub2, marcas,
     proveedor) se agrupan: reclasificar 200 productos a la misma rama es UN
     update. Medida y descripción son propias de cada producto, así que van
     una por una — normalmente son pocas, se editan de a un producto. */
  const grupos = new Map();
  const filas = [];
  for (const p of PRODUCTOS){
    if (!SB_DIRTY.has(p.cod)) continue;
    const base = SB_BASE.get(p.cod) || { g:null, f:null };
    const g = sbClaveGrupo(p);
    if (base.g !== g){ if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(p.cod); }
    if (base.f !== sbClaveFila(p)) filas.push(p);
  }
  SB.estado='sync'; renderSbEstado();
  let escritos = 0, fallo = null;
  const hechos = new Set();

  for (const [key, cods] of grupos){
    const [cat, sub, sub2, etqs, prov, mprov] = key.split(SB_SEP);
    for (let i=0;i<cods.length;i+=200){          // trocea por límite de URL de .in()
      const lote = cods.slice(i, i+200);
      const { error } = await SBC.from('productos')
        .update({ categoria: cat, subcategoria: sub, sub2: sub2 || null,
                  etiquetas: etqs ? etqs.split(',') : [],
                  proveedor: prov, mostrar_proveedor: mprov==='1', updated_by: SB_YO })
        .in('codigo', lote);
      if (error){ fallo = error; break; }
      for (const c of lote){ hechos.add(c); escritos++; }
    }
    if (fallo) break;
  }

  if (!fallo){
    for (const p of filas){
      const { error } = await SBC.from('productos')
        .update({ medidas: p.med || '', descripcion: p.nom || '', updated_by: SB_YO })
        .eq('codigo', p.cod);
      if (error){ fallo = error; break; }
      if (!hechos.has(p.cod)) escritos++;
      hechos.add(p.cod);
    }
  }

  // Solo lo confirmado deja de estar sucio; si algo falló, se reintenta luego.
  const porCod = new Map(PRODUCTOS.map(p => [p.cod, p]));
  for (const cod of hechos){
    const p = porCod.get(cod);
    if (p){ SB_BASE.set(cod, sbClave(p)); SB_DIRTY.delete(cod); }
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
  SB.puedeEditar = SB.user ? null : false;
  renderSbEstado();
  if (SB.user){
    comprobarPermisoEditar();                  // ¿está en la lista de editores?
    marcarSucios(); programarSyncSupabase();   // sube lo pendiente al entrar
    iniciarRealtime();                         // RLS solo emite eventos con sesión
  } else {
    pararRealtime();                           // sin sesión queda el pull por reloj
  }
}

/* Pregunta a la base si esta cuenta puede escribir. Ante cualquier fallo se
   asume que SÍ: un problema de red no debe bloquear a quien sí tiene permiso
   (si no lo tiene, la base rechazará la escritura de todos modos). */
async function comprobarPermisoEditar(){
  if (!SBC || !SB.user) return;
  try{
    const { data, error } = await SBC.rpc('puedo_editar');
    SB.puedeEditar = error ? true : (data === true);
  }catch{ SB.puedeEditar = true; }
  renderSbEstado();
  if (SB.puedeEditar === false)
    aviso('⚠ Tu cuenta no tiene permiso para editar el catálogo. Pide que te den de alta como editor.');
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

/* ---------- alta de cuenta con PIN del responsable ----------
   Toda la seguridad vive en la Edge Function `acceso`: aquí sólo se piden los
   datos y se muestra lo que responde. El PIN nunca pasa por este código — se lo
   manda por correo al responsable, que decide si se lo da al solicitante. */
const URL_ACCESO = (window.SUPA_CFG ? window.SUPA_CFG.URL : '') + '/functions/v1/acceso';

async function llamarAcceso(cuerpo){
  const r = await fetch(URL_ACCESO, {
    method:'POST',
    headers:{ apikey:window.SUPA_CFG.KEY, Authorization:'Bearer '+window.SUPA_CFG.KEY,
              'Content-Type':'application/json' },
    body: JSON.stringify(cuerpo),
  });
  let datos = {};
  try{ datos = await r.json(); }catch{}
  return { ok:r.ok, datos };
}

function altaEstado(txt, tipo){
  const n = $('#altaEstado'); if (!n) return;
  n.className = 'alta-estado' + (tipo ? ' '+tipo : '');
  n.innerHTML = txt || '';
}
function altaPaso(n){
  $('#altaPaso1').hidden = n !== 1;
  $('#altaPaso2').hidden = n !== 2;
  document.querySelectorAll('.alta-paso').forEach(p=>p.classList.toggle('on', +p.dataset.paso === n));
}
function abrirAltaCuenta(abrir){
  const caja = $('#altaCuenta'); if (!caja) return;
  caja.hidden = !abrir;
  $('#sbCrear').textContent = abrir ? '✕ Cancelar registro' : '＋ Crear mi cuenta';
  if (abrir){ altaPaso(1); altaEstado(''); $('#altaNombre').focus(); }
}

async function altaPedirPin(){
  const nombre = ($('#altaNombre').value||'').trim();
  const correo = ($('#altaCorreo').value||'').trim();
  if (!correo){ altaEstado('Escribe tu correo.', 'mal'); return; }
  const btn = $('#altaPedir'); btn.disabled = true; btn.textContent = 'Pidiendo…';
  altaEstado('Avisando al responsable…');
  const { ok, datos } = await llamarAcceso({ accion:'solicitar', correo, nombre });
  btn.disabled = false; btn.textContent = 'Pedir PIN al responsable';
  if (!ok){ altaEstado(esc(datos.error || 'No se pudo pedir el PIN.'), 'mal'); return; }

  altaPaso(2);
  $('#altaAviso').innerHTML = datos.enviado
    ? `Le mandamos un PIN de 6 números a <b>${esc(datos.destino)}</b>. Pídeselo y escríbelo aquí
       junto con la contraseña que quieras usar. Caduca en ${datos.minutos} minutos.`
    : `Tu solicitud quedó registrada, pero <b>el correo no se pudo enviar</b>. Pídele el PIN
       directamente al responsable: puede verlo en el clasificador, en «Sucursales y textos».`;
  altaEstado(datos.enviado ? '' : esc(datos.aviso||''), datos.enviado ? '' : 'ojo');
  $('#altaPin').focus();
}

async function altaCrearCuenta(){
  const correo = ($('#altaCorreo').value||'').trim();
  const nombre = ($('#altaNombre').value||'').trim();
  const pin = ($('#altaPin').value||'').trim();
  const p1 = $('#altaPass').value||'', p2 = $('#altaPass2').value||'';
  if (!/^\d{6}$/.test(pin)){ altaEstado('El PIN son 6 números.', 'mal'); return; }
  if (p1.length < 8){ altaEstado('La contraseña necesita al menos 8 caracteres.', 'mal'); return; }
  if (p1 !== p2){ altaEstado('Las dos contraseñas no coinciden.', 'mal'); return; }

  const btn = $('#altaCrear'); btn.disabled = true; btn.textContent = 'Creando…';
  altaEstado('Comprobando el PIN…');
  const { ok, datos } = await llamarAcceso({ accion:'registrar', correo, pin, password:p1, nombre });
  btn.disabled = false; btn.textContent = 'Crear mi cuenta';
  if (!ok){ altaEstado(esc(datos.error || 'No se pudo crear la cuenta.'), 'mal'); return; }

  altaEstado('✓ Cuenta creada. Entrando…', 'bien');
  // Entrar solo: quien acaba de registrarse no debería tener que escribirlo todo otra vez.
  const { error } = await SBC.auth.signInWithPassword({ email:correo, password:p1 });
  $('#altaPin').value=''; $('#altaPass').value=''; $('#altaPass2').value='';
  if (error){
    altaEstado('✓ Cuenta creada. Ahora inicia sesión con tu correo y contraseña.', 'bien');
    return;
  }
  abrirAltaCuenta(false);
  aviso('✓ Bienvenido: tu cuenta quedó lista y ya puedes trabajar.');
}

function renderSbEstado(){
  const head = $('#sbTxt'), full = $('#sbEstadoTxt');
  const loginRow = $('#sbLoginRow'), sessRow = $('#sbSessionRow');
  // Las bajas no viven en SB_DIRTY (su producto ya no está en PRODUCTOS), pero
  // siguen siendo trabajo por subir: cuentan como pendientes.
  // Los códigos corregidos también cuentan como pendientes: si no, el indicador
  // diría "todo al día" con un renombrado sin subir.
  const pend = SB_DIRTY.size + bajasPendientes().length + renombresPendientes().length;
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
      /* Con sesión pero sin permiso, decirlo fuerte: si no, la persona trabaja
         horas creyendo que guarda y su trabajo se queda en su navegador. */
      if (SB.puedeEditar === false){
        h = '<b style="color:var(--oxido)">⚠ Sin permiso para editar</b>'
            + (SB.user?.email?' · '+esc(SB.user.email):'');
        f = `Entraste como <b>${esc(SB.user?.email||'')}</b>, pero esa cuenta <b>no está autorizada</b> `
          + `para editar el catálogo, así que <b>nada de lo que hagas se guardará para los demás</b>. `
          + `Pide que agreguen tu correo a la lista de editores.`;
        break;
      }
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

/* ---------- traer cambios del equipo (pull desde Supabase) ----------
   El clasificador sólo SUBE cambios (push). Para VER lo que otra persona
   reclasificó desde su propia máquina hay que BAJAR el estado vigente en línea.
   Esto relee la vista pública `catalogo_publico` (lectura anónima permitida, no
   requiere sesión) y la vuelca sobre la base en memoria (DATA.productos). Tus
   propios cambios locales siguen mandando encima —se reaplican como deltas—, así
   que un pull nunca pisa lo que TÚ acabas de clasificar; sólo trae lo del resto. */
const LS_AUTOPULL = 'ap_clasif_autopull';
let AUTO_PULL = localStorage.getItem(LS_AUTOPULL) !== '0';   // por defecto activo
const PULL = { estado: SBC ? 'idle' : 'nosoporte', ultimo:null };
let PULL_T = null;

/* Con sesión leemos la tabla base `productos` (RLS la permite a `authenticated`):
   trae el proveedor REAL de todos. Sin sesión sólo hay vista pública, que
   enmascara el proveedor de los productos con el interruptor apagado — por eso
   en ese caso el proveedor se marca como "no confiable" y no se sobrescribe. */
async function descargarClasificacionSB(){
  const conSesion = !!SB.user;
  const tabla  = conSesion ? 'productos' : 'catalogo_publico';
  const campos = 'id,codigo,categoria,subcategoria,sub2,medidas,descripcion,foto,etiquetas,proveedor,mostrar_proveedor';
  const filas = [];
  const pageSize = 1000;
  for (let page=0;;page++){
    const { data, error } = await SBC.from(tabla).select(campos)
      .range(page*pageSize, (page+1)*pageSize-1);
    if (error) throw error;
    if (!data || !data.length) break;
    filas.push(...data);
    if (data.length < pageSize) break;
  }
  return { filas, provConfiable: conSesion };
}

async function traerCambiosSupabase(origen){
  if (!SBC){ if (origen!=='auto') aviso('⚠ Sincronización en línea no disponible en este navegador.'); return 0; }
  if (PULL.estado==='cargando') return 0;
  PULL.estado='cargando'; renderPullEstado();
  let filas, provConfiable;
  try{ ({ filas, provConfiable } = await descargarClasificacionSB()); }
  catch(e){
    PULL.estado='error'; renderPullEstado();
    if (origen!=='auto') aviso('⚠ No se pudo traer del equipo: '+(e.message||e.name));
    return 0;
  }
  const mapa = new Map(filas.map(r=>[r.codigo, r]));
  let cambios = 0;

  /* Altas del equipo: códigos que existen en línea y no en la base local. Sin
     ellas, un producto capturado por otra persona sería invisible aquí. */
  const conocidos = new Set(DATA.productos.map(p=>p.cod));
  for (const r of filas){
    if (conocidos.has(r.codigo)) continue;
    const id = r.id || idDesdeCodigo(r.codigo);
    if (WORK.borrados[id]) continue;                 // lo borraste tú, no lo revivas
    DATA.productos.push({
      id, cod:r.codigo, nom:r.descripcion||'', cat:r.categoria||POR,
      sub:r.subcategoria||r.categoria||POR, sub2:r.sub2||'', med:r.medidas||'',
      prov: provConfiable ? (r.proveedor||'') : '', mprov: !!r.mostrar_proveedor,
      foto:r.foto||'', etq: Array.isArray(r.etiquetas)?r.etiquetas:[],
    });
    // Si lo capturaste tú y ya volvió por el pull, deja de estar "pendiente de alta".
    if (WORK.nuevos[id]) delete WORK.nuevos[id];
    cambios++;
  }

  /* Bajas del equipo: sólo con sesión, porque sin ella leemos la vista pública,
     que ya esconde los descontinuados — y confundir "oculto" con "borrado"
     eliminaría de tu copia productos que siguen existiendo. (`provConfiable` es
     precisamente "leímos la tabla completa con sesión".) */
  if (provConfiable){
    const antes = DATA.productos.length;
    DATA.productos = DATA.productos.filter(p => mapa.has(p.cod) || WORK.nuevos[p.id]);
    cambios += antes - DATA.productos.length;
  }

  for (const p of DATA.productos){
    const r = mapa.get(p.cod); if (!r) continue;
    const cat = r.categoria || '', sub = r.subcategoria || '', sub2 = r.sub2 || '';
    const med = r.medidas || '', nom = r.descripcion || p.nom;
    const etq = Array.isArray(r.etiquetas) ? r.etiquetas : [];
    const foto = (r.foto && r.foto!==p.foto) ? r.foto : p.foto;   // sólo pisa la foto si en línea hay una
    // Sin sesión el proveedor llega enmascarado (NULL): se conserva el local.
    const prov  = provConfiable ? (r.proveedor || '') : p.prov;
    const mprov = !!r.mostrar_proveedor;
    if (p.cat===cat && p.sub===sub && (p.sub2||'')===sub2 && (p.med||'')===med && p.nom===nom &&
        foto===p.foto && p.prov===prov && p.mprov===mprov &&
        JSON.stringify(etq)===JSON.stringify(p.etq||[])) continue;
    p.cat=cat; p.sub=sub; p.sub2=sub2; p.med=med; p.nom=nom;
    p.foto=foto; p.etq=etq; p.prov=prov; p.mprov=mprov; cambios++;
  }
  PULL.estado='ok'; PULL.ultimo=new Date(); renderPullEstado();

  /* Las categorías que otro creó entran al árbol. Va FUERA del `if (cambios)`
     a propósito: un avance viejo puede tener los productos ya al día y aun así
     no conocer la categoría (le pasó a "Placa"), y en ese caso `cambios` es 0 y
     nunca se arreglaría solo. Es idempotente, así que repetirlo no cuesta. */
  const catsNuevas = registrarCatsDeLaBase();
  if (catsNuevas) bitacora(`${fmt(catsNuevas)} categoría(s) del equipo agregadas al árbol`);

  if (cambios){
    // La base en memoria ahora ES el estado vigente en línea: realinea el rastreo
    // de "sucios" (para no re-subir lo que ya está) y reaplica tus deltas encima.
    SB_BASE.clear();
    for (const p of DATA.productos) SB_BASE.set(p.cod, sbClave(p));
  }
  if (cambios || catsNuevas){
    construirProductos(); calcularSugerencias(); persistir(); renderAll();
  }
  if (cambios){
    aviso('⟲ '+fmt(cambios)+' producto(s) actualizados desde el equipo'+(origen==='auto'?' (auto)':'')
      + (catsNuevas?` · ${fmt(catsNuevas)} categoría(s) nueva(s)`:''));
  } else if (catsNuevas){
    aviso('⟲ '+fmt(catsNuevas)+' categoría(s) del equipo agregadas al árbol');
  } else if (origen!=='auto'){
    aviso('Ya estás al día: sin cambios nuevos del equipo.');
  }
  return cambios;
}

function renderPullEstado(){
  const b = $('#btnPull'), h = $('#pullTxt'), c = $('#pullAuto');
  if (c) c.checked = AUTO_PULL;
  if (b){
    b.disabled = !SBC || PULL.estado==='cargando';
    b.textContent = PULL.estado==='cargando' ? '⟲ Trayendo…' : '⟲ Traer del equipo';
  }
  if (!h) return;
  if (!SBC){ h.textContent = 'Traer del equipo: no disponible aquí.'; return; }
  const hora = PULL.ultimo ? PULL.ultimo.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}) : '—';
  const modo = RT.estado==='on' ? '● en vivo' : (AUTO_PULL ? 'se actualiza solo' : 'manual');
  h.textContent = `Equipo: ${modo} · última ${hora}`;
}

/* ---------- tiempo real (Supabase Realtime) ----------
   El pull por reloj tarda hasta 45 s y se auto-bloquea mientras trabajas. Con
   Realtime, Postgres empuja cada UPDATE en cuanto ocurre. Requiere sesión: RLS
   deja leer `productos` solo a `authenticated`, así que sin login no llegan
   eventos y el pull por reloj sigue siendo el respaldo.

   Los cambios se acumulan en un búfer y se aplican juntos cada 500 ms: al
   reclasificar 200 productos de golpe llegan 200 eventos y no queremos 200
   redibujados. El eco de nuestra propia escritura se descarta por updated_by. */
const RT = { estado: 'off', canal: null, ultimo: null };   // off | conectando | on | error
const RT_BUF = new Map();
let RT_T = null;

function iniciarRealtime(){
  if (!SBC || RT.canal) return;
  RT.estado = 'conectando'; renderPullEstado();
  RT.canal = SBC
    .channel('clasificador-productos')
    /* `*` y no sólo UPDATE: desde que el clasificador da de alta y de baja
       productos, un compañero puede CREAR o BORRAR uno. Con sólo UPDATE, esos
       dos casos esperaban al pull de reloj — que con Realtime conectado se
       espacia a 5 minutos, así que un producto nuevo tardaba eso en aparecer. */
    .on('postgres_changes', { event: '*', schema: 'public', table: 'productos' }, (payload) => {
      const borrado = payload.eventType === 'DELETE';
      const r = borrado ? payload.old : payload.new;
      if (!r || !r.codigo) return;
      // Eco de lo que acabamos de escribir nosotros.
      if (!borrado && r.updated_by === SB_YO) return;
      RT_BUF.set(r.codigo, { fila: r, borrado });
      clearTimeout(RT_T);
      RT_T = setTimeout(aplicarCambiosRealtime, 500);
    })
    .subscribe((st) => {
      RT.estado = st === 'SUBSCRIBED' ? 'on'
                : (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') ? 'error' : 'conectando';
      renderPullEstado();
    });
}

function pararRealtime(){
  if (!RT.canal) return;
  try { SBC.removeChannel(RT.canal); } catch {}
  RT.canal = null; RT.estado = 'off'; RT_BUF.clear();
  renderPullEstado();
}

/* Vuelca el búfer sobre la base en memoria. Igual que el pull: se toca DATA
   (la base) y luego construirProductos() reaplica TUS deltas encima, así que
   un cambio del equipo nunca pisa lo que tú tienes sin guardar. */
function aplicarCambiosRealtime(){
  if (!RT_BUF.size) return;
  // Si estás en medio de algo, espera: no le movemos el piso a nadie.
  if (!puedePullAuto()){ RT_T = setTimeout(aplicarCambiosRealtime, 1500); return; }

  const porCod = new Map(DATA.productos.map(p => [p.cod, p]));
  let cambios = 0, altas = 0, bajas = 0;
  for (const [cod, ev] of RT_BUF){
    const r = ev.fila;

    if (ev.borrado){                       // alguien lo eliminó desde su máquina
      const p = porCod.get(cod); if (!p) continue;
      /* En un DELETE, `updated_by` trae el del último que EDITÓ la fila, no el
         que la borró: no sirve para reconocer el eco de nuestra propia baja. Se
         reconoce por nuestra lista de bajas, y hay que respetarla — si además
         quitáramos la fila de DATA.productos, el "Deshacer" de esa baja se
         quedaría sin respaldo y el producto no volvería nunca.
         La comprobación va AQUÍ y no al recibir el evento: entre una cosa y
         otra pasan ~500 ms, y en ese rato la baja pudo deshacerse. */
      if (Object.values(WORK.borrados).some(b => b && b.cod === cod)) continue;
      DATA.productos = DATA.productos.filter(x => x.cod !== cod);
      SB_BASE.delete(cod); SB_DIRTY.delete(cod);
      state.sel.delete(p.id);
      bajas++; cambios++;
      continue;
    }

    let p = porCod.get(cod);
    if (!p){                               // alguien lo dio de alta desde su máquina
      const id = r.id || idDesdeCodigo(cod);
      if (WORK.borrados[id]) continue;     // lo borraste tú: no lo revivas
      p = { id, cod, nom:'', cat:POR, sub:POR, sub2:'', med:'', prov:'', mprov:false, foto:'', etq:[] };
      DATA.productos.push(p);
      porCod.set(cod, p);
      if (WORK.nuevos[id]) delete WORK.nuevos[id];   // ya está en la base
      altas++;
    }

    const cat = r.categoria || '', sub = r.subcategoria || '', sub2 = r.sub2 || '';
    const med = r.medidas || '', nom = r.descripcion || p.nom;
    const etq = Array.isArray(r.etiquetas) ? r.etiquetas : [];
    const foto = (r.foto && r.foto !== p.foto) ? r.foto : p.foto;
    const prov = SB.user ? (r.proveedor || '') : p.prov;
    const mprov = !!r.mostrar_proveedor;
    if (p.cat===cat && p.sub===sub && (p.sub2||'')===sub2 && (p.med||'')===med && p.nom===nom &&
        foto===p.foto && p.prov===prov && p.mprov===mprov &&
        JSON.stringify(etq)===JSON.stringify(p.etq||[])) continue;
    p.cat=cat; p.sub=sub; p.sub2=sub2; p.med=med; p.nom=nom;
    p.foto=foto; p.etq=etq; p.prov=prov; p.mprov=mprov;
    SB_BASE.set(cod, sbClave(p));    // ya es el estado vigente en línea: no re-subir
    cambios++;
  }
  RT_BUF.clear();
  RT.ultimo = new Date(); PULL.ultimo = RT.ultimo;
  if (!cambios){ renderPullEstado(); return; }
  registrarCatsDeLaBase();      // ver el comentario de la función: "Placa"
  construirProductos(); calcularSugerencias(); persistir(); renderAll();
  const detalle = [altas && fmt(altas)+' nuevo(s)', bajas && fmt(bajas)+' eliminado(s)']
    .filter(Boolean).join(', ');
  aviso('● '+fmt(cambios)+' producto(s) actualizados por el equipo'+(detalle?' ('+detalle+')':''));
}

/* ¿Es buen momento para un pull automático? No mientras trabajas una selección,
   subes cambios o tienes un modal abierto: no queremos moverte el piso. */
function puedePullAuto(){
  if (!AUTO_PULL || !SBC) return false;
  if (PULL.estado==='cargando' || SB.estado==='sync') return false;
  if (state.sel.size || PAINT.downId!==null) return false;
  // Incluye los modales de clasificador-plus.js: editar una agrupación es un
  // trabajo largo y un repintado a media edición perdería lo escrito.
  for (const id of ['#modal','#modalLog','#modalDatos','#modalFoto','#dlg','#modalFam','#modalPick']){
    const n = $(id);
    if (n && !n.hidden) return false;
  }
  const ae = document.activeElement;
  if (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return false;
  return true;
}
/* Con Realtime conectado esto es solo una red de seguridad (por si se cae la
   conexión y se pierde algún evento), así que basta con espaciarlo mucho. */
function programarPullAuto(){
  if (!SBC) return;
  clearTimeout(PULL_T);
  PULL_T = setTimeout(async ()=>{
    if (puedePullAuto()) await traerCambiosSupabase('auto');
    programarPullAuto();
  }, RT.estado==='on' ? 300000 : 45000);
}

/* ---------- productos efectivos (base + deltas) ----------
   Tres fuentes, en este orden:
     1. DATA.productos      — la base (archivo local, ya realineada por el pull)
     2. WORK.nuevos         — altas capturadas aquí que aún no están en la base
     3. ediciones/asignaciones/etiquetas — los deltas encima de cualquiera de las dos
   Y una resta: WORK.borrados, las bajas hechas desde el clasificador. */
let BMAP = new Map();
let PRODUCTOS = [], IDX = new Map(), TAXMAP = new Map();

const estaBorrado = (id) => !!WORK.borrados[id];
/* Registro "base" de un producto: la fila del archivo o, si nació aquí, su alta. */
function baseDe(id){ return BMAP.get(id) || null; }

function construirProductos(){
  // La base incluye las altas locales: desde aquí para abajo, un producto nuevo
  // se comporta EXACTAMENTE igual que uno del archivo (deltas, undo, export).
  BMAP = new Map();
  for (const p of DATA.productos) if (!estaBorrado(p.id)) BMAP.set(p.id, p);
  for (const n of Object.values(WORK.nuevos)) if (!estaBorrado(n.id) && !BMAP.has(n.id)) BMAP.set(n.id, n);

  PRODUCTOS = [...BMAP.values()].map(p=>{
    // sub2 ya viaja a Supabase, así que se respeta el de la base y los deltas
    // locales lo sobrescriben. (Antes se forzaba a '' porque solo existía aquí.)
    const q = Object.assign({}, p); q.sub2 = p.sub2 || '';
    const e = WORK.ediciones[p.id]; if (e) Object.assign(q, e);
    const a = WORK.asignaciones[p.id]; if (a){ q.cat=a.cat; q.sub=a.sub; q.sub2=a.sub2||''; }
    q.etq = WORK.etiquetas[p.id] ? WORK.etiquetas[p.id].slice()
          : (Array.isArray(p.etq) ? p.etq.slice() : []);
    q.nuevo = !!WORK.nuevos[p.id];
    /* Código corregido. Va DESPUÉS de las demás capas y no antes: el resto de
       los deltas se indexan por `id`, que nunca cambia — sólo cambia el código
       que ve la empresa. Así renombrar no pierde ni la categoría ni la foto. */
    const r = WORK.renombres[p.id];
    if (r && r.a){ q.codAnterior = r.de; q.cod = r.a; }
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

/* ---------- bitácora / deshacer ----------
   Guarda DOS MESES de cambios y quién hizo cada uno. Antes eran las últimas 400
   entradas sin autor: con dos personas trabajando a la vez, «¿quién movió esto?»
   no tenía respuesta, y 400 entradas se consumen en una tarde de reclasificar.

   El historial es COMPARTIDO: cada entrada se sube a la tabla `bitacora` de
   Supabase firmada con el correo de la sesión, y al abrir la bitácora se baja la
   del equipo entero. Un registro que sólo viviera en este navegador no podría
   responder "quién", porque cada quien vería nada más lo suyo.

   La copia local se conserva igual: es lo que se ve sin conexión, y es donde
   quedan los cambios hechos sin sesión — que no se suben porque no se pueden
   firmar (y que, por lo mismo, tampoco llegan al catálogo de nadie). */
function autorActual(){
  return (SB && SB.user && SB.user.email) ? SB.user.email : '';
}
function bitacora(txt){
  const e = { t:new Date().toISOString(), txt, por:autorActual() };
  WORK.bitacora.push(e);
  podarBitacora();
  if (e.por) encolarBitacoraSB(e);
  return e;
}
/* Tira lo que pasó de dos meses. El tope por cantidad queda como red: recorta
   sólo si aun dentro de la ventana hay demasiadas entradas.

   Revisa TODAS las entradas en vez de cortar el principio del arreglo: la
   bitácora casi siempre está en orden, pero no siempre —un avance importado de
   otra máquina llega con sus propias fechas—, y una entrada vieja detrás de una
   reciente sobrevivía para siempre. Con 5,000 entradas como tope, recorrerlas
   no cuesta nada. Una fecha ilegible se conserva: preferimos una línea de más
   que borrar historial por un dato roto. */
function podarBitacora(){
  const corte = Date.now() - BITACORA_MS;
  const vivas = WORK.bitacora.filter(e=>{
    const t = Date.parse(e && e.t);
    return !Number.isFinite(t) || t >= corte;
  });
  if (vivas.length !== WORK.bitacora.length) WORK.bitacora = vivas;
  const b = WORK.bitacora;
  if (b.length>BITACORA_MAX) b.splice(0, b.length-BITACORA_MAX);
}

/* --- subida de la bitácora a Supabase ---
   Se manda en lotes cada pocos segundos, no una petición por línea: reclasificar
   una categoría entera genera decenas de entradas seguidas. Si falla, no se
   reintenta a lo bruto ni se avisa: la bitácora es un registro, no el trabajo, y
   ya quedó guardada localmente. */
const BIT_COLA = [];
let BIT_T = null, BIT_PURGADA = false;
function encolarBitacoraSB(e){
  // PERSIST=false es la autoprueba (?selftest=1): hace y deshace cambios de
  // mentira, y esos no tienen por qué ensuciar la bitácora de todo el equipo.
  if (!SBC || !PERSIST) return;
  BIT_COLA.push({ t:e.t, texto:String(e.txt).slice(0,400), por:e.por, origen:SB_YO });
  clearTimeout(BIT_T);
  BIT_T = setTimeout(subirBitacora, 4000);
}
async function subirBitacora(){
  if (!SBC || !SB.user || !BIT_COLA.length) return;
  const lote = BIT_COLA.splice(0, BIT_COLA.length);
  try{
    const { error } = await SBC.from('bitacora').insert(lote);
    if (error) throw error;
    // Una purga por sesión basta para que la tabla no crezca sin fin.
    if (!BIT_PURGADA){ BIT_PURGADA = true; SBC.rpc('purgar_bitacora').catch(()=>{}); }
  }catch(e){
    console.warn('[bitacora] no se pudo subir el lote:', e.message||e);
  }
}

/* Baja la bitácora del equipo y la funde con la de este navegador. La clave de
   deduplicación es "instante + texto": la misma entrada llega por los dos
   caminos (se guardó local y se subió), y no debe verse dos veces. */
async function bitacoraDelEquipo(){
  if (!SBC || !SB.user) return [];
  const desde = new Date(Date.now()-BITACORA_MS).toISOString();
  const { data, error } = await SBC.from('bitacora')
    .select('t,texto,por').gte('t', desde).order('t', { ascending:false }).limit(BITACORA_MAX);
  if (error){ console.warn('[bitacora] no se pudo leer la del equipo:', error.message); return []; }
  return (data||[]).map(r=>({ t:r.t, txt:r.texto, por:r.por||'' }));
}
function fundirBitacora(locales, remotas){
  const vistas = new Set(), out = [];
  for (const e of [...remotas, ...locales]){
    const k = Math.round(Date.parse(e.t)/1000) + '|' + e.txt;
    if (vistas.has(k)) continue;
    vistas.add(k); out.push(e);
  }
  return out.sort((a,b)=> Date.parse(b.t) - Date.parse(a.t));
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
  else if (a.tipo==='edicm'){
    for (const c of a.cambios){
      if (c.prev) WORK.ediciones[c.id]=c.prev; else delete WORK.ediciones[c.id];
    }
  }
  else if (a.tipo==='tax'){ WORK.taxonomia = a.tax; restaurarAsig(a.asig); }
  else if (a.tipo==='alta'){
    const n = WORK.nuevos[a.id];
    delete WORK.nuevos[a.id];
    // Si ya había subido a Supabase, deshacer el alta implica borrarlo allá.
    if (n && n.subido) WORK.borrados[a.id] = { id:a.id, cod:n.cod, nom:n.nom,
      cuando:new Date().toISOString(), enBase:true, nuevo:n, respaldo:null };
    delete WORK.ediciones[a.id]; delete WORK.asignaciones[a.id]; delete WORK.etiquetas[a.id];
  }
  else if (a.tipo==='codigo'){
    if (a.prev) WORK.renombres[a.id] = a.prev; else delete WORK.renombres[a.id];
    // Si era un alta que aún no subía, el código vive en el propio registro.
    if (a.prevCodNuevo && WORK.nuevos[a.id]) WORK.nuevos[a.id].cod = a.prevCodNuevo;
  }
  else if (a.tipo==='baja'){
    const b = WORK.borrados[a.id];
    if (b && b.nuevo) WORK.nuevos[a.id] = b.nuevo;
    delete WORK.borrados[a.id];
    // Si la baja ya se había subido, el código salió de SB_BASE y volverá a
    // entrar como alta pendiente por sí solo (ver altasPendientes).
  }
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
  let pendientes=0, modificados=0, conSug=0, obsoletos=0, vivos=0;
  for (const p of PRODUCTOS){
    // La cuenta de cada marca es lo único que sí incluye a los obsoletos: es la
    // fila del árbol por la que se entra a verlos.
    for (const t of etqDe(p)) if (etq.has(t)) etq.set(t, etq.get(t)+1);
    /* Un obsoleto no cuenta en ningún otro lado: ni en el total de arriba, ni en
       su categoría, ni como pendiente. Para el catálogo ya no existe. */
    if (esObsoleto(p)){ obsoletos++; continue; }
    vivos++;
    if (WORK.asignaciones[p.id] || WORK.ediciones[p.id]) modificados++;
    if (sugVisible(p)) conSug++;
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
  return { cats, fantasmas, etq, pendientes, modificados, conSug, obsoletos,
    total:vivos, clasificados:vivos-pendientes };
}
let CNT = null;

/* ---------- filtro ----------
   Escribir en el buscador SALE de la categoría en la que quedó parado el
   usuario. Antes, teclear un código estando dentro de "Ferretería" no lo
   encontraba si el producto vivía en otra categoría, y la lista se quedaba
   vacía sin decir por qué. Ahora el término busca en todo el catálogo; el resto
   de los filtros (proveedor, estado, marca de gestión) se siguen respetando,
   porque ésos el usuario los eligió a propósito y no son "dónde estaba parado". */
function filtered(){
  /* Si el panel se quedó filtrando por una marca que ya no existe (se abrió
     antes de que se retiraran), la lista saldría vacía sin decir por qué. */
  if (state.etq && !ETQMAP.has(state.etq)) state.etq = null;
  const q = norm(state.q);
  const buscando = !!q;
  return PRODUCTOS.filter(p=>{
    /* Los obsoletos existen SÓLO dentro de su marca: fuera de ella no salen ni
       en "Todas las categorías", ni en su categoría real, ni al buscar. */
    if (esObsoleto(p) && state.etq!==ETQ_OCULTA) return false;
    if (state.etq && !tieneEtq(p, state.etq)) return false;
    if (!buscando){
      if (state.cat && p.cat!==state.cat) return false;
      if (state.sub!==null && state.sub!==undefined){
        const sub = p.sub && p.sub!==p.cat ? p.sub : '';
        if (sub!==state.sub) return false;
        if (state.sub2!==null && state.sub2!==undefined){
          if ((p.sub2||'')!==state.sub2) return false;
        }
      }
    }
    if (state.prov && p.prov!==state.prov) return false;
    if (state.estado==='pend' && p.cat!==POR) return false;
    if (state.estado==='sug' && !sugVisible(p)) return false;
    if (state.estado==='mod' && !WORK.asignaciones[p.id] && !WORK.ediciones[p.id]) return false;
    if (buscando){
      const hay = norm(p.nom)+' '+norm(p.cod)+' '+norm(p.cat)+' '+norm(p.sub)+' '+norm(p.sub2)+' '+norm(p.med)+' '+norm(p.prov);
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
/* ¿La lista de abajo está ignorando la categoría del árbol porque hay búsqueda?
   La cabecera de la lista lo dice en voz alta: si no, el usuario cree que su
   categoría contiene productos que en realidad están en otra. */
const buscandoEnTodo = () => !!norm(state.q) && !!(state.cat || state.sub);

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
function editarCampos(id, campos){ // campos = {nom?, med?, prov?, mprov?, foto?}
  const base = BMAP.get(id); if (!base) return false;
  const prev = WORK.ediciones[id] ? Object.assign({},WORK.ediciones[id]) : null;
  const entrada = Object.assign({}, prev||{});
  for (const f of ['nom','med','prov','mprov','foto']){
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

/* ---------- alta, duplicado y baja de productos ----------
   Todo lo que el encargado necesita para meter al catálogo un producto que la
   empresa acaba de empezar a vender, sin tocar una línea de código.

   El `id` es el nombre con el que se busca la foto en disco (fotos/<id>.webp),
   así que tiene que ser seguro como nombre de archivo: se deriva del código
   quitando lo que Windows no admite. Es la misma regla con la que se generaron
   los 3,222 ids del Excel original ("MEMM41/29510" → "MEMM41-29510"). */
function idDesdeCodigo(cod){
  const base = String(cod||'').trim()
    .replace(/["'`*?<>|:\\]/g,'')      // prohibidos en nombre de archivo
    .replace(/[\/\s]+/g,'-')           // la barra y los espacios pasan a guion
    .replace(/-+/g,'-').replace(/^-|-$/g,'');
  return base || 'PRODUCTO';
}
function idLibre(cod){
  let id = idDesdeCodigo(cod), i = 2;
  while (BMAP.has(id) || WORK.nuevos[id]) id = idDesdeCodigo(cod)+'-'+(i++);
  return id;
}
function buscarPorCodigo(cod){
  const c = norm(cod);
  return PRODUCTOS.find(p => norm(p.cod)===c) || null;
}

/* Formulario compartido por "Nuevo producto" y "Duplicar": los mismos campos,
   sólo cambian el título y los valores de arranque. */
async function formularioProducto(cfg){
  const modelo = cfg.modelo || {};
  const v = await dialogo({
    titulo: cfg.titulo,
    texto: cfg.texto,
    okTxt: cfg.okTxt || 'Crear producto',
    campos:[
      {id:'cod',  label:'Código (único, obligatorio)', tipo:'text', valor:modelo.cod||'', placeholder:'p. ej. SOL18X1'},
      {id:'nom',  label:'Nombre / descripción',        tipo:'text', valor:modelo.nom||'', placeholder:'p. ej. SOLERA 1/8 X 1"'},
      {id:'med',  label:'Medida',                      tipo:'text', valor:modelo.med||'', placeholder:'p. ej. 1/8 X 1"'},
      {id:'prov', label:'Proveedor (interno, no se publica)', tipo:'text', valor:modelo.prov||''},
      {id:'cat',  label:'Categoría',                   tipo:'select',
        opciones:[...WORK.taxonomia].sort(alfaN).map(c=>({v:c.nombre,t:c.nombre}))
          .concat([{v:POR, t:POR+' (decidir después)'}]),
        valor: modelo.cat || POR},
      {id:'subv', label:'Subcategoría',                tipo:'select', opciones:[{v:'',t:'(general)'}]},
      {id:'foto', label:'Foto del producto (opcional)', tipo:'foto',
        nota:'Puedes ponerla ahora o después, desde la ficha. Se recorta y se encuadra igual que siempre.'},
    ],
    alAbrir:(body)=>{
      const cs = body.querySelector('[data-campo="cat"]');
      const ss = body.querySelector('[data-campo="subv"]');
      let primera = true;
      const rellenar = ()=>{
        opcionesSub(ss, cs.value, primera ? (modelo.sub||null) : null, primera ? (modelo.sub2||'') : null);
        primera = false;
      };
      cs.onchange = rellenar; rellenar();
    },
  });
  if (!v) return null;

  const cod = (v.cod||'').trim();
  if (!cod){ aviso('⚠ El código es obligatorio: es lo que identifica al producto.'); return null; }
  const choque = buscarPorCodigo(cod);
  if (choque){ aviso(`⚠ El código «${cod}» ya lo usa «${choque.nom}». Usa otro.`); return null; }
  const nom = (v.nom||'').trim();
  if (!nom){ aviso('⚠ Escribe el nombre del producto: es lo que ve el cliente.'); return null; }

  const {sub, sub2} = parseSubVal(v.subv);
  const cat = v.cat || POR;
  // La foto no viaja en el formulario (es un Blob): se recoge aparte y se sube
  // DESPUÉS de crear el producto, que es cuando ya hay a qué asociarla.
  const foto = DLG_FOTO ? { blob:DLG_FOTO.blob, ext:DLG_FOTO.ext } : null;
  return { cod, nom, med:(v.med||'').trim(), prov:(v.prov||'').trim(),
           cat, sub: sub || cat, sub2: (cat===POR || !sub) ? '' : sub2, foto };
}

/* Da de alta el producto en el trabajo local. Sube solo a Supabase con la
   sincronización (o queda pendiente si aún no hay sesión). */
function crearProducto(datos, origen){
  const id = idLibre(datos.cod);
  WORK.nuevos[id] = {
    id, cod:datos.cod, nom:datos.nom, cat:datos.cat, sub:datos.sub, sub2:datos.sub2||'',
    med:datos.med||'', prov:datos.prov||'', mprov:false, foto:'', etq:[],
    creado:new Date().toISOString(), subido:false,
  };
  const label = `Producto nuevo: ${datos.cod} — ${datos.nom}`;
  pushUndo({tipo:'alta', label, id});
  bitacora(label + (origen?` (${origen})`:''));
  construirProductos();
  const p = IDX.get(id);
  if (p){ const s = calcularSugerencia(p); if (s) SUG.set(id, s); }
  persistir(); renderAll();
  aviso('✓ '+label);
  return id;
}

async function nuevoProducto(){
  const datos = await formularioProducto({
    titulo:'Nuevo producto',
    texto:'Se agrega al catálogo con este código. Si aún no sabes en qué categoría va, déjalo en POR CLASIFICAR: se puede mover cuando quieras.',
  });
  if (!datos) return;
  const id = crearProducto(datos, 'alta manual');
  if (datos.foto) await subirFoto(id, datos.foto.blob, datos.foto.ext);
  limpiarFotoDlg();
  abrirFicha(id);     // queda abierta para revisar o corregir lo capturado
}

/* Capturar una serie (una solera en 12 medidas) producto por producto sería
   inhumano: duplicar deja todo puesto y sólo hay que cambiar código y medida. */
async function duplicarProducto(id){
  const p = IDX.get(id); if (!p) return;
  const datos = await formularioProducto({
    titulo:'Duplicar producto',
    texto:`Se crea un producto nuevo copiando «${p.nom}». Cambia el código y la medida; lo demás ya viene puesto.`,
    okTxt:'Crear copia',
    modelo:{ cod:'', nom:p.nom, med:p.med, prov:p.prov, cat:p.cat, sub:p.sub, sub2:p.sub2 },
  });
  if (!datos) return;
  const nuevo = crearProducto(datos, 'duplicado de '+p.cod);
  if (datos.foto) await subirFoto(nuevo, datos.foto.blob, datos.foto.ext);
  limpiarFotoDlg();
  abrirFicha(nuevo);
}

/* Corregir un código mal capturado. Sólo para productos creados aquí: el código
   de los 3,222 originales es el que la empresa usa en el sistema de tienda y en
   los nombres de las fotos, así que cambiarlo desde el catálogo rompería el
   vínculo con todo lo demás. Por dentro es una baja + un alta, porque el código
   ES la identidad de la fila en Supabase. */
/* ---------- corregir el código de un producto ----------
   El código es el número con el que la empresa pide la pieza en el mostrador y
   en el sistema de la tienda. Antes sólo se podía cambiar en productos recién
   capturados aquí, y encima a lo bruto: se daba de baja el viejo y de alta uno
   nuevo, con lo que se perdía la foto. Para los 3,200 del catálogo no había
   forma — y sí hacía falta, porque una exportación de Excel dejó decenas con el
   código corrupto (números negativos en vez de "105/1").

   Ahora es un RENOMBRADO de verdad: cambia `codigo` y nada más. El `id` interno
   —del que cuelgan la foto, la categoría y el resto de los deltas— no se toca,
   así que el producto conserva absolutamente todo. En Supabase es un
   `update productos set codigo=… where id=…`, y las agrupaciones que lo
   mencionaban se reescriben solas (ver sincronizarRenombres). */
function codigoOriginalDe(id){
  const r = WORK.renombres[id];
  if (r) return r.de;                       // el que tenía antes del primer cambio
  const b = baseDe(id);
  return b ? b.cod : (IDX.get(id)||{}).cod;
}
async function cambiarCodigo(id){
  const p = IDX.get(id); if (!p) return;
  const nuevoLocal = WORK.nuevos[id] && !WORK.nuevos[id].subido;
  const v = await dialogo({ titulo:'Corregir el código',
    texto: nuevoLocal
      ? 'Este producto todavía no ha subido, así que basta con cambiarle el código.'
      : `Cambia el código con el que se pide «${p.nom}». Conserva su foto, su categoría, su medida y su lugar en las agrupaciones: sólo cambia el número. Asegúrate de que es el mismo que usa el sistema de la tienda.`,
    campos:[{id:'cod', label:'Código correcto', tipo:'text', valor:p.cod}], okTxt:'Cambiar código' });
  if (!v) return;
  const cod = (v.cod||'').trim();
  if (!cod){ aviso('⚠ El código no puede quedar vacío.'); return; }
  if (cod === p.cod) return;
  const choque = buscarPorCodigo(cod);
  if (choque && choque.id !== id){ aviso(`⚠ El código «${cod}» ya lo usa «${choque.nom}». Usa otro.`); return; }

  const prev = WORK.renombres[id] ? Object.assign({}, WORK.renombres[id]) : null;
  const original = codigoOriginalDe(id);

  if (nuevoLocal){
    // Nunca llegó a la base: no hay nada que renombrar en línea, se corrige el alta.
    WORK.nuevos[id].cod = cod;
    if (original === cod) delete WORK.renombres[id];
    else WORK.renombres[id] = { de: original, a: cod, cuando: new Date().toISOString() };
  } else if (original === cod){
    // Volvió a su código original: deja de haber renombrado pendiente.
    delete WORK.renombres[id];
  } else {
    WORK.renombres[id] = { de: original, a: cod, cuando: new Date().toISOString() };
  }

  const label = `Código ${p.cod} → ${cod}${p.nom ? ' · '+p.nom : ''}`;
  pushUndo({ tipo:'codigo', label, id, prev, prevCodNuevo: nuevoLocal ? p.cod : null });
  bitacora(label);
  construirProductos(); persistir(); renderAll();
  aviso('✓ '+label + (nuevoLocal ? '' : ' · se aplicará en línea al sincronizar'));
  if (IDX.has(id)) abrirFicha(id);
}

/* Renombrados que todavía no están en Supabase. Se comparan contra SB_BASE, que
   es lo que damos por escrito allá: si el código nuevo ya está ahí, ya subió. */
function renombresPendientes(){
  const out = [];
  for (const [id, r] of Object.entries(WORK.renombres)){
    if (!r || !r.a || r.a === r.de) continue;
    if (WORK.nuevos[id] && !WORK.nuevos[id].subido) continue;   // sube como alta, no como renombrado
    if (WORK.borrados[id]) continue;
    if (SB_BASE.has(r.a) && !SB_BASE.has(r.de)) continue;       // ya aplicado en línea
    out.push({ id, de:r.de, a:r.a });
  }
  return out;
}

/* Retirar ≠ eliminar. Lo normal es retirar: el producto sale del catálogo del
   cliente pero sigue aquí, con su historia y su foto, y se puede devolver.

   Retirar pone la MARCA «Productos obsoletos», no mueve el producto a una
   categoría de retiro. Antes hacía lo segundo, y tenía dos problemas: el
   producto perdía la categoría que tanto costó decidirle, y devolverlo obligaba
   a acordarse de cuál era. Con la marca, la clasificación se queda intacta y
   volver es quitar una palomita. Los 13 que estaban en la categoría vieja se
   migraron a la marca el 2026-08-04. */
async function retirarProducto(id){
  const p = IDX.get(id); if (!p) return;
  if (esObsoleto(p)){
    aviso('Este producto ya está retirado del catálogo.');
    return;
  }
  const ok = await dialogo({ titulo:'Retirar del catálogo',
    texto:`«${p.nom}» dejará de verse en el catálogo de los clientes y no contará en el total de arriba, pero seguirá aquí —en «Productos obsoletos»— con su categoría, su foto y su historia. Para devolverlo basta con quitarle esa marca.`,
    okTxt:'Retirar del catálogo' });
  if (!ok) return;
  marcarEtiqueta([id], ETQ_OCULTA, true, 'retiro');
  cerrarFicha();
}

/* Borrado de verdad. Sólo para deshacer una captura equivocada: un producto
   real que ya no se vende se RETIRA, no se borra (así el histórico no miente). */
async function eliminarProducto(id){
  const p = IDX.get(id); if (!p) return;
  const esNuevo = !!WORK.nuevos[id];
  const ok = await dialogo({ titulo:'Eliminar producto',
    texto: esNuevo
      ? `Se borra «${p.nom}» (${p.cod}), que capturaste tú. Desaparece del catálogo y de la base. Reversible con Deshacer mientras no cierres.`
      : `«${p.nom}» (${p.cod}) viene del catálogo original. Borrarlo lo quita de la base para siempre. Si sólo dejó de venderse, usa "Retirar del catálogo": se esconde del cliente pero no se pierde.`,
    okTxt:'Eliminar definitivamente' });
  if (!ok) return;
  const base = baseDe(id);
  WORK.borrados[id] = {
    id, cod:p.cod, nom:p.nom, cuando:new Date().toISOString(),
    // Un alta que nunca se subió no existe en Supabase: no hay nada que borrar allá.
    enBase: !(esNuevo && !WORK.nuevos[id].subido),
    nuevo: esNuevo ? Object.assign({}, WORK.nuevos[id]) : null,
    respaldo: base ? Object.assign({}, base) : null,
  };
  if (esNuevo) delete WORK.nuevos[id];
  const label = `Producto eliminado: ${p.cod} — ${p.nom}`;
  pushUndo({tipo:'baja', label, id});
  bitacora(label);
  state.sel.delete(id);
  construirProductos(); persistir(); renderAll();
  cerrarFicha();
  aviso('✓ '+label);
}

/* ---------- proveedor: acciones en bloque ----------
   El proveedor viene del Excel maestro (columna A) y lo comparten muchos
   productos, así que corregir un nombre producto por producto sería inviable.
   Estas dos acciones operan sobre TODOS los que comparten el mismo proveedor. */

/* Aplica una edición de campo a varios productos en una sola operación deshacible. */
function editarCamposMultiple(ids, hazCampos, label){
  const cambios = [];
  for (const id of ids){
    const base = BMAP.get(id); if (!base) continue;
    const campos = hazCampos(IDX.get(id));
    if (!campos) continue;
    const prev = WORK.ediciones[id] ? Object.assign({},WORK.ediciones[id]) : null;
    const entrada = Object.assign({}, prev||{});
    for (const f of ['nom','med','prov','mprov','foto']){
      if (campos[f]===undefined) continue;
      if (campos[f]!==base[f]) entrada[f]=campos[f];
      else delete entrada[f];
    }
    if (JSON.stringify(entrada)===JSON.stringify(prev||{})) continue;
    cambios.push({ id, prev });
    if (Object.keys(entrada).length) WORK.ediciones[id]=entrada; else delete WORK.ediciones[id];
  }
  if (!cambios.length) return 0;
  pushUndo({tipo:'edicm', label, cambios});
  bitacora(label);
  construirProductos(); persistir(); renderAll();
  return cambios.length;
}

function productosDeProveedor(prov){
  return PRODUCTOS.filter(p => (p.prov||'') === (prov||''));
}

/* "Modificar para todos": renombra un proveedor en todos los productos que lo
   comparten. Sirve para corregir la captura del Excel (comas mal puestas,
   sufijos irregulares) sin tocar producto por producto. */
async function renombrarProveedorEnTodos(actual){
  const afectados = productosDeProveedor(actual);
  if (!afectados.length){ aviso('No hay productos con ese proveedor.'); return; }
  const v = await dialogo({
    titulo:'Modificar para todos',
    texto:`El nombre se cambiará en los ${fmt(afectados.length)} producto(s) que hoy tienen «${actual||'(sin proveedor)'}». Si escribes el nombre de otro proveedor existente, ambos quedan fusionados. Reversible con Deshacer.`,
    campos:[{id:'nombre', label:'Nuevo nombre del proveedor', tipo:'text', valor:actual}],
    okTxt:'Modificar para todos' });
  if (!v) return;
  const nuevo = (v.nombre||'').trim();
  if (nuevo === actual){ aviso('Sin cambios: es el mismo nombre.'); return; }
  const n = editarCamposMultiple(afectados.map(p=>p.id), ()=>({prov:nuevo}),
    `Proveedor «${actual}» → «${nuevo}» en ${fmt(afectados.length)} producto(s)`);
  aviso(n ? `✓ Proveedor actualizado en ${fmt(n)} producto(s)` : 'Sin cambios.');
}

/* "Mostrar en el Catálogo": interruptor de publicación del proveedor. Apagado,
   la vista `catalogo_publico` devuelve el proveedor como NULL y el cliente final
   no lo ve. Se aplica a todo el proveedor porque publicar sólo algunos productos
   de un mismo proveedor no tendría sentido comercial. */
async function alternarMostrarProveedor(prov, encender){
  const afectados = productosDeProveedor(prov);
  if (!afectados.length){ aviso('No hay productos con ese proveedor.'); return; }
  if (encender){
    const ok = await dialogo({ titulo:'Mostrar el proveedor al público',
      texto:`«${prov}» quedará VISIBLE en la ficha pública de sus ${fmt(afectados.length)} producto(s): cualquier visitante del catálogo podrá verlo. Recuerda que la Fase 1 del proyecto contemplaba no publicar proveedores. ¿Continuar?`,
      okTxt:'Sí, mostrar al público' });
    if (!ok) return;
  }
  const n = editarCamposMultiple(afectados.map(p=>p.id), ()=>({mprov:!!encender}),
    `Proveedor «${prov}» ${encender?'PUBLICADO':'ocultado'} en el catálogo (${fmt(afectados.length)} producto(s))`);
  aviso(n ? (encender ? `✓ Visible al público en ${fmt(n)} producto(s)` : `✓ Oculto al público en ${fmt(n)} producto(s)`)
          : 'Sin cambios.');
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
      // La marca que esconde se pinta aparte (rojo óxido): mover algo ahí lo saca
      // del catálogo, y eso no puede verse igual que "le falta la foto".
      cls:'etq'+(e.oculta?' etq-oculta':'')+(state.etq===e.id?' on':''),
      nombre:e.label, n:(c.etq.get(e.id)||0),
      title: e.ayuda || 'Marca de gestión: convive con la categoría real. Arrastra productos aquí para marcarlos.',
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
  pintarConteoLista(lista);
}
/* Cabecera de la lista. Dice cuántos hay y, cuando la búsqueda se salió de la
   categoría del árbol, lo dice con todas sus letras: el usuario dejó marcada
   "Ferretería" y está viendo resultados de otras categorías. */
function pintarConteoLista(lista){
  const c = $('#countTxt'); if (!c) return;
  let txt = `${fmt(lista.length)} productos`;
  if (state.sel.size) txt += ` · ${fmt(state.sel.size)} seleccionados`;
  if (buscandoEnTodo()) txt += ' · buscando en TODO el catálogo';
  else if (state.etq===ETQ_OCULTA) txt += ' · retirados del catálogo';
  c.textContent = txt;
  c.classList.toggle('cuenta-global', buscandoEnTodo());
}
function fila(p, idx){
  const seleccionado = state.sel.has(p.id);
  const mod = WORK.asignaciones[p.id] || WORK.ediciones[p.id];
  const row = el('div','row'+(seleccionado?' sel':'')+(p.cat===POR?' espend':(mod?' mod':''))+(p.nuevo?' nuevoprod':''));
  row.dataset.id = p.id;
  if (p.nuevo) row.title = 'Producto capturado desde el clasificador';
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
/* `alGuardar` permite reutilizar este editor para algo que no sea un producto
   (hoy: la foto de portada de una agrupación). Si viene, recibe el Blob ya
   recortado y decide qué hacer con él; si no, se sube al producto FED.id. */
const FED = { id:null, img:null, escala:1, dx:0, dy:0, rot:0, ratio:1, arrastre:null, alGuardar:null };
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
function abrirEditorFoto(id, file, alGuardar){
  if (!/^image\//.test(file.type||'')){ aviso('⚠ El archivo no es una imagen.'); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = ()=>{
    URL.revokeObjectURL(url);
    Object.assign(FED, {id, img, rot:0, ratio:1, dx:0, dy:0, arrastre:null, alGuardar:alGuardar||null});
    $('#modalFoto').hidden = false;
    fedChips(); fedAjustar('cubrir');
  };
  img.onerror = ()=>{ URL.revokeObjectURL(url); aviso('⚠ No se pudo leer la imagen.'); };
  img.src = url;
}
function cerrarEditorFoto(){ $('#modalFoto').hidden = true; FED.img=null; FED.id=null; FED.alGuardar=null; }

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
  const ext = fmt==='jpeg' ? 'jpg' : fmt;
  const ok = !blob ? false
    : (FED.alGuardar ? await FED.alGuardar(blob, ext) : await subirFoto(FED.id, blob, ext));
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
// Etiqueta de clasificación para la tarjeta (Vista catálogo): SIEMPRE visible.
// Subcategoría si aporta detalle; si no, la categoría; y si sigue pendiente,
// se marca "Por clasificar" en vez de dejar la tarjeta sin clasificación.
function clasifTag(p){
  if (p.sub && p.sub!==POR && p.sub!==p.cat) return { txt:p.sub, pend:false };
  if (p.cat && p.cat!==POR) return { txt:p.cat, pend:false };
  return { txt:'Por clasificar', pend:true };
}
function pcard(p){
  const c = el('div','pcard');
  c.appendChild(thumbEl(p));
  const body = el('div','pcard-body');
  body.appendChild(el('div','pcard-name', esc(p.nom)));
  const meta = el('div','pcard-meta');
  const cl = clasifTag(p);
  meta.appendChild(el('span','tag '+(cl.pend?'pend':'sub'), esc(cl.txt)));
  if (p.sub2) meta.appendChild(el('span','tag sub', esc(p.sub2)));
  if (p.med) meta.appendChild(el('span','med-box','<i>Medida</i><b>'+esc(p.med)+'</b>'));
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
  pintarConteoLista(lista);
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
    <div class="modal-cat">${esc(rutaTxt(p.cat, p.sub, p.sub2))}${p.nuevo?'<span class="f-nuevo">NUEVO · capturado aquí</span>':''}</div>
    <div class="f-field"><label>Nombre / descripción</label><input id="fNom" value="${esc(p.nom)}" /></div>
    <div class="f-2col">
      <div class="f-field"><label>Código <button type="button" class="f-mini" id="fCodEdit" title="Corregir el código de este producto">✎ cambiar</button></label><input value="${esc(p.cod)}" readonly title="Pulsa «cambiar» para corregirlo. Conserva foto, categoría y agrupación." />${
        p.codAnterior ? `<div class="f-cod-antes">antes: <code>${esc(p.codAnterior)}</code> · se aplicará en línea al sincronizar</div>` : ''}</div>
      <div class="f-field"><label>Medidas</label><input id="fMed" value="${esc(p.med)}" /></div>
    </div>
    <div class="f-field"><label>Proveedor <span class="f-prov-n">· ${fmt(productosDeProveedor(p.prov).length)} producto(s) con este proveedor</span></label>
      <input id="fProvF" value="${esc(p.prov)}" />
      <div class="f-prov-acc">
        <button type="button" class="btn-datos" id="fProvTodos" title="Cambia el nombre de este proveedor en TODOS los productos que lo comparten (reversible con Deshacer)">✎ Modificar para todos</button>
        <button type="button" class="btn-datos${p.mprov?' on':''}" id="fProvMostrar" title="${p.mprov?'El cliente final VE este proveedor en la ficha pública. Clic para ocultarlo.':'Publica el proveedor en la ficha del catálogo público, para todos los productos que lo comparten.'}">${p.mprov?'👁 Visible en el catálogo':'🚫 Mostrar en el Catálogo'}</button>
      </div>
    </div>
    <div class="f-2col">
      <div class="f-field"><label>Categoría</label><select id="fCat"></select></div>
      <div class="f-field"><label>Sub / sub-sub</label><select id="fSub"></select></div>
    </div>
    <div class="f-field"><label>Marcas de gestión (se aplican al instante)</label>
      <div class="f-etq">${ETIQUETAS.map(e=>
        `<label class="f-etq-item${e.oculta?' f-etq-oculta':''}" title="${esc(e.ayuda||'')}"><input type="checkbox" data-etq="${e.id}"${tieneEtq(p,e.id)?' checked':''} /> ${esc(e.label)}</label>`
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
    <div class="f-acciones">
      <button type="button" class="btn-datos" id="fDuplicar" title="Crea otro producto copiando éste. Ideal para capturar la misma pieza en varias medidas.">⧉ Duplicar producto</button>
      <button type="button" class="btn-datos" id="fRetirar" title="${esObsoleto(p)?'Ya está retirado: quítale la marca «Productos obsoletos» de aquí abajo para devolverlo al catálogo.':'Deja de mostrarse al cliente y de contar en el total, pero conserva su categoría y se devuelve quitándole la marca.'}"${esObsoleto(p)?' disabled':''}>🚫 Retirar del catálogo</button>
      <button type="button" class="btn-datos btn-danger" id="fEliminar" title="Borra el producto de la base. Úsalo sólo para deshacer una captura equivocada.">🗑 Eliminar</button>
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

  $('#fDuplicar').onclick = ()=>duplicarProducto(p.id);
  $('#fRetirar').onclick  = ()=>retirarProducto(p.id);
  $('#fEliminar').onclick = ()=>eliminarProducto(p.id);
  const codEdit = $('#fCodEdit'); if (codEdit) codEdit.onclick = ()=>cambiarCodigo(p.id);

  // Acciones en bloque sobre el proveedor. Ambas parten del valor GUARDADO
  // (p.prov), no del texto sin guardar del input, para no mover a un grupo que
  // aún no existe. La ficha se repinta para reflejar el resultado.
  $('#fProvTodos').onclick = async ()=>{
    await renombrarProveedorEnTodos(p.prov);
    if (IDX.has(p.id)) abrirFicha(p.id);
  };
  $('#fProvMostrar').onclick = async ()=>{
    if (!p.prov){ aviso('Este producto no tiene proveedor que mostrar.'); return; }
    await alternarMostrarProveedor(p.prov, !p.mprov);
    if (IDX.has(p.id)) abrirFicha(p.id);
  };

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
/* Foto elegida dentro de un diálogo (campo `tipo:'foto'`). No puede viajar en el
   value de un input, así que vive aquí hasta que quien abrió el diálogo la use. */
let DLG_FOTO = null;   // {blob, ext, url}

function limpiarFotoDlg(){
  if (DLG_FOTO && DLG_FOTO.url) URL.revokeObjectURL(DLG_FOTO.url);
  DLG_FOTO = null;
}

/* Campo de foto: miniatura + botón que abre el MISMO editor de recorte de las
   fichas. El recorte se guarda aquí y lo sube quien haya abierto el diálogo
   (al dar de alta un producto, después de crearlo: antes no hay a qué asociarlo). */
function campoFotoDlg(c){
  const w = el('div','dlg-foto');
  w.appendChild(el('label',null,esc(c.label||'Foto')));
  const fila = el('div','dlg-foto-fila');
  const marco = el('div','dlg-foto-marco');
  const pintar = ()=>{
    marco.innerHTML = '';
    if (DLG_FOTO && DLG_FOTO.url){
      const img = new Image(); img.src = DLG_FOTO.url;
      marco.appendChild(img);
    } else {
      marco.innerHTML = '<span>Sin foto</span>';
    }
    btn.textContent = DLG_FOTO ? '🖼 Cambiar' : '🖼 Elegir imagen';
    quitar.hidden = !DLG_FOTO;
  };
  const acts = el('div','dlg-foto-acts');
  const btn = el('button','btn-datos',''); btn.type='button';
  btn.onclick = ()=>file.click();
  const quitar = el('button','fed-mini danger','Quitar'); quitar.type='button';
  quitar.onclick = ()=>{ limpiarFotoDlg(); pintar(); };
  const file = el('input'); file.type='file'; file.accept='image/*'; file.hidden=true;
  file.onchange = (e)=>{
    const f = e.target.files[0]; e.target.value='';
    if (!f) return;
    abrirEditorFoto('nuevo', f, (blob, ext)=>{
      limpiarFotoDlg();
      DLG_FOTO = { blob, ext, url: URL.createObjectURL(blob) };
      pintar();
      aviso('✓ Foto lista. Se subirá al crear el producto.');
      return true;
    });
  };
  acts.append(btn, quitar, file);
  acts.appendChild(el('small','dlg-foto-nota', esc(c.nota||'')));
  fila.append(marco, acts);
  w.appendChild(fila);
  pintar();
  return w;
}

function dialogo(cfg){
  return new Promise(resolve=>{
    DLG_RESOLVE = resolve;
    limpiarFotoDlg();
    $('#dlgTitle').textContent = cfg.titulo||'';
    const body = $('#dlgBody'); body.innerHTML='';
    if (cfg.texto) body.appendChild(el('p',null,esc(cfg.texto)));
    for (const c of (cfg.campos||[])){
      if (c.tipo==='foto'){ body.appendChild(campoFotoDlg(c)); continue; }
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
  // Al cancelar, la foto elegida se descarta con el resto; al aceptar, la
  // recoge formularioProducto() antes de que nadie más abra un diálogo.
  if (!valores) limpiarFotoDlg();
  if (DLG_RESOLVE){ const r=DLG_RESOLVE; DLG_RESOLVE=null; r(valores); }
}

/* ---------- bitácora (modal) ----------
   Dos meses de historial no se leen de corrido: se agrupa por día y se puede
   filtrar por texto o por persona. Cada entrada dice QUIÉN la hizo; las de antes
   de que se registrara el autor salen como «—», que es honesto: no lo sabemos. */
function nombreCorto(correo){
  if (!correo) return '';
  const i = correo.indexOf('@');
  return i>0 ? correo.slice(0,i) : correo;
}
function diaEtiqueta(d){
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const dd = new Date(d); dd.setHours(0,0,0,0);
  const dias = Math.round((hoy-dd)/86400000);
  const fecha = d.toLocaleDateString('es-MX',{weekday:'long', day:'2-digit', month:'long'});
  if (dias===0) return 'Hoy · '+fecha;
  if (dias===1) return 'Ayer · '+fecha;
  return fecha + (d.getFullYear()!==hoy.getFullYear() ? ' de '+d.getFullYear() : '');
}
let LOG_Q = '', LOG_POR = '', LOG_ITEMS = [];
function pintarLog(){
  const body = $('#logBody'); if (!body) return;
  body.innerHTML='';
  const q = norm(LOG_Q);
  const items = LOG_ITEMS.filter(it=>{
    if (LOG_POR && (it.por||'')!==LOG_POR) return false;
    if (q && !norm(it.txt+' '+(it.por||'')).includes(q)) return false;
    return true;
  });
  if (!LOG_ITEMS.length){
    body.appendChild(el('div','log-empty','Aún no hay cambios registrados.'));
  } else if (!items.length){
    body.appendChild(el('div','log-empty','Ningún cambio coincide con ese filtro.'));
  }
  let diaActual = '';
  for (const it of items){
    const d = new Date(it.t);
    const dia = diaEtiqueta(d);
    if (dia!==diaActual){ diaActual = dia; body.appendChild(el('div','log-dia', esc(dia))); }
    const hora = d.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'});
    const quien = it.por ? esc(nombreCorto(it.por)) : '—';
    const row = el('div','log-item',
      `<time title="${esc(d.toLocaleString('es-MX'))}">${hora}</time>` +
      `<span>${esc(it.txt)}</span>` +
      `<b class="log-por" title="${it.por?esc(it.por):'Cambio hecho sin sesión iniciada: no quedó registrado quién fue.'}">${quien}</b>`);
    body.appendChild(row);
  }
}
function pintarFiltrosLog(){
  const cab = $('#logFiltros'); if (!cab) return;
  const autores = [...new Set(LOG_ITEMS.map(it=>it.por).filter(Boolean))].sort(alfa);
  cab.innerHTML =
    `<input id="logQ" type="search" placeholder="Buscar en la bitácora…" value="${esc(LOG_Q)}" />` +
    `<select id="logPor"><option value="">Todas las personas</option>` +
    autores.map(a=>`<option value="${esc(a)}"${a===LOG_POR?' selected':''}>${esc(a)}</option>`).join('') +
    `</select>`;
  $('#logQ').oninput = (e)=>{ LOG_Q = e.target.value; pintarLog(); };
  $('#logPor').onchange = (e)=>{ LOG_POR = e.target.value; pintarLog(); };
}
function pintarPieLog(cargando){
  const pie = $('#logPie'); if (!pie) return;
  const base = `se guardan los últimos ${BITACORA_DIAS} días`;
  if (cargando){ pie.textContent = 'Trayendo la bitácora del equipo… · '+base; return; }
  pie.textContent = LOG_ITEMS.length
    ? `${fmt(LOG_ITEMS.length)} cambios · ${base}` +
      (SB.user ? ' · incluye lo que hizo el equipo' : ' · sólo esta computadora (inicia sesión para ver la del equipo)')
    : `Se guardan los últimos ${BITACORA_DIAS} días de cambios.`;
}
/* Abre primero con lo local —para que nunca se vea vacía mientras carga— y en
   cuanto llega la del equipo la refunde y vuelve a pintar. */
async function abrirLog(){
  podarBitacora();
  await subirBitacora();                 // que lo recién hecho salga en la lista
  LOG_ITEMS = fundirBitacora(WORK.bitacora, []);
  pintarFiltrosLog(); pintarLog(); pintarPieLog(!!SB.user);
  $('#modalLog').hidden=false;
  if (!SB.user) return;
  const remotas = await bitacoraDelEquipo();
  if ($('#modalLog').hidden) return;     // la cerró antes de que llegara
  LOG_ITEMS = fundirBitacora(WORK.bitacora, remotas);
  pintarFiltrosLog(); pintarLog(); pintarPieLog(false);
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
  const productos = PRODUCTOS.map(p=>({id:p.id,cod:p.cod,nom:p.nom,cat:p.cat,sub:p.sub,sub2:p.sub2||'',med:p.med,prov:p.prov,mprov:!!p.mprov,foto:p.foto||(p.id+'.webp'),etq:etqDe(p)}));
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
  const nAlta = Object.keys(WORK.nuevos).length, nBaja = Object.keys(WORK.borrados).length;
  $('#datosStats').innerHTML =
    `<b>${fmt(nA)}</b> asignaciones de categoría · <b>${fmt(nE)}</b> fichas editadas` +
    (nAlta?` · <b>${fmt(nAlta)}</b> producto(s) dados de alta aquí`:'') +
    (nBaja?` · <b>${fmt(nBaja)}</b> eliminado(s)`:'') +
    ` · bitácora con <b>${fmt(WORK.bitacora.length)}</b> entradas` +
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
  /* Enganche para clasificador-plus.js (agrupaciones, destacados, ajustes). Se
     carga DESPUÉS que este archivo, así que la primera vez todavía no existe:
     por eso se comprueba en cada render en vez de guardarse una referencia. */
  if (typeof plusAlRenderizar === 'function') plusAlRenderizar();
}

/* ---------- init ---------- */
function init(){
  /* Lo de MOTRAE, fuera de la vista del encargado salvo con ?dev=1. Va lo
     primero para que esos botones no lleguen ni a parpadear en pantalla. */
  if (MODO_DEV) document.querySelectorAll('.solo-dev').forEach(n=>{ n.hidden = false; });

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

  /* La barra de filtros se esconde al bajar entre los productos y reaparece en
     cuanto empiezas a subir. Nunca se esconde si estás escribiendo en ella
     (p. ej. tras pulsar "/") ni cuando aún no has pasado su sitio en la página. */
  (function barraAlDesplazar(){
    const barra = $('.toolbar'); if (!barra) return;
    const UMBRAL = 8;                    // ignora el temblor del trackpad
    let ultimo = window.scrollY, encolado = false;

    /* El anclaje NO puede salir de la propia barra: `offsetTop` de un elemento
       sticky devuelve su posición ya desplazada, así que crecería con el scroll
       y el umbral se cumpliría siempre. La cabecera de la lista va en flujo
       normal, de modo que su posición en el documento es fija. */
    const anclaje = ()=> $('#listhead')?.offsetTop ?? 140;

    function evaluar(){
      encolado = false;
      const y = Math.max(0, window.scrollY);
      const salto = y - ultimo;
      if (Math.abs(salto) < UMBRAL) return;
      ultimo = y;
      const escribiendo = barra.contains(document.activeElement);
      const subiendo = salto < 0;
      const arriba = y <= anclaje();
      barra.classList.toggle('oculta', !(subiendo || arriba || escribiendo));
    }

    addEventListener('scroll', ()=>{
      if (encolado) return;
      encolado = true; requestAnimationFrame(evaluar);
    }, {passive:true});

    // el foco la trae de vuelta: el atajo "/" no puede llevarte a un campo oculto
    barra.addEventListener('focusin', ()=>barra.classList.remove('oculta'));
  })();

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
  $('#btnNuevoProd').onclick = nuevoProducto;
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

  // Alta de cuenta con PIN del responsable
  $('#sbCrear').onclick = ()=>abrirAltaCuenta($('#altaCuenta').hidden);
  $('#altaPedir').onclick = altaPedirPin;
  $('#altaCrear').onclick = altaCrearCuenta;
  $('#altaVolver').onclick = ()=>{ altaPaso(1); altaEstado(''); };
  $('#altaCorreo')?.addEventListener('keydown', e=>{ if(e.key==='Enter') altaPedirPin(); });
  $('#altaPass2')?.addEventListener('keydown', e=>{ if(e.key==='Enter') altaCrearCuenta(); });
  // Sólo números en el PIN: evita que un espacio pegado desde WhatsApp lo rompa.
  $('#altaPin')?.addEventListener('input', e=>{ e.target.value = e.target.value.replace(/\D/g,'').slice(0,6); });

  initSb();

  // Traer cambios del equipo (pull desde Supabase)
  $('#btnPull').onclick = ()=>traerCambiosSupabase('manual');
  $('#pullAuto').onchange = (e)=>{
    AUTO_PULL = e.target.checked;
    localStorage.setItem(LS_AUTOPULL, AUTO_PULL?'1':'0');
    renderPullEstado();
    if (AUTO_PULL){ programarPullAuto(); traerCambiosSupabase('auto'); }
  };
  renderPullEstado();
  programarPullAuto();
  if (AUTO_PULL) setTimeout(()=>traerCambiosSupabase('auto'), 800);   // arranca al día con el equipo

  vigilarNuevas();   // devuelve el color original a las categorías al cumplir 48 h
  initEditorFoto();

  // Teclado
  document.addEventListener('keydown', e=>{
    const enInput = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName||'');
    if (e.key==='Escape'){
      // El editor de foto puede abrirse ENCIMA de un diálogo (al dar de alta un
      // producto con foto), así que se cierra él primero.
      if (!$('#modalFoto').hidden){ cerrarEditorFoto(); return; }
      if (!$('#dlg').hidden){ cerrarDlg(null); return; }
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
    /* Las categorías se toman de la taxonomía viva, no escritas a mano: los
       nombres cambian con el trabajo de clasificación (antes aquí decía
       "Herrajes" e "Izaje y maniobra", que ya no existen, y la prueba del 3er
       nivel llevaba tiempo en rojo por eso, tapando fallos de verdad). */
    const catsPrueba = WORK.taxonomia.map(c=>c.nombre).filter(n=>n!==CAT_OCULTA);
    const catA = catsPrueba[0], catB = catsPrueba[1] || catsPrueba[0];
    const p = PRODUCTOS[0];
    const antes = {cat:p.cat, sub:p.sub, sub2:p.sub2||''};
    const prevAsig = WORK.asignaciones[p.id] ? JSON.stringify(WORK.asignaciones[p.id]) : null;
    asignar([p.id], catB, catB, '', 'selftest');
    t('asignar aplica', IDX.get(p.id).cat===catB);
    undo();
    let q = IDX.get(p.id);
    let asigRest = WORK.asignaciones[p.id] ? JSON.stringify(WORK.asignaciones[p.id]) : null;
    t('undo restaura', q.cat===antes.cat && q.sub===antes.sub && asigRest===prevAsig);
    // 3er nivel: asignación con sub2 + autoregistro en taxonomía + undo
    asignar([p.id], catA, 'PRUEBA-SUB', 'PRUEBA-SUB2', 'selftest');
    q = IDX.get(p.id);
    const hj = buscarCat(catA), hp = hj && buscarSub(hj,'PRUEBA-SUB');
    t('sub2 aplica', q.sub2==='PRUEBA-SUB2' && !!hp && hp.subs.includes('PRUEBA-SUB2'));
    undo();
    q = IDX.get(p.id);
    asigRest = WORK.asignaciones[p.id] ? JSON.stringify(WORK.asignaciones[p.id]) : null;
    t('sub2 undo', q.cat===antes.cat && (q.sub2||'')===antes.sub2 && asigRest===prevAsig);
    const ex = construirExport();
    t('export total', ex.total===PRODUCTOS.length);
    t('export subs array', ex.categorias.every(c=>Array.isArray(c.subs) && c.subs.length>=1));
    t('export suma', ex.categorias.reduce((a,c)=>a+c.n,0)===ex.total);
    t('export campos', ['id','cod','nom','cat','sub','sub2','med','prov','mprov','foto'].every(f=>f in ex.productos[0]));

    // --- proveedor: acciones en bloque + interruptor de publicación ---
    const provPrueba = PRODUCTOS.find(x=>x.prov)?.prov || '';
    if (provPrueba){
      const grupo = productosDeProveedor(provPrueba);
      const nGrupo = grupo.length;
      const nuevoNom = provPrueba+' ·PRUEBA';
      const n1 = editarCamposMultiple(grupo.map(x=>x.id), ()=>({prov:nuevoNom}), 'selftest renombrar proveedor');
      t('proveedor renombra en bloque', n1===nGrupo && productosDeProveedor(nuevoNom).length===nGrupo);
      undo();
      t('proveedor renombra undo', productosDeProveedor(provPrueba).length===nGrupo
        && productosDeProveedor(nuevoNom).length===0);

      // El interruptor arranca apagado: nada se publica sin decisión explícita
      t('mostrar proveedor apagado por defecto', grupo.every(x=>!x.mprov));
      const n2 = editarCamposMultiple(productosDeProveedor(provPrueba).map(x=>x.id),
        ()=>({mprov:true}), 'selftest publicar proveedor');
      t('mostrar proveedor enciende', n2===nGrupo && productosDeProveedor(provPrueba).every(x=>x.mprov));
      t('mprov viaja al export', construirExport().productos.some(x=>x.mprov===true));
      undo();
      t('mostrar proveedor undo', productosDeProveedor(provPrueba).every(x=>!x.mprov));
    }
    /* Marcas retiradas del panel: ya no se pintan ni se pueden poner, pero el
       dato tiene que sobrevivir intacto — `sin-foto` alimenta el pipeline de
       fotos. Se comprueban las dos mitades, porque el fallo silencioso sería
       que la sincronización dejara de arrastrarlas y se perdieran solas. */
    t('las marcas retiradas ya no están en el panel',
      ETIQUETAS_RETIRADAS.every(x=>!ETQMAP.has(x)));
    t('sólo queda la marca de obsoletos',
      ETIQUETAS.length===1 && ETIQUETAS[0].id==='obsoleto');
    t('una marca retirada sobrevive en el producto', (()=>{
      const x = PRODUCTOS.find(y=>etqDe(y).includes('sin-foto'));
      return !x || etqKey(x).includes('sin-foto');     // etqKey es lo que se sube
    })());
    t('el conteo no inventa filas para las retiradas',
      ETIQUETAS_RETIRADAS.every(x=>!contar().etq.has(x)));
    // La clave de sync debe distinguir cada campo que se sube, o no viajaría.
    // Ojo: sbClave() devuelve un objeto {g,f}, así que hay que comparar sus
    // partes — con !== se compararían referencias y la prueba pasaría siempre.
    t('sbClave distingue proveedor', (()=>{
      const a = PRODUCTOS[0];
      const b = Object.assign({}, a, {prov:(a.prov||'')+'X'});
      const c = Object.assign({}, a, {mprov:!a.mprov});
      return sbClaveGrupo(a)!==sbClaveGrupo(b) && sbClaveGrupo(a)!==sbClaveGrupo(c);
    })());
    t('sbClave distingue sub2 y categoría', (()=>{
      const a = PRODUCTOS[0];
      const b = Object.assign({}, a, {sub2:(a.sub2||'')+'X'});
      const c = Object.assign({}, a, {cat:(a.cat||'')+'X'});
      return sbClaveGrupo(a)!==sbClaveGrupo(b) && sbClaveGrupo(a)!==sbClaveGrupo(c);
    })());
    // Medida y descripción son las que ANTES no se sincronizaban
    t('sbClave distingue medida y descripción', (()=>{
      const a = PRODUCTOS[0];
      const b = Object.assign({}, a, {med:(a.med||'')+'X'});
      const c = Object.assign({}, a, {nom:(a.nom||'')+'X'});
      return sbClaveFila(a)!==sbClaveFila(b) && sbClaveFila(a)!==sbClaveFila(c);
    })());
    // Un cambio de medida NO debe alterar la clave de grupo (si no, cada
    // producto sería su propio lote y el push masivo dejaría de agrupar)
    t('medida no rompe la agrupación', (()=>{
      const a = PRODUCTOS[0];
      const b = Object.assign({}, a, {med:(a.med||'')+'X'});
      return sbClaveGrupo(a)===sbClaveGrupo(b);
    })());
    t('construirProductos respeta sub2 de la base', (()=>{
      const p = DATA.productos.find(x=>x.sub2);
      if (!p) return true;                       // nada que comprobar
      if (WORK.asignaciones[p.id] || WORK.ediciones[p.id]) return true;   // hay delta local
      return (IDX.get(p.id)||{}).sub2 === p.sub2;
    })());
    const csv = construirCSV();
    const csvLineas = csv.trim().split('\r\n');
    t('csv filas', csvLineas.length===PRODUCTOS.length+1);
    t('csv encabezado', csvLineas[0].replace('﻿','')==='proveedor,codigo,descripcion,categoria,tipo,subtipo,medidas');
    t('csv bom', csv.charCodeAt(0)===0xFEFF);

    /* --- altas y bajas de producto (editor del encargado) --- */
    // El id es el nombre del archivo de la foto: tiene que sobrevivir a Windows.
    t('id desde código: barra', idDesdeCodigo('MEMM41/29510')==='MEMM41-29510');
    t('id desde código: comillas', idDesdeCodigo('MESMBYD4"')==='MESMBYD4');
    t('id desde código: nunca vacío', idDesdeCodigo('///')==='PRODUCTO');

    const totalAntes = PRODUCTOS.length;
    const codPrueba = '__SELFTEST__'+Date.now();
    const idNuevo = crearProducto({ cod:codPrueba, nom:'PRODUCTO DE PRUEBA', med:'1"',
      prov:'', cat:catA, sub:catA, sub2:'' }, 'selftest');
    const creado = IDX.get(idNuevo);
    t('alta aparece en el catálogo', !!creado && creado.cod===codPrueba && PRODUCTOS.length===totalAntes+1);
    t('alta se marca como nueva', !!creado && creado.nuevo===true);
    t('alta entra al export', construirExport().productos.some(x=>x.cod===codPrueba));
    // Sin fila en Supabase, un UPDATE no escribiría nada: tiene que ser INSERT.
    t('alta pendiente de subir', altasPendientes().some(x=>x.cod===codPrueba));
    // Y se puede editar y clasificar como cualquier otro producto.
    editarCampos(idNuevo, { med:'2"' });
    construirProductos();
    t('alta editable', (IDX.get(idNuevo)||{}).med==='2"');

    // Baja: se saca de la lista pero queda el respaldo para poder deshacerla.
    WORK.borrados[idNuevo] = { id:idNuevo, cod:codPrueba, nom:'PRODUCTO DE PRUEBA',
      cuando:new Date().toISOString(), enBase:false, nuevo:WORK.nuevos[idNuevo], respaldo:null };
    delete WORK.nuevos[idNuevo];
    construirProductos();
    t('baja saca el producto', !IDX.has(idNuevo) && PRODUCTOS.length===totalAntes);
    t('baja lo saca del export', !construirExport().productos.some(x=>x.cod===codPrueba));
    // Un código dado de baja no puede quedarse marcado como "pendiente de subir".
    t('baja no deja pendientes fantasma', !SB_DIRTY.has(codPrueba));

    // Deshacer la baja lo devuelve tal cual estaba.
    WORK.nuevos[idNuevo] = WORK.borrados[idNuevo].nuevo;
    delete WORK.borrados[idNuevo];
    construirProductos();
    t('baja reversible', (IDX.get(idNuevo)||{}).med==='2"');

    // Limpieza: la prueba no puede dejar basura en el trabajo real.
    delete WORK.nuevos[idNuevo]; delete WORK.borrados[idNuevo];
    delete WORK.ediciones[idNuevo]; delete WORK.asignaciones[idNuevo]; delete WORK.etiquetas[idNuevo];
    construirProductos();
    t('la prueba no deja rastro', PRODUCTOS.length===totalAntes && !IDX.has(idNuevo));

    /* --- marca «Productos obsoletos»: tiene que ESCONDER, no sólo etiquetar --- */
    t('existe la marca obsoleto', ETQ_OCULTA==='obsoleto' && ETQMAP.has('obsoleto'));
    const est = {q:state.q, cat:state.cat, sub:state.sub, sub2:state.sub2, etq:state.etq, prov:state.prov, estado:state.estado};
    const po = PRODUCTOS.find(x=>!esObsoleto(x));
    const prevEtqO = WORK.etiquetas[po.id] ? WORK.etiquetas[po.id].slice() : null;
    const cntAntes = contar();
    state.q=''; state.cat=null; state.sub=null; state.sub2=null; state.etq=null; state.prov=''; state.estado='todos';
    const visibleAntes = filtered().some(x=>x.id===po.id);
    WORK.etiquetas[po.id] = [...etqDe(po), 'obsoleto'];
    construirProductos();
    const cntDespues = contar();
    t('obsoleto sale de Todas las categorías', visibleAntes && !filtered().some(x=>x.id===po.id));
    t('obsoleto no cuenta en el total', cntDespues.total===cntAntes.total-1);
    t('obsoleto no cuenta en su categoría',
      (cntDespues.cats.get(po.cat)?.n ?? 0) === (cntAntes.cats.get(po.cat)?.n ?? 0) - (po.cat===POR?0:1));
    state.etq = 'obsoleto';
    t('obsoleto sí se ve en su marca', filtered().some(x=>x.id===po.id));
    t('la marca lo cuenta', (cntDespues.etq.get('obsoleto')||0) === (cntAntes.etq.get('obsoleto')||0)+1);
    state.etq = null; state.q = po.cod;
    t('obsoleto tampoco sale al buscar su código', !filtered().some(x=>x.id===po.id));
    if (prevEtqO) WORK.etiquetas[po.id] = prevEtqO; else delete WORK.etiquetas[po.id];
    construirProductos();

    /* --- buscar sale de la categoría donde quedó parado el usuario --- */
    const pb = PRODUCTOS.find(x=>x.cat && x.cat!==POR && !esObsoleto(x));
    const otraCat = WORK.taxonomia.map(c=>c.nombre).find(n=>n!==pb.cat && n!==CAT_OCULTA);
    state.q=''; state.cat=otraCat; state.sub=null; state.sub2=null; state.etq=null;
    t('sin buscar, la categoría manda', !filtered().some(x=>x.id===pb.id));
    state.q = pb.cod;
    t('buscando, aparece aunque esté en otra categoría', filtered().some(x=>x.id===pb.id));
    t('la cabecera avisa que se salió de la categoría', buscandoEnTodo()===true);
    state.prov = ' sin-proveedor-posible ';
    t('buscar no anula el filtro de proveedor', filtered().length===0);
    Object.assign(state, est);
    construirProductos();

    /* --- categorías que llegan de la base ("Placa") --- */
    const catInventada = 'PRUEBA-CAT-DE-LA-BASE';
    const pc = DATA.productos[0], catOrig = pc.cat, subOrig = pc.sub;
    pc.cat = catInventada; pc.sub = 'PRUEBA-SUB-BASE';
    t('categoría de la base no estaba en el árbol', !WORK.taxonomia.some(c=>c.nombre===catInventada));
    const nuevasCats = registrarCatsDeLaBase();
    t('registrarCatsDeLaBase la agrega', nuevasCats>=1 && WORK.taxonomia.some(c=>c.nombre===catInventada));
    t('y registra también su subcategoría',
      (WORK.taxonomia.find(c=>c.nombre===catInventada)?.subs||[]).some(s=>s.nombre==='PRUEBA-SUB-BASE'));
    t('repetirlo no duplica', registrarCatsDeLaBase()===0);
    pc.cat = catOrig; pc.sub = subOrig;
    construirProductos();

    /* --- bitácora: dos meses y autor --- */
    t('la bitácora guarda 60 días', BITACORA_DIAS===60);
    const bitAntes = WORK.bitacora.length;
    WORK.bitacora.push({ t:new Date(Date.now()-61*24*3600*1000).toISOString(), txt:'viejo', por:'x@y.z' });
    WORK.bitacora.push({ t:new Date(Date.now()-2*24*3600*1000).toISOString(), txt:'reciente', por:'x@y.z' });
    podarBitacora();
    t('poda lo de más de 60 días', !WORK.bitacora.some(b=>b.txt==='viejo'));
    t('conserva lo reciente', WORK.bitacora.some(b=>b.txt==='reciente'));
    WORK.bitacora.length = bitAntes;
    const fus = fundirBitacora(
      [{t:'2026-08-01T10:00:00.000Z', txt:'igual', por:''}],
      [{t:'2026-08-01T10:00:00.400Z', txt:'igual', por:'a@b.c'},
       {t:'2026-08-01T11:00:00.000Z', txt:'sólo del equipo', por:'a@b.c'}]);
    t('fundir no duplica la misma entrada', fus.filter(x=>x.txt==='igual').length===1);
    t('fundir conserva el autor del equipo', fus.find(x=>x.txt==='igual')?.por==='a@b.c');
    t('fundir ordena de lo nuevo a lo viejo', fus[0].txt==='sólo del equipo');

    /* --- corregir el código de cualquier producto --- */
    const pr = PRODUCTOS.find(x=>!WORK.nuevos[x.id] && !esObsoleto(x));
    const codOrig = pr.cod, codPrueba2 = 'PRUEBA-COD-'+Date.now();
    const fotoOrig = pr.foto, catDelRenombrado = pr.cat;
    const prevRen = WORK.renombres[pr.id] ? Object.assign({},WORK.renombres[pr.id]) : null;
    t('el código original se resuelve', codigoOriginalDe(pr.id)===codOrig);
    WORK.renombres[pr.id] = { de: codOrig, a: codPrueba2, cuando:new Date().toISOString() };
    construirProductos();
    const pr2 = IDX.get(pr.id);
    t('renombrar cambia el código', !!pr2 && pr2.cod===codPrueba2);
    t('renombrar NO cambia el id', !!pr2 && pr2.id===pr.id);
    t('renombrar conserva la foto', !!pr2 && pr2.foto===fotoOrig);
    t('renombrar conserva la categoría', !!pr2 && pr2.cat===catDelRenombrado);
    t('la ficha recuerda el código anterior', !!pr2 && pr2.codAnterior===codOrig);
    t('el renombrado queda pendiente de subir',
      renombresPendientes().some(r=>r.id===pr.id && r.de===codOrig && r.a===codPrueba2));
    t('se encuentra por su código nuevo', (buscarPorCodigo(codPrueba2)||{}).id===pr.id);
    // Volver al original tiene que borrar el pendiente, no dejar un renombrado a sí mismo.
    WORK.renombres[pr.id] = { de: codOrig, a: codOrig, cuando:new Date().toISOString() };
    t('volver al código original no deja pendiente', !renombresPendientes().some(r=>r.id===pr.id));
    if (prevRen) WORK.renombres[pr.id] = prevRen; else delete WORK.renombres[pr.id];
    construirProductos();
    t('deshacer el renombrado restaura el código', (IDX.get(pr.id)||{}).cod===codOrig);
    // (lo del correo del autorizador se comprueba en plusSelfTest: esas
    //  funciones viven en clasificador-plus.js, que se carga después de éste)
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
