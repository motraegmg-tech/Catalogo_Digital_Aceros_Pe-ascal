-- ============================================================================
-- Catálogo editable sin tocar código — Aceros Peñascal
-- 2026-08-02
--
-- Hasta hoy, tres cosas del catálogo sólo se podían cambiar editando archivos
-- del repositorio: dar de alta un producto, decidir qué productos se agrupan en
-- una ficha de familia (un pipeline de Node + JSON) y los datos de las cinco
-- sucursales (core/config.js). El encargado de Aceros Peñascal no programa, así
-- que todo eso tiene que vivir en la base y editarse desde el clasificador.
--
-- Migración ADITIVA: no borra columnas, filas ni políticas existentes.
--   1. `productos`: alta y baja desde el clasificador (INSERT / DELETE con sesión).
--   2. `familias`: qué productos van juntos en una ficha y CÓMO se agrupan
--      (por medida, calibre, función…). Sustituye a datos/familias_aprobadas.json.
--   3. `ajustes`: pares clave/valor del catálogo (destacados, criterios, textos).
--   4. `sucursales`: dirección y orden, con las 5 sembradas desde config.js.
--   5. `eventos_catalogo`: qué piden realmente los clientes → productos populares.
--
-- Privacidad (Fase 1): nada de esto publica precio, existencia ni proveedor.
-- `eventos_catalogo` guarda SOLO códigos de producto y sucursal — ningún dato
-- personal, ninguna IP, ningún identificador de visitante.
-- ============================================================================


-- ============================================================================
-- 1) PRODUCTOS: alta y baja desde el clasificador
-- ============================================================================
-- Hasta ahora `authenticated` sólo podía SELECT y UPDATE: se podía reclasificar
-- un producto, pero no crear uno nuevo ni retirar uno capturado por error.
-- Ojo: la baja normal de un producto real NO es un DELETE, es moverlo a la
-- categoría "Productos Descontinuados / Ocultos" (que la vista pública filtra).
-- El DELETE existe para deshacer altas equivocadas.

drop policy if exists auth_insert_productos on public.productos;
create policy auth_insert_productos on public.productos
  for insert to authenticated with check (true);

drop policy if exists auth_delete_productos on public.productos;
create policy auth_delete_productos on public.productos
  for delete to authenticated using (true);

-- Fecha de alta: para distinguir en el clasificador lo que capturó el encargado.
alter table public.productos
  add column if not exists creado_en timestamptz not null default now();

-- NOTA: los destacados de la portada NO son una columna. Son UNA lista ordenada
-- que mezcla productos y agrupaciones, así que viven completos en
-- ajustes.destacados (ver más abajo): un entero por fila en dos tablas distintas
-- no sabría expresar ese orden común.


