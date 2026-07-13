-- v2.0–v2.2 tests. Run after state_machine_test.sql on the same scratch DB
-- (reuses its fixtures: campaign c000, rosters d001/d002, GM a1, players b1/b2).
set client_min_messages = notice;

-- ============ 2.8 evacuation
select set_config('test.uid', '00000000-0000-0000-0000-0000000000b2', false);
do $$ begin
  begin
    perform evacuate_roster('00000000-0000-0000-0000-00000000d001');
    raise exception 'TEST FAIL: player evacuated a roster';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    raise notice 'PASS: non-GM evacuation rejected';
  end;
end $$;

select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
do $$
declare n int;
begin
  perform evacuate_roster('00000000-0000-0000-0000-00000000d001');
  select count(*) into n from hex_tile
    where campaign_id = '00000000-0000-0000-0000-00000000c000'
      and controlled_by = '00000000-0000-0000-0000-00000000d001';
  if n <> 0 then raise exception 'TEST FAIL: territory not evacuated (%)', n; end if;
  select count(*) into n from army where roster_id = '00000000-0000-0000-0000-00000000d001'
    and (hex_id is not null or status <> 'broken');
  if n <> 0 then raise exception 'TEST FAIL: army not taken off-map'; end if;
  if (select status from roster where id = '00000000-0000-0000-0000-00000000d001') <> 'departed' then
    raise exception 'TEST FAIL: roster not departed'; end if;
  -- history preserved
  select count(*) into n from battle where attacker_roster_id = '00000000-0000-0000-0000-00000000d001'
    or defender_roster_id = '00000000-0000-0000-0000-00000000d001';
  if n < 1 then raise exception 'TEST FAIL: battle history lost'; end if;
  raise notice 'PASS: evacuation — territory unclaimed, army off-map, history kept';
end $$;

-- ============ 2.4 templates
do $$
declare tid uuid; cid2 uuid; n int;
begin
  update campaign set attrition_enabled = true, recovery_turns = 2
    where id = '00000000-0000-0000-0000-00000000c000';
  tid := save_template('00000000-0000-0000-0000-00000000c000', 'Test Template', 'desc', true);
  cid2 := instantiate_template(tid, 'Cloned Campaign');
  if (select attrition_enabled from campaign where id = cid2) is not true then
    raise exception 'TEST FAIL: template config not applied'; end if;
  if (select recovery_turns from campaign where id = cid2) <> 2 then
    raise exception 'TEST FAIL: template recovery_turns'; end if;
  select count(*) into n from hex_tile where campaign_id = cid2;
  if n <> 4 then raise exception 'TEST FAIL: template map hexes % (want 4)', n; end if;
  if not exists (select 1 from campaign_player where campaign_id = cid2
      and user_id = '00000000-0000-0000-0000-0000000000a1' and role = 'gm') then
    raise exception 'TEST FAIL: instantiator not GM'; end if;
  if (select status from campaign where id = cid2) <> 'draft' then
    raise exception 'TEST FAIL: clone not draft'; end if;
  raise notice 'PASS: template save + instantiate (config, map, GM, draft)';
end $$;

-- ============ 2.2 attrition
-- New battle in campaign c000 (attrition now on, recovery_turns=2, current
-- open turn is 3 from the earlier suite). Ork Boyz destroyed this time.
do $$
declare bid uuid; t3 uuid; rec int;
begin
  select id into t3 from campaign_turn
    where campaign_id = '00000000-0000-0000-0000-00000000c000' and turn_number = 3;
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000b2', true);
  insert into battle (campaign_id, attacker_roster_id, defender_roster_id, created_by,
    attacker_result, status)
  values ('00000000-0000-0000-0000-00000000c000',
    '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000d001',
    '00000000-0000-0000-0000-0000000000b2', 'defeat', 'pending_verification')
  returning id into bid;
  insert into battle_unit (battle_id, unit_id, side, destroyed_in_battle)
  values (bid, '00000000-0000-0000-0000-00000000e011', 'attacker', true);

  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000b1', true);
  perform verify_battle(bid);

  select recovering_until_turn into rec from unit where id = '00000000-0000-0000-0000-00000000e011';
  if rec <> 5 then raise exception 'TEST FAIL: recovery until % (want 3+2=5)', rec; end if;
  if (select is_destroyed from unit where id = '00000000-0000-0000-0000-00000000e011') then
    raise exception 'TEST FAIL: attrition should use recovery, not destruction'; end if;
  raise notice 'PASS: attrition — destroyed unit enters recovery until turn 5';

  -- amend clears recovery
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', true);
  perform amend_battle(bid);
  if (select recovering_until_turn from unit where id = '00000000-0000-0000-0000-00000000e011') is not null then
    raise exception 'TEST FAIL: amend did not clear recovery'; end if;
  raise notice 'PASS: amend clears recovery state';

  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000b1', true);
  perform verify_battle(bid);
end $$;

-- ============ 2.2 broken income penalty
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
do $$
declare t3 uuid; rp_before int; rp_after int;
begin
  -- p2 controls the manufactorum (f003) but break their army first
  update army set status = 'broken', hex_id = null
    where roster_id = '00000000-0000-0000-0000-00000000d002';
  select requisition_points into rp_before from roster where id = '00000000-0000-0000-0000-00000000d002';
  select id into t3 from campaign_turn
    where campaign_id = '00000000-0000-0000-0000-00000000c000' and turn_number = 3;
  perform lock_turn(t3);
  perform complete_turn(t3, true);
  select requisition_points into rp_after from roster where id = '00000000-0000-0000-0000-00000000d002';
  if rp_after <> rp_before then
    raise exception 'TEST FAIL: broken roster drew income (% -> %)', rp_before, rp_after; end if;
  if not exists (select 1 from campaign_event
      where campaign_id = '00000000-0000-0000-0000-00000000c000' and event_type = 'income_withheld') then
    raise exception 'TEST FAIL: income_withheld not logged'; end if;
  raise notice 'PASS: broken-roster income penalty applied and logged';
end $$;

-- departed roster excluded from VP
do $$
declare pl jsonb;
begin
  select payload -> 'vp' into pl from campaign_event
    where campaign_id = '00000000-0000-0000-0000-00000000c000' and event_type = 'turn_completed'
    order by created_at desc limit 1;
  if pl ? '00000000-0000-0000-0000-00000000d001' then
    raise exception 'TEST FAIL: departed roster still in VP tally'; end if;
  raise notice 'PASS: departed roster excluded from VP tally';
end $$;

select 'V2 TESTS PASSED' as result;
