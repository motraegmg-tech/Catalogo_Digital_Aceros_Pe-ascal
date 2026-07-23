
export function normalize(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

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

    // Prioridad 3: Orden alfabético por defecto para el resto
    return nomA.localeCompare(nomB);
  });
}