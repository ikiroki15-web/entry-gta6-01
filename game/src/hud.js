// HUD: DOM readouts plus a canvas minimap drawn from the live world.
import { CITY } from './config.js';

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
    els.health.style.width = Math.max(0, h) + '%';
    els.armor.style.width = Math.max(0, armor || 0) + '%';
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
    if (armed) els.ammo.textContent = `🔫 ${ammo} / ${reserve}`;
  }
  function setHint(text) { els.hint.textContent = text; }

  function drawMinimap(world) {
    const S = 200, half = CITY.half + 40;
    const toMap = (x, z) => [((x + half) / (half * 2)) * S, ((z + half) / (half * 2)) * S];
    mm.clearRect(0, 0, S, S);
    mm.fillStyle = '#16283a'; mm.fillRect(0, 0, S, S);
    // Bay (south edge).
    mm.fillStyle = '#1e7fa8';
    const [, bayY] = toMap(0, CITY.half);
    mm.fillRect(0, bayY, S, S - bayY);
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
      const w = (b.w / (half * 2)) * S, d = (b.d / (half * 2)) * S;
      mm.fillRect(x, z, Math.max(1.5, w), Math.max(1.5, d));
    }
    const dot = (x, z, color, r) => { const [mx, mz] = toMap(x, z); mm.fillStyle = color; mm.beginPath(); mm.arc(mx, mz, r, 0, Math.PI * 2); mm.fill(); };
    // Mission target.
    if (world.missionTarget) dot(world.missionTarget.x, world.missionTarget.z, '#ffb300', 5);
    // Uncollected Sun Stashes.
    if (world.stashes) for (const s of world.stashes.list) if (!s.collected) dot(s.x, s.z, '#ffd54f', 3);
    // Safe house.
    dot(world.safehouse.x, world.safehouse.z, '#42a5f5', 3);
    // Police.
    for (const c of world.policeCars) if (c.alive) dot(c.x, c.z, '#ff5252', 3);
    // Traffic.
    mm.fillStyle = 'rgba(255,255,255,.75)';
    for (const c of world.traffic) if (c.alive) { const [mx, mz] = toMap(c.x, c.z); mm.fillRect(mx - 1, mz - 1, 2, 2); }
    // Player arrow.
    const [px, pz] = toMap(world.player.x, world.player.z);
    mm.save(); mm.translate(px, pz); mm.rotate(-world.player.heading);
    mm.fillStyle = '#fff'; mm.beginPath(); mm.moveTo(0, -7); mm.lineTo(5, 5); mm.lineTo(-5, 5); mm.closePath(); mm.fill();
    mm.restore();
    // North tick.
    mm.fillStyle = '#fff'; mm.font = 'bold 11px sans-serif'; mm.fillText('N', S / 2 - 4, 12);
  }

  return { showObjective, setSub, toast, setCash, setStash, setStars, setHealth, setClock, setDriving, setArmed, setHint, drawMinimap, els };
}
