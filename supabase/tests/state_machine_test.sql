set client_min_messages = notice;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'gm@test'),
  ('00000000-0000-0000-0000-0000000000b1', 'p1@test'),
  ('00000000-0000-0000-0000-0000000000b2', 'p2@test');

select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
insert into campaign (id, name, created_by, status)
  values ('00000000-0000-0000-0000-00000000c000', 'Test Crusade', '00000000-0000-0000-0000-0000000000a1', 'active');

do $$ begin
  if not exists (select 1 from campaign_player
    where campaign_id = '00000000-0000-0000-0000-00000000c000'
      and user_id = '00000000-0000-0000-0000-0000000000a1' and role = 'gm')
  then raise exception 'TEST FAIL: creator-GM trigger'; end if;
  raise notice 'PASS: creator becomes GM via trigger';
end $$;

insert into campaign_player (campaign_id, user_id) values
  ('00000000-0000-0000-0000-00000000c000', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-00000000c000', '00000000-0000-0000-0000-0000000000b2');

insert into roster (id, campaign_id, player_id, name, requisition_points, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c000', '00000000-0000-0000-0000-0000000000b1', 'Cadian 8th', 5, 'approved'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c000', '00000000-0000-0000-0000-0000000000b2', 'Ork Waaagh', 5, 'approved');

insert into unit (id, roster_id, name, points) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000d001', 'Leman Russ', 170),
  ('00000000-0000-0000-0000-00000000e011', '00000000-0000-0000-0000-00000000d002', 'Boyz Mob', 90);

insert into hex_tile (id, campaign_id, q, r, terrain_type, controlled_by, soc_radius, strategic_value) values
  ('00000000-0000-0000-0000-00000000f000', '00000000-0000-0000-0000-00000000c000', 0, 0, 'settlement',   '00000000-0000-0000-0000-00000000d001', 1, 3),
  ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000c000', 1, 0, 'wasteland',    '00000000-0000-0000-0000-00000000d001', 0, 0),
  ('00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-00000000c000', 2, 0, 'wasteland',    null, 0, 0),
  ('00000000-0000-0000-0000-00000000f003', '00000000-0000-0000-0000-00000000c000', 3, 0, 'manufactorum', '00000000-0000-0000-0000-00000000d002', 0, 1);

insert into army (id, campaign_id, roster_id, hex_id) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000c000', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000f000'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-00000000c000', '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000f002');

insert into campaign_turn (id, campaign_id, turn_number, status)
  values ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-00000000c000', 1, 'open');

insert into move_order (turn_id, army_id, target_hex_id, move_type) values
  ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-00000000f001', 'standard');

select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
select lock_turn('00000000-0000-0000-0000-000000000111');

do $$
declare n int; ts text;
begin
  select count(*) into n from battle_order where turn_id = '00000000-0000-0000-0000-000000000111' and status = 'pending';
  if n <> 1 then raise exception 'TEST FAIL: expected 1 battle order, got %', n; end if;
  select status into ts from campaign_turn where id = '00000000-0000-0000-0000-000000000111';
  if ts <> 'resolving' then raise exception 'TEST FAIL: turn status % (want resolving)', ts; end if;
  if (select controlled_by from hex_tile where id = '00000000-0000-0000-0000-00000000f001')
     <> '00000000-0000-0000-0000-00000000d001' then
    raise exception 'TEST FAIL: SoC hex must NOT flip on lock'; end if;
  raise notice 'PASS: lock_turn -> 1 invasion, turn resolving, no illegal capture';
end $$;

do $$ begin
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000b2', true);
  begin
    perform lock_turn('00000000-0000-0000-0000-000000000111');
    raise exception 'TEST FAIL: non-GM locked a turn';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    raise notice 'PASS: non-GM lock rejected';
  end;
end $$;

select set_config('test.uid', '00000000-0000-0000-0000-0000000000b2', false);
do $$
declare oid uuid; bid uuid; def uuid;
begin
  select id into oid from battle_order where turn_id = '00000000-0000-0000-0000-000000000111';
  bid := file_battle_for_order(oid);
  select defender_roster_id into def from battle where id = bid;
  if def <> '00000000-0000-0000-0000-00000000d001' then
    raise exception 'TEST FAIL: SoC defender should be hex controller'; end if;
  if (select battle_id from battle_order where id = oid) <> bid then
    raise exception 'TEST FAIL: order not linked to battle'; end if;
  if file_battle_for_order(oid) <> bid then
    raise exception 'TEST FAIL: refiling created a duplicate'; end if;
  raise notice 'PASS: file_battle_for_order links, SoC defender, idempotent';
end $$;

update battle set attacker_result = 'victory', agenda_attacker_achieved = true,
  status = 'pending_verification'
  where campaign_id = '00000000-0000-0000-0000-00000000c000';
insert into battle_unit (battle_id, unit_id, side, marked_for_greatness, destroyed_in_battle)
select b.id, '00000000-0000-0000-0000-00000000e011', 'attacker', true, false from battle b limit 1;
insert into battle_unit (battle_id, unit_id, side, marked_for_greatness, destroyed_in_battle)
select b.id, '00000000-0000-0000-0000-00000000e001', 'defender', false, true from battle b limit 1;

do $$ begin
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000b2', true);
  begin
    update roster set requisition_points = 999 where id = '00000000-0000-0000-0000-00000000d002';
    raise exception 'TEST FAIL: player self-awarded RP';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    raise notice 'PASS: RP guard blocked player';
  end;
  begin
    update unit set xp_total = 99 where id = '00000000-0000-0000-0000-00000000e011';
    raise exception 'TEST FAIL: player self-awarded XP';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    raise notice 'PASS: XP guard blocked player';
  end;
end $$;

select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
update unit set xp_total = 1 where id = '00000000-0000-0000-0000-00000000e001';
update unit set xp_total = 0 where id = '00000000-0000-0000-0000-00000000e001';

do $$
declare bid uuid;
begin
  select id into bid from battle limit 1;
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000b2', true);
  begin
    perform verify_battle(bid);
    raise exception 'TEST FAIL: reporter verified own battle';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    raise notice 'PASS: reporter verification rejected';
  end;
end $$;

select set_config('test.uid', '00000000-0000-0000-0000-0000000000b1', false);
do $$
declare bid uuid; v int;
begin
  select id into bid from battle limit 1;
  perform verify_battle(bid);
  select xp_total into v from unit where id = '00000000-0000-0000-0000-00000000e011';
  if v <> 5 then raise exception 'TEST FAIL: attacker XP % (want 5)', v; end if;
  select xp_total into v from unit where id = '00000000-0000-0000-0000-00000000e001';
  if v <> 1 then raise exception 'TEST FAIL: defender XP % (want 1)', v; end if;
  if not (select is_destroyed from unit where id = '00000000-0000-0000-0000-00000000e001') then
    raise exception 'TEST FAIL: destroyed flag not applied'; end if;
  select requisition_points into v from roster where id = '00000000-0000-0000-0000-00000000d002';
  if v <> 7 then raise exception 'TEST FAIL: winner RP % (want 7)', v; end if;
  select requisition_points into v from roster where id = '00000000-0000-0000-0000-00000000d001';
  if v <> 6 then raise exception 'TEST FAIL: loser RP % (want 6)', v; end if;
  if (select status from battle_order limit 1) <> 'completed' then
    raise exception 'TEST FAIL: order not completed on verify'; end if;
  raise notice 'PASS: verify_battle server deltas (XP 5/1, RP 7/6), order completed';
end $$;

select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
do $$
declare bid uuid; v int;
begin
  select id into bid from battle limit 1;
  perform amend_battle(bid);
  select xp_total into v from unit where id = '00000000-0000-0000-0000-00000000e011';
  if v <> 0 then raise exception 'TEST FAIL: amend XP % (want 0)', v; end if;
  select requisition_points into v from roster where id = '00000000-0000-0000-0000-00000000d002';
  if v <> 5 then raise exception 'TEST FAIL: amend RP % (want 5)', v; end if;
  if (select is_destroyed from unit where id = '00000000-0000-0000-0000-00000000e001') then
    raise exception 'TEST FAIL: amend did not resurrect unit'; end if;
  if (select status from battle limit 1) <> 'pending_verification' then
    raise exception 'TEST FAIL: amend battle status'; end if;
  raise notice 'PASS: amend_battle exact reversal';
end $$;

select set_config('test.uid', '00000000-0000-0000-0000-0000000000b1', false);
do $$ declare bid uuid; begin
  select id into bid from battle limit 1;
  perform verify_battle(bid);
end $$;

select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
select complete_turn('00000000-0000-0000-0000-000000000111');
do $$
declare v int; ctl uuid;
begin
  select controlled_by into ctl from hex_tile where id = '00000000-0000-0000-0000-00000000f001';
  if ctl <> '00000000-0000-0000-0000-00000000d002' then
    raise exception 'TEST FAIL: winner did not take the hex'; end if;
  if (select hex_id from army where id = '00000000-0000-0000-0000-0000000000d2')
     <> '00000000-0000-0000-0000-00000000f001' then
    raise exception 'TEST FAIL: winner army not moved onto won hex'; end if;
  select requisition_points into v from roster where id = '00000000-0000-0000-0000-00000000d002';
  if v <> 8 then raise exception 'TEST FAIL: income RP % (want 8)', v; end if;
  select count(*) into v from campaign_turn where campaign_id = '00000000-0000-0000-0000-00000000c000' and turn_number = 2 and status = 'open';
  if v <> 1 then raise exception 'TEST FAIL: next turn not opened'; end if;
  raise notice 'PASS: complete_turn - territory, income, turn 2 open';
end $$;

do $$
declare t2 uuid; n int;
begin
  select id into t2 from campaign_turn where turn_number = 2
    and campaign_id = '00000000-0000-0000-0000-00000000c000';
  insert into move_order (turn_id, army_id, target_hex_id) values
    (t2, '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000f002'),
    (t2, '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-00000000f002');
  perform lock_turn(t2);
  select count(*) into n from battle_order where turn_id = t2 and status = 'pending';
  if n <> 1 then raise exception 'TEST FAIL: meeting engagement not generated (%)', n; end if;
  begin
    perform complete_turn(t2);
    raise exception 'TEST FAIL: completed with pending engagements, no consent';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like 'PENDING_ENGAGEMENTS%' then
      raise exception 'TEST FAIL: wrong error: %', sqlerrm; end if;
    raise notice 'PASS: complete without consent raises PENDING_ENGAGEMENTS';
  end;
  perform complete_turn(t2, true);
  select count(*) into n from battle_order where turn_id = t2 and status = 'void';
  if n <> 1 then raise exception 'TEST FAIL: engagement not voided'; end if;
  if exists (select 1 from army where campaign_id = '00000000-0000-0000-0000-00000000c000' and status = 'in_battle') then
    raise exception 'TEST FAIL: armies stuck in_battle after void'; end if;
  raise notice 'PASS: void-with-consent, armies stood down';
end $$;

do $$
declare n int;
begin
  select count(*) into n from campaign_event where campaign_id = '00000000-0000-0000-0000-00000000c000';
  if n < 5 then raise exception 'TEST FAIL: only % events logged', n; end if;
  raise notice 'PASS: chronicle has % events', n;
end $$;

select 'ALL TESTS PASSED' as result;
