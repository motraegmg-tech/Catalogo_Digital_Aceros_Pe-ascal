-- ============================================================================
-- Sólo los editores autorizados pueden escribir — 2026-08-03
--
-- EL PROBLEMA: las políticas decían "cualquier usuario autenticado puede todo".
-- Eso bastaba cuando las cuentas las creaba Gonzalo a mano, pero el registro
-- público de Supabase está ABIERTO y la anon key es pública (va dentro del
-- JavaScript desplegado, por diseño). Es decir: cualquiera en internet podía
-- registrarse, confirmar su correo y quedar con permiso para borrar productos,
-- cambiar los WhatsApp de las sucursales o vaciar el catálogo. Nadie se habría
-- enterado.
--
-- LA SOLUCIÓN: una lista blanca. Estar autenticado ya no basta; hay que estar
-- en `editores`. Se autoriza por CORREO y no por id de usuario para poder dar
-- de alta a alguien ANTES de que su cuenta exista — así el orden de los pasos
-- da igual y no hay forma de dejar a medias a un trabajador nuevo.
--
-- Es defensa en profundidad: cerrar el registro público en el panel de Supabase
-- (Authentication -> Sign In / Providers -> Email -> "Allow new users to sign
-- up") sigue siendo lo primero que hay que hacer, pero si algún día alguien lo
-- vuelve a abrir, el catálogo no queda expuesto por ello.
-- ============================================================================

create table if not exists public.editores (
  correo     text primary key,
  nombre     text,
  nota       text,
  creado_en  timestamptz not null default now()
);

comment on table public.editores is
  'Quién puede editar el catálogo. Estar autenticado NO basta: hay que estar aquí. Para autorizar a alguien, agrega su correo (da igual si su cuenta aún no existe).';

alter table public.editores enable row level security;

-- La lista de quién puede editar no es asunto público, y un editor tampoco
-- debería poder darse de alta a sí mismo ni a un cómplice: se administra desde
-- el panel de Supabase (service_role), que no pasa por RLS.
drop policy if exists auth_lee_editores on public.editores;
create policy auth_lee_editores on public.editores
  for select to authenticated using (lower(correo) = lower(auth.jwt() ->> 'email'));

/* `security definer` para que la función pueda leer `editores` aunque quien
   pregunta no tenga permiso sobre la tabla. `stable` para que Postgres la
   evalúe una vez por consulta y no una vez por fila. */
create or replace function public.es_editor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.editores e
     where lower(e.correo) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- Que el clasificador pueda avisarle a la persona, en vez de fallar en silencio.
create or replace function public.puedo_editar()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select public.es_editor(); $$;

grant execute on function public.puedo_editar() to authenticated;

insert into public.editores (correo, nombre, nota) values
  ('motrae.gmg@gmail.com', 'Gonzalo Jacome (MOTRAE)', 'Cuenta original'),
  ('gonzdja@gmail.com',    'Gonzalo Jacome',          'Cuenta original')
on conflict (correo) do nothing;

-- ---------------------------------------------------------------------------
-- Las políticas de escritura pasan de "cualquiera autenticado" a "editor".
-- La LECTURA no se toca: el clasificador necesita leer la tabla base para
-- traer el proveedor real, y eso ya exigía sesión.
-- ---------------------------------------------------------------------------
drop policy if exists auth_update_productos on public.productos;
create policy auth_update_productos on public.productos
  for update to authenticated using (public.es_editor()) with check (public.es_editor());

drop policy if exists auth_insert_productos on public.productos;
create policy auth_insert_productos on public.productos
  for insert to authenticated with check (public.es_editor());

drop policy if exists auth_delete_productos on public.productos;
create policy auth_delete_productos on public.productos
  for delete to authenticated using (public.es_editor());

drop policy if exists auth_all_familias on public.familias;
drop policy if exists auth_lee_familias on public.familias;
drop policy if exists auth_escribe_familias on public.familias;
create policy auth_lee_familias on public.familias
  for select to authenticated using (true);
create policy auth_escribe_familias on public.familias
  for all to authenticated using (public.es_editor()) with check (public.es_editor());

drop policy if exists auth_all_ajustes on public.ajustes;
drop policy if exists auth_lee_ajustes on public.ajustes;
drop policy if exists auth_escribe_ajustes on public.ajustes;
create policy auth_lee_ajustes on public.ajustes
  for select to authenticated using (true);
create policy auth_escribe_ajustes on public.ajustes
  for all to authenticated using (public.es_editor()) with check (public.es_editor());

drop policy if exists auth_all_sucursales on public.sucursales;
drop policy if exists auth_lee_sucursales on public.sucursales;
drop policy if exists auth_escribe_sucursales on public.sucursales;
create policy auth_lee_sucursales on public.sucursales
  for select to authenticated using (true);
create policy auth_escribe_sucursales on public.sucursales
  for all to authenticated using (public.es_editor()) with check (public.es_editor());

-- Borrar el historial de uso sí queda reservado a editores; insertarlo no
-- (lo hace el catálogo público, sin sesión).
drop policy if exists auth_delete_eventos on public.eventos_catalogo;
create policy auth_delete_eventos on public.eventos_catalogo
  for delete to authenticated using (public.es_editor());
