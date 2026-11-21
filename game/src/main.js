// Solara Bay — Streets of the Sun. An original open-world crime game.
// Boot, loop, player, wanted system, police, combat, camera, save, screens and shots.
import { SAVE_KEY, STEP, CITY, PLAYER, MISSIONS, STORY_END, ARMOR, IFRAME_SECONDS, sanitizeSave, applyDamage, addHeat, intAmmo } from './config.js';
import { createRandom } from './rng.js';
import { createAudio } from './audio.js';
import { createCity } from './city.js';
import { makeCar, makePoliceCar, makePed, makePlayerMesh, driveCar, trafficStep, pedStep, damageCar, resolveCarCollisions, pushPedOutOfCar } from './entities.js';
import { CAR_MODELS } from './config.js';
import { createMissions } from './missions.js';
import { createSunStashes, updateSunStashes, stashSaveData, restoreSunStashes, resetSunStashes } from './side.js';
import { createHud } from './hud.js';
import { stageShot } from './shots.js';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 20261118;
const rng = createRandom(seed);

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2000);
const audio = createAudio();
const hud = createHud();
const city = createCity(rng, scene);

// Debug hook (read-only): lets a playtest read live state without touching the game.
window.__debug = () => ({
  x: G.player.x, z: G.player.z, inCar: G.player.inCar,
  speed: G.player.car ? G.player.car.speed : 0,
  heading: G.player.car ? G.player.car.heading : G.player.heading,
  wanted: G.wanted, missionIndex: missions.state.index, missionActive: missions.isActive,
  target: G.missionTarget, cash: G.cash, health: G.health,
  police: G.policeCars.length, traffic: G.traffic.length,
  stashes: stashes.collected + '/' + stashes.total,
  weapon: G.weapon, ammo: G.ammo, reserve: G.reserve, screen: G.screen,
  armor: G.armor, heat: G.heat,
  carHealth: G.player.car ? G.player.car.health : null,
});

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  // Refresh the pixel ratio too: dragging the window to a display with a
  // different density used to leave the canvas blurry (or oversized).
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

// ---------- state ----------
const G = {
  screen: 'title', // title | play | paused | wasted
  time: 8.0, // hour of day
  cash: 40, health: 100, armor: ARMOR.start, wanted: 0,
  weapon: 'fists', ammo: 12, reserve: 36,
  crimeTimer: 0, quietTimer: 0, lastCrime: -999,
  heat: 0, // fractional wanted progress from non-lethal aggression
  lastHitAt: -999, // last time damage landed (i-frame gate)
  restockAcc: 0, // garage ammo restock accumulator (whole rounds only)
  lastMinimapAt: -1, lastMinimapX: 1e9, lastMinimapZ: 1e9, // minimap throttle
  player: { x: 0, z: 0, heading: 0, speed: 0, inCar: false, car: null, moving: false },
  camYaw: 0, camPitch: 0.32, camDist: 9, camMode: 0,
  traffic: [], peds: [], policeCars: [], footCops: [],
  parked: [], missionTarget: null, safehouse: null, // set from missions.locations after createMissions — one snapped point, shared by HUD and missions
  tracers: [], elapsed: 0, muted: false,
  shotMode: !!shot,
};
const playerMesh = makePlayerMesh(scene);

// ---------- helpers ----------
const $ = id => document.getElementById(id);
function showScreen(name) {
  G.screen = name;
  $('title-screen').classList.toggle('hidden', name !== 'title');
  $('pause-screen').classList.toggle('hidden', name !== 'paused');
  $('wasted-screen').classList.toggle('hidden', name !== 'wasted');
  $('loading').style.display = 'none';
}
function addCash(n) { G.cash += n; hud.setCash(G.cash); }
function setWanted(n, reason) {
  const before = G.wanted;
  G.wanted = Math.max(0, Math.min(5, n));
  hud.setStars(G.wanted);
  if (G.wanted > before && reason) hud.toast(reason);
  if (G.wanted > 0) audio.siren(true); else audio.siren(false);
  G.quietTimer = 0;
  if (G.wanted === 0) G.heat = 0; // fully clean: leftover fractions clear too
}
function commitCrime(stars, reason) {
  G.lastCrime = G.elapsed;
  setWanted(G.wanted + stars, reason);
}
// Non-lethal aggression (a punch that connects, a reckless bump) does
// not deserve a full star on its own — it adds fractional heat, and
// only a whole star's worth raises the wanted level.
function addHeatCrime(amount, reason) {
  const r = addHeat(G.heat, amount);
  G.heat = r.heat;
  G.lastCrime = G.elapsed;
  if (r.stars > 0) setWanted(G.wanted + r.stars, reason);
}

// ---------- spawning ----------
function roadSpawnPoint() {
  const line = city.roadLines[Math.floor(rng.next() * city.roadLines.length)];
  const along = rng.range(-CITY.half, CITY.half);
  const horizontal = rng.chance(0.5);
  // Heading convention: x += sin(h), z += cos(h), so h = 0 moves +z and
  // h = PI/2 moves +x. A horizontal road (z fixed, x varies) therefore needs
  // h = +/-PI/2; a vertical road (x fixed, z varies) needs h = 0/PI.
  // Lane offset is right-hand: +3.5 for h = 0 / -PI/2, -3.5 for h = PI / PI/2.
  if (horizontal) {
    const east = rng.chance(0.5);
    return { x: along, z: line + (east ? -3.5 : 3.5), heading: east ? Math.PI / 2 : -Math.PI / 2 };
  }
  const south = rng.chance(0.5);
  return { x: line + (south ? 3.5 : -3.5), z: along, heading: south ? 0 : Math.PI };
}
function spawnTraffic(n) {
  for (let i = 0; i < n; i += 1) {
    const p = roadSpawnPoint();
    const model = CAR_MODELS[Math.floor(rng.next() * CAR_MODELS.length)];
    const car = makeCar(scene, model, p.x, p.z, p.heading, 'traffic');
    car.speed = rng.range(6, 10);
    G.traffic.push(car);
  }
}
function spawnPeds(n) {
  for (let i = 0; i < n; i += 1) {
    // A ped spawned inside a building footprint can never walk out: every
    // step collides, so pedStep just spins it in place forever. Keep drawing
    // sidewalk spots until one fits a player-sized circle — but cap the
    // tries, so a pathological seed can't hang the boot in an infinite loop.
    let x = 0, z = 0, clean = false;
    for (let attempt = 0; attempt < 12 && !clean; attempt += 1) {
      x = rng.range(-CITY.half, CITY.half); z = rng.range(-CITY.half, CITY.half);
      clean = !city.isRoad(x, z) && !city.collideCircle(x, z, 0.5);
    }
    if (!clean) continue; // no clean sidewalk spot in 12 tries — skip this ped
    G.peds.push(makePed(scene, rng, x, z));
  }
}
function spawnParked() {
  // A Comet waiting by Mara's garage (job 1's easy wheels) plus a few parked cars.
  // Parked cars sit clear of building footprints (on roads or open aprons), never inside one.
  const spots = [
    { x: city.garage.x + 18, z: city.garage.z + 8, model: CAR_MODELS[0] },
    { x: city.bank.x - 20, z: city.bank.z + 10, model: CAR_MODELS[5] },
    { x: city.clinic.x + 18, z: city.clinic.z - 8, model: CAR_MODELS[3] },
    { x: -CITY.half + CITY.pitch * 2 - 3.5, z: 100, model: CAR_MODELS[6] },
  ];
  for (const s of spots) {
    const car = makeCar(scene, s.model, s.x, s.z, rng.range(0, Math.PI * 2), 'parked');
    G.parked.push(car);
  }
}

