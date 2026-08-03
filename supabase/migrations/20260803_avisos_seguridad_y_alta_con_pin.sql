-- ============================================================================
-- Avisos de seguridad de Supabase + alta de cuentas con PIN — 2026-08-03
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) VISTAS: `security_invoker` donde se puede
--
-- Con security_invoker la vista corre con los permisos de QUIEN CONSULTA, y el
-- RLS de las tablas de abajo se aplica de verdad en vez de saltarse. Las tres
-- vistas internas pueden: `authenticated` ya tiene política de SELECT sobre
-- `productos` y `eventos_catalogo`, así que devuelven lo mismo que antes.
-- ---------------------------------------------------------------------------
alter view public.busquedas_populares set (security_invoker = true);
alter view public.productos_populares set (security_invoker = true);
alter view public.catalogo_interno    set (security_invoker = true);

/* ⚠️ `catalogo_publico` NO se toca, y es a propósito.
   Es la vista que lee el catálogo público SIN sesión. Su razón de existir es
   precisamente prestar los permisos de su dueño: así `anon` ve descripción,
   categoría y foto sin tener acceso a la tabla `productos` — que es lo que
   mantiene fuera de su alcance `precio_base` y el proveedor de cada producto.

   Con security_invoker, `anon` chocaría contra el RLS de `productos` (donde no
   tiene ninguna política), la vista devolvería CERO filas y el catálogo se
   quedaría en blanco para todos los clientes.

   El aviso del linter es correcto como regla general y equivocado para este
   caso: la vista no expone nada que no deba — lista de columnas fija, proveedor
   enmascarado cuando `mostrar_proveedor` es falso y descontinuados filtrados. */


-- ---------------------------------------------------------------------------
-- 2) POLÍTICAS: (select auth.…) en vez de auth.…
--
-- Dentro de una política, `auth.jwt()` puede reevaluarse UNA VEZ POR FILA.
-- Envuelto en un subselect, Postgres lo calcula una sola vez por consulta
-- (initPlan). Con 3,222 productos y reclasificaciones de 200 en 200 no es
-- cosmético: es la diferencia entre una llamada y doscientas.
-- ---------------------------------------------------------------------------
drop policy if exists auth_lee_editores on public.editores;
create policy auth_lee_editores on public.editores
  for select to authenticated
  using (lower(correo) = lower((select auth.jwt() ->> 'email')));

-- La comparación es por lower(correo): el índice de la llave primaria no sirve.
create index if not exists idx_editores_correo_lower on public.editores (lower(correo));

create or replace function public.es_editor()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.editores e
     where lower(e.correo) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  );
$$;

drop policy if exists auth_update_productos on public.productos;
create policy auth_update_productos on public.productos
  for update to authenticated
  using ((select public.es_editor())) with check ((select public.es_editor()));

drop policy if exists auth_insert_productos on public.productos;
create policy auth_insert_productos on public.productos
  for insert to authenticated with check ((select public.es_editor()));

drop policy if exists auth_delete_productos on public.productos;
create policy auth_delete_productos on public.productos
  for delete to authenticated using ((select public.es_editor()));

drop policy if exists auth_escribe_familias on public.familias;
create policy auth_escribe_familias on public.familias
  for all to authenticated
  using ((select public.es_editor())) with check ((select public.es_editor()));

drop policy if exists auth_escribe_ajustes on public.ajustes;
create policy auth_escribe_ajustes on public.ajustes
  for all to authenticated
  using ((select public.es_editor())) with check ((select public.es_editor()));

drop policy if exists auth_escribe_sucursales on public.sucursales;
create policy auth_escribe_sucursales on public.sucursales
  for all to authenticated
  using ((select public.es_editor())) with check ((select public.es_editor()));

drop policy if exists auth_delete_eventos on public.eventos_catalogo;
create policy auth_delete_eventos on public.eventos_catalogo
  for delete to authenticated using ((select public.es_editor()));


-- ---------------------------------------------------------------------------
-- 3) ALTA DE CUENTAS CON PIN DEL RESPONSABLE
--
-- Dar de alta a un trabajador exigía entrar al panel de Supabase. Ahora se hace
-- desde el propio clasificador, pero con una llave humana: el trabajador pide
-- acceso, el PIN le llega POR CORREO AL RESPONSABLE (el dueño de Aceros
-- Peñascal), y sólo si el dueño se lo pasa puede terminar el alta. Así, aunque
-- alguien de fuera encuentre la página, no puede crearse cuenta: le faltaría un
-- número que sólo existe en el correo del dueño.
--
-- Nada de esto lo hace el navegador: la verificación del PIN y la creación del
-- usuario ocurren en la Edge Function `acceso` (supabase/functions/acceso/),
-- con la llave de servicio. El cliente nunca ve el PIN ni puede saltarse el paso.
-- ---------------------------------------------------------------------------
create table if not exists public.solicitudes_acceso (
  id          uuid primary key default gen_random_uuid(),
  correo      text not null,                 -- quién pide entrar
  nombre      text,
  sal         text not null,                 -- sal aleatoria por solicitud
  pin_hash    text not null,                 -- sha256(sal + pin). El PIN nunca se guarda.
  -- Sólo se llena si el envío del correo falló: así el responsable puede leerlo
  -- en el clasificador y dictarlo por teléfono, en vez de quedarse atascado.
  pin_claro   text,
  autorizador text,                          -- a qué correo se mandó
  intentos    int  not null default 0,
  usada       boolean not null default false,
  expira_en   timestamptz not null,
  creada_en   timestamptz not null default now()
);

comment on table public.solicitudes_acceso is
  'Peticiones de alta de cuenta. El PIN viaja al correo del responsable, no al del solicitante. Sólo la Edge Function `acceso` escribe aquí.';

create index if not exists idx_solicitudes_correo on public.solicitudes_acceso (lower(correo), creada_en desc);
create index if not exists idx_solicitudes_creada on public.solicitudes_acceso (creada_en desc);

alter table public.solicitudes_acceso enable row level security;

-- Nadie escribe desde el navegador: sólo la Edge Function (service_role, que no
-- pasa por RLS). Los editores pueden MIRAR las solicitudes pendientes.
drop policy if exists editores_ven_solicitudes on public.solicitudes_acceso;
create policy editores_ven_solicitudes on public.solicitudes_acceso
  for select to authenticated using ((select public.es_editor()));

-- A quién le llega el PIN. publico = false para que la dirección del dueño no
-- viaje en el JSON que cualquiera puede descargar del catálogo.
insert into public.ajustes (clave, valor, publico) values
  ('correo_autorizador', '{"correo":"motrae.gmg@gmail.com","nombre":"Responsable del catálogo"}'::jsonb, false)
on conflict (clave) do nothing;

create or replace function public.limpiar_solicitudes_viejas()
returns void language sql security definer set search_path = ''
as $$
  delete from public.solicitudes_acceso where creada_en < now() - interval '30 days';
$$;
