# Jetpack Wars

An original 2–8 player browser arena shooter built with React, TypeScript, Vite, React Three Fiber, Three.js and Supabase. Rooms, anonymous identity, private Realtime movement, server-authoritative combat and five-minute matches are implemented. The arena, characters, effects and audio are procedural and original.

## Local setup

1. Install dependencies with `npm ci`.
2. Copy `.env.example` to `.env.local`.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. `VITE_SUPABASE_ANON_KEY` remains supported for existing configurations.
4. Enable anonymous sign-ins in the Supabase project and apply every migration in `supabase/migrations` using the linked Supabase CLI.
5. Run `npm run dev`.

Never provide a service-role or secret key to a Vite environment variable. The production build rejects missing settings, invalid/non-HTTPS URLs and privileged keys. Error messages do not print configuration values.

## Routes and controls

`/` offers Create Room, Join Room and solo training. `/create`, `/join` and `/lobby/:roomCode` provide the multiplayer entry flow. `/play` recovers an authenticated match or enters solo training when no match exists.

- WASD / Arrow Keys — Move.
- Space: launch and hold for jetpack thrust; double-tap for a fuel-consuming burst.
- Mouse: aim, using pointer lock where supported and mouse movement otherwise.
- Left mouse: fire; VX-9 supports holding, SH-8 fires per click.
- 1 / 2: VX-9 / SH-8.
- R: reload.
- Sound control: mute, remembered by the browser.

Fuel regenerates faster on the ground. VX-9 deals 25 HP per confirmed hit. SH-8 uses eight server-calculated pellets at 8 HP each. Multiplayer deaths respawn after two seconds; solo training uses its existing local respawn timer and target dummies. Multiplayer health, ammunition, reload deadlines, damage, kills, deaths and match lifecycle are controlled by RPCs rather than client writes.

## Production deployment

Use Vercel with the Vite framework, `npm run build` and `dist` as output. `vercel.json` defines SPA routing for direct links and refreshes. Configure the Supabase URL and publishable key in the selected Vercel project's Production environment before deployment. Preview deployments need their own equivalent configuration if used.

Link the intended Vercel account/team/project, deploy to production, and test the actual public URL in two separate authenticated browser sessions. A successful local build is not a release approval. Verify anonymous authentication, private subscriptions, combat, match results, Play Again, Return to Lobby and reconnect on that deployment. Production release evidence is recorded in `docs/verification/phase-2h.md`.

## Code layout

- `src/game`: shared types, weapon tuning, mobility and arena collision geometry.
- `src/hooks`: local simulation, multiplayer recovery and presentation.
- `src/multiplayer`: Supabase configuration, RPC wrappers, typed sessions and movement transport.
- `src/components`: arena, player controller, remote interpolation and bounded effects.
- `src/pages`: routes, lobby, HUD and match results.
- `src/presentation`: procedural audio and feedback events.
- `supabase/migrations`: tables, RLS, membership, combat, weapon and match authority.

Movement broadcasts are sent up to 20 times per second and checkpointed at most once per second. Remote movement is interpolated. Direct client writes to game tables are denied; protected RPCs derive the caller from the authenticated UUID. Private movement topics only permit sending as that caller. Internal server helpers are not executable by client roles except the read-only authorization helpers required by policies.

## Known limitations

Server shots do not test arena cover/occlusion. The server's reconstructed camera can differ from the smoothed rendered camera. Movement is simulated on clients with bounded own-player checkpoints, rather than server physics or comprehensive movement anti-cheat. Lightweight geometry collision is not a rigid-body solver. Sustained jetpack edge cases and eight-player performance have not been exhaustively tested. The Three.js runtime exceeds Vite's advisory bundle-size threshold; no bundle optimization is part of this release phase.
