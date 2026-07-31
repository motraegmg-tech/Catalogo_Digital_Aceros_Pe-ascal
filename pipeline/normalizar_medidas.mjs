#!/usr/bin/env node
/**
 * normalizar_medidas.mjs — Arregla cómo están escritas las medidas.
 *
 * Los defectos son de captura, no de contenido: falta la comilla de pulgada, se
 * repite la fracción al final ("4 1/2\" 1/2"), la X va en minúscula o falta el
 * conector entre dos medidas ("6\" 4\"" en vez de "6\" X 4\"").
 *
 * Separa lo que puede arreglar solo de lo que no:
 *   SEGURO   → espacios, comilla faltante, x→X, eco de la fracción.
 *   AMBIGUO  → hacen falta dos medidas unidas y no se puede saber si el
 *              conector correcto es "X" (dimensiones) o "A" (rango). Eso lo
 *              decide una persona; aquí solo se listan.
 *
 * Uso:
 *   node pipeline/normalizar_medidas.mjs            → reporte, no toca nada
 *   node pipeline/normalizar_medidas.mjs --csv      → escribe datos/medidas_propuestas.csv
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PRODUCTOS = join(ROOT, 'catalogo-web', 'data', 'productos.json');
const SALIDA_CSV = join(ROOT, 'datos', 'medidas_propuestas.csv');

/** Fracción o entero, con o sin parte entera: 1/2, 4 1/2, 12 */
const NUM = String.raw`\d+(?:\s+\d+\/\d+)?|\d+\/\d+`;

/** Trocea la medida en piezas comparables para detectar ecos. */
const fraccionesDe = (s) => (s.match(/\d+\/\d+/g) || []);

export function normalizar(original, nombre) {
  let s = String(original || '');
  const notas = [];
  const antes = s;

  // 1. Espacios: colapsa y recorta.
  s = s.replace(/\s+/g, ' ').trim();
  if (s !== antes.trim()) notas.push('espacios');

  // 2. Comilla pegada al número: 14 " → 14"
  const c1 = s;
  s = s.replace(/(\d)\s+"/g, '$1"');
  if (s !== c1) notas.push('comilla separada');

  // 3. x minúscula entre números → X
  const c2 = s;
  s = s.replace(new RegExp(String.raw`(\d"?)\s*[x×]\s*(\d)`, 'g'), '$1 X $2');
  if (s !== c2) notas.push('x→X');

  // 4. Eco de la fracción: "4 1/2\" 1/2" → "4 1/2\"".
  //    Solo si la fracción suelta del final YA aparece antes en el texto.
  const c3 = s;
  s = s.replace(new RegExp(String.raw`^(.*?(\d+\/\d+)"?)\s+(\d+\/\d+)\s*$`), (m, cabeza, frac, cola) =>
    frac === cola ? cabeza : m);
  if (s !== c3) notas.push('eco de fracción');

  // 4b. Eco múltiple al final: "9/16\" 1 1/8\" 9/16 1/8" → "9/16\" 1 1/8\""
  const c4 = s;
  s = s.replace(new RegExp(String.raw`^(.*?")\s+((?:\d+\/\d+\s*)+)$`), (m, cabeza, cola) => {
    const yaEstan = fraccionesDe(cabeza);
    const colaFr = fraccionesDe(cola);
    return colaFr.length && colaFr.every(f => yaEstan.includes(f)) ? cabeza : m;
  });
  if (s !== c4) notas.push('eco múltiple');

  // 5. Comilla faltante en la última medida: "2\" 1/8" → "2\" 1/8\""
  //    Solo si el valor YA usa comillas (es decir, está en pulgadas).
  const c5 = s;
  if (/"/.test(s)) s = s.replace(new RegExp(String.raw`(^|\s)(${NUM})\s*$`), (m, sp, n) => `${sp}${n}"`);
  if (s !== c5) notas.push('comilla faltante');

  // 6. Dos medidas pegadas sin conector. Aquí el NOMBRE del producto decide:
  //    "DISCO 4\" 1/2" es cuatro y medio pulgadas (fracción mixta partida),
  //    mientras que "BIRLO 3/16\" X 5\"" son dos dimensiones distintas.
  const par = s.match(new RegExp(String.raw`^(${NUM})"\s+(${NUM})"$`));
  let ambiguo = false;
  if (par) {
    const [, a, b] = par;
    const propia = (f) => { const m = f.match(/^(\d+)\/(\d+)$/); return m && +m[1] < +m[2]; };
    const entero = (f) => /^\d+$/.test(f);
    // ¿El nombre trae un conector explícito entre las dos partes? Entonces son
    // medidas distintas y ese conector es el bueno.
    const q = (f) => f.replace(/[/.*+?^${}()|[\]\\]/g, '\\$&');
    const conNombre = (nombre || '').toUpperCase()
      .match(new RegExp(String.raw`${q(a)}\s*"?\s*(X|A|DE|-|Y)\s*"?\s*${q(b)}`));
    if (conNombre) {
      // "DE" separa dimensiones (5" DE 5/8") y "-" marca un rango (1/4" - 3/8")
      const conector = { DE: 'X', '-': 'A' }[conNombre[1]] || conNombre[1];
      s = `${a}" ${conector} ${b}"`;
      notas.push('conector del nombre');
    } else if (entero(a) && propia(b)) {
      s = `${a} ${b}"`;                       // 4" 1/2" → 4 1/2"
      notas.push('fracción mixta');
    } else {
      ambiguo = true;                          // no hay pista: que decida una persona
    }
  }

  // 7. Red de seguridad. Varias medidas venían tan revueltas que "arreglarlas"
  //    solo produce otro revoltijo ("1/2\" 4 X 1 6 X 15.5 1/4 1/2\""). Si el
  //    resultado no tiene forma de medida, se deja intacto y se manda a
  //    revisión: es mejor una medida fea que una inventada.
  if (!bienFormada(s)) return { valor: original, notas: [], ambiguo: true, cambio: false, revisar: true };

  return { valor: s, notas, ambiguo, cambio: s !== String(original || '') };
}

