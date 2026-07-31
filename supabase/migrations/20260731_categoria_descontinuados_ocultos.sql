-- ============================================================================
-- Categoría "Productos Descontinuados / Ocultos" — Aceros Peñascal
-- 2026-07-31
--
-- Lo que se clasifique en esta categoría NO debe llegar al catálogo del
-- cliente. El filtro va en la VISTA, no en el front: si los productos
-- viajaran en el JSON, cualquiera podría encontrarlos abriendo la respuesta.
-- ============================================================================

-- Derivada de la categoría: no hay que mantenerla a mano, basta con arrastrar
-- el producto a esa categoría en el clasificador.
alter table public.productos
  add column if not exists oculto boolean
  generated always as (categoria = 'Productos Descontinuados / Ocultos') stored;

-- Vista pública (la que lee el catálogo): deja fuera los ocultos.
create or replace view public.catalogo_publico as
  select id, codigo, descripcion, categoria, subcategoria, medidas, foto, etiquetas,
         case when mostrar_proveedor then proveedor else null::text end as proveedor,
         mostrar_proveedor,
         sub2, updated_at
    from public.productos
   where not oculto;

-- Vista interna: TODO, incluidos los ocultos, para el clasificador. Solo
-- `authenticated`, así nadie descubre los descontinuados desde la API pública.
create or replace view public.catalogo_interno as
  select id, codigo, descripcion, categoria, subcategoria, medidas, foto, etiquetas,
         proveedor, mostrar_proveedor, sub2, oculto, updated_at
    from public.productos;

revoke all on public.catalogo_interno from anon;
grant select on public.catalogo_interno to authenticated;

create index if not exists idx_productos_oculto on public.productos (oculto) where oculto;
