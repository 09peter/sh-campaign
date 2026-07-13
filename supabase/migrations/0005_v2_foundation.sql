-- v2.0–v2.2: player dropout evacuation, campaign templates, attrition.
-- All rules changes are per-campaign toggles defaulting to v1.8 behavior.

-- ============================================================ dropout

alter table public.roster drop constraint roster_status_check;
alter table public.roster add constraint roster_status_check
  check (status in ('pending_approval','approved','suspended','departed'));

create or replace function public.evacuate_roster(rid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record; n_hexes int; tno int;
begin
  select * into r from roster where id = rid;
  if not found then raise exception 'Roster not found.'; end if;
  if not public.is_gm(r.campaign_id) then raise exception 'GM only.'; end if;
  if r.status = 'departed' then raise exception 'Force has already withdrawn.'; end if;

  perform set_config('app.bypass_guard', '1', true);
  select count(*) into n_hexes from hex_tile
    where campaign_id = r.campaign_id and controlled_by = rid;
  update hex_tile set controlled_by = null
    where campaign_id = r.campaign_id and controlled_by = rid;
  -- Armies go off-map rather than being deleted: battle_order rows reference
  -- them, and history is never deleted. 'broken' is already excluded from
  -- every map/turn flow; the roster's 'departed' status is the source of truth.
  update army set status = 'broken', hex_id = null, consecutive_turns_held = '{}'
    where campaign_id = r.campaign_id and roster_id = rid;
  update roster set status = 'departed', updated_at = now() where id = rid;

  select max(turn_number) into tno from campaign_turn where campaign_id = r.campaign_id;
  perform public.log_event(r.campaign_id, tno, 'roster_departed',
    r.name || ' withdraws from the sector — ' || n_hexes || ' hex(es) of their ground lie abandoned.',
    jsonb_build_object('roster_id', rid, 'hexes_released', n_hexes));
end $$;

-- ============================================================ templates

create table public.campaign_template (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_by uuid references auth.users,
  config jsonb not null,        -- campaign rule columns snapshot
  map jsonb,                    -- optional: [{q,r,terrain_type,strategic_value,soc_radius,name,flavour_text}]
  map_theme jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.campaign_template enable row level security;
create policy ct_select on public.campaign_template for select using (auth.uid() is not null);
create policy ct_insert on public.campaign_template for insert with check (created_by = auth.uid());
create policy ct_delete on public.campaign_template for delete
  using (created_by = auth.uid() or public.is_admin());

create or replace function public.save_template(
  cid uuid, tname text, tdesc text default null, include_map boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare c record; cfg jsonb; m jsonb; tid uuid;
begin
  if not public.is_gm(cid) then raise exception 'GM only.'; end if;
  select * into c from campaign where id = cid;
  cfg := jsonb_build_object(
    'ruleset_label', c.ruleset_label, 'max_players', c.max_players,
    'supply_limit_base', c.supply_limit_base, 'requisition_points_start', c.requisition_points_start,
    'xp_per_battle', c.xp_per_battle, 'xp_agenda_achieved', c.xp_agenda_achieved,
    'xp_marked_for_greatness', c.xp_marked_for_greatness, 'xp_battle_honour_bonus', c.xp_battle_honour_bonus,
    'rp_per_battle', c.rp_per_battle, 'rp_for_victory', c.rp_for_victory,
    'force_march_max', c.force_march_max, 'soc_hold_turns', c.soc_hold_turns,
    'unique_honours', to_jsonb(c.unique_honours), 'mission_pool', to_jsonb(c.mission_pool),
    'victory_conditions', c.victory_conditions,
    'attrition_enabled', c.attrition_enabled, 'recovery_turns', c.recovery_turns,
    'broken_income_penalty', c.broken_income_penalty
  );
  if include_map then
    select jsonb_agg(jsonb_build_object('q', q, 'r', r, 'terrain_type', terrain_type,
      'strategic_value', strategic_value, 'soc_radius', soc_radius,
      'name', name, 'flavour_text', flavour_text))
    into m from hex_tile where campaign_id = cid;
  end if;
  insert into campaign_template (name, description, created_by, config, map, map_theme)
  values (tname, tdesc, auth.uid(), cfg, m, coalesce(c.map_theme, '{}'::jsonb))
  returning id into tid;
  return tid;
end $$;

create or replace function public.instantiate_template(tid uuid, cname text)
returns uuid language plpgsql security definer set search_path = public as $$
declare t record; cid uuid; hx jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into t from campaign_template where id = tid;
  if not found then raise exception 'Template not found.'; end if;

  insert into campaign (name, created_by, status, ruleset_label, max_players,
    supply_limit_base, requisition_points_start, xp_per_battle, xp_agenda_achieved,
    xp_marked_for_greatness, xp_battle_honour_bonus, rp_per_battle, rp_for_victory,
    force_march_max, soc_hold_turns, unique_honours, mission_pool, victory_conditions,
    attrition_enabled, recovery_turns, broken_income_penalty, map_theme)
  values (cname, auth.uid(), 'draft',
    t.config ->> 'ruleset_label', (t.config ->> 'max_players')::int,
    (t.config ->> 'supply_limit_base')::int, (t.config ->> 'requisition_points_start')::int,
    (t.config ->> 'xp_per_battle')::int, (t.config ->> 'xp_agenda_achieved')::int,
    (t.config ->> 'xp_marked_for_greatness')::int, (t.config ->> 'xp_battle_honour_bonus')::int,
    (t.config ->> 'rp_per_battle')::int, (t.config ->> 'rp_for_victory')::int,
    (t.config ->> 'force_march_max')::int, (t.config ->> 'soc_hold_turns')::int,
    coalesce((select array_agg(x) from jsonb_array_elements_text(t.config -> 'unique_honours') x), '{}'),
    coalesce((select array_agg(x) from jsonb_array_elements_text(t.config -> 'mission_pool') x), '{}'),
    coalesce(t.config -> 'victory_conditions', '[]'::jsonb),
    coalesce((t.config ->> 'attrition_enabled')::boolean, false),
    coalesce((t.config ->> 'recovery_turns')::int, 1),
    coalesce((t.config ->> 'broken_income_penalty')::boolean, true),
    t.map_theme)
  returning id into cid;
  -- creator-GM trigger has fired

  if t.map is not null then
    for hx in select * from jsonb_array_elements(t.map) loop
      insert into hex_tile (campaign_id, q, r, terrain_type, strategic_value, soc_radius, name, flavour_text)
      values (cid, (hx ->> 'q')::int, (hx ->> 'r')::int, hx ->> 'terrain_type',
        coalesce((hx ->> 'strategic_value')::int, 0), coalesce((hx ->> 'soc_radius')::int, 0),
        hx ->> 'name', hx ->> 'flavour_text');
    end loop;
  end if;
  return cid;
end $$;

-- ============================================================ attrition

alter table public.campaign
  add column attrition_enabled boolean not null default false,
  add column recovery_turns int not null default 1,
  add column broken_income_penalty boolean not null default true;
alter table public.unit add column recovering_until_turn int;

-- verify_battle v3: with attrition enabled, destroyed units enter recovery
-- (fieldable again when the open turn number exceeds recovering_until_turn)
-- instead of being marked permanently destroyed.
create or replace function public.verify_battle(bid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b record; c record; caller uuid := auth.uid();
  is_opponent boolean; bu record; xp int; rp int;
  winner uuid; unit_summary text[] := '{}'; tno int;
begin
  select * into b from battle where id = bid;
  if not found then raise exception 'Battle not found.'; end if;
  if b.status <> 'pending_verification' then
    raise exception 'Battle is not awaiting verification.';
  end if;
  select exists (
    select 1 from roster
    where id in (b.attacker_roster_id, b.defender_roster_id) and player_id = caller
  ) and caller <> b.created_by into is_opponent;
  if not (is_opponent or public.is_gm(b.campaign_id)) then
    raise exception 'Only the opponent or the GM can verify this battle.';
  end if;

  select * into c from campaign where id = b.campaign_id;
  select t.turn_number into tno from battle_order bo join campaign_turn t on t.id = bo.turn_id
    where bo.battle_id = bid limit 1;
  if tno is null then
    select max(turn_number) into tno from campaign_turn where campaign_id = b.campaign_id;
  end if;

  perform set_config('app.bypass_guard', '1', true);

  for bu in
    select x.*, u.name as unit_name from battle_unit x join unit u on u.id = x.unit_id
    where x.battle_id = bid
  loop
    xp := c.xp_per_battle;
    if (bu.side = 'attacker' and b.agenda_attacker_achieved)
       or (bu.side = 'defender' and b.agenda_defender_achieved) then
      xp := xp + c.xp_agenda_achieved;
    end if;
    if bu.marked_for_greatness then xp := xp + c.xp_marked_for_greatness; end if;
    update unit set xp_total = xp_total + xp, updated_at = now() where id = bu.unit_id;
    if bu.destroyed_in_battle then
      if c.attrition_enabled then
        update unit set recovering_until_turn = coalesce(tno, 0) + c.recovery_turns,
          is_destroyed = false, updated_at = now() where id = bu.unit_id;
      else
        update unit set is_destroyed = true, updated_at = now() where id = bu.unit_id;
      end if;
    end if;
    unit_summary := unit_summary || (bu.unit_name || ': +' || xp || ' XP');
  end loop;

  winner := case b.attacker_result
    when 'victory' then b.attacker_roster_id
    when 'defeat' then b.defender_roster_id
    else null end;

  rp := c.rp_per_battle;
  update roster set requisition_points = requisition_points + rp
    + case when id = winner then c.rp_for_victory else 0 end,
    updated_at = now()
  where id in (b.attacker_roster_id, b.defender_roster_id);

  update battle set status = 'verified', verified_by = caller, verified_at = now(), updated_at = now()
    where id = bid;
  update battle_order set status = 'completed' where battle_id = bid;

  perform public.log_event(b.campaign_id, tno, 'battle_verified',
    (select r1.name from roster r1 where r1.id = b.attacker_roster_id) || ' vs ' ||
    (select r2.name from roster r2 where r2.id = b.defender_roster_id) || ' — ' ||
    coalesce(b.attacker_result, 'draw') || ' (attacker)',
    jsonb_build_object('battle_id', bid, 'units', to_jsonb(unit_summary)));

  return jsonb_build_object('units', to_jsonb(unit_summary));
end $$;

-- amend_battle v2: also reverses recovery state.
create or replace function public.amend_battle(bid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare b record; c record; bu record; xp int; winner uuid; tno int;
begin
  select * into b from battle where id = bid;
  if not found then raise exception 'Battle not found.'; end if;
  if not public.is_gm(b.campaign_id) then raise exception 'GM only.'; end if;
  if b.status <> 'verified' then raise exception 'Only verified battles can be amended.'; end if;

  select * into c from campaign where id = b.campaign_id;
  perform set_config('app.bypass_guard', '1', true);

  for bu in select * from battle_unit where battle_id = bid loop
    xp := c.xp_per_battle;
    if (bu.side = 'attacker' and b.agenda_attacker_achieved)
       or (bu.side = 'defender' and b.agenda_defender_achieved) then
      xp := xp + c.xp_agenda_achieved;
    end if;
    if bu.marked_for_greatness then xp := xp + c.xp_marked_for_greatness; end if;
    update unit set xp_total = greatest(0, xp_total - xp), updated_at = now() where id = bu.unit_id;
    if bu.destroyed_in_battle then
      update unit set is_destroyed = false, recovering_until_turn = null, updated_at = now()
        where id = bu.unit_id;
    end if;
  end loop;

  winner := case b.attacker_result
    when 'victory' then b.attacker_roster_id
    when 'defeat' then b.defender_roster_id
    else null end;

  update roster set requisition_points = greatest(0, requisition_points - c.rp_per_battle
    - case when id = winner then c.rp_for_victory else 0 end),
    updated_at = now()
  where id in (b.attacker_roster_id, b.defender_roster_id);

  update battle set status = 'pending_verification', verified_by = null, verified_at = null,
    updated_at = now() where id = bid;
  update battle_order set status = 'pending' where battle_id = bid;

  select t.turn_number into tno from battle_order bo join campaign_turn t on t.id = bo.turn_id
    where bo.battle_id = bid limit 1;
  perform public.log_event(b.campaign_id, tno, 'battle_amended',
    'GM reopened a verified battle for correction — applied XP/RP reversed.',
    jsonb_build_object('battle_id', bid));
end $$;

-- complete_turn additions: broken-roster income penalty + recovery events.
-- (Full function re-created; body identical to 0004 except the two marked blocks.)
create or replace function public.complete_turn(tid uuid, p_void_pending boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t record; c record; bo record; a record; cond jsonb;
  n_pending int; winner_army uuid; loser_army uuid; loser record;
  target_id uuid; target_q int; target_r int; step_id uuid; held jsonb; cnt int;
  vp jsonb := '{}'; income jsonb := '{}'; winners jsonb := '[]';
  r record; owned int; total int; top record; u record;
begin
  select * into t from campaign_turn where id = tid;
  if not found then raise exception 'Turn not found.'; end if;
  if not public.is_gm(t.campaign_id) then raise exception 'GM only.'; end if;
  if t.status not in ('locked', 'resolving') then raise exception 'Turn is not locked.'; end if;
  select * into c from campaign where id = t.campaign_id;
  perform set_config('app.bypass_guard', '1', true);

  select count(*) into n_pending from battle_order
    where turn_id = tid and status = 'pending' and defender_army_id is not null;
  if n_pending > 0 and not p_void_pending then
    raise exception 'PENDING_ENGAGEMENTS:%', n_pending;
  end if;
  for bo in select * from battle_order where turn_id = tid and status = 'pending' loop
    update battle_order set status = 'void' where id = bo.id;
    update army set status = 'idle'
      where id in (bo.attacker_army_id, bo.defender_army_id) and status = 'in_battle';
  end loop;

  for bo in
    select o.*, bt.attacker_result, bt.is_crushing_defeat
    from battle_order o join battle bt on bt.id = o.battle_id
    where o.turn_id = tid and o.status = 'completed'
      and bt.status = 'verified' and bt.attacker_result in ('victory', 'defeat')
  loop
    if bo.attacker_result = 'victory' then
      winner_army := bo.attacker_army_id; loser_army := bo.defender_army_id;
    else
      winner_army := bo.defender_army_id; loser_army := bo.attacker_army_id;
    end if;

    if winner_army is not null then
      select roster_id into a from army where id = winner_army;
      update hex_tile set controlled_by = a.roster_id where id = bo.hex_id;
      update army set status = 'idle', hex_id = bo.hex_id where id = winner_army;
    end if;

    if loser_army is not null then
      select * into loser from army where id = loser_army;
      select ht.id, ht.q, ht.r into target_id, target_q, target_r from hex_tile ht
        join hex_tile cur on cur.id = loser.hex_id
        where ht.campaign_id = t.campaign_id and ht.controlled_by = loser.roster_id
          and ht.id <> loser.hex_id
        order by public.hex_distance(cur.q, cur.r, ht.q, ht.r) limit 1;
      if not found then
        update army set status = 'broken', hex_id = null where id = loser_army;
        perform public.log_event(t.campaign_id, t.turn_number, 'army_broken',
          (select name from roster where id = loser.roster_id) || ' is broken — no friendly ground to fall back to.',
          jsonb_build_object('army_id', loser_army));
      elsif bo.is_crushing_defeat then
        update army set status = 'retreating', hex_id = target_id where id = loser_army;
      else
        select ht.id into step_id from hex_tile ht
          join hex_tile cur on cur.id = loser.hex_id
          where ht.campaign_id = t.campaign_id
            and public.hex_distance(cur.q, cur.r, ht.q, ht.r) = 1
          order by public.hex_distance(ht.q, ht.r, target_q, target_r) limit 1;
        if not found then step_id := target_id; end if;
        update army set status = 'retreating', hex_id = step_id where id = loser_army;
      end if;
    end if;
  end loop;

  for a in
    select ar.*, ht.q, ht.r, ht.controlled_by as hex_controller
    from army ar join hex_tile ht on ht.id = ar.hex_id
    where ar.campaign_id = t.campaign_id and ar.status <> 'broken'
  loop
    held := coalesce(a.consecutive_turns_held, '{}'::jsonb);
    if a.hex_controller is not null and a.hex_controller <> a.roster_id
       and exists (
         select 1 from hex_tile s
         where s.campaign_id = t.campaign_id and s.soc_radius > 0
           and s.controlled_by = a.hex_controller
           and public.hex_distance(s.q, s.r, a.q, a.r) <= s.soc_radius
       ) then
      cnt := coalesce((held ->> (a.hex_id::text))::int, 0) + 1;
      if cnt >= c.soc_hold_turns then
        update hex_tile set controlled_by = a.roster_id where id = a.hex_id;
        held := held - (a.hex_id::text);
        perform public.log_event(t.campaign_id, t.turn_number, 'hex_flipped',
          (select name from roster where id = a.roster_id) || ' wrests contested ground from its Sphere of Control.',
          jsonb_build_object('hex_id', a.hex_id));
      else
        held := jsonb_build_object(a.hex_id::text, cnt);
      end if;
    else
      held := '{}'::jsonb;
    end if;
    update army set consecutive_turns_held = held, status = 'idle' where id = a.id;
  end loop;

  -- >>> v2.2: manufactorum income, skipping broken rosters when the penalty is on
  for r in
    select ht.controlled_by as rid, count(*) as n from hex_tile ht
    where ht.campaign_id = t.campaign_id and ht.terrain_type = 'manufactorum'
      and ht.controlled_by is not null
    group by ht.controlled_by
  loop
    if c.broken_income_penalty and exists (
      select 1 from army where campaign_id = t.campaign_id
        and roster_id = r.rid and status = 'broken'
    ) then
      perform public.log_event(t.campaign_id, t.turn_number, 'income_withheld',
        (select name from roster where id = r.rid) || ' draws no requisition — their force is broken in the field.',
        jsonb_build_object('roster_id', r.rid));
    else
      update roster set requisition_points = requisition_points + r.n where id = r.rid;
      income := income || jsonb_build_object(r.rid::text, r.n);
    end if;
  end loop;

  -- >>> v2.2: units returning from recovery this turn
  if c.attrition_enabled then
    for u in
      select un.id, un.name, rs.campaign_id from unit un
      join roster rs on rs.id = un.roster_id
      where rs.campaign_id = t.campaign_id and un.recovering_until_turn = t.turn_number
    loop
      perform public.log_event(t.campaign_id, t.turn_number, 'unit_recovered',
        u.name || ' returns to the line — roll on the Out of Action table and record any scar.',
        jsonb_build_object('unit_id', u.id));
    end loop;
  end if;

  for r in select rs.id from roster rs where rs.campaign_id = t.campaign_id and rs.status <> 'departed' loop
    vp := vp || jsonb_build_object(r.id::text, coalesce((
      select sum(strategic_value) from hex_tile
      where campaign_id = t.campaign_id and controlled_by = r.id), 0));
  end loop;

  select count(*) into total from hex_tile where campaign_id = t.campaign_id;
  for cond in select * from jsonb_array_elements(coalesce(c.victory_conditions, '[]'::jsonb)) loop
    if cond ->> 'type' = 'domination' then
      for r in select rs.id, rs.name from roster rs where rs.campaign_id = t.campaign_id and rs.status <> 'departed' loop
        select count(*) into owned from hex_tile
          where campaign_id = t.campaign_id and controlled_by = r.id;
        if total > 0 and owned * 100.0 / total >= (cond ->> 'threshold_pct')::numeric then
          winners := winners || jsonb_build_object('roster_id', r.id, 'name', r.name,
            'condition', 'Domination ≥ ' || (cond ->> 'threshold_pct') || '%');
        end if;
      end loop;
    elsif cond ->> 'type' = 'hold_hex' then
      for a in
        select ar.roster_id, rs.name from army ar
        join roster rs on rs.id = ar.roster_id
        join hex_tile ht on ht.id = ar.hex_id
        where ar.campaign_id = t.campaign_id
          and ar.hex_id = (cond ->> 'hex_id')::uuid
          and ht.controlled_by = ar.roster_id
          and coalesce((ar.consecutive_turns_held ->> (cond ->> 'hex_id'))::int, 0) + 1
              >= (cond ->> 'turns_required')::int
      loop
        winners := winners || jsonb_build_object('roster_id', a.roster_id, 'name', a.name,
          'condition', 'Held objective hex for ' || (cond ->> 'turns_required') || ' turns');
      end loop;
    elsif cond ->> 'type' = 'vp_threshold' then
      for r in select rs.id, rs.name from roster rs where rs.campaign_id = t.campaign_id and rs.status <> 'departed' loop
        if (vp ->> r.id::text)::int >= (cond ->> 'vp_target')::int then
          winners := winners || jsonb_build_object('roster_id', r.id, 'name', r.name,
            'condition', 'Reached ' || (cond ->> 'vp_target') || ' VP');
        end if;
      end loop;
    elsif cond ->> 'type' = 'vp_at_time' then
      if t.turn_number >= (cond ->> 'turn_limit')::int then
        select rs.id, rs.name into top from roster rs
          where rs.campaign_id = t.campaign_id and rs.status <> 'departed'
          order by (vp ->> rs.id::text)::int desc limit 1;
        if found then
          winners := winners || jsonb_build_object('roster_id', top.id, 'name', top.name,
            'condition', 'Highest VP at turn ' || (cond ->> 'turn_limit'));
        end if;
      end if;
    end if;
  end loop;

  update campaign_turn set status = 'complete', completed_at = now() where id = tid;

  if jsonb_array_length(winners) > 0 then
    update campaign set status = 'completed', updated_at = now() where id = t.campaign_id;
    perform public.log_event(t.campaign_id, t.turn_number, 'campaign_completed',
      'Campaign concluded — ' || (winners -> 0 ->> 'name') || ' victorious: '
        || (winners -> 0 ->> 'condition'),
      jsonb_build_object('winners', winners, 'vp', vp));
  else
    insert into campaign_turn (campaign_id, turn_number, status)
      values (t.campaign_id, t.turn_number + 1, 'open');
    perform public.log_event(t.campaign_id, t.turn_number, 'turn_completed',
      'Turn ' || t.turn_number || ' complete. Turn ' || (t.turn_number + 1) || ' is open for orders.',
      jsonb_build_object('vp', vp, 'rp_income', income, 'voided', n_pending));
  end if;

  return jsonb_build_object('winners', winners, 'vp', vp,
    'rp_income', income, 'voided', n_pending);
end $$;
