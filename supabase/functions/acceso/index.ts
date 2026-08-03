/* acceso — alta de cuentas del clasificador con PIN del responsable.
 *
 * Dos acciones:
 *   solicitar → genera un PIN, lo guarda HASHEADO y se lo manda por correo al
 *               responsable (el dueño de Aceros Peñascal). Nunca al solicitante.
 *   registrar → comprueba el PIN, crea el usuario en Supabase y lo agrega a la
 *               lista `editores` para que pueda trabajar de inmediato.
 *
 * Por qué vive aquí y no en el navegador: la comprobación del PIN y la creación
 * del usuario necesitan la llave de servicio. Si estuvieran en el cliente,
 * cualquiera abriría las herramientas de desarrollo y se saltaría el paso.
 *
 * `verify_jwt` está en false a propósito: quien pide el alta todavía no tiene
 * cuenta, así que no puede traer un token. La puerta la guarda el PIN, más los
 * límites de intentos de abajo.
 *
 * Desplegar:  supabase functions deploy acceso --no-verify-jwt
 * Secretos:   RESEND_API_KEY (opcional, para enviar el correo)
 *             RESEND_DE      (opcional, remitente verificado)
 * Sin RESEND_API_KEY la solicitud igual se registra y el PIN queda visible
 * para los editores en el clasificador, para no dejar a nadie atascado.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const LLAVE_SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_DE = Deno.env.get("RESEND_DE") ?? "Catálogo Aceros Peñascal <onboarding@resend.dev>";

/* Límites. Un PIN de 6 cifras es 1 entre un millón, pero sólo si no se puede
   probar en bucle: 5 intentos por solicitud y la solicitud se quema. */
const MINUTOS_VIGENCIA = 30;
const MAX_INTENTOS = 5;
const MAX_SOLICITUDES_POR_CORREO_HORA = 3;
const MAX_SOLICITUDES_GLOBAL_HORA = 20;
const MIN_LARGO_CONTRASENA = 8;

const sb = createClient(URL_SB, LLAVE_SERVICIO, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const correoValido = (c: string) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(c);
const normalizar = (c: string) => String(c || "").trim().toLowerCase();

/** ma***@gmail.com — para decirle al solicitante a dónde fue sin revelarlo. */
function enmascarar(correo: string) {
  const [u, d] = correo.split("@");
  if (!d) return "***";
  const visible = u.slice(0, Math.min(2, u.length));
  return `${visible}${"*".repeat(Math.max(3, u.length - visible.length))}@${d}`;
}

async function sha256(texto: string) {
  const datos = new TextEncoder().encode(texto);
  const hash = await crypto.subtle.digest("SHA-256", datos);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Comparación en tiempo constante: no filtrar por cuánto tarda en fallar. */
function igualSeguro(a: string, b: string) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

function pinNuevo() {
  // 6 cifras con generador criptográfico, no Math.random()
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(n[0] % 1_000_000).padStart(6, "0");
}

async function correoDelResponsable() {
  const { data } = await sb.from("ajustes").select("valor").eq("clave", "correo_autorizador").maybeSingle();
  const v = (data?.valor ?? {}) as { correo?: string; nombre?: string };
  return { correo: normalizar(v.correo ?? ""), nombre: v.nombre ?? "Responsable del catálogo" };
}

async function enviarPin(destino: string, pin: string, quien: { correo: string; nombre: string }) {
  if (!RESEND_API_KEY) return { ok: false, motivo: "sin proveedor de correo configurado" };
  const cuerpo = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;color:#23292E">
      <h2 style="margin:0 0 4px">Alguien pide acceso al catálogo</h2>
      <p style="color:#646E76;margin:0 0 18px">Aceros Peñascal · panel de administración</p>
      <p><b>${quien.nombre || "(sin nombre)"}</b><br>
         <span style="color:#646E76">${quien.correo}</span></p>
      <p>Si lo reconoces y quieres darle acceso, pásale este PIN <b>en persona o por teléfono</b>:</p>
      <p style="font-size:34px;letter-spacing:10px;font-weight:700;text-align:center;
                background:#F4F6F7;border:2px solid #921A2A;border-radius:12px;padding:16px 10px;margin:18px 0">${pin}</p>
      <p style="color:#646E76;font-size:13px">Caduca en ${MINUTOS_VIGENCIA} minutos y sólo sirve una vez.
         <b>Si no reconoces a esta persona, ignora este correo</b>: sin el PIN no puede entrar.</p>
    </div>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: RESEND_DE,
        to: [destino],
        subject: `PIN de acceso al catálogo · ${quien.correo}`,
        html: cuerpo,
      }),
    });
    if (!r.ok) return { ok: false, motivo: `correo rechazado (${r.status})` };
    return { ok: true, motivo: "" };
  } catch (e) {
    return { ok: false, motivo: String((e as Error).message ?? e) };
  }
}

