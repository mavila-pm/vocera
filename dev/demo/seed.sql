-- =====================================================================
-- DATOS DE DEMOSTRACIÓN (ficticios). Solo para la demo en el navegador.
-- Nunca se aplica en Supabase. Todos los nombres llevan "(demo)".
-- Los estados se alcanzan llamando a las MISMAS funciones del portal,
-- con el usuario correspondiente, así que respetan todas las reglas.
-- =====================================================================
create schema if not exists demo;
create table demo.files (bucket text, name text, mime text, data bytea, primary key (bucket, name));
create table demo.ctx (k text primary key, v text);
create or replace function demo.uid(p text) returns uuid language sql security definer as $$ select id from auth.users where email = p $$;
create or replace function demo.login(p text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', demo.uid(p), 'role', 'authenticated')::text, false); end $$;
create or replace function demo.put(k text, v text) returns void language sql as $$ insert into demo.ctx values (k, v) on conflict (k) do update set v = excluded.v $$;
create or replace function demo.get(k text) returns text language sql as $$ select v from demo.ctx where ctx.k = get.k $$;
grant usage on schema demo to authenticated;
grant all on demo.ctx to authenticated;
grant execute on all functions in schema demo to authenticated;

-- Archivos de ejemplo (contenido mínimo válido)
create or replace function demo.file(p_bucket text, p_name text, p_mime text, p_owner text) returns text language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name, owner, metadata)
  values (p_bucket, p_name, demo.uid(p_owner), jsonb_build_object('mimetype', p_mime, 'size', 64));
  insert into demo.files values (p_bucket, p_name, p_mime,
    case when p_mime = 'application/pdf' then convert_to('%PDF-1.4' || chr(10) || '% Documento de demostración' || chr(10) || '%%EOF', 'UTF8')
         else decode('000000186674797069736f6d0000020069736f6d69736f32', 'hex') end);
  return p_name;
end $$;

-- ---------- Cuentas ----------
insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data) values
  ('equipo@vocera.demo', extensions.crypt('Demo2026', extensions.gen_salt('bf', 6)), now(), '{"full_name":"Equipo Vocera (demo)","terms_accepted":"true"}'),
  ('lucia@vocera.demo',  extensions.crypt('Demo2026', extensions.gen_salt('bf', 6)), now(), '{"full_name":"Lucía Ramos (demo)","phone":"+51900000101","terms_accepted":"true"}'),
  ('diego@vocera.demo',  extensions.crypt('Demo2026', extensions.gen_salt('bf', 6)), now(), '{"full_name":"Diego Salas (demo)","phone":"+51900000102","terms_accepted":"true"}');
update public.profiles set role = 'admin' where email = 'equipo@vocera.demo';
update public.profiles set welcome_seen_at = now();

insert into public.creator_profiles (user_id, artistic_name, country, city, bio, main_category, secondary_categories, availability,
  portfolio_links, default_currency, collaboration_modes, avatar_path) values
  (demo.uid('lucia@vocera.demo'), 'Lu cocina rápido (demo)', 'PE', 'Lima', 'Recetas de 30 segundos para gente que cocina después del trabajo. Perfil de ejemplo para la demo.',
   'Gastronomía', '{Estilo de vida,Familia y crianza}', 'available', '{https://example.com/portafolio-demo}', 'PEN', '{Video UGC (sin publicar),Publicación en mis redes}', 'demo-avatar'),
  (demo.uid('diego@vocera.demo'), 'Diego en ruta (demo)', 'PE', 'Arequipa', 'Reseñas de autos y mantenimiento casero explicado sin tecnicismos. Perfil de ejemplo para la demo.',
   'Automotriz', '{Tecnología}', 'limited', '{https://example.com/portafolio-demo-2}', 'PEN', '{Publicación en mis redes,Historias}', 'demo-avatar');
