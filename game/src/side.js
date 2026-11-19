// Sun Stashes: hidden cash pickups scattered around Solara Bay — a small side
// activity that rewards exploring the city on foot or by car. Each stash is a
// spinning gold gem with a ground ring; drive or walk close to grab $50.
import { CITY } from './config.js';

const STASH_VALUE = 50;

export function createSunStashes(scene, rng, city) {
  const gold = new THREE.MeshLambertMaterial({ color: 0xffb300, emissive: 0x7a5200 });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0.8 });
  // Three fixed spots the screenshots can see: one by Mara's Garage where Rico
  // starts, one on the avenue the drive shot cruises, one ahead of the chase.
  const spots = [
    { x: city.garage.x + 19, z: city.garage.z + 21 },
    { x: 8.5, z: 130 },
    { x: 8.5, z: 20 },
  ];
  while (spots.length < 8) {
    const x = rng.range(-CITY.half + 20, CITY.half - 20);
    const z = rng.range(-CITY.half + 20, CITY.half - 20);
    if (city.isRoad(x, z) || city.collideCircle(x, z, 1)) continue;
    spots.push({ x, z });
  }
  const list = [];
  for (const s of spots) {
    const group = new THREE.Group();
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.9), gold);
    gem.position.y = 1.1; gem.castShadow = true; group.add(gem);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.12, 8, 24), ringMat);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.25; group.add(ring);
    group.position.set(s.x, 0, s.z);
    scene.add(group);
    list.push({ x: s.x, z: s.z, mesh: group, gem, collected: false, phase: rng.range(0, Math.PI * 2) });
  }
  return { list, collected: 0, total: list.length, value: STASH_VALUE };
}

export function updateSunStashes(stashSet, player, dt, elapsed, onCollect) {
  for (const s of stashSet.list) {
    if (s.collected) continue;
    s.gem.rotation.y += dt * 2;
    s.gem.position.y = 1.1 + Math.sin(elapsed * 2 + s.phase) * 0.25;
    if (Math.hypot(player.x - s.x, player.z - s.z) < 2.6) {
      s.collected = true;
      s.mesh.visible = false;
      stashSet.collected += 1;
      onCollect(s);
    }
  }
}

// Stash state is saveable data, not scenery: which gems are already taken
// goes into the save (and comes back on load), so save/load can't re-farm
// the same $50 stash, and a New Game can reset them all in one place.
export function stashSaveData(stashSet) {
  return stashSet.list.map(s => s.collected);
}
export function restoreSunStashes(stashSet, collected) {
  if (!Array.isArray(collected)) return;
  stashSet.collected = 0;
  stashSet.list.forEach((s, i) => {
    s.collected = !!collected[i];
    s.mesh.visible = !s.collected;
    if (s.collected) stashSet.collected += 1;
  });
}
export function resetSunStashes(stashSet) {
  stashSet.collected = 0;
  for (const s of stashSet.list) { s.collected = false; s.mesh.visible = true; }
}
