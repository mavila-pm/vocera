-- =====================================================================
-- Prueba de integración: flujo completo + aislamiento + reglas de pago.
-- Corre contra la base local (dev/local-supabase/reset-db.sh) con:
--   psql -v ON_ERROR_STOP=1 -d vocera_dev -f supabase/tests/01_flow_and_security.sql
-- Cada bloque cambia de usuario con test.login(); las políticas RLS y los
-- permisos se evalúan con el rol "authenticated", igual que en Supabase.
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema if not exists test;
grant usage on schema test to authenticated, anon;

create or replace function test.uid(p_email text) returns uuid language sql security definer as $$
  select id from auth.users where email = p_email
$$;
grant execute on function test.uid(text) to authenticated, anon;

-- Ejecuta SQL y exige que falle con un mensaje que contenga p_pattern
create or replace function test.expect_error(p_sql text, p_pattern text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_pattern || '%' then
      raise notice 'OK (bloqueado): %', left(sqlerrm, 90);
      return;
    end if;
    raise exception 'Error inesperado: "%" (se esperaba "%") en: %', sqlerrm, p_pattern, p_sql;
  end;
  raise exception 'Se esperaba un error "%" y no ocurrió: %', p_pattern, p_sql;
end $$;
grant execute on function test.expect_error(text, text) to authenticated, anon;

create or replace function test.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FALLÓ: %', p_label; end if;
  raise notice 'OK: %', p_label;
end $$;
grant execute on function test.check(boolean, text) to authenticated, anon;

create table if not exists test.ctx (k text primary key, v text);
grant all on test.ctx to authenticated;
create or replace function test.put(k text, v text) returns void language sql as $$
  insert into test.ctx values (k, v) on conflict (k) do update set v = excluded.v $$;
create or replace function test.get(k text) returns text language sql as $$ select v from test.ctx where ctx.k = get.k $$;
grant execute on function test.put(text, text), test.get(text) to authenticated;

-- ---------- Usuarios (alta como lo haría Supabase Auth) ----------
insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data) values
  ('admin@vocera.test', extensions.crypt('x', extensions.gen_salt('bf')), now(), '{"full_name":"Admin Prueba","terms_accepted":"true"}'),
  ('a@creador.test',    extensions.crypt('x', extensions.gen_salt('bf')), now(), '{"full_name":"Creadora A","phone":"+51900000001","terms_accepted":"true","role":"admin"}'),
  ('b@creador.test',    extensions.crypt('x', extensions.gen_salt('bf')), now(), '{"full_name":"Creador B","phone":"+51900000002","terms_accepted":"true"}');
-- Primer admin: se promueve por SQL (documentado en docs/PORTAL.md)
update public.profiles set role = 'admin' where email = 'admin@vocera.test';

select test.check((select role from public.profiles where email = 'a@creador.test') = 'creator',
  'el rol enviado en metadatos del registro se ignora (A nace creator)');

