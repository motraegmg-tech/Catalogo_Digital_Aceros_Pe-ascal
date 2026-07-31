#!/usr/bin/env node
/**
 * proponer_familias.mjs — Propone cómo agrupar los productos en fichas.
 *
 * Una ficha agrupa por MARCA, FUNCIÓN o TIPO, no solo por medida, y por dentro
 * se divide en subgrupos. Ejemplo: "Chapas Dexter" es una ficha, y dentro se
 * separa por función (de perilla, de barra, de gancho…); cada subgrupo lista
 * sus medidas o modelos.
 *
 * Dos vías:
 *   1. REGLAS de dominio para los casos que tienen lógica propia (discos por
 *      función, chapas por marca y función, láminas por material…).
 *   2. Si no aplica ninguna regla, cae al agrupador genérico: mismo nombre sin
 *      la medida. Eso es lo que ya resolvía bien soleras, PTR y brocas.
 *
 * NO decide nada: genera propuestas para aprobar o descartar a mano.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PRODUCTOS = join(ROOT, 'catalogo-web', 'data', 'productos.json');
const MINIMO = 3;

const MARCAS = ['DEXTER', 'IRWIN', 'DEWALT', 'MAKITA', 'BOSCH', 'TRUPER', 'URREA', 'SURTEK',
  'PRETUL', 'MILWAUKEE', 'MILWAKEE', 'STANLEY', 'TYROLIT', 'NORTON', 'AUSTROMEX', 'INFRA',
  'LINCOLN', 'ESAB', 'PFERD', 'FANDELI', 'ARTEFERRO', 'PHILLIPS', 'FOSET', 'ADIR', 'HOME',
  'MUNDIAL', 'VULCANO', 'CASTOLIN', 'INDURA'];

const marcaDe = (nom) => MARCAS.find(m => new RegExp(`\\b${m}\\b`).test(nom)) || '';

/** Primer patrón que case da el nombre del subgrupo. */
const primero = (nom, pares, porDefecto) => (pares.find(([re]) => re.test(nom)) || [, porDefecto])[1];

const FUNC_DISCO = [
  [/\bCORTE?\b|\bCORT\b|P\/CORT/, 'Corte'],
  [/DESBAST|\bDESB\b/, 'Desbaste'],
  [/LAMINAD|\bFLAP\b/, 'Laminado (flap)'],
  [/DIAMANT/, 'Diamante'],
  [/PULID|\bPULIR\b/, 'Pulido'],
  [/SIERRA/, 'Sierra'],
  [/LIJA|GRANO/, 'Lija'],
];
const FUNC_CHAPA = [
  [/PERILLA/, 'De perilla'],
  [/MANIJA|MANILLA/, 'De manija'],
  [/\bBARRA\b/, 'De barra'],
  [/GANCHO/, 'De gancho'],
  [/EMBUTIR/, 'De embutir'],
  [/CAÑON|CANON/, 'De cañón'],
  [/P\/BAÑO|\bBAÑO\b/, 'Para baño'],
  [/MUEBLE|CAJON|ESCRITORIO/, 'Para mueble'],
  [/SOBREPONER/, 'De sobreponer'],
  [/CILINDRO|MARIPOSA/, 'Cerrojo de cilindro'],
  [/CORREDIZ|ZAGUAN/, 'Para corrediza'],
  [/\bFIJA\b/, 'Fija'],
  [/DER\.?|IZQ\.?|DERECHA|IZQUIERDA/, 'Con mano der./izq.'],
];
/* Los candados NO son chapas: comparten el rubro pero no la ficha. Iban al
   cajón "Otras" de Chapas Dexter y lo inflaban a 119 productos. */