insert into public.creator_social_accounts (user_id, platform, handle, url, followers_declared, avg_views_declared, engagement_declared, audience_notes) values
  (demo.uid('lucia@vocera.demo'), 'tiktok', '@lu.demo', 'https://example.com/lu-demo', 18200, 9400, 6.1, 'Mujeres de 22 a 35 años, Lima Metropolitana (ejemplo).'),
  (demo.uid('lucia@vocera.demo'), 'instagram', '@lu.demo', 'https://example.com/lu-demo-ig', 7300, 2100, 4.3, null),
  (demo.uid('diego@vocera.demo'), 'youtube', '@diego.demo', 'https://example.com/diego-demo', 25400, 11800, 3.9, 'Conductores de 25 a 45 años (ejemplo).');
insert into public.creator_rates (user_id, rate_type, amount, currency) values
  (demo.uid('lucia@vocera.demo'), 'video', 750, 'PEN'), (demo.uid('lucia@vocera.demo'), 'story', 180, 'PEN'),
  (demo.uid('diego@vocera.demo'), 'video', 900, 'PEN');
-- Sin foto: el portal muestra iniciales y el perfil queda al 92 % (falta la foto),
-- así la demo enseña también el indicador de completitud.
update public.creator_profiles set avatar_path = null;
update public.profiles set status = 'approved', submitted_at = now() - interval '20 days', reviewed_at = now() - interval '19 days'
 where email = 'lucia@vocera.demo';
update public.profiles set status = 'in_review', submitted_at = now() - interval '1 day' where email = 'diego@vocera.demo';
select demo.login('diego@vocera.demo');
select private.notify_admins('profile_to_review', 'Nuevo perfil para revisar', 'Diego Salas (demo)',
  '/admin/creadores/' || demo.uid('diego@vocera.demo'), 'profile_to_review:demo');

select demo.login('equipo@vocera.demo'); set role authenticated;
insert into public.brands (name) values ('Marca Demo');

-- ---------- Campaña 1: invitación pendiente de respuesta ----------
insert into public.campaigns (brand_id, brand_visible_to_creators, name, objective, platforms, starts_on, ends_on, default_fee, currency,
  payment_terms, usage_rights, max_revision_rounds, requires_product, requires_ad_code, script_due_on, video_due_on, publish_on)
select id, true, 'Receta en 30 segundos (demo)', 'Mostrar una receta real usando el producto de la marca demo.', '{tiktok,instagram}',
  current_date, current_date + 40, 650, 'PEN', '15 días después de la validación final.', 'Uso orgánico en redes de la marca por 6 meses.', 2, false, false,
  current_date + 7, current_date + 14, current_date + 20 from public.brands where name = 'Marca Demo';
select demo.put('c1', (select id::text from public.campaigns where name = 'Receta en 30 segundos (demo)'));
insert into public.campaign_briefs (campaign_id, brief, formats, content_duration, mandatory_messages, forbidden_claims, deliverables_summary)
values (demo.get('c1')::uuid, 'Graba una receta de principio a fin en tu cocina. El producto aparece en uso, no como anuncio.',
  'Video vertical 9:16', '30 a 45 segundos', 'Nombrar el producto en los primeros 3 segundos.', 'No prometer beneficios para la salud.', '1 video + 1 historia');
select public.admin_set_campaign_status(demo.get('c1')::uuid, 'active');
select demo.put('a1', public.admin_assign_creator(demo.get('c1')::uuid, demo.uid('lucia@vocera.demo'))::text);
select public.admin_record_client_approval(demo.get('a1')::uuid, true, 'Aprobado por correo de la marca demo');
select public.admin_send_invitation(demo.get('a1')::uuid);

-- ---------- Campaña 2: en producción, con una corrección pedida ----------
insert into public.campaigns (brand_id, brand_visible_to_creators, name, objective, platforms, starts_on, default_fee, currency,
  payment_terms, max_revision_rounds, requires_product, requires_ad_code, video_due_on)
select id, false, 'Lanzamiento salsa picante (demo)', 'Presentar el producto nuevo con una receta.', '{tiktok}', current_date - 10, 800, 'PEN',
  '15 días después de la validación final.', 2, true, false, current_date + 4 from public.brands where name = 'Marca Demo';
