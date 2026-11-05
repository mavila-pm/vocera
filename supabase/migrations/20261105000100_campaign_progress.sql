-- Mis campañas: agrega las etapas que exige cada campaña para dibujar su avance
-- (onda de etapas en el portal). Misma firma y permisos; solo suma el campo "requires".
create or replace function public.my_campaigns() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(row order by (row ->> 'updated_at') desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', a.id, 'campaign_id', c.id, 'name', c.name,
      'brand', case when c.brand_visible_to_creators then b.name end,
      'status', a.status, 'group', private.assignment_group(a.status),
      'fee', a.fee_amount, 'currency', a.currency,
      'deadline', private.next_deadline(a.id),
      'next_action', private.next_action(a.id),
      'platforms', c.platforms, 'updated_at', a.updated_at,
      'requires', jsonb_build_object(
        'contract', c.requires_contract, 'product', c.requires_product, 'script', c.requires_script,
        'publication', c.requires_publication, 'ad_code', c.requires_ad_code)
    ) as row
    from public.campaign_assignments a
    join public.campaigns c on c.id = a.campaign_id
    left join public.brands b on b.id = c.brand_id
    where a.creator_id = auth.uid() and a.invited_at is not null
  ) t
$$;