-- ============================================================================
-- 2) FAMILIAS: agrupación de presentación, editable desde el clasificador
-- ============================================================================
-- Una familia junta en UNA tarjeta los productos que sólo se diferencian por
-- algo (la medida de las soleras, el modelo de los discos). Cada producto sigue
-- siendo su propio código: la agrupación es de PRESENTACIÓN.
--
-- `criterio` es lo que cambia cómo se ve la ficha en el catálogo: si agrupas por
-- calibre, la columna de la tabla dice "Calibre" y no "Medida". Los criterios
-- disponibles se editan en `ajustes` (clave 'criterios_agrupacion'), así que se
-- pueden inventar nuevos sin tocar código.
create table if not exists public.familias (
  id          text primary key,
  nombre      text not null,
  cat         text not null,
  sub         text,
  criterio    text not null default 'medida',
  -- Rótulo de la columna en la ficha. NULL = el que traiga el criterio.
  columna     text,
  descripcion text,
  -- [{ "nombre": "Corte", "cods": ["D162", …] }, …]
  subgrupos   jsonb not null default '[]'::jsonb,
  activa      boolean not null default true,
  origen      text,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

comment on table public.familias is
  'Fichas de familia del catálogo: qué códigos van juntos en una tarjeta y bajo qué criterio. Editable desde clasificador.html.';

alter table public.familias enable row level security;

-- El catálogo público lee las familias activas sin sesión (no hay nada
-- sensible: son códigos que ya viajan en catalogo_publico).
drop policy if exists anon_select_familias on public.familias;
create policy anon_select_familias on public.familias
  for select to anon using (activa);

drop policy if exists auth_all_familias on public.familias;
create policy auth_all_familias on public.familias
  for all to authenticated using (true) with check (true);

drop trigger if exists trg_familias_updated_at on public.familias;
create trigger trg_familias_updated_at
  before update on public.familias
  for each row execute function public.tocar_updated_at();

create index if not exists idx_familias_cat on public.familias (cat);


-- ============================================================================
-- 3) AJUSTES: lo que antes eran constantes en el código
-- ============================================================================
-- Pares clave/valor con el JSON completo de cada ajuste. Hoy guarda los
-- criterios de agrupación y los textos del catálogo; mañana, lo que haga falta,
-- sin migración de por medio.
create table if not exists public.ajustes (
  clave      text primary key,
  valor      jsonb not null,
  publico    boolean not null default true,   -- ¿lo puede leer el catálogo sin sesión?
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.ajustes enable row level security;

drop policy if exists anon_select_ajustes on public.ajustes;
create policy anon_select_ajustes on public.ajustes
  for select to anon using (publico);

drop policy if exists auth_all_ajustes on public.ajustes;
create policy auth_all_ajustes on public.ajustes
  for all to authenticated using (true) with check (true);

drop trigger if exists trg_ajustes_updated_at on public.ajustes;
create trigger trg_ajustes_updated_at
  before update on public.ajustes
  for each row execute function public.tocar_updated_at();

-- Criterios de agrupación de arranque. `columna` es el rótulo que la ficha del
-- catálogo pone sobre la columna que el cliente elige.
insert into public.ajustes (clave, valor) values
  ('criterios_agrupacion', '[
     {"id":"medida",  "nombre":"Por medida",      "columna":"Medida",  "ayuda":"El mismo producto en varios tamaños: soleras, ángulos, tubería."},
     {"id":"calibre", "nombre":"Por calibre",     "columna":"Calibre", "ayuda":"Mismo producto en varios espesores: lámina, alambre."},
     {"id":"funcion", "nombre":"Por función",     "columna":"Tipo",    "ayuda":"Mismo tipo de producto para usos distintos: discos de corte, desbaste, diamante."},
     {"id":"modelo",  "nombre":"Por modelo",      "columna":"Modelo",  "ayuda":"Una línea de producto con varios modelos: herramienta eléctrica."},
     {"id":"marca",   "nombre":"Por marca",       "columna":"Marca",   "ayuda":"El mismo producto de varias marcas."},
     {"id":"material","nombre":"Por material",    "columna":"Material","ayuda":"El mismo producto en distintos materiales o acabados."},
     {"id":"color",   "nombre":"Por color",       "columna":"Color",   "ayuda":"El mismo producto en varios colores: pintura, lámina pintro."},
     {"id":"presentacion","nombre":"Por presentación","columna":"Presentación","ayuda":"El mismo producto en distintos empaques o cantidades."}
   ]'::jsonb)
on conflict (clave) do nothing;

insert into public.ajustes (clave, valor) values
  ('textos_catalogo', '{
     "titulo_destacados": "Lo más pedido",
     "subtitulo_destacados": "Los productos que más nos piden en mostrador",
     "nota_sin_precios": "No se muestran precios: el equipo te cotiza al recibir el pedido."
   }'::jsonb)
on conflict (clave) do nothing;

-- Destacados de la portada: lista ORDENADA que mezcla productos y agrupaciones.
--   [{"t":"p","c":"COMP23LTBYP"}, {"t":"f","c":"abrasivos--discos"}, …]
-- t = p (producto, c = código) | f (familia, c = id de la agrupación).
insert into public.ajustes (clave, valor) values ('destacados', '[]'::jsonb)
on conflict (clave) do nothing;


-- ============================================================================
-- 4) SUCURSALES: dirección y orden, editables desde el clasificador
-- ============================================================================
-- La tabla ya existía (id, nombre, whatsapp) pero estaba vacía: las 5 sucursales
-- vivían en core/config.js. Se completa el esquema y se siembran.
alter table public.sucursales
  add column if not exists clave      text,
  add column if not exists direccion  text,
  add column if not exists orden      int  not null default 0,
  add column if not exists activa     boolean not null default true,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sucursales_clave_key') then
    alter table public.sucursales add constraint sucursales_clave_key unique (clave);
  end if;
end
$$;

alter table public.sucursales enable row level security;

drop policy if exists anon_select_sucursales on public.sucursales;
create policy anon_select_sucursales on public.sucursales
  for select to anon using (activa);

drop policy if exists auth_all_sucursales on public.sucursales;
create policy auth_all_sucursales on public.sucursales
  for all to authenticated using (true) with check (true);

drop trigger if exists trg_sucursales_updated_at on public.sucursales;
create trigger trg_sucursales_updated_at
  before update on public.sucursales
  for each row execute function public.tocar_updated_at();

