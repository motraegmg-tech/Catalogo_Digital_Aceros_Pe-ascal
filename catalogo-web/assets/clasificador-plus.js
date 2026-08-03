/* ===== Aceros Peñascal · Clasificador · clasificador-plus.js =====
   Lo que antes había que pedirle a un programador y ahora se edita a mano:

     · AGRUPACIONES  — qué productos se muestran juntos en una sola tarjeta del
       catálogo y, sobre todo, CON QUÉ CRITERIO (por medida, por calibre, por
       función…). El criterio no es una etiqueta decorativa: decide el rótulo de
       la columna que el cliente ve al elegir dentro de la ficha.
     · DESTACADOS    — qué sale primero al abrir el catálogo, con la cuenta real
       de lo que la gente pide por WhatsApp al lado para decidir con datos.
     · SUCURSALES    — direcciones y WhatsApp, que vivían en core/config.js.
     · TEXTOS        — los rótulos del catálogo.
     · GUÍA          — cómo se usa todo esto, en la propia herramienta.

   Se carga DESPUÉS de clasificador.js y comparte su ámbito global: usa sus
   utilidades ($ , el, esc, norm, fmt, aviso, dialogo…) y sus datos (PRODUCTOS,
   WORK, state, SBC, SB). No duplica nada de eso.

   Fuente de verdad: Supabase (tablas `familias`, `ajustes`, `sucursales`).
   Leer es anónimo; ESCRIBIR exige haber iniciado sesión en Guardar / Exportar,
   igual que la reclasificación. */

/* ---------- estado ---------- */
const FAMS = new Map();          // id -> familia
const AJUSTES = new Map();       // clave -> valor (json)
let SUCS = [];                   // [{id?, clave, nombre, whatsapp, direccion, orden, activa}]
let POPU = [];                   // filas de productos_populares
let BUSQ = [];                   // filas de busquedas_populares
let DESTACADOS = [];             // [{t:'p'|'f', c:'código o id'}]

const PLUS = { panel:'productos', cargado:false, famQ:'', famCat:'', famCrit:'', popRango:'90' };

/* Criterios de agrupación de respaldo: si la tabla `ajustes` no responde, la
   herramienta tiene que seguir sirviendo. Son los mismos que siembra la
   migración; desde la pestaña "Sucursales y textos" se editan y se agregan. */
const CRITERIOS_BASE = [
  {id:'medida',  nombre:'Por medida',  columna:'Medida',  ayuda:'El mismo producto en varios tamaños: soleras, ángulos, tubería.'},
  {id:'calibre', nombre:'Por calibre', columna:'Calibre', ayuda:'Mismo producto en varios espesores: lámina, alambre.'},
  {id:'funcion', nombre:'Por función', columna:'Tipo',    ayuda:'Mismo tipo de producto para usos distintos: discos de corte, desbaste, diamante.'},
  {id:'modelo',  nombre:'Por modelo',  columna:'Modelo',  ayuda:'Una línea de producto con varios modelos: herramienta eléctrica.'},
];
const criterios = () => {
  const v = AJUSTES.get('criterios_agrupacion');
  return (Array.isArray(v) && v.length) ? v : CRITERIOS_BASE;
};
const criterioDe = (id) => criterios().find(c=>c.id===id) || criterios()[0] || CRITERIOS_BASE[0];
/* El rótulo que verá el cliente sobre la columna donde elige. La familia puede
   pisarlo (columna propia); si no, manda el criterio. */
const columnaDe = (f) => (f && f.columna) || criterioDe(f && f.criterio).columna || 'Medida';

const SIN_GRUPO = '—';           // subgrupo único de las agrupaciones simples

/* ---------- utilidades ---------- */
function porCodigo(){
  if (!porCodigo._v || porCodigo._n !== PRODUCTOS.length || porCodigo._t !== PRODUCTOS){
    porCodigo._v = new Map(PRODUCTOS.map(p=>[p.cod,p]));
    porCodigo._n = PRODUCTOS.length; porCodigo._t = PRODUCTOS;
  }
  return porCodigo._v;
}
const prodDe = (cod) => porCodigo().get(cod) || null;

function slug(s){
  // ̀-ͯ = los acentos que NFD separa de la letra. Escrito con escapes
  // para que no dependa de cómo se guarde este archivo.
  return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'grupo';
}
function idFamiliaLibre(cat, nombre){
  const base = `${slug(cat)}--${slug(nombre)}`;
  let id = base;
  for (let i=2; FAMS.has(id); i++) id = `${base}-${i}`;
  return id;
}
/* Todos los códigos de una familia, en el orden de sus subgrupos. */
function codsDe(f){
  return (f.subgrupos||[]).flatMap(g=>g.cods||[]);
}
function nProductosDe(f){
  return codsDe(f).filter(c=>prodDe(c)).length;
}
/* En qué categoría están DE VERDAD los productos de una agrupación, y cuántos.
   El catálogo muestra la ficha ahí, no en la categoría que diga el campo `cat`:
   ese campo lo elige una persona al crearla y se queda atrás en cuanto algo se
   reclasifica. Devuelve [{cat, n}…] de mayor a menor. */
function categoriasRealesDe(f){
  const cuenta = new Map();
  codsDe(f).forEach(cod=>{
    const p = prodDe(cod);
    if (p && p.cat) cuenta.set(p.cat, (cuenta.get(p.cat)||0)+1);
  });
  return [...cuenta.entries()].map(([cat,n])=>({cat,n}))
    .sort((a,b)=> b.n-a.n || alfa(a.cat,b.cat));
}
const catRealDe = (f) => (categoriasRealesDe(f)[0] || {}).cat || '';
/** ¿La categoría declarada miente respecto a dónde están sus productos? */
function catDescuadrada(f){
  const real = catRealDe(f);
  return real && real !== f.cat ? real : '';
}

/* Un producto no puede estar en dos agrupaciones: el catálogo no sabría en cuál
   mostrarlo. Devuelve la familia que ya lo tiene, si la hay. */
function familiaConCodigo(cod, exceptoId){
  for (const f of FAMS.values()){
    if (f.id===exceptoId) continue;
    if (codsDe(f).includes(cod)) return f;
  }
  return null;
}

function requiereSesion(accion){
  if (!SBC){ aviso('⚠ Sin conexión con la base: no se puede '+accion+'.'); return false; }
  if (!SB.user){ aviso('⚠ Inicia sesión (botón «Guardar / Exportar») para '+accion+'.'); return false; }
  // Estar autenticado no basta: hay que estar en la lista de editores.
  if (SB.puedeEditar === false){
    aviso('⚠ Tu cuenta no está autorizada para editar el catálogo. Pide que agreguen tu correo a la lista de editores.');
    return false;
  }
  return true;
}

/* ---------- pestañas ---------- */
const PANELES = { productos:'#panelProductos', familias:'#panelFamilias',
  destacados:'#panelDestacados', ajustes:'#panelAjustes', guia:'#panelGuia' };

function irAPanel(nombre){
  if (!PANELES[nombre]) nombre = 'productos';
  PLUS.panel = nombre;
  for (const [k, sel] of Object.entries(PANELES)){
    const n = $(sel); if (n) n.hidden = (k !== nombre);
  }
  // La barra de asignación y el progreso sólo tienen sentido clasificando.
  const enProd = nombre === 'productos';
  const bar = $('#selbar'); if (bar && !enProd) bar.hidden = true;
  const nota = $('.autosave-note'); if (nota) nota.hidden = false;
  document.querySelectorAll('#tabs .tab').forEach(b=>{
    const on = b.dataset.panel === nombre;
    b.classList.toggle('on', on); b.setAttribute('aria-selected', on?'true':'false');
  });
  if (enProd) renderSelbar();
  if (nombre === 'familias')   renderFamilias();
  if (nombre === 'destacados') renderDestacados();
  if (nombre === 'ajustes')    renderAjustes();
  if (nombre === 'guia')       renderGuia();
  window.scrollTo({top:0, behavior:'smooth'});
}

/* ---------- carga desde Supabase ---------- */
async function cargarEnLinea(silencioso){
  if (!SBC){ PLUS.cargado = true; return; }
  try{
    const [fam, aj, suc] = await Promise.all([
      SBC.from('familias').select('*'),
      SBC.from('ajustes').select('clave,valor'),
      SBC.from('sucursales').select('*').order('orden'),
    ]);
    if (!fam.error && fam.data){
      FAMS.clear();
      fam.data.forEach(f=>FAMS.set(f.id, normalizarFamilia(f)));
    }
    if (!aj.error && aj.data){
      AJUSTES.clear();
      aj.data.forEach(r=>AJUSTES.set(r.clave, r.valor));
      const d = AJUSTES.get('destacados');
      DESTACADOS = Array.isArray(d) ? d.filter(x=>x && x.c) : [];
    }
    if (!suc.error && suc.data) SUCS = suc.data.map(s=>Object.assign({}, s));
    PLUS.cargado = true;
    if (!silencioso) aviso(`✓ ${fmt(FAMS.size)} agrupaciones y ${fmt(SUCS.length)} sucursales cargadas`);
  }catch(e){
    PLUS.cargado = true;
    if (!silencioso) aviso('⚠ No se pudieron cargar las agrupaciones: '+(e.message||e.name));
  }
  if (PLUS.panel!=='productos') irAPanel(PLUS.panel);
}

/* ---------- trabajo en equipo: cambios en vivo ----------
   `productos` ya viajaba en vivo (Realtime, en clasificador.js). Las
   agrupaciones, los ajustes y las sucursales no: se leían UNA vez al abrir la
   página, así que dos personas a la vez no se veían entre sí y cada una
   guardaba encima de la copia vieja que tenía en memoria.

   Se tratan distinto a propósito:
     · AGRUPACIONES — objeto colaborativo, se refrescan solas.
     · AJUSTES y SUCURSALES — se editan como formulario y se publican a mano.
       Recargarlos solos borraría lo que la persona está escribiendo, así que
       sólo se avisa y ella decide cuándo traerlos. */
const RTP = { canal:null, estado:'off', t:null, avisadoConfig:false };

function iniciarRealtimePlus(){
  if (!SBC || RTP.canal || !SB.user) return;   // RLS: sin sesión no llegan eventos
  RTP.canal = SBC.channel('clasificador-config')
    .on('postgres_changes', { event:'*', schema:'public', table:'familias' },
        (p)=>alCambiarFamilia(p))
    .on('postgres_changes', { event:'*', schema:'public', table:'ajustes' },
        ()=>avisarConfigCambiada())
    .on('postgres_changes', { event:'*', schema:'public', table:'sucursales' },
        ()=>avisarConfigCambiada())
    .subscribe((st)=>{
      RTP.estado = st==='SUBSCRIBED' ? 'on'
                 : (st==='CHANNEL_ERROR' || st==='TIMED_OUT') ? 'error' : 'conectando';
    });
}
function pararRealtimePlus(){
  if (!RTP.canal) return;
  try{ SBC.removeChannel(RTP.canal); }catch{}
  RTP.canal = null; RTP.estado = 'off';
}

function alCambiarFamilia(payload){
  const fila = payload.eventType==='DELETE' ? payload.old : payload.new;
  if (!fila) return;
  if (fila.updated_by === SB_YO) return;              // eco de lo nuestro
  // Si justo estás editando ESA agrupación, avisar en vez de moverte el piso:
  // tu copia sigue intacta y al guardar mandará la tuya (el último que guarda gana).
  if (FAM_EDIT && FAM_EDIT.id === fila.id){
    aviso('⚠ Alguien más acaba de cambiar «'+(fila.nombre||fila.id)+'». Si guardas, tu versión reemplaza la suya.');
    return;
  }
  clearTimeout(RTP.t);
  RTP.t = setTimeout(refrescarFamiliasEnVivo, 600);
}