// ---------- missions ----------
const missions = createMissions({
  audio,
  setBeacon(x, z, label) {
    if (x === null) { city.beacon.visible = false; G.missionTarget = null; return; }
    city.beacon.visible = true;
    city.beacon.position.set(x, 0, z);
    G.missionTarget = { x, z, label };
  },
  showObjective: (t, x) => hud.showObjective(t, x),
  setSub: t => hud.setSub(t),
  toast: (t, ms) => hud.toast(t, ms),
  addCash,
  setWanted,
  saveGame,
  // City queries missions needs to keep its targets on reachable ground.
  nearestRoadPoint: (x, z) => city.nearestRoadPoint(x, z),
  isRoad: (x, z) => city.isRoad(x, z),
  collideCircle: (x, z, r) => city.collideCircle(x, z, r),
  spawnGoon(x, z) {
    const goon = makePed(scene, rng, x, z);
    goon.health = 120; goon.state = 'goon'; goon.speed = 2.2;
    goon.mesh.children[0].material = new THREE.MeshLambertMaterial({ color: 0x111111 });
    scene.add(goon.mesh); // already added by makePed; harmless duplicate guard below
    G.peds.push(goon);
    return goon;
  },
});

// The safe house has exactly one definition: the snapped point missions
// computed (same point the HUD draws and Jobs 4/5 target).
G.safehouse = missions.locations.safehouse;

// Boot assert: every mission target must be reachable on foot. A target
// inside a building footprint can never be completed, so fail loudly here
// instead of shipping a game that quietly cannot be finished.
(function assertMissionTargets() {
  const loc = missions.locations;
  const targets = [
    { name: 'garage (Job 1/3 return)', x: loc.garage.x + 27, z: loc.garage.z, r: 8 },
    ...loc.drops.map((d, i) => ({ name: `drop-off ${i + 1} (Job 2)`, x: d.x, z: d.z, r: 7 })),
    { name: 'safehouse (Job 4/5)', x: loc.safehouse.x, z: loc.safehouse.z, r: 9 },
    { name: 'bank (Job 5)', x: loc.bank.x, z: loc.bank.z + 14, r: 7 },
    { name: 'pier (Job 3)', x: loc.pier.x, z: loc.pier.z, r: 7 },
    { name: 'goon (Job 3)', x: loc.pier.x, z: loc.pier.z - 6, r: 7 },
  ];
  for (const t of targets) {
    // Standable if the point itself fits a player, or any point within the
    // atTarget radius does (the marker sits at a building's edge, for one).
    let ok = !city.collideCircle(t.x, t.z, 1.5);
    if (!ok) {
      for (let a = 0; a < 8 && !ok; a += 1) {
        const ang = (a * Math.PI) / 4;
        ok = !city.collideCircle(t.x + Math.cos(ang) * t.r * 0.8, t.z + Math.sin(ang) * t.r * 0.8, 1.5);
      }
    }
    if (!ok) {
      console.error(`[boot] UNREACHABLE mission target: ${t.name} at (${t.x}, ${t.z}) — inside a building footprint`);
      throw new Error(`Unreachable mission target: ${t.name}`);
    }
  }
  console.log('[boot] mission targets reachable:', targets.map(t => t.name).join(', '));
})();

// ---------- input ----------
const keys = new Set();
let dragging = false, lastMX = 0, lastMY = 0;
window.addEventListener('keydown', e => {
  if (e.repeat) return;
  keys.add(e.code);
  audio.unlock();
  if (e.code === 'Enter') {
    if (G.screen === 'title') startGame(false);
    else if (G.screen === 'wasted') respawn();
    else if (G.screen === 'play' && !missions.isActive && missions.state.phase === 'idle') missions.retry();
  }
  if (e.code === 'Escape' && G.screen === 'play') pauseGame();
  else if (e.code === 'Escape' && G.screen === 'paused') resumeGame();
  if (e.code === 'KeyP' && G.screen === 'play') { saveGame(); hud.toast('Game saved.'); }
  if (e.code === 'KeyM') { G.muted = audio.toggleMute(); hud.toast(G.muted ? 'Sound muted.' : 'Sound on.'); }
  if (e.code === 'KeyC' && G.screen === 'play') { G.camMode = (G.camMode + 1) % 3; }
  if (e.code === 'Digit1') setWeapon('fists');
  if (e.code === 'Digit2') setWeapon('pistol');
  if (e.code === 'KeyR') reload();
  if (e.code === 'KeyE' && G.screen === 'play') toggleCar();
  if (e.code === 'KeyF' && G.screen === 'play') punch();
});
window.addEventListener('keyup', e => keys.delete(e.code));
canvas.addEventListener('pointerdown', e => { dragging = true; lastMX = e.clientX; lastMY = e.clientY; audio.unlock(); });
window.addEventListener('pointermove', e => {
  if (!dragging) return;
  G.camYaw -= (e.clientX - lastMX) * 0.005;
  G.camPitch = Math.max(0.05, Math.min(1.1, G.camPitch + (e.clientY - lastMY) * 0.004));
  lastMX = e.clientX; lastMY = e.clientY;
});
window.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('click', () => { if (G.screen === 'play' && !G.player.inCar && G.weapon === 'pistol') shoot(); });

$('btn-new').addEventListener('click', () => { audio.unlock(); startGame(false); });
$('btn-continue').addEventListener('click', () => { audio.unlock(); startGame(true); });
$('btn-how').addEventListener('click', () => $('how-text').classList.toggle('hidden'));
$('btn-resume').addEventListener('click', resumeGame);
$('btn-save').addEventListener('click', () => { saveGame(); hud.toast('Game saved.'); });
$('btn-quit').addEventListener('click', () => { saveGame(); showScreen('title'); refreshContinue(); });
$('btn-retry').addEventListener('click', respawn);

