/* searchService.js — Búsqueda del catálogo.
 *
 * El problema: quien compra acero no escribe como está capturado el catálogo.
 * Pide «media pulgada», «PTR de 2x2», «un octavo», «solera de 1/2 pulgada».
 * El catálogo dice `1/2"`, `PTR50X50`, `SOLERA`. Antes eran cuatro búsquedas
 * distintas y tres devolvían cero resultados — y cero resultados es una venta
 * que se pierde sin que nadie se entere.
 *
 * Cómo se resuelve, en tres capas que se suman:
 *
 *   1. FRACCIONES Y DECIMALES. `1/2` y `0.5` son el mismo número; `1 1/2` y
 *      `1.5` también. Se buscan los dos.
 *   2. UNIDADES HABLADAS. «pulgada» es la comilla `"` que trae la medida;
 *      «milímetros» es `mm`. La palabra se traduce al signo.
 *   3. DICCIONARIO EDITABLE. Lo que no es regla general sino vocabulario del
 *      mostrador («PTR» = tubular cuadrado, «varilla» = redondo corrugado) vive
 *      en `ajustes.sinonimos_busqueda` y lo edita el encargado desde el
 *      clasificador, sin tocar código.
 *
 * Regla de oro: un sinónimo SUMA, nunca sustituye. Lo que el cliente escribió
 * siempre sigue siendo una forma válida de encontrar el producto, así que
 * traducir mal nunca puede hacer desaparecer resultados que antes salían.
 *
 * Modelo de coincidencia: la consulta se parte en GRUPOS, y cada grupo tiene
 * varias ALTERNATIVAS. Un producto entra si CADA grupo tiene al menos una
 * alternativa satisfecha (y una alternativa se satisface si TODAS sus palabras
 * están en el texto del producto). Es un Y de oes:
 *
 *     «ptr 1/2 pulgada»  →  [ptr | tubular+cuadrado] Y [1/2 | 0.5] Y ["]
 */

export function normalize(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Único criterio de orden alfabético del catálogo (A→Z). Lo usan la grilla, las
 * fichas de familia y sus tablas de medidas, para que todo se lea igual.
 * `numeric` evita que «SOLERA 10» caiga antes de «SOLERA 2»; `sensitivity:'base'`
 * ignora acentos y mayúsculas, que en el catálogo se escriben de las dos formas.
 */
export const alfa = (a, b) =>
  (a || '').localeCompare(b || '', 'es', { numeric: true, sensitivity: 'base' });

export function buildHaystack(p) {
  if (p._hay == null) {
    p._hay = `${normalize(p.nom)} ${normalize(p.cod)} ${normalize(p.sub)} ${normalize(p.med)} ${normalize(p.cat)}`;
  }
  return p._hay;
}

/* ---------- palabras que no aportan ----------
   Escribirlas o no da igual, y dejarlas dentro estropea la búsqueda: la «x» de
   «2x2» aparece en media tabla de medidas y «de» en cualquier descripción. */
const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'para', 'por', 'con', 'y', 'o', 'en', 'al', 'x']);

/* ---------- unidades habladas → lo que trae la medida ----------
   `1/2"` lleva la comilla; nadie la escribe al buscar, dice «pulgada». */
const UNIDADES = {
  'pulgada': '"', 'pulgadas': '"', 'pulg': '"', 'plg': '"', 'in': '"', 'inch': '"',
  'milimetro': 'mm', 'milimetros': 'mm', 'mm': 'mm',
  'centimetro': 'cm', 'centimetros': 'cm', 'cm': 'cm',
  'metro': 'm', 'metros': 'm', 'mts': 'm', 'mt': 'm',
  'calibre': 'c', 'cal': 'c',
};

/* Denominadores que de verdad existen en un catálogo de acero. Sirven para el
   camino inverso: de `0.375` a `3/8`, que es como está capturado. */
const DENOMINADORES = [2, 4, 8, 16, 32, 64];

const limpiaNum = (n) => String(+n.toFixed(4)).replace(/\.?0+$/, '') || '0';

/** Las otras formas de escribir el mismo número: fracción ↔ decimal. */
function variantesNumericas(t) {
  const out = [];

  // `1 1/2` no llega aquí (son dos tokens); sí `1/2`, `0.5`, `1.5`
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const v = (+frac[1]) / (+frac[2]);
    if (isFinite(v)) out.push(limpiaNum(v));
    return out;
  }

  const dec = t.match(/^(\d+)[.,](\d+)$/);
  if (dec) {
    const v = parseFloat(t.replace(',', '.'));
    if (!isFinite(v)) return out;
    const entero = Math.floor(v), resto = v - entero;
    for (const d of DENOMINADORES) {
      const num = resto * d;
      if (Math.abs(num - Math.round(num)) > 1e-9) continue;
      const n = Math.round(num);
      if (!n) break;
      // `0.5` → `1/2`;  `1.5` → `1 1/2`, que se busca como «1» y «1/2» juntos
      out.push(entero ? `${entero} ${n}/${d}` : `${n}/${d}`);
      break;                                   // la fracción más simple basta
    }
    if (t.includes(',')) out.push(t.replace(',', '.'));
    return out;
  }

  return out;
}

