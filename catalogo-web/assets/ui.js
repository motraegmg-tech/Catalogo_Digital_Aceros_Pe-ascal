import { state, DATA, CONFIG, saveLS, LS_OVR, LS_VIEW, fotosSet } from '../core/store.js';
import { getCartItems, cantidadEnCarrito } from '../core/cartService.js';
import { searchAndSortProducts, normalize, alfa } from '../core/searchService.js';
import { hayFamilias, familiaDe, subgrupoDe, productosDeFamilia, ordenSubgrupos, ordenarPorMedida, familiaPorId, columnaDe, catPrincipalDe } from '../core/familiaService.js';
import { AJUSTES } from '../core/ajustesService.js';

export const $ = (s, r = document) => r.querySelector(s);
export const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
export const esc = (s) => (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const esMovil = () => window.matchMedia('(max-width:880px)').matches;

const PLACEHOLDER = `<div class="ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/></svg><span>Sin foto</span></div>`;
export const PIN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;

export function asArray(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }

const POR_CLASIF = 'POR CLASIFICAR';
// Etiqueta de clasificación para la primera vista (tarjeta): SIEMPRE visible.
// Muestra la subcategoría cuando aporta detalle; si no, la categoría; y si el
// producto aún no está clasificado, lo señala en vez de dejar la tarjeta muda.
export function clasifLabel(p) {
  if (p.sub && p.sub !== POR_CLASIF && p.sub !== p.cat) return { txt: p.sub, pend: false };
  if (p.cat && p.cat !== POR_CLASIF) return { txt: p.cat, pend: false };
  return { txt: 'Por clasificar', pend: true };
}

/**
 * La misma etiqueta, para una ficha de familia. Se calcula sobre los productos
 * que la ficha muestra hoy —no sobre el dato guardado al aprobarla— para que no
 * envejezca cuando algo se reclasifica.
 *
 * Una familia puede abarcar varias subcategorías (Ángulos + Cuadrados): se
 * nombran las dos primeras. Si ninguna aporta detalle, cae a la categoría, igual
 * que un producto suelto.
 */
export function clasifLabelFamilia(fam, productos) {
  // Se compara contra la categoría REAL de la ficha, no contra la declarada:
  // si no, una `cat` desfasada haría que la etiqueta repitiera la categoría.
  const cat = catPrincipalDe(fam.id) || fam.cat;
  const subs = [...new Set(productos.map(p => p.sub))]
    .filter(s => s && s !== POR_CLASIF && s !== cat)
    .sort(alfa);
  if (subs.length) return { txt: subs.slice(0, 2).join(' · ') + (subs.length > 2 ? ` +${subs.length - 2}` : ''), pend: false };
  if (cat && cat !== POR_CLASIF) return { txt: cat, pend: false };
  return { txt: 'Por clasificar', pend: true };
}

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


/**
 * Determina si un producto tiene una foto que EXISTE físicamente en disco.
 * Consulta fotosSet (importado de store.js), un Set de stems de archivos reales
 * generado por pipeline/generar_manifest_fotos.py y cargado al inicio de la app.
 */
function tienefoto(p) {
  if (fotosSet.size === 0) return false;
  // URL externa: válida por definición
  if (typeof p.foto === 'string' && /^https?:\/\//i.test(p.foto)) return true;
  // Verificar si el archivo existe en disco vía el manifest
  // p.id es el mismo valor que fuentesFoto() usa para construir fotos/{p.id}.webp
  const stemFoto = typeof p.foto === 'string' ? p.foto.replace(/\.[^.]+$/, '') : '';
  return fotosSet.has(p.id) || (stemFoto !== '' && fotosSet.has(stemFoto));
}

/** Orden alfabético A→Z aplicado al nombre de un producto (ver `alfa`). */
export const alfaNombre = (a, b) => alfa(a.nom, b.nom);

export function getSearchResults() {
  return state.q ? searchAndSortProducts(state.q, DATA.productos) : DATA.productos;
}

export function filteredProducts() {
  const result = getSearchResults().filter(p => {
    if (state.cat && p.cat !== state.cat) return false;
    if (state.sub && p.sub !== state.sub) return false;
    return true;
  });

  /* Navegando (sin término de búsqueda) el orden es alfabético A→Z **de corrido**,
     una sola pasada. Antes los productos con foto iban primero y los sin foto
     después, pero eso partía el catálogo en dos abecedarios: se bajaba hasta la Z
     y volvía a empezar en la A. Buscando manda el ranking de searchService. */
  if (!state.q.trim()) return result.slice().sort(alfaNombre);
  return result;
}


/* ===== Agrupación en fichas de familia =====
   Decisión de Gonzalo (2026-07-31): la agrupación NO sustituye la vista actual,
   convive con ella. Solo entra al bajar a una categoría, que es donde estorba el
   ruido de veinte soleras seguidas. En "Todas las categorías" y en la búsqueda
   el catálogo sigue mostrando producto por producto. */

// Con una sola medida no hay nada que elegir: ese producto va como ficha suelta.
const MIN_EN_FICHA = 2;

export const agrupando = () => !!state.cat && !state.q.trim() && hayFamilias();

/** El nombre con el que una tarjeta se ordena y se lee, sea de familia o de producto. */
export const rotulo = (e) => e.tipo === 'familia' ? e.fam.nombre : e.p.nom;

/**
 * Lo que se pinta en la grilla: fichas de familia y productos sueltos mezclados.
 * Devuelve siempre entradas {tipo:'familia'|'producto'}, agrupe o no, para que
 * renderGrid tenga una sola forma de recorrer.
 *
 * Una familia se muestra completa SOLO en su categoría principal (donde tiene
 * más productos). En las otras categorías sus productos aparecen sueltos: así la
 * ficha nunca sale duplicada ni partida, y aun así no se esconde nada.
 */
export function filteredEntries() {
  const lista = filteredProducts();
  if (!agrupando()) return lista.map(p => ({ tipo: 'producto', p }));

  const fichas = new Map();
  const descartadas = new Set();

  for (const p of lista) {
    const f = familiaDe(p);
    /* La ficha se muestra en la categoría donde de verdad están sus productos
       (catPrincipalDe), no en la que declara el campo `cat`. Ese campo lo elige
       una persona al crearla y se queda atrás en cuanto algo se reclasifica; si
       se le hace caso, la ficha desaparece de las dos categorías a la vez. */
    if (!f || catPrincipalDe(f.id) !== state.cat || fichas.has(f.id) || descartadas.has(f.id)) continue;
    // El chip de subcategoría se aplica dentro de la ficha: si el usuario pidió
    // "Soleras", la ficha muestra soleras y su conteo dice la verdad.
    const dentro = productosDeFamilia(f.id).filter(x => !state.sub || x.sub === state.sub);
    if (dentro.length < MIN_EN_FICHA) { descartadas.add(f.id); continue; }
    fichas.set(f.id, { tipo: 'familia', fam: f, productos: ordenarPorMedida(dentro) });
  }

  const sueltos = lista
    .filter(p => { const f = familiaDe(p); return !f || !fichas.has(f.id); })
    .map(p => ({ tipo: 'producto', p }));

  /* Una sola corrida A→Z mezclando fichas y sueltos. Ponerlas en dos bloques
     —primero todas las fichas, luego todos los productos— hacía que la categoría
     llegara a la Z y volviera a empezar en la A: la ficha de SOLERA quedaba
     lejísimos de la solera suelta que no entró en ninguna familia. */
  return [...fichas.values(), ...sueltos].sort((a, b) => alfa(rotulo(a), rotulo(b)));
}

/**
 * Portada de una ficha de familia. Manda la foto que el encargado le puso a la
 * agrupación desde el clasificador; si no tiene, se toma prestada la del primer
 * producto que sí tenga (y si ninguna, la de en medio, para que al menos la
 * tarjeta no quede siempre con el mismo hueco).
 *
 * La prestada es una emergencia razonable, pero una ficha «Solera» se vende
 * mejor con la foto del producto genérico que con la de la medida que
 * casualmente quedó primera — por eso la propia gana siempre.
 */
function portadaDe(fam, productos) {
  if (fam && fam.foto) return { id: 'fam-' + fam.id, foto: fam.foto, nom: fam.nombre };
  return productos.find(tienefoto) || productos[Math.floor(productos.length / 2)];
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

  // A→Z, no en el orden en que aparecen en los datos: la lista de categorías se
  // recorre con la vista y hay que poder ir directo a la que se busca.
  [...DATA.categorias].sort((a, b) => alfa(a.nombre, b.nombre)).forEach(c => {
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
    // Buscando manda la relevancia: la categoría con más aciertos va primero.
    [...conteos.entries()].sort((a, b) => b[1] - a[1] || alfa(a[0], b[0])).forEach(([nombre, n]) => {
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

  // También A→Z: navegando, todo el catálogo se lee en el mismo orden.
  [...subs].sort((a, b) => alfa(a.nombre, b.nombre)).forEach(su => {
    const c = el('button', 'chip' + (state.sub === su.nombre ? ' on' : ''), `${esc(su.nombre)} · ${su.n}`);
    c.onclick = () => onSubSelect(su.nombre);
    wrap.appendChild(c);
  });
}

// Renderizado del Grid
function cardProducto(p, onAdd, onView) {
  const c = el('div', 'card');
  c.appendChild(thumb(p, onView));
  const body = el('div', 'card-body');
  const name = el('div', 'card-name', esc(p.nom)); name.onclick = () => onView(p);
  body.appendChild(name);

  const meta = el('div', 'card-meta');
  const cl = clasifLabel(p);
  meta.appendChild(el('span', 'tag ' + (cl.pend ? 'pend' : 'sub'), esc(cl.txt)));
  // La medida es el dato que más se consulta al cotizar: va en su propio
  // recuadro, rotulado y a tamaño legible, no como una etiqueta más.
  if (p.med) meta.appendChild(el('span', 'med-box', '<i>Medida</i><b>' + esc(p.med) + '</b>'));
  body.appendChild(meta);
  body.appendChild(el('div', 'card-cod', 'Cód: ' + esc(p.cod)));

  const foot = el('div', 'card-foot');
  const add = el('button', 'btn-add', 'Agregar'); add.onclick = () => onAdd(p);
  const view = el('button', 'btn-view', 'Ver'); view.onclick = () => onView(p);
  foot.append(add, view); body.appendChild(foot); c.appendChild(body);
  return c;
}

function cardFamilia(entry, onViewFam) {
  const { fam, productos } = entry;
  const abrir = () => onViewFam(entry);
  const c = el('div', 'card card-fam');
  c.appendChild(thumb(portadaDe(fam, productos), abrir));
  c.appendChild(el('span', 'fam-badge', `${productos.length} productos`));

  const body = el('div', 'card-body');
  const name = el('div', 'card-name', esc(fam.nombre)); name.onclick = abrir;
  body.appendChild(name);

  const meta = el('div', 'card-meta');
  // Misma etiqueta que un producto suelto: la subcategoría, que es lo que ubica
  // la ficha. La categoría ya la sabe el cliente, que está parado en ella.
  const cl = clasifLabelFamilia(fam, productos);
  meta.appendChild(el('span', 'tag ' + (cl.pend ? 'pend' : 'sub'), esc(cl.txt)));
  /* El rótulo lo pone el criterio con el que se agrupó (Medida, Calibre,
     Modelo…): si estas láminas se juntaron por calibre, prometer "medidas"
     mandaría al cliente a buscar lo que no va a encontrar. */
  const rot = columnaDe(fam);
  const variantes = new Set(productos.map(p => (p.med || '').trim()).filter(Boolean)).size;
  if (variantes > 1) meta.appendChild(el('span', 'med-box', `<i>${esc(rot)}</i><b>${variantes} para elegir</b>`));
  body.appendChild(meta);

  // Los subgrupos son la promesa de la ficha: qué vas a encontrar al abrirla.
  const grupos = [...new Set(productos.map(p => subgrupoDe(p.cod)))].filter(g => g && g !== '—');
  body.appendChild(el('div', 'card-cod', grupos.length > 1
    ? esc(grupos.slice(0, 3).join(' · ')) + (grupos.length > 3 ? ` +${grupos.length - 3}` : '')
    : `${productos.length} códigos`));

  const foot = el('div', 'card-foot');
  const btn = el('button', 'btn-add', 'Elegir ' + rot.toLowerCase()); btn.onclick = abrir;
  foot.appendChild(btn); body.appendChild(foot); c.appendChild(body);
  return c;
}

/* ===== Destacados de la portada =====
   Lo primero que ve quien abre el catálogo sin buscar ni elegir categoría. La
   lista la arma el encargado desde el clasificador (pestaña Destacados) y puede
   mezclar productos sueltos y agrupaciones. Sólo aparece en la portada: en
   cuanto el cliente busca o entra a una categoría, estorba. */
export const enPortada = () => !state.cat && !state.q.trim();

/** Resuelve la lista publicada contra el catálogo cargado. Lo que ya no exista
    (un producto retirado, una agrupación borrada) simplemente no sale. */
export function entradasDestacadas() {
  if (!enPortada() || !AJUSTES.destacados.length) return [];
  const porCodigo = new Map(DATA.productos.map(p => [p.cod, p]));
  const salida = [];
  for (const d of AJUSTES.destacados) {
    if (d.t === 'f') {
      const fam = familiaPorId(d.c);
      if (!fam) continue;
      const productos = productosDeFamilia(fam.id);
      if (productos.length < MIN_EN_FICHA) continue;
      salida.push({ tipo: 'familia', fam, productos: ordenarPorMedida(productos) });
    } else {
      const p = porCodigo.get(d.c);
      if (p) salida.push({ tipo: 'producto', p });
    }
  }
  return salida;
}

function renderDestacados(onAdd, onView, onViewFam) {
  const zona = $('#destacados');
  if (!zona) return;
  const lista = entradasDestacadas();
  zona.innerHTML = '';
  zona.hidden = !lista.length;
  if (!lista.length) return;

  const t = AJUSTES.textos;
  zona.appendChild(el('div', 'dest-head', `
    <h2>${esc(t.titulo_destacados || 'Lo más pedido')}</h2>
    ${t.subtitulo_destacados ? `<p>${esc(t.subtitulo_destacados)}</p>` : ''}`));
  const fila = el('div', 'dest-grid');
  lista.forEach(e => fila.appendChild(
    e.tipo === 'familia' ? cardFamilia(e, onViewFam) : cardProducto(e.p, onAdd, onView)));
  zona.appendChild(fila);
  zona.appendChild(el('div', 'dest-sep', '<span>Todo el catálogo</span>'));
}

export function renderGrid(onAdd, onView, onViewFam) {
  const list = filteredEntries();
  const grid = $('#grid');
  const limit = state.page * CONFIG.pageSize;
  grid.innerHTML = '';
  renderDestacados(onAdd, onView, onViewFam);

  if (!list.length) {
    grid.appendChild(el('div', 'empty', DATA.total ? 'Sin resultados en todo el catálogo. Prueba con otro término, el código o la medida.' : 'No se pudo cargar el catálogo. Revisa tu conexión e inténtalo de nuevo.'));
  }

  list.slice(0, limit).forEach(e => {
    grid.appendChild(e.tipo === 'familia' ? cardFamilia(e, onViewFam) : cardProducto(e.p, onAdd, onView));
  });

  // Cuando hay fichas, el conteo dice las dos cosas: cuántas tarjetas se ven y
  // cuántos productos hay detrás. Si no, se queda como siempre.
  const nFichas = list.reduce((a, e) => a + (e.tipo === 'familia' ? 1 : 0), 0);
  const nProd = list.reduce((a, e) => a + (e.tipo === 'familia' ? e.productos.length : 1), 0);
  const num = (n) => n.toLocaleString('es-MX');
  $('#count').textContent = nFichas
    ? `${num(list.length)} fichas · ${num(nProd)} productos`
    : `${num(nProd)} productos`;

  const q = state.q.trim();
  $('#crumbs').textContent = q ? (state.cat ? `«${q}» en ${state.cat}` : `«${q}» en todo el catálogo`) : (state.cat || 'Todas las categorías');

  const more = $('#btnMore');
  if (list.length > limit) { more.hidden = false; more.textContent = `Cargar más (${num(list.length - limit)} restantes)`; }
  else { more.hidden = true; }
}

/* ===== Ficha de familia =====
   La tabla de medidas con su cantidad. Cada fila es un producto con su código:
   al confirmar entran todas de golpe al pedido, cada una como su propia línea. */

const FILAS_VISIBLES = 12;    // por subgrupo, antes de "ver las restantes"
const UMBRAL_FILTRO = 15;     // a partir de aquí la ficha trae su propio buscador

export function buildFichaFamilia(entry, onAgregar) {
  const { fam, productos } = entry;
  const pend = Object.create(null);   // cod -> cuánto se va a agregar
  const abiertos = new Set();         // subgrupos desplegados por completo
  let filtro = '';

  const root = el('div', 'fam');

  // --- Encabezado: foto de portada y de qué familia se trata
  const head = el('header', 'fam-head');
  const foto = el('div', 'fam-foto');
  const ph = thumb(portadaDe(fam, productos)); ph.style.cursor = 'default';
  foto.appendChild(ph);
  const grupos = ordenSubgrupos(fam.id).filter(g => g && g !== '—');
  const rot = columnaDe(fam);
  // Ruta completa "Categoría › Subcategoría": dentro de la ficha ya no está el
  // contexto de la grilla, así que hay que decir de dónde salió.
  const cl = clasifLabelFamilia(fam, productos);
  const catFicha = catPrincipalDe(fam.id) || fam.cat;
  const ruta = cl.txt === catFicha ? esc(catFicha) : `${esc(catFicha)} <span>›</span> ${esc(cl.txt)}`;
  const txt = el('div', 'fam-head-txt', `
    <div class="modal-cat">${ruta}</div>
    <h2 class="fam-name">${esc(fam.nombre)}</h2>
    ${fam.descripcion ? `<p class="fam-desc">${esc(fam.descripcion)}</p>` : ''}
    <p class="fam-meta">${productos.length} productos${grupos.length > 1 ? ` · ${grupos.length} grupos` : ''} · elige ${esc(rot.toLowerCase())} y cantidad</p>`);
  head.append(foto, txt);
  root.appendChild(head);

  // --- Buscador dentro de la familia (solo si hay bastantes medidas)
  if (productos.length > UMBRAL_FILTRO) {
    const tools = el('div', 'fam-tools');
    const inp = el('input', 'fam-filtro');
    inp.type = 'search';
    inp.placeholder = `Filtrar por ${rot.toLowerCase()}, código o nombre…`;
    let t;
    inp.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { filtro = inp.value; pintar(); }, 120);
    });
    tools.appendChild(inp);
    root.appendChild(tools);
  }

  const cuerpo = el('div', 'fam-body');
  root.appendChild(cuerpo);

  // --- Pie: qué llevas y el botón que lo manda todo al pedido
  const foot = el('footer', 'fam-foot');
  const resumen = el('div', 'fam-resumen');
  const btn = el('button', 'btn-quote');
  btn.onclick = () => {
    const porCodigo = new Map(productos.map(p => [p.cod, p]));
    const lineas = Object.entries(pend)
      .map(([cod, qty]) => ({ p: porCodigo.get(cod), qty }))
      .filter(l => l.p);
    if (lineas.length) onAgregar(lineas);
  };
  foot.append(resumen, btn);
  root.appendChild(foot);

  function actualizar() {
    const medidas = Object.keys(pend).length;
    const piezas = Object.values(pend).reduce((a, b) => a + b, 0);
    resumen.textContent = medidas
      ? `${medidas} ${medidas === 1 ? 'opción elegida' : 'opciones elegidas'}`
      : `Elige la cantidad de cada ${rot.toLowerCase()}`;
    btn.disabled = !piezas;
    btn.textContent = piezas
      ? `Agregar ${piezas} producto${piezas === 1 ? '' : 's'} al pedido`
      : 'Agregar al pedido';
  }

  function fila(p) {
    const row = el('div', 'fam-row');
    row.appendChild(el('span', 'fam-med', esc(p.med || '—')));

    const info = el('span', 'fam-prod', `<b>${esc(p.nom)}</b><i>${esc(p.cod)}</i>`);
    const ya = cantidadEnCarrito(p.id);
    if (ya) info.appendChild(el('em', 'fam-ya', `Ya en tu pedido: ${ya}`));
    row.appendChild(info);

    const qty = el('div', 'qty fam-qty');
    const val = el('span', null, String(pend[p.cod] || 0));
    const mover = (d) => {
      const n = Math.max(0, (pend[p.cod] || 0) + d);
      if (n) pend[p.cod] = n; else delete pend[p.cod];
      val.textContent = String(n);
      row.classList.toggle('on', n > 0);
      actualizar();
    };
    const menos = el('button', null, '−'); menos.onclick = () => mover(-1);
    menos.setAttribute('aria-label', `Quitar uno de ${p.cod}`);
    const mas = el('button', null, '+'); mas.onclick = () => mover(1);
    mas.setAttribute('aria-label', `Agregar uno de ${p.cod}`);
    qty.append(menos, val, mas);
    row.appendChild(qty);
    row.classList.toggle('on', (pend[p.cod] || 0) > 0);
    return row;
  }

  function pintar() {
    cuerpo.innerHTML = '';
    const terms = normalize(filtro).trim().split(/\s+/).filter(Boolean);
    const pasa = (p) => !terms.length || terms.every(t => normalize(`${p.nom} ${p.cod} ${p.med}`).includes(t));

    const porGrupo = new Map();
    productos.forEach(p => {
      if (!pasa(p)) return;
      const g = subgrupoDe(p.cod) || '—';
      if (!porGrupo.has(g)) porGrupo.set(g, []);
      porGrupo.get(g).push(p);
    });

    if (!porGrupo.size) {
      cuerpo.appendChild(el('div', 'fam-vacio', `Ninguna opción coincide con «${esc(filtro)}».`));
      return;
    }

    const orden = ordenSubgrupos(fam.id);
    const pos = (g) => { const i = orden.indexOf(g); return i < 0 ? 999 : i; };
    const nombres = [...porGrupo.keys()].sort((a, b) => pos(a) - pos(b));

    nombres.forEach(g => {
      const filas = porGrupo.get(g);
      const sec = el('section', 'fam-grupo');
      if (nombres.length > 1) sec.appendChild(el('h3', 'fam-grupo-tit', `${esc(g === '—' ? rot : g)}<span>${filas.length}</span>`));

      const tabla = el('div', 'fam-tabla');
      tabla.appendChild(el('div', 'fam-row fam-row-head', `<span>${esc(rot)}</span><span>Producto</span><span>Cantidad</span>`));
      // Con filtro activo se muestra todo: el usuario ya acotó lo que quería ver.
      const tope = (terms.length || abiertos.has(g)) ? filas.length : FILAS_VISIBLES;
      filas.slice(0, tope).forEach(p => tabla.appendChild(fila(p)));
      sec.appendChild(tabla);

      if (filas.length > tope) {
        const ver = el('button', 'fam-mas', `Ver las ${filas.length - tope} restantes`);
        ver.onclick = () => { abiertos.add(g); pintar(); };
        sec.appendChild(ver);
      }
      cuerpo.appendChild(sec);
    });
  }

  pintar();
  actualizar();
  return root;
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
export const pulseCart = () => $('#btnCart').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 220 });
export const openCart = () => { closeCats(); $('#cart').hidden = false; $('#overlay').hidden = false; };
export const closeCart = () => { $('#cart').hidden = true; if (!catsAbierto()) $('#overlay').hidden = true; };
export const openCats = () => { closeCart(); document.body.classList.add('cats-open'); $('#btnCats').setAttribute('aria-expanded', 'true'); $('#overlay').hidden = false; };
export const closeCats = () => { if (!catsAbierto()) return; document.body.classList.remove('cats-open'); $('#btnCats').setAttribute('aria-expanded', 'false'); if ($('#cart').hidden) $('#overlay').hidden = true; };
export const toggleCats = () => { catsAbierto() ? closeCats() : openCats(); };
export const trasElegirCat = () => { closeCats(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
export const applyView = () => { $('#grid').className = 'grid ' + (state.view === 'list' ? 'view-list' : 'view-grid'); document.querySelectorAll('.vt').forEach(b => { const on = b.dataset.view === state.view; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }); };
export const setView = (v) => { state.view = (v === 'list') ? 'list' : 'grid'; saveLS(LS_VIEW, state.view); applyView(); };