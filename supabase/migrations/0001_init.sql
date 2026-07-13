-- Sledgehammer Crusade Manager — initial schema
-- Apply with: supabase db push  (or paste into the SQL editor)

-- ============================================================ profiles

create table public.profile (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default 'Unnamed Guardsman',
  avatar_url text,
  discord_handle text,
  role text not null default 'player' check (role in ('admin','player')),
  created_at timestamptz not null default now()
);

-- auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profile (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================ campaigns

create table public.campaign (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  ruleset_label text default '10th Edition',
  status text not null default 'draft'
    check (status in ('draft','mustering','active','completed','archived')),
  max_players int not null default 8,
  supply_limit_base int not null default 1000,
  requisition_points_start int not null default 5,
  -- XP/RP rules — configurable, never hardcode in app logic
  xp_per_battle int not null default 1,
  xp_agenda_achieved int not null default 1,
  xp_marked_for_greatness int not null default 3,
  xp_battle_honour_bonus int not null default 0,
  rp_per_battle int not null default 1,
  rp_for_victory int not null default 1,
  force_march_max int not null default 2,
  soc_hold_turns int not null default 2,
  unique_honours text[] not null default '{}',
  mission_pool text[] not null default '{}',
  victory_conditions jsonb not null default '[]',
  -- Discord webhooks (optional)
  webhook_battle_reported text,
  webhook_battle_verified text,
  webhook_turn_advanced text,
  webhook_dispute_raised text,
  webhook_roster_approved text,
  webhook_campaign_completed text,
  epilogue text,
  created_by uuid references auth.users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.campaign_player (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaign on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'player' check (role in ('gm','player')),
  joined_at timestamptz not null default now(),
  unique (campaign_id, user_id)
);

-- The campaign founder becomes its first GM automatically. This runs as a
-- SECURITY DEFINER trigger so it works under the GM-only insert policy on
-- campaign_player (no GM exists yet at creation time).
create or replace function public.handle_new_campaign()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.campaign_player (campaign_id, user_id, role)
  values (new.id, new.created_by, 'gm');
  return new;
end $$;

create trigger on_campaign_created
  after insert on public.campaign
  for each row execute procedure public.handle_new_campaign();

create table public.campaign_invite (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaign on delete cascade,
  code text not null unique,
  expires_at timestamptz not null default now() + interval '7 days',
  revoked boolean not null default false,
  created_by uuid references auth.users,
  created_at timestamptz not null default now()
);

-- ============================================================ helper fns (avoid RLS recursion)

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profile where id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_member(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from campaign_player where campaign_id = cid and user_id = auth.uid())
         or public.is_admin();
$$;

create or replace function public.is_gm(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from campaign_player
                 where campaign_id = cid and user_id = auth.uid() and role = 'gm')
         or public.is_admin();
$$;

-- ============================================================ rosters & units

create table public.roster (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaign on delete cascade,
  player_id uuid not null references auth.users,
  name text not null default 'Unnamed Force',
  faction text,
  supply_limit int not null default 1000,
  requisition_points int not null default 5,
  status text not null default 'pending_approval'
    check (status in ('pending_approval','approved','suspended')),
  import_raw text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, player_id)
);

create table public.unit (
  id uuid primary key default gen_random_uuid(),
  roster_id uuid not null references public.roster on delete cascade,
  name text not null,
  unit_type text,
  battlefield_role text,
  keywords text[] not null default '{}',
  points int not null default 0,
  power_level int,
  model_count int,
  wargear_notes text,
  raw_notes text,               -- unparsed import lines, never silently dropped
  xp_total int not null default 0,
  crusade_points int not null default 0,
  battle_honours jsonb not null default '[]',
  battle_scars jsonb not null default '[]',
  has_relic boolean not null default false,
  relic_name text,
  is_destroyed boolean not null default false,
  is_in_reserve boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================ hex map

create table public.hex_tile (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaign on delete cascade,
  q int not null,
  r int not null,
  terrain_type text not null default 'wasteland'
    check (terrain_type in ('wasteland','ruins','manufactorum','settlement','fortification','reliquary','death_world')),
  name text,
  flavour_text text,
  strategic_value int not null default 0,
  controlled_by uuid references public.roster on delete set null,
  soc_radius int not null default 0,
  notes text,
  unique (campaign_id, q, r)
);

create table public.army (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaign on delete cascade,
  roster_id uuid not null references public.roster on delete cascade,
  hex_id uuid references public.hex_tile on delete set null,
  status text not null default 'idle'
    check (status in ('idle','force_marching','in_battle','retreating','broken')),
  consecutive_turns_held jsonb not null default '{}',
  unique (campaign_id, roster_id)
);

create table public.campaign_turn (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaign on delete cascade,
  turn_number int not null,
  status text not null default 'open' check (status in ('open','locked','resolving','complete')),
  opened_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  unique (campaign_id, turn_number)
);

create table public.move_order (
  id uuid primary key default gen_random_uuid(),
  turn_id uuid not null references public.campaign_turn on delete cascade,
  army_id uuid not null references public.army on delete cascade,
  target_hex_id uuid not null references public.hex_tile,
  move_type text not null default 'standard' check (move_type in ('standard','force_march')),
  submitted_at timestamptz not null default now(),
  unique (turn_id, army_id)
);

create table public.battle_order (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaign on delete cascade,
  turn_id uuid not null references public.campaign_turn on delete cascade,
  hex_id uuid not null references public.hex_tile,
  attacker_army_id uuid not null references public.army,
  defender_army_id uuid references public.army,
  conflict_type text not null check (conflict_type in ('invasion','siege')),
  suggested_mission_type text,
  is_ambush boolean not null default false,   -- defender was force marching
  status text not null default 'pending' check (status in ('pending','completed','void')),
  battle_id uuid
);

-- ============================================================ battles

create table public.battle (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaign on delete cascade,
  attacker_roster_id uuid not null references public.roster,
  defender_roster_id uuid not null references public.roster,
  created_by uuid references auth.users,
  mission text,
  mission_type text,
  battle_size text check (battle_size in ('combat_patrol','incursion','strike_force','onslaught')),
  agenda_attacker text,
  agenda_defender text,
  agenda_attacker_achieved boolean not null default false,
  agenda_defender_achieved boolean not null default false,
  attacker_result text check (attacker_result in ('victory','defeat','draw')),
  is_crushing_defeat boolean not null default false,
  hex_id uuid references public.hex_tile,
  battle_order_id uuid references public.battle_order,
  narrative_notes text,
  status text not null default 'draft'
    check (status in ('draft','pending_verification','verified','disputed','void')),
  verified_by uuid references auth.users,
  verified_at timestamptz,
  dispute_reason text,
  played_at date default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.battle_order
  add constraint battle_order_battle_fk foreign key (battle_id) references public.battle;

create table public.battle_unit (
  id uuid primary key default gen_random_uuid(),
  battle_id uuid not null references public.battle on delete cascade,
  unit_id uuid not null references public.unit on delete cascade,
  side text not null check (side in ('attacker','defender')),
  marked_for_greatness boolean not null default false,
  destroyed_in_battle boolean not null default false,
  unique (battle_id, unit_id)
);

-- one Marked for Greatness per side per battle
create unique index battle_unit_mfg_one_per_side
  on public.battle_unit (battle_id, side) where marked_for_greatness;

-- ============================================================ RPCs

-- Join a campaign via invite code
create or replace function public.join_campaign(invite_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv record; cnt int; cid uuid;
begin
  select * into inv from campaign_invite
    where code = upper(invite_code) and not revoked and expires_at > now();
  if not found then raise exception 'Invite code is invalid or expired.'; end if;
  cid := inv.campaign_id;
  select count(*) into cnt from campaign_player where campaign_id = cid;
  if cnt >= (select max_players from campaign where id = cid) then
    raise exception 'Campaign is full.';
  end if;
  insert into campaign_player (campaign_id, user_id, role)
    values (cid, auth.uid(), 'player')
    on conflict (campaign_id, user_id) do nothing;
  return cid;
end $$;

-- Verify a battle and apply XP/RP deltas computed by the client XP engine.
-- deltas: { units: [{unit_id, xp}], rosters: [{roster_id, rp}] }
-- Only the non-reporting participant, a GM, or an admin may verify.
create or replace function public.verify_battle(bid uuid, deltas jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare b record; caller uuid := auth.uid(); is_opponent boolean; u jsonb; r jsonb;
begin
  select * into b from battle where id = bid;
  if not found then raise exception 'Battle not found.'; end if;
  if b.status <> 'pending_verification' then
    raise exception 'Battle is not awaiting verification.';
  end if;
  select exists (
    select 1 from roster
    where id in (b.attacker_roster_id, b.defender_roster_id)
      and player_id = caller
  ) and caller <> b.created_by into is_opponent;
  if not (is_opponent or public.is_gm(b.campaign_id)) then
    raise exception 'Only the opponent or the GM can verify this battle.';
  end if;

  for u in select * from jsonb_array_elements(deltas->'units') loop
    update unit set
      xp_total = xp_total + (u->>'xp')::int,
      updated_at = now()
    where id = (u->>'unit_id')::uuid;
  end loop;

  for r in select * from jsonb_array_elements(deltas->'rosters') loop
    update roster set
      requisition_points = requisition_points + (r->>'rp')::int,
      updated_at = now()
    where id = (r->>'roster_id')::uuid;
  end loop;

  update battle set status = 'verified', verified_by = caller, verified_at = now(), updated_at = now()
    where id = bid;
  update battle_order set status = 'completed' where battle_id = bid;
end $$;

-- ============================================================ RLS

alter table public.profile enable row level security;
alter table public.campaign enable row level security;
alter table public.campaign_player enable row level security;
alter table public.campaign_invite enable row level security;
alter table public.roster enable row level security;
alter table public.unit enable row level security;
alter table public.hex_tile enable row level security;
alter table public.army enable row level security;
alter table public.campaign_turn enable row level security;
alter table public.move_order enable row level security;
alter table public.battle_order enable row level security;
alter table public.battle enable row level security;
alter table public.battle_unit enable row level security;

-- profile
create policy profile_select on public.profile for select using (true);
create policy profile_update on public.profile for update using (id = auth.uid() or public.is_admin());

-- campaign
create policy campaign_select on public.campaign for select
  using (public.is_member(id) or status = 'completed');
create policy campaign_insert on public.campaign for insert
  with check (auth.uid() is not null and created_by = auth.uid());
create policy campaign_update on public.campaign for update using (public.is_gm(id));
create policy campaign_delete on public.campaign for delete using (public.is_admin());

-- campaign_player
create policy cp_select on public.campaign_player for select using (public.is_member(campaign_id));
-- INSERT is GM-only. Player self-joins happen exclusively through the
-- join_campaign() RPC, which is SECURITY DEFINER and bypasses RLS after
-- validating the invite code. A direct self-insert clause here would let
-- any authenticated user add themselves to any campaign without an invite.
create policy cp_insert on public.campaign_player for insert
  with check (public.is_gm(campaign_id));
create policy cp_update on public.campaign_player for update using (public.is_gm(campaign_id));
create policy cp_delete on public.campaign_player for delete using (public.is_admin());

-- campaign_invite
create policy ci_select on public.campaign_invite for select using (public.is_gm(campaign_id));
create policy ci_all on public.campaign_invite for all using (public.is_gm(campaign_id));

-- roster
create policy roster_select on public.roster for select
  using (public.is_member(campaign_id)
         or exists (select 1 from campaign c where c.id = campaign_id and c.status = 'completed'));
create policy roster_insert on public.roster for insert
  with check (player_id = auth.uid() and public.is_member(campaign_id));
create policy roster_update on public.roster for update
  using (player_id = auth.uid() or public.is_gm(campaign_id));
create policy roster_delete on public.roster for delete using (public.is_gm(campaign_id));

-- unit (ownership via roster)
create policy unit_select on public.unit for select
  using (exists (select 1 from roster r where r.id = roster_id
                 and (public.is_member(r.campaign_id)
                      or exists (select 1 from campaign c where c.id = r.campaign_id and c.status = 'completed'))));
create policy unit_write on public.unit for insert
  with check (exists (select 1 from roster r where r.id = roster_id
                      and (r.player_id = auth.uid() or public.is_gm(r.campaign_id))));
create policy unit_update on public.unit for update
  using (exists (select 1 from roster r where r.id = roster_id
                 and (r.player_id = auth.uid() or public.is_gm(r.campaign_id))));
create policy unit_delete on public.unit for delete
  using (exists (select 1 from roster r where r.id = roster_id and public.is_gm(r.campaign_id)));

-- hex_tile
create policy hex_select on public.hex_tile for select using (public.is_member(campaign_id));
create policy hex_write on public.hex_tile for all using (public.is_gm(campaign_id))
  with check (public.is_gm(campaign_id));

-- army
create policy army_select on public.army for select using (public.is_member(campaign_id));
create policy army_write on public.army for all using (public.is_gm(campaign_id))
  with check (public.is_gm(campaign_id));

-- campaign_turn
create policy turn_select on public.campaign_turn for select using (public.is_member(campaign_id));
create policy turn_write on public.campaign_turn for all using (public.is_gm(campaign_id))
  with check (public.is_gm(campaign_id));

-- move_order: owning player may submit while turn open; GM anything
create policy mo_select on public.move_order for select
  using (exists (select 1 from campaign_turn t where t.id = turn_id and public.is_member(t.campaign_id)));
create policy mo_insert on public.move_order for insert
  with check (
    exists (select 1 from army a join roster r on r.id = a.roster_id
            where a.id = army_id and (r.player_id = auth.uid() or public.is_gm(a.campaign_id)))
    and exists (select 1 from campaign_turn t where t.id = turn_id and t.status = 'open')
  );
create policy mo_update on public.move_order for update
  using (exists (select 1 from army a join roster r on r.id = a.roster_id
                 where a.id = army_id and (r.player_id = auth.uid() or public.is_gm(a.campaign_id))));
create policy mo_delete on public.move_order for delete
  using (exists (select 1 from army a join roster r on r.id = a.roster_id
                 where a.id = army_id and (r.player_id = auth.uid() or public.is_gm(a.campaign_id))));

-- battle_order
create policy bo_select on public.battle_order for select using (public.is_member(campaign_id));
create policy bo_write on public.battle_order for all using (public.is_gm(campaign_id))
  with check (public.is_gm(campaign_id));

-- battle
create policy battle_select on public.battle for select
  using (public.is_member(campaign_id)
         or exists (select 1 from campaign c where c.id = campaign_id and c.status = 'completed'));
create policy battle_insert on public.battle for insert
  with check (public.is_member(campaign_id) and created_by = auth.uid());
create policy battle_update on public.battle for update
  using (
    public.is_gm(campaign_id)
    or (status in ('draft','pending_verification')
        and exists (select 1 from roster r
                    where r.id in (attacker_roster_id, defender_roster_id)
                      and r.player_id = auth.uid()))
  );
create policy battle_delete on public.battle for delete using (public.is_gm(campaign_id));

-- battle_unit: follows parent battle
create policy bu_select on public.battle_unit for select
  using (exists (select 1 from battle b where b.id = battle_id and public.is_member(b.campaign_id)));
create policy bu_write on public.battle_unit for all
  using (exists (
    select 1 from battle b where b.id = battle_id and (
      public.is_gm(b.campaign_id)
      or (b.status in ('draft','pending_verification')
          and exists (select 1 from roster r
                      where r.id in (b.attacker_roster_id, b.defender_roster_id)
                        and r.player_id = auth.uid()))
    )))
  with check (exists (
    select 1 from battle b where b.id = battle_id and (
      public.is_gm(b.campaign_id)
      or (b.status in ('draft','pending_verification')
          and exists (select 1 from roster r
                      where r.id in (b.attacker_roster_id, b.defender_roster_id)
                        and r.player_id = auth.uid()))
    )));
