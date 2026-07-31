-- ============================================================================
-- Sincronización en tiempo real del catálogo — Aceros Peñascal
-- 2026-07-30
--
-- Objetivo: que el clasificador y el pipeline de fotos compartan UNA sola
-- fuente de verdad (Supabase) y dejen de depender de git para los datos.
--
-- Es una migración ADITIVA: no borra columnas, ni filas, ni políticas.
--   1. Agrega sub2, updated_at y updated_by a `productos`.
--   2. Sella updated_at en cada UPDATE (permite pull incremental y auditoría).
--   3. Recrea la vista pública agregando sub2 y updated_at AL FINAL.
--      (create or replace view no permite intercalar columnas.)
--   4. Habilita Realtime en `productos`.
--   5. Índice por updated_at.
--
-- Sobre privacidad: Realtime respeta RLS. `anon` no tiene acceso a la tabla
-- base, así que NO recibe eventos y `precio_base` sigue sin exponerse. Solo
-- los clientes autenticados (el clasificador, con login) reciben los cambios.
-- ============================================================================

-- 1) Campos que hoy solo existían en los archivos locales
alter table public.productos
  add column if not exists sub2       text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by text;

-- 2) Sello automático de última escritura
create or replace function public.tocar_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_productos_updated_at on public.productos;
create trigger trg_productos_updated_at
  before update on public.productos
  for each row execute function public.tocar_updated_at();

-- 3) Vista pública: mismos campos de antes + sub2 y updated_at al final
create or replace view public.catalogo_publico as
  select id, codigo, descripcion, categoria, subcategoria, medidas, foto, etiquetas,
         case when mostrar_proveedor then proveedor else null::text end as proveedor,
         mostrar_proveedor,
         sub2, updated_at
    from public.productos;

-- 4) Realtime. replica identity full incluye el registro anterior en el payload,
--    para que el cliente sepa qué campo cambió (costo despreciable con 3,222 filas).
alter table public.productos replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'productos'
  ) then
    alter publication supabase_realtime add table public.productos;
  end if;
end
$$;

-- 5) Soporte para pull incremental ("dame lo que cambió desde X")
create index if not exists idx_productos_updated_at
  on public.productos (updated_at desc);