function setWeapon(w) {
  G.weapon = w;
  playerMesh.gun.visible = w === 'pistol';
  hud.setArmed(w === 'pistol' && !G.player.inCar, G.ammo, G.reserve);
  if (w === 'pistol') audio.click();
}
function reload() {
  // Whole rounds only, at consumption as well as on the HUD.
  G.ammo = intAmmo(G.ammo); G.reserve = intAmmo(G.reserve);
  if (G.weapon !== 'pistol' || G.ammo >= 12 || G.reserve <= 0) return;
  const need = 12 - G.ammo, take = Math.min(need, G.reserve);
  G.ammo += take; G.reserve -= take; audio.reload();
  hud.setArmed(true, G.ammo, G.reserve);
}

// ---------- save / load ----------
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: Math.floor(G.cash), health: G.health, armor: G.armor, missionIndex: missions.state.index,
      x: G.player.x, z: G.player.z, wanted: G.wanted,
      ammo: intAmmo(G.ammo), reserve: intAmmo(G.reserve), time: G.time,
      stashes: stashSaveData(stashes),
    }));
  } catch { /* private mode */ }
}
// The parsed save is never trusted raw: sanitizeSave type-checks and
// clamps every field, so a hand-edited or partly corrupt save loads as
// a playable game instead of poisoning health, cash or position.
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? sanitizeSave(JSON.parse(raw)) : null;
  } catch { return null; }
}
function refreshContinue() {
  $('btn-continue').classList.toggle('hidden', !loadSave());
}

// One place that owns "a fresh run": every piece of state that can leak
// from a previous run — mission progress, police, stashes, timers, weapon,
// tracers, the street population — is cleared here, so a New Game can never
// inherit a half-finished job (or a goon already down, or a stash already
// taken) and complete a mission the instant it starts. New Game goes
// through this; Continue deliberately does not — it restores the save.
function resetRun() {
  // Chase / combat transients.
  clearPolice();
  for (const t of G.tracers) scene.remove(t.line);
  G.tracers = [];
  // Player.
  G.player.inCar = false; G.player.car = null;
  G.player.heading = 0; G.player.speed = 0; G.player.moving = false;
  playerMesh.group.visible = true;
  G.player.x = city.garage.x + 10; G.player.z = city.garage.z + 14;
  playerMesh.group.position.set(G.player.x, 0, G.player.z);
  // Economy / combat / clocks.
  G.cash = 40; G.health = 100; G.armor = ARMOR.start;
  G.ammo = 12; G.reserve = 36;
  setWeapon('fists');
  G.crimeTimer = 0; G.quietTimer = 0; G.lastCrime = -999;
  G.heat = 0; G.lastHitAt = -999; G.restockAcc = 0;
  G.elapsed = 0; G.time = 8;
  setWanted(0);
  // Camera.
  G.camYaw = 0; G.camPitch = 0.32; G.camDist = 9; G.camMode = 0;
  // Missions and side activity (missions.reset also clears the pending
  // "next job" timer, so a completed job can't auto-start mid-new-game).
  missions.reset();
  resetSunStashes(stashes);
  hud.setStash(0, stashes.total);
  // Street population, fresh: no stolen-car driver, goon, or corpse from
  // the last run lingers, and no parked car stays where the player left it.
  for (const c of [...G.traffic, ...G.parked]) scene.remove(c.mesh);
  for (const p of G.peds) scene.remove(p.mesh);
  G.traffic = []; G.peds = []; G.parked = [];
  spawnTraffic(18); spawnPeds(30); spawnParked();
}

function startGame(fromSave) {
  const save = fromSave ? loadSave() : null;
  if (save) {
    // Continue: restore progress, but drop transient chase state — a police
    // roster or tracer from the last session must not leak into this one.
    // (The wanted level itself is restored; policeStep respawns the units.)
    clearPolice();
    for (const t of G.tracers) scene.remove(t.line);
    G.tracers = [];
    // `save` is already sanitized (types checked, ranges clamped).
    G.cash = save.cash; G.health = save.health; G.armor = save.armor;
    G.ammo = save.ammo; G.reserve = save.reserve;
    G.time = save.time; G.player.x = save.x; G.player.z = save.z;
    // A saved position inside a building footprint would wedge Rico in
    // a wall forever — fall back to the garage spawn instead.
    if (city.collideCircle(G.player.x, G.player.z, PLAYER.radius)) {
      G.player.x = city.garage.x + 10; G.player.z = city.garage.z + 14;
    }
    G.heat = 0; G.lastHitAt = -999; G.restockAcc = 0;
    missions.state.index = save.missionIndex;
    restoreSunStashes(stashes, save.stashes);
    hud.setStash(stashes.collected, stashes.total);
    setWanted(save.wanted);
  } else {
    resetRun();
  }
  hud.setCash(G.cash); hud.setHealth(G.health, G.armor);
  showScreen('play');
  playerMesh.group.position.set(G.player.x, 0, G.player.z);
  if (!missions.isActive) missions.start(missions.state.index);
  hud.toast('Welcome back to Solara Bay, Rico.');
  audio.unlock();
}
function pauseGame() { showScreen('paused'); audio.engineStop(); audio.siren(false); }
function resumeGame() { if (G.screen === 'paused') { showScreen('play'); audio.unlock(); } }
function respawn() {
  // Death costs the job, not the heat: an active mission fails (fail() no
  // longer touches wanted), but the wanted level stays — Rico walks out of
  // the clinic with the police still hunting him, so dying mid-chase can
  // never be used to wipe stars for free. The units themselves are cleared
  // and respawn from policeStep; the player retries the job with Enter.
  const missionWasActive = missions.isActive;
  G.health = 100; G.armor = ARMOR.start; G.cash = Math.max(0, G.cash - 200);
  G.player.x = city.clinic.x; G.player.z = city.clinic.z + 12;
  G.player.inCar = false; G.player.car = null;
  playerMesh.group.visible = true; // died in a car? the mesh was hidden
  if (missionWasActive) missions.fail('Rico went down — the job is blown. The cops are still looking for you.');
  setWanted(G.wanted); // re-assert stars + siren without changing the level
  hud.setCash(G.cash); hud.setHealth(100, G.armor);
  playerMesh.group.position.set(G.player.x, 0, G.player.z);
  clearPolice();
  showScreen('play');
  hud.toast('Mara bailed you out. $200 lighter. Don\'t make it a habit.');
  if (!missions.isActive && !missionWasActive) missions.retry();
}
function wasted(busted) {
  $('wasted-title').textContent = busted ? 'BUSTED' : 'WASTED';
  $('wasted-text').textContent = busted
    ? 'The Solara Bay Police took you in. Mara got you out — minus $200.'
    : 'Rico went down. The clinic patched him up — minus $200.';
  audio.fail(); audio.engineStop(); audio.siren(false);
  showScreen('wasted');
}

