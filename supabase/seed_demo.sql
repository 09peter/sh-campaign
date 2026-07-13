-- Demo campaign seed for integration testing. Run in the Supabase SQL editor
-- AFTER creating three accounts through the app (one GM, two players).
-- 1. Look up their ids:   select id, email from auth.users;
-- 2. Replace the three UUIDs below.
-- 3. Run. You get an active campaign, two approved rosters with units,
--    a radius-3 map, deployed armies, and turn 1 open — ready to play a
--    full lock → file → verify → complete cycle in ~10 minutes.

do $$
declare
  gm_id uuid := 'REPLACE-WITH-GM-USER-ID';
  p1_id uuid := 'REPLACE-WITH-PLAYER1-ID';
  p2_id uuid := 'REPLACE-WITH-PLAYER2-ID';
  cid uuid; r1 uuid; r2 uuid; a1h uuid; a2h uuid; qq int; rr int;
begin
  insert into campaign (name, description, created_by, status, max_players)
  values ('Demo: The Vogelsang Incursion', 'Integration test campaign — safe to delete.', gm_id, 'active', 4)
  returning id into cid;
  -- creator-GM trigger has fired; add the players
  insert into campaign_player (campaign_id, user_id) values (cid, p1_id), (cid, p2_id);

  insert into roster (campaign_id, player_id, name, faction, status)
    values (cid, p1_id, 'Cadian 8th', 'Astra Militarum', 'approved') returning id into r1;
  insert into roster (campaign_id, player_id, name, faction, status)
    values (cid, p2_id, 'Waaagh Gitsnik', 'Orks', 'approved') returning id into r2;

  insert into unit (roster_id, name, battlefield_role, points) values
    (r1, 'Leman Russ Battle Tank', 'Heavy Support', 170),
    (r1, 'Cadian Shock Troops', 'Battleline', 65),
    (r1, 'Tank Commander Varik Hesk', 'Character', 200),
    (r2, 'Boyz Mob', 'Battleline', 90),
    (r2, 'Warboss Gitsnik', 'Character', 95),
    (r2, 'Deff Dread', 'Heavy Support', 130);

  -- radius-3 hex map, wasteland with a few landmarks
  for qq in -3..3 loop
    for rr in greatest(-3, -qq-3)..least(3, -qq+3) loop
      insert into hex_tile (campaign_id, q, r, terrain_type, strategic_value, soc_radius)
      values (cid, qq, rr,
        case when (qq, rr) = (0, 0) then 'settlement'
             when (qq, rr) = (2, -1) then 'manufactorum'
             when (qq, rr) = (-2, 1) then 'manufactorum'
             when (qq, rr) = (0, -2) then 'fortification'
             when (qq, rr) = (0, 2) then 'ruins'
             else 'wasteland' end,
        case when (qq, rr) = (0, 0) then 3
             when (qq, rr) = (0, -2) then 2
             when (qq, rr) = (2, -1) or (qq, rr) = (-2, 1) then 1 else 0 end,
        case when (qq, rr) = (0, 0) or (qq, rr) = (0, -2) then 1 else 0 end);
    end loop;
  end loop;

  select id into a1h from hex_tile where campaign_id = cid and q = -3 and r = 0;
  select id into a2h from hex_tile where campaign_id = cid and q = 3 and r = 0;
  update hex_tile set controlled_by = r1 where id = a1h;
  update hex_tile set controlled_by = r2 where id = a2h;
  insert into army (campaign_id, roster_id, hex_id) values (cid, r1, a1h), (cid, r2, a2h);

  insert into campaign_turn (campaign_id, turn_number, status) values (cid, 1, 'open');

  raise notice 'Demo campaign ready: %', cid;
end $$;