async function refrescarFamiliasEnVivo(){
  // Nunca a media edición: se reintenta hasta que se cierre el editor.
  if (!$('#modalFam').hidden || !$('#modalPick').hidden || !$('#dlg').hidden){
    RTP.t = setTimeout(refrescarFamiliasEnVivo, 2000);
    return;
  }
  try{
    const { data, error } = await SBC.from('familias').select('*');
    if (error || !Array.isArray(data)) return;
    FAMS.clear();
    data.forEach(f=>FAMS.set(f.id, normalizarFamilia(f)));
    if (PLUS.panel === 'familias') renderFamilias();
    if (PLUS.panel === 'destacados') renderDestacados();
    aviso('● Agrupaciones actualizadas por el equipo');
  }catch{}
}

/* Los ajustes NO se recargan solos: la persona puede tener medio formulario
   escrito sin publicar. Se avisa una vez y el botón «⟲ Traer del equipo» los trae. */
function avisarConfigCambiada(){
  if (RTP.avisadoConfig) return;
  RTP.avisadoConfig = true;
  setTimeout(()=>{ RTP.avisadoConfig = false; }, 60000);
  aviso('● Alguien cambió sucursales o ajustes · pulsa «⟲ Traer del equipo» para verlos');
}

/* Deja la familia con la forma que usa el editor, venga de donde venga. */
function normalizarFamilia(f){
  const subs = Array.isArray(f.subgrupos) ? f.subgrupos : [];
  return {
    id:f.id, nombre:f.nombre||'', cat:f.cat||'', sub:f.sub||'',
    criterio:f.criterio||'medida', columna:f.columna||'', descripcion:f.descripcion||'',
    foto: f.foto||'', activa: f.activa !== false, origen:f.origen||'',
    subgrupos: (subs.length ? subs : [{nombre:SIN_GRUPO, cods:[]}])
      .map(g=>({ nombre:g.nombre||SIN_GRUPO, cods:(g.cods||[]).slice() })),
  };
}

async function guardarFamilia(f, origen){
  if (!requiereSesion('guardar agrupaciones')) return false;
  const fila = {
    id:f.id, nombre:f.nombre, cat:f.cat, sub:f.sub||null,
    criterio:f.criterio, columna:f.columna||null, descripcion:f.descripcion||null,
    foto: f.foto || null,
    subgrupos:f.subgrupos, activa:!!f.activa, origen:f.origen||origen||'clasificador',
    updated_by: SB_YO,
  };
  const { error } = await SBC.from('familias').upsert(fila, { onConflict:'id' });
  if (error){ aviso('⚠ No se pudo guardar: '+error.message); return false; }
  FAMS.set(f.id, normalizarFamilia(fila));
  bitacora(`Agrupación guardada: "${f.nombre}" (${f.cat}, ${criterioDe(f.criterio).nombre.toLowerCase()}, ${nProductosDe(f)} productos)`);
  return true;
}

async function borrarFamiliaEnLinea(id){
  if (!requiereSesion('eliminar agrupaciones')) return false;
  const { error } = await SBC.from('familias').delete().eq('id', id);
  if (error){ aviso('⚠ No se pudo eliminar: '+error.message); return false; }
  const f = FAMS.get(id);
  FAMS.delete(id);
  bitacora('Agrupación eliminada: "'+(f?f.nombre:id)+'"');
  return true;
}

async function guardarAjuste(clave, valor){
  if (!requiereSesion('publicar cambios')) return false;
  const { error } = await SBC.from('ajustes')
    .upsert({ clave, valor, publico:true, updated_by:SB_YO }, { onConflict:'clave' });
  if (error){ aviso('⚠ No se pudo publicar: '+error.message); return false; }
  AJUSTES.set(clave, valor);
  return true;
}

/* ===========================================================================
   PESTAÑA · AGRUPACIONES
   =========================================================================== */
function familiasFiltradas(){
  const q = norm(PLUS.famQ);
  return [...FAMS.values()].filter(f=>{
    if (PLUS.famCat && f.cat !== PLUS.famCat) return false;
    if (PLUS.famCrit && f.criterio !== PLUS.famCrit) return false;
    if (!q) return true;
    if (norm(f.nombre+' '+f.cat+' '+f.sub).includes(q)) return true;
    // Buscar también por producto: "¿en qué agrupación quedó este código?"
    return codsDe(f).some(c=>{
      const p = prodDe(c);
      return norm(c).includes(q) || (p && norm(p.nom).includes(q));
    });
  }).sort((a,b)=> alfa(a.cat,b.cat) || alfa(a.nombre,b.nombre));
}

function renderFamilias(){
  const cont = $('#famLista'); if (!cont) return;

  // Filtros (se reconstruyen para reflejar altas y bajas de categorías)
  const selCat = $('#famCat');
  if (selCat){
    const cats = [...new Set([...FAMS.values()].map(f=>f.cat))].sort(alfa);
    selCat.innerHTML = '';
    const o0 = el('option', null, 'Todas las categorías'); o0.value=''; selCat.appendChild(o0);
    cats.forEach(c=>{ const o=el('option',null,esc(c)); o.value=c; selCat.appendChild(o); });
    selCat.value = PLUS.famCat;
  }
  const selCrit = $('#famCrit');
  if (selCrit){
    selCrit.innerHTML = '';
    const o0 = el('option', null, 'Cualquier tipo de agrupación'); o0.value=''; selCrit.appendChild(o0);
    criterios().forEach(c=>{ const o=el('option',null,esc(c.nombre)); o.value=c.id; selCrit.appendChild(o); });
    selCrit.value = PLUS.famCrit;
  }

  const lista = familiasFiltradas();
  const cubiertos = [...FAMS.values()].reduce((a,f)=>a+nProductosDe(f), 0);
  const est = $('#famEstado');
  if (est){
    est.innerHTML = FAMS.size
      ? `<b>${fmt(lista.length)}</b> de ${fmt(FAMS.size)} agrupaciones · cubren <b>${fmt(cubiertos)}</b> productos`
      : (SBC ? 'Todavía no hay ninguna agrupación en la base.' : 'Sin conexión con la base.');
  }

  cont.innerHTML = '';
  if (!lista.length){
    cont.appendChild(el('div','vacio', FAMS.size
      ? 'Ninguna agrupación coincide con el filtro.'
      : 'Aún no hay agrupaciones. Crea una con «＋ Nueva agrupación», o pulsa «⤒ Importar del respaldo» para subir las que ya venían con el catálogo.'));
    return;
  }

  for (const f of lista) cont.appendChild(tarjetaFamilia(f));
}

function tarjetaFamilia(f){
  const n = nProductosDe(f);
  const perdidos = codsDe(f).length - n;
  const crit = criterioDe(f.criterio);
  const c = el('div','fam-card'+(f.activa?'':' inactiva'));

  const head = el('div','fam-card-head');
  // Miniatura: de un vistazo se ve cuáles ya tienen foto propia y cuáles no.
  const foto = fotoEfectivaFamilia(f);
  const mini = el('div','fam-mini'+(foto.propia?' propia':''));
  mini.title = foto.propia ? 'Foto propia de la agrupación'
             : (foto.url ? 'Foto prestada de uno de sus productos' : 'Sin foto');
  if (foto.url){
    const img = new Image();
    img.onload = ()=>{ mini.innerHTML=''; mini.appendChild(img); };
    img.onerror = ()=>{ mini.innerHTML='<i>sin foto</i>'; };
    mini.innerHTML = '<i>…</i>';
    img.src = foto.url;
  } else mini.innerHTML = '<i>sin foto</i>';
  head.appendChild(mini);
  const txt = el('div','fam-card-txt');
  txt.appendChild(el('div','fam-card-nom',
    `${esc(f.nombre)}${f.activa?'':'<span class="fam-off">oculta</span>'}`));
  txt.appendChild(el('div','fam-card-ruta', esc(f.cat) + (f.sub? ' › '+esc(f.sub) : '')));
  head.appendChild(txt);
  c.appendChild(head);

  const meta = el('div','fam-card-meta');
  meta.appendChild(el('span','fam-chip crit', esc(crit.nombre)));
  meta.appendChild(el('span','fam-chip', `columna: <b>${esc(columnaDe(f))}</b>`));
  meta.appendChild(el('span','fam-chip', `<b>${fmt(n)}</b> productos`));
  if (f.subgrupos.length>1) meta.appendChild(el('span','fam-chip', `${f.subgrupos.length} grupos`));
  if (perdidos) meta.appendChild(el('span','fam-chip aviso',
    `${fmt(perdidos)} código(s) ya no existen`));
  // La categoría declarada no es donde están sus productos: el cliente la verá
  // en la otra. Se marca aquí para que no haya que abrirla para enterarse.
  const real = catDescuadrada(f);
  if (real) meta.appendChild(el('span','fam-chip aviso',
    `se ve en <b>${esc(real)}</b>, no en ${esc(f.cat)}`));
  c.appendChild(meta);

  // Qué encuentra el cliente al abrirla
  const muestra = f.subgrupos.length>1
    ? f.subgrupos.map(g=>`${esc(g.nombre)} (${g.cods.length})`).join(' · ')
    : codsDe(f).slice(0,6).map(cod=>{ const p=prodDe(cod); return esc(p ? (p.med||p.nom) : cod); }).join(' · ')
      + (n>6 ? ` … +${fmt(n-6)}` : '');
  c.appendChild(el('div','fam-card-muestra', muestra));

  const acts = el('div','fam-card-acts');
  const bEdit = el('button','btn-asignar','✎ Editar');
  bEdit.onclick = ()=>abrirEditorFamilia(f.id);
  const bVer = el('button','btn-datos','👁 Ver como cliente');
  bVer.onclick = ()=>vistaPreviaFamilia(f);
  const bOnOff = el('button','btn-datos', f.activa?'🚫 Ocultar':'✓ Mostrar');
  bOnOff.title = f.activa
    ? 'Deja de agrupar: sus productos vuelven a verse sueltos en el catálogo.'
    : 'Vuelve a mostrar la agrupación en el catálogo.';
  bOnOff.onclick = async ()=>{
    const copia = Object.assign({}, f, {activa:!f.activa});
    if (await guardarFamilia(copia)){ aviso(copia.activa?'✓ Agrupación visible':'✓ Agrupación oculta'); renderFamilias(); }
  };
  const bDel = el('button','btn-datos btn-danger','🗑');
  bDel.title = 'Eliminar la agrupación (los productos NO se borran: vuelven a verse sueltos)';
  bDel.onclick = async ()=>{
    const ok = await dialogo({ titulo:'Eliminar agrupación',
      texto:`Se elimina «${f.nombre}». Sus ${fmt(n)} productos NO se borran: vuelven a mostrarse uno por uno en el catálogo.`,
      okTxt:'Eliminar agrupación' });
    if (!ok) return;
    if (await borrarFamiliaEnLinea(f.id)){ aviso('✓ Agrupación eliminada'); renderFamilias(); }
  };
  acts.append(bEdit, bVer, bOnOff, bDel);
  c.appendChild(acts);
  return c;
}

/* ---------- editor de una agrupación ---------- */
let FAM_EDIT = null;      // copia de trabajo; nada se guarda hasta pulsar Guardar
let FAM_NUEVA = false;

function abrirEditorFamilia(id){
  const f = FAMS.get(id); if (!f) return;
  FAM_EDIT = JSON.parse(JSON.stringify(f));
  FAM_NUEVA = false;
  pintarEditorFamilia();
}

