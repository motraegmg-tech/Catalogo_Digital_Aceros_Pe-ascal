#!/usr/bin/env node
/** Genera la pantalla de revisión de familias a partir de familias_propuestas.json */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const fams = JSON.parse(await readFile(join(ROOT, 'datos', 'familias_propuestas.json'), 'utf8'));

// Compacta: la pantalla no necesita la foto ni el nombre completo repetido.
const corta = (s) => s.length > 62 ? s.slice(0, 60) + '…' : s;
const datos = fams.map((f, i) => ({
  i, c: f.cat, s: f.sub, f: f.nombre, n: f.n, d: f.distintas,
  q: f.confianza, a: f.alertas, o: f.origen.startsWith('regla') ? 'regla' : 'nombre',
  g: f.subgrupos.map(s => ({
    t: s.nombre, n: s.n,
    p: s.productos.map(p => [p.cod, p.med, corta(p.nom)]),
  })),
}));

const total = datos.reduce((a, f) => a + f.n, 0);
const cats = [...new Set(datos.map(f => f.c))].sort((a, b) => a.localeCompare(b, 'es'));
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const html = `<title>Propuestas de agrupación · Catálogo Aceros Peñascal</title>
<style>
:root{
  --tinta:#101619; --tinta-2:#3d4b4f; --tenue:#6d7c80;
  --fondo:#f6f8f8; --panel:#ffffff; --linea:#dde5e6; --linea-2:#eef3f3;
  --acento:#0E7E8C; --acento-suave:#e2f0f2;
  --alta:#2E7D5B; --media:#8A6414; --baja:#A8443A;
  --alta-bg:#e6f2ec; --media-bg:#faf0dc; --baja-bg:#f7e6e3;
  --sombra:0 1px 2px rgba(16,22,25,.06);
}
@media (prefers-color-scheme:dark){:root{
  --tinta:#e8eef0; --tinta-2:#adbcc0; --tenue:#7c8b90;
  --fondo:#101619; --panel:#182124; --linea:#2a373b; --linea-2:#212c30;
  --acento:#4db8c6; --acento-suave:#152e33;
  --alta:#6cc79a; --media:#d9ab5a; --baja:#e08a7e;
  --alta-bg:#163024; --media-bg:#332912; --baja-bg:#331e1a;
  --sombra:0 1px 2px rgba(0,0,0,.3);
}}
:root[data-theme="dark"]{
  --tinta:#e8eef0; --tinta-2:#adbcc0; --tenue:#7c8b90;
  --fondo:#101619; --panel:#182124; --linea:#2a373b; --linea-2:#212c30;
  --acento:#4db8c6; --acento-suave:#152e33;
  --alta:#6cc79a; --media:#d9ab5a; --baja:#e08a7e;
  --alta-bg:#163024; --media-bg:#332912; --baja-bg:#331e1a;
  --sombra:0 1px 2px rgba(0,0,0,.3);
}
:root[data-theme="light"]{
  --tinta:#101619; --tinta-2:#3d4b4f; --tenue:#6d7c80;
  --fondo:#f6f8f8; --panel:#ffffff; --linea:#dde5e6; --linea-2:#eef3f3;
  --acento:#0E7E8C; --acento-suave:#e2f0f2;
  --alta:#2E7D5B; --media:#8A6414; --baja:#A8443A;
  --alta-bg:#e6f2ec; --media-bg:#faf0dc; --baja-bg:#f7e6e3;
  --sombra:0 1px 2px rgba(16,22,25,.06);
}
*{box-sizing:border-box}
body{margin:0;background:var(--fondo);color:var(--tinta);
  font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;
  -webkit-font-smoothing:antialiased}
.mono{font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-variant-numeric:tabular-nums}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px 80px}

header{border-bottom:1px solid var(--linea);background:var(--panel);margin-bottom:22px}
.head-in{max-width:1080px;margin:0 auto;padding:26px 20px 20px}
h1{margin:0 0 6px;font-size:23px;font-weight:650;letter-spacing:-.02em;text-wrap:balance}
.sub{margin:0;color:var(--tenue);font-size:14px;max-width:66ch}
.cifras{display:flex;flex-wrap:wrap;gap:26px;margin-top:20px}
.cifra b{display:block;font-size:26px;font-weight:650;letter-spacing:-.02em;line-height:1.1}
.cifra span{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--tenue)}

.barra{position:sticky;top:0;z-index:5;background:var(--panel);border-bottom:1px solid var(--linea);
  padding:11px 0;margin-bottom:20px;box-shadow:var(--sombra)}
.barra-in{max-width:1080px;margin:0 auto;padding:0 20px;display:flex;flex-wrap:wrap;gap:9px;align-items:center}
select,input[type=search]{font:inherit;font-size:13px;padding:7px 10px;border:1px solid var(--linea);
  border-radius:7px;background:var(--panel);color:var(--tinta)}
input[type=search]{flex:1;min-width:170px}
select:focus-visible,input:focus-visible,button:focus-visible{outline:2px solid var(--acento);outline-offset:2px}
.marcador{margin-left:auto;font-size:13px;color:var(--tenue);display:flex;gap:14px;align-items:center}
.marcador b{color:var(--tinta);font-weight:650}

.cat-tit{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--tenue);
  margin:26px 0 9px;padding-bottom:6px;border-bottom:1px solid var(--linea-2)}
.fam{background:var(--panel);border:1px solid var(--linea);border-radius:10px;margin-bottom:8px;
  overflow:hidden;transition:border-color .12s}
.fam[data-d="si"]{border-color:var(--alta);border-left:4px solid var(--alta)}
.fam[data-d="no"]{border-color:var(--baja);border-left:4px solid var(--baja);opacity:.62}
.fila{display:flex;align-items:center;gap:12px;padding:12px 14px;cursor:pointer}
.fila:hover{background:var(--linea-2)}
.nom{font-weight:600;font-size:15px;letter-spacing:-.01em}
.ruta{font-size:12px;color:var(--tenue);margin-top:2px}
.centro{flex:1;min-width:0}
.chip{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
  padding:3px 8px;border-radius:20px;white-space:nowrap}
.q-alta{background:var(--alta-bg);color:var(--alta)}
.q-media{background:var(--media-bg);color:var(--media)}
.q-baja{background:var(--baja-bg);color:var(--baja)}
.cuenta{font-size:13px;color:var(--tinta-2);white-space:nowrap}
.alertas{font-size:11.5px;color:var(--media);margin-top:3px}
.acciones{display:flex;gap:6px}
button{font:inherit;font-size:13px;font-weight:600;padding:6px 13px;border-radius:7px;
  border:1px solid var(--linea);background:var(--panel);color:var(--tinta-2);cursor:pointer;
  transition:all .12s}
button:hover{border-color:var(--tinta-2)}
.b-si[aria-pressed=true]{background:var(--alta);border-color:var(--alta);color:#fff}
.b-no[aria-pressed=true]{background:var(--baja);border-color:var(--baja);color:#fff}
.detalle{display:none;border-top:1px solid var(--linea-2);padding:4px 14px 12px;overflow-x:auto}
.fam.abierta .detalle{display:block}
table{width:100%;border-collapse:collapse;font-size:13px;min-width:440px}
th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;
  color:var(--tenue);font-weight:600;padding:9px 10px 6px;border-bottom:1px solid var(--linea-2)}
td{padding:6px 10px;border-bottom:1px solid var(--linea-2);vertical-align:top}
tr:last-child td{border-bottom:0}
.td-med{font-weight:650;color:var(--acento);white-space:nowrap}
.td-cod{color:var(--tenue);font-size:12px;white-space:nowrap}
.vacia{color:var(--tenue);font-style:italic}
.sub-tit{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;
  color:var(--acento);margin:14px 0 0;padding-top:10px;border-top:1px solid var(--linea-2);
  display:flex;align-items:center;gap:8px}
.sub-tit:first-child{border-top:0;margin-top:6px;padding-top:0}
.sub-tit span{font-size:11px;font-weight:600;color:var(--tenue);background:var(--acento-suave);
  padding:2px 7px;border-radius:20px;letter-spacing:0}
.o-regla{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--tenue);
  border:1px solid var(--linea);padding:2px 6px;border-radius:4px}

.pie{position:fixed;left:0;right:0;bottom:0;background:var(--panel);border-top:1px solid var(--linea);
  padding:11px 0;box-shadow:0 -1px 3px rgba(16,22,25,.07);z-index:6}
.pie-in{max-width:1080px;margin:0 auto;padding:0 20px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.pie span{font-size:13px;color:var(--tenue)}
.b-exp{background:var(--acento);border-color:var(--acento);color:#fff}
.b-exp:hover{opacity:.9;border-color:var(--acento)}
textarea{width:100%;height:190px;margin-top:11px;font-family:ui-monospace,Consolas,monospace;
  font-size:12px;padding:11px;border:1px solid var(--linea);border-radius:8px;
  background:var(--fondo);color:var(--tinta);display:none}
textarea.ver{display:block}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
@media (max-width:620px){
  .fila{flex-wrap:wrap}.acciones{width:100%;justify-content:flex-end}
  .cifras{gap:18px}.cifra b{font-size:21px}
}
</style>

<header>
  <div class="head-in">
    <h1>Propuestas de agrupación por medida</h1>
    <p class="sub">Productos que solo se diferencian por la medida y podrían presentarse como una
      sola ficha con selector. Nada de esto está aplicado: marca <b>Sí</b> o <b>No</b> en cada una
      y al final copia el resultado.</p>
    <div class="cifras">
      <div class="cifra"><b>${datos.length}</b><span>familias propuestas</span></div>
      <div class="cifra"><b>${total.toLocaleString('es-MX')}</b><span>productos que cubren</span></div>
      <div class="cifra"><b>3,150</b><span>fichas hoy</span></div>
      <div class="cifra"><b>${(3150 - total + datos.length).toLocaleString('es-MX')}</b><span>fichas si se aprueban todas</span></div>
    </div>
  </div>
</header>

<div class="barra"><div class="barra-in">
  <select id="fq">
    <option value="">Toda confianza</option>
    <option value="alta">Alta (${datos.filter(f => f.q === 'alta').length})</option>
    <option value="media">Media (${datos.filter(f => f.q === 'media').length})</option>
    <option value="baja">Baja (${datos.filter(f => f.q === 'baja').length})</option>
  </select>
  <select id="fc"><option value="">Todas las categorías</option>${cats.map(c => `<option>${esc(c)}</option>`).join('')}</select>
  <select id="fo">
    <option value="">Todo tipo de agrupación</option>
    <option value="regla">Por marca / función (${datos.filter(f => f.o === 'regla').length})</option>
    <option value="nombre">Por medida (${datos.filter(f => f.o === 'nombre').length})</option>
  </select>
  <select id="fd">
    <option value="">Decididas y sin decidir</option>
    <option value="pend">Solo sin decidir</option>
    <option value="si">Solo aprobadas</option>
    <option value="no">Solo descartadas</option>
  </select>
  <input type="search" id="fb" placeholder="Buscar familia, código o medida…">
  <div class="marcador"><span><b id="mSi">0</b> sí</span><span><b id="mNo">0</b> no</span><span><b id="mP">${datos.length}</b> pendientes</span></div>
</div></div>

<div class="wrap"><div id="lista"></div></div>

<div class="pie"><div class="pie-in">
  <button class="b-exp" id="bExp">Copiar decisiones</button>
  <button id="bSiAlta">Aprobar todas las de confianza alta</button>
  <button id="bLimpiar">Empezar de nuevo</button>
  <span id="pieTxt">Se guardan solas en este navegador.</span>
</div></div>
<div class="wrap"><textarea id="salida" readonly></textarea></div>

<script>
const FAM = ${JSON.stringify(datos)};
const LS = 'ap_familias_decision_v1';
let D = {};
try { D = JSON.parse(localStorage.getItem(LS)) || {}; } catch {}

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function guardar(){ try { localStorage.setItem(LS, JSON.stringify(D)); } catch {} }

function contar(){
  const si = Object.values(D).filter(v => v === 'si').length;
  const no = Object.values(D).filter(v => v === 'no').length;
  $('#mSi').textContent = si; $('#mNo').textContent = no;
  $('#mP').textContent = FAM.length - si - no;
}

function visibles(){
  const q = $('#fq').value, c = $('#fc').value, d = $('#fd').value, o = $('#fo').value;
  const b = $('#fb').value.trim().toLowerCase();
  return FAM.filter(f => {
    if (q && f.q !== q) return false;
    if (c && f.c !== c) return false;
    if (o && f.o !== o) return false;
    const dec = D[f.i] || 'pend';
    if (d && dec !== d) return false;
    if (b){
      const heno = (f.f + ' ' + f.c + ' ' + f.g.map(g =>
        g.t + ' ' + g.p.map(p => p[0] + ' ' + p[1] + ' ' + p[2]).join(' ')).join(' ')).toLowerCase();
      if (!heno.includes(b)) return false;
    }
    return true;
  });
}

function render(){
  const lista = visibles();
  const cont = $('#lista');
  if (!lista.length){ cont.innerHTML = '<p class="vacia">Ninguna familia coincide con el filtro.</p>'; contar(); return; }
  const porCat = {};
  for (const f of lista){ (porCat[f.c] = porCat[f.c] || []).push(f); }
  cont.innerHTML = Object.entries(porCat).map(([cat, fs]) => \`
    <h2 class="cat-tit">\${esc(cat)} · \${fs.length} familia\${fs.length > 1 ? 's' : ''}</h2>
    \${fs.map(f => \`
      <article class="fam" data-i="\${f.i}" data-d="\${D[f.i] || ''}">
        <div class="fila" role="button" tabindex="0" aria-expanded="false">
          <span class="chip q-\${f.q}">\${f.q}</span>
          <div class="centro">
            <div class="nom">\${esc(f.f)}</div>
            <div class="ruta">\${f.n} productos · \${f.g.length} subgrupo\${f.g.length > 1 ? 's' : ''}: \${esc(f.g.slice(0, 4).map(g => g.t + ' (' + g.n + ')').join(', '))}\${f.g.length > 4 ? '…' : ''}</div>
            \${f.a.length ? \`<div class="alertas">⚠ \${esc(f.a.join(' · '))}</div>\` : ''}
          </div>
          <div class="acciones">
            <button class="b-si" aria-pressed="\${D[f.i] === 'si'}">Sí</button>
            <button class="b-no" aria-pressed="\${D[f.i] === 'no'}">No</button>
          </div>
        </div>
        <div class="detalle">
          \${f.g.map(g => \`
            <div class="sub-tit">\${esc(g.t)} <span>\${g.n}</span></div>
            <table><thead><tr><th>Medida</th><th>Código</th><th>Nombre actual</th></tr></thead><tbody>
            \${g.p.map(p => \`<tr>
              <td class="td-med mono">\${p[1] ? esc(p[1]) : '<span class="vacia">sin medida</span>'}</td>
              <td class="td-cod mono">\${esc(p[0])}</td>
              <td>\${esc(p[2])}</td></tr>\`).join('')}
            </tbody></table>\`).join('')}
        </div>
      </article>\`).join('')}\`).join('');
  contar();
}

$('#lista').addEventListener('click', (e) => {
  const art = e.target.closest('.fam'); if (!art) return;
  const i = art.dataset.i;
  if (e.target.closest('.b-si')){ D[i] = D[i] === 'si' ? undefined : 'si'; if (!D[i]) delete D[i]; guardar(); render(); return; }
  if (e.target.closest('.b-no')){ D[i] = D[i] === 'no' ? undefined : 'no'; if (!D[i]) delete D[i]; guardar(); render(); return; }
  if (e.target.closest('.fila')){
    art.classList.toggle('abierta');
    art.querySelector('.fila').setAttribute('aria-expanded', art.classList.contains('abierta'));
  }
});
$('#lista').addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('fila')){ e.preventDefault(); e.target.click(); }
});

for (const id of ['#fq', '#fc', '#fd', '#fo']) $(id).addEventListener('change', render);
$('#fb').addEventListener('input', render);

$('#bSiAlta').addEventListener('click', () => {
  for (const f of FAM) if (f.q === 'alta' && !D[f.i]) D[f.i] = 'si';
  guardar(); render();
});
$('#bLimpiar').addEventListener('click', () => {
  if (!confirm('Se borran todas las decisiones marcadas. ¿Seguir?')) return;
  D = {}; guardar(); render();
});
$('#bExp').addEventListener('click', () => {
  const si = FAM.filter(f => D[f.i] === 'si'), no = FAM.filter(f => D[f.i] === 'no');
  const t = [
    '# Decisiones sobre las familias propuestas',
    \`# \${si.length} aprobadas · \${no.length} descartadas · \${FAM.length - si.length - no.length} sin decidir\`,
    '', 'APROBADAS:',
    ...si.map(f => \`  [\${f.c} > \${f.s}] \${f.f}  (\${f.n} productos)\`),
    '', 'DESCARTADAS:',
    ...no.map(f => \`  [\${f.c} > \${f.s}] \${f.f}\`),
  ].join('\\n');
  const ta = $('#salida'); ta.value = t; ta.classList.add('ver'); ta.select();
  try { document.execCommand('copy'); $('#pieTxt').textContent = 'Copiado. Pégamelo en el chat.'; }
  catch { $('#pieTxt').textContent = 'Copia el texto de abajo y pégamelo en el chat.'; }
});

render();
</script>`;

await writeFile(join(ROOT, 'datos', 'revision_familias.html'), html, 'utf8');
console.log('✓ datos/revision_familias.html', Math.round(html.length / 1024), 'KB');