select demo.put('c2', (select id::text from public.campaigns where name = 'Lanzamiento salsa picante (demo)'));
insert into public.campaign_briefs (campaign_id, brief, mandatory_messages, forbidden_claims)
values (demo.get('c2')::uuid, 'Receta rápida con la salsa como protagonista.', 'Mostrar el empaque al inicio.', 'No decir que es "la más picante del Perú".');
select public.admin_set_campaign_status(demo.get('c2')::uuid, 'active');
select demo.put('a2', public.admin_assign_creator(demo.get('c2')::uuid, demo.uid('lucia@vocera.demo'))::text);
select public.admin_record_client_approval(demo.get('a2')::uuid, true, null);
select public.admin_send_invitation(demo.get('a2')::uuid);
reset role; select demo.login('lucia@vocera.demo'); set role authenticated;
select public.respond_invitation(demo.get('a2')::uuid, true);
reset role;
select demo.file('documents', demo.uid('lucia@vocera.demo') || '/contratos/contrato-salsa-demo.pdf', 'application/pdf', 'equipo@vocera.demo');
select demo.file('documents', demo.uid('lucia@vocera.demo') || '/contratos/contrato-salsa-demo-firmado.pdf', 'application/pdf', 'equipo@vocera.demo');
select demo.login('equipo@vocera.demo'); set role authenticated;
select demo.put('k2', public.admin_create_contract(demo.get('a2')::uuid, 'Contrato de colaboración (demo)', 'Honorario S/ 800. Dos rondas de corrección. Ejemplo para la demo.',
  demo.uid('lucia@vocera.demo') || '/contratos/contrato-salsa-demo.pdf', current_date - 8, current_date + 60, current_date - 6)::text);
select public.admin_record_contract_signature(demo.get('k2')::uuid, 'signed_document_upload',
  demo.uid('lucia@vocera.demo') || '/contratos/contrato-salsa-demo-firmado.pdf', null, current_date - 7);
select demo.put('s2', public.admin_create_shipment(demo.get('a2')::uuid, 'Kit salsa picante (demo)', 'Caja con 3 frascos', 3, 45, 'PEN', 'Marca Demo',
  'Courier demo', 'DEMO-0001', current_date - 5, 'El producto queda con el creador después de publicar.')::text);
reset role; select demo.login('lucia@vocera.demo'); set role authenticated;
select public.confirm_product_receipt(demo.get('s2')::uuid, current_date - 5);
select demo.put('g2', public.save_script_draft(demo.get('a2')::uuid, 'Escena 1: muestro el frasco y digo su nombre. Escena 2: preparo tacos en 30 segundos. Escena 3: pruebo y doy mi opinión.')::text);
select public.submit_script(demo.get('g2')::uuid);
reset role; select demo.login('equipo@vocera.demo'); set role authenticated;
select public.admin_review_script(demo.get('g2')::uuid, 'approved', 'Bien planteado.');
select demo.put('d2', public.admin_create_deliverable(demo.get('a2')::uuid, 'video', 'Video vertical 30 s', '9:16, 1080p, con subtítulos')::text);
reset role;
select demo.file('deliverables', demo.uid('lucia@vocera.demo') || '/entregas/salsa-v1.mp4', 'video/mp4', 'lucia@vocera.demo');
select demo.login('lucia@vocera.demo'); set role authenticated;
select public.submit_deliverable_version(demo.get('d2')::uuid, demo.uid('lucia@vocera.demo') || '/entregas/salsa-v1.mp4', 'salsa-v1.mp4', 'video/mp4', 4200000);
reset role; select demo.login('equipo@vocera.demo'); set role authenticated;
select public.admin_review_deliverable(demo.get('d2')::uuid, false, 'El empaque no se ve al inicio', 'Muestra el frasco en los primeros 2 segundos.', true);

-- ---------- Campaña 3: completada, pago transferido ----------
insert into public.campaigns (brand_id, brand_visible_to_creators, name, objective, platforms, starts_on, default_fee, currency, max_revision_rounds,
  requires_product, requires_ad_code)
select id, true, 'Temporada de verano (demo)', 'Campaña de ejemplo ya cerrada.', '{instagram}', current_date - 40, 500, 'PEN', 2, false, false
  from public.brands where name = 'Marca Demo';
