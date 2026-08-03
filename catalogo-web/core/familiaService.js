/* familiaService.js — Fichas de familia.
 *
 * Una familia junta en UNA sola ficha del catálogo los productos que solo se
 * diferencian por la medida (las 32 soleras) o por el modelo dentro de una
 * marca/función (los discos de corte). Es agrupación de PRESENTACIÓN: cada
 * medida sigue siendo su propio producto con su propio código, y así entra al
 * carrito y al mensaje de WhatsApp.
 *
 * Aquí no se decide nada. Las agrupaciones las edita el encargado desde
 * clasificador.html y viven en la tabla `familias` de Supabase; este módulo sólo
 * resuelve esos códigos contra el catálogo que está cargado. El archivo
 * data/familias.json queda como respaldo para el modo sin conexión.
 *
 * Cada familia trae un `criterio` (por qué se agrupan: medida, calibre, función,
 * modelo…) que decide el ROTULO de la columna donde el cliente elige. Agrupar
 * láminas por calibre y encabezar la columna con "Medida" sería mentirle.
 *
 * Si no carga ninguna fuente, hayFamilias() da false y el catálogo se comporta
 * exactamente como antes: producto por producto.
 */
import { DATA } from './store.js';
import { alfa } from './searchService.js';
import { columnaDeCriterio } from './ajustesService.js';

const FAM = new Map();          // id  -> {id, nombre, cat, sub, criterio, columna, subgrupos:[{nombre, cods}]}
const porCod = new Map();       // cod -> {id, sub}
const resueltos = new Map();    // id  -> [producto…] presentes en el catálogo
const principales = new Map();  // id  -> categoría donde de verdad están sus productos

export const hayFamilias = () => FAM.size > 0;

/**
 * Acepta las dos formas: el documento del archivo ({familias:[…]}) y el arreglo
 * de filas que devuelve Supabase. Una fila inactiva no entra: desactivar una
 * agrupación en el clasificador tiene que devolver sus productos a la lista
 * suelta, no dejarla a medias.
 */
export function cargarFamilias(entrada) {
  FAM.clear(); porCod.clear(); resueltos.clear();
  const lista = Array.isArray(entrada) ? entrada
              : (entrada && Array.isArray(entrada.familias) ? entrada.familias : []);
  lista.forEach(f => {
    if (f.activa === false || !f.id) return;
    FAM.set(f.id, f);
    (f.subgrupos || []).forEach(g =>
      (g.cods || []).forEach(cod => porCod.set(cod, { id: f.id, sub: g.nombre })));
  });
  return FAM.size;
}

/**
 * El rótulo de la columna que el cliente ve dentro de la ficha. Manda el que la
 * familia tenga escrito a mano; si no, el de su criterio de agrupación.
 */
export function columnaDe(fam) {
  return (fam && fam.columna) || columnaDeCriterio(fam && fam.criterio);
}

/**
 * Cruza los códigos aprobados con el catálogo realmente cargado. Se llama DESPUÉS
 * de setCatalogData(). Un código que ya no exista —producto retirado, oculto o
 * reclasificado— simplemente no aparece: la ficha se encoge sola en vez de
 * ofrecer algo que ya no está.
 */
export function indexarFamilias() {
  resueltos.clear();
  principales.clear();
  if (!FAM.size) return;
  const porCodigo = new Map(DATA.productos.map(p => [p.cod, p]));
  FAM.forEach(f => {
    const lista = [];
    (f.subgrupos || []).forEach(g => (g.cods || []).forEach(cod => {
      const p = porCodigo.get(cod);
      if (p) lista.push(p);
    }));
    if (!lista.length) return;
    resueltos.set(f.id, lista);
    principales.set(f.id, calcularCatPrincipal(f, lista));
  });
}

