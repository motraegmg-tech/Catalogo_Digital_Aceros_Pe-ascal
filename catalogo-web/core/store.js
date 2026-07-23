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

export const LS_CART = 'ap_cart';
export const LS_OVR = 'ap_overrides';
export const LS_VIEW = 'ap_view';

export function loadLS(k, def) { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } }
export function saveLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

export let DATA = { productos: [], categorias: [], total: 0 };

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