// ---------- car enter / exit ----------
function nearestCar(maxDist) {
  let best = null, bd = maxDist;
  for (const car of [...G.parked, ...G.traffic]) {
    if (!car.alive) continue;
    const d = Math.hypot(car.x - G.player.x, car.z - G.player.z);
    if (d < bd) { bd = d; best = car; }
  }
  return best;
}
function toggleCar() {
  if (G.player.inCar) {
    const car = G.player.car;
    car.isPlayerCar = false;
    G.player.inCar = false; G.player.car = null;
    G.player.x = car.x + Math.sin(car.heading + Math.PI / 2) * 2.5;
    G.player.z = car.z + Math.cos(car.heading + Math.PI / 2) * 2.5;
    playerMesh.group.visible = true;
    audio.doorSlam(); audio.engineStop();
    hud.setDriving(null, 0);
    setWeapon(G.weapon);
    return;
  }
  const car = nearestCar(4.5);
  if (!car) { hud.toast('No car close enough. Walk up to one and press E.'); return; }
  if (car.kind === 'traffic') {
    // Steal it: the driver bails out and runs.
    const p = roadSpawnPoint();
    const driver = makePed(scene, rng, car.x + 2, car.z);
    driver.panic = 5; G.peds.push(driver);
    G.traffic = G.traffic.filter(c => c !== car);
    G.parked.push(car); car.kind = 'parked';
    commitCrime(1, 'Car stolen! The police are on to you.');
    hud.toast('You jacked the ' + car.model.name + '! (+1 ★)');
  }
  G.player.inCar = true; G.player.car = car;
  car.isPlayerCar = true;
  playerMesh.group.visible = false;
  audio.doorSlam(); audio.engineStart();
  hud.setDriving(car.model.name, 0);
  hud.setArmed(false, 0, 0);
}

// ---------- combat ----------
function nearestTarget(maxDist, maxAngle) {
  // Aim where the camera looks, not where the body faces: on foot the
  // player's heading only changes while moving, but the camera yaw follows
  // every mouse drag — standing still and turning to aim used to miss.
  const aim = G.player.inCar ? G.player.heading : G.camYaw;
  const ax = Math.sin(aim), az = Math.cos(aim);
  const px = G.player.x, pz = G.player.z;
  let best = null, bd = maxDist;
  const candidates = [...G.peds, ...G.footCops];
  for (const t of candidates) {
    if (!t.alive) continue;
    const dx = t.x - px, dz = t.z - pz, d = Math.hypot(dx, dz);
    if (d > maxDist || d < 0.5) continue;
    const dot = (dx * ax + dz * az) / d;
    if (dot < Math.cos(maxAngle)) continue;
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}
function tracer(from, to) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9 }));
  scene.add(line);
  G.tracers.push({ line, life: 0.12 });
}
function shoot() {
  if (G.ammo <= 0) { audio.click(); hud.toast('Out of ammo — press R, or visit Mara\'s Garage to restock.'); return; }
  G.ammo -= 1; audio.gunshot();
  const from = new THREE.Vector3(G.player.x, 1.5, G.player.z);
  const dir = new THREE.Vector3(Math.sin(G.camYaw), -0.02, Math.cos(G.camYaw));
  const to = from.clone().add(dir.clone().multiplyScalar(45));
  tracer(from, to);
  const t = nearestTarget(45, 0.45);
  if (t) {
    t.health -= 34;
    tracer(from, new THREE.Vector3(t.x, 1.2, t.z));
    if (t.health <= 0) killPed(t);
    else {
      t.panic = 4;
      // A non-lethal hit still draws attention (the goon is off the books).
      if (t.state !== 'goon') addHeatCrime(0.5, 'Shots fired! The police are coming.');
    }
  }
  hud.setArmed(true, G.ammo, G.reserve);
  if (G.ammo === 0) hud.toast('Magazine empty — press R to reload.');
}
function punch() {
  audio.punch();
  playerMesh.armR.rotation.x = -1.4;
  setTimeout(() => { playerMesh.armR.rotation.x = 0; }, 160);
  const t = nearestTarget(2.4, 1.2);
  if (!t) return;
  t.health -= 16;
  t.panic = 2;
  // Landing a punch is assault even when nobody goes down.
  if (t.state !== 'goon' && t.health > 0) {
    addHeatCrime(t.kind === 'cop' ? 0.5 : 0.34, 'Assault! The police are on to you.');
  }
  const dx = t.x - G.player.x, dz = t.z - G.player.z, d = Math.hypot(dx, dz) || 1;
  t.x += (dx / d) * 1.2; t.z += (dz / d) * 1.2;
  if (t.health <= 0) killPed(t);
}
function killPed(t) {
  t.alive = false;
  t.mesh.visible = false;
  if (t.state === 'goon') { addCash(0); hud.toast('Lenny is down. Take the cash.'); return; }
  if (t.kind === 'cop') { commitCrime(1, 'You took down an officer! (+1 ★)'); return; }
  commitCrime(1, 'Someone saw that! (+1 ★)');
  if (rng.chance(0.5)) { addCash(25); hud.toast('You found $25 on them.'); }
}

