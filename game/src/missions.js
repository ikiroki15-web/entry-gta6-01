// Mission state machine: five jobs for Rico, then free roam.
// The game object passes in a small API (world hooks) so missions stay decoupled.
import { MISSIONS, CITY } from './config.js';

export function createMissions(api) {
  const state = {
    index: 0, active: false, phase: 'idle', // idle | active | done
    timer: 0, deliverLeft: 0, target: null, goon: null, cashBag: null,
    message: '', sub: '',
  };
  const { half, pitch } = CITY;
  const garage = { x: -half + pitch / 2, z: -half + pitch / 2 };
  const safehouse = { x: half - pitch / 2, z: half - pitch / 2 };
  const bank = { x: half - pitch / 2, z: -half + pitch / 2 };
  const pier = { x: half - 60, z: half + 40 };
  const drops = [
    { x: -half + pitch * 3.5, z: half - pitch * 1.5 },
    { x: half - pitch * 2.5, z: -half + pitch * 4.5 },
    { x: -half + pitch * 1.5, z: -half + pitch * 5.5 },
  ];

  function setTarget(x, z, label) {
    state.target = { x, z, label };
    api.setBeacon(x, z, label);
  }
  function clearTarget() { state.target = null; api.setBeacon(null); }

  function start(index) {
    state.index = index;
    const m = MISSIONS[index];
    if (!m) { state.phase = 'done'; state.message = 'All jobs done — free roam!'; state.sub = ''; api.showObjective('Free Roam', 'Solara Bay is yours. Drive, explore, and keep the stars down.'); clearTarget(); return; }
    state.active = true; state.phase = 'active'; state.timer = m.timeLimit || 0;
    api.audio.missionStart();
    api.showObjective(m.title, m.brief);
    if (m.kind === 'driveTo') { setTarget(garage.x + 27, garage.z, "Mara's Garage"); state.sub = 'Steal a car (E) or take the Comet by the garage.'; }
    if (m.kind === 'deliver') { state.deliverLeft = drops.length; setTarget(drops[0].x, drops[0].z, 'Drop-off 1 of 3'); state.sub = '3 drop-offs — watch the timer.'; }
    if (m.kind === 'fight') { setTarget(pier.x, pier.z, 'Lenny "the Anchor" Ruiz'); state.goon = api.spawnGoon(pier.x, pier.z - 6); state.sub = 'Convince Lenny. Fists (F) or pistol (click).'; }
    if (m.kind === 'escape') { api.setWanted(3, 'The deal went loud!'); setTarget(safehouse.x, safehouse.z, 'Safe House'); state.sub = 'Lose the cops, then reach the blue marker.'; }
    if (m.kind === 'heist') { setTarget(bank.x, bank.z + 14, 'Meridian Bank'); state.sub = 'Walk into the bank marker to grab the cash.'; }
    api.setSub(state.sub);
    api.toast(m.title + ' — ' + m.brief);
  }

  function complete() {
    const m = MISSIONS[state.index];
    api.audio.missionDone();
    api.addCash(m.reward);
    api.toast(`Job complete! +$${m.reward}`);
    api.showObjective(m.title + ' — DONE', `+$${m.reward}. ${state.index + 1 < MISSIONS.length ? 'Next job unlocked.' : ''}`);
    clearTarget();
    state.active = false; state.phase = 'idle';
    api.saveGame();
    setTimeout(() => start(state.index + 1), 1800);
  }
  function fail(reason) {
    api.audio.fail();
    api.toast(reason);
    api.showObjective(MISSIONS[state.index].title + ' — FAILED', reason + ' Try again — press Enter to retry the job.');
    clearTarget();
    state.active = false; state.phase = 'idle';
    api.setWanted(0);
  }

  function atTarget(p, radius) {
    return state.target && Math.hypot(p.x - state.target.x, p.z - state.target.z) < (radius || 7);
  }

  function update(dt, player, wanted) {
    if (!state.active) return;
    const m = MISSIONS[state.index];
    if (m.timeLimit) {
      state.timer -= dt;
      state.sub = `Time left: ${Math.max(0, Math.ceil(state.timer))}s — ${state.deliverLeft} drop-off(s) left.`;
      api.setSub(state.sub);
      if (state.timer <= 0) { fail('Out of time — the packages went stale.'); return; }
    }
    if (m.kind === 'driveTo') {
      if (player.inCar && atTarget(player, 8)) complete();
    } else if (m.kind === 'deliver') {
      if (atTarget(player, 7)) {
        api.audio.pickup(); api.addCash(50);
        state.deliverLeft -= 1;
        if (state.deliverLeft <= 0) complete();
        else { setTarget(drops[3 - state.deliverLeft].x, drops[3 - state.deliverLeft].z, `Drop-off ${4 - state.deliverLeft} of 3`); api.toast('Package delivered! +$50'); }
      }
    } else if (m.kind === 'fight') {
      if (state.goon && !state.goon.alive) {
        if (!state.cashBag) { state.cashBag = true; api.toast('Lenny paid up. Grab the cash and get back to the garage.'); setTarget(garage.x + 27, garage.z, "Mara's Garage"); state.sub = 'Return to Mara\'s Garage.'; api.setSub(state.sub); }
        if (state.cashBag && atTarget(player, 8)) complete();
      }
    } else if (m.kind === 'escape') {
      if (wanted === 0 && atTarget(player, 9)) complete();
      else if (wanted === 0) state.sub = 'Clean! Get to the blue safe-house marker.';
      else state.sub = `${wanted} star${wanted > 1 ? 's' : ''} — break line of sight, then reach the safe house.`;
      api.setSub(state.sub);
    } else if (m.kind === 'heist') {
      if (state.phase === 'active' && !state.grabbed && atTarget(player, 7)) {
        state.grabbed = true;
        api.setWanted(4, 'The bank alarm is screaming!');
        api.addCash(1200); api.toast('Cash grabbed! +$1,200 — now RUN.');
        setTarget(safehouse.x, safehouse.z, 'Safe House');
        state.sub = 'Escape the 4-star response — reach the safe house with no stars.';
        api.setSub(state.sub);
      } else if (state.grabbed && wanted === 0 && atTarget(player, 9)) complete();
      else if (state.grabbed) { state.sub = `${wanted} star${wanted > 1 ? 's' : ''} — lose them, then reach the safe house.`; api.setSub(state.sub); }
    }
  }

  return {
    state, start, update, complete, fail,
    retry() { start(state.index); },
    get current() { return MISSIONS[state.index] || null; },
    get isActive() { return state.active; },
    locations: { garage, safehouse, bank, pier, drops },
  };
}
