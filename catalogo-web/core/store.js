export const CONFIG = {
  sucursales: [
    { id:'matriz',   nombre:'Matriz',          wa:'522283170708', dir:'Av. Antonio Chedraui Caram 190, Diez de Mayo, 91180, Xalapa, Ver.' },
    { id:'bodega',   nombre:'Sucursal Bodega', wa:'522288604502', dir:'Camino al Sumidero 12, Casa Blanca, 91180, Xalapa, Ver.' },
    { id:'trancas',  nombre:'Las Trancas',     wa:'522288357198', dir:'Carr. Las Trancas–Coatepec km 1.300, Santa Lucía, Emiliano Zapata, Ver.' },
    { id:'coatepec', nombre:'Coatepec',        wa:'522288398812', dir:'Hernández y Hernández 149, Centro, 91500, Coatepec, Ver.' },
    { id:'naolinco', nombre:'Naolinco',        wa:'522281947245', dir:'5 de Febrero 55, Centro, 91400, Naolinco, Ver.' },
  ],
  fotoExts: ['webp','jpg','jpeg','png'],
  pageSize: 48,
};

/* Categoría de retiro: lo que se clasifique aquí NO se muestra al cliente.
   El filtro de verdad está en la vista `catalogo_publico` de Supabase, así que
   estos productos ni siquiera se descargan. Este nombre se usa para filtrar
   también el respaldo local, que es el otro camino por el que podrían colarse. */
export const CAT_OCULTA = 'Productos Descontinuados / Ocultos';

/* Marca de gestión «Productos obsoletos»: lo que la tienda dejó de vender. Es la
   forma nueva de retirar un producto —conserva su categoría real, así que se
   puede devolver quitándole la marca— y la vista `catalogo_publico` ya la
   filtra. Aquí sólo se repite el identificador para tapar el respaldo local. */
export const ETQ_OBSOLETO = 'obsoleto';

export const LS_CART = 'ap_cart';
export const LS_OVR = 'ap_overrides';
export const LS_VIEW = 'ap_view';

export function loadLS(k, def) { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } }
export function saveLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

export let DATA = { productos: [], categorias: [], total: 0 };

/**
 * Set de stems (nombres de archivo sin extensión) de fotos que existen en disco.
 * Se exporta como `const` para que todos los módulos compartan la MISMA referencia
 * del objeto. Cuando cargarFotosManifest() lo llena, todos los importadores lo ven
 * instantáneamente sin depender de la reasignación de DATA.
 */
export const fotosSet = new Set();

export function cargarFotosManifest(stems) {
  fotosSet.clear();
  stems.forEach(s => fotosSet.add(s));
}

export const state = {
  q: '', cat: null, sub: null, page: 1,
  cart: loadLS(LS_CART, {}),
  overrides: loadLS(LS_OVR, {}),
  sucursal: CONFIG.sucursales[0].id,
  view: loadLS(LS_VIEW, 'grid'),
  edit: false,
};

export function setCatalogData(datos) {
  DATA = datos;
  DATA.productos.forEach(p => {
    const o = state.overrides[p.id];
    if (o) Object.assign(p, o);
  });
}