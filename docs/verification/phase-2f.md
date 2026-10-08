# Phase 2F — SH-8 + authoritative weapons

## Implementation

- Added only SH-8 SCATTERGUN; VX-9 remains available. No Phase 2G systems.
- VX-9: 12 rounds, 25 damage, 275ms server interval / 280ms client interval, 1100ms reload, 42-unit ray range.
- SH-8: 6 shells, eight pellets, 8 damage each, at most 64 damage per target per trigger, 850ms interval, 1600ms reload, 16-unit ray range, single trigger fire.
- Spread uses a fixed eight-offset pattern in a 9° total cone (4.5° half-angle). Client previews and server pellet directions share the same pattern; server results decide damage.
- Server stores selected weapon, both magazine counts, separate weapon cooldown timestamps, and selected-weapon reload deadlines. Switching cancels an unfinished reload. Reload completion is evaluated on subsequent server requests; client refreshes weapon state every 500ms during ACTIVE.
- Keys 1/2 switch weapons. Local selection predicts immediately; queued switch/reload requests preserve input order. Shots explicitly request the weapon and a normalized direction. No target, damage, ammo, or pellet results are accepted from clients.
- Both magazines refill and VX-9 is selected on new match / respawn. Reconnect restores durable weapon state. Weapon revisions reject older weapon snapshots.
- Server aggregates pellet hits per target, applies damage once per target, and uses the existing damage/death/elimination/respawn event flow. One `shot_fired` event contains all pellet results. Each pellet selects its closest eligible target.
- SH-8 has a larger original primitive model, stronger recoil/flash, and orange multi-tracer effects. Remote players have matching weapon models and server-event-driven weapon-specific tracers.
- HUD displays selected name/type, correct magazine denominator, reload status, and highlighted [1]/[2] indicator.
- Transient tracers are capped; replaced geometry/materials are disposed. No new frame-based raycasting loop.

## Database

Applied to the already-linked Jetpack Wars Supabase project:
`supabase/migrations/20261008000100_authoritative_weapons.sql`

Previous migrations were not edited. CLI push succeeded; the Docker catalog-cache warning did not prevent application. Verified the migration history row and RPC signatures. The legacy three-argument shot overload was removed.

Authenticated clients may execute only the new public weapon RPCs (`switch_weapon`, `reload_weapon`, `get_weapon_state`, weapon-aware `request_player_shot`). Anonymous database role cannot execute them. Private weapon helpers and existing combat snapshot/respawn/publishing helpers remain inaccessible to authenticated/anonymous clients.

RLS remains enabled on rooms, room_players, game_players and realtime.messages. Existing private lobby/movement/combat receive policies and own-player movement broadcast policy remain present. No client combat broadcast or direct weapon-state write policy was added.

## Verification

### Real browser sessions

Alpha at localhost and Bravo at 127.0.0.1 used independent anonymous authenticated storage, room **Z8P2E**.

| Check | Result / evidence |
|---|---|
| Create/join, roster and ready | PASS; both clients joined the same room |
| Start / ACTIVE / CONNECTED | PASS; normal five-minute match |
| VX-9 regression | PASS; Bravo 100 → 75; authoritative damage=25 on both clients |
| Switch and magazine preservation | PASS; SH-8 6/6, VX-9 12/12, returning to used SH-8 preserved 3/6 |
| SH-8 damage / spread event | PASS; eight server pellets, four hits, 32 damage; Bravo 75 → 43 |
| Airborne SH-8 | PASS; local Alpha y=0.8144, grounded=false; authoritative accepted shot, 32 damage, Bravo 43 → 11 |
| Kill / score / death | PASS; next SH-8 hit eliminated Bravo; Alpha score/kills=1, Bravo deaths=1 |
| Respawn | PASS; Bravo HP100, VX-9 selected, both magazines full in authoritative event |
| Reload cancellation | PASS; switching during SH-8 reload preserved 3/6 rather than granting a refill |
| Reload completion | PASS; SH-8 reloaded 3/6 → 6/6 |
| Reconnect | PASS; Alpha recovered room, score, HP, selected SH-8, ammo, and remaining timer; subsequent SH-8 hit dealt 32 damage |
| Realtime delivery | PASS; both clients logged matching shot/damage/death/respawn/weapon events |
| Normal match completion | PASS; Alpha winner, final 1–0 score, Bravo one death |
| Return to Lobby | PASS; same room and two-player roster, both ready flags reset |
| Complete repeated round / Play Again through browser | NOT VERIFIED; subsequent lobby requests failed to fetch and browser inspection timed out |
| Full near/far comparison through browser | PARTIAL; live medium-distance shot hit four pellets; separate server fixture at close range hit seven |
| Repeated full flight/strafe/direction-change combat | NOT VERIFIED in this phase |

