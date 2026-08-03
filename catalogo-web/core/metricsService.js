/* metricsService.js — Qué piden realmente los clientes.
 *
 * Gonzalo elige a mano los primeros destacados, pero a partir de ahí la lista
 * tiene que salir de datos, no de intuición. Cada vez que alguien abre una
 * ficha, mete algo al pedido o manda el pedido por WhatsApp, se deja un renglón
 * en `eventos_catalogo`. El clasificador lo lee agregado (vista
 * `productos_populares`) y lo muestra al lado de la lista de destacados.
 *
 * Qué se guarda: el código del producto, la cantidad y la sucursal elegida.
 * Qué NO se guarda: nada del visitante. Ni nombre, ni teléfono, ni IP, ni
 * cookie, ni identificador de sesión. No hay forma de reconstruir quién pidió
 * qué, sólo cuánto se pide cada cosa.
 *
 * Reglas de convivencia con el catálogo:
 *   · Nunca bloquea. Todo va sin await y los errores se tragan en silencio: que
 *     falle la estadística no puede estropear un pedido.
 *   · El evento importante es 'pedir' (el cliente pulsó "Enviar por WhatsApp").
 *     'ver' y 'agregar' son señales más débiles y se mandan agrupadas.
 *   · Las búsquedas sólo se registran cuando el usuario deja de escribir, para
 *     no mandar un evento por cada letra.
 */
import { supabase } from './supabaseClient.js';

const COLA = [];
let temporizador = null;

/** Vacía la cola en un solo insert. Silencioso por diseño. */
function vaciar() {
  temporizador = null;
  if (!COLA.length) return;
  const lote = COLA.splice(0, COLA.length);
  try {
    supabase.from('eventos_catalogo').insert(lote).then(
      () => {},
      () => {}   // sin conexión, el dato se pierde: es estadística, no un pedido
    );
  } catch { /* idem */ }
}

function encolar(fila, urgente) {
  COLA.push(fila);
  if (urgente) { vaciar(); return; }
  if (temporizador) return;
  temporizador = setTimeout(vaciar, 4000);
}

/** El cliente abrió la ficha de un producto. */
export function registrarVista(p) {
  if (!p || !p.cod) return;
  encolar({ tipo: 'ver', cod: p.cod, cantidad: 1 });
}

/** Entraron productos al pedido (uno o varios, desde una ficha de familia). */
export function registrarAgregado(lineas, familiaId) {
  (lineas || []).forEach(({ p, qty }) => {
    if (!p || !p.cod) return;
    encolar({ tipo: 'agregar', cod: p.cod, cantidad: Math.max(1, Math.trunc(qty || 1)),
              familia_id: familiaId || null });
  });
}

/**
 * El cliente mandó el pedido por WhatsApp. Es LA señal buena: significa que
 * quiso comprarlo, no sólo que lo miró. Se manda de inmediato porque justo
 * después la pestaña se va a WhatsApp y puede perderse lo encolado.
 */
export function registrarPedido(items, sucursalId) {
  (items || []).forEach(it => {
    if (!it || !it.cod) return;
    COLA.push({ tipo: 'pedir', cod: it.cod, cantidad: Math.max(1, Math.trunc(it.qty || 1)),
                sucursal: sucursalId || null });
  });
  vaciar();
}

/**
 * Qué buscó el cliente. Lo valioso es lo que busca y NO encuentra: ahí hay una
 * venta que se está perdiendo, y el clasificador lo muestra como "lo que más
 * buscan". Sólo se registran búsquedas con sustancia (3+ caracteres).
 */
export function registrarBusqueda(termino, resultados) {
  const t = String(termino || '').trim().slice(0, 120);
  if (t.length < 3) return;
  encolar({ tipo: 'buscar', termino: t, cantidad: Math.max(0, resultados | 0) });
}

// Lo que quede en la cola al cerrar la pestaña se manda igual.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', vaciar);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') vaciar();
  });
}
