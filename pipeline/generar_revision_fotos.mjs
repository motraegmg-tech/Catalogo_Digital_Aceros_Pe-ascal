#!/usr/bin/env node
/* generar_revision_fotos.mjs — Hoja de revisión para unificar la foto de una
 * agrupación.
 *
 * El problema: dentro de una agrupación cuyo criterio es la MEDIDA, los 32
 * productos de "SOLERA" son la misma solera en 32 tamaños, pero cada uno lleva
 * su propia foto. En la parrilla eso se ve como 32 fotos ligeramente distintas
 * de lo mismo. Lo que se quiere es una sola foto para toda la agrupación, como
 * ya se ve en pijas y placas.
 *
 * Las agrupaciones por FUNCIÓN (discos, brocas, chapas, tornillería) quedan
 * fuera a propósito: ahí la foto sí tiene que cambiar, porque un disco de corte
 * no se parece a uno de desbaste.
 *
 * Este script NO cambia nada: sólo arma `datos/revision_fotos_agrupaciones.html`
 * para que el encargado vea las fotos, apruebe o elija otra, y exporte su
 * decisión en un JSON. Aplicar ese JSON es un paso aparte y deliberado.
 *
 *   node pipeline/generar_revision_fotos.mjs
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, '..');

// Mismas credenciales públicas (anon) que usa el catálogo. Sólo lectura.
const SUPA_URL = 'https://qdlezhfcnwsygtosieme.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkbGV6aGZjbndzeWd0b3NpZW1lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyMzU2NjEsImV4cCI6MjA5OTgxMTY2MX0.8SwUSs76lJNsQXp8qR_gTHbPRHcdfg6C5Et4Wg6wTp8';

const cab = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` };
async function get(path) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, { headers: cab });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r.json();
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Ruta de la foto tal como la resuelve el catálogo: si en la base hay una URL
   completa (subida desde el clasificador) se usa; si no, el archivo local.
   Devuelve null cuando el archivo no existe: hay ~217 productos cuya columna
   `foto` nombra un archivo que no está ni en el repositorio ni en Storage, y en
   el catálogo salen con la imagen de relleno. Aquí no pueden ser candidatos:
   unificar una agrupación con una foto que no existe la dejaría en blanco. */
const rutaFoto = (p, locales) => {
  const f = p.foto || '';
  if (/^https?:/i.test(f)) return f;
  const nombre = f || p.codigo + '.webp';
  return locales.has(nombre) ? '../catalogo-web/fotos/' + nombre : null;
};

/* Números de una medida, para ordenar y sacar la mediana. Mismo criterio que
   clavesMedida() en core/familiaService.js. */
function valorMedida(med) {
  const s = String(med || '').trim();
  if (!s) return null;
  const div = /\bmm\b/i.test(s) ? 25.4 : (/\bcm\b/i.test(s) ? 2.54 : 1);
  const m = /(\d+(?:[.,]\d+)?)\s+(\d+)\/(\d+)|(\d+)\/(\d+)|(\d+(?:[.,]\d+)?)/.exec(s);
  if (!m) return null;
  let v;
  if (m[1] != null) v = parseFloat(m[1].replace(',', '.')) + (+m[2]) / (+m[3]);
  else if (m[4] != null) v = (+m[4]) / (+m[5]);
  else v = parseFloat(m[6].replace(',', '.'));
  return v / div;
}

/* Factores de `escalar_por_medida.py`: ese pipeline generó una variante por
   medida a partir de UNA foto base. La de factor 1.0 es la que no se tocó, o
   sea la original del proveedor — la mejor candidata para toda la agrupación. */