-- Las 5 de core/config.js. `clave` es el id que ya usa el catálogo.
insert into public.sucursales (clave, nombre, whatsapp, direccion, orden) values
  ('matriz',   'Matriz',          '522283170708', 'Av. Antonio Chedraui Caram 190, Diez de Mayo, 91180, Xalapa, Ver.', 1),
  ('bodega',   'Sucursal Bodega', '522288604502', 'Camino al Sumidero 12, Casa Blanca, 91180, Xalapa, Ver.', 2),
  ('trancas',  'Las Trancas',     '522288357198', 'Carr. Las Trancas–Coatepec km 1.300, Santa Lucía, Emiliano Zapata, Ver.', 3),
  ('coatepec', 'Coatepec',        '522288398812', 'Hernández y Hernández 149, Centro, 91500, Coatepec, Ver.', 4),
  ('naolinco', 'Naolinco',        '522281947245', '5 de Febrero 55, Centro, 91400, Naolinco, Ver.', 5)
on conflict (clave) do nothing;


-- ============================================================================
-- 5) EVENTOS: qué piden realmente los clientes
-- ============================================================================
-- Gonzalo elige a mano los primeros destacados, pero a partir de ahí la lista
-- debe salir de lo que la gente pide de verdad. Cada vez que un producto entra
-- al pedido o el pedido se envía por WhatsApp, el catálogo deja aquí un renglón.
--
-- Sólo códigos y sucursal: ni IP, ni cookie, ni identificador de visitante.
create table if not exists public.eventos_catalogo (
  id         bigserial primary key,
  tipo       text not null check (tipo in ('ver','agregar','pedir','buscar')),
  cod        text,
  familia_id text,
  cantidad   int  not null default 1 check (cantidad between 0 and 100000),
  sucursal   text,
  termino    text check (termino is null or length(termino) <= 120),
  creado_en  timestamptz not null default now()
);

comment on table public.eventos_catalogo is
  'Uso real del catálogo público (ver / agregar / pedir / buscar). Sin datos personales: sólo códigos. Alimenta la vista productos_populares.';

alter table public.eventos_catalogo enable row level security;

-- El visitante escribe pero NO lee: nadie puede descargar el historial de
-- pedidos de la competencia con la anon key.
drop policy if exists anon_insert_eventos on public.eventos_catalogo;
create policy anon_insert_eventos on public.eventos_catalogo
  for insert to anon with check (true);

drop policy if exists auth_insert_eventos on public.eventos_catalogo;
create policy auth_insert_eventos on public.eventos_catalogo
  for insert to authenticated with check (true);

drop policy if exists auth_select_eventos on public.eventos_catalogo;
create policy auth_select_eventos on public.eventos_catalogo
  for select to authenticated using (true);

drop policy if exists auth_delete_eventos on public.eventos_catalogo;
create policy auth_delete_eventos on public.eventos_catalogo
  for delete to authenticated using (true);

create index if not exists idx_eventos_creado on public.eventos_catalogo (creado_en desc);
create index if not exists idx_eventos_cod    on public.eventos_catalogo (cod, tipo);

-- Ranking listo para el clasificador: qué se pide más, en 30 / 90 / 365 días.
create or replace view public.productos_populares as
  select
    e.cod,
    p.descripcion,
    p.categoria,
    p.subcategoria,
    count(*) filter (where e.tipo = 'pedir')                            as pedidos,
    coalesce(sum(e.cantidad) filter (where e.tipo = 'pedir'), 0)        as piezas,
    count(*) filter (where e.tipo = 'agregar')                          as agregados,
    count(*) filter (where e.tipo = 'ver')                              as vistas,
    count(*) filter (where e.tipo = 'pedir'
                       and e.creado_en > now() - interval '30 days')    as pedidos_30d,
    count(*) filter (where e.tipo = 'pedir'
                       and e.creado_en > now() - interval '90 days')    as pedidos_90d,
    max(e.creado_en)                                                    as ultimo
  from public.eventos_catalogo e
  left join public.productos p on p.codigo = e.cod
  where e.cod is not null
  group by e.cod, p.descripcion, p.categoria, p.subcategoria;

revoke all on public.productos_populares from anon;
grant select on public.productos_populares to authenticated;

-- Qué busca la gente y no encuentra: el mejor mapa de huecos del catálogo.
create or replace view public.busquedas_populares as
  select termino, count(*) as veces, max(creado_en) as ultimo
    from public.eventos_catalogo
   where tipo = 'buscar' and termino is not null and termino <> ''
   group by termino;

revoke all on public.busquedas_populares from anon;
grant select on public.busquedas_populares to authenticated;