// ---------- police ----------
function clearPolice() {
  for (const c of G.policeCars) { c.alive = false; scene.remove(c.mesh); }
  for (const c of G.footCops) { c.alive = false; c.mesh.visible = false; }
  G.policeCars = []; G.footCops = [];
}
// Trim a police roster down to the wanted level's count, removing the
// farthest units from the player first.
function trimPolice(arr, want, remove) {
  while (arr.length > want) {
    let far = 0, fd = -1;
    for (let i = 0; i < arr.length; i += 1) {
      const d = Math.hypot(arr[i].x - G.player.x, arr[i].z - G.player.z);
      if (d > fd) { fd = d; far = i; }
    }
    const u = arr.splice(far, 1)[0];
    u.alive = false;
    remove(u);
  }
}
function policeStep(dt) {
  // How many units the wanted level calls for.
  const wantCars = G.wanted >= 1 ? Math.min(4, G.wanted) : 0;
  const wantCops = G.wanted >= 2 ? Math.min(3, G.wanted - 1) : 0;
  // Drop dead units from the rosters first: a dead foot cop left in
  // G.footCops blocked its replacement from ever spawning, and a corpse
  // counted toward "nearest cop" so the heat could never cool off.
  for (let i = G.footCops.length - 1; i >= 0; i -= 1) {
    if (!G.footCops[i].alive) G.footCops.splice(i, 1);
  }
  for (let i = G.policeCars.length - 1; i >= 0; i -= 1) {
    if (!G.policeCars[i].alive) { scene.remove(G.policeCars[i].mesh); G.policeCars.splice(i, 1); }
  }
  while (G.policeCars.length < wantCars) {
    const p = roadSpawnPoint();
    // Spawn a block or two away from the player, on a road.
    const px = G.player.x + (rng.chance(0.5) ? 1 : -1) * rng.range(45, 80);
    const pz = G.player.z + (rng.chance(0.5) ? 1 : -1) * rng.range(45, 80);
    const near = city.nearestRoadPoint(px, pz);
    const car = makePoliceCar(scene, near.x, near.z, Math.atan2(G.player.x - near.x, G.player.z - near.z));
    G.policeCars.push(car);
  }
  while (G.footCops.length < wantCops) {
    // Spawn on the nearest road, not wherever the dice land: a cop spawned
    // inside a building footprint would chase Rico straight through its walls.
    const near = city.nearestRoadPoint(G.player.x + rng.range(-18, 18), G.player.z + rng.range(-18, 18));
    const c = makePed(scene, rng, near.x, near.z);
    c.kind = 'cop'; c.health = 60; c.speed = 3.4; c.state = 'cop';
    c.mesh.children[0].material = new THREE.MeshLambertMaterial({ color: 0x1a2a44 });
    G.footCops.push(c);
  }
  // If the roster grew past what the wanted level calls for (heat dropped a
  // star mid-chase), send the farthest units home first. Screenshot
  // staging hand-places its roster (four interceptors at 3 stars), so
  // trimming is skipped there — the staged frame must keep its cast.
  if (!G.shotMode) {
    trimPolice(G.policeCars, wantCars, c => scene.remove(c.mesh));
    trimPolice(G.footCops, wantCops, c => { c.mesh.visible = false; });
  }
  // Chase: steer toward the player, ram when close.
  for (const car of G.policeCars) {
    if (!car.alive) continue;
    if (car.health <= 0) { car.alive = false; continue; } // wrecked interceptor is out
    car.ramCd = Math.max(0, car.ramCd - dt);
    const dx = G.player.x - car.x, dz = G.player.z - car.z;
    const dist = Math.hypot(dx, dz);
    const wantHeading = Math.atan2(dx, dz);
    let dh = wantHeading - car.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    car.heading += Math.max(-2.4 * dt, Math.min(2.4 * dt, dh));
    car.speed = Math.min(30, car.speed + 14 * dt);
    const nx = car.x + Math.sin(car.heading) * car.speed * dt;
    const nz = car.z + Math.cos(car.heading) * car.speed * dt;
    if (!city.collideCircle(nx, nz, 1.3)) { car.x = nx; car.z = nz; car.stuck = 0; }
    else if (!city.collideCircle(nx, car.z, 1.3)) { car.x = nx; car.stuck = 0; }
    else if (!city.collideCircle(car.x, nz, 1.3)) { car.z = nz; car.stuck = 0; }
    else {
      // Nose-first into a wall: slide failed on both axes, so stop grinding
      // and, after half a second wedged, back up and turn away instead of
      // sitting against the building for the rest of the chase.
      car.speed *= 0.5;
      car.stuck += 1;
      if (car.stuck > 30) { car.heading += Math.PI / 2; car.speed = -6; car.stuck = 0; }
    }
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.heading;
    car.mesh.rotation.z = -Math.max(-1, Math.min(1, dh)) * 0.05;
    const spin = car.speed * dt * 2.4;
    for (const w of car.wheels) w.rotation.x += spin;
    // Flash the light bar.
    const on = Math.floor(G.elapsed * 6) % 2 === 0;
    if (car.lightBar) car.lightBar.material.emissive.setHex(on ? 0x2244ff : 0xff2222);
    // Ram the player.
    if (dist < 3.2) {
      if (G.player.inCar && G.player.car) {
        G.player.car.speed *= 0.6; car.speed *= 0.4;
        if (Math.abs(G.player.car.speed) > 8) audio.crash();
        // The ram lands on the car first — but a wrecked car stops
        // protecting Rico, so he is never fully safe behind the wheel.
        if (car.ramCd <= 0) {
          car.ramCd = 0.5;
          damageCar(G.player.car, 7);
          damageCar(car, 3);
          if (G.player.car.health < 30) damagePlayer(4, true);
        }
      } else {
        // Discrete ram hits (the i-frame gate in damagePlayer caps the
        // rate), never a per-step drain that melts 100 HP in a second.
        if (car.ramCd <= 0) { car.ramCd = 0.6; damagePlayer(6, true); }
        // Shove the player away from the interceptor, but never through a
        // wall: try the full push, then x-only, then z-only (same slide as
        // movePlayer), so a ram against a building can't wedge Rico inside it.
        const d = Math.max(0.1, dist);
        const kx = (G.player.x - car.x) / d * 2 * dt;
        const kz = (G.player.z - car.z) / d * 2 * dt;
        if (!city.collideCircle(G.player.x + kx, G.player.z + kz, PLAYER.radius)) {
          G.player.x += kx; G.player.z += kz;
        } else if (!city.collideCircle(G.player.x + kx, G.player.z, PLAYER.radius)) {
          G.player.x += kx;
        } else if (!city.collideCircle(G.player.x, G.player.z + kz, PLAYER.radius)) {
          G.player.z += kz;
        }
      }
    }
  }
  for (const cop of G.footCops) {
    if (!cop.alive) continue;
    cop.hitCd = Math.max(0, (cop.hitCd || 0) - dt);
    const dx = G.player.x - cop.x, dz = G.player.z - cop.z;
    const dist = Math.hypot(dx, dz);
    cop.heading = Math.atan2(dx, dz);
    if (dist > 1.6) {
      // Chase on foot, but never through a wall: try the full step, then
      // slide along one axis (same as the player), and only when fully
      // cornered sidestep around the blockage.
      const nx = cop.x + Math.sin(cop.heading) * cop.speed * dt;
      const nz = cop.z + Math.cos(cop.heading) * cop.speed * dt;
      if (!city.collideCircle(nx, nz, 0.5)) { cop.x = nx; cop.z = nz; }
      else if (!city.collideCircle(nx, cop.z, 0.5)) cop.x = nx;
      else if (!city.collideCircle(cop.x, nz, 0.5)) cop.z = nz;
      else cop.heading += Math.PI / 2;
    } else {
      cop.armL.rotation.x = -1.2; cop.armR.rotation.x = -1.2;
      // One solid hit every 0.7 s instead of a continuous drain. In a
      // car, the blows land on the bodywork until it is wrecked.
      if (cop.hitCd <= 0) {
        cop.hitCd = 0.7;
        if (G.player.inCar && G.player.car && G.player.car.health > 0) damageCar(G.player.car, 9);
        else damagePlayer(7, true);
      }
    }
    cop.mesh.position.set(cop.x, 0, cop.z);
    cop.mesh.rotation.y = cop.heading;
  }
  // Wanted decay: stay out of sight and quiet, and the heat cools off.
  // Only living units count — a corpse at its death spot used to pin the
  // nearest-cop distance and keep the wanted level stuck forever.
  const nearestCop = Math.min(
    ...G.policeCars.filter(c => c.alive).map(c => Math.hypot(c.x - G.player.x, c.z - G.player.z)),
    ...G.footCops.filter(c => c.alive).map(c => Math.hypot(c.x - G.player.x, c.z - G.player.z)),
    999);
  if (G.wanted > 0 && G.elapsed - G.lastCrime > 12 && nearestCop > 55) {
    G.quietTimer += dt;
    if (G.quietTimer > 14) { setWanted(G.wanted - 1, 'You lost them — heat is down.'); }
  } else G.quietTimer = 0;
  // Despawn police that fell far behind when the heat is gone.
  if (G.wanted === 0) {
    for (const car of G.policeCars) { car.alive = false; scene.remove(car.mesh); }
    for (const c of G.footCops) { c.alive = false; c.mesh.visible = false; }
    G.policeCars = []; G.footCops = [];
  }
}
function damagePlayer(amount, byCop) {
  if (G.screen !== 'play') return;
  // I-frames: at most one hit lands per IFRAME_SECONDS, so stacked
  // attackers on foot cannot delete Rico in under a second.
  if (G.elapsed - G.lastHitAt < IFRAME_SECONDS) return;
  const r = applyDamage(G.health, G.armor, amount);
  G.health = r.health; G.armor = r.armor;
  G.lastHitAt = G.elapsed;
  hud.setHealth(G.health, G.armor);
  if (G.health <= 0) wasted(byCop && G.wanted > 0);
}

