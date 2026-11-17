// Cars, traffic, police and pedestrians. All built from boxes — no borrowed models.
import { CAR, CAR_MODELS, CITY } from './config.js';

const WHEEL_GEO = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
const WHEEL_MAT = new THREE.MeshLambertMaterial({ color: 0x14161a });

export function buildCarMesh(model) {
  const g = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color: model.color });
  const glass = new THREE.MeshLambertMaterial({ color: 0x1c2f42 });
  const isVan = model.body === 'van', isPickup = model.body === 'pickup';
  const len = isVan ? 5.2 : model.body === 'sport' ? 4.4 : 4.6;
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, len), paint);
  body.position.y = 0.65; body.castShadow = true; g.add(body);
  const cabinH = isVan ? 1.0 : 0.62;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, cabinH, isVan ? 3.4 : 2.2), isVan ? paint : glass);
  cabin.position.set(0, 1.3, isVan ? -0.4 : (isPickup ? 0.5 : -0.2)); cabin.castShadow = true; g.add(cabin);
  if (isPickup) {
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.45, 1.8), new THREE.MeshLambertMaterial({ color: 0x2c2f33 }));
    bed.position.set(0, 1.05, -1.3); g.add(bed);
  }
  if (model.body === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.5), new THREE.MeshLambertMaterial({ color: 0xf5e9c8 }));
    sign.position.set(0, 1.75, -0.2); g.add(sign);
  }
  if (model.body === 'sport') {
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.4), new THREE.MeshLambertMaterial({ color: 0x14161a }));
    spoiler.position.set(0, 1.25, -len / 2 + 0.2); g.add(spoiler);
  }
  const head = new THREE.MeshLambertMaterial({ color: 0xfff6c8, emissive: 0x887733 });
  for (const s of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.1), head);
    lamp.position.set(s * 0.65, 0.7, len / 2 + 0.03); g.add(lamp);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.1), new THREE.MeshLambertMaterial({ color: 0xaa1111, emissive: 0x550000 }));
    tail.position.set(s * 0.65, 0.7, -len / 2 - 0.03); g.add(tail);
  }
  const wheels = [];
  for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const w = new THREE.Mesh(WHEEL_GEO, WHEEL_MAT);
    w.rotation.z = Math.PI / 2; w.position.set(wx, 0.38, wz); g.add(w); wheels.push(w);
  }
  g.userData.length = len;
  return { group: g, wheels };
}

export function makeCar(scene, model, x, z, heading, kind) {
  const { group, wheels } = buildCarMesh(model);
  group.position.set(x, 0, z);
  group.rotation.y = heading;
  scene.add(group);
  return {
    kind: kind || 'traffic', model, mesh: group, wheels,
    x, z, heading, speed: 0, steer: 0,
    driver: null, // ped inside (for stealable traffic cars)
    alive: true, wanted: false, stuck: 0,
    length: group.userData.length,
  };
}

export function makePoliceCar(scene, x, z, heading) {
  const model = { name: 'SBPD Interceptor', color: 0x1a2a3a, speed: 1.18, body: 'sedan' };
  const car = makeCar(scene, model, x, z, heading, 'police');
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.4),
    new THREE.MeshLambertMaterial({ color: 0x2266ff, emissive: 0x1144aa }));
  bar.position.set(0, 1.72, -0.2); car.mesh.add(bar);
  const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.42),
    new THREE.MeshLambertMaterial({ color: 0xff2222, emissive: 0xaa0000 }));
  red.position.set(-0.28, 1.72, -0.2); car.mesh.add(red);
  car.lightBar = bar; car.lightRed = red;
  return car;
}