select demo.put('c3', (select id::text from public.campaigns where name = 'Temporada de verano (demo)'));
insert into public.campaign_briefs (campaign_id, brief) values (demo.get('c3')::uuid, 'Rutina de verano usando el producto. Ejemplo para la demo.');
select public.admin_set_campaign_status(demo.get('c3')::uuid, 'active');
select demo.put('a3', public.admin_assign_creator(demo.get('c3')::uuid, demo.uid('lucia@vocera.demo'))::text);
select public.admin_record_client_approval(demo.get('a3')::uuid, true, null);
select public.admin_send_invitation(demo.get('a3')::uuid);
reset role; select demo.login('lucia@vocera.demo'); set role authenticated;
select public.respond_invitation(demo.get('a3')::uuid, true);
reset role;
select demo.file('documents', demo.uid('lucia@vocera.demo') || '/contratos/contrato-verano-demo-firmado.pdf', 'application/pdf', 'equipo@vocera.demo');
select demo.login('equipo@vocera.demo'); set role authenticated;
select demo.put('k3', public.admin_create_contract(demo.get('a3')::uuid, 'Contrato de colaboración (demo)', 'Honorario S/ 500. Ejemplo para la demo.', null, current_date - 38, current_date + 30, null)::text);
select public.admin_record_contract_signature(demo.get('k3')::uuid, 'signed_document_upload',
  demo.uid('lucia@vocera.demo') || '/contratos/contrato-verano-demo-firmado.pdf', null, current_date - 37);
reset role; select demo.login('lucia@vocera.demo'); set role authenticated;
select demo.put('g3', public.save_script_draft(demo.get('a3')::uuid, 'Rutina de playa en tres pasos usando el producto. Guion de ejemplo para la demo.')::text);
select public.submit_script(demo.get('g3')::uuid);
reset role; select demo.login('equipo@vocera.demo'); set role authenticated;
select public.admin_review_script(demo.get('g3')::uuid, 'approved');
select demo.put('d3', public.admin_create_deliverable(demo.get('a3')::uuid, 'video', 'Reel 20 s', null, true, current_date + 30)::text);
reset role;
select demo.file('deliverables', demo.uid('lucia@vocera.demo') || '/entregas/verano-v1.mp4', 'video/mp4', 'lucia@vocera.demo');
select demo.login('lucia@vocera.demo'); set role authenticated;
select public.submit_deliverable_version(demo.get('d3')::uuid, demo.uid('lucia@vocera.demo') || '/entregas/verano-v1.mp4', 'verano-v1.mp4', 'video/mp4', 3100000);
reset role; select demo.login('equipo@vocera.demo'); set role authenticated;
select public.admin_review_deliverable(demo.get('d3')::uuid, true);
select demo.put('p3', public.admin_schedule_publication(demo.get('a3')::uuid, 'instagram', now() - interval '20 days', 'Publicar con #publicidad')::text);
reset role; select demo.login('lucia@vocera.demo'); set role authenticated;
select public.mark_publication_done(demo.get('p3')::uuid, 'https://example.com/publicacion-demo');
reset role; select demo.login('equipo@vocera.demo'); set role authenticated;
select public.admin_validate_publication(demo.get('p3')::uuid, true);
select public.admin_final_validate(demo.get('a3')::uuid, 'Todo conforme');
reset role; select demo.login('lucia@vocera.demo'); set role authenticated;
select public.set_payout_method('Lucía Ramos (demo)', 'PE', 'Banco Demo', 'savings', 'PEN', '00000000001234', null, null);
reset role;
select demo.file('documents', demo.uid('lucia@vocera.demo') || '/pagos/comprobante-verano-demo.pdf', 'application/pdf', 'equipo@vocera.demo');
select demo.login('equipo@vocera.demo'); set role authenticated;
select public.admin_authorize_payment(demo.get('a3')::uuid, true, 'Ejemplo de la demo');
select public.admin_register_transfer((select id from public.payments where assignment_id = demo.get('a3')::uuid and concept = 'fee'),
  now() - interval '2 days', 'DEMO-OP-0001', demo.uid('lucia@vocera.demo') || '/pagos/comprobante-verano-demo.pdf');
reset role;
select set_config('request.jwt.claims', '', false);