async function nuevaAgrupacion(codsIniciales){
  const cats = [...WORK.taxonomia].sort(alfaN).map(c=>({v:c.nombre,t:c.nombre}));
  const v = await dialogo({
    titulo:'Nueva agrupación',
    texto:'Junta en una sola tarjeta varios productos que son lo mismo y sólo cambian en algo. El tipo de agrupación decide cómo se rotula la columna donde el cliente elige.',
    okTxt:'Crear y elegir productos',
    campos:[
      {id:'nombre', label:'Nombre que verá el cliente', tipo:'text', valor:'', placeholder:'p. ej. Solera'},
      {id:'cat', label:'Categoría', tipo:'select', opciones:cats},
      {id:'criterio', label:'¿Por qué se agrupan?', tipo:'select',
        opciones:criterios().map(c=>({v:c.id, t:c.nombre+' — '+c.ayuda}))},
    ],
  });
  if (!v) return;
  const nombre = (v.nombre||'').trim();
  if (!nombre){ aviso('Escribe el nombre de la agrupación.'); return; }
  FAM_EDIT = {
    id: idFamiliaLibre(v.cat, nombre), nombre, cat:v.cat, sub:'',
    criterio:v.criterio, columna:'', descripcion:'', activa:true, origen:'clasificador',
    subgrupos:[{ nombre:SIN_GRUPO, cods:(codsIniciales||[]).slice() }],
  };
  FAM_NUEVA = true;
  pintarEditorFamilia();
  if (!codsIniciales || !codsIniciales.length) agregarProductosAlGrupo(0);
}

function pintarEditorFamilia(){
  const f = FAM_EDIT; if (!f) return;
  $('#famTitulo').textContent = FAM_NUEVA ? 'Nueva agrupación' : 'Editar agrupación';
  const b = $('#famEditor'); b.innerHTML = '';

  /* --- Identidad: qué es, cómo se ve y dónde vive --- */
  const cab = el('div','fed-bloque');
  cab.appendChild(el('h4',null,'1 · Qué es esta agrupación'));
  const fila1 = el('div','fed-identidad');
  fila1.appendChild(bloqueFotoFamilia(f));
  const g1 = el('div','fed-grid');
  g1.innerHTML = `
    <div class="f-field ancho"><label>Nombre que verá el cliente</label>
      <input id="feNom" value="${esc(f.nombre)}" placeholder="p. ej. Solera" /></div>
    <div class="f-field"><label>Categoría</label><select id="feCat"></select></div>
    <div class="f-field"><label>Subcategoría</label><select id="feSub"></select></div>
    <div class="f-field ancho"><label>Descripción (opcional, se muestra bajo el nombre)</label>
      <input id="feDesc" value="${esc(f.descripcion)}" placeholder="p. ej. Solera de acero al carbón, tramo de 6 m" /></div>`;
  fila1.appendChild(g1);
  cab.appendChild(fila1);
  b.appendChild(cab);

  /* --- Criterio: la decisión que cambia cómo se ve --- */
  const cri = el('div','fed-bloque');
  cri.appendChild(el('h4',null,'2 · ¿Por qué se agrupan? (esto cambia lo que ve el cliente)'));
  const chips = el('div','fed-crits');
  for (const c of criterios()){
    const on = c.id === f.criterio;
    const bt = el('button','fed-crit'+(on?' on':''),
      `<b>${esc(c.nombre)}</b><span>${esc(c.ayuda||'')}</span>`);
    bt.type = 'button';
    bt.onclick = ()=>{ f.criterio = c.id; pintarEditorFamilia(); };
    chips.appendChild(bt);
  }
  cri.appendChild(chips);
  const col = el('div','fed-grid');
  col.innerHTML = `
    <div class="f-field"><label>Rótulo de la columna donde elige el cliente</label>
      <input id="feCol" value="${esc(f.columna)}" placeholder="${esc(criterioDe(f.criterio).columna)}" />
      <small>Si lo dejas vacío se usa «${esc(criterioDe(f.criterio).columna)}», el del tipo de agrupación.</small></div>
    <div class="f-field"><label>¿Se muestra en el catálogo?</label>
      <label class="fed-check"><input type="checkbox" id="feActiva"${f.activa?' checked':''} />
        Sí, agrupar estos productos en una tarjeta</label>
      <small>Apagado, sus productos vuelven a verse uno por uno.</small></div>`;
  cri.appendChild(col);
  b.appendChild(cri);

  /* --- Productos --- */
  const pr = el('div','fed-bloque');
  const nTot = nProductosDe(f);
  pr.appendChild(el('h4',null,`3 · Qué productos entran <span class="fed-n">${fmt(nTot)}</span>`));

  /* Dónde están DE VERDAD sus productos. Es la causa número uno de "creé la
     agrupación y no sale en el catálogo": la categoría se elige al crearla y
     luego se agregan productos de otra, o se reclasifican. */
  const reales = categoriasRealesDe(f);
  if (reales.length){
    const real = reales[0].cat;
    const aviso2 = el('div','fed-ubicacion'+(real!==f.cat ? ' mal' : ''));
    if (real !== f.cat){
      aviso2.innerHTML = `<b>⚠ Se verá en «${esc(real)}», no en «${esc(f.cat)}»</b>
        <span>El catálogo muestra la ficha donde están sus productos.
        ${reales.map(r=>`${esc(r.cat)}: ${fmt(r.n)}`).join(' · ')}</span>`;
      const arreglar = el('button','fed-mini','Cambiar la categoría a «'+real+'»');
      arreglar.type='button';
      arreglar.onclick = ()=>{ f.cat = real; f.sub=''; pintarEditorFamilia(); };
      aviso2.appendChild(arreglar);
    } else {
      aviso2.innerHTML = `<span>✓ Sus productos están en <b>${esc(real)}</b>`
        + (reales.length>1 ? ` (y ${reales.length-1} categoría(s) más: ${reales.slice(1).map(r=>esc(r.cat)+' '+fmt(r.n)).join(', ')})` : '')
        + `. Ahí la verá el cliente.</span>`;
    }
    pr.appendChild(aviso2);
  }

  const simple = f.subgrupos.length === 1;
  const barra = el('div','fed-barra');
  const bAdd = el('button','btn-asignar','＋ Agregar productos');
  bAdd.type='button';
  bAdd.onclick = ()=>agregarProductosAlGrupo(0);
  barra.appendChild(bAdd);
  if (simple){
    const bDiv = el('button','btn-datos','⑂ Dividir en grupos');
    bDiv.type='button';
    bDiv.title = 'Para cuando dentro de la agrupación hay familias distintas (Discos → Corte · Desbaste · Diamante)';
    bDiv.onclick = ()=>{ f.subgrupos[0].nombre = 'Grupo 1'; f.subgrupos.push({nombre:'Grupo 2', cods:[]}); pintarEditorFamilia(); };
    barra.appendChild(bDiv);
  } else {
    const bNG = el('button','btn-datos','＋ Nuevo grupo');
    bNG.type='button';
    bNG.onclick = ()=>{ f.subgrupos.push({nombre:'Grupo '+(f.subgrupos.length+1), cods:[]}); pintarEditorFamilia(); };
    barra.appendChild(bNG);
    const bUnir = el('button','btn-datos','⑃ Unir todo en uno');
    bUnir.type='button';
    bUnir.onclick = ()=>{
      f.subgrupos = [{ nombre:SIN_GRUPO, cods:codsDe(f) }];
      pintarEditorFamilia();
    };
    barra.appendChild(bUnir);
  }
  const bOrd = el('button','btn-datos','↕ Ordenar por medida');
  bOrd.type='button';
  bOrd.title = 'Reacomoda los productos de menor a mayor dentro de cada grupo';
  bOrd.onclick = ()=>{ f.subgrupos.forEach(g=>g.cods = ordenarCodsPorMedida(g.cods)); pintarEditorFamilia(); aviso('✓ Ordenados por medida'); };
  barra.appendChild(bOrd);
  pr.appendChild(barra);

  f.subgrupos.forEach((g, i)=>pr.appendChild(bloqueSubgrupo(f, g, i, simple)));
  b.appendChild(pr);

  /* --- Vista previa --- */
  const vp = el('div','fed-bloque');
  vp.appendChild(el('h4',null,'4 · Así lo verá el cliente'));
  vp.appendChild(previaFamilia(f));
  b.appendChild(vp);

  // Selects dependientes
  const fc = $('#feCat'), fs = $('#feSub');
  opcionesCategoria(fc, false);
  if (!TAXMAP.has(f.cat)){ const o = el('option',null,esc(f.cat)); o.value=f.cat; fc.appendChild(o); }
  fc.value = f.cat;
  opcionesSubSimple(fs, f.cat, f.sub);
  fc.onchange = ()=>{ f.cat = fc.value; opcionesSubSimple(fs, f.cat, ''); f.sub=''; };
  fs.onchange = ()=>{ f.sub = fs.value; };
  $('#feNom').oninput  = (e)=>{ f.nombre = e.target.value; };
  $('#feDesc').oninput = (e)=>{ f.descripcion = e.target.value; };
  $('#feCol').oninput  = (e)=>{ f.columna = e.target.value; };
  $('#feActiva').onchange = (e)=>{ f.activa = e.target.checked; };

  $('#famAviso').textContent = nTot < 2
    ? '⚠ Una agrupación necesita al menos 2 productos para tener sentido.'
    : '';
  $('#modalFam').hidden = false;
}

/* ---------- foto de portada de la agrupación ----------
   Sin foto propia, la tarjeta toma prestada la del primer producto que tenga
   una. Sirve de emergencia, pero una ficha "Solera" se vende mejor con una foto
   del producto genérico que con la de la medida que casualmente quedó primera.

   El recorte lo hace el MISMO editor de fotos que ya usan los productos
   (modalFoto en clasificador.js): se le pasa qué hacer con el recorte y él se
   encarga del encuadre, el zoom, el formato y el peso. */

/** Qué foto se ve hoy en la tarjeta: la propia o, si no hay, la prestada. */
function fotoEfectivaFamilia(f){
  if (f.foto) return { url:f.foto, propia:true, de:null };
  for (const cod of codsDe(f)){
    const p = prodDe(cod);
    if (p && p.foto) return { url:esUrlFoto(p.foto) ? p.foto : ('fotos/'+p.id+'.webp'), propia:false, de:p };
  }
  return { url:'', propia:false, de:null };
}

function bloqueFotoFamilia(f){
  const caja = el('div','fed-foto');
  const actual = fotoEfectivaFamilia(f);

  const marco = el('div','fed-foto-marco');
  if (actual.url){
    const img = new Image();
    img.onload = ()=>{ marco.innerHTML=''; marco.appendChild(img); };
    img.onerror = ()=>{ marco.innerHTML = '<span class="fed-foto-ph">Sin foto</span>'; };
    marco.innerHTML = '<span class="fed-foto-ph">Cargando…</span>';
    img.src = actual.url;
  } else {
    marco.innerHTML = '<span class="fed-foto-ph">Sin foto</span>';
  }
  caja.appendChild(marco);

  caja.appendChild(el('div','fed-foto-nota', actual.propia
    ? 'Foto propia de la agrupación.'
    : (actual.de
        ? `Prestada de «${esc(actual.de.nom)}». Ponle una propia para que la tarjeta no dependa de qué medida quede primera.`
        : 'Ninguno de sus productos tiene foto todavía.')));

  const acts = el('div','fed-foto-acts');
  const bCam = el('button','btn-datos', actual.propia ? '🖼 Cambiar foto' : '🖼 Poner foto propia');
  bCam.type = 'button';
  bCam.onclick = ()=>$('#feFotoFile').click();
  acts.appendChild(bCam);
  if (f.foto){
    const bQuit = el('button','fed-mini danger','Quitar');
    bQuit.type='button';
    bQuit.title = 'Vuelve a tomar prestada la foto de uno de sus productos';
    bQuit.onclick = ()=>{ f.foto=''; pintarEditorFamilia(); };
    acts.appendChild(bQuit);
  }
  const inp = el('input'); inp.type='file'; inp.id='feFotoFile'; inp.accept='image/*'; inp.hidden=true;
  inp.onchange = (e)=>{
    const file = e.target.files[0]; e.target.value='';
    if (!file) return;
    // El editor devuelve el recorte; aquí sólo hay que subirlo y apuntar a él.
    abrirEditorFoto('fam-'+f.id, file, (blob, ext)=>subirFotoFamilia(f, blob, ext));
  };
  acts.appendChild(inp);
  caja.appendChild(acts);
  return caja;
}