// ---------- player movement ----------
function movePlayer(dt, input) {
  const p = G.player;
  const run = input.run ? PLAYER.run : PLAYER.walk;
  let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let mz = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
  const len = Math.hypot(mx, mz);
  p.moving = len > 0;
  if (len > 0) {
    mx /= len; mz /= len;
    // Move relative to the camera yaw: W walks away from the camera, D strafes
    // to the screen's right. (forward = (sin yaw, cos yaw), right = (-cos yaw, sin yaw).)
    const sin = Math.sin(G.camYaw), cos = Math.cos(G.camYaw);
    const wx = mz * sin - mx * cos;
    const wz = mz * cos + mx * sin;
    const nx = p.x + wx * run * dt;
    const nz = p.z + wz * run * dt;
    const hit = city.collideCircle(nx, nz, PLAYER.radius);
    if (!hit) { p.x = nx; p.z = nz; }
    else {
      if (!city.collideCircle(nx, p.z, PLAYER.radius)) p.x = nx;
      else if (!city.collideCircle(p.x, nz, PLAYER.radius)) p.z = nz;
    }
    p.heading = Math.atan2(wx, wz);
    const clamped = city.clampToCity(p.x, p.z);
    p.x = clamped.x; p.z = clamped.z;
    // Cars are solid on foot too: never walk through a body panel.
    for (const car of [...G.parked, ...G.traffic, ...G.policeCars]) {
      if (!car.alive) continue;
      const dx = p.x - car.x, dz = p.z - car.z;
      const d = Math.hypot(dx, dz);
      if (d >= 2.2 || d === 0) continue;
      const px = car.x + (dx / d) * 2.2, pz = car.z + (dz / d) * 2.2;
      if (!city.collideCircle(px, pz, PLAYER.radius)) { p.x = px; p.z = pz; }
    }
  }
  // Walk animation: swing arms, bob slightly.
  const swing = p.moving ? Math.sin(G.elapsed * 10) * 0.6 : 0;
  playerMesh.armL.rotation.x = swing;
  playerMesh.armR.rotation.x = -swing;
  playerMesh.group.position.set(p.x, p.moving ? Math.abs(Math.sin(G.elapsed * 10)) * 0.06 : 0, p.z);
  playerMesh.group.rotation.y = p.heading;
  // Near the garage: slow heal + ammo restock (Mara looks after her own).
  const gd = Math.hypot(p.x - city.garage.x, p.z - city.garage.z);
  if (gd < 16) {
    if (G.health < 100) { G.health = Math.min(100, G.health + 6 * dt); hud.setHealth(G.health, G.armor); }
    // Restock in whole rounds (4/s) — the reserve must stay an integer.
    if (G.reserve < 60) {
      G.restockAcc += dt;
      while (G.restockAcc >= 0.25 && G.reserve < 60) { G.reserve += 1; G.restockAcc -= 0.25; }
      if (G.weapon === 'pistol') hud.setArmed(true, G.ammo, G.reserve);
    }
  }
}

// ---------- camera ----------
function updateCamera(dt) {
  const p = G.player;
  const target = p.inCar && p.car ? { x: p.car.x, z: p.car.z, y: 1.2 } : { x: p.x, z: p.z, y: 1.6 };
  const yaw = p.inCar && p.car ? p.car.heading + G.camYaw * 0.3 : G.camYaw;
  const dist = G.camMode === 0 ? 9 : G.camMode === 1 ? 13 : 5.5;
  const pitch = G.camPitch;
  const cx = target.x - Math.sin(yaw) * Math.cos(pitch) * dist;
  const cz = target.z - Math.cos(yaw) * Math.cos(pitch) * dist;
  const cy = target.y + Math.sin(pitch) * dist + 1.5;
  camera.position.set(cx, Math.max(1.2, cy), cz);
  camera.lookAt(target.x, target.y + 0.6, target.z);
  if (!p.inCar) G.camYaw = yaw;
}

// ---------- day cycle ----------
function updateSky(dt) {
  G.time += dt * 0.02; // a full day in ~50 min of play
  if (G.time >= 24) G.time -= 24;
  const t = G.time;
  const dayF = Math.max(0, Math.min(1, (Math.sin(((t - 6) / 12) * Math.PI) + 1) / 2));
  const sunAngle = ((t - 6) / 12) * Math.PI;
  city.sun.position.set(Math.cos(sunAngle) * 180, Math.max(20, Math.sin(sunAngle) * 200), 80);
  city.sun.intensity = 0.4 + dayF * 1.4;
  city.hemi.intensity = 0.35 + dayF * 0.6;
  const skyDay = new THREE.Color(0x7ec3ee), skyNight = new THREE.Color(0x0d1b2e);
  city.skyMat.color.copy(skyNight).lerp(skyDay, dayF);
  scene.fog.color.copy(skyNight).lerp(new THREE.Color(0xcfe4f5), dayF);
  city.water.material.color.setHex(dayF > 0.5 ? 0x1e7fa8 : 0x0e3a52);
  for (const c of city.clouds) { c.position.x += dt * 1.5; if (c.position.x > 550) c.position.x = -550; }
  hud.setClock(G.time);
}

