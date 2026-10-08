# Phase 2G — game feel and presentation

Verification date: 8 October 2026. Project: `/Volumes/Work/Freelance/HandShakeAI/AI Games/JetpackWars`.

## 1. Game feel

Short firing reticle expansion, confirmed-hit response, elimination feedback, death vignette, 2/1 respawn presentation and a brief GO/energy flash. Low-health warnings disappear when health recovers. Critical feedback includes words and numbers, not color alone. Movement and weapon balance are unchanged.

## 2. Combat feedback

Multiplayer hit markers, impact pulses, remote body flashes, directional damage indicator and the four-entry kill feed consume the existing deduplicated server combat events. Predicted firing never confirms a hit. Elimination feedback lasts 1.35 seconds; feed entries expire after 4.5 seconds. Server health, kills, deaths and scores remain the sources of truth. Solo feedback uses the existing local training state.

## 3. HUD

Vitals/fuel lower left; weapon/ammo lower right; compact leaderboard at the side with local-player emphasis; timer and player count at the top; subtle connection status. Reload progress stays below 100% while the existing state still says reloading. Fuel shows FULL, USING, LOW and RECOVERING, with READY when partially fueled and idle. Countdown/GO and VICTORY/DEFEAT/DRAW results use existing server match state. Lobby and landing copy remove old phase-test labels.

## 4. Weapons

Existing muzzle flash and camera recoil retained. Added short weapon-model kick, switch dip, reload motion and completion border/sound. SH-8 has stronger model recoil and its existing wider flash. Each SH-8 trigger's eight traces share one transient LineSegments geometry/draw call. VX-9, SH-8 and server spread/damage/fire rate/reload/range values were not edited.

## 5. Jetpack

Existing six-particle exhaust is enlarged briefly during burst. Remote thrust strength derives from existing motion data, with no extra packets. Bounded landing rings and respawn pads/pulses. Fuel, thrust, cooldown, acceleration, collisions and network intervals remain unchanged.

## 6. Audio

Original procedural Web Audio: both weapons, confirmed hit, damage, reload start/completion, switch, looping thrust, burst, landing, elimination, death, respawn, countdown, start and end. Master gain is restrained, one jet loop is allowed, transient voices capped at 16, and nodes disconnect on completion. SOUND ON/OFF is stored locally. Browser user gestures unlock audio; unsupported audio leaves gameplay available. No downloaded sound assets or backend preference setting.

## 7. Arena

Small original energy rings/markers at existing spawns, restrained emissive cover accents, slightly brighter ambient/hemisphere illumination and a neutral, brighter remote-player silhouette. Standard depth testing is retained; there is no through-wall outline. No gameplay geometry redesign or collision changes.

## 8. Camera

Stable third-person camera, existing recoil, boost follow and landing response retained. New kick/switch/reload animation affects the weapon model only. Death uses a brief existing fade plus vignette rather than shake. Aim reconstruction, camera offsets, FOV and combat protocol unchanged.

## 9. Files

New:

- `src/presentation/events.ts`
- `src/presentation/audio.ts`
- `src/hooks/usePresentation.ts`
- `src/components/PresentationEffects.tsx`

Modified:

- `src/game/types.ts` — visual reload progress in the existing snapshot.
- `src/hooks/useGameState.ts` — firing notification and reload progress derived from the existing deadline.
- `src/hooks/useMultiplayerGame.ts` — dispatch existing confirmed events; refresh the existing session when the server round identity changes.
- `src/components/Effects.tsx` — grouped transient tracers.
- `src/components/GameScene.tsx` — effects and lighting.
- `src/components/Player.tsx` — model animations and movement-effect notifications.
- `src/components/JetpackEffect.tsx` — visual strength.
- `src/components/RemotePlayers.tsx` — neutral silhouette and confirmed impact response.
- `src/components/Arena.tsx` — spawn/cover accents.
- `src/pages/Play.tsx` — polished feedback/HUD/results/mute.
- `src/pages/Lobby.tsx`, `src/pages/Landing.tsx` — presentation copy and audio unlock.
- `src/styles.css` — feedback, compact HUD and responsive styles.

Evidence: `docs/verification/phase-2g-combat-evidence.json`, `phase-2g-arena.jpg`, `phase-2g-results.jpg`, `phase-2g-remote-jet.jpg`, `phase-2g-round-reset.json`, `phase-2g-fresh-room.jpg`, and this report. Temporary diagnostics were removed from source.

## 10. Backend

None. Existing authenticated RPCs and private Realtime channels were used for verification. One genuine client regression was found: after a remote host selected Play Again, the other client's timer restarted while health/scores stayed from the old round. The focused fix fetches the existing server session once when the round's server timestamp changes. It does not calculate or locally reset authoritative values, alter connection rules or change network cadence.

## 11. Migrations

None added, edited or applied. Server shot cover/occlusion remains deliberately unchanged.