/* Sube el recorte al bucket `fotos` y apunta la agrupación a su URL. La fila de
   la base NO se toca aquí: se guarda con «Guardar agrupación», como todo lo
   demás del editor, para que Cancelar siga significando cancelar. */
async function subirFotoFamilia(f, blob, ext){
  if (!SBC){ aviso('⚠ Supabase no disponible.'); return false; }
  if (!SB.user){ aviso('⚠ Inicia sesión (Guardar / Exportar) para cambiar fotos.'); return false; }
  if (blob.size > 5*1024*1024){ aviso('⚠ La imagen supera 5 MB.'); return false; }
  const ruta = `familia-${f.id}-${Date.now()}.${ext||'webp'}`;   // nombre único: evita caché
  try{
    const { error } = await SBC.storage.from('fotos')
      .upload(ruta, blob, { cacheControl:'3600', upsert:true, contentType:blob.type });
    if (error) throw error;
    f.foto = SBC.storage.from('fotos').getPublicUrl(ruta).data.publicUrl;
    if (FAM_EDIT && FAM_EDIT.id === f.id) pintarEditorFamilia();
    aviso('✓ Foto lista. Pulsa «Guardar agrupación» para aplicarla.');
    return true;
  }catch(e){
    aviso('⚠ No se pudo subir la foto: '+(e.message||e.name));
    return false;
  }
}

/* Sólo subcategorías (sin el 3er nivel): una agrupación vive en una rama, no en
   una hoja. Reutiliza la taxonomía del clasificador. */
function opcionesSubSimple(sel, catNombre, actual){
  sel.innerHTML = '';
  const o0 = el('option',null,'(toda la categoría)'); o0.value=''; sel.appendChild(o0);
  const t = TAXMAP.get(catNombre);
  const subs = t ? [...t.subs].sort(alfaN).map(s=>s.nombre) : [];
  if (actual && !subs.includes(actual)) subs.push(actual);
  subs.sort(alfa).forEach(s=>{ const o=el('option',null,esc(s)); o.value=s; sel.appendChild(o); });
  sel.value = actual || '';
  if (sel.selectedIndex < 0) sel.value = '';
}

function bloqueSubgrupo(f, g, i, simple){
  const caja = el('div','fed-grupo');
  const head = el('div','fed-grupo-head');
  if (simple){
    head.appendChild(el('span','fed-grupo-tit', `Productos <b>${fmt(g.cods.length)}</b>`));
  } else {
    const inp = el('input','fed-grupo-nom'); inp.value = g.nombre;
    inp.placeholder = 'Nombre del grupo (p. ej. Corte)';
    inp.oninput = ()=>{ g.nombre = inp.value; };
    head.appendChild(inp);
    head.appendChild(el('span','fed-grupo-n', fmt(g.cods.length)));
    const bAdd = el('button','fed-mini','＋ productos'); bAdd.type='button';
    bAdd.onclick = ()=>agregarProductosAlGrupo(i);
    head.appendChild(bAdd);
    const bDel = el('button','fed-mini danger','✕ grupo'); bDel.type='button';
    bDel.title = 'Elimina el grupo; sus productos pasan al primero';
    bDel.onclick = ()=>{
      if (f.subgrupos.length<=1) return;
      const [fuera] = f.subgrupos.splice(i,1);
      const destino = f.subgrupos[0];
      destino.cods = [...new Set([...destino.cods, ...fuera.cods])];
      if (f.subgrupos.length===1) f.subgrupos[0].nombre = SIN_GRUPO;
      pintarEditorFamilia();
    };
    head.appendChild(bDel);
  }
  caja.appendChild(head);

  if (!g.cods.length){
    caja.appendChild(el('div','fed-vacio','Sin productos todavía. Usa «＋ productos».'));
    return caja;
  }

  const tabla = el('div','fed-tabla');
  g.cods.forEach(cod=>{
    const p = prodDe(cod);
    const fila = el('div','fed-fila'+(p?'':' huerfano'));
    fila.appendChild(el('span','fed-med', esc(p ? (p.med||'—') : '—')));
    fila.appendChild(el('span','fed-nom', p
      ? `${esc(p.nom)}<i>${esc(cod)}</i>`
      : `<b>Código sin producto</b><i>${esc(cod)}</i>`));
    if (!simple && f.subgrupos.length>1){
      const mover = el('select','fed-mover');
      f.subgrupos.forEach((otro, j)=>{
        const o = el('option',null, esc(otro.nombre||('Grupo '+(j+1)))); o.value=String(j);
        mover.appendChild(o);
      });
      mover.value = String(i);
      mover.title = 'Mover a otro grupo';
      mover.onchange = ()=>{
        const j = +mover.value; if (j===i) return;
        g.cods = g.cods.filter(x=>x!==cod);
        if (!f.subgrupos[j].cods.includes(cod)) f.subgrupos[j].cods.push(cod);
        pintarEditorFamilia();
      };
      fila.appendChild(mover);
    }
    const quitar = el('button','fed-mini danger','✕'); quitar.type='button';
    quitar.title = 'Quitar de la agrupación (el producto no se borra)';
    quitar.onclick = ()=>{ g.cods = g.cods.filter(x=>x!==cod); pintarEditorFamilia(); };
    fila.appendChild(quitar);
    tabla.appendChild(fila);
  });
  caja.appendChild(tabla);
  return caja;
}

/* Mismo orden que usa el catálogo dentro de una ficha: comparando TODOS los
   números de la medida (1/8 X 1/2" antes que 1/8 X 1"), con mm pasados a
   pulgadas. Está duplicado a propósito: el clasificador corre sin módulos. */
function clavesMedida(med){
  const s = String(med||'').trim();
  if (!s) return [];
  const div = /\bmm\b/i.test(s) ? 25.4 : (/\bcm\b/i.test(s) ? 2.54 : 1);
  const num = (x)=>parseFloat(String(x).replace(',','.'));
  const re = /(\d+(?:[.,]\d+)?)\s+(\d+)\/(\d+)|(\d+)\/(\d+)|(\d+(?:[.,]\d+)?)/g;
  const claves = []; let m;
  while ((m = re.exec(s))){
    let v;
    if (m[1]!=null) v = num(m[1]) + (+m[2])/(+m[3]);
    else if (m[4]!=null) v = (+m[4])/(+m[5]);
    else v = num(m[6]);
    claves.push(v/div);
  }
  return claves;
}
function ordenarCodsPorMedida(cods){
  return cods.slice().sort((a,b)=>{
    const pa = prodDe(a), pb = prodDe(b);
    const ka = clavesMedida(pa && pa.med), kb = clavesMedida(pb && pb.med);
    if (!ka.length !== !kb.length) return ka.length ? -1 : 1;
    for (let i=0;i<Math.max(ka.length,kb.length);i++){
      if (ka[i]==null) return -1;
      if (kb[i]==null) return 1;
      if (ka[i]!==kb[i]) return ka[i]-kb[i];
    }
    return alfa((pa&&pa.nom)||a, (pb&&pb.nom)||b);
  });
}

/* Maqueta de la ficha tal como la arma el catálogo: encabezado, rótulo de la
   columna según el criterio y las primeras filas. */
function previaFamilia(f){
  const caja = el('div','fed-previa');
  const nombres = f.subgrupos.filter(g=>g.cods.length);
  const medidas = new Set(codsDe(f).map(c=>{ const p=prodDe(c); return p?(p.med||'').trim():''; }).filter(Boolean));
  const foto = fotoEfectivaFamilia(f);
  const tarjeta = el('div','prev-tarjeta');
  const marco = el('div','prev-foto');
  if (foto.url){
    const img = new Image();
    img.onload = ()=>{ marco.innerHTML=''; marco.appendChild(img); };
    img.onerror = ()=>{ marco.innerHTML='<span>Sin foto</span>'; };
    img.src = foto.url;
  } else marco.innerHTML = '<span>Sin foto</span>';
  tarjeta.appendChild(marco);
  tarjeta.appendChild(el('div', null, `
    <div class="prev-tag">${esc(f.sub || f.cat || '—')}</div>
    <div class="prev-nom">${esc(f.nombre||'(sin nombre)')}</div>
    <div class="prev-medbox"><i>${esc(columnaDe(f))}</i><b>${fmt(medidas.size)} para elegir</b></div>
    <div class="prev-cod">${nombres.length>1 ? esc(nombres.map(g=>g.nombre).slice(0,3).join(' · ')) : fmt(nProductosDe(f))+' códigos'}</div>
    <div class="prev-btn">Elegir ${esc(columnaDe(f).toLowerCase())}</div>`));
  caja.appendChild(tarjeta);

  const tabla = el('div','prev-tabla');
  tabla.appendChild(el('div','prev-fila cab',
    `<span>${esc(columnaDe(f))}</span><span>Producto</span><span>Cantidad</span>`));
  const primeros = codsDe(f).slice(0,4);
  if (!primeros.length) tabla.appendChild(el('div','prev-fila','<span>—</span><span>Agrega productos para ver la tabla</span><span>—</span>'));
  primeros.forEach(cod=>{
    const p = prodDe(cod);
    tabla.appendChild(el('div','prev-fila',
      `<span>${esc(p?(p.med||'—'):'—')}</span><span>${esc(p?p.nom:cod)}</span><span>− 0 +</span>`));
  });
  if (nProductosDe(f) > 4) tabla.appendChild(el('div','prev-mas', `… y ${fmt(nProductosDe(f)-4)} más`));
  caja.appendChild(tabla);
  return caja;
}

function vistaPreviaFamilia(f){
  const b = $('#famEditor'); if (!b) return;
  FAM_EDIT = JSON.parse(JSON.stringify(f)); FAM_NUEVA = false;
  $('#famTitulo').textContent = 'Así lo ve el cliente · '+f.nombre;
  b.innerHTML = '';
  const vp = el('div','fed-bloque');
  vp.appendChild(previaFamilia(f));
  b.appendChild(vp);
  $('#famAviso').textContent = 'Vista previa. Para cambiar algo, cierra y usa «✎ Editar».';
  $('#modalFam').hidden = false;
}

async function guardarEditorFamilia(){
  const f = FAM_EDIT; if (!f) return;
  const nombre = (f.nombre||'').trim();
  if (!nombre){ aviso('⚠ Ponle nombre a la agrupación: es lo que ve el cliente.'); return; }
  if (nProductosDe(f) < 2){ aviso('⚠ Necesita al menos 2 productos.'); return; }

  // Un código en dos agrupaciones dejaría al catálogo sin saber cuál mostrar.
  const repes = [];
  for (const cod of codsDe(f)){
    const otra = familiaConCodigo(cod, f.id);
    if (otra) repes.push(`${cod} (ya está en «${otra.nombre}»)`);
  }
  if (repes.length){
    const ok = await dialogo({ titulo:'Productos en dos agrupaciones',
      texto:`Estos productos ya pertenecen a otra agrupación: ${repes.slice(0,6).join(', ')}${repes.length>6?` y ${repes.length-6} más`:''}. Si guardas, quítalos de la otra o el catálogo mostrará sólo una de las dos.`,
      okTxt:'Guardar de todos modos' });
    if (!ok) return;
  }

  /* Última red antes de guardar: si la categoría declarada no es donde están
     los productos, el cliente la encontrará en la otra. Se ofrece cuadrarlo. */
  const real = catDescuadrada(f);
  if (real){
    const v = await dialogo({ titulo:'La categoría no cuadra',
      texto:`Dice «${f.cat}», pero sus productos están en «${real}». El catálogo la mostrará en «${real}», que es donde el cliente los busca. ¿Cambio la categoría de la agrupación para que coincida?`,
      campos:[{id:'q', label:'¿Qué hago?', tipo:'select', opciones:[
        {v:'si', t:`Cambiarla a «${real}» (recomendado)`},
        {v:'no', t:`Dejarla en «${f.cat}»`},
      ]}], okTxt:'Guardar' });
    if (!v) return;
    if (v.q === 'si'){ f.cat = real; f.sub = ''; }
  }

  f.nombre = nombre;
  f.subgrupos = f.subgrupos.filter(g=>g.cods.length);
  if (!f.subgrupos.length) f.subgrupos = [{nombre:SIN_GRUPO, cods:[]}];
  if (f.subgrupos.length===1) f.subgrupos[0].nombre = SIN_GRUPO;

  if (await guardarFamilia(f)){
    aviso('✓ Agrupación guardada: «'+f.nombre+'»');
    cerrarEditorFamilia();
    renderFamilias();
  }
}
function cerrarEditorFamilia(){ $('#modalFam').hidden = true; FAM_EDIT = null; FAM_NUEVA = false; }