// ---------- per-frame update ----------
function readInput() {
  return {
    forward: keys.has('KeyW') || keys.has('ArrowUp'),
    back: keys.has('KeyS') || keys.has('ArrowDown'),
    left: keys.has('KeyA') || keys.has('ArrowLeft'),
    right: keys.has('KeyD') || keys.has('ArrowRight'),
    run: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    handbrake: keys.has('Space'),
  };
}

function update(dt, input) {
  G.elapsed += dt;
  updateSky(dt);
  // Beacon pulse.
  if (city.beacon.visible) {
    city.beacon.rotation.y += dt;
    const s = 1 + Math.sin(G.elapsed * 4) * 0.12;
    city.ring.scale.set(s, s, 1);
  }
  // Player / car.
  if (G.player.inCar && G.player.car) {
    const crashed = driveCar(G.player.car, input, dt, city);
    if (crashed && Math.abs(G.player.car.speed) > 10) audio.crash();
    G.player.x = G.player.car.x; G.player.z = G.player.car.z;
    audio.engine(Math.abs(G.player.car.speed) / 38, true);
    hud.setDriving(G.player.car.model.name, Math.abs(G.player.car.speed) * 3.6);
    if (G.player.car.health <= 0 && !G.player.car.wreckToasted) {
      G.player.car.wreckToasted = true;
      hud.toast('Your car is wrecked — press E to bail out and find another.');
    }
  } else {
    movePlayer(dt, input);
    audio.engine(0, false);
    hud.setDriving(null, 0);
  }
  // The Sun Stash side activity: grab the hidden gold gems for $50 each.
  updateSunStashes(stashes, G.player, dt, G.elapsed, () => {
    addCash(stashes.value);
    hud.setStash(stashes.collected, stashes.total);
    audio.pickup();
    hud.toast(`Sun Stash found! +$${stashes.value} (${stashes.collected}/${stashes.total})`);
  });
  // Traffic & pedestrians.
  for (const c of G.traffic) trafficStep(c, dt, city, rng);
  for (const ped of G.peds) {
    if (!ped.alive) continue;
    if (ped.state === 'goon') {
      // Lenny stands his ground near the pier until provoked, then charges.
      const d = Math.hypot(ped.x - G.player.x, ped.z - G.player.z);
      if (d < 12) {
        ped.heading = Math.atan2(G.player.x - ped.x, G.player.z - ped.z);
        ped.x += Math.sin(ped.heading) * 2.6 * dt;
        ped.z += Math.cos(ped.heading) * 2.6 * dt;
        ped.mesh.position.set(ped.x, 0, ped.z);
        ped.mesh.rotation.y = ped.heading;
        ped.hitCd = Math.max(0, (ped.hitCd || 0) - dt);
        if (d < 1.8) {
          ped.armL.rotation.x = -1.2;
          if (ped.hitCd <= 0) { ped.hitCd = 0.7; damagePlayer(8, false); }
        }
      }
      continue;
    }
    pedStep(ped, dt, city, rng, G.player.inCar ? G.player.car : null);
  }
  // Body-to-body car collision: parked cars are solid, moving cars push
  // each other apart, hard hits crumple both cars. Reckless contact at
  // speed also feeds the wanted heat.
  resolveCarCollisions([...G.parked, ...G.traffic, ...G.policeCars], (a, b, closing) => {
    if (closing > 10) {
      const dmg = (closing - 10) * 0.8;
      damageCar(a, dmg); damageCar(b, dmg);
      if (a.isPlayerCar || b.isPlayerCar) {
        audio.crash();
        addHeatCrime(0.25, 'Reckless driving! The police noticed.');
      }
    } else if ((a.isPlayerCar || b.isPlayerCar) && closing > 6) {
      audio.crash();
    }
  });
  // Pedestrians vs cars: fast player car = run over (a crime); anything
  // slower just shoves them aside — and a shove still counts as assault.
  for (const ped of G.peds) {
    if (!ped.alive) continue;
    ped.bumpCd = Math.max(0, (ped.bumpCd || 0) - dt);
    for (const car of [...G.parked, ...G.traffic, ...G.policeCars]) {
      if (!car.alive) continue;
      const d = Math.hypot(ped.x - car.x, ped.z - car.z);
      if (d >= 1.9) continue;
      if (car.isPlayerCar && Math.abs(car.speed) > 4) {
        killPed(ped); car.speed *= 0.7;
        break;
      }
      if (pushPedOutOfCar(ped, car, 1.9)) {
        ped.panic = Math.max(ped.panic, 2);
        if (car.isPlayerCar && ped.bumpCd <= 0 && ped.state !== 'goon') {
          ped.bumpCd = 1;
          addHeatCrime(0.5, 'You hit someone! The police are on to you.');
        }
      }
    }
  }
  // Fractional heat cools off when Rico keeps his nose clean for a while.
  if (G.heat > 0 && G.elapsed - G.lastCrime > 10) G.heat = Math.max(0, G.heat - 0.05 * dt);
  // The Safe House patches Rico up: health and armor both refill there.
  if (G.safehouse && Math.hypot(G.player.x - G.safehouse.x, G.player.z - G.safehouse.z) < 9) {
    if (G.health < 100 || G.armor < ARMOR.max) {
      G.health = Math.min(100, G.health + 12 * dt);
      G.armor = Math.min(ARMOR.max, G.armor + 12 * dt);
      hud.setHealth(G.health, G.armor);
    }
  }
  policeStep(dt);
  missions.update(dt, G.player, G.wanted);
  // Tracers fade.
  for (let i = G.tracers.length - 1; i >= 0; i -= 1) {
    const t = G.tracers[i];
    t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / 0.12);
    if (t.life <= 0) { scene.remove(t.line); G.tracers.splice(i, 1); }
  }
  updateCamera(dt);
  // No rendering here: the fixed-step simulation must never paint. One
  // render per animation frame happens in renderFrame() below — painting
  // per step was the lag spiral (more lag → more steps → more paints).
}

// Paint once per animation frame. The minimap is the expensive part, so
// it redraws at most every 100 ms, or sooner when the player has moved
// far enough for the map to look stale.
function renderFrame(forceMinimap) {
  const moved = Math.hypot(G.player.x - G.lastMinimapX, G.player.z - G.lastMinimapZ);
  if (forceMinimap || G.elapsed - G.lastMinimapAt >= 0.1 || moved > 3) {
    hud.drawMinimap({
      city, player: G.player, traffic: G.traffic, policeCars: G.policeCars,
      footCops: G.footCops, pierPos: city.pierPos,
      missionTarget: G.missionTarget, safehouse: G.safehouse, stashes,
    });
    G.lastMinimapAt = G.elapsed;
    G.lastMinimapX = G.player.x; G.lastMinimapZ = G.player.z;
  }
  renderer.render(scene, camera);
}

