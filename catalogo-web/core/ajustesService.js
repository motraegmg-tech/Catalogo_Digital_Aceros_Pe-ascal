/* ajustesService.js — Lo que el encargado edita desde el clasificador.
 *
 * Sucursales, textos y destacados de la portada vivían en el código
 * (core/config.js) o en un archivo del repositorio. Ahora viven en Supabase
 * (`sucursales` y `ajustes`) y se editan desde clasificador.html sin tocar nada.
 *
 * Regla de oro: esto NUNCA debe impedir que el catálogo abra. Si la base no
 * responde, se usa lo que trae CONFIG y el cliente ni se entera — sólo no verá
 * la última corrección de una dirección.
 *
 * Los criterios de agrupación también se leen aquí, porque son los que deciden
 * el rótulo de la columna en las fichas de familia ("Medida" vs "Calibre").
 */
import { supabase } from './supabaseClient.js';
import { CONFIG } from './store.js';

/* Textos por defecto: los mismos que siembra la migración. Si `ajustes` no
   responde, el catálogo se lee igual de bien. */
const TEXTOS_BASE = {
  titulo_destacados: 'Lo más pedido',
  subtitulo_destacados: 'Los productos que más nos piden en mostrador',
  nota_sin_precios: 'No se muestran precios: el equipo te cotiza al recibir el pedido.',
};

const CRITERIOS_BASE = [
  { id:'medida',  nombre:'Por medida',  columna:'Medida' },
  { id:'calibre', nombre:'Por calibre', columna:'Calibre' },
  { id:'funcion', nombre:'Por función', columna:'Tipo' },
  { id:'modelo',  nombre:'Por modelo',  columna:'Modelo' },
];

/* Diccionario de búsqueda de arranque: las traducciones que valen siempre y no
   dependen de este catálogo. Las de vocabulario del mostrador («PTR» =
   tubular cuadrado) las edita el encargado y llegan de `ajustes`. */
const SINONIMOS_BASE = [
  { de:'media pulgada', a:'1/2"' }, { de:'medio', a:'1/2' }, { de:'media', a:'1/2' },
  { de:'un cuarto', a:'1/4"' },     { de:'cuarto', a:'1/4' },
  { de:'un octavo', a:'1/8"' },     { de:'octavo', a:'1/8' },
  { de:'tres octavos', a:'3/8"' },  { de:'tres cuartos', a:'3/4"' },
];

export const AJUSTES = {
  sucursales: CONFIG.sucursales,     // arranca con las de config.js
  textos: { ...TEXTOS_BASE },
  destacados: [],                    // [{t:'p'|'f', c:'código o id'}]
  criterios: CRITERIOS_BASE,
  sinonimos: SINONIMOS_BASE,         // [{de:'ptr', a:'tubular cuadrado'}]
  enLinea: false,                    // ¿se pudo leer de la base?
};

/** El rótulo de la columna que corresponde a un criterio de agrupación. */
export function columnaDeCriterio(criterio) {
  const c = AJUSTES.criterios.find(x => x.id === criterio);
  return (c && c.columna) || 'Medida';
}

/**
 * Trae sucursales y ajustes. Nunca lanza: ante cualquier fallo deja los valores
 * de arranque y devuelve false, para que init() siga adelante.
 */
export async function cargarAjustes() {
  try {
    const [suc, aj] = await Promise.all([
      supabase.from('sucursales').select('clave,nombre,whatsapp,direccion,orden,activa').order('orden'),
      supabase.from('ajustes').select('clave,valor'),
    ]);

    if (!suc.error && Array.isArray(suc.data) && suc.data.length) {
      // Una sucursal sin WhatsApp no puede recibir pedidos: se descarta antes de
      // que el cliente arme un pedido que no llegaría a ningún lado.
      const lista = suc.data
        .filter(s => s.activa !== false && s.whatsapp && s.nombre)
        .map(s => ({
          id: s.clave || String(s.nombre || '').toLowerCase().replace(/\s+/g, '-'),
          nombre: s.nombre,
          wa: String(s.whatsapp).replace(/\D/g, ''),
          dir: s.direccion || '',
        }));
      if (lista.length) AJUSTES.sucursales = lista;
    }

    if (!aj.error && Array.isArray(aj.data)) {
      const mapa = new Map(aj.data.map(r => [r.clave, r.valor]));
      const t = mapa.get('textos_catalogo');
      if (t && typeof t === 'object') AJUSTES.textos = { ...TEXTOS_BASE, ...t };
      const d = mapa.get('destacados');
      if (Array.isArray(d)) AJUSTES.destacados = d.filter(x => x && x.c);
      const c = mapa.get('criterios_agrupacion');
      if (Array.isArray(c) && c.length) AJUSTES.criterios = c;
      // El diccionario de la base SE SUMA al de arranque, no lo reemplaza: las
      // fracciones habladas valen siempre, aunque el encargado nunca las toque.
      const s = mapa.get('sinonimos_busqueda');
      if (Array.isArray(s)) {
        const vistos = new Set();
        AJUSTES.sinonimos = [...s, ...SINONIMOS_BASE].filter(x => {
          if (!x || !x.de || !x.a) return false;
          const k = `${x.de}→${x.a}`.toLowerCase();
          if (vistos.has(k)) return false;
          vistos.add(k); return true;
        });
      }
    }

    AJUSTES.enLinea = !suc.error && !aj.error;
    return AJUSTES.enLinea;
  } catch (e) {
    console.warn('[ajustes] Se usan los valores del código:', e.message);
    return false;
  }
}
