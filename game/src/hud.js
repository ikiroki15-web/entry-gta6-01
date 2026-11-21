// HUD: DOM readouts plus a canvas minimap drawn from the live world.
import { CITY, intAmmo } from './config.js';

export function createHud() {
  const $ = id => document.getElementById(id);
  const els = {
    missionTitle: $('mission-title'), missionText: $('mission-text'), missionSub: $('mission-sub'),
    toast: $('toast'), stars: $('stars'), cash: $('cash'), clock: $('clock'), stash: $('stash'),
    health: $('health-fill'), armor: $('armor-fill'),
    speed: $('speed'), vehicle: $('vehicle-name'), hint: $('hint'),
    crosshair: $('crosshair'), ammo: $('ammo'), minimap: $('minimap'),
  };
  const mm = els.minimap.getContext('2d');
  let toastTimer = null;

  function showObjective(title, text) { els.missionTitle.textContent = title; els.missionText.textContent = text; }
  function setSub(text) { els.missionSub.textContent = text || ''; }
  function toast(text, ms) {
    els.toast.textContent = text; els.toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.style.display = 'none'; }, ms || 4200);
  }
  function setCash(v) { els.cash.innerHTML = '$' + v.toLocaleString('en-US') + ' <small>cash</small>'; }
  function setStash(n, total) { els.stash.textContent = `✦ ${n}/${total} Sun Stashes`; }
  function setStars(n) { els.stars.textContent = n > 0 ? '★'.repeat(n) + '☆'.repeat(5 - n) : ''; }
  function setHealth(h, armor) {
    els.health.style.width = Math.max(0, Math.min(100, h || 0)) + '%';
    els.armor.style.width = Math.max(0, Math.min(100, armor || 0)) + '%';
  }
  function setClock(hour) {
    const h = Math.floor(hour) % 24, m = Math.floor((hour % 1) * 60);
    els.clock.textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + (hour >= 18 || hour < 6 ? '  🌙' : '  ☀️');
  }
  function setDriving(name, kmh) {
    if (name) { els.speed.style.display = 'block'; els.speed.innerHTML = Math.round(kmh) + ' <small>km/h</small>'; els.vehicle.textContent = name; }
    else { els.speed.style.display = 'none'; els.vehicle.textContent = ''; }
  }
  function setArmed(armed, ammo, reserve) {
    els.crosshair.style.display = armed ? 'block' : 'none';
    els.ammo.style.display = armed ? 'block' : 'none';
    // Whole rounds only — a fractional reserve must never reach the HUD.
    if (armed) els.ammo.textContent = `🔫 ${intAmmo(ammo)} / ${intAmmo(reserve)}`;
  }
  function setHint(text) { els.hint.textContent = text; }

  function drawMinimap(world) {
    const S = 200;
    // World bounds: the city plus a margin, extended south so the pier
    // (which juts into the bay past the city edge) fits on the map.
    const xHalf = CITY.half + 40;
    const zMin = -(CITY.half + 40), zMax = CITY.half + 95;
    const xRange = xHalf * 2, zRange = zMax - zMin;
    const toMap = (x, z) => [((x + xHalf) / xRange) * S, ((z - zMin) / zRange) * S];
    mm.clearRect(0, 0, S, S);
    mm.fillStyle = '#16283a'; mm.fillRect(0, 0, S, S);
    // Bay (south edge).
    mm.fillStyle = '#1e7fa8';
    const [, bayY] = toMap(0, CITY.half);
    mm.fillRect(0, bayY, S, S - bayY);
    // Pier: a wooden strip reaching into the bay, with a marker dot.
    const pierPos = world.pierPos || world.city.pierPos || { x: CITY.half - 60, z: CITY.half + 40 };
    const [pierX0, pierZ0] = toMap(pierPos.x - 5, CITY.half + 25);
    const [pierX1, pierZ1] = toMap(pierPos.x + 5, CITY.half + 85);
    mm.fillStyle = '#a67c4a';
    mm.fillRect(pierX0, pierZ0, Math.max(2, pierX1 - pierX0), Math.max(2, pierZ1 - pierZ0));
    // Roads.
    mm.fillStyle = '#3a4048';
    for (const l of world.city.roadLines) {
      const [x] = toMap(l, 0); mm.fillRect(x - 2, 0, 4, S);
      const [, z] = toMap(0, l); mm.fillRect(0, z - 2, S, 4);
    }
    // Buildings.
    mm.fillStyle = '#5a6a7a';
    for (const b of world.city.buildings) {
      const [x, z] = toMap(b.x - b.w / 2, b.z - b.d / 2);
      const w = (b.w / xRange) * S, d = (b.d / zRange) * S;
      mm.fillRect(x, z, Math.max(1.5, w), Math.max(1.5, d));
    }
    const dot = (x, z, color, r) => { const [mx, mz] = toMap(x, z); mm.fillStyle = color; mm.beginPath(); mm.arc(mx, mz, r, 0, Math.PI * 2); mm.fill(); };
    // Mission target.
    if (world.missionTarget) dot(world.missionTarget.x, world.missionTarget.z, '#ffb300', 5);
    // Uncollected Sun Stashes.
    if (world.stashes) for (const s of world.stashes.list) if (!s.collected) dot(s.x, s.z, '#ffd54f', 3);
    // Pier marker.
    dot(pierPos.x, pierPos.z, '#d7a86a', 2.5);
    // Safe house: a blue square with a white edge, so it never reads as a cop.
    const [shX, shZ] = toMap(world.safehouse.x, world.safehouse.z);
    mm.fillStyle = '#42a5f5'; mm.fillRect(shX - 3, shZ - 3, 6, 6);
    mm.strokeStyle = '#fff'; mm.lineWidth = 1; mm.strokeRect(shX - 3, shZ - 3, 6, 6);
    // Police cars (red) and officers on foot (blue dots).
    for (const c of world.policeCars) if (c.alive) dot(c.x, c.z, '#ff5252', 3);
    if (world.footCops) for (const c of world.footCops) if (c.alive) dot(c.x, c.z, '#3d8bff', 2.5);
    // Traffic.
    mm.fillStyle = 'rgba(255,255,255,.75)';
    for (const c of world.traffic) if (c.alive) { const [mx, mz] = toMap(c.x, c.z); mm.fillRect(mx - 1, mz - 1, 2, 2); }
    // Player arrow.
    const [px, pz] = toMap(world.player.x, world.player.z);
    mm.save(); mm.translate(px, pz); mm.rotate(Math.PI - world.player.heading);
    mm.fillStyle = '#fff'; mm.beginPath(); mm.moveTo(0, -7); mm.lineTo(5, 5); mm.lineTo(-5, 5); mm.closePath(); mm.fill();
    mm.restore();
    // North tick.
    mm.fillStyle = '#fff'; mm.font = 'bold 11px sans-serif'; mm.fillText('N', S / 2 - 4, 12);
  }

  return { showObjective, setSub, toast, setCash, setStash, setStars, setHealth, setClock, setDriving, setArmed, setHint, drawMinimap, els };
}