/* Sube a la base las agrupaciones que venían en el archivo del catálogo
   (data/familias.js). Sirve la primera vez y como recuperación. */
async function importarFamiliasRespaldo(){
  if (!requiereSesion('importar agrupaciones')) return;
  const doc = window.FAMILIAS;
  const lista = (doc && Array.isArray(doc.familias)) ? doc.familias : [];
  if (!lista.length){ aviso('⚠ No hay respaldo local de agrupaciones (data/familias.js).'); return; }

  const nuevas = lista.filter(f=>!FAMS.has(f.id));
  const ok = await dialogo({ titulo:'Importar agrupaciones del respaldo',
    texto:`El archivo del catálogo trae ${fmt(lista.length)} agrupaciones; ${fmt(nuevas.length)} todavía no están en la base. Las que ya existen NO se tocan (tus ediciones se respetan).`,
    okTxt:`Importar ${fmt(nuevas.length)}` });
  if (!ok || !nuevas.length) return;

  // El criterio de arranque se deduce de la forma: con varios subgrupos la
  // agrupación distingue tipos (función); con uno solo, medidas.
  const filas = nuevas.map(f=>({
    id:f.id, nombre:f.nombre, cat:f.cat, sub:f.sub||null,
    criterio: (f.subgrupos||[]).length>1 ? 'funcion' : 'medida',
    columna:null, descripcion:null,
    subgrupos:(f.subgrupos||[]).map(g=>({nombre:g.nombre||SIN_GRUPO, cods:(g.cods||[]).slice()})),
    activa:true, origen:f.origen||'respaldo', updated_by:SB_YO,
  }));
  let subidas = 0;
  for (let i=0;i<filas.length;i+=100){
    const lote = filas.slice(i,i+100);
    const { error } = await SBC.from('familias').upsert(lote, { onConflict:'id' });
    if (error){ aviso('⚠ Error al importar: '+error.message); break; }
    lote.forEach(f=>FAMS.set(f.id, normalizarFamilia(f)));
    subidas += lote.length;
  }
  bitacora(`Importadas ${subidas} agrupaciones del respaldo local`);
  aviso(`✓ ${fmt(subidas)} agrupaciones importadas`);
  renderFamilias();
}

/* ===========================================================================
   SELECTOR DE PRODUCTOS (agrupaciones y destacados)
   =========================================================================== */
const PICK = { sel:new Set(), q:'', cat:'', onOk:null, excluir:new Set(), titulo:'' };

function abrirSelector(cfg){
  PICK.sel = new Set(); PICK.q=''; PICK.onOk = cfg.onOk;
  PICK.excluir = new Set(cfg.excluir||[]);
  PICK.cat = cfg.cat || '';
  $('#pickTitulo').textContent = cfg.titulo || 'Elegir productos';
  $('#pickQ').value = '';
  $('#modalPick').hidden = false;
  pintarSelector();
  setTimeout(()=>$('#pickQ').focus(), 30);
}
function pintarSelector(){
  const cont = $('#pickLista'); if (!cont) return;
  const q = norm(PICK.q);
  /* Sin nada escrito se muestra la categoría sugerida (la de la agrupación):
     así se empieza viendo lo que probablemente se busca, no los 3,222. */
  let lista = PRODUCTOS.filter(p=>!PICK.excluir.has(p.cod));
  if (q){
    lista = lista.filter(p=>norm(p.nom+' '+p.cod+' '+p.med+' '+p.sub).includes(q));
  } else if (PICK.cat){
    lista = lista.filter(p=>p.cat===PICK.cat);
  } else {
    lista = [];
  }
  lista = lista.sort((a,b)=>alfa(a.nom,b.nom)).slice(0,300);

  cont.innerHTML = '';
  if (!lista.length){
    cont.appendChild(el('div','vacio', q
      ? 'Ningún producto coincide con «'+esc(PICK.q)+'».'
      : 'Escribe para buscar el producto por nombre, código o medida.'));
  }
  lista.forEach(p=>{
    const on = PICK.sel.has(p.cod);
    const fila = el('div','pick-fila'+(on?' on':''));
    fila.innerHTML = `<input type="checkbox"${on?' checked':''} />
      <span class="pick-nom">${esc(p.nom)}<i>${esc(p.cod)}</i></span>
      <span class="pick-med">${esc(p.med||'')}</span>
      <span class="pick-cat">${esc(p.sub||p.cat)}</span>`;
    fila.onclick = ()=>{
      PICK.sel.has(p.cod) ? PICK.sel.delete(p.cod) : PICK.sel.add(p.cod);
      pintarSelector();
    };
    cont.appendChild(fila);
  });
  $('#pickN').textContent = PICK.sel.size
    ? `${fmt(PICK.sel.size)} elegido(s)`
    : (lista.length===300 ? 'Se muestran los primeros 300: afina la búsqueda.' : '');
}
function cerrarSelector(){ $('#modalPick').hidden = true; PICK.onOk = null; }

function agregarProductosAlGrupo(i){
  const f = FAM_EDIT; if (!f) return;
  abrirSelector({
    titulo: f.subgrupos.length>1
      ? `Agregar productos a «${f.subgrupos[i].nombre}»`
      : 'Agregar productos a la agrupación',
    cat: f.cat,
    excluir: codsDe(f),
    onOk:(cods)=>{
      const g = f.subgrupos[i]; if (!g) return;
      cods.forEach(c=>{ if (!g.cods.includes(c)) g.cods.push(c); });
      g.cods = ordenarCodsPorMedida(g.cods);
      pintarEditorFamilia();
    },
  });
}

/* ===========================================================================
   PESTAÑA · DESTACADOS
   =========================================================================== */
function renderDestacados(){
  const cont = $('#desLista'); if (!cont) return;
  cont.innerHTML = '';
  $('#desN').textContent = fmt(DESTACADOS.length);

  if (!DESTACADOS.length){
    cont.appendChild(el('div','vacio','Todavía no hay destacados: el catálogo abre directo en el listado completo. Agrega los que más se venden.'));
  }
  DESTACADOS.forEach((d, i)=>{
    const fila = el('div','des-fila');
    let titulo, detalle, falta = false;
    if (d.t === 'f'){
      const f = FAMS.get(d.c);
      titulo = f ? f.nombre : d.c;
      detalle = f ? `Agrupación · ${f.cat} · ${fmt(nProductosDe(f))} productos` : 'Agrupación que ya no existe';
      falta = !f;
    } else {
      const p = prodDe(d.c);
      titulo = p ? p.nom : d.c;
      detalle = p ? `${p.cod} · ${p.cat}${p.med?' · '+p.med:''}` : 'Producto que ya no existe';
      falta = !p;
    }
    fila.className = 'des-fila'+(falta?' huerfano':'');
    fila.appendChild(el('span','des-pos', String(i+1)));
    fila.appendChild(el('span','des-tipo'+(d.t==='f'?' fam':''), d.t==='f'?'Agrupación':'Producto'));
    fila.appendChild(el('span','des-nom', `${esc(titulo)}<i>${esc(detalle)}</i>`));

    const acts = el('span','des-acts');
    const sube = el('button','fed-mini','▲'); sube.title='Subir';
    sube.onclick = ()=>{ if(i>0){ [DESTACADOS[i-1],DESTACADOS[i]]=[DESTACADOS[i],DESTACADOS[i-1]]; renderDestacados(); } };
    const baja = el('button','fed-mini','▼'); baja.title='Bajar';
    baja.onclick = ()=>{ if(i<DESTACADOS.length-1){ [DESTACADOS[i+1],DESTACADOS[i]]=[DESTACADOS[i],DESTACADOS[i+1]]; renderDestacados(); } };
    const quita = el('button','fed-mini danger','✕'); quita.title='Quitar de la portada';
    quita.onclick = ()=>{ DESTACADOS.splice(i,1); renderDestacados(); };
    acts.append(sube, baja, quita);
    fila.appendChild(acts);
    cont.appendChild(fila);
  });

  renderPopulares();
}

function renderPopulares(){
  const cont = $('#popLista'); if (!cont) return;
  cont.innerHTML = '';
  if (!SBC || !SB.user){
    cont.appendChild(el('div','vacio','Inicia sesión (botón «Guardar / Exportar») para ver qué piden los clientes.'));
    $('#popN').textContent = '';
    return;
  }
  const campo = PLUS.popRango==='30' ? 'pedidos_30d' : (PLUS.popRango==='90' ? 'pedidos_90d' : 'pedidos');
  const filas = POPU.slice()
    .filter(r=>(r[campo]||0) > 0)
    .sort((a,b)=> (b[campo]||0)-(a[campo]||0) || (b.piezas||0)-(a.piezas||0))
    .slice(0, 40);
  $('#popN').textContent = filas.length ? fmt(filas.length) : '';

  if (!filas.length){
    cont.appendChild(el('div','vacio','Todavía no hay pedidos registrados en ese periodo. En cuanto los clientes empiecen a mandar pedidos por WhatsApp, aquí aparecerá el conteo automáticamente.'));
    return;
  }
  filas.forEach((r,i)=>{
    const p = prodDe(r.cod);
    const yaEsta = DESTACADOS.some(d=>d.t==='p' && d.c===r.cod);
    const fila = el('div','pop-fila');
    fila.appendChild(el('span','pop-pos', String(i+1)));
    fila.appendChild(el('span','pop-nom',
      `${esc(p ? p.nom : (r.descripcion||r.cod))}<i>${esc(r.cod)}${r.categoria?' · '+esc(r.categoria):''}</i>`));
    fila.appendChild(el('span','pop-n', `<b>${fmt(r[campo]||0)}</b><i>pedidos</i>`));
    fila.appendChild(el('span','pop-n', `<b>${fmt(r.piezas||0)}</b><i>piezas</i>`));
    const add = el('button','fed-mini', yaEsta?'✓':'＋');
    add.title = yaEsta ? 'Ya está en la portada' : 'Poner en la portada';
    add.disabled = yaEsta;
    add.onclick = ()=>{ DESTACADOS.push({t:'p', c:r.cod}); renderDestacados(); };
    fila.appendChild(add);
    cont.appendChild(fila);
  });

  renderBusquedas();
}

/* Lo que la gente busca y NO encuentra es el dato más accionable de todo el
   catálogo: o falta el producto, o falta enseñarle al buscador esa palabra.
   Por eso los términos sin resultado van arriba, aparte y con el botón que
   crea la traducción ahí mismo — sin ir a buscar dónde se configura. */
