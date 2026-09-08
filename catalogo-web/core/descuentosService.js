/* descuentosService.js — Los descuentos que el encargado publica.
 *
 * La lista la arma desde clasificador.html (pestaña Destacados, apartado
 * «Descuentos») y viaja completa en `ajustes.descuentos`, igual que los
 * destacados de la portada. Aquí no se decide nada: sólo se normaliza, se
 * comprueba la vigencia y se resuelve por código.
 *
 * Cada línea es:
 *   { c:'código', tipo:'%'|'$', valor:15, nota:'', desde:'AAAA-MM-DD', hasta:'AAAA-MM-DD' }
 *
 * Fase 1 sigue en pie: esto NO publica precio, existencia ni proveedor. Un
 * descuento dice cuánto se rebaja, no de cuánto se parte — el precio se sigue
 * cotizando por WhatsApp.
 *
 * Si `ajustes` no responde, la lista queda vacía y el catálogo se ve exactamente
 * como antes: ninguna estampa. Nunca debe impedir que el catálogo abra.
 */

const DESC = new Map();          // código -> descuento normalizado

/** Fecha de hoy en el mismo formato que guardan las vigencias (AAAA-MM-DD). */
const hoyISO = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  // Fecha LOCAL, no UTC: en México un `toISOString()` de la tarde ya cuenta como
  // el día siguiente y una promoción se apagaría medio día antes de tiempo.
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const esFecha = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Deja la línea con la forma que espera el catálogo, o devuelve null si no se
 * puede usar. Un descuento sin código o sin valor no es un descuento: es una
 * fila a medio llenar en el panel, y no tiene por qué llegar al cliente.
 */
export function normalizarDescuento(d) {
  if (!d || !d.c) return null;
  const tipo = d.tipo === '$' ? '$' : '%';
  const valor = Number(d.valor);
  if (!isFinite(valor) || valor <= 0) return null;
  // Un 120 % de descuento es un dedo que resbaló, no una promoción.
  if (tipo === '%' && valor > 99) return null;
  return {
    c: String(d.c),
    tipo,
    valor: tipo === '%' ? Math.round(valor) : Math.round(valor * 100) / 100,
    nota: typeof d.nota === 'string' ? d.nota.trim() : '',
    desde: esFecha(d.desde) ? d.desde : '',
    hasta: esFecha(d.hasta) ? d.hasta : '',
  };
}

/** ¿Está corriendo hoy? Sin fechas, un descuento vale hasta que lo quiten. */
export function vigente(d, hoy) {
  if (!d) return false;
  const h = hoy || hoyISO();
  if (d.desde && h < d.desde) return false;
  if (d.hasta && h > d.hasta) return false;
  return true;
}

/** Carga la lista publicada. Lo que no se pueda normalizar simplemente no entra. */
export function cargarDescuentos(lista) {
  DESC.clear();
  (Array.isArray(lista) ? lista : []).forEach(d => {
    const n = normalizarDescuento(d);
    if (n) DESC.set(n.c, n);
  });
  return DESC.size;
}

export const hayDescuentos = () => DESC.size > 0;

/** El descuento vigente de un código, o null. Es lo que consulta cada tarjeta. */
export function descuentoDe(cod) {
  const d = DESC.get(cod);
  return d && vigente(d) ? d : null;
}

/** Lo que dice la estampa roja: «-15%» o «-$250». Corto a propósito: va dentro
    de una estrella de 58 px, no en una frase. */
export function etiquetaDescuento(d) {
  if (!d) return '';
  return d.tipo === '$'
    ? '-$' + d.valor.toLocaleString('es-MX', { maximumFractionDigits: 2 })
    : '-' + d.valor + '%';
}

/** La frase completa, para el título emergente y para la ficha del producto. */
export function textoDescuento(d) {
  if (!d) return '';
  const cuanto = d.tipo === '$'
    ? '$' + d.valor.toLocaleString('es-MX', { maximumFractionDigits: 2 }) + ' de descuento'
    : d.valor + '% de descuento';
  const hasta = d.hasta ? ` · vigente hasta el ${fechaCorta(d.hasta)}` : '';
  return cuanto + hasta;
}

/** `2026-09-15` → `15 de septiembre`. Al cliente no se le enseña un ISO. */
export function fechaCorta(iso) {
  if (!esFecha(iso)) return '';
  const [a, m, d] = iso.split('-').map(Number);
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${d} de ${meses[m - 1]}${a !== new Date().getFullYear() ? ' de ' + a : ''}`;
}

/**
 * El mejor descuento dentro de una lista de productos, para la tarjeta de una
 * agrupación. Sin esto, agrupar escondería la promoción: la vista por defecto
 * del catálogo es la agrupada, así que un descuento dentro de «Solera» no lo
 * vería nadie hasta abrir la ficha.
 *
 * Devuelve `{ d, todos }`: el descuento más alto y si TODOS los productos de la
 * ficha lo llevan igual — de eso depende que la estampa diga «-15%» o «hasta -15%».
 */
export function mejorDescuento(productos) {
  // Sin descuentos publicados —el caso normal— no hay nada que recorrer, y esto
  // se llama una vez por tarjeta de agrupación en cada repintado.
  if (!DESC.size) return null;
  let mejor = null, n = 0;
  for (const p of productos) {
    const d = descuentoDe(p.cod);
    if (!d) continue;
    n++;
    if (!mejor || comparar(d, mejor) > 0) mejor = d;
  }
  if (!mejor) return null;
  const iguales = productos.every(p => {
    const d = descuentoDe(p.cod);
    return d && d.tipo === mejor.tipo && d.valor === mejor.valor;
  });
  return { d: mejor, todos: iguales && n === productos.length };
}

/* Comparar un porcentaje con una cantidad en pesos no se puede hacer bien sin
   saber el precio, y el catálogo no lo sabe (ni debe). Se ordena dentro de cada
   tipo y, entre tipos distintos, manda el porcentaje: es el que el cliente lee
   como "más descuento" sin necesitar la lista de precios. */
function comparar(a, b) {
  if (a.tipo !== b.tipo) return a.tipo === '%' ? 1 : -1;
  return a.valor - b.valor;
}