async function factoresEscalado() {
  const factor = new Map();
  try {
    const csv = await readFile(join(RAIZ, 'datos/escalar_por_medida_log.csv'), 'utf8');
    for (const l of csv.split(/\r?\n/).slice(1)) {
      if (!l.trim()) continue;
      const cod = l.slice(0, l.indexOf(','));
      const m = l.match(/factor=([0-9.]+)/);
      if (cod && m) factor.set(cod, parseFloat(m[1]));
    }
  } catch { /* sin el log, se decide sólo por la medida intermedia */ }
  return factor;
}

async function main() {
  const familias = await get('familias?select=*&activa=eq.true');
  const productos = [];
  for (let off = 0; ; off += 1000) {
    const chunk = await get(`catalogo_publico?select=codigo,descripcion,categoria,subcategoria,medidas,foto&order=codigo&limit=1000&offset=${off}`);
    productos.push(...chunk);
    if (chunk.length < 1000) break;
  }
  const porCod = new Map(productos.map(p => [p.codigo, p]));
  const factor = await factoresEscalado();
  const locales = new Set(await readdir(join(RAIZ, 'catalogo-web/fotos')));

  const grupos = [];
  for (const f of familias) {
    if (f.criterio !== 'medida') continue;      // las de función no se tocan
    const cods = [];
    for (const g of (f.subgrupos || [])) for (const c of (g.cods || [])) cods.push(c);
    const prods = cods.map(c => porCod.get(c)).filter(Boolean).map(p => ({
      cod: p.codigo, nom: p.descripcion, med: p.medidas || '',
      foto: p.foto || '', src: rutaFoto(p, locales),
      factor: factor.has(p.codigo) ? factor.get(p.codigo) : null,
      val: valorMedida(p.medidas),
    }));
    const conFoto = prods.filter(p => p.src);            // sólo fotos que EXISTEN
    if (conFoto.length < 2) continue;
    if (new Set(conFoto.map(p => p.foto)).size < 2) continue;   // ya está unificada

    let elegido = conFoto.find(p => p.factor === 1);
    let motivo = 'foto original, sin escalar';
    if (!elegido) {
      const ord = conFoto.filter(p => p.val != null).sort((a, b) => a.val - b.val);
      if (ord.length) { elegido = ord[Math.floor(ord.length / 2)]; motivo = 'medida intermedia'; }
    }
    if (!elegido) { elegido = conFoto[0]; motivo = 'primera con foto'; }

    prods.sort((a, b) => (a.val ?? Infinity) - (b.val ?? Infinity) || a.cod.localeCompare(b.cod, 'es'));
    grupos.push({ id: f.id, nombre: f.nombre, cat: f.cat, sub: f.sub || '', n: prods.length, elegido: elegido.cod, motivo, prods });
  }
  grupos.sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre, 'es'));

  const totalCambios = grupos.reduce((a, g) => a + g.prods.filter(p => p.cod !== g.elegido).length, 0);

  const tarjetas = grupos.map((g, i) => {
    const eleg = g.prods.find(p => p.cod === g.elegido);
    return `
<section class="fam" data-id="${esc(g.id)}" data-i="${i}">
  <header>
    <h2>${esc(g.nombre)} <small>${g.n} productos</small></h2>
    <div class="ruta">${esc(g.cat)}${g.sub && g.sub !== g.cat ? ' › ' + esc(g.sub) : ''}</div>
    <label class="saltar"><input type="checkbox" class="chk-saltar" /> No unificar esta agrupación</label>
  </header>
  <div class="cuerpo">
    <!-- La propuesta va aparte y en grande: dentro de la tira se perdía al
         hacer scroll horizontal y no se veía cuál era sin buscarla. -->
    <div class="propuesta">
      <div class="et">Propuesta</div>
      <img class="grande" src="${esc(eleg ? eleg.src : '')}" alt="${esc(g.elegido)}" />
      <div class="pie"><b class="elegido-txt">${esc(g.elegido)}</b>
        <span class="med">${esc(eleg && eleg.med ? eleg.med : '—')}</span>
        <span class="motivo">${esc(g.motivo)}</span></div>
    </div>
    <div class="alternativas">
      <div class="et">Las ${g.prods.length} del grupo — clic para elegir otra</div>
      <div class="fotos">
        ${g.prods.map(p => `
        <figure class="op${p.cod === g.elegido ? ' on' : ''}${p.src ? '' : ' sinfoto'}" data-cod="${esc(p.cod)}"
                data-src="${esc(p.src || '')}" data-med="${esc(p.med || '—')}" title="${esc(p.nom)}">
          ${p.src ? `<img loading="lazy" src="${esc(p.src)}" alt="${esc(p.cod)}" />`
                  : `<div class="nofoto">sin foto</div>`}
          <figcaption><b>${esc(p.med || '—')}</b><span>${esc(p.cod)}</span></figcaption>
        </figure>`).join('')}
      </div>
    </div>
  </div>
</section>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Revisión de fotos por agrupación · Aceros Peñascal</title>
<style>
:root{--oxido:#921A2A;--zintro:#3E7E41;--linea:#D6DBDE;--gris:#646E76;--fondo:#EBEEF0}
*{box-sizing:border-box}
body{margin:0;font:15px/1.45 'Segoe UI',Roboto,Arial,sans-serif;color:#13171A;background:var(--fondo)}
header.top{position:sticky;top:0;z-index:9;background:linear-gradient(180deg,#B23145,#921A2A);color:#fff;padding:12px 20px;
  display:flex;align-items:center;gap:16px;flex-wrap:wrap;box-shadow:0 2px 10px rgba(0,0,0,.2)}
header.top h1{font-size:16px;margin:0;letter-spacing:.5px}
header.top .n{font-size:12.5px;opacity:.9}
header.top button{margin-left:auto;background:#fff;color:var(--oxido);border:0;border-radius:8px;
  padding:9px 16px;font-weight:700;font-size:13px;cursor:pointer}
.intro{max-width:900px;margin:18px auto 4px;padding:0 20px;color:#2b3238;font-size:14px}
.intro b{color:var(--oxido)}
.fam{max-width:1280px;margin:18px auto;background:#fff;border:1px solid var(--linea);border-radius:12px;padding:16px 18px}
.fam.saltada{opacity:.45}
.fam header{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:2px}
.fam h2{font-size:17px;margin:0}
.fam h2 small{font-weight:400;color:var(--gris);font-size:12.5px}
.ruta{font-size:11.5px;text-transform:uppercase;letter-spacing:1px;color:var(--gris)}
.saltar{margin-left:auto;font-size:12.5px;color:var(--gris);display:flex;gap:6px;align-items:center;cursor:pointer}
.cuerpo{display:flex;gap:18px;align-items:flex-start;margin-top:10px}
.et{font-size:10.5px;text-transform:uppercase;letter-spacing:1.2px;color:var(--gris);margin-bottom:6px}
.propuesta{flex:0 0 210px;border:2px solid var(--zintro);border-radius:10px;padding:10px;background:#f3f9f3}
.propuesta .grande{width:100%;height:170px;object-fit:contain;background:#fff;border-radius:6px;display:block}
.propuesta .pie{margin-top:7px;font-size:12px;line-height:1.4}
.propuesta .pie b{display:block;font-family:Consolas,monospace;font-size:11.5px;word-break:break-all}
.propuesta .med{display:block;font-weight:700}
.propuesta .motivo{display:block;color:var(--gris);font-size:11px}
.alternativas{flex:1;min-width:0}
.fotos{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px}
figure.op{margin:0;flex:0 0 118px;border:2px solid var(--linea);border-radius:10px;padding:5px;cursor:pointer;background:#fff}
figure.op:hover{border-color:#9aa4ac}
figure.op.on{border-color:var(--zintro);box-shadow:0 0 0 3px rgba(62,126,65,.18)}
figure.op.sinfoto{opacity:.45;cursor:not-allowed;background:#f6f7f8}
figure.op img{width:100%;height:104px;object-fit:contain;background:#fff;display:block}
.nofoto{height:104px;display:flex;align-items:center;justify-content:center;color:var(--gris);
  font-size:11px;background:repeating-linear-gradient(45deg,#f0f2f3,#f0f2f3 6px,#e7eaec 6px,#e7eaec 12px);border-radius:6px}
figcaption{font-size:10.5px;text-align:center;margin-top:4px;line-height:1.25}
figcaption b{display:block}
figcaption span{color:var(--gris);font-family:Consolas,monospace;font-size:9.5px;word-break:break-all}
#salida{position:fixed;inset:auto 0 0 0;max-height:45vh;overflow:auto;background:#13171A;color:#7CE38B;
  font:11px/1.4 Consolas,monospace;padding:12px 16px;display:none;white-space:pre-wrap}
#salida.on{display:block}
</style></head><body>

<header class="top">
  <h1>Revisión de fotos por agrupación</h1>
  <span class="n">${grupos.length} agrupaciones · ${totalCambios} productos cambiarían de foto</span>
  <button id="btnExportar">Copiar mi decisión</button>
</header>

<p class="intro">
  Cada bloque es una agrupación donde <b>lo único que cambia es la medida</b>, así que todos sus
  productos deberían enseñar la misma foto. La que tiene marco verde es la propuesta;
  <b>haz clic en otra si prefieres esa</b>, o marca «No unificar» si esa agrupación debe quedarse como está.
  Al terminar, pulsa <b>Copiar mi decisión</b> y pásame el texto.
  <br>Las agrupaciones por <b>función</b> (discos, brocas, chapas, tornillería) no aparecen aquí a propósito:
  ahí la foto sí tiene que cambiar de una a otra.
</p>

${tarjetas}

<pre id="salida"></pre>

<script>
const DATOS = ${JSON.stringify(grupos.map(g => ({ id: g.id, nombre: g.nombre, elegido: g.elegido })))};
document.querySelectorAll('.fam').forEach(sec => {
  const i = +sec.dataset.i;
  sec.querySelectorAll('figure.op').forEach(fig => {
    if (fig.classList.contains('sinfoto')) return;
    fig.onclick = () => {
      sec.querySelectorAll('figure.op').forEach(x => x.classList.remove('on'));
      fig.classList.add('on');
      DATOS[i].elegido = fig.dataset.cod;
      DATOS[i].cambiada = true;
      sec.querySelector('.elegido-txt').textContent = fig.dataset.cod;
      sec.querySelector('.med').textContent = fig.dataset.med;
      sec.querySelector('.motivo').textContent = 'elegida por ti';
      sec.querySelector('.grande').src = fig.dataset.src;
    };
  });
  sec.querySelector('.chk-saltar').onchange = (e) => {
    DATOS[i].saltar = e.target.checked;
    sec.classList.toggle('saltada', e.target.checked);
  };
});
document.getElementById('btnExportar').onclick = async () => {
  const txt = JSON.stringify(DATOS.filter(d => !d.saltar).map(d => ({ id: d.id, foto_de: d.elegido })), null, 1);
  const pre = document.getElementById('salida');
  pre.textContent = txt; pre.classList.add('on');
  try { await navigator.clipboard.writeText(txt); alert('Copiado al portapapeles. Pégaselo a Claude.'); }
  catch { alert('No se pudo copiar solo: selecciona el texto de abajo y cópialo a mano.'); }
};
</script>
</body></html>`;

  const destino = join(RAIZ, 'datos/revision_fotos_agrupaciones.html');
  await writeFile(destino, html, 'utf8');
  console.log(`✓ ${destino}`);
  console.log(`  ${grupos.length} agrupaciones por medida · ${totalCambios} productos cambiarían de foto`);
}

main().catch(e => { console.error('✗', e.message); process.exit(1); });