const TIPO_CANDADO = [
  [/ANTIPALANCA/, 'Antipalanca'],
  [/COMBINACION|COMB\b|COMBO|DISCOS?\b/, 'De combinación'],
  [/LAMINAD/, 'Laminado'],
  [/LATON/, 'De latón'],
  [/ACERO|INOX/, 'De acero'],
  [/CONTRA AGUA|INTEMPERIE/, 'Para intemperie'],
  [/CORTINA/, 'Para cortina'],
];
/* Las puntas ornamentales de herrería se eligen por el perfil al que van. */
const PUNTA_ORNAMENTAL = [
  [/P\/CUAD?\.?|CUADRADO/, 'Ornamental para cuadrado'],
  [/P\/RED\.?|REDONDO/, 'Ornamental para redondo'],
];
const TIPO_LAMINA_PLAST = [
  [/POLICARBONAT/, 'Policarbonato'],
  [/POLIPROPILEN/, 'Polipropileno'],
  [/ACRILIC/, 'Acrílico'],
  [/\bPVC\b/, 'PVC'],
  [/FIBRA\s*DE\s*VIDRIO/, 'Fibra de vidrio'],
];
const TIPO_LAMINA_MET = [
  [/GALVATEJA/, 'Galvateja'],
  [/ZINTRO\s*ALUM/, 'Zintro alum'],
  [/ZINTRO/, 'Zintro'],
  [/PINTRO/, 'Pintro'],
  [/ACANALAD/, 'Acanalada'],
  [/\bNEGRA\b/, 'Negra'],
  [/GALVANIZAD/, 'Galvanizada'],
  [/\bLISA\b/, 'Lisa'],
  [/TECHAR|TEJA/, 'Para techar'],
  [/PERFORAD/, 'Perforada'],
  [/ANTIDERRAP/, 'Antiderrapante'],
];

/* Cada regla define: cómo se llama la ficha, qué productos entran y cómo se
   dividen por dentro. `marca:true` abre una ficha por marca (Chapas Dexter,
   Chapas Phillips…), que es justo lo que pidió Gonzalo. */
const REGLAS = [
  { id: 'remache-pop', ficha: 'Remaches POP', match: /^REMACHE\s+POP/,
    sub: (n) => /\bLF\b/.test(n) ? 'Cabeza ancha (LF)' : 'Estándar' },
  { id: 'remache', ficha: 'Remaches', match: /^REMACHE/,
    sub: (n) => primero(n, [[/GOLPE/, 'De golpe'], [/POP/, 'POP']], 'Otros') },
  { id: 'disco', ficha: 'Discos', match: /^DISCO/, sub: (n) => primero(n, FUNC_DISCO, 'Otros') },
  { id: 'candado', ficha: 'Candados', marca: true, match: /\bCANDADO/,
    sub: (n) => primero(n, TIPO_CANDADO, 'Otros') },
  { id: 'chapa', ficha: 'Chapas y cerraduras', marca: true,
    match: /\b(CHAPA|CERRADURA|CERROJO)\b/, sub: (n) => primero(n, FUNC_CHAPA, 'Otras') },
  /* Las puntas montadas son abrasivos y las ornamentales son herrería: mismo
     nombre, productos y compradores distintos. Van en fichas separadas. */
  { id: 'punta-abrasiva', ficha: 'Puntas montadas para desbaste', match: /^PUNTA\b/,
    filtro: (n) => /MONTADA|DESBASTE|ABRASIV/.test(n), sub: () => 'Para desbaste' },
  { id: 'punta-desarm', ficha: 'Puntas de desarmador', match: /^PUNTA\b/,
    filtro: (n) => /DESARMADOR|PHILL|TORX|\bHEX\b|\bPH\d/.test(n), sub: () => 'De desarmador' },
  { id: 'punta-orn', ficha: 'Puntas ornamentales', match: /^PUNTA\b/,
    sub: (n) => primero(n, [[/LANZA/, 'De lanza'], ...PUNTA_ORNAMENTAL], 'Sin perfil definido') },
  { id: 'lamina-plast', ficha: 'Láminas plásticas',
    match: /^LAMINA|^LÁMINA/, filtro: (n) => TIPO_LAMINA_PLAST.some(([re]) => re.test(n)),
    sub: (n) => primero(n, TIPO_LAMINA_PLAST, 'Otras') },
  { id: 'lamina-met', ficha: 'Láminas metálicas',
    match: /^LAMINA|^LÁMINA|^GALVATEJA|^ZINTRO|^PINTRO/,
    sub: (n) => primero(n, TIPO_LAMINA_MET, 'Otras') },
  { id: 'broca', ficha: 'Brocas', marca: true, match: /^BROCA/,
    sub: (n) => primero(n, [[/CONCRETO|SDS/, 'Para concreto'], [/ESCALON/, 'Escalonada'],
      [/MADERA/, 'Para madera'], [/COBALT/, 'Cobalto'], [/BIMETAL|SIERRA/, 'Sierra copa']], 'Para metal') },
  { id: 'tornillo', ficha: 'Tornillería', match: /^(TORNILLO|TORN\.|PIJA|BIRLO)/,
    sub: (n) => primero(n, [[/HEX/, 'Hexagonal'], [/PIJA/, 'Pija'], [/BIRLO/, 'Birlo'],
      [/COCHE/, 'De coche'], [/GALV/, 'Galvanizado']], 'Otros') },
  { id: 'soldadura', ficha: 'Soldadura (consumibles)', marca: true,
    match: /^(SOLDADURA|SOLD\b|ELECTRODO)/,
    sub: (n) => primero(n, [[/6013/, '6013'], [/7018/, '7018'], [/6010/, '6010'],
      [/INOX/, 'Inoxidable'], [/MIG|MICROALAMBRE/, 'MIG / microalambre']], 'Otros') },
];

