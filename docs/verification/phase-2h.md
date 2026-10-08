# Jetpack Wars — Phase 2H release audit

Date: 2026-10-08. Status: NOT READY FOR PUBLIC RELEASE. Deployment and fresh production browser verification are blocked by missing Vercel authentication and an unspecified account/team/project. No production URL has been created in this phase. Earlier localhost evidence is not substituted for production validation.

## Changes

| File | Release correction |
| --- | --- |
| `vite.config.ts` | Production build rejects missing settings, malformed/non-HTTPS URL, secret/service-role keys; supports publishable key and existing anon alias. |
| `vercel.json` | Vite build command, `dist` output and React SPA rewrite. Deployment behavior remains unverified. |
| `.env.example` | Preferred publishable-key variable. |
| `.gitignore` | Excludes Vercel metadata and Supabase linked-project cache. |
| `src/multiplayer/client.ts` | Publishable-key alias and safe authentication/configuration errors. |
| `src/multiplayer/rooms.ts` | Only known business-rule errors reach players; distinguishes confirmed absence of a match from a failed service request. |
| `src/hooks/useMultiplayerGame.ts` | Failed recovery cannot silently clear remembered match; score snapshots repair missed combat events; limits checkpoint requests to one pending call; respawn uses server offset and cancels retry timers on cleanup. |
| `src/components/GameScene.tsx` | Handles rejected pointer-lock requests and stops automatic firing on window blur. |
| `src/pages/CreateRoom.tsx`, `src/pages/JoinRoom.tsx` | Safe optional callsign storage and no developer configuration instructions in player UI. |
| `src/pages/Lobby.tsx` | Cleans up the copy-code timer and removes obsolete Phase 2A navigation metadata. |
| `src/multiplayer/lobby.ts`, `src/game/constants.ts` | Removes unused legacy helper and firing interval. Actual weapon tuning unchanged. |
| `supabase/migrations/20261008000200_release_helper_privileges.sql` | Revokes default execution on three internal lobby helpers. |
| `README.md` | Replaces obsolete Phase 2B claims with current setup, authority, deployment and limitations. |

No new gameplay features, weapons, maps or architecture replacement. Existing training dummies remain in solo training. Normal match duration remains 300 seconds.

## Completed checks

- `npm run build`: passes, zero TypeScript errors. Existing advisory chunk-size warning remains.
- Missing URL/key: build intentionally fails with variable names and no values.
- Secret-key negative fixture: build intentionally fails before bundling.
- Actual local state hook checks: magazines, weapon switching/reload cancellation, timed reload, pellet damage, target respawn, death/loadout reset, stale weapon snapshot rejection and normalized pellet spread pass.
- Actual Player frame-loop checks: controlled ascent, finite fuel, no held-key infinite flight, delayed airborne recovery, landing, ground acceleration/deceleration, ramp ascent, deck underside collision, boundaries, burst cost and cooldown pass.
- Presentation checks: no predicted multiplayer hit confirmation, confirmed hit expiry, bounded/expiring kill feed, elimination feedback, death/respawn and countdown cleanup pass.
- Mocked Web Audio checks: procedural cues schedule, remembered mute suppresses cues, maximum 16 transient voices, one jet loop and cleanup pass. Human audibility is not verified.

These focused harnesses do not prove production multiplayer behavior or browser performance.

## Live Supabase verification

All original eight migrations were already present remotely. The new ninth release helper migration applied successfully and its privileges were verified live. Supabase reported a local Docker catalog-cache warning after successful application; remote application and privileges were separately confirmed.

- `rooms`, `room_players`, `game_players`: RLS enabled; authenticated client INSERT/UPDATE/DELETE privileges denied.
- Reviewed RPC signatures derive identity from `auth.uid()`; clients cannot submit a different pilot UUID, health, kills or deaths through those interfaces.
- Relevant public RPCs are SECURITY DEFINER with fixed empty search paths, authenticated execution and no unauthenticated `anon` execution.
- Match start/lobby return remain host-gated. Active membership and readiness checks remain enforced.
- Combat retains server validation for match activity/end time, selected weapon, reload deadline, ammunition and per-weapon fire rate, with room locking and server-derived damage/score updates.
- Internal lobby snapshot, stale-player mutation and current-room helper are no longer executable by PUBLIC/anon/authenticated roles. Existing policy authorization helpers remain callable for RLS/Realtime.
- Live `private.match_config.duration_seconds` is 300.
- Temporary API test used three distinct authenticated anonymous users: create/join/ready/unready/heartbeat passed after helper revocation; non-host start, unready start, outsider start and unauthorized lobby return were rejected.
- Outsider reads returned no rows from all three game tables. Direct writes to room state, roster ready state, health and kills were denied. Non-member firing and a submitted identity argument were rejected.
- A test-room member's private Realtime lobby subscription succeeded; an unrelated authenticated user's subscription received CHANNEL_ERROR.
- Test memberships were left afterward. No match timer, health, ammunition or score fixtures were changed in the live project.

The security advisor reports intentional authenticated SECURITY DEFINER RPC access and anonymous-authenticated membership policies. These are required by this architecture, with authorization inside RPCs/policies. It also flags password-leak protection disabled; the game uses anonymous authentication rather than password login. No permissions were weakened to silence warnings.

## Production browser gate — NOT VERIFIED

Requires a signed-in Vercel CLI and the intended account/team/project. Vercel CLI currently reports Logged out; the workspace has no existing Vercel project link. A destination/sign-in request is pending with the user. No temporary or unclaimed deployment was used.

Still required on the actual production URL with two separate authenticated browser sessions:

- Create/join room, roster, host identity, ready/unready, private connection and countdown/ACTIVE.
- Both players moving, jetpack/fuel/burst, synchronized visuals, landing/ramps/bounds.
- VX-9 and SH-8 firing, reload, both-way authoritative damage, kills/deaths, two-second respawn and continued play.
- Authoritative scores, normal five-minute results, winner/draw, Play Again reset and Return to Lobby ready reset.
- Refresh and short reconnect recovery preserving room, identity, health, ammo and scores, then continued gameplay.
- Runtime console, audio/mute persistence and layouts at 1280×720, 1440×900 and 1920×1080.

The new multiplayer recovery/score/timer cleanup changes also require this browser regression before release approval.

## Performance review

Movement intervals, keyboard/mouse handlers and Supabase channels have cleanup paths. Tracers, presentation pulses, kill feed, seen-event cache and audio voices are bounded. Checkpoints now allow at most one pending request. Respawn retry and copy-code timers are cancelled when their effect/component ends. No large optimization refactor. No controlled browser FPS measurement or eight-player stress test in this phase.

## Known limitations

- Server-authoritative shots do not test arena cover/occlusion.
- Reconstructed server camera can differ from the smoothed rendered camera.
- Client-simulated movement has own-player bounds, not full authoritative physics or comprehensive movement anti-cheat.
- Sustained jetpack edge cases and eight-player load have not been exhaustively exercised.
- Three.js bundle exceeds Vite's advisory 500 kB threshold (approximately 1.30 MB uncompressed, 359 kB gzip).

## Blocking release items

1. Sign in to Vercel and specify/link the intended account/team/project, configure its production environment and deploy.
2. Complete the fresh two-client production browser gate above.