function renderBusquedas(){
  const bus = $('#busLista'); if (!bus) return;
  bus.innerHTML = '';
  if (!BUSQ.length) return;

  const fallidas = BUSQ.filter(b => (b.veces_sin_resultado||0) > 0)
    .sort((a,b)=>(b.veces_sin_resultado||0)-(a.veces_sin_resultado||0)).slice(0,10);
  const resto = BUSQ.filter(b => !(b.veces_sin_resultado||0))
    .sort((a,b)=>b.veces-a.veces).slice(0,12);

  if (fallidas.length){
    bus.appendChild(el('h4','bus-alerta','⚠ Buscaron esto y no encontraron nada'));
    bus.appendChild(el('p','caja-nota','Cada uno es una venta que se está perdiendo. O falta el producto en el catálogo, o hay que enseñarle esa palabra al buscador.'));
    const lista = el('div','bus-fallidas');
    fallidas.forEach(b=>{
      const fila = el('div','bus-fila');
      fila.appendChild(el('span','bus-term', esc(b.termino)));
      fila.appendChild(el('span','bus-n', `${fmt(b.veces_sin_resultado)} vez(ces)`));
      const trad = el('button','fed-mini','＋ enseñar palabra');
      trad.title = `Decirle al buscador con qué otra cosa buscar «${b.termino}»`;
      trad.onclick = ()=>nuevoSinonimo(b.termino);
      fila.appendChild(trad);
      const alta = el('button','fed-mini','＋ dar de alta');
      alta.title = 'Crear el producto que falta';
      alta.onclick = ()=>nuevoProducto();
      fila.appendChild(alta);
      lista.appendChild(fila);
    });
    bus.appendChild(lista);
  }

  if (resto.length){
    bus.appendChild(el('h4',null,'Lo que más buscan'));
    const wrap = el('div','bus-chips');
    resto.forEach(b=>wrap.appendChild(el('span','bus-chip', `${esc(b.termino)}<i>${fmt(b.veces)}</i>`)));
    bus.appendChild(wrap);
  }
}

async function cargarPopulares(avisar){
  if (!SBC || !SB.user){ if (avisar) aviso('⚠ Inicia sesión para ver los pedidos.'); return; }
  try{
    const [pop, bus] = await Promise.all([
      SBC.from('productos_populares').select('*').limit(500),
      SBC.from('busquedas_populares').select('*').limit(200),
    ]);
    if (!pop.error && pop.data) POPU = pop.data;
    if (!bus.error && bus.data) BUSQ = bus.data;
    if (avisar) aviso(`✓ ${fmt(POPU.length)} producto(s) con pedidos registrados`);
  }catch(e){
    if (avisar) aviso('⚠ No se pudo leer el conteo: '+(e.message||e.name));
  }
  if (PLUS.panel==='destacados') renderPopulares();
}

async function publicarDestacados(){
  if (!requiereSesion('publicar los destacados')) return;
  if (await guardarAjuste('destacados', DESTACADOS)){
    bitacora(`Destacados de la portada publicados (${DESTACADOS.length})`);
    aviso('✓ Destacados publicados: el catálogo los muestra al refrescar');
  }
}

/* ===========================================================================
   PESTAÑA · SUCURSALES Y TEXTOS
   =========================================================================== */
function renderAjustes(){
  const cont = $('#sucLista'); if (!cont) return;
  cont.innerHTML = '';
  if (!SUCS.length){
    cont.appendChild(el('div','vacio','No se pudieron leer las sucursales de la base. El catálogo seguirá usando las cinco que trae de fábrica.'));
  }
  SUCS.forEach((s, i)=>{
    const caja = el('div','suc-caja'+(s.activa===false?' inactiva':''));
    caja.innerHTML = `
      <div class="suc-grid">
        <div class="f-field"><label>Nombre (lo ve el cliente)</label><input data-c="nombre" value="${esc(s.nombre||'')}" /></div>
        <div class="f-field"><label>WhatsApp (con 52 al inicio, sin espacios)</label><input data-c="whatsapp" value="${esc(s.whatsapp||'')}" placeholder="522281234567" /></div>
        <div class="f-field ancho"><label>Dirección completa</label><input data-c="direccion" value="${esc(s.direccion||'')}" placeholder="Calle 123, Colonia, CP, Ciudad, Ver." /></div>
        <div class="f-field corto"><label>Orden</label><input data-c="orden" type="number" value="${s.orden||i+1}" /></div>
        <div class="f-field"><label>&nbsp;</label>
          <label class="fed-check"><input type="checkbox" data-c="activa"${s.activa!==false?' checked':''} /> Se muestra en el catálogo</label></div>
      </div>`;
    caja.querySelectorAll('[data-c]').forEach(n=>{
      const campo = n.dataset.c;
      const leer = ()=> campo==='activa' ? n.checked : (campo==='orden' ? (+n.value||0) : n.value);
      n.oninput = n.onchange = ()=>{ s[campo] = leer(); };
    });
    const pie = el('div','suc-pie');
    const wa = el('a','suc-prueba','Probar WhatsApp ↗');
    wa.href = 'https://wa.me/'+String(s.whatsapp||'').replace(/\D/g,'');
    wa.target = '_blank'; wa.rel='noopener';
    const mapa = el('a','suc-prueba','Ver en Google Maps ↗');
    mapa.href = 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent('Aceros Peñascal '+(s.direccion||''));
    mapa.target='_blank'; mapa.rel='noopener';
    const del = el('button','fed-mini danger','🗑 Eliminar sucursal');
    del.onclick = async ()=>{
      const ok = await dialogo({ titulo:'Eliminar sucursal',
        texto:`«${s.nombre}» dejará de aparecer en el catálogo. Si sólo quieres esconderla un tiempo, desmarca «Se muestra en el catálogo».`,
        okTxt:'Eliminar' });
      if (!ok) return;
      if (s.id && SBC && SB.user){
        const { error } = await SBC.from('sucursales').delete().eq('id', s.id);
        if (error){ aviso('⚠ '+error.message); return; }
      }
      SUCS = SUCS.filter(x=>x!==s);
      bitacora('Sucursal eliminada: '+s.nombre);
      renderAjustes();
    };
    pie.append(wa, mapa, del);
    caja.appendChild(pie);
    cont.appendChild(caja);
  });

  // --- Textos ---
  const txt = $('#txtLista'); if (txt){
    const t = AJUSTES.get('textos_catalogo') || {};
    const campos = [
      ['titulo_destacados','Título de la sección de destacados','Lo más pedido'],
      ['subtitulo_destacados','Frase bajo el título','Los productos que más nos piden en mostrador'],
      ['nota_sin_precios','Aviso al pie del pedido','No se muestran precios: el equipo te cotiza al recibir el pedido.'],
    ];
    txt.innerHTML = '';
    campos.forEach(([k, label, ph])=>{
      const f = el('div','f-field ancho');
      f.innerHTML = `<label>${esc(label)}</label><input value="${esc(t[k]||'')}" placeholder="${esc(ph)}" />`;
      f.querySelector('input').oninput = (e)=>{
        const v = AJUSTES.get('textos_catalogo') || {};
        v[k] = e.target.value; AJUSTES.set('textos_catalogo', v);
      };
      txt.appendChild(f);
    });
  }

  renderSinonimos();

  // --- Criterios de agrupación ---
  const cri = $('#critLista'); if (cri){
    cri.innerHTML = '';
    criterios().forEach((c, i)=>{
      const caja = el('div','crit-caja');
      caja.innerHTML = `
        <div class="crit-grid">
          <div class="f-field"><label>Nombre</label><input data-c="nombre" value="${esc(c.nombre||'')}" /></div>
          <div class="f-field corto"><label>Rótulo de columna</label><input data-c="columna" value="${esc(c.columna||'')}" /></div>
          <div class="f-field ancho"><label>Cuándo usarlo</label><input data-c="ayuda" value="${esc(c.ayuda||'')}" /></div>
        </div>`;
      caja.querySelectorAll('[data-c]').forEach(n=>{
        n.oninput = ()=>{
          const lista = criterios().slice();
          lista[i] = Object.assign({}, lista[i], {[n.dataset.c]: n.value});
          AJUSTES.set('criterios_agrupacion', lista);
        };
      });
      const usos = [...FAMS.values()].filter(f=>f.criterio===c.id).length;
      const pie = el('div','crit-pie');
      pie.appendChild(el('span','crit-uso', usos ? `Lo usan ${fmt(usos)} agrupación(es)` : 'Sin usar'));
      const del = el('button','fed-mini danger','🗑');
      del.title = usos ? 'No se puede eliminar: hay agrupaciones usándolo' : 'Eliminar este tipo';
      del.disabled = !!usos;
      del.onclick = ()=>{
        AJUSTES.set('criterios_agrupacion', criterios().filter((_,j)=>j!==i));
        renderAjustes();
      };
      pie.appendChild(del);
      caja.appendChild(pie);
      cri.appendChild(caja);
    });
  }
}

/* ---------- diccionario de búsqueda ----------
   Lo que el cliente escribe → con qué OTRA cosa hay que buscarlo también. El
   catálogo ya entiende solo las fracciones habladas y las unidades; esta lista
   es para el vocabulario del mostrador, que sólo conoce quien atiende. */
const sinonimos = () => {
  const v = AJUSTES.get('sinonimos_busqueda');
  return Array.isArray(v) ? v : [];
};

function renderSinonimos(){
  const cont = $('#sinLista'); if (!cont) return;
  cont.innerHTML = '';
  const lista = sinonimos();
  if (!lista.length){
    cont.appendChild(el('div','vacio','Todavía no hay ninguna. Agrega las palabras que la gente usa en el mostrador y el catálogo no reconoce.'));
    return;
  }
  lista.forEach((s, i)=>{
    const fila = el('div','sin-fila');
    fila.innerHTML = `
      <div class="f-field"><label>Si el cliente escribe…</label>
        <input data-c="de" value="${esc(s.de||'')}" placeholder="ptr" /></div>
      <span class="sin-flecha">→</span>
      <div class="f-field"><label>…búscalo también como</label>
        <input data-c="a" value="${esc(s.a||'')}" placeholder="tubular cuadrado" /></div>`;
    fila.querySelectorAll('[data-c]').forEach(n=>{
      n.oninput = ()=>{
        const l = sinonimos().slice();
        l[i] = Object.assign({}, l[i], {[n.dataset.c]: n.value});
        AJUSTES.set('sinonimos_busqueda', l);
      };
    });
    const del = el('button','fed-mini danger','✕');
    del.title = 'Quitar esta traducción';
    del.onclick = ()=>{ AJUSTES.set('sinonimos_busqueda', sinonimos().filter((_,j)=>j!==i)); renderSinonimos(); };
    fila.appendChild(del);
    cont.appendChild(fila);
  });
}

/* `de` puede venir pre-llenado desde «lo que más buscan»: ahí es donde se
   descubre qué palabra no entiende el catálogo. */
async function nuevoSinonimo(de){
  const v = await dialogo({ titulo:'Nueva palabra del cliente',
    texto:'Cuando alguien busque la primera palabra, el catálogo buscará también la segunda. No quita resultados: los suma.',
    campos:[
      {id:'de', label:'Si el cliente escribe…', tipo:'text', valor:de||'', placeholder:'p. ej. ptr'},
      {id:'a',  label:'…búscalo también como',  tipo:'text', valor:'',     placeholder:'p. ej. tubular cuadrado'},
    ], okTxt:'Agregar' });
  if (!v) return;
  const d = (v.de||'').trim(), a = (v.a||'').trim();
  if (!d || !a){ aviso('Hacen falta las dos palabras.'); return; }
  AJUSTES.set('sinonimos_busqueda', [...sinonimos(), {de:d, a}]);
  if (PLUS.panel === 'ajustes') renderSinonimos();
  aviso('Traducción agregada. Pulsa «☁ Publicar cambios» en Sucursales y textos para aplicarla.');
}

async function nuevaSucursal(){
  const v = await dialogo({ titulo:'Nueva sucursal',
    campos:[
      {id:'nombre', label:'Nombre', tipo:'text', valor:'', placeholder:'p. ej. Sucursal Perote'},
      {id:'whatsapp', label:'WhatsApp (con 52 al inicio)', tipo:'text', valor:'52', placeholder:'522281234567'},
      {id:'direccion', label:'Dirección completa', tipo:'text', valor:''},
    ], okTxt:'Crear sucursal' });
  if (!v) return;
  const nombre = (v.nombre||'').trim();
  if (!nombre){ aviso('Escribe el nombre de la sucursal.'); return; }
  SUCS.push({ clave: slug(nombre), nombre, whatsapp:(v.whatsapp||'').replace(/\D/g,''),
    direccion:(v.direccion||'').trim(), orden: SUCS.length+1, activa:true });
  renderAjustes();
  aviso('Sucursal agregada. Pulsa «☁ Publicar cambios» para que aparezca en el catálogo.');
}