/** Agrupador genérico: nombre sin la medida (lo que ya funcionaba). */
export function claveFamilia(nom) {
  let n = String(nom || '').toUpperCase();
  n = n.replace(/\([^)]*\)/g, ' ');
  n = n.replace(/\d+(?:\.\d+)?(?:\s+\d+\/\d+)?\s*"/g, ' ');
  n = n.replace(/\d+\/\d+/g, ' ');
  n = n.replace(/\b\d+(?:\.\d+)?\s*(?:MM|CM|MTS?|ML|M|KGS?|GR|LTS?|W|V|HP|PZAS?)\b/g, ' ');
  n = n.replace(/\bC(?:AL)?\.?\s*\d+\b/g, ' ');
  n = n.replace(/\bNO\.?\s*\d+\b/g, ' ');
  n = n.replace(/\b\d+(?:\.\d+)?\b/g, ' ');
  n = n.replace(/\bDE\b|\bP\/\b|\bPARA\b|\bCON\b|\bY\b|\bX\b|\bA\b/g, ' ');
  n = n.replace(/[^A-ZÑÁÉÍÓÚÜ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return n;
}

async function main() {
  const data = JSON.parse(await readFile(PRODUCTOS, 'utf8'));
  const productos = data.productos.filter(p => p.cat && p.cat !== 'POR CLASIFICAR');

  /* Primera pasada: ¿cuántos productos tiene cada marca dentro de su regla?
     Abrir una ficha "Soldadura Esab" con 5 productos fragmenta más de lo que
     ordena, así que una marca solo merece ficha propia si tiene volumen. */
  const UMBRAL_MARCA = 10;
  const volumen = new Map();
  const reglaDe = (nom) => REGLAS.find(r => r.match.test(nom) && (!r.filtro || r.filtro(nom)));
  for (const p of productos) {
    const nom = (p.nom || '').toUpperCase();
    const r = reglaDe(nom);
    if (!r || !r.marca) continue;
    const m = marcaDe(nom);
    if (!m) continue;
    const k = `${r.id}${m}`;
    volumen.set(k, (volumen.get(k) || 0) + 1);
  }

  const fichas = new Map();
  const sueltos = [];

  for (const p of productos) {
    const nom = (p.nom || '').toUpperCase();
    const regla = reglaDe(nom);
    if (regla) {
      let marca = regla.marca ? marcaDe(nom) : '';
      if (marca && (volumen.get(`${regla.id}${marca}`) || 0) < UMBRAL_MARCA) marca = '';
      const titulo = regla.ficha + (marca ? ' ' + marca[0] + marca.slice(1).toLowerCase() : '');
      const k = `R${regla.id}${marca}`;
      if (!fichas.has(k)) fichas.set(k, { titulo, origen: 'regla:' + regla.id, marca, items: [] });
      fichas.get(k).items.push({ p, sub: regla.sub(nom) || 'Otros' });
    } else {
      sueltos.push(p);
    }
  }

  // Los que ninguna regla reclamó: agrupador genérico por nombre sin medida.
  const gen = new Map();
  for (const p of sueltos) {
    const fam = claveFamilia(p.nom);
    if (!fam || fam.length < 3) continue;
    const k = `G${p.cat}${p.sub || ''}${fam}`;
    if (!gen.has(k)) gen.set(k, { titulo: fam, origen: 'nombre', marca: '', items: [] });
    gen.get(k).items.push({ p, sub: '' });
  }
  for (const [k, v] of gen) fichas.set(k, v);

  const familias = [];
  for (const [, f] of fichas) {
    if (f.items.length < MINIMO) continue;
    const cats = [...new Set(f.items.map(x => x.p.cat))];
    const subs = new Map();
    for (const x of f.items) {
      const s = x.sub || '—';
      if (!subs.has(s)) subs.set(s, []);
      subs.get(s).push(x.p);
    }
    const conMedida = f.items.filter(x => (x.p.med || '').trim()).length;
    const marcas = [...new Set(f.items.map(x => marcaDe((x.p.nom || '').toUpperCase())).filter(Boolean))];

    const alertas = [];
    if (cats.length > 1) alertas.push(`abarca ${cats.length} categorías`);
    if (conMedida < f.items.length) alertas.push(`${f.items.length - conMedida} sin medida`);
    if (!f.marca && marcas.length > 1) alertas.push(`mezcla marcas: ${marcas.join(', ')}`);
    if (subs.size === 1 && f.origen.startsWith('regla')) alertas.push('un solo subgrupo');
    // Cajón de sastre: si "Otros" se lleva media ficha, la regla no está
    // separando de verdad y hace falta afinar el diccionario de funciones.
    const cajon = [...subs.entries()].find(([n]) => /^Otr[oa]s?$/.test(n));
    if (cajon && cajon[1].length > f.items.length * 0.4)
      alertas.push(`"${cajon[0]}" se lleva ${Math.round(cajon[1].length / f.items.length * 100)}%`);
    if (f.items.length > 70) alertas.push(`ficha muy grande (${f.items.length})`);

    const confianza = f.origen.startsWith('regla')
      ? (cats.length === 1 && !alertas.length ? 'alta' : alertas.length <= 1 ? 'media' : 'baja')
      : (!alertas.length && conMedida === f.items.length ? 'alta' : alertas.length <= 1 ? 'media' : 'baja');

    /* Categoría principal = donde tiene más productos. Decisión de Gonzalo
       (2026-07-31): una ficha que abarca dos categorías se muestra completa
       solo ahí, no repetida ni partida. */
    const cuentaCat = {};
    for (const x of f.items) cuentaCat[x.p.cat] = (cuentaCat[x.p.cat] || 0) + 1;
    const principal = Object.entries(cuentaCat).sort((a, b) => b[1] - a[1])[0][0];

    familias.push({
      cat: principal, cats, cuentaCat,
      sub: [...new Set(f.items.map(x => x.p.sub))].slice(0, 3).join(' / '),
      nombre: f.titulo, origen: f.origen, n: f.items.length, conMedida,
      distintas: new Set(f.items.map(x => x.p.med).filter(Boolean)).size,
      marcas, alertas, confianza,
      subgrupos: [...subs.entries()].sort((a, b) => b[1].length - a[1].length).map(([nombre, ps]) => ({
        nombre, n: ps.length,
        productos: ps.map(p => ({ cod: p.cod, nom: p.nom, med: p.med || '' })),
      })),
    });
  }

  familias.sort((a, b) => a.cat.localeCompare(b.cat, 'es') || b.n - a.n);

  const cubiertos = familias.reduce((a, f) => a + f.n, 0);
  const porReglas = familias.filter(f => f.origen.startsWith('regla'));
  console.log(`Productos clasificados: ${productos.length}`);
  console.log(`Fichas propuestas: ${familias.length}  (${porReglas.length} por regla de marca/función, ${familias.length - porReglas.length} por nombre)`);
  console.log(`  cubren ${cubiertos} productos → el catálogo pasaría de ${productos.length} a ${productos.length - cubiertos + familias.length} fichas`);
  console.log(`  confianza: ${JSON.stringify(familias.reduce((a, f) => (a[f.confianza] = (a[f.confianza] || 0) + 1, a), {}))}`);

  console.log('\nFichas por regla de marca/función:');
  for (const f of porReglas.sort((a, b) => b.n - a.n))
    console.log(`  ${String(f.n).padStart(3)}  ${f.nombre.padEnd(30)} ${f.subgrupos.length} subgrupos: ${f.subgrupos.map(s => s.nombre + '(' + s.n + ')').join(', ').slice(0, 82)}`);

  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const filas = [['confianza', 'origen', 'categoria', 'ficha', 'productos', 'subgrupos', 'detalle_subgrupos', 'alertas'].join(',')];
  for (const f of familias)
    filas.push([f.confianza, f.origen, f.cat, f.nombre, f.n, f.subgrupos.length,
      f.subgrupos.map(s => `${s.nombre} (${s.n})`).join(' | '), f.alertas.join(' | ')].map(esc).join(','));
  await writeFile(join(ROOT, 'datos', 'familias_propuestas.csv'), '﻿' + filas.join('\r\n'), 'utf8');
  await writeFile(join(ROOT, 'datos', 'familias_propuestas.json'), JSON.stringify(familias), 'utf8');
  console.log('\n✓ datos/familias_propuestas.csv y .json');
}

main().catch(e => { console.error('✗', e.message); process.exit(1); });
