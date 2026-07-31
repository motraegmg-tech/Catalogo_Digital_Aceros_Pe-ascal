#!/usr/bin/env node
/**
 * proponer_familias.mjs — Propone qué productos podrían presentarse como UNA
 * ficha con selector de medida.
 *
 * NO decide nada: genera propuestas para que una persona apruebe o descarte.
 * Cada propuesta lleva señales de alerta para que revisarla sea rápido.
 *
 * Salidas:
 *   datos/familias_propuestas.csv    → para revisar en Excel
 *   datos/familias_propuestas.json   → para la pantalla de revisión
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PRODUCTOS = join(ROOT, 'catalogo-web', 'data', 'productos.json');

const MINIMO = 3;   // menos de 3 medidas no compensa agrupar

/** Marcas conocidas: si una familia mezcla dos, probablemente no es una familia. */
const MARCAS = ['IRWIN', 'DEWALT', 'MAKITA', 'BOSCH', 'TRUPER', 'URREA', 'SURTEK', 'PRETUL',
  'MILWAUKEE', 'STANLEY', 'TYROLIT', 'NORTON', 'AUSTROMEX', 'INFRA', 'LINCOLN', 'ESAB',
  'PFERD', 'FANDELI', 'ARTEFERRO', 'DEXTER', 'PHILLIPS', 'FOSET', 'ADIR'];

/** Quita del nombre lo que varía entre medidas para quedarse con la familia. */
export function claveFamilia(nom) {
  let n = String(nom || '').toUpperCase();
  n = n.replace(/\([^)]*\)/g, ' ');                                  // (2843)
  n = n.replace(/\d+(?:\.\d+)?(?:\s+\d+\/\d+)?\s*"/g, ' ');          // 4 1/2"
  n = n.replace(/\d+\/\d+/g, ' ');                                   // fracciones
  n = n.replace(/\b\d+(?:\.\d+)?\s*(?:MM|CM|MTS?|ML|M|KGS?|GR|LTS?|W|V|HP|PZAS?)\b/g, ' ');
  n = n.replace(/\bC(?:AL)?\.?\s*\d+\b/g, ' ');                      // calibre C14
  n = n.replace(/\bNO\.?\s*\d+\b/g, ' ');                            // No. 5
  n = n.replace(/\b\d+(?:\.\d+)?\b/g, ' ');                          // números sueltos
  n = n.replace(/\bDE\b|\bP\/\b|\bPARA\b|\bCON\b|\bY\b|\bX\b|\bA\b/g, ' ');
  n = n.replace(/[^A-ZÑÁÉÍÓÚÜ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return n;
}

const marcasDe = (txt) => MARCAS.filter(m => txt.toUpperCase().includes(m));

async function main() {
  const data = JSON.parse(await readFile(PRODUCTOS, 'utf8'));
  const productos = data.productos.filter(p => p.cat && p.cat !== 'POR CLASIFICAR');

  const mapa = new Map();
  for (const p of productos) {
    const fam = claveFamilia(p.nom);
    if (!fam || fam.length < 3) continue;
    const k = `${p.cat}${p.sub || ''}${fam}`;
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(p);
  }

  const familias = [];
  for (const [k, items] of mapa) {
    if (items.length < MINIMO) continue;
    const [cat, sub, nombre] = k.split('');
    const medidas = items.map(p => (p.med || '').trim());
    const conMedida = medidas.filter(Boolean).length;
    const distintas = new Set(medidas.filter(Boolean)).size;
    const marcas = [...new Set(items.flatMap(p => marcasDe(p.nom)))];

    const alertas = [];
    if (conMedida < items.length) alertas.push(`${items.length - conMedida} sin medida`);
    if (distintas < conMedida) alertas.push(`${conMedida - distintas} medidas repetidas`);
    if (marcas.length > 1) alertas.push(`mezcla marcas: ${marcas.join(', ')}`);
    if (!conMedida) alertas.push('ninguno tiene medida');

    // Confianza: alta si todos tienen medida distinta y no mezcla marcas.
    const confianza = (!alertas.length) ? 'alta'
      : (conMedida >= items.length * 0.8 && marcas.length <= 1) ? 'media' : 'baja';

    familias.push({
      cat, sub, nombre, n: items.length, conMedida, distintas, marcas, alertas, confianza,
      productos: items.map(p => ({ cod: p.cod, nom: p.nom, med: p.med || '', foto: p.foto || '' })),
    });
  }

  familias.sort((a, b) => a.cat.localeCompare(b.cat, 'es') || b.n - a.n);

  const cubiertos = familias.reduce((a, f) => a + f.n, 0);
  const porConf = familias.reduce((a, f) => (a[f.confianza] = (a[f.confianza] || 0) + 1, a), {});
  console.log(`Productos clasificados: ${productos.length}`);
  console.log(`Familias propuestas (${MINIMO}+ productos): ${familias.length}`);
  console.log(`  cubren ${cubiertos} productos → el catálogo pasaría de ${productos.length} a ${productos.length - cubiertos + familias.length} fichas`);
  console.log(`  por confianza: ${JSON.stringify(porConf)}`);

  console.log('\nPor categoría:');
  const porCat = {};
  for (const f of familias) {
    porCat[f.cat] = porCat[f.cat] || { fam: 0, prod: 0 };
    porCat[f.cat].fam++; porCat[f.cat].prod += f.n;
  }
  for (const [c, v] of Object.entries(porCat).sort((a, b) => b[1].prod - a[1].prod))
    console.log(`  ${c.padEnd(42)} ${String(v.fam).padStart(3)} familias  ${String(v.prod).padStart(4)} productos`);

  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const filas = [['confianza', 'categoria', 'subcategoria', 'familia', 'productos', 'medidas_distintas', 'alertas', 'codigos'].join(',')];
  for (const f of familias)
    filas.push([f.confianza, f.cat, f.sub, f.nombre, f.n, f.distintas, f.alertas.join(' | '),
      f.productos.map(p => p.cod).join(' ')].map(esc).join(','));
  await writeFile(join(ROOT, 'datos', 'familias_propuestas.csv'), '﻿' + filas.join('\r\n'), 'utf8');
  await writeFile(join(ROOT, 'datos', 'familias_propuestas.json'), JSON.stringify(familias), 'utf8');
  console.log('\n✓ datos/familias_propuestas.csv y .json');
}

main().catch(e => { console.error('✗', e.message); process.exit(1); });
