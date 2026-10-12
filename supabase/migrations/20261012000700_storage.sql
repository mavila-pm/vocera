-- =====================================================================
-- Vocera · 0700 · Almacenamiento privado (Supabase Storage)
--
-- Convención de rutas: <bucket>/<id_del_creador>/<...>
--   * El creador sube y lee solo dentro de su carpeta.
--   * El admin lee todo y sube documentos (contratos, comprobantes) en la
--     carpeta del creador correspondiente.
--   * Nadie sobrescribe ni borra desde la app: cada entrega es una versión.
-- Los videos NUNCA se guardan en la base relacional: solo su ruta.
-- Límites de tipo y tamaño se aplican en el servidor (configuración del bucket).
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars', 'avatars', false, 5242880,
    array['image/jpeg', 'image/png', 'image/webp']),
  ('documents', 'documents', false, 26214400,
    array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'image/jpeg', 'image/png', 'image/webp']),
  ('deliverables', 'deliverables', false, 5368709120,
    array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "vocera: leer archivos propios o admin" on storage.objects for select to authenticated
  using (
    bucket_id in ('avatars', 'documents', 'deliverables')
    and ((storage.foldername(name))[1] = auth.uid()::text or private.is_admin())
  );

create policy "vocera: subir en carpeta propia" on storage.objects for insert to authenticated
  with check (
    bucket_id in ('avatars', 'documents', 'deliverables')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "vocera: admin sube documentos" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and private.is_admin());

-- Sin políticas de UPDATE ni DELETE: nadie sobrescribe ni elimina desde la app.