// --- pedestrians ------------------------------------------------------------
const SHIRTS = [0xd95f4b, 0x4b7fd9, 0x58b368, 0xd9b84b, 0x9b59b6, 0xe8e4da, 0x3a3f46, 0xe27a9a];
export function makePed(scene, rng, x, z) {
  const g = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: SHIRTS[Math.floor(rng.next() * SHIRTS.length)] });
  const skin = new THREE.MeshLambertMaterial({ color: [0xe8b88a, 0xc98d5f, 0x8a5a35][Math.floor(rng.next() * 3)] });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.85, 0.32), shirt);
  body.position.y = 1.05; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.34), skin);
  head.position.y = 1.72; g.add(head);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.3), new THREE.MeshLambertMaterial({ color: 0x2c3440 }));
  legs.position.y = 0.38; g.add(legs);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.7, 0.14), shirt);
  armL.position.set(-0.36, 1.05, 0); g.add(armL);
  const armR = armL.clone(); armR.position.x = 0.36; g.add(armR);
  g.position.set(x, 0, z);
  scene.add(g);
  return {
    kind: 'ped', mesh: g, armL, armR, x, z, heading: rng.range(0, Math.PI * 2),
    speed: rng.range(1.1, 1.9), state: 'walk', panic: 0, health: 30,
    target: null, wait: 0, alive: true, phase: rng.range(0, Math.PI * 2),
  };
}

export function makePlayerMesh(scene) {
  const g = new THREE.Group();
  const jacket = new THREE.MeshLambertMaterial({ color: 0x8a2f23 });
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b88a });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.85, 0.35), jacket);
  body.position.y = 1.05; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.36), skin);
  head.position.y = 1.74; g.add(head);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.38), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
  hair.position.y = 1.95; g.add(hair);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.32), new THREE.MeshLambertMaterial({ color: 0x2c3440 }));
  legs.position.y = 0.4; g.add(legs);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.72, 0.15), jacket);
  armL.position.set(-0.4, 1.05, 0); g.add(armL);
  const armR = armL.clone(); armR.position.x = 0.4; g.add(armR);
  // A simple pistol in the right hand when armed.
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.42), new THREE.MeshLambertMaterial({ color: 0x181a1c }));
  gun.position.set(0.4, 0.72, 0.25); gun.visible = false; g.add(gun);
  scene.add(g);
  return { group: g, armL, armR, gun };
}

// If a car starts overlapped with a building (a bad spawn), push it out along the
// smallest clear step instead of leaving it wedged against the wall.
function resolveOverlap(car, city) {
  if (!city.collideCircle(car.x, car.z, 1.3)) return;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
    for (let step = 1; step <= 8; step += 1) {
      const nx = car.x + dx * 0.5 * step, nz = car.z + dz * 0.5 * step;
      if (!city.collideCircle(nx, nz, 1.3)) { car.x = nx; car.z = nz; return; }
    }
  }
}

// --- arcade car physics ------------------------------------------------------
export function driveCar(car, input, dt, city) {
  resolveOverlap(car, city);
  const max = CAR.maxSpeed * car.model.speed;
  if (input.forward) car.speed += CAR.accel * dt;
  if (input.back) car.speed -= (car.speed > 0.5 ? CAR.brake : CAR.accel * 0.6) * dt;
  if (!input.forward && !input.back) car.speed -= Math.sign(car.speed) * 6 * dt;
  if (input.handbrake) car.speed -= Math.sign(car.speed) * 22 * dt;
  if (Math.abs(car.speed) < 0.15 && !input.forward && !input.back) car.speed = 0;
  car.speed = Math.max(-max * 0.4, Math.min(max, car.speed));
  const steerTarget = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  car.steer += (steerTarget - car.steer) * Math.min(1, dt * 8);
  const dir = car.speed >= 0 ? 1 : -1;
  car.heading += car.steer * CAR.steer * dir * Math.min(1, Math.abs(car.speed) / 8) * dt * (input.handbrake ? 1.6 : 1);
  const nx = car.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.z + Math.cos(car.heading) * car.speed * dt;
  const hit = city.collideCircle(nx, nz, 1.3);
  if (hit) {
    // Slide along the wall instead of stopping dead.
    const hitX = city.collideCircle(nx, car.z, 1.3);
    const hitZ = city.collideCircle(car.x, nz, 1.3);
    if (!hitX) car.x = nx;
    if (!hitZ) car.z = nz;
    if (hitX && hitZ) { car.speed *= 0.4; }
    return true;
  }
  car.x = nx; car.z = nz;
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  // Body roll and wheel spin for feel.
  car.mesh.rotation.z = -car.steer * Math.min(1, Math.abs(car.speed) / 20) * 0.06;
  const spin = car.speed * dt * 2.4;
  for (const w of car.wheels) w.rotation.x += spin;
  car.wheels[0].rotation.y = car.steer * 0.4;
  car.wheels[1].rotation.y = car.steer * 0.4;
  return false;
}