async function solicitar(correo: string, nombre: string) {
  if (!correoValido(correo)) return responder({ error: "Escribe un correo válido." }, 400);

  // ¿Ya puede entrar? Entonces no hay nada que pedir.
  const { data: yaEditor } = await sb.from("editores").select("correo").ilike("correo", correo).maybeSingle();
  if (yaEditor) {
    return responder({ error: "Ese correo ya tiene acceso. Inicia sesión con tu contraseña, o pide que te la restablezcan." }, 409);
  }

  // Límites, para que nadie use esto como máquina de spam contra el responsable.
  const haceUnaHora = new Date(Date.now() - 3600_000).toISOString();
  const { count: mias } = await sb.from("solicitudes_acceso")
    .select("id", { count: "exact", head: true })
    .ilike("correo", correo).gte("creada_en", haceUnaHora);
  if ((mias ?? 0) >= MAX_SOLICITUDES_POR_CORREO_HORA) {
    return responder({ error: "Ya pediste el PIN varias veces. Espera una hora o pídeselo directamente al responsable." }, 429);
  }
  const { count: todas } = await sb.from("solicitudes_acceso")
    .select("id", { count: "exact", head: true }).gte("creada_en", haceUnaHora);
  if ((todas ?? 0) >= MAX_SOLICITUDES_GLOBAL_HORA) {
    return responder({ error: "Hay demasiadas solicitudes en este momento. Inténtalo más tarde." }, 429);
  }

  const responsable = await correoDelResponsable();
  if (!responsable.correo) {
    return responder({ error: "Todavía no se ha configurado a quién avisar. Pide que lo definan en el clasificador." }, 503);
  }

  const pin = pinNuevo();
  const sal = crypto.randomUUID();
  const envio = await enviarPin(responsable.correo, pin, { correo, nombre });

  const { error } = await sb.from("solicitudes_acceso").insert({
    correo,
    nombre: nombre?.trim() || null,
    sal,
    pin_hash: await sha256(sal + pin),
    // Sólo si el correo no salió: así el responsable puede leerlo en el panel.
    pin_claro: envio.ok ? null : pin,
    autorizador: responsable.correo,
    expira_en: new Date(Date.now() + MINUTOS_VIGENCIA * 60_000).toISOString(),
  });
  if (error) return responder({ error: "No se pudo registrar la solicitud: " + error.message }, 500);

  return responder({
    ok: true,
    enviado: envio.ok,
    destino: enmascarar(responsable.correo),
    minutos: MINUTOS_VIGENCIA,
    aviso: envio.ok
      ? ""
      : "No se pudo enviar el correo, pero la solicitud quedó registrada: el responsable puede ver tu PIN en el clasificador (pestaña Sucursales y textos).",
  });
}

async function registrar(correo: string, pin: string, password: string, nombre: string) {
  if (!correoValido(correo)) return responder({ error: "Escribe un correo válido." }, 400);
  if (!/^\d{6}$/.test(pin ?? "")) return responder({ error: "El PIN son 6 números." }, 400);
  if ((password ?? "").length < MIN_LARGO_CONTRASENA) {
    return responder({ error: `La contraseña necesita al menos ${MIN_LARGO_CONTRASENA} caracteres.` }, 400);
  }

  const { data: sol } = await sb.from("solicitudes_acceso")
    .select("*").ilike("correo", correo).eq("usada", false)
    .order("creada_en", { ascending: false }).limit(1).maybeSingle();

  if (!sol) return responder({ error: "No hay ninguna solicitud pendiente para ese correo. Pide el PIN primero." }, 404);
  if (new Date(sol.expira_en) < new Date()) {
    return responder({ error: "El PIN caducó. Pide uno nuevo." }, 410);
  }
  if (sol.intentos >= MAX_INTENTOS) {
    return responder({ error: "Demasiados intentos fallidos con este PIN. Pide uno nuevo." }, 429);
  }

  const correcto = igualSeguro(await sha256(sol.sal + pin), sol.pin_hash);
  if (!correcto) {
    await sb.from("solicitudes_acceso").update({ intentos: sol.intentos + 1 }).eq("id", sol.id);
    const quedan = MAX_INTENTOS - (sol.intentos + 1);
    return responder({
      error: quedan > 0
        ? `PIN incorrecto. Te quedan ${quedan} intento(s).`
        : "PIN incorrecto. Se agotaron los intentos: pide un PIN nuevo.",
    }, 401);
  }

  /* PIN correcto. El orden importa: primero se marca la solicitud como usada,
     para que dos envíos simultáneos no creen dos cuentas con el mismo PIN. */
  const { data: marcada } = await sb.from("solicitudes_acceso")
    .update({ usada: true, pin_claro: null }).eq("id", sol.id).eq("usada", false).select("id");
  if (!marcada?.length) return responder({ error: "Ese PIN acaba de usarse. Pide uno nuevo." }, 409);

  const { error: errUsuario } = await sb.auth.admin.createUser({
    email: correo,
    password,
    email_confirm: true,          // el responsable ya lo autorizó con el PIN
    user_metadata: { nombre: nombre?.trim() || sol.nombre || null },
  });
  if (errUsuario) {
    const yaExiste = /already|registered|exists/i.test(errUsuario.message);
    if (!yaExiste) return responder({ error: "No se pudo crear la cuenta: " + errUsuario.message }, 500);
    // La cuenta ya existía sin permiso: basta con autorizarla.
  }

  const { error: errEditor } = await sb.from("editores").upsert({
    correo,
    nombre: nombre?.trim() || sol.nombre || null,
    nota: "Alta con PIN del responsable",
  }, { onConflict: "correo" });
  if (errEditor) return responder({ error: "Cuenta creada, pero no se pudo autorizar: " + errEditor.message }, 500);

  return responder({ ok: true, correo });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ error: "Método no permitido." }, 405);

  let cuerpo: Record<string, string> = {};
  try { cuerpo = await req.json(); } catch { return responder({ error: "Petición inválida." }, 400); }

  const correo = normalizar(cuerpo.correo);
  switch (cuerpo.accion) {
    case "solicitar": return await solicitar(correo, cuerpo.nombre ?? "");
    case "registrar": return await registrar(correo, cuerpo.pin ?? "", cuerpo.password ?? "", cuerpo.nombre ?? "");
    default: return responder({ error: "Acción desconocida." }, 400);
  }
});