create or replace function test.login(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', test.uid(p_email), 'role', 'authenticated')::text, false);
end $$;

-- ===================== Onboarding de A =====================
select test.login('a@creador.test'); set role authenticated;

select test.expect_error('select public.submit_profile_for_review()', 'Faltan datos obligatorios');
select test.expect_error($$update public.profiles set role = 'admin' where id = auth.uid()$$, 'permission denied');
select test.expect_error($$update public.profiles set status = 'approved' where id = auth.uid()$$, 'permission denied');

insert into storage.objects (bucket_id, name, owner) values ('avatars', test.uid('a@creador.test') || '/avatar.jpg', auth.uid());
insert into public.creator_profiles (user_id, artistic_name, avatar_path, country, city, bio, main_category, availability, portfolio_links, default_currency)
values (auth.uid(), 'A en la cocina', auth.uid() || '/avatar.jpg', 'PE', 'Lima', 'Creo recetas cortas para gente con poco tiempo y mucha hambre.', 'Gastronomía', 'available', '{https://example.com/portafolio}', 'PEN');
insert into public.creator_social_accounts (user_id, platform, handle, url, followers_declared, avg_views_declared, engagement_declared)
values (auth.uid(), 'tiktok', '@a_cocina', 'https://www.tiktok.com/@a_cocina', 15400, 8200, 6.4);
select test.expect_error($$update public.creator_social_accounts set followers_verified = 999999$$, 'permission denied');
insert into public.creator_rates (user_id, rate_type, amount, currency) values (auth.uid(), 'video', 800, 'PEN');
select test.check((public.creator_completion() ->> 'percent')::int = 100, 'perfil completo al 100 %');
select public.submit_profile_for_review();
select test.expect_error('select public.submit_profile_for_review()', 'ya fue enviado');

-- ===================== B intenta ver o tocar datos de A =====================
reset role; select test.login('b@creador.test'); set role authenticated;
select test.check((select count(*) from public.creator_profiles where user_id = test.uid('a@creador.test')) = 0, 'B no ve el perfil profesional de A');
select test.check((select count(*) from public.profiles where id = test.uid('a@creador.test')) = 0, 'B no ve la cuenta de A');
update public.creator_profiles set bio = 'hackeado' where user_id = test.uid('a@creador.test');
select test.check((select count(*) from storage.objects where name like test.uid('a@creador.test') || '/%') = 0, 'B no ve los archivos de A');
select test.expect_error(format($$insert into storage.objects (bucket_id, name) values ('deliverables', '%s/intruso.mp4')$$, test.uid('a@creador.test')), 'row-level security');
select test.expect_error(format($$select public.admin_review_profile('%s', true)$$, test.uid('a@creador.test')), 'reservada al equipo');
select test.expect_error(format($$select public.creator_completion('%s')$$, test.uid('a@creador.test')), 'Sin permiso');

-- ===================== Admin aprueba y crea campaña =====================
reset role;
select test.check((select bio from public.creator_profiles where user_id = test.uid('a@creador.test')) not like 'hackeado', 'el UPDATE de B sobre A no tuvo efecto');
select test.login('admin@vocera.test'); set role authenticated;
select test.expect_error(format($$select public.admin_review_profile('%s', false)$$, test.uid('a@creador.test')), 'motivo');
select public.admin_review_profile(test.uid('a@creador.test'), true);

insert into public.brands (name) values ('Marca de prueba');
insert into public.campaigns (brand_id, brand_visible_to_creators, name, objective, platforms, starts_on, default_fee, currency,
  max_revision_rounds, requires_product, requires_ad_code, video_due_on)
select id, true, 'Campaña de prueba', 'Validar el flujo', '{tiktok}', current_date, 800, 'PEN', 2, true, true, current_date + 10
  from public.brands where name = 'Marca de prueba';
select test.put('campaign', (select id::text from public.campaigns where name = 'Campaña de prueba'));
select test.expect_error(format($$select public.admin_set_campaign_status('%s', 'active')$$, test.get('campaign')), 'brief');
insert into public.campaign_briefs (campaign_id, brief, mandatory_messages, forbidden_claims)
values (test.get('campaign')::uuid, 'Mostrar el producto en una receta real de 30 segundos.', 'Mencionar el nombre del producto', 'No prometer beneficios para la salud');
select public.admin_set_campaign_status(test.get('campaign')::uuid, 'active');
select test.expect_error(format($$select public.admin_assign_creator('%s', '%s')$$, test.get('campaign'), test.uid('b@creador.test')), 'perfil aprobado');
select test.put('asg', public.admin_assign_creator(test.get('campaign')::uuid, test.uid('a@creador.test'))::text);
select test.expect_error(format($$select public.admin_send_invitation('%s')$$, test.get('asg')), 'aprobación del cliente');
select public.admin_request_client_approval(test.get('asg')::uuid);
select public.admin_record_client_approval(test.get('asg')::uuid, true, 'Aprobado por correo del cliente');

-- A todavía no ve la campaña (no ha sido invitada)
reset role; select test.login('a@creador.test'); set role authenticated;
select test.check((select count(*) from public.campaigns) = 0, 'antes de la invitación A no ve la campaña');

reset role; select test.login('admin@vocera.test'); set role authenticated;
select public.admin_send_invitation(test.get('asg')::uuid);

-- ===================== A acepta =====================
reset role; select test.login('a@creador.test'); set role authenticated;
select test.check(jsonb_array_length(public.my_campaigns()) = 1, 'A ve su invitación');
select test.check((select count(*) from public.brands) = 1, 'A ve la marca (visible por configuración)');
select test.check((select count(*) from public.notifications where type = 'assignment_invited') = 1, 'A recibió la notificación de invitación');
select test.expect_error(format($$select public.save_script_draft('%s', 'texto')$$, test.get('asg')), 'etapa actual');
select test.check(public.respond_invitation(test.get('asg')::uuid, true) = 'availability_confirmed', 'A acepta: disponibilidad confirmada');

reset role; select test.login('b@creador.test'); set role authenticated;
select test.check((select count(*) from public.campaigns) = 0, 'B no ve la campaña de A');
select test.check((select count(*) from public.campaign_assignments) = 0, 'B no ve la asignación de A');
select test.expect_error(format($$select public.get_assignment_bundle('%s')$$, test.get('asg')), 'No tienes acceso');
select test.expect_error(format($$select public.respond_invitation('%s', false)$$, test.get('asg')), 'No tienes acceso');

-- ===================== Contrato =====================
reset role; select test.login('admin@vocera.test'); set role authenticated;
insert into storage.objects (bucket_id, name, owner) values ('documents', test.uid('a@creador.test') || '/contratos/contrato-v1.pdf', auth.uid());
select test.put('contract', public.admin_create_contract(test.get('asg')::uuid, 'Contrato de colaboración', 'Condiciones…',
  test.uid('a@creador.test') || '/contratos/contrato-v1.pdf', current_date, current_date + 60, current_date + 3)::text);
select test.expect_error(format($$select public.admin_record_contract_signature('%s', 'signed_document_upload', null, null, current_date)$$, test.get('contract')), 'evidencia');

reset role; select test.login('a@creador.test'); set role authenticated;
select public.acknowledge_contract(test.get('contract')::uuid, 'test-agent');
select test.check((select status from public.contracts where id = test.get('contract')::uuid) = 'sent', 'leer el contrato NO lo marca como firmado');

reset role; select test.login('admin@vocera.test'); set role authenticated;
insert into storage.objects (bucket_id, name, owner) values ('documents', test.uid('a@creador.test') || '/contratos/contrato-v1-firmado.pdf', auth.uid());
select public.admin_record_contract_signature(test.get('contract')::uuid, 'signed_document_upload',
  test.uid('a@creador.test') || '/contratos/contrato-v1-firmado.pdf', null, current_date);
select test.check((select status from public.campaign_assignments where id = test.get('asg')::uuid) = 'product_pending', 'con contrato firmado pasa a producto pendiente');

-- ===================== Producto =====================
select test.put('ship', public.admin_create_shipment(test.get('asg')::uuid, 'Kit de prueba', 'Caja con 3 unidades', 3, 120, 'PEN',
  'Marca de prueba', 'Olva', 'TRK-001', current_date + 2, 'El producto queda en poder del creador tras publicar.')::text);
reset role; select test.login('a@creador.test'); set role authenticated;
select test.expect_error(format($$select public.confirm_product_receipt('%s', current_date + 5)$$, test.get('ship')), 'fecha');
select public.confirm_product_receipt(test.get('ship')::uuid, current_date);
select test.expect_error(format($$select public.confirm_product_receipt('%s', current_date)$$, test.get('ship')), 'Ya confirmaste');

-- ===================== Guion =====================
select test.put('s1', public.save_script_draft(test.get('asg')::uuid, 'Escena 1: abro la caja. Escena 2: cocino la receta.')::text);
select public.submit_script(test.get('s1')::uuid);
select test.expect_error(format($$select public.save_script_draft('%s', 'otro')$$, test.get('asg')), 'etapa actual');
reset role; select test.login('admin@vocera.test'); set role authenticated;
select test.expect_error(format($$select public.admin_review_script('%s', 'changes_requested')$$, test.get('s1')), 'Explica');
select public.admin_review_script(test.get('s1')::uuid, 'changes_requested', 'Menciona el producto en los primeros 3 segundos.');
reset role; select test.login('a@creador.test'); set role authenticated;
select test.put('s2', public.save_script_draft(test.get('asg')::uuid, 'Escena 1: digo el nombre del producto. Escena 2: cocino.')::text);
select test.check((select version from public.scripts where id = test.get('s2')::uuid) = 2, 'la corrección crea la versión 2 del guion');
select public.submit_script(test.get('s2')::uuid);
reset role; select test.login('admin@vocera.test'); set role authenticated;
select public.admin_review_script(test.get('s2')::uuid, 'approved');
select test.check((select status from public.campaign_assignments where id = test.get('asg')::uuid) = 'in_production', 'guion aprobado: producción en curso');

-- ===================== Video y correcciones =====================
select test.put('dlv', public.admin_create_deliverable(test.get('asg')::uuid, 'video', 'Video vertical 30 s', '9:16, 1080p')::text);
reset role; select test.login('a@creador.test'); set role authenticated;
insert into storage.objects (bucket_id, name, owner) values ('deliverables', test.uid('a@creador.test') || '/v1.mp4', auth.uid()),
  ('deliverables', test.uid('a@creador.test') || '/v2.mp4', auth.uid()), ('deliverables', test.uid('a@creador.test') || '/v3.mp4', auth.uid());
select test.expect_error(format($$select public.submit_deliverable_version('%s', '%s/v1.mp4', 'v1.exe', 'application/x-msdownload', 100)$$, test.get('dlv'), test.uid('a@creador.test')), 'Formato');
select test.expect_error(format($$select public.submit_deliverable_version('%s', '%s/no-existe.mp4', 'x.mp4', 'video/mp4', 100)$$, test.get('dlv'), test.uid('a@creador.test')), 'No encontramos');
select public.submit_deliverable_version(test.get('dlv')::uuid, test.uid('a@creador.test') || '/v1.mp4', 'v1.mp4', 'video/mp4', 1048576);
select test.expect_error(format($$select public.submit_deliverable_version('%s', '%s/v2.mp4', 'v2.mp4', 'video/mp4', 100)$$, test.get('dlv'), test.uid('a@creador.test')), 'en revisión');

reset role; select test.login('admin@vocera.test'); set role authenticated;
select public.admin_review_deliverable(test.get('dlv')::uuid, false, 'Audio bajo', 'Sube el volumen de la voz', true);
reset role; select test.login('a@creador.test'); set role authenticated;
select public.submit_deliverable_version(test.get('dlv')::uuid, test.uid('a@creador.test') || '/v2.mp4', 'v2.mp4', 'video/mp4', 1048576);
reset role; select test.login('admin@vocera.test'); set role authenticated;
select public.admin_review_deliverable(test.get('dlv')::uuid, false, 'Logo cortado', null, true);
reset role; select test.login('a@creador.test'); set role authenticated;
select public.submit_deliverable_version(test.get('dlv')::uuid, test.uid('a@creador.test') || '/v3.mp4', 'v3.mp4', 'video/mp4', 1048576);
reset role; select test.login('admin@vocera.test'); set role authenticated;
select test.expect_error(format($$select public.admin_review_deliverable('%s', false, 'Otro detalle', null, true)$$, test.get('dlv')), 'máximo de 2 rondas');
select public.admin_review_deliverable(test.get('dlv')::uuid, true);
select test.check((select count(*) from public.revision_requests where resolved_at is not null) = 2, 'las 2 rondas quedaron resueltas con nueva versión');

-- ===================== Publicación =====================
select test.put('pub', public.admin_schedule_publication(test.get('asg')::uuid, 'tiktok', now() + interval '1 day', 'Publicar a las 19:00 con #publi')::text);
reset role; select test.login('a@creador.test'); set role authenticated;
select test.expect_error(format($$select public.mark_publication_done('%s', 'no-es-url')$$, test.get('pub')), 'enlace');
select public.mark_publication_done(test.get('pub')::uuid, 'https://www.tiktok.com/@a_cocina/video/123');
reset role; select test.login('admin@vocera.test'); set role authenticated;
select public.admin_validate_publication(test.get('pub')::uuid, true);
select test.check((select status from public.campaign_assignments where id = test.get('asg')::uuid) = 'ad_codes_pending', 'requiere código publicitario');
select test.expect_error(format($$select public.admin_final_validate('%s')$$, test.get('asg')), 'etapa actual');

-- ===================== Código publicitario =====================
reset role; select test.login('a@creador.test'); set role authenticated;
select test.put('ad', public.upsert_ad_authorization(null, test.get('asg')::uuid, 'tiktok', '#SPARK-ABC-123', 'https://www.tiktok.com/@a_cocina/video/123',
  test.get('pub')::uuid, current_date, current_date + 30)::text);
reset role; select test.login('b@creador.test'); set role authenticated;
select test.check((select count(*) from public.advertising_authorizations) = 0, 'B no ve el código publicitario de A');
reset role;
select test.check(not exists (select 1 from public.audit_logs where meta::text like '%SPARK%'), 'el código no se guarda en la auditoría');
select test.login('admin@vocera.test'); set role authenticated;
select public.admin_validate_ad_authorization(test.get('ad')::uuid, true);

-- ===================== Validación final y pago =====================
select public.admin_final_validate(test.get('asg')::uuid, 'Todo conforme');
select test.check((select status from public.campaign_assignments where id = test.get('asg')::uuid) = 'payment_pending_authorization', 'pago pendiente de autorización');
select test.expect_error(format($$select public.admin_authorize_payment('%s', true)$$, test.get('asg')), 'condiciones pendientes');

reset role; select test.login('a@creador.test'); set role authenticated;
select test.check((public.payment_checklist(test.get('asg')::uuid) -> 'items' -> 8 ->> 'met')::boolean = false, 'A ve que le faltan datos de cobro');
select public.set_payout_method('Creadora A', 'PE', 'Banco de Prueba', 'savings', 'PEN', '191-12345678-0-99', '00219100123456780999');
select test.check((select account_last4 from public.payout_methods) = '8099', 'A solo ve los 4 últimos dígitos');
select test.expect_error('select account_ciphertext from public.payout_methods', 'permission denied');
select test.expect_error(format($$select public.admin_reveal_payout_method('%s', 'curiosidad')$$, (select id from public.payout_methods)), 'reservada');

reset role;
select test.check((select account_ciphertext::text not like '%12345678%' from public.payout_methods), 'el número de cuenta está cifrado en la base');
select test.check(not exists (select 1 from public.audit_logs where meta::text like '%12345678%'), 'el número de cuenta no aparece en la auditoría');

select test.login('admin@vocera.test'); set role authenticated;
select test.expect_error(format($$select public.admin_authorize_payment('%s', false)$$, test.get('asg')), 'incumplimientos');
select public.admin_authorize_payment(test.get('asg')::uuid, true, 'OK');
select test.expect_error(format($$select public.admin_authorize_payment('%s', true)$$, test.get('asg')), 'ya fue autorizado');
select test.check(public.admin_reveal_payout_method((select id from public.payout_methods), 'Preparar transferencia') ->> 'account_number' = '191123456780' || '99', 'el admin descifra con motivo y queda auditado');
select test.check(exists (select 1 from public.audit_logs where action = 'payout_method_revealed'), 'la consulta del número completo quedó auditada');
insert into storage.objects (bucket_id, name, owner) values ('documents', test.uid('a@creador.test') || '/pagos/comprobante.pdf', auth.uid());
select test.put('pay', (select id::text from public.payments where assignment_id = test.get('asg')::uuid and concept = 'fee'));
select public.admin_register_transfer(test.get('pay')::uuid, now(), 'OP-000123', test.uid('a@creador.test') || '/pagos/comprobante.pdf');
select test.expect_error(format($$select public.admin_register_transfer('%s', now(), 'OP-000124')$$, test.get('pay')), 'estado actual: transferred');

reset role; select test.login('a@creador.test'); set role authenticated;
select public.confirm_payment_received(test.get('pay')::uuid);
select test.check((select status from public.campaign_assignments where id = test.get('asg')::uuid) = 'payment_confirmed', 'flujo completo: pago confirmado');
select test.check((public.my_payments() -> 'summary' -> 0 ->> 'received')::numeric = 800, 'A ve S/ 800 recibidos en su historial');
select test.check((select count(*) from public.audit_logs) = 0, 'A no puede leer la auditoría');

reset role; select test.login('b@creador.test'); set role authenticated;
select test.check(jsonb_array_length(public.my_payments() -> 'items') = 0, 'B no ve pagos de A');
select test.check((select count(*) from public.payments) = 0, 'B no lee la tabla de pagos de A');

-- ===================== Anónimo =====================
reset role; select set_config('request.jwt.claims', '{"role":"anon"}', false); set role anon;
select test.expect_error('select * from public.profiles', 'permission denied');
select test.expect_error('select public.creator_dashboard()', 'permission denied');

reset role;
select test.check((select count(*) from public.audit_logs where action = 'assignment_status') >= 15, 'cada cambio de estado quedó auditado');
select test.check((select count(*) from public.notifications n join public.profiles p on p.id = n.user_id
                    where p.email = 'a@creador.test' and n.email_status = 'pending_provider') > 0,
  'las notificaciones por correo quedan pendientes de proveedor (no se simula el envío)');
\echo '== Todas las pruebas de flujo y seguridad pasaron =='
