import { supabase } from './supabaseClient.js';

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

  const catMap = {};
  productos.forEach(p => {
    if (!p.cat) return;
    if (!catMap[p.cat]) catMap[p.cat] = { nombre: p.cat, n: 0, subs: new Set() };
    catMap[p.cat].n++;
    if (p.sub) catMap[p.cat].subs.add(p.sub);
  });

  const categorias = Object.values(catMap).map(c => ({
    nombre: c.nombre,
    n: c.n,
    subs: Array.from(c.subs).map(sub => ({
      nombre: sub,
      n: productos.filter(prod => prod.cat === c.nombre && prod.sub === sub).length
    }))
  }));

  return { productos, categorias, total: productos.length };
};