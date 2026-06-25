// Pipeline de enriquecimiento del catalogo · Aceros Penascal · MOTRAE
// Clasifica + escribe funcionamiento/specs de los 3,222 productos con la API de Claude.
// Modos:  smoke (3 productos, sincrono)  |  run (Batch API, todos)  |  poll (reanuda un batch)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.resolve(__dirname, "..");
const IN_JSON = path.join(BASE, "catalogo-web", "data", "productos.json");
const OUT_JSON = path.join(BASE, "datos", "catalogo_enriquecido.json");
const BATCH_ID_FILE = path.join(__dirname, ".batch_id");

// ---- .env loader (sin dependencias) ----
function loadEnv() {
  const p = path.join(__dirname, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const MODEL = process.env.MODEL || "claude-opus-4-8";
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey || apiKey.startsWith("sk-ant-...")) {
  console.error("\nFalta ANTHROPIC_API_KEY. Crea pipeline\\.env con tu key (ver .env.example).\n");
  process.exit(1);
}
const client = new Anthropic({ apiKey });

// ---- Taxonomia (14 categorias; el modelo elige EXACTAMENTE una) ----
const CATEGORIAS = [
  "Perfiles estructurales", "Acero (barra y placa)", "Lamina y cubiertas",
  "Tuberia y conexiones", "Alambre, malla y cercas", "Tornilleria y fijacion",
  "Herreria, forja y herrajes", "Soldadura y abrasivos", "Herramienta electrica",
  "Herramienta manual", "Pintura y quimicos", "Seguridad (EPP)",
  "Electrico e iluminacion",
];

const SYSTEM = `Eres especialista en catalogacion de productos de acero, ferreteria, herreria y herramienta para el mercado mexicano (distribuidora Aceros Penascal, Xalapa, Veracruz). Recibes el CODIGO interno y la DESCRIPCION abreviada de un producto, tal como aparece en su sistema de inventario. Devuelves SOLO el objeto JSON solicitado, con informacion correcta y profesional basada en tu conocimiento del sector.

REGLAS por campo:
- categoria: elige EXACTAMENTE una de esta lista: ${CATEGORIAS.map((c) => `"${c}"`).join(", ")}.
- subcategoria: subcategoria comercial estandar dentro de la categoria (ej. "PTR", "Lamina acanalada", "Disco de corte", "Electrodo 6013", "Taladro percutor", "Llave espanola"). Concisa.
- marca: marca comercial si la descripcion la menciona o implica (DeWalt, Milwaukee, Urrea, Truper, Ternium, Lincoln, Infra, etc.); si no aplica, "Generico".
- material: material principal (acero al carbon, acero galvanizado, acero inoxidable, aluminio, PVC, policarbonato, etc.) o "N/A".
- medida: dimensiones / calibre / medida si aplica (ej. "2 x 2 cal 14", "14 pulg", "1/2 pulg", "3/4 x 6 m"); si no, "".
- unidad: unidad de venta mas probable (pieza, metro, tramo, kg, juego, caja, rollo, par).
- funcionamiento: 1-2 frases claras en espanol: para que sirve y como se usa el producto, redactado de cara al cliente final.
- especificaciones: 2 a 5 specs tecnicas clave, cada una en una frase corta.
- palabras_clave: 3 a 6 terminos de busqueda que un cliente usaria (sinonimos, usos, medidas comunes).

No inventes numeros de parte ni datos falsos. Si la descripcion es ambigua, haz la mejor inferencia razonable del sector. Responde en espanol.

EJEMPLOS:
CODIGO: PTR2X2C14 / DESCRIPCION: PTR 2X2 CAL 14 6MTS
-> categoria "Perfiles estructurales", subcategoria "PTR", marca "Generico", material "acero al carbon", medida "2 x 2 cal 14", unidad "tramo", funcionamiento "Perfil tubular estructural cuadrado, se usa como elemento de carga en estructuras metalicas, herreria, techumbres y cancha. Se corta y suelda a medida.", especificaciones ["Seccion 2 x 2 pulgadas","Calibre 14","Tramo de 6 metros","Acero al carbon rolado en frio"], palabras_clave ["ptr","perfil tubular","estructural","2x2","calibre 14"].
CODIGO: D48-40-4515 / DESCRIPCION: DISCO MILWAUKEE 8"
-> categoria "Soldadura y abrasivos", subcategoria "Disco de corte", marca "Milwaukee", material "abrasivo / oxido de aluminio", medida "8 pulg", unidad "pieza", funcionamiento "Disco abrasivo para corte de metal, se monta en esmeriladora angular para cortar perfiles, solera, lamina y tuberia.", especificaciones ["Diametro 8 pulgadas","Para esmeriladora angular","Corte de metal ferroso"], palabras_clave ["disco","corte","esmeriladora","milwaukee","abrasivo"].`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    categoria: { type: "string", enum: CATEGORIAS },
    subcategoria: { type: "string" },
    marca: { type: "string" },
    material: { type: "string" },
    medida: { type: "string" },
    unidad: { type: "string" },
    funcionamiento: { type: "string" },
    especificaciones: { type: "array", items: { type: "string" } },
    palabras_clave: { type: "array", items: { type: "string" } },
  },
  required: ["categoria", "subcategoria", "marca", "material", "medida", "unidad", "funcionamiento", "especificaciones", "palabras_clave"],
};