/** ¿El texto tiene forma de medida? Una o dos magnitudes unidas por conector. */
export function bienFormada(s) {
  const MAG = String.raw`\d+(?:\.\d+)?(?:\s+\d+\/\d+)?"?|\d+\/\d+"?`;
  const UNI = String.raw`(?:\s*(?:mm|cm|m|in|MM|CM|MTS?|ML|kgs?\.?|KGS?\.?|GR|gr|ML|LTS?|W|V|"))?`;
  const UNA = `(?:${MAG})${UNI}`;
  const CONECTOR = String.raw`\s*(?:X|A|Y|DE|C\/)\s*`;
  // hasta tres magnitudes encadenadas (p. ej. 6" X 6" DE 1/4")
  const re = new RegExp(`^${UNA}(?:${CONECTOR}${UNA}){0,2}$`);
  return re.test(s.trim());
}

async function main() {
  const data = JSON.parse(await readFile(PRODUCTOS, 'utf8'));
  const productos = data.productos.filter(p => p.med && p.med.trim());

  const seguros = [], ambiguos = [];
  for (const p of productos) {
    const r = normalizar(p.med, p.nom);
    if (r.ambiguo) { if (r.cambio || true) ambiguos.push({ p, r }); }
    else if (r.cambio) seguros.push({ p, r });
  }

  console.log(`Productos con medida: ${productos.length}`);
  console.log(`  Correcciones SEGURAS:      ${seguros.length}`);
  console.log(`  Requieren decisión (X/A):  ${ambiguos.length}`);

  const porNota = {};
  for (const { r } of seguros) for (const n of r.notas) porNota[n] = (porNota[n] || 0) + 1;
  console.log('\nPor tipo de arreglo:', JSON.stringify(porNota));

  console.log('\n— Muestra de correcciones seguras —');
  for (const { p, r } of seguros.slice(0, 20))
    console.log(`  ${p.cod.padEnd(18)} ${JSON.stringify(p.med).padEnd(26)} → ${JSON.stringify(r.valor)}`);

  console.log('\n— Muestra de casos que necesitan decisión (¿X o A?) —');
  for (const { p, r } of ambiguos.slice(0, 15))
    console.log(`  ${p.cod.padEnd(18)} ${JSON.stringify(r.valor).padEnd(26)} nombre: ${p.nom.slice(0, 46)}`);

  if (process.argv.includes('--csv')) {
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const filas = [['tipo', 'codigo', 'medida_actual', 'medida_propuesta', 'arreglos', 'nombre'].join(',')];
    for (const { p, r } of seguros)
      filas.push(['SEGURO', p.cod, p.med, r.valor, r.notas.join(' + '), p.nom].map(esc).join(','));
    for (const { p, r } of ambiguos)
      filas.push(['DECIDIR', p.cod, p.med, r.valor, r.notas.join(' + '), p.nom].map(esc).join(','));
    await writeFile(SALIDA_CSV, '﻿' + filas.join('\r\n'), 'utf8');
    console.log(`\n✓ CSV escrito: datos/medidas_propuestas.csv (${filas.length - 1} filas)`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('normalizar_medidas.mjs')) {
  main().catch(e => { console.error('✗', e.message); process.exit(1); });
}