async function nuevoCriterio(){
  const v = await dialogo({ titulo:'Nuevo tipo de agrupación',
    texto:'Sirve para agrupar productos con un criterio que hoy no está en la lista. El rótulo es lo que el cliente ve encima de la columna donde elige.',
    campos:[
      {id:'nombre', label:'Nombre', tipo:'text', valor:'', placeholder:'p. ej. Por resistencia'},
      {id:'columna', label:'Rótulo de la columna', tipo:'text', valor:'', placeholder:'p. ej. Resistencia'},
      {id:'ayuda', label:'Cuándo usarlo', tipo:'text', valor:'', placeholder:'Explícalo para quien venga después'},
    ], okTxt:'Crear tipo' });
  if (!v) return;
  const nombre = (v.nombre||'').trim();
  const columna = (v.columna||'').trim();
  if (!nombre || !columna){ aviso('Hacen falta el nombre y el rótulo.'); return; }
  const lista = criterios().slice();
  let id = slug(nombre); let i=2;
  while (lista.some(c=>c.id===id)) id = slug(nombre)+'-'+(i++);
  lista.push({ id, nombre, columna, ayuda:(v.ayuda||'').trim() });
  AJUSTES.set('criterios_agrupacion', lista);
  renderAjustes();
  aviso('Tipo agregado. Pulsa «☁ Publicar cambios» para guardarlo.');
}

async function publicarAjustes(){
  if (!requiereSesion('publicar los cambios')) return;
  // Sucursales: una por una, porque unas son altas y otras ediciones.
  for (const s of SUCS){
    const fila = { clave: s.clave || slug(s.nombre), nombre:s.nombre||'',
      whatsapp:String(s.whatsapp||'').replace(/\D/g,''), direccion:s.direccion||'',
      orden:+s.orden||0, activa:s.activa!==false, updated_by:SB_YO };
    if (s.id) fila.id = s.id;
    const { data, error } = await SBC.from('sucursales')
      .upsert(fila, { onConflict:'clave' }).select('id').limit(1);
    if (error){ aviso('⚠ Sucursal «'+s.nombre+'»: '+error.message); return; }
    if (data && data[0]) s.id = data[0].id;
  }
  const okT = await guardarAjuste('textos_catalogo', AJUSTES.get('textos_catalogo')||{});
  const okC = await guardarAjuste('criterios_agrupacion', criterios());
  // Sólo se publican las traducciones completas: una a medio escribir no aporta.
  const okS = await guardarAjuste('sinonimos_busqueda',
    sinonimos().filter(s => s && (s.de||'').trim() && (s.a||'').trim()));
  if (okT && okC && okS){
    bitacora('Sucursales, textos, tipos de agrupación y diccionario de búsqueda publicados');
    aviso('✓ Publicado: el catálogo lo toma al refrescar');
  }
  renderAjustes();
}

/* ===========================================================================
   PESTAÑA · GUÍA
   =========================================================================== */
function renderGuia(){
  const c = $('#guiaCuerpo'); if (!c || c.dataset.listo) return;
  c.dataset.listo = '1';
  c.innerHTML = `
    <h2>Cómo se usa esta herramienta</h2>
    <p class="guia-intro">Todo lo que cambies aquí llega al catálogo que ven los clientes. No hay
       nada que programar y <b>no se puede romper nada</b>: cada cambio se guarda solo, queda
       registrado en la <b>Bitácora</b> y se puede deshacer con <b>↩ Deshacer</b> (o Ctrl+Z).</p>

    <div class="guia-aviso">
      <b>Antes que nada: inicia sesión.</b> Pulsa <b>«Guardar / Exportar»</b> arriba a la derecha y
      escribe tu correo y contraseña. Mira el indicador de arriba:
      <br>· <b>«● En línea»</b> → todo lo que hagas se guarda para todos. Perfecto.
      <br>· <b>«○ Sin sesión»</b> → tus cambios se quedan sólo en esta computadora y nadie más los ve.
      <br>· <b>«⚠ Sin permiso para editar»</b> → tu cuenta existe pero no está autorizada. Avisa
      para que agreguen tu correo a la lista de editores; hasta entonces <b>nada de lo que hagas
      se guardará para los demás</b>.
    </div>

    <h3>📦 Productos — dar de alta y arreglar lo que ya existe</h3>
    <ol>
      <li><b>Producto nuevo:</b> botón <b>«＋ Nuevo producto»</b> arriba. Pide el código (el mismo que
          usan en el sistema de la tienda), el nombre, la medida y la categoría. Si todavía no sabes
          en qué categoría va, déjalo en <b>POR CLASIFICAR</b> y decídelo después.</li>
      <li><b>Ponerle foto:</b> al terminar se abre su ficha. Pulsa <b>«🖼 Cambiar foto»</b>, elige la
          imagen y encuádrala arrastrando. Lo que ves en el recuadro es exactamente lo que verá el cliente.</li>
      <li><b>Toda una serie:</b> si el mismo producto viene en 12 medidas, captura el primero y usa
          <b>«⧉ Duplicar producto»</b> once veces: sólo cambias código y medida.</li>
      <li><b>Corregir:</b> haz clic en el nombre de cualquier producto para abrir su ficha. Se puede
          cambiar nombre, medida, proveedor, categoría y foto.</li>
      <li><b>Dejar de venderlo:</b> <b>«🚫 Retirar del catálogo»</b>. Desaparece para el cliente pero
          se conserva aquí por si vuelve. <b>«🗑 Eliminar»</b> es sólo para deshacer una captura mal hecha.</li>
      <li><b>Mover muchos a la vez:</b> selecciónalos (clic, o mantén el clic y arrastra sobre la lista)
          y usa la barra de abajo, o arrástralos a la categoría del panel izquierdo.</li>
    </ol>

    <h3>🗂 Agrupaciones — que veinte soleras no ocupen veinte tarjetas</h3>
    <p>Cuando el mismo producto viene en muchas variantes, el cliente no debería tener que
       recorrerlas todas. Una agrupación las junta en <b>una tarjeta</b> y mueve la elección adentro.</p>
    <ol>
      <li>Ve a <b>Agrupaciones</b> → <b>«＋ Nueva agrupación»</b>.</li>
      <li>Ponle el nombre que verá el cliente («Solera»), su categoría, y elige
          <b>por qué se agrupan</b>: por medida, por calibre, por función, por modelo…</li>
      <li>Ese criterio no es un adorno: <b>cambia el rótulo de la columna</b> donde el cliente elige.
          Si agrupas láminas por calibre, la columna dirá «Calibre» y no «Medida».</li>
      <li><b>Ponle su propia foto</b> (arriba a la izquierda del editor). Si no le pones ninguna,
          la tarjeta toma prestada la de alguno de sus productos — y esa suele ser la de la medida
          que quedó primera, no la que mejor vende. En la lista, las que ya tienen foto propia
          llevan el recuadro con borde azul.</li>
      <li>Agrega los productos con <b>«＋ Agregar productos»</b>. Si dentro hay familias distintas
          (discos de corte, de desbaste, de diamante), usa <b>«⑂ Dividir en grupos»</b>.</li>
      <li>Abajo del editor tienes la <b>vista previa</b>: así queda en el catálogo.</li>
    </ol>
    <p class="guia-aviso"><b>¿La creaste y no aparece en el catálogo?</b> Casi siempre es una
       de estas dos:
       <br>1. <b>Estás viendo «Todas las categorías»</b>. Las agrupaciones sólo se ven al
       <b>entrar a una categoría</b> — en la lista general el catálogo muestra producto por
       producto, a propósito.
       <br>2. <b>La categoría no cuadra.</b> La ficha aparece donde están sus productos, no
       donde dice la agrupación. Si no coinciden, el editor te lo marca en ámbar con un botón
       para cuadrarlo, y también te pregunta al guardar.
       <br>Y recuerda que necesita <b>al menos 2 productos</b> que sigan publicados.</p>
    <p class="guia-tip">Atajo: selecciona productos en la pestaña <b>Productos</b> y pulsa
       <b>«＋ Con lo seleccionado»</b> en Agrupaciones — llegan ya puestos.</p>

    <h3>⭐ Destacados — lo primero que se ve</h3>
    <ol>
      <li>Agrega los productos o agrupaciones que más se venden y ordénalos con ▲ ▼.</li>
      <li>A la derecha aparece <b>lo que los clientes piden de verdad</b>: el catálogo cuenta cada
          pedido que se manda por WhatsApp. Al principio estará vacío; se llena solo con el uso.</li>
      <li>Pulsa <b>«☁ Publicar destacados»</b> para que aparezcan en la portada.</li>
    </ol>

    <h3>🏬 Sucursales y textos</h3>
    <p>Nombre, WhatsApp y dirección de cada sucursal. La dirección es la que el cliente ve en su
       pedido y la que abre Google Maps al tocarla, así que escríbela completa. Al terminar, pulsa
       <b>«☁ Publicar cambios»</b>.</p>

    <h3>🔎 Que el buscador entienda a tus clientes</h3>
    <p>La gente no busca como está capturado el catálogo: pide <b>«media pulgada»</b>,
       <b>«PTR de 2x2»</b>, <b>«un octavo»</b>. Las fracciones habladas y las unidades
       (pulgada, milímetros, calibre) el catálogo ya las entiende solo. Lo que no puede adivinar
       es el <b>vocabulario del mostrador</b>, y eso se lo enseñas tú:</p>
    <ol>
      <li>Ve a <b>Destacados</b> y mira el recuadro <b>«⚠ Buscaron esto y no encontraron nada»</b>.
          Ahí está, en palabras de tus clientes, lo que el catálogo no supo darles.</li>
      <li>En cada una tienes dos botones: <b>«＋ enseñar palabra»</b> (si el producto sí existe pero
          se llama de otro modo) y <b>«＋ dar de alta»</b> (si de plano falta).</li>
      <li>También puedes agregarlas a mano en <b>Sucursales y textos → Palabras que usa el cliente</b>,
          y publicarlas con <b>«☁ Publicar cambios»</b>.</li>
    </ol>
    <p class="guia-tip">Una traducción nunca quita resultados: <b>suma</b>. Lo que el cliente
       escribió sigue valiendo, así que equivocarte al traducir no puede esconder productos.</p>

    <h3>👥 Si son dos o más trabajando</h3>
    <p>Se puede, y se ven entre ustedes <b>al momento</b>, sin recargar la página:</p>
    <ul>
      <li><b>En vivo (≈1 segundo):</b> clasificar, corregir, poner fotos, <b>dar de alta</b> y
          <b>eliminar</b> productos, y crear o editar <b>agrupaciones</b>.</li>
      <li><b>Con aviso:</b> destacados, sucursales, textos y el diccionario de búsqueda. Cuando
          alguien los cambia sale un aviso y tú pulsas <b>«⟲ Traer del equipo»</b> cuando
          quieras. Se hace así a propósito: son formularios, y recargarlos solos te borraría
          lo que estás escribiendo sin publicar.</li>
    </ul>
    <p class="guia-aviso"><b>Los dos tienen que iniciar sesión.</b> Sin sesión no llega nada en
       vivo y los cambios se quedan en cada computadora.</p>
    <p class="guia-tip"><b>Repártanse por categoría</b> (uno los discos, otro los perfiles). Si
       dos tocan lo mismo, <b>gana el último que guarda</b>. La única excepción es el editor de
       agrupaciones: ahí sí te avisa si alguien cambió justo la que tienes abierta.</p>

    <h3>¿Y si me equivoco?</h3>
    <ul>
      <li><b>↩ Deshacer</b> (o Ctrl+Z) revierte el último cambio.</li>
      <li><b>Bitácora</b> guarda todo lo que se hizo y cuándo.</li>
      <li>Eliminar una agrupación <b>no borra productos</b>: sólo dejan de mostrarse juntos.</li>
      <li>Retirar un producto <b>no lo borra</b>: queda en «Productos Descontinuados / Ocultos» y se
          puede devolver moviéndolo a su categoría.</li>
    </ul>

    <h3>Cuando termines de trabajar</h3>
    <p>Comprueba que arriba diga <b>«● En línea · 0 pendientes»</b>. Eso significa que todo subió.
       Abre <b>«Ver catálogo ↗»</b> y refresca para verlo como lo ve el cliente.</p>`;
}