/**
 * En qué categoría se muestra la ficha: en la que están de verdad sus productos,
 * no en la que dice el campo `cat`.
 *
 * El campo `cat` lo elige una persona al crear la agrupación y **se queda atrás**
 * en cuanto los productos se reclasifican o se agregan de otra categoría. Cuando
 * eso pasaba, la ficha se volvía invisible: en la categoría que declaraba no
 * había productos suyos, y en la categoría donde sí estaban se descartaba porque
 * `f.cat` no coincidía. Nadie la veía nunca y nada avisaba.
 *
 * Se toma la categoría con MÁS productos (desempate alfabético, para que dos
 * cargas seguidas no den resultados distintos). Es lo que el catálogo siempre
 * prometió: «una familia que abarca dos categorías se muestra completa sólo en
 * su categoría principal».
 */
function calcularCatPrincipal(f, productos) {
  const cuenta = new Map();
  productos.forEach(p => { if (p.cat) cuenta.set(p.cat, (cuenta.get(p.cat) || 0) + 1); });
  if (!cuenta.size) return f.cat || '';
  return [...cuenta.entries()]
    .sort((a, b) => b[1] - a[1] || alfa(a[0], b[0]))[0][0];
}

/** La categoría donde el catálogo muestra esta ficha. Cae a `cat` si no hay productos. */
export const catPrincipalDe = (id) => principales.get(id) || (FAM.get(id) || {}).cat || '';

export function familiaDe(p) {
  const ref = p && porCod.get(p.cod);
  return ref ? (FAM.get(ref.id) || null) : null;
}

export const subgrupoDe = (cod) => (porCod.get(cod) || {}).sub || '';
export const productosDeFamilia = (id) => resueltos.get(id) || [];
/** Una familia por su id, para resolver los destacados de la portada. */
export const familiaPorId = (id) => FAM.get(id) || null;

/** Orden de los subgrupos tal como quedaron aprobados (Corte, Desbaste, …). */
export function ordenSubgrupos(id) {
  const f = FAM.get(id);
  return f ? (f.subgrupos || []).map(g => g.nombre) : [];
}

/**
 * Los números de una medida, en el orden en que aparecen y ya como valor:
 *
 *   `1 1/4"`        → [1.25]
 *   `1/8 X 1 1/2"`  → [0.125, 1.5]      (calibre y ancho: hay que comparar los dos)
 *   `230 X 280 MM`  → [9.06, 11.02]     (a pulgadas, para que no salte sobre 10")
 *
 * Comparar solo el primer número deja `1/8 X 1 1/2"` antes que `1/8 X 1"`, que es
 * justo lo que el cliente no espera al recorrer la tabla de soleras.
 */
export function clavesMedida(med) {
  const s = String(med || '').trim();
  if (!s) return [];
  const div = /\bmm\b/i.test(s) ? 25.4 : (/\bcm\b/i.test(s) ? 2.54 : 1);
  const num = (x) => parseFloat(String(x).replace(',', '.'));
  const re = /(\d+(?:[.,]\d+)?)\s+(\d+)\/(\d+)|(\d+)\/(\d+)|(\d+(?:[.,]\d+)?)/g;
  const claves = [];
  let m;
  while ((m = re.exec(s))) {
    let v;
    if (m[1] != null) v = num(m[1]) + (+m[2]) / (+m[3]);   // 1 1/2
    else if (m[4] != null) v = (+m[4]) / (+m[5]);          // 1/2
    else v = num(m[6]);                                    // 10  ·  4.5
    claves.push(v / div);
  }
  return claves;
}

/** Primer valor de la medida. Lo que no se puede leer va al final. */
export const ordenMedida = (med) => { const k = clavesMedida(med); return k.length ? k[0] : Infinity; };

/** Dentro de la ficha las filas van por medida; las que no tienen, al final por nombre. */
export function ordenarPorMedida(productos) {
  const cache = new Map();
  const claves = (p) => {
    if (!cache.has(p)) cache.set(p, clavesMedida(p.med));
    return cache.get(p);
  };
  return productos.slice().sort((a, b) => {
    const ka = claves(a), kb = claves(b);
    if (!ka.length !== !kb.length) return ka.length ? -1 : 1;   // sin medida, al final
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
      if (ka[i] == null) return -1;        // `1"` antes que `1" X 2"`
      if (kb[i] == null) return 1;
      if (ka[i] !== kb[i]) return ka[i] - kb[i];
    }
    return alfa(a.nom, b.nom);
  });
}
