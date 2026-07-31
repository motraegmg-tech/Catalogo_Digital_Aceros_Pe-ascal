#!/usr/bin/env node
/**
 * generar_familias_catalogo.mjs — Publica al catálogo las familias aprobadas.
 *
 * Toma las propuestas (proponer_familias.mjs) y las decisiones de Gonzalo
 * (datos/familias_aprobadas.json) y deja en catalogo-web/data/ el único archivo
 * que la web necesita para agrupar: qué códigos van en qué ficha y en qué
 * subgrupo. Nada más — ni nombres de producto ni medidas, que ya vienen del
 * catálogo y aquí solo se duplicarían y envejecerían.
 *
 * Lo que NO hace: decidir agrupaciones. Solo se publica lo aprobado a mano.
 *
 *   node pipeline/generar_familias_catalogo.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PROPUESTAS = join(ROOT, 'datos', 'familias_propuestas.json');
const APROBADAS = join(ROOT, 'datos', 'familias_aprobadas.json');
const PRODUCTOS = join(ROOT, 'catalogo-web', 'data', 'productos.json');
const SALIDA_JSON = join(ROOT, 'catalogo-web', 'data', 'familias.json');
const SALIDA_JS = join(ROOT, 'catalogo-web', 'data', 'familias.js');

const clave = (f) => `${f.cat}||${f.nombre}`;

const slug = (s) => String(s || '')
  .normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function main() {
  const propuestas = JSON.parse(await readFile(PROPUESTAS, 'utf8'));
  const decisiones = JSON.parse(await readFile(APROBADAS, 'utf8'));
  const catalogo = JSON.parse(await readFile(PRODUCTOS, 'utf8'));

  /* Solo entra a una ficha lo que hoy sigue publicado Y clasificado. Un producto
     que desde que se aprobó la familia se retiró, se ocultó o volvió a "POR
     CLASIFICAR" sale de la ficha: la agrupación no puede ser la puerta trasera
     por la que reaparece algo que la clasificación sacó del catálogo. */
  const FUERA = new Set(['POR CLASIFICAR', 'Productos Descontinuados / Ocultos']);
  const publicable = new Set(
    catalogo.productos.filter(p => p.cat && !FUERA.has(p.cat)).map(p => p.cod));
  const porClave = new Map(propuestas.map(f => [clave(f), f]));

  const familias = [];
  const usados = new Set();
  const sinPropuesta = [];
  let faltantes = 0;

  for (const decision of decisiones.aprobadas) {
    const f = porClave.get(clave(decision));
    if (!f) { sinPropuesta.push(clave(decision)); continue; }

    // La ficha se encoge sola en vez de ofrecer algo que ya no está publicado.
    const subgrupos = f.subgrupos
      .map(g => {
        const cods = g.productos.map(p => p.cod).filter(cod => {
          if (publicable.has(cod)) return true;
          faltantes++; return false;
        });
        return { nombre: g.nombre, cods };
      })
      .filter(g => g.cods.length);

    const n = subgrupos.reduce((a, g) => a + g.cods.length, 0);
    if (n < 2) continue;   // una ficha de un solo producto no es una ficha

    let id = `${slug(f.cat)}--${slug(f.nombre)}`;
    for (let i = 2; usados.has(id); i++) id = `${slug(f.cat)}--${slug(f.nombre)}-${i}`;
    usados.add(id);

    familias.push({ id, nombre: f.nombre, cat: f.cat, sub: f.sub, origen: f.origen, n, subgrupos });
  }

  familias.sort((a, b) => a.cat.localeCompare(b.cat, 'es') || b.n - a.n);

  const doc = {
    generado: new Date().toISOString().slice(0, 10),
    fuente: 'datos/familias_aprobadas.json',
    total: familias.length,
    productos: familias.reduce((a, f) => a + f.n, 0),
    familias,
  };

  await writeFile(SALIDA_JSON, JSON.stringify(doc), 'utf8');
  await writeFile(SALIDA_JS, `window.FAMILIAS = ${JSON.stringify(doc)};\n`, 'utf8');

  const cats = new Set(familias.map(f => f.cat));
  console.log(`Fichas de familia publicadas: ${familias.length} en ${cats.size} categorías`);
  console.log(`  cubren ${doc.productos} productos de ${catalogo.productos.length}`);
  console.log(`  navegando por categoría: ${catalogo.productos.length - doc.productos + familias.length} fichas en vez de ${catalogo.productos.length}`);
  if (faltantes) console.log(`  ⚠ ${faltantes} códigos aprobados ya no están publicados o clasificados (se omiten)`);
  if (sinPropuesta.length) console.log(`  ⚠ ${sinPropuesta.length} aprobadas sin propuesta: ${sinPropuesta.join(', ')}`);
  console.log(`  descartadas por Gonzalo: ${decisiones.descartadas.length} (sus productos siguen sueltos)`);
  console.log('\n✓ catalogo-web/data/familias.json y familias.js');
}

main().catch(e => { console.error('✗', e.message); process.exit(1); });