## 12. Two authenticated browser clients

Alpha: `localhost:5186`; Bravo: `127.0.0.1:5186`. Separate origin storage/authentication, same existing room `Z8P2E`.

| Check | Result / evidence |
| --- | --- |
| Join, two-player roster, ready, host start | PASS in real clients; reused an existing room. Fresh authenticated Create Room additionally passed in the separate `[::1]` test session: `5TYVA`. |
| ACTIVE, CONNECTED, server timer | PASS; normal five-minute matches completed without shortening. |
| VX-9 damage | PASS: 25 HP per confirmed shot. |
| SH-8 pellets/damage | PASS: eight server traces, confirmed 32 HP hits and a lethal return shot. |
| Airborne shooting | PASS: accepted SH-8 shot; authoritative shooter y=0.35336 and grounded=false; one pellet dealt 8 HP. The response-time local motion had already landed, so the server event is the evidence. |
| Elimination/death/respawn | PASS: both weapons produced kills; live K/D/score, elimination toast, feed, death countdown, respawn and continued combat observed. |
| Confirmed hit semantics | Actual authoritative damage events verified. Short-lived hit marker timing is additionally covered by the hook harness; not every 240 ms flash was captured visually. |
| Remote movement/jetpack | Remote movement, launch and exhaust observed. No quantified interpolation/FPS benchmark performed. |
| Reload/switch | PASS: both weapons used/switched/reloaded through existing authoritative state. Reload progress observed; no early refill logic added. |
| Reconnect | PASS: real refresh recovered active room/match/timer, current HP, K/D/score and loadout. RECONNECTING appeared while recovering. Network-outage DISCONNECTED testing was not repeated. |
| Mute | PASS: toggled off and remained off after refresh. |
| Return to Lobby | PASS: original room and both pilots preserved; both ready flags reset; START MATCH disabled until ready. |
| Results | PASS: Alpha VICTORY and Bravo DEFEAT with final scores; a subsequent zero-score round produced DRAW. |
| Play Again | Initially FAILED on Bravo; fixed and retested PASS: Bravo 75 HP, SH-8 4/6 and D=2 reset to 100 HP, VX-9 12/12, K/D/score=0, clean feed and fresh server timer. Alpha also reset. |

An uninterrupted simultaneous airborne firefight was not repeated in full; the separately verified airborne hit and two-way ground exchange should not be described as that test passing.

## 13. Solo and focused regression checks

Browser solo training: VX-9/SH-8 fire, switching, reload progress/completion, jetpack fuel decrease, target elimination, damage/critical-health warning, death/respawn and continued movement/fire observed.

Actual-source harnesses passed:

- State: separate magazines, switch cancellation, exact reload timing, target damage/destruction/respawn, death/loadout reset and stale authoritative weapon-state rejection.
- Player frame loop: controlled ascent, finite fuel, no unlimited held boost, delayed air recovery, landing, acceleration/deceleration, ramps, deck undersides, arena bounds, burst cost/cooldown/expiry.
- Presentation hook: predicted shot cannot confirm hit; confirmed marker expiry, four-entry feed cap/expiry, 1.35-second toast, death/respawn and clean countdown/GO.
- Mock Web Audio: every cue schedules, mute suppresses cues and persists, transient voice cap and single jet-loop cleanup.

These focused harnesses are not substitutes for two-client combat. Audio audibility/mix was not listened to or measured through the browser tools.

## 14. Build

`npm run build` PASS after final code changes: TypeScript and Vite, 687 modules. CSS 37.05 kB (8.84 kB gzip); JS 1,297.17 kB (358.80 kB gzip). Existing large-chunk warning remains; no bundle optimization attempted.

## 15. Performance / responsive observations

No post-processing or new dynamic lights, no per-frame React state in the new Three effects, bounded eight impact/landing/spawn pulses, grouped pellets, bounded audio/feed. Existing scene and networking cadence retained. No controlled before/after performance benchmark, mobile GPU test or eight-player load test was performed.

Active HUD inspected at actual 1920×1080, 1440×900, 1366×768, 1280×720, 800×600 and 507×804 page dimensions. Timer, vitals/ammo and crosshair stayed separate at the tested sizes. The 800-pixel exit/timer overlap was found and fixed; small-window fuel wrapping was corrected. Results inspected at 1280×720 and 507×804. Browser viewport changes initially affected a different tab; only observed dimensions are counted. High-resolution screenshot display can crop the tool preview, so DOM dimensions/bounds were also checked.

## 16. Remaining limitations

**Server-authoritative shots currently do not test arena cover/occlusion.** Confirmed by inspection of the existing shot RPC; not implemented here. Movement checkpoints can lag visual air motion, and existing camera/server origin differences remain. Synthesized sound mix needs human listening. Full network-loss recovery, eight-player stress and a complete repeated airborne exchange remain outside the tests actually completed. No Phase 2H work started.