// --- traffic AI: follow the road grid, turn at intersections -----------------
export function trafficStep(car, dt, city, rng) {
  if (!car.alive) return;
  const target = 9 * car.model.speed;
  car.speed += (target - car.speed) * Math.min(1, dt * 0.8);
  // Are we near an intersection? Maybe turn.
  const nearX = city.roadLines.some(l => Math.abs(car.x - l) < 2.5);
  const nearZ = city.roadLines.some(l => Math.abs(car.z - l) < 2.5);
  if (nearX && nearZ && rng.next() < dt * 0.5) {
    car.heading = (Math.floor(car.heading / (Math.PI / 2)) + (rng.chance(0.5) ? 1 : -1)) * (Math.PI / 2) + rng.range(-0.05, 0.05);
  }
  // Snap heading gently toward the nearest axis so cars stay on roads.
  const snapped = Math.round(car.heading / (Math.PI / 2)) * (Math.PI / 2);
  let dh = snapped - car.heading;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  car.heading += dh * Math.min(1, dt * 2);
  // Keep to the right-hand lane: offset perpendicular to heading.
  const nx = car.x + Math.sin(car.heading) * car.speed * dt + Math.cos(car.heading) * 0; // lane offset baked in spawn
  const nz = car.z + Math.cos(car.heading) * car.speed * dt;
  const hit = city.collideCircle(nx, nz, 1.3);
  if (hit || Math.abs(nx) > CITY.half + 20 || Math.abs(nz) > CITY.half + 20) {
    car.heading += Math.PI / 2; // turn away from the blockage / edge
    car.stuck += 1;
  } else {
    car.x = nx; car.z = nz;
  }
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  const spin = car.speed * dt * 2.4;
  for (const w of car.wheels) w.rotation.x += spin;
}

// --- pedestrian AI -----------------------------------------------------------
export function pedStep(ped, dt, city, rng, danger) {
  if (!ped.alive) return;
  if (ped.panic > 0) {
    ped.panic -= dt;
    ped.speed = 4.2;
  } else ped.speed = 1.4;
  if (ped.wait > 0) { ped.wait -= dt; return; }
  const px = ped.x + Math.sin(ped.heading) * ped.speed * dt;
  const pz = ped.z + Math.cos(ped.heading) * ped.speed * dt;
  const onSidewalk = !city.isRoad(px, pz);
  const hit = city.collideCircle(px, pz, 0.5);
  if (hit || !onSidewalk && ped.panic <= 0 && rng.next() < 0.3) {
    // Turn onto the sidewalk: pick a new heading along the block edge.
    ped.heading = rng.range(0, Math.PI * 2);
    ped.wait = rng.range(0.2, 1.2);
    return;
  }
  if (danger && Math.hypot(danger.x - ped.x, danger.z - ped.z) < 14) {
    ped.panic = 3;
    ped.heading = Math.atan2(ped.x - danger.x, ped.z - danger.z);
  }
  ped.x = px; ped.z = pz;
  const clamped = city.clampToCity(ped.x, ped.z);
  ped.x = clamped.x; ped.z = clamped.z;
  ped.mesh.position.set(ped.x, 0, ped.z);
  ped.mesh.rotation.y = ped.heading;
  // Arm swing from accumulated game-time phase, so the same seed stages the same frame.
  ped.phase += dt * 8 * ped.speed;
  const swing = Math.sin(ped.phase) * 0.5;
  ped.armL.rotation.x = swing; ped.armR.rotation.x = -swing;
}