/* ===========================================================================
   AUTOPRUEBA (la llama selfTest() de clasificador.js con ?selftest=1)
   =========================================================================== */
function plusSelfTest(){
  const res = [];
  const t = (nombre, ok)=>res.push((ok?'PASS':'FAIL')+' '+nombre);

  // El criterio decide el rótulo: es la razón de ser de la mejora.
  t('criterio → rótulo de columna', criterioDe('medida').columna==='Medida');
  t('criterio desconocido no rompe', !!criterioDe('no-existe-este').columna);
  t('rótulo propio manda sobre el criterio',
    columnaDe({criterio:'medida', columna:'Espesor'})==='Espesor');
  t('sin rótulo propio manda el criterio',
    columnaDe({criterio:'calibre', columna:''})===criterioDe('calibre').columna);

  // Identidad de la agrupación
  const idA = idFamiliaLibre('Perfiles', 'Solera');
  t('id de agrupación es legible', idA==='perfiles--solera' || /^perfiles--solera(-\d+)?$/.test(idA));
  t('slug quita acentos', slug('Tornillería Peñascal')==='tornilleria-penascal');

  // Estructura de subgrupos
  const fam = { id:'x', nombre:'X', cat:'C', criterio:'medida', activa:true,
    subgrupos:[{nombre:'A', cods:['c1','c2']}, {nombre:'B', cods:['c3']}] };
  t('cods recorre todos los grupos', codsDe(fam).join(',')==='c1,c2,c3');
  t('normalizar rellena lo que falta', (()=>{
    const n = normalizarFamilia({id:'y', nombre:'Y', cat:'C'});
    return n.criterio==='medida' && n.activa===true && n.subgrupos.length===1;
  })());
  t('normalizar respeta activa=false', normalizarFamilia({id:'z',nombre:'Z',cat:'C',activa:false}).activa===false);

  // Orden por medida: el mismo que usa el catálogo dentro de la ficha
  t('claves de medida leen fracciones', (()=>{
    const k = clavesMedida('1/8 X 1 1/2"');
    return k.length===2 && Math.abs(k[0]-0.125)<1e-9 && Math.abs(k[1]-1.5)<1e-9;
  })());
  t('milímetros se comparan como pulgadas', (()=>{
    const k = clavesMedida('254 MM');
    return k.length===1 && Math.abs(k[0]-10)<1e-9;
  })());

  // Foto de portada: la propia manda; si no hay, se toma prestada de un producto
  t('foto propia de la agrupación manda',
    fotoEfectivaFamilia({foto:'https://x/y.webp', subgrupos:[]}).propia === true);
  t('sin foto propia se presta la de un producto', (()=>{
    const p = PRODUCTOS.find(x=>x.foto);
    if (!p) return true;                       // catálogo sin fotos: nada que probar
    const r = fotoEfectivaFamilia({foto:'', subgrupos:[{nombre:'—', cods:[p.cod]}]});
    return r.propia === false && !!r.url && r.de === p;
  })());
  t('sin ninguna foto no inventa una',
    fotoEfectivaFamilia({foto:'', subgrupos:[{nombre:'—', cods:['NO-EXISTE']}]}).url === '');
  t('normalizar conserva la foto', normalizarFamilia({id:'f',nombre:'F',cat:'C',foto:'u'}).foto === 'u');

  // Un producto en dos agrupaciones dejaría al catálogo sin saber cuál mostrar
  t('detecta código repetido en otra agrupación', (()=>{
    const antes = FAMS.get('__test__');
    FAMS.set('__test__', normalizarFamilia({id:'__test__', nombre:'T', cat:'C',
      subgrupos:[{nombre:'—', cods:['ZZZ-CODIGO-PRUEBA']}]}));
    const hallada = familiaConCodigo('ZZZ-CODIGO-PRUEBA', 'otra');
    const propia  = familiaConCodigo('ZZZ-CODIGO-PRUEBA', '__test__');
    FAMS.delete('__test__'); if (antes) FAMS.set('__test__', antes);
    return !!hallada && propia===null;
  })());

  return res;
}

/* Este archivo se carga DESPUÉS de clasificador.js, así que cuando su selfTest()
   corrió, plusSelfTest() todavía no existía. En vez de complicar el arranque,
   estas pruebas se añaden a la misma franja de resultados al final. */
function plusPintarSelfTest(){
  if (new URLSearchParams(location.search).get('selftest') !== '1') return;
  let res;
  try{ res = plusSelfTest(); }
  catch(e){ res = ['FAIL excepción (agrupaciones): '+e.message]; }
  const franja = document.getElementById('selftest');
  if (!franja){ console.log(res.join(' | ')); return; }
  franja.textContent = franja.textContent + ' | ' + res.join(' | ');
  if (franja.dataset.ok !== 'false')
    franja.dataset.ok = String(res.every(r=>r.startsWith('PASS')));
}

/* ===========================================================================
   ENGANCHES E INICIO
   =========================================================================== */
/* Lo llama renderAll() de clasificador.js: los conteos de las agrupaciones
   dependen de los productos, así que hay que repintar cuando ellos cambian. */
function plusAlRenderizar(){
  if (PLUS.panel === 'familias')   renderFamilias();
  if (PLUS.panel === 'destacados') renderDestacados();
}

function initPlus(){
  document.querySelectorAll('#tabs .tab').forEach(b=>{
    b.onclick = ()=>irAPanel(b.dataset.panel);
  });

  // Agrupaciones
  $('#famNueva').onclick = ()=>nuevaAgrupacion(null);
  $('#famDesdeSel').onclick = ()=>{
    const cods = [...state.sel].map(id=>IDX.get(id)).filter(Boolean).map(p=>p.cod);
    if (cods.length < 2){ aviso('Selecciona al menos 2 productos en la pestaña Productos.'); return; }
    nuevaAgrupacion(cods);
  };
  $('#famImportar').onclick = importarFamiliasRespaldo;
  let tq; $('#famQ').addEventListener('input', e=>{
    clearTimeout(tq); tq = setTimeout(()=>{ PLUS.famQ = e.target.value; renderFamilias(); }, 140);
  });
  $('#famCat').onchange  = (e)=>{ PLUS.famCat = e.target.value; renderFamilias(); };
  $('#famCrit').onchange = (e)=>{ PLUS.famCrit = e.target.value; renderFamilias(); };
  $('#famOk').onclick = guardarEditorFamilia;
  $('#famCancel').onclick = cerrarEditorFamilia;
  $('#famClose').onclick = cerrarEditorFamilia;
  $('#modalFam').addEventListener('click', e=>{ if (e.target.id==='modalFam') cerrarEditorFamilia(); });

  // Selector de productos
  let tp; $('#pickQ').addEventListener('input', e=>{
    clearTimeout(tp); tp = setTimeout(()=>{ PICK.q = e.target.value; pintarSelector(); }, 140);
  });
  $('#pickOk').onclick = ()=>{
    const cods = [...PICK.sel];
    const fn = PICK.onOk;
    cerrarSelector();
    if (fn && cods.length) fn(cods);
  };
  $('#pickCancel').onclick = cerrarSelector;
  $('#pickClose').onclick = cerrarSelector;
  $('#modalPick').addEventListener('click', e=>{ if (e.target.id==='modalPick') cerrarSelector(); });

  // Destacados
  $('#desAgregar').onclick = ()=>abrirSelector({
    titulo:'Agregar productos a la portada',
    excluir: DESTACADOS.filter(d=>d.t==='p').map(d=>d.c),
    onOk:(cods)=>{ cods.forEach(c=>DESTACADOS.push({t:'p', c})); renderDestacados(); },
  });
  $('#desAgregarFam').onclick = async ()=>{
    const libres = [...FAMS.values()]
      .filter(f=>f.activa && !DESTACADOS.some(d=>d.t==='f' && d.c===f.id))
      .sort((a,b)=>alfa(a.nombre,b.nombre));
    if (!libres.length){ aviso('No hay agrupaciones disponibles para agregar.'); return; }
    const v = await dialogo({ titulo:'Agregar agrupación a la portada',
      campos:[{id:'id', label:'Agrupación', tipo:'select',
        opciones:libres.map(f=>({v:f.id, t:`${f.nombre} — ${f.cat} (${nProductosDe(f)})`}))}],
      okTxt:'Agregar' });
    if (!v) return;
    DESTACADOS.push({t:'f', c:v.id});
    renderDestacados();
  };
  $('#desGuardar').onclick = publicarDestacados;
  $('#popRango').onchange = (e)=>{ PLUS.popRango = e.target.value; renderPopulares(); };
  $('#popRefrescar').onclick = ()=>cargarPopulares(true);
  $('#popUsar').onclick = async ()=>{
    const campo = PLUS.popRango==='30' ? 'pedidos_30d' : (PLUS.popRango==='90' ? 'pedidos_90d' : 'pedidos');
    const top = POPU.slice().filter(r=>(r[campo]||0)>0)
      .sort((a,b)=>(b[campo]||0)-(a[campo]||0)).slice(0,12);
    if (!top.length){ aviso('Todavía no hay pedidos suficientes para armar la lista.'); return; }
    const ok = await dialogo({ titulo:'Usar los más pedidos',
      texto:`La portada quedará con los ${top.length} productos más pedidos del periodo elegido, reemplazando la lista actual.`,
      okTxt:'Reemplazar la portada' });
    if (!ok) return;
    DESTACADOS = top.map(r=>({t:'p', c:r.cod}));
    renderDestacados();
  };

  // Sucursales y textos
  $('#sucNueva').onclick = nuevaSucursal;
  $('#ajGuardar').onclick = publicarAjustes;
  $('#critNuevo').onclick = nuevoCriterio;
  $('#sinNuevo').onclick = ()=>nuevoSinonimo('');

  // Esc cierra también los modales nuevos (el de clasificador.js no los conoce)
  document.addEventListener('keydown', e=>{
    if (e.key !== 'Escape') return;
    if (!$('#modalPick').hidden){ cerrarSelector(); e.stopPropagation(); return; }
    if (!$('#modalFam').hidden){ cerrarEditorFamilia(); e.stopPropagation(); }
  }, true);

  /* «⟲ Traer del equipo» tenía que traer TODO, no sólo los productos: quien lo
     pulsa espera ponerse al día con sus compañeros, no a medias. */
  const btnPull = $('#btnPull');
  if (btnPull){
    const traerProductos = btnPull.onclick;
    btnPull.title = 'Trae del equipo lo último: productos, agrupaciones, destacados, sucursales y ajustes. '
                  + 'Tus cambios de clasificación no se pisan; lo que tengas escrito y SIN publicar en Destacados o Ajustes, sí.';
    btnPull.onclick = async (e)=>{
      if (traerProductos) await traerProductos.call(btnPull, e);
      await cargarEnLinea(false);
    };
  }

  cargarEnLinea(true);
  if (SB.user) iniciarRealtimePlus();
  // Sesión y tiempo real van juntos: RLS no emite eventos a quien no ha entrado,
  // y el conteo de pedidos tampoco se puede leer sin ella.
  if (SBC) SBC.auth.onAuthStateChange((_ev, session)=>{
    if (session?.user){ cargarPopulares(false); cargarEnLinea(true); iniciarRealtimePlus(); }
    else pararRealtimePlus();
  });

  plusPintarSelfTest();
}

initPlus();