/**
 * Las formas en que un término puede aparecer en el catálogo. Devuelve una lista
 * de alternativas; cada alternativa es una lista de palabras que deben estar
 * TODAS. La primera es siempre lo que el cliente escribió, tal cual.
 */
function alternativasDeTermino(t) {
  const alts = [[t]];

  // `2x2`, `25x50`, `1/2x1` — dimensiones pegadas. El catálogo las escribe de
  // muchas formas (`PTR25X50`, `1/2" X 1"`), así que se pide cada número.
  const dim = t.match(/^(\d+(?:[.,]\d+)?(?:\/\d+)?)x(\d+(?:[.,]\d+)?(?:\/\d+)?)$/);
  if (dim) alts.push([dim[1], dim[2]]);

  variantesNumericas(t).forEach(v => alts.push(v.split(' ')));

  const uni = UNIDADES[t];
  if (uni) alts.push([uni]);

  return alts;
}

/* ---------- diccionario editable ---------- */
let SINONIMOS = new Map();          // frase normalizada → [[palabras], …]
let MAX_PALABRAS = 1;               // cuántos tokens puede abarcar una entrada

/**
 * Carga el diccionario que el encargado edita en el clasificador.
 * Formato: [{de:'ptr', a:'tubular cuadrado'}, …]. Una misma entrada `de` puede
 * repetirse con varios `a`: todos se suman como alternativas.
 */
export function setSinonimos(lista) {
  SINONIMOS = new Map();
  MAX_PALABRAS = 1;
  (Array.isArray(lista) ? lista : []).forEach(s => {
    const de = normalize(s && s.de).trim();
    const a = normalize(s && s.a).trim();
    if (!de || !a || de === a) return;
    const palabras = a.split(/\s+/).filter(Boolean);
    if (!palabras.length) return;
    if (!SINONIMOS.has(de)) SINONIMOS.set(de, []);
    SINONIMOS.get(de).push(palabras);
    MAX_PALABRAS = Math.max(MAX_PALABRAS, de.split(/\s+/).length);
  });
  return SINONIMOS.size;
}

export const hayDiccionario = () => SINONIMOS.size > 0;

/**
 * Parte la consulta en grupos de alternativas. Las entradas del diccionario
 * pueden ser de varias palabras («media pulgada»), así que se prueba primero la
 * frase más larga: si no, «media» se comería el par antes de tiempo.
 */
export function gruposDeConsulta(query) {
  const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);

  const grupos = [];
  for (let i = 0; i < tokens.length;) {
    /* El diccionario se consulta ANTES de tirar las palabras vacías, y siempre
       por la frase más larga. Si no, «un octavo» perdería el «un» al limpiar y
       la entrada del diccionario no volvería a casar nunca; y «media» se
       comería el par antes de que «media pulgada» tuviera oportunidad. */
    let encontrado = false;
    for (let n = Math.min(MAX_PALABRAS, tokens.length - i); n >= 1; n--) {
      const syn = SINONIMOS.get(tokens.slice(i, i + n).join(' '));
      if (!syn) continue;
      // Lo que escribió el cliente sigue siendo válido: va como primera opción.
      grupos.push([tokens.slice(i, i + n), ...syn]);
      i += n;
      encontrado = true;
      break;
    }
    if (encontrado) continue;
    if (VACIAS.has(tokens[i])) { i++; continue; }   // no aporta: fuera
    grupos.push(alternativasDeTermino(tokens[i]));
    i++;
  }
  return grupos;
}

const cumple = (grupos, hay) =>
  grupos.every(alts => alts.some(palabras => palabras.every(w => hay.includes(w))));

export function searchAndSortProducts(query, products) {
  const q = normalize(query).trim();
  if (!q) return products;

  const grupos = gruposDeConsulta(q);
  if (!grupos.length) return products;

  const filtered = products.filter(p => cumple(grupos, buildHaystack(p)));

  return filtered.sort((a, b) => {
    const nomA = normalize(a.nom);
    const nomB = normalize(b.nom);

    // Prioridad 1: Coincidencia exacta del nombre ("solera" vs "solera")
    const exactA = nomA === q ? 1 : 0;
    const exactB = nomB === q ? 1 : 0;
    if (exactA !== exactB) return exactB - exactA;

    // Prioridad 2: El nombre empieza con el término ("solera de 2 pulgadas" vs "aro de solera")
    const startsA = nomA.startsWith(q) ? 1 : 0;
    const startsB = nomB.startsWith(q) ? 1 : 0;
    if (startsA !== startsB) return startsB - startsA;

    /* Prioridad 3: lo que se encontró SIN traducir va antes. Si alguien busca
       «cuadrado», los productos que dicen literalmente «cuadrado» pesan más que
       los que llegaron por el diccionario — el sinónimo ayuda, no manda. */
    const litA = nomA.includes(q) ? 1 : 0;
    const litB = nomB.includes(q) ? 1 : 0;
    if (litA !== litB) return litB - litA;

    // Prioridad 4: Orden alfabético ascendente (A→Z) para el resto, con el mismo
    // criterio que la navegación: «SOLERA 2» antes que «SOLERA 10».
    return nomA.localeCompare(nomB, 'es', { numeric: true, sensitivity: 'base' });
  });
}