// ---------- shot mode (deterministic screenshots) ----------
const game = {
  beginShot(name) {
    // The boot already spawned traffic, peds and parked cars from the fixed seed;
    // staging only places the player and the camera, so shots stay deterministic.
    G.player.x = city.garage.x + 10; G.player.z = city.garage.z + 14;
    G.time = 17.8; // golden hour: low sun, long shadows, sun-soaked streets
    hud.setCash(G.cash); hud.setHealth(100, ARMOR.start);
    if (name === 'start') {
      showScreen('title');
      G.camYaw = 0.6; G.camPitch = 0.3;
      playerMesh.group.position.set(G.player.x, 0, G.player.z);
      playerMesh.group.rotation.y = 2.6;
    } else if (name === 'drive' || name === 'mission') {
      showScreen('play');
      G.camMode = 1; // wider chase camera so the shot shows more of the city
      const car = G.parked[0];
      G.player.inCar = true; G.player.car = car; car.isPlayerCar = true; playerMesh.group.visible = false;
      if (name === 'drive') {
        // Cruise the central avenue so the shot shows the city, traffic and the HUD.
        car.x = 3.5; car.z = -120; car.heading = 0; car.speed = 14;
        hud.showObjective('Free Roam — Solara Bay', 'Cruise Ocean Drive. Steal a faster car, grab Sun Stashes, keep the stars down.');
      } else {
        // Mission 1: on the road east of Mara's Garage, pointed at its marker.
        car.x = city.garage.x + 27 + 3.5; car.z = city.garage.z + 44; car.heading = Math.PI; car.speed = 12;
      }
      G.player.x = car.x; G.player.z = car.z;
      if (name === 'mission') { missions.start(0); G.player.x = car.x; G.player.z = car.z; }
      hud.setDriving(car.model.name, 40);
    } else if (name === 'chase') {
      showScreen('play');
      G.camMode = 1; // wider chase camera so the interceptors read in-frame
      setWanted(3, 'The deal went loud!');
      const car = G.parked[0];
      G.player.inCar = true; G.player.car = car; car.isPlayerCar = true; playerMesh.group.visible = false;
      car.x = 3.5; car.z = -100; car.heading = 0; car.speed = 18;
      G.player.x = car.x; G.player.z = car.z;
      // All four interceptors start ahead on the same avenue, in the two
      // lanes, 20–44 m in front — where the chase camera can see them.
      // (They used to sit 160–250 m away, one of them inside a building:
      // only one ever read in-frame.) The chase AI turns them onto Rico
      // from there; shots.js stages 54 steps, the moment all four are
      // converging in-frame — run it longer and Rico (top speed 38)
      // simply outruns the interceptors (top speed 30) out of shot.
      const copA = makePoliceCar(scene, -3.5, -80, 0); copA.speed = 14;
      const copB = makePoliceCar(scene, 3.5, -72, 0); copB.speed = 14;
      const copC = makePoliceCar(scene, -3.5, -64, 0); copC.speed = 14;
      const copD = makePoliceCar(scene, 3.5, -56, 0); copD.speed = 14;
      G.policeCars.push(copA, copB, copC, copD);
      hud.showObjective('Job 4 — Hot Afternoon', 'Lose the cops, then reach the safe house.');
      hud.setSub('3 stars — break line of sight, then reach the safe house.');
    }
  },
  shotStep(dt, name, i) {
    // Autopilot: drive forward, steer gently toward the road / target.
    const input = { forward: true, back: false, left: false, right: false, run: false, handbrake: false };
    if (name === 'drive' || name === 'chase' || name === 'mission') {
      const car = G.player.car;
      const target = name === 'mission' ? { x: city.garage.x + 27, z: city.garage.z } : null;
      const wantHeading = target
        ? Math.atan2(target.x - car.x, target.z - car.z)
        : Math.round(car.heading / (Math.PI / 2)) * (Math.PI / 2);
      let dh = wantHeading - car.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      input.left = dh > 0.15; input.right = dh < -0.15;
    }
    if (name === 'start') G.camYaw += dt * 0.06;
    update(dt, input);
  },
  endShot(name) {
    renderFrame(true); // the one paint staging was saving up for
    if (name === 'start') hud.showObjective('Welcome to Solara Bay', 'Press Enter to start.');
  },
};

// ---------- main loop ----------
let last = performance.now(), acc = 0;
const MAX_STEPS_PER_FRAME = 5;
function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = Math.min((now - last) / 1000, 0.25);
  last = now;
  if (G.screen === 'play') {
    acc += dtReal;
    const input = readInput();
    let steps = 0;
    while (acc >= STEP && steps < MAX_STEPS_PER_FRAME) { update(STEP, input); acc -= STEP; steps += 1; }
    // Drop any leftover backlog instead of spiralling: under heavy lag
    // the game slows down a touch rather than painting itself to death.
    if (acc >= STEP) acc = 0;
    renderFrame(false);
  } else if (G.screen === 'title') {
    // Living backdrop behind the title: traffic rolls, clouds drift.
    acc += dtReal;
    let steps = 0;
    while (acc >= STEP && steps < MAX_STEPS_PER_FRAME) {
      G.elapsed += STEP;
      updateSky(STEP);
      for (const c of G.traffic) trafficStep(c, STEP, city, rng);
      for (const ped of G.peds) pedStep(ped, STEP, city, rng, null);
      G.camYaw += STEP * 0.03;
      updateCamera(STEP);
      acc -= STEP; steps += 1;
    }
    if (acc >= STEP) acc = 0;
    renderFrame(false);
  }
}

// ---------- boot ----------
spawnTraffic(18);
spawnPeds(30);
spawnParked();
const stashes = createSunStashes(scene, rng, city);
hud.setStash(0, stashes.total);
playerMesh.group.position.set(G.player.x, 0, G.player.z);
refreshContinue();
hud.setCash(G.cash);
hud.setStars(0);
hud.setHealth(100, G.armor);
hud.showObjective('Welcome to Solara Bay', 'Press Enter or click New Game to start. Steal a car, run Mara\'s jobs, stay ahead of the police.');
if (shot) {
  // Deterministic screenshot scenes run once, paint, and signal readiness.
  showScreen('title');
  stageShot(shot, game);
} else {
  showScreen('title');
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G.screen === 'play') pauseGame();
  });
  requestAnimationFrame(frame);
}
