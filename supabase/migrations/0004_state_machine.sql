-- v1.8 — server-authoritative state machine.
-- Turn lock, turn completion, battle verification, and battle amendment become
-- single-transaction Postgres functions: they fully happen or don't. The JS
-- ports in src/lib/ remain as the dry-run/preview engine only.

-- ============================================================ event log

create table public.campaign_event (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaign on delete cascade,
  turn_number int,
  event_type text not null,
  actor uuid references auth.users,
  message text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index campaign_event_campaign_idx on public.campaign_event (campaign_id, created_at desc);

alter table public.campaign_event enable row level security;
create policy ce_select on public.campaign_event for select
  using (public.is_member(campaign_id)
         or exists (select 1 from campaign c where c.id = campaign_id and c.status = 'completed'));
create policy ce_insert on public.campaign_event for insert
  with check (public.is_member(campaign_id) and actor = auth.uid());

alter publication supabase_realtime add table public.campaign_event;

create or replace function public.log_event(
  cid uuid, tno int, etype text, msg text, pl jsonb default '{}'
) returns void language sql security definer set search_path = public as $$
  insert into campaign_event (campaign_id, turn_number, event_type, actor, message, payload)
  values (cid, tno, etype, auth.uid(), msg, pl);
$$;

-- ============================================================ progression guard

-- RP and XP are managed by verification/turn functions and the GM. Direct
-- writes by players are blocked; internal functions set a transaction-local
-- bypass flag before applying their deltas.
create or replace function public.guard_progression()
returns trigger language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if coalesce(current_setting('app.bypass_guard', true), '') = '1' then
    return new;
  end if;
  if tg_table_name = 'roster' then
    if new.requisition_points is distinct from old.requisition_points
       and not public.is_gm(old.campaign_id) then
      raise exception 'Requisition points change only through battle verification, turn income, or the GM.';
    end if;
  elsif tg_table_name = 'unit' then
    if new.xp_total is distinct from old.xp_total then
      select campaign_id into cid from roster where id = old.roster_id;
      if not public.is_gm(cid) then
        raise exception 'Unit XP changes only through battle verification or the GM.';
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger roster_guard before update on public.roster
  for each row execute procedure public.guard_progression();
create trigger unit_guard before update on public.unit
  for each row execute procedure public.guard_progression();

-- ============================================================ helpers

create or replace function public.hex_distance(aq int, ar int, bq int, br int)
returns int language sql immutable as $$
  select (abs(aq - bq) + abs(aq + ar - bq - br) + abs(ar - br)) / 2;
$$;

create or replace function public.mission_for_terrain(t text)
returns text language sql immutable as $$
  select case t
    when 'ruins' then 'Retrieval / Relic Hunt'
    when 'manufactorum' then 'Sabotage / Control'
    when 'settlement' then 'Siege'
    when 'fortification' then 'Siege'
    when 'reliquary' then 'Narrative (GM defined)'
    when 'death_world' then 'Assassination / Survival'
    else 'Standard (GM pool)'
  end;
$$;

-- Is a hex inside the Sphere of Control of any force hostile to `rid`?
create or replace function public.in_enemy_soc(cid uuid, hq int, hr int, rid uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from hex_tile s
    where s.campaign_id = cid and s.soc_radius > 0
      and s.controlled_by is not null and s.controlled_by <> rid
      and public.hex_distance(s.q, s.r, hq, hr) <= s.soc_radius
  );
$$;

-- ============================================================ verify_battle v2
-- Deltas are recomputed HERE from campaign config — the client sends nothing
-- but the battle id, closing the inflated-XP hole.

drop function if exists public.verify_battle(uuid, jsonb);

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
      update unit set is_destroyed = true, updated_at = now() where id = bu.unit_id;
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

  select t.turn_number into tno from battle_order bo join campaign_turn t on t.id = bo.turn_id
    where bo.battle_id = bid limit 1;

  perform public.log_event(b.campaign_id, tno, 'battle_verified',
    (select r1.name from roster r1 where r1.id = b.attacker_roster_id) || ' vs ' ||
    (select r2.name from roster r2 where r2.id = b.defender_roster_id) || ' — ' ||
    coalesce(b.attacker_result, 'draw') || ' (attacker)',
    jsonb_build_object('battle_id', bid, 'units', to_jsonb(unit_summary)));

  return jsonb_build_object('units', to_jsonb(unit_summary));
end $$;

-- ============================================================ amend_battle
-- GM correction: deterministically reverse a verification. Verification math
-- is pure (config + battle rows), so the reversal recomputes and subtracts.
-- Territory/retreats from an already-completed turn are NOT rolled back —
-- amend before completing the turn, or fix the map by hand.

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
      update unit set is_destroyed = false, updated_at = now() where id = bu.unit_id;
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

-- ============================================================ lock_turn

create or replace function public.lock_turn(tid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t record; c record; occ record; h record; a record;
  movers uuid[]; holders uuid[]; paired uuid[] := '{}';
  att uuid; def uuid; att_roster uuid; def_roster uuid; def_marching boolean;
  is_siege boolean; n_orders int := 0; n_caps int := 0;
  summary text[] := '{}'; i int; j int;
begin
  select * into t from campaign_turn where id = tid;
  if not found then raise exception 'Turn not found.'; end if;
  if not public.is_gm(t.campaign_id) then raise exception 'GM only.'; end if;
  if t.status <> 'open' then raise exception 'Turn is not open.'; end if;
  select * into c from campaign where id = t.campaign_id;
  perform set_config('app.bypass_guard', '1', true);

  create temp table _intent on commit drop as
  select ar.id as army_id, ar.roster_id, ar.hex_id as from_hex,
         coalesce(mo.target_hex_id, ar.hex_id) as to_hex,
         (coalesce(mo.move_type, 'standard') = 'force_march') as marching,
         (mo.target_hex_id is not null and mo.target_hex_id <> ar.hex_id) as moved
  from army ar
  left join move_order mo on mo.army_id = ar.id and mo.turn_id = tid
  where ar.campaign_id = t.campaign_id and ar.status <> 'broken' and ar.hex_id is not null;

  for occ in select to_hex, count(*) as n from _intent group by to_hex loop
    select * into h from hex_tile where id = occ.to_hex;

    if occ.n = 1 then
      select * into a from _intent where to_hex = occ.to_hex;
      update army set hex_id = a.to_hex,
        status = case when a.marching then 'force_marching' else 'idle' end
      where id = a.army_id;

      if a.moved and not a.marching then
        if h.controlled_by is null then
          update hex_tile set controlled_by = a.roster_id where id = h.id;
          n_caps := n_caps + 1;
        elsif h.controlled_by <> a.roster_id then
          if public.in_enemy_soc(t.campaign_id, h.q, h.r, a.roster_id) then
            insert into battle_order (campaign_id, turn_id, hex_id, attacker_army_id,
              defender_army_id, conflict_type, suggested_mission_type, is_ambush)
            values (t.campaign_id, tid, h.id, a.army_id, null, 'invasion',
              public.mission_for_terrain(h.terrain_type), false);
            n_orders := n_orders + 1;
            summary := summary || (
              (select name from roster where id = a.roster_id) || ' invades ' ||
              coalesce(h.name, '(' || h.q || ',' || h.r || ')') || ' [SoC-defended ground]');
          else
            update hex_tile set controlled_by = a.roster_id where id = h.id;
            n_caps := n_caps + 1;
          end if;
        end if;
      end if;

    else
      select array_agg(army_id) filter (where moved),
             array_agg(army_id) filter (where not moved)
        into movers, holders
        from _intent where to_hex = occ.to_hex;
      paired := '{}';

      if holders is not null and movers is not null then
        def := holders[1];
        select roster_id into def_roster from _intent where army_id = def;
        select marching into def_marching from _intent where army_id = def;
        foreach att in array movers loop
          select roster_id into att_roster from _intent where army_id = att;
          if att_roster <> def_roster then
            is_siege := true;  -- defender held the ground
            insert into battle_order (campaign_id, turn_id, hex_id, attacker_army_id,
              defender_army_id, conflict_type, suggested_mission_type, is_ambush)
            values (t.campaign_id, tid, h.id, att, def,
              case when is_siege then 'siege' else 'invasion' end,
              public.mission_for_terrain(h.terrain_type), def_marching);
            n_orders := n_orders + 1;
            update army set hex_id = occ.to_hex, status = 'in_battle' where id in (att, def);
            paired := paired || att || def;
            summary := summary || (
              (select name from roster where id = att_roster) || ' assaults ' ||
              (select name from roster where id = def_roster) || ' at ' ||
              coalesce(h.name, '(' || h.q || ',' || h.r || ')') ||
              case when def_marching then ' [AMBUSH]' else '' end);
          end if;
        end loop;

      elsif movers is not null and array_length(movers, 1) >= 2 then
        -- meeting engagement: first hostile pair among the movers clash
        <<outer_loop>>
        for i in 1 .. array_length(movers, 1) - 1 loop
          for j in i + 1 .. array_length(movers, 1) loop
            select roster_id into att_roster from _intent where army_id = movers[i];
            select roster_id into def_roster from _intent where army_id = movers[j];
            if att_roster <> def_roster then
              select marching into def_marching from _intent where army_id = movers[j];
              insert into battle_order (campaign_id, turn_id, hex_id, attacker_army_id,
                defender_army_id, conflict_type, suggested_mission_type, is_ambush)
              values (t.campaign_id, tid, h.id, movers[i], movers[j],
                case when h.terrain_type = 'fortification' then 'siege' else 'invasion' end,
                public.mission_for_terrain(h.terrain_type), def_marching);
              n_orders := n_orders + 1;
              update army set hex_id = occ.to_hex, status = 'in_battle'
                where id in (movers[i], movers[j]);
              paired := paired || movers[i] || movers[j];
              summary := summary || (
                (select name from roster where id = att_roster) || ' clashes with ' ||
                (select name from roster where id = def_roster) || ' at ' ||
                coalesce(h.name, '(' || h.q || ',' || h.r || ')') || ' [meeting engagement]');
              exit outer_loop;
            end if;
          end loop;
        end loop;
      end if;

      -- unpaired armies in this hex move/hold normally
      for a in select * from _intent where to_hex = occ.to_hex and not (army_id = any(paired)) loop
        update army set hex_id = a.to_hex,
          status = case when a.marching then 'force_marching' else 'idle' end
        where id = a.army_id;
      end loop;
    end if;
  end loop;

  update campaign_turn set
    status = case when n_orders > 0 then 'resolving' else 'locked' end,
    locked_at = now()
  where id = tid;

  perform public.log_event(t.campaign_id, t.turn_number, 'turn_locked',
    'Turn ' || t.turn_number || ' locked — ' || n_orders || ' engagement(s), '
      || n_caps || ' unopposed capture(s).',
    jsonb_build_object('engagements', to_jsonb(summary)));

  return jsonb_build_object('engagements', n_orders, 'captures', n_caps,
    'summary', to_jsonb(summary));
end $$;

-- ============================================================ complete_turn

create or replace function public.complete_turn(tid uuid, p_void_pending boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t record; c record; bo record; b record; a record; h record; cond jsonb;
  n_pending int; winner_army uuid; loser_army uuid; loser record;
  target_id uuid; target_q int; target_r int; step_id uuid; held jsonb; cnt int;
  vp jsonb := '{}'; income jsonb := '{}'; winners jsonb := '[]';
  r record; owned int; total int; top record;
begin
  select * into t from campaign_turn where id = tid;
  if not found then raise exception 'Turn not found.'; end if;
  if not public.is_gm(t.campaign_id) then raise exception 'GM only.'; end if;
  if t.status not in ('locked', 'resolving') then raise exception 'Turn is not locked.'; end if;
  select * into c from campaign where id = t.campaign_id;
  perform set_config('app.bypass_guard', '1', true);

  -- 0. unresolved engagements void (with explicit consent), armies stand down
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

  -- 1. verified battles: territory to the winner, loser retreats
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

  -- 2. SoC hold counters and contested flips
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

  -- 3. manufactorum income
  for r in
    select ht.controlled_by as rid, count(*) as n from hex_tile ht
    where ht.campaign_id = t.campaign_id and ht.terrain_type = 'manufactorum'
      and ht.controlled_by is not null
    group by ht.controlled_by
  loop
    update roster set requisition_points = requisition_points + r.n where id = r.rid;
    income := income || jsonb_build_object(r.rid::text, r.n);
  end loop;

  -- 4. VP tally
  for r in select rs.id from roster rs where rs.campaign_id = t.campaign_id loop
    vp := vp || jsonb_build_object(r.id::text, coalesce((
      select sum(strategic_value) from hex_tile
      where campaign_id = t.campaign_id and controlled_by = r.id), 0));
  end loop;

  -- 5. victory conditions
  select count(*) into total from hex_tile where campaign_id = t.campaign_id;
  for cond in select * from jsonb_array_elements(coalesce(c.victory_conditions, '[]'::jsonb)) loop
    if cond ->> 'type' = 'domination' then
      for r in select rs.id, rs.name from roster rs where rs.campaign_id = t.campaign_id loop
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
      for r in select rs.id, rs.name from roster rs where rs.campaign_id = t.campaign_id loop
        if (vp ->> r.id::text)::int >= (cond ->> 'vp_target')::int then
          winners := winners || jsonb_build_object('roster_id', r.id, 'name', r.name,
            'condition', 'Reached ' || (cond ->> 'vp_target') || ' VP');
        end if;
      end loop;
    elsif cond ->> 'type' = 'vp_at_time' then
      if t.turn_number >= (cond ->> 'turn_limit')::int then
        select rs.id, rs.name into top from roster rs
          where rs.campaign_id = t.campaign_id
          order by (vp ->> rs.id::text)::int desc limit 1;
        if found then
          winners := winners || jsonb_build_object('roster_id', top.id, 'name', top.name,
            'condition', 'Highest VP at turn ' || (cond ->> 'turn_limit'));
        end if;
      end if;
    end if;
  end loop;

  -- 6. close turn; open the next or end the campaign
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
