
export function normalize(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * \u00danico criterio de orden alfab\u00e9tico del cat\u00e1logo (A\u2192Z). Lo usan la grilla, las
 * fichas de familia y sus tablas de medidas, para que todo se lea igual.
 * `numeric` evita que \u00abSOLERA 10\u00bb caiga antes de \u00abSOLERA 2\u00bb; `sensitivity:'base'`
 * ignora acentos y may\u00fasculas, que en el cat\u00e1logo se escriben de las dos formas.
 */
export const alfa = (a, b) =>
  (a || '').localeCompare(b || '', 'es', { numeric: true, sensitivity: 'base' });

export function buildHaystack(p) {
  if (p._hay == null) {
    p._hay = `${normalize(p.nom)} ${normalize(p.cod)} ${normalize(p.sub)} ${normalize(p.med)} ${normalize(p.cat)}`;
  }
  return p._hay;
}

export function searchAndSortProducts(query, products) {
  const q = normalize(query).trim();
  if (!q) return products;

  const terms = q.split(/\s+/);

  const filtered = products.filter(p => {
    const hay = buildHaystack(p);
    return terms.every(t => hay.includes(t));
  });

  return filtered.sort((a, b) => {
    const nomA = normalize(a.nom);
    const nomB = normalize(b.nom);

    // Prioridad 1: Coincidencia exacta del nombre ("solera" vs "solera")
    const exactA = nomA === q ? 1 : 0;
    const exactB = nomB === q ? 1 : 0;
    if (exactA !== exactB) return exactB - exactA;

    // Prioridad 2: El nombre empieza con el término ("solera de 2 pulgadas" vs "aro de solera")
    const startsA = nomA.startsWith(q) ? 1 : 0;
    const startsB = nomB.startsWith(q) ? 1 : 0;
    if (startsA !== startsB) return startsB - startsA;

    // Prioridad 3: Orden alfabético ascendente (A→Z) para el resto, con el mismo
    // criterio que la navegación: «SOLERA 2» antes que «SOLERA 10».
    return nomA.localeCompare(nomB, 'es', { numeric: true, sensitivity: 'base' });
  });
}