function userMsg(p) {
  return `CODIGO: ${p.cod}\nDESCRIPCION: ${p.nom}\nPista de categoria previa (puede estar mal): ${p.cat}`;
}

function paramsFor(p) {
  return {
    model: MODEL,
    max_tokens: 1024,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userMsg(p) }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  };
}

function firstJson(message) {
  const block = message.content.find((b) => b.type === "text");
  return JSON.parse(block.text);
}

function loadProducts() {
  const data = JSON.parse(fs.readFileSync(IN_JSON, "utf8"));
  return data.productos;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- SMOKE: 3 productos, sincrono ----------
async function smoke() {
  const prods = loadProducts().slice(0, 3);
  console.log(`Smoke test con ${MODEL} sobre ${prods.length} productos...\n`);
  for (const p of prods) {
    const msg = await client.messages.create(paramsFor(p));
    console.log(`# ${p.cod} — ${p.nom}`);
    console.log(JSON.stringify(firstJson(msg), null, 2));
    console.log("");
  }
  console.log("Smoke OK. Si el formato te parece bien, corre:  npm run run");
}

// ---------- RUN: Batch API, todos ----------
async function run() {
  const prods = loadProducts();
  const limit = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : prods.length;
  const subset = prods.slice(0, limit);
  console.log(`Enviando batch: ${subset.length} productos · modelo ${MODEL}`);

  const requests = subset.map((p, i) => ({ custom_id: `p${i}`, params: paramsFor(p) }));
  const batch = await client.messages.batches.create({ requests });
  fs.writeFileSync(BATCH_ID_FILE, batch.id, "utf8");
  console.log(`Batch creado: ${batch.id}  (guardado en .batch_id)`);
  await pollAndCollect(batch.id, subset);
}

// ---------- POLL: reanudar ----------
async function poll() {
  const id = fs.existsSync(BATCH_ID_FILE) ? fs.readFileSync(BATCH_ID_FILE, "utf8").trim() : process.env.BATCH_ID;
  if (!id) { console.error("No hay .batch_id ni BATCH_ID."); process.exit(1); }
  await pollAndCollect(id, loadProducts());
}

async function pollAndCollect(id, prods) {
  let batch;
  for (;;) {
    batch = await client.messages.batches.retrieve(id);
    const c = batch.request_counts;
    process.stdout.write(`\rEstado: ${batch.processing_status}  ok=${c.succeeded} proc=${c.processing} err=${c.errored}   `);
    if (batch.processing_status === "ended") break;
    await sleep(20000);
  }
  console.log("\nBatch terminado. Recolectando resultados...");

  const byId = new Map(prods.map((p, i) => [`p${i}`, p]));
  const out = [];
  let okN = 0, errN = 0;
  for await (const r of await client.messages.batches.results(id)) {
    const p = byId.get(r.custom_id);
    if (!p) continue;
    if (r.result.type === "succeeded") {
      try {
        const e = firstJson(r.result.message);
        out.push({ codigo: p.cod, descripcion: p.nom, proveedor: p.prov, ...e });
        okN++;
      } catch {
        out.push({ codigo: p.cod, descripcion: p.nom, proveedor: p.prov, error: "json_parse" });
        errN++;
      }
    } else {
      out.push({ codigo: p.cod, descripcion: p.nom, proveedor: p.prov, error: r.result.type });
      errN++;
    }
  }
  out.sort((a, b) => a.codigo.localeCompare(b.codigo));
  fs.writeFileSync(OUT_JSON, JSON.stringify({ generado: new Date().toISOString(), modelo: MODEL, total: out.length, productos: out }, null, 2), "utf8");
  console.log(`Listo. ok=${okN} err=${errN}`);
  console.log(`Salida: ${OUT_JSON}`);
}

const mode = process.argv[2] || "smoke";
const fn = { smoke, run, poll }[mode];
if (!fn) { console.error(`Modo desconocido: ${mode}. Usa smoke | run | poll`); process.exit(1); }
fn().catch((e) => { console.error("\nERROR:", e?.message || e); process.exit(1); });
