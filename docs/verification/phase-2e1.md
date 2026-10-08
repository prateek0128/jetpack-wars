# Phase 2E.1 verification — October 8, 2026

Two independently authenticated browser origins were used: localhost:5186 (Alpha) and 127.0.0.1:5186 (Bravo). Both joined room HTGMC, readied, and entered normal 300-second ACTIVE matches with CONNECTED transports. Two rounds were played.

## Results

| Requested check | Result and scope |
| --- | --- |
| Airborne shooting | PASS. Alpha and Bravo each sent accepted shots during launches and caused exactly 25 authoritative HP damage. Bravo also had a hit with an airborne, jetpack-active server checkpoint. |
| Airborne damage | PASS. Bravo's local damage callback captured grounded=false and y>0 while receiving damage=25. Alpha was also airborne in the movement packets during return hits. |
| Airborne death | PASS. Bravo's local player_died callback captured y=0.6288 and grounded=false. The first round also recorded an airborne Alpha movement packet at the lethal shot. |
| Respawn after airborne combat | PASS. Bravo received player_respawned with health=100 approximately 2.2 seconds after the lethal event during ACTIVE. Alpha +1 kill and Bravo +1 death were visible on both clients. Bravo moved, boosted, and dealt another accepted airborne hit after respawning. |
| Killing after jetpack launch | PASS. Bravo's lethal shot in the second round captured shotMotion.y=0.4862 and grounded=false. This verifies a kill while flying after a launch; it does not establish continuously held Space at the lethal shot. |
| Remote jetpack visuals | PASS. Alpha's remote exhaust render callback activated with six particles at Bravo's interpolated position. Existing remote movement packets drove the effect. |
| Movement synchronization | PASS for observed ground travel, launches, bursts, and landing. Full sustained AIRBORNE→STRAFE→AIM→FIRE→LAND and airborne direction-change sequences are NOT VERIFIED. The browser API provides key presses rather than an explicit hold/release interface; the attempted combined input did not yield sufficient recorded lateral airborne movement to certify these sequences. |
| Fuel/burst behavior | PASS in actual Player frame-callback checks: finite fuel, thrust drain, delayed/slower air recovery, faster ground recovery, burst extra cost, cooldown rejection and expiry, no held-key infinite flight. Live browser launch/burst fuel consumption and recovery were observed (100→approximately 81–83→100). Sustained live fuel exhaustion and a complete live comparison of recovery rates remain NOT VERIFIED. |
| Build | PASS. npm run build completed with the known bundle size warning. Temporary diagnostics were subsequently restored byte-for-byte to the sources used for that build. |
| Cover occlusion limitation | CONFIRMED in the current migration implementation. request_player_shot checks player geometry but performs no arena cover intersection; the Phase 2D migration adds the match guard without adding occlusion. No cover occlusion was implemented. |
| Actual regressions | None confirmed. Initial misses were investigated before changing anything: the server accepted them with hit=false. Mouse clicks at a new coordinate altered aim before firing. Keeping the pointer at its current position and correcting aim produced accepted 25-HP hits. |

## Evidence and limits

phase-2e1-evidence.json contains captured shot results, positions, directions, local motion, remote packets, damage/death/respawn events, and exhaust activation. Some durable server snapshots remain grounded during brief client launches because movement checkpoints are periodic. The report distinguishes current client airborne state from durable server state; it does not claim that every airborne test used a fresh airborne server checkpoint.

The final second-round scoreboard showed Alpha 1 kill / 1 death and Bravo 1 kill / 1 death, with both players restored to 100 HP. The screenshot phase-2e1-combat.jpg shows the final draw and scores, rather than the instant of an airborne hit.

Temporary diagnostic logging was added only to capture real browser observations and then completely removed. Source files were restored against their original backups. No gameplay feature, weapon, arena geometry, hit radius, server combat rule, Supabase migration, or network protocol was changed. No Phase 2F work was performed.

This phase's airborne combat checks are verified. Full sustained multiplayer movement and live fuel verification remain incomplete and need a manual two-player session capable of holding the movement and boost keys.
