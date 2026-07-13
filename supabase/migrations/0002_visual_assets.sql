-- Visual customization layer: map background, terrain textures, location art,
-- army icons. All assets are optional — the flat tactical display renders
-- fully without them; anything uploaded layers on top.

-- Theme lives on the campaign as jsonb so the GM can restyle without
-- migrations. Shape:
-- {
--   "background": { "url": "...", "opacity": 0.5 },
--   "terrain": { "ruins": { "fill": "#2E3322", "texture_url": "..." }, ... },
--   "show_glyphs": true,
--   "show_vp": true
-- }
alter table public.campaign add column if not exists map_theme jsonb not null default '{}';

-- Per-hex location art (named settlements, reliquaries, etc.)
alter table public.hex_tile add column if not exists image_url text;

-- Custom army token per roster
alter table public.roster add column if not exists icon_url text;

-- Storage bucket for uploaded assets. Public read (tokens render for every
-- member without signed URLs); authenticated upload; owners manage their own.
insert into storage.buckets (id, name, public)
values ('map-assets', 'map-assets', true)
on conflict (id) do nothing;

create policy "map assets public read" on storage.objects
  for select using (bucket_id = 'map-assets');

create policy "map assets auth upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'map-assets');

create policy "map assets owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'map-assets' and owner = auth.uid());

create policy "map assets owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'map-assets' and owner = auth.uid());
