import { supabase } from './supabaseClient.js';

/* Agrupa una lista de productos en categorías con sus subcategorías y conteos.
   Se usa tanto con los datos de Supabase como con el respaldo local
   (data/productos.js), para que ambos caminos produzcan la misma estructura. */
export const agruparCategorias = (productos) => {
  const catMap = {};
  productos.forEach(p => {
    if (!p.cat) return;
    if (!catMap[p.cat]) catMap[p.cat] = { nombre: p.cat, n: 0, subs: {} };
    const c = catMap[p.cat];
    c.n++;
    if (p.sub) c.subs[p.sub] = (c.subs[p.sub] || 0) + 1;
  });

  return Object.values(catMap).map(c => ({
    nombre: c.nombre,
    n: c.n,
    subs: Object.entries(c.subs).map(([nombre, n]) => ({ nombre, n }))
  }));
};

export const fetchCatalogo = async () => {
  let allData = [];
  let page = 0;
  const pageSize = 1000;
  let hasMore = true;

  try {
    while (hasMore) {
      const { data, error } = await supabase
        .from('catalogo_publico')
        .select('*')
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) throw error;

      if (data && data.length > 0) {
        allData = allData.concat(data);
        if (data.length < pageSize) {
          hasMore = false; //
        } else {
          page++;
        }
      } else {
        hasMore = false;
      }
    }
  } catch (error) {
    console.error('Fallo crítico al cargar catálogo:', error);
    return { productos: [], categorias: [], total: 0 };
  }

  const productos = allData.map(p => ({
    id: p.id,
    cod: p.codigo,
    nom: p.descripcion,
    cat: p.categoria,
    sub: p.subcategoria,
    med: p.medidas,
    foto: p.foto
  }));

  return { productos, categorias: agruparCategorias(productos), total: productos.length };
};
