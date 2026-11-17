// Solara Bay — Streets of the Sun. An original open-world crime game.
// Boot, loop, player, wanted system, police, combat, camera, save, screens and shots.
import { SAVE_KEY, STEP, CITY, PLAYER, MISSIONS, STORY_END } from './config.js';
import { createRandom } from './rng.js';
import { createAudio } from './audio.js';
import { createCity } from './city.js';
import { makeCar, makePoliceCar, makePed, makePlayerMesh, driveCar, trafficStep, pedStep } from './entities.js';
import { CAR_MODELS } from './config.js';
import { createMissions } from './missions.js';
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
  weapon: G.weapon, ammo: G.ammo, reserve: G.reserve, screen: G.screen,
});

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

// ---------- state ----------
const G = {
  screen: 'title', // title | play | paused | wasted
  time: 8.0, // hour of day
  cash: 40, health: 100, armor: 0, wanted: 0,
  weapon: 'fists', ammo: 12, reserve: 36,
  crimeTimer: 0, quietTimer: 0, lastCrime: -999,
  player: { x: 0, z: 0, heading: 0, speed: 0, inCar: false, car: null, moving: false },
  camYaw: 0, camPitch: 0.32, camDist: 9, camMode: 0,
  traffic: [], peds: [], policeCars: [], footCops: [],
  parked: [], missionTarget: null, safehouse: null,
  tracers: [], elapsed: 0, muted: false,
  shotMode: !!shot,
};
G.safehouse = { x: CITY.half - CITY.pitch / 2, z: CITY.half - CITY.pitch / 2 };
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
}
function commitCrime(stars, reason) {
  G.lastCrime = G.elapsed;
  setWanted(G.wanted + stars, reason);
}

// ---------- spawning ----------
function roadSpawnPoint() {
  const line = city.roadLines[Math.floor(rng.next() * city.roadLines.length)];
  const along = rng.range(-CITY.half, CITY.half);
  const horizontal = rng.chance(0.5);
  return horizontal ? { x: along, z: line + 3.5, heading: rng.chance(0.5) ? 0 : Math.PI }
                    : { x: line + 3.5, z: along, heading: rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2 };
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
    const x = rng.range(-CITY.half, CITY.half), z = rng.range(-CITY.half, CITY.half);
    if (city.isRoad(x, z)) continue;
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
  spawnGoon(x, z) {
    const goon = makePed(scene, rng, x, z);
    goon.health = 120; goon.state = 'goon'; goon.speed = 2.2;
    goon.mesh.children[0].material = new THREE.MeshLambertMaterial({ color: 0x111111 });
    scene.add(goon.mesh); // already added by makePed; harmless duplicate guard below
    G.peds.push(goon);
    return goon;
  },
});

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
  if (G.weapon !== 'pistol' || G.ammo >= 12 || G.reserve <= 0) return;
  const need = 12 - G.ammo, take = Math.min(need, G.reserve);
  G.ammo += take; G.reserve -= take; audio.reload();
  hud.setArmed(true, G.ammo, G.reserve);
}

// ---------- save / load ----------
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: G.cash, health: G.health, missionIndex: missions.state.index,
      x: G.player.x, z: G.player.z, wanted: G.wanted,
      ammo: G.ammo, reserve: G.reserve, time: G.time,
    }));
  } catch { /* private mode */ }
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function refreshContinue() {
  $('btn-continue').classList.toggle('hidden', !loadSave());
}