Actual aim and position were inspected before concluding hits/misses. Hit radius remains 0.58; it was not increased. Temporary development logging was removed after saving evidence.

### Server assertions (rollback-only SQL)

PASS: close SH-8 hit=56 (seven pellets); 25-damage VX-9; 850ms rapid-shot rejection; weapon switching cannot bypass the SH-8 cooldown; requested weapon mismatch; unsupported weapon rejection; empty-ammo rejection; no firing while reloading; cancellation without refill; 1600ms reload refill; out-of-range miss; dead-player firing/switch rejection; disconnected membership rejection; countdown rejection; Play Again resets both magazines, selection and scores.

These calls exercised the real deployed functions with test auth claims in a database transaction. They are server assertions, not substitutes for browser actions. Every fixture update and transactional Realtime send was rolled back. Privileges were checked separately. Compact results: `phase-2f-server-results.json`.

### Solo / movement checks

PASS in browser: solo VX-9 and SH-8 fire decrement ammo, switching changes HUD/model, reload status, jetpack fuel consumption, death and respawn.

PASS using actual `useGameState` with a temporary controlled clock/hook harness: separate magazines, switching cancels timers, reload timing, 8×8 target damage, target destroy/respawn, player death/loadout respawn, stale authoritative weapon state rejection, eight deterministic normalized pellet directions within the cone.

PASS using the actual Player frame loop: ascent cap, finite fuel, delayed air recovery, landing, acceleration/deceleration, ramp ascent, underside collision, arena bounds, burst fuel cost and cooldown. The new weapon import/model were stubbed only for this movement harness. No test framework/dependencies were added.

## Build

`npm run build`: PASS. Final build performed after temporary logging was removed. Existing large-chunk warning remains; no bundle optimization was attempted.

## Changed implementation files

- `src/game/weapons.ts` (new shared weapon definitions and spread utility)
- `src/game/types.ts`
- `src/hooks/useGameState.ts`
- `src/hooks/useMultiplayerGame.ts`
- `src/multiplayer/types.ts`
- `src/multiplayer/rooms.ts`
- `src/components/GameScene.tsx`
- `src/components/Effects.tsx`
- `src/components/Player.tsx`
- `src/components/RemotePlayers.tsx`
- `src/components/WeaponModel.tsx` (new shared primitive model)
- `src/pages/Play.tsx`
- `src/styles.css`
- New migration above; this verification report, JSON evidence and result screenshot.

## Limitations / remaining checks

- **Server shots do not test arena cover/occlusion.** This existing limitation is confirmed and unchanged. Solo visual raycasts still stop at local arena geometry.
- Range is measured from the existing server-reconstructed third-person camera origin. Camera collision/retraction and approximately one-second durable movement checkpoints can differ from the rendered client position; the airborne test's server snapshot still showed the previous ground checkpoint. This existing aim/movement limitation was not redesigned.
- Client ammo/selection/recoil are predictions; server acknowledgments may correct them. Reload HUD completion can lag the server deadline by polling/network time.
- Later browser requests failed to fetch and one inspection timed out. No cause or new Phase 2F code regression was established. The remaining browser repeat-round/rapid-spam/complete near-far and extended flight tests are not claimed as passed.
- No cover occlusion, inventory, pickups, additional weapons, map redesign, or Phase 2G work was added.
