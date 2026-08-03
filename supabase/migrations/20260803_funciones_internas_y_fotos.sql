-- ============================================================================
-- Funciones internas fuera de la API + fotos sólo para editores — 2026-08-03
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) LAS FUNCIONES INTERNAS SALEN DEL ESQUEMA EXPUESTO
--
-- Al crear `es_editor()` en `public` quedó expuesta como endpoint
-- (/rest/v1/rpc/es_editor) y además era SECURITY DEFINER. Ninguna de las dos
-- cosas hace falta:
--   · No necesita ser DEFINER: sólo consulta la fila del PROPIO usuario, y para
--     eso ya existe la política `auth_lee_editores`. Como INVOKER hace lo mismo
--     sin saltarse el RLS de nadie.
--   · No necesita estar en `public`: la llaman las políticas, no el navegador.
--     En un esquema no expuesto deja de ser un endpoint (PostgREST sólo publica
--     `public` y `graphql_public`).
--
-- `puedo_editar()` sí la llama el clasificador, así que se queda en `public`,
-- pero pasa a INVOKER y se le quita el permiso a `anon`.
-- ---------------------------------------------------------------------------
create schema if not exists privado;
comment on schema privado is
  'Funciones internas que NO deben ser endpoints de la API. PostgREST sólo expone `public`.';

revoke all on schema privado from anon, authenticated, public;
grant usage on schema privado to authenticated;

/* INVOKER: corre con los permisos de quien pregunta. Ve su propia fila de
   `editores` gracias a la política `auth_lee_editores`, y ninguna otra. */
create or replace function privado.es_editor()
returns boolean language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1 from public.editores e
     where lower(e.correo) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  );
$$;

revoke all on function privado.es_editor() from public;
grant execute on function privado.es_editor() to authenticated;

drop policy if exists auth_update_productos on public.productos;
create policy auth_update_productos on public.productos
  for update to authenticated
  using ((select privado.es_editor())) with check ((select privado.es_editor()));

drop policy if exists auth_insert_productos on public.productos;
create policy auth_insert_productos on public.productos
  for insert to authenticated with check ((select privado.es_editor()));

drop policy if exists auth_delete_productos on public.productos;
create policy auth_delete_productos on public.productos
  for delete to authenticated using ((select privado.es_editor()));

drop policy if exists auth_escribe_familias on public.familias;
create policy auth_escribe_familias on public.familias
  for all to authenticated
  using ((select privado.es_editor())) with check ((select privado.es_editor()));

drop policy if exists auth_escribe_ajustes on public.ajustes;
create policy auth_escribe_ajustes on public.ajustes
  for all to authenticated
  using ((select privado.es_editor())) with check ((select privado.es_editor()));

drop policy if exists auth_escribe_sucursales on public.sucursales;
create policy auth_escribe_sucursales on public.sucursales
  for all to authenticated
  using ((select privado.es_editor())) with check ((select privado.es_editor()));

drop policy if exists auth_delete_eventos on public.eventos_catalogo;
create policy auth_delete_eventos on public.eventos_catalogo
  for delete to authenticated using ((select privado.es_editor()));

drop policy if exists editores_ven_solicitudes on public.solicitudes_acceso;
create policy editores_ven_solicitudes on public.solicitudes_acceso
  for select to authenticated using ((select privado.es_editor()));

drop function if exists public.es_editor();

/* La única que el clasificador llama de verdad. INVOKER y sin `anon`: a quien
   no ha entrado no hay nada que responderle. */
create or replace function public.puedo_editar()
returns boolean language sql stable security invoker set search_path = ''
as $$ select privado.es_editor(); $$;

revoke all on function public.puedo_editar() from public, anon;
grant execute on function public.puedo_editar() to authenticated;

drop function if exists public.limpiar_solicitudes_viejas();
create or replace function privado.limpiar_solicitudes_viejas()
returns void language sql security definer set search_path = ''
as $$
  delete from public.solicitudes_acceso where creada_en < now() - interval '30 days';
$$;
revoke all on function privado.limpiar_solicitudes_viejas() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2) BUCKET `fotos`: subir y borrar sólo los editores
--
-- Quedaban dos cosas abiertas en Storage:
--   1. Cualquier usuario AUTENTICADO podía subir, reemplazar y BORRAR fotos.
--      Es el mismo agujero que ya se cerró en las tablas: alguien que se
--      registrara solo podía dejar el catálogo sin imágenes.
--   2. `anon` tenía SELECT sobre los objetos, lo que permite LISTAR el bucket
--      entero. Para ver una foto no hace falta: el bucket es público y las URL
--      se sirven sin pasar por RLS. Lo único que aportaba era dejar que
--      cualquiera enumerara todos los archivos.
-- ---------------------------------------------------------------------------
drop policy if exists fotos_insert_autenticado on storage.objects;
drop policy if exists fotos_insert_editores    on storage.objects;
create policy fotos_insert_editores on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos' and (select privado.es_editor()));

drop policy if exists fotos_update_autenticado on storage.objects;
drop policy if exists fotos_update_editores    on storage.objects;
create policy fotos_update_editores on storage.objects
  for update to authenticated
  using (bucket_id = 'fotos' and (select privado.es_editor()))
  with check (bucket_id = 'fotos' and (select privado.es_editor()));

drop policy if exists fotos_delete_autenticado on storage.objects;
drop policy if exists fotos_delete_editores    on storage.objects;
create policy fotos_delete_editores on storage.objects
  for delete to authenticated
  using (bucket_id = 'fotos' and (select privado.es_editor()));

/* Se conserva la política de SELECT (en vez de borrarla, que es lo que
   silenciaría del todo el aviso del linter) porque el clasificador sube las
   fotos con `upsert`, y quitarle la lectura al usuario que sube es la clase de
   cambio que rompe algo en silencio y sólo se descubre el día que alguien
   intenta cambiar una foto. El riesgo que queda es que un EDITOR pueda
   enumerar los nombres de archivo — gente que ya ve todas esas fotos en el
   catálogo. El visitante no puede: para él la foto llega por la URL pública,
   que no pasa por estas políticas. */
drop policy if exists fotos_lectura_publica  on storage.objects;
drop policy if exists fotos_lectura_editores on storage.objects;
create policy fotos_lectura_editores on storage.objects
  for select to authenticated
  using (bucket_id = 'fotos' and (select privado.es_editor()));