function startGame(fromSave) {
  const save = fromSave ? loadSave() : null;
  if (save) {
    G.cash = save.cash; G.health = save.health; G.ammo = save.ammo; G.reserve = save.reserve;
    G.time = save.time || 8; G.player.x = save.x; G.player.z = save.z;
    missions.state.index = save.missionIndex || 0;
    setWanted(save.wanted || 0);
  } else {
    G.cash = 40; G.health = 100; G.ammo = 12; G.reserve = 36; G.time = 8;
    G.player.x = city.garage.x + 10; G.player.z = city.garage.z + 14;
    missions.state.index = 0;
    setWanted(0);
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
  G.health = 100; G.cash = Math.max(0, G.cash - 200);
  G.player.x = city.clinic.x; G.player.z = city.clinic.z + 12;
  G.player.inCar = false; G.player.car = null;
  setWanted(0); hud.setCash(G.cash); hud.setHealth(100, 0);
  playerMesh.group.position.set(G.player.x, 0, G.player.z);
  clearPolice();
  showScreen('play');
  hud.toast('Mara bailed you out. $200 lighter. Don\'t make it a habit.');
  if (!missions.isActive) missions.retry();
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
  playerMesh.group.visible = false;
  audio.doorSlam(); audio.engineStart();
  hud.setDriving(car.model.name, 0);
  hud.setArmed(false, 0, 0);
}

// ---------- combat ----------
function nearestTarget(maxDist, maxAngle) {
  const fx = Math.sin(camera.rotation.y), fz = Math.cos(camera.rotation.y);
  // Use the player's facing when on foot: camera yaw matches player heading closely.
  const px = G.player.x, pz = G.player.z;
  let best = null, bd = maxDist;
  const candidates = [...G.peds, ...G.footCops];
  for (const t of candidates) {
    if (!t.alive) continue;
    const dx = t.x - px, dz = t.z - pz, d = Math.hypot(dx, dz);
    if (d > maxDist || d < 0.5) continue;
    const dot = (dx * Math.sin(G.player.heading) + dz * Math.cos(G.player.heading)) / d;
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
  const dir = new THREE.Vector3(Math.sin(G.player.heading), -0.02, Math.cos(G.player.heading));
  const to = from.clone().add(dir.clone().multiplyScalar(45));
  tracer(from, to);
  const t = nearestTarget(45, 0.45);
  if (t) {
    t.health -= 34;
    tracer(from, new THREE.Vector3(t.x, 1.2, t.z));
    if (t.health <= 0) killPed(t);
    else { t.panic = 4; }
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
function policeStep(dt) {
  // How many units the wanted level calls for.
  const wantCars = G.wanted >= 1 ? Math.min(4, G.wanted) : 0;
  const wantCops = G.wanted >= 2 ? Math.min(3, G.wanted - 1) : 0;
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
    const c = makePed(scene, rng, G.player.x + rng.range(-18, 18), G.player.z + rng.range(-18, 18));
    c.kind = 'cop'; c.health = 60; c.speed = 3.4; c.state = 'cop';
    c.mesh.children[0].material = new THREE.MeshLambertMaterial({ color: 0x1a2a44 });
    G.footCops.push(c);
  }
  // Chase: steer toward the player, ram when close.
  for (const car of G.policeCars) {
    if (!car.alive) continue;
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
    if (!city.collideCircle(nx, nz, 1.3)) { car.x = nx; car.z = nz; }
    else { car.speed *= 0.5; }
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
      } else {
        damagePlayer(12 * dt * 10, true);
        const d = Math.max(0.1, dist);
        G.player.x += (G.player.x - car.x) / d * 2 * dt * 10;
        G.player.z += (G.player.z - car.z) / d * 2 * dt * 10;
      }
    }
  }
  for (const cop of G.footCops) {
    if (!cop.alive) continue;
    const dx = G.player.x - cop.x, dz = G.player.z - cop.z;
    const dist = Math.hypot(dx, dz);
    cop.heading = Math.atan2(dx, dz);
    if (dist > 1.6) {
      cop.x += Math.sin(cop.heading) * cop.speed * dt;
      cop.z += Math.cos(cop.heading) * cop.speed * dt;
    } else {
      damagePlayer(10 * dt, true);
      cop.armL.rotation.x = -1.2; cop.armR.rotation.x = -1.2;
    }
    cop.mesh.position.set(cop.x, 0, cop.z);
    cop.mesh.rotation.y = cop.heading;
  }
  // Wanted decay: stay out of sight and quiet, and the heat cools off.
  const nearestCop = Math.min(
    ...G.policeCars.map(c => Math.hypot(c.x - G.player.x, c.z - G.player.z)),
    ...G.footCops.map(c => Math.hypot(c.x - G.player.x, c.z - G.player.z)),
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
  let left = amount;
  if (G.armor > 0) { const absorbed = Math.min(G.armor, left); G.armor -= absorbed; left -= absorbed; }
  G.health -= left;
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
    if (G.ammo < 12 && G.reserve < 60) { G.reserve = Math.min(60, G.reserve + 4 * dt); }
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
    // Bump into traffic cars.
    for (const c of [...G.traffic, ...G.policeCars]) {
      if (!c.alive || c === G.player.car) continue;
      const d = Math.hypot(c.x - G.player.car.x, c.z - G.player.car.z);
      if (d < 3.4) {
        const push = (3.4 - d) / 2;
        const nx = (c.x - G.player.car.x) / (d || 1), nz = (c.z - G.player.car.z) / (d || 1);
        c.x += nx * push; c.z += nz * push;
        G.player.car.speed *= 0.85; c.speed *= 0.7;
        if (Math.abs(G.player.car.speed) > 6) audio.crash();
      }
    }
  } else {
    movePlayer(dt, input);
    audio.engine(0, false);
    hud.setDriving(null, 0);
  }
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
        if (d < 1.8) { damagePlayer(9 * dt, false); ped.armL.rotation.x = -1.2; }
      }
      continue;
    }
    pedStep(ped, dt, city, rng, G.player.inCar ? G.player.car : null);
  }
  // Player car running over peds (a crime, and it panics the street).
  if (G.player.inCar && Math.abs(G.player.car.speed) > 4) {
    for (const ped of G.peds) {
      if (!ped.alive) continue;
      const d = Math.hypot(ped.x - G.player.x, ped.z - G.player.z);
      if (d < 2) { killPed(ped); G.player.car.speed *= 0.7; }
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
  hud.drawMinimap({
    city, player: G.player, traffic: G.traffic, policeCars: G.policeCars,
    missionTarget: G.missionTarget, safehouse: G.safehouse,
  });
  if (!game.staging) renderer.render(scene, camera);
}

// ---------- shot mode (deterministic screenshots) ----------
const game = {
  beginShot(name) {
    // The boot already spawned traffic, peds and parked cars from the fixed seed;
    // staging only places the player and the camera, so shots stay deterministic.
    G.player.x = city.garage.x + 10; G.player.z = city.garage.z + 14;
    G.time = 10.5;
    hud.setCash(G.cash); hud.setHealth(100, 0);
    if (name === 'start') {
      showScreen('title');
      G.camYaw = 0.6; G.camPitch = 0.3;
      playerMesh.group.position.set(G.player.x, 0, G.player.z);
      playerMesh.group.rotation.y = 2.6;
    } else if (name === 'drive' || name === 'mission') {
      showScreen('play');
      const car = G.parked[0];
      G.player.inCar = true; G.player.car = car; playerMesh.group.visible = false;
      if (name === 'drive') {
        // Cruise the central avenue so the shot shows the city, traffic and the HUD.
        car.x = 3.5; car.z = -120; car.heading = 0; car.speed = 14;
      } else {
        // Mission 1: on the road east of Mara's Garage, pointed at its marker.
        car.x = city.garage.x + 27 + 3.5; car.z = city.garage.z + 44; car.heading = Math.PI; car.speed = 12;
      }
      G.player.x = car.x; G.player.z = car.z;
      if (name === 'mission') { missions.start(0); G.player.x = car.x; G.player.z = car.z; }
      hud.setDriving(car.model.name, 40);
    } else if (name === 'chase') {
      showScreen('play');
      setWanted(3, 'The deal went loud!');
      const car = G.parked[0];
      G.player.inCar = true; G.player.car = car; playerMesh.group.visible = false;
      car.x = 3.5; car.z = -100; car.heading = 0; car.speed = 20;
      G.player.x = car.x; G.player.z = car.z;
      // Three interceptors converge on the avenue — two from side streets, one from behind —
      // so the chase reads in-frame without ramming the player to a stop.
      G.policeCars.push(makePoliceCar(scene, -3.5, 60, Math.PI));
      G.policeCars.push(makePoliceCar(scene, 25, 120, -Math.PI / 2));
      G.policeCars.push(makePoliceCar(scene, -25, 150, Math.PI / 2));
      G.policeCars.push(makePoliceCar(scene, 3.5, -170, 0));
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
    renderer.render(scene, camera);
    if (name === 'start') hud.showObjective('Welcome to Solara Bay', 'Press Enter to start.');
  },
};

// ---------- main loop ----------
let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = Math.min((now - last) / 1000, 0.25);
  last = now;
  if (G.screen === 'play') {
    acc += dtReal;
    const input = readInput();
    while (acc >= STEP) { update(STEP, input); acc -= STEP; }
  } else if (G.screen === 'title') {
    // Living backdrop behind the title: traffic rolls, clouds drift.
    acc += dtReal;
    while (acc >= STEP) {
      G.elapsed += STEP;
      updateSky(STEP);
      for (const c of G.traffic) trafficStep(c, STEP, city, rng);
      for (const ped of G.peds) pedStep(ped, STEP, city, rng, null);
      G.camYaw += STEP * 0.03;
      updateCamera(STEP);
      renderer.render(scene, camera);
      acc -= STEP;
    }
  }
}

// ---------- boot ----------
spawnTraffic(12);
spawnPeds(22);
spawnParked();
playerMesh.group.position.set(G.player.x, 0, G.player.z);
refreshContinue();
hud.setCash(G.cash);
hud.setStars(0);
hud.setHealth(100, 0);
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
