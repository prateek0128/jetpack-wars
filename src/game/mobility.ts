// Shared tuning for solo and multiplayer. Movement packets remain unchanged.
export const MOBILITY = {
  groundSpeed: 8.2, airSpeed: 7.2, groundAcceleration: 18, airAcceleration: 4.2,
  groundDrag: 12, airDrag: 0.85, gravity: 16, thrust: 25,
  ascentSpeed: 4.8, descentSpeed: 11.5, launchSpeed: 3.8,
  fuelDrain: 24, groundRecovery: 26, airRecovery: 4, recoveryDelay: 0.8,
  restartFuel: 8, ceiling: 16, burstFuel: 14, burstCooldown: 1.6,
} as const;
