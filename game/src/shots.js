// Deterministic screenshot scenes: ?shot=start|drive|chase|mission (with &seed=N).
// Each one stages the real game forward for a fixed number of steps from a fresh world,
// so the frame is what real play looks like and the same seed always gives the same frame.
// Round-3 shots are staged at golden hour (17.8) with the wider chase camera for drive/chase.
import { STEP } from './config.js';

const STEPS = { start: 60, drive: 60 * 6, chase: 150, mission: 72 };

export function stageShot(name, game) {
  const n = STEPS[name] ?? STEPS.start;
  game.beginShot(name);
  // Drive the world forward with a simple autopilot so the shot is alive.
  // Rendering is skipped during staging (the game sets a flag) and painted once at the end.
  game.staging = true;
  for (let i = 0; i < n; i += 1) {
    game.shotStep(STEP, name, i);
  }
  game.staging = false;
  game.endShot(name);
  window.__shotReady = true;
}
