# State machine tests

Run against a scratch Postgres (NOT your Supabase project):

```bash
createdb crusade_test
psql -d crusade_test -v ON_ERROR_STOP=1 \
  -f tests/00_supabase_shim.sql \
  -f migrations/0001_init.sql -f migrations/0002_visual_assets.sql \
  -f migrations/0003_ux.sql -f migrations/0004_state_machine.sql \
  -f tests/state_machine_test.sql
```

The shim fakes `auth.uid()` via `set_config('test.uid', …)` and stubs the
storage schema. 13 assertions cover: creator-GM trigger, lock resolution +
SoC invasion, permission rejections, engagement filing + idempotency,
RP/XP guard triggers, server-side verification deltas, amendment reversal,
turn completion (territory, retreat, income, next turn), the
PENDING_ENGAGEMENTS consent flow, and event logging.
