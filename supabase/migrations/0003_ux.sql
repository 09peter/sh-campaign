-- UX patch: battle ↔ engagement linkage + realtime.

-- One-click battle report from a pending BattleOrder. Pre-fills participants,
-- hex, and suggested mission, and links battle_order.battle_id (players can't
-- write battle_order under RLS, hence SECURITY DEFINER with its own checks).
create or replace function public.file_battle_for_order(order_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  bo record; att_roster uuid; def_roster uuid; caller uuid := auth.uid();
  new_battle uuid; mtype text;
begin
  select * into bo from battle_order where id = order_id;
  if not found then raise exception 'Engagement not found.'; end if;
  if bo.battle_id is not null then return bo.battle_id; end if;  -- already filed
  if bo.status <> 'pending' then raise exception 'Engagement is not pending.'; end if;

  select roster_id into att_roster from army where id = bo.attacker_army_id;
  if bo.defender_army_id is not null then
    select roster_id into def_roster from army where id = bo.defender_army_id;
  else
    -- SoC invasion of controlled-but-ungarrisoned ground: controller defends
    select controlled_by into def_roster from hex_tile where id = bo.hex_id;
  end if;
  if def_roster is null then raise exception 'No defender for this engagement.'; end if;

  if not (public.is_gm(bo.campaign_id) or exists (
    select 1 from roster where id in (att_roster, def_roster) and player_id = caller
  )) then
    raise exception 'Only a participant or the GM can file this report.';
  end if;

  mtype := coalesce(bo.suggested_mission_type, 'Standard');
  if bo.is_ambush then mtype := mtype || ' — Ambush'; end if;

  insert into battle (campaign_id, attacker_roster_id, defender_roster_id,
                      created_by, hex_id, battle_order_id, mission_type, status)
  values (bo.campaign_id, att_roster, def_roster, caller, bo.hex_id, order_id, mtype, 'draft')
  returning id into new_battle;

  update battle_order set battle_id = new_battle where id = order_id;
  return new_battle;
end $$;

-- Realtime: broadcast changes so open clients update without manual refresh.
alter publication supabase_realtime add table
  public.campaign, public.roster, public.hex_tile, public.army,
  public.campaign_turn, public.move_order, public.battle_order, public.battle;
