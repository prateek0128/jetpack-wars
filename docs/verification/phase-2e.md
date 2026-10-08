# Phase 2E implementation and verification

## Movement

Shared tuning lives in src/game/mobility.ts. Ground movement reaches 8.2 units/s with responsive acceleration and braking; airborne steering targets 7.2 units/s with weaker acceleration and gradual drift decay. Gravity is 16 units/s² and thrust is 25 units/s², with ordinary ascent capped at 4.8 units/s. Falling is capped at 11.5 units/s to remain within the existing movement packet validator. Space launches and sustains thrust. Double tapping Space within 280 ms triggers a short burst costing 14 fuel, with a 1.6-second cooldown. A launch costs 3 fuel.

Fuel drains at 24 units/s during thrust. Recovery begins after 0.8 seconds without thrust, at 26 units/s grounded and 4 units/s airborne. Empty fuel locks sustained thrust until Space is released, preventing held-key refuel/boost oscillation. Ground launches require at least 8 fuel. Horizontal boundaries, a floor, and a 16-unit height ceiling prevent escape; no new fall-death RPC was introduced.

## Arena, camera, and feedback

The existing compact arena retains its ground, 2.425-unit bridge, 2.98-unit side decks, and 4.6-unit upper deck. Four ramps now have exact ground/deck endpoints, consistent top-face support math, and properly rotated trim. Six cover pieces add central sightline breaks and protected elevated positions. Under-deck paths remain available. Ground collision permits small steps at ramp/deck transitions; deck undersides stop upward passage.

Camera follow responds slightly faster during boosting and retracts quickly around boxes and ramps, including a collision check after smoothing. The existing shoulder offsets, aim direction submission, and server reconstruction protocol are preserved. Camera retraction remains a known mismatch with server reconstruction, which always assumes the full shoulder offset.

Local and remote players share twin exhaust cones, six fixed animated exhaust particles, and one nearby glow. Remote activation uses the existing jetpack_active packet state. Landing gives a small body compression; low fuel changes the existing fuel meter to amber. Existing damage, death, and respawn feedback remains in use.

No networking architecture, packet shape, broadcast cadence, checkpoint cadence, Supabase schema, RPC, migration, or damage rule was modified. No Phase 2F work was performed.

## Verification on October 7, 2026

| Check | Result |
| --- | --- |
| Four ramp endpoints and continuous support | PASS |
| Ramp rendered top / collision intersections agree | PASS |
| Eight existing spawn positions clear of cover | PASS |
| Actual Player frame loop: ascent / bounded thrust | PASS |
| Actual Player frame loop: fuel exhaustion / no held-key infinite flight | PASS |
| Actual Player frame loop: delayed air recovery / landing | PASS |
| Actual Player frame loop: ground acceleration / braking | PASS |
| Actual Player frame loop: walking up ramp / deck underside / bounds | PASS |
| Solo browser: shooting / target destruction / reload | VERIFIED |
| Solo browser: launch / burst fuel cost / death and respawn | VERIFIED |
| Two independent authenticated browser origins: room BZ8F9 / ready / host start | VERIFIED |
| Both clients ACTIVE and CONNECTED | VERIFIED |
| Remote launch and exhaust visible | VERIFIED |
| Local firing during launches / ammo use | VERIFIED |
| Sustained keyboard flight and reaching a platform in the browser | NOT VERIFIED; sustained input unavailable through the browser key-press API |
| Authoritative damage / airborne damage / kill / multiplayer respawn / complete combat exchange | NOT VERIFIED; shots were fired but no HP loss was observed; aim alignment was not conclusively established |
| npm run build after final source edits | PASS; known bundle-size warning only |

The deterministic checks execute the actual Player frame callback with minimal hook/input/camera fixtures. They validate movement invariants; they do not replace live combat validation. No test controls or temporary verbose logs were added to the application.

## Remaining limitations

Server combat currently resolves player hits without testing arena occlusion. Cover breaks visibility and blocks solo shots, but is not reliable ballistic protection in multiplayer. This predates Phase 2E and would require a separately authorized combat change. Full shoulder camera reconstruction also does not account for camera retraction near cover. Multiplayer damage/kill/respawn and sustained browser flight require a manual playtest before declaring Phase 2E fully verified.

Screenshot: phase-2e-multiplayer.jpg.

## Files changed

- src/game/mobility.ts (new)
- src/game/arenaLayout.ts
- src/components/Player.tsx
- src/components/JetpackEffect.tsx (new)
- src/components/RemotePlayers.tsx
- src/components/Arena.tsx
- src/pages/Play.tsx
- src/styles.css
- docs/verification/phase-2e.md (new)
- docs/verification/phase-2e-multiplayer.jpg (new)
