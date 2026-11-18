// The city of Solara Bay: a seeded grid of blocks, roads, towers, a beach and a bay.
// Everything is built from boxes and canvas textures made in code — no external assets.
// Stash spots are placed on walkable ground: isRoad/collideCircle keep them off roads and out of walls.
import { CITY } from './config.js';

function makeWindowTexture(rng, base, lit) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 256);
  const cols = 5, rows = 12;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const on = rng.next() < lit;
      g.fillStyle = on ? '#ffd97a' : (rng.next() < 0.5 ? '#1d2f45' : '#2c4a66');
      g.fillRect(8 + x * 24, 10 + y * 20, 15, 12);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeRoadTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#2b2f36'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#f5c542'; g.fillRect(61, 0, 6, 128);
  g.fillStyle = '#e8e8e8';
  for (let y = 0; y < 128; y += 32) { g.fillRect(6, y, 4, 18); g.fillRect(118, y, 4, 18); }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createCity(rng, scene) {
  const { blocks, block, road, pitch, half } = CITY;
  const colliders = [];   // {minX,maxX,minZ,maxZ}
  const buildings = [];   // {x,z,w,d,h}
  const roadLines = [];   // road centre lines, for AI: x positions and z positions
  for (let i = 0; i <= blocks; i += 1) roadLines.push(-half + i * pitch);

  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5a, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe8b0, 1.6);
  sun.position.set(120, 180, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -260; sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260; sun.shadow.camera.bottom = -260;
  sun.shadow.camera.far = 600;
  scene.add(sun);
  scene.fog = new THREE.Fog(0xcfe4f5, 320, 900);

  // Sky dome + sun disc + drifting clouds.
  const skyGeo = new THREE.SphereGeometry(850, 24, 16);
  const skyMat = new THREE.MeshBasicMaterial({ color: 0x7ec3ee, side: THREE.BackSide, fog: false });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);
  const clouds = [];
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, fog: false });
  for (let i = 0; i < 14; i += 1) {
    const cl = new THREE.Group();
    for (let j = 0; j < 3; j += 1) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(rng.range(8, 18), 10, 8), cloudMat);
      s.position.set(j * 12 - 12, rng.range(-1, 2), rng.range(-4, 4));
      s.scale.y = 0.45; cl.add(s);
    }
    cl.position.set(rng.range(-500, 500), rng.range(120, 190), rng.range(-500, 500));
    scene.add(cl); clouds.push(cl);
  }

  // Ground: grass-green city slab, sand strip and the bay to the south (+z).
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2 + 400, half * 2 + 400),
    new THREE.MeshLambertMaterial({ color: 0x6f9e5a }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.05, 0); ground.receiveShadow = true;
  scene.add(ground);
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2 + 400, 60),
    new THREE.MeshLambertMaterial({ color: 0xe8d49a }));
  sand.rotation.x = -Math.PI / 2; sand.position.set(0, 0.02, half + 30);
  scene.add(sand);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2 + 400, 300),
    new THREE.MeshLambertMaterial({ color: 0x1e7fa8, transparent: true, opacity: 0.9 }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, 0.0, half + 210);
  scene.add(water);

  // Roads: dark strips with centre dashes, plus crosswalks at intersections.
  const roadTex = makeRoadTexture();
  const roadMat = new THREE.MeshLambertMaterial({ map: roadTex });
  const crossMat = new THREE.MeshLambertMaterial({ color: 0xd8d8d8 });
  for (const line of roadLines) {
    for (const horizontal of [true, false]) {
      const tex = roadTex.clone(); tex.needsUpdate = true;
      tex.repeat.set(horizontal ? 16 : 1, horizontal ? 1 : 16);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 + 4, road), new THREE.MeshLambertMaterial({ map: tex }));
      m.rotation.x = -Math.PI / 2;
      if (horizontal) { m.rotation.z = Math.PI / 2; m.position.set(line, 0.05, 0); }
      else m.position.set(0, 0.05, line);
      m.receiveShadow = true; scene.add(m);
    }
    for (const other of roadLines) {
      const cw = new THREE.Mesh(new THREE.PlaneGeometry(road * 0.9, road * 0.9), crossMat);
      cw.rotation.x = -Math.PI / 2; cw.position.set(line, 0.06, other);
      scene.add(cw);
    }
  }

  // Buildings: one or two towers per block, heights by district (taller near the centre).
  const palettes = ['#c9a37e', '#b98a6d', '#8fa3b8', '#a8b8a0', '#d0b48f', '#9a8fb0', '#c7d3de', '#e0cfa8'];
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x3a3f46 });
  for (let bx = 0; bx < blocks; bx += 1) {
    for (let bz = 0; bz < blocks; bz += 1) {
      const cx = -half + bx * pitch + pitch / 2;
      const cz = -half + bz * pitch + pitch / 2;
      const dist = Math.max(Math.abs(cx), Math.abs(cz)) / half;
      const count = rng.chance(0.35) ? 2 : 1;
      for (let k = 0; k < count; k += 1) {
        const w = rng.range(12, count === 1 ? 30 : 15);
        const d = rng.range(12, count === 1 ? 30 : 15);
        const h = rng.range(9, 18) + (1 - dist) * rng.range(10, 42);
        const ox = count === 1 ? 0 : (k === 0 ? -9 : 9);
        const oz = count === 1 ? 0 : (k === 0 ? -9 : 9);
        const x = cx + ox, z = cz + oz;
        const base = palettes[Math.floor(rng.next() * palettes.length)];
        const tex = makeWindowTexture(rng, base, 0.22);
        const mat = new THREE.MeshLambertMaterial({ map: tex });
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        b.position.set(x, h / 2, z);
        b.castShadow = true; b.receiveShadow = true;
        scene.add(b);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.8, d + 0.6), roofMat);
        roof.position.set(x, h + 0.4, z); scene.add(roof);
        // Roof box (AC unit / water tank) for silhouette variety.
        if (rng.chance(0.6)) {
          const unit = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 3), roofMat);
          unit.position.set(x + rng.range(-w / 4, w / 4), h + 1.6, z + rng.range(-d / 4, d / 4));
          scene.add(unit);
        }
        colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
        buildings.push({ x, z, w, d, h });
      }
      // Palm trees on block corners.
      for (let p = 0; p < 2; p += 1) {
        const px = cx + rng.range(-16, 16), pz = cz + rng.range(-16, 16);
        if (colliders.some(c => px > c.minX - 2 && px < c.maxX + 2 && pz > c.minZ - 2 && pz < c.maxZ + 2)) continue;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 6, 6),
          new THREE.MeshLambertMaterial({ color: 0x7a5a36 }));
        trunk.position.set(px, 3, pz); trunk.rotation.z = rng.range(-0.12, 0.12); trunk.castShadow = true;
        scene.add(trunk);
        const top = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 6),
          new THREE.MeshLambertMaterial({ color: 0x3f8f3a }));
        top.position.set(px, 6.4, pz); top.scale.y = 0.55; scene.add(top);
      }
    }
  }

  // Street lamps along the roads.
  const lampMat = new THREE.MeshLambertMaterial({ color: 0x2a2e33 });
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  const lamps = [];
  for (const line of roadLines) {
    for (let t = -half + 20; t < half; t += 54) {
      for (const [x, z] of [[line + 8, t], [line - 8, t + 27]]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7, 6), lampMat);
        pole.position.set(x, 3.5, z); scene.add(pole);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), bulbMat);
        bulb.position.set(x, 7.1, z); scene.add(bulb); lamps.push(bulb);
      }
    }
  }

  // Landmarks: the Meridian Bank (heist target), Mara's Garage, the clinic, the pier.
  function landmark(x, z, w, h, d, color, label) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
    m.position.set(x, h / 2, z); m.castShadow = true; scene.add(m);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    buildings.push({ x, z, w, d, h, label });
    return { x, z };
  }
  const garage = landmark(-half + pitch / 2, -half + pitch / 2, 26, 9, 20, 0xd98a2b, "Mara's Garage");
  const bank = landmark(half - pitch / 2, -half + pitch / 2, 30, 16, 22, 0xd8d3c4, 'Meridian Bank');
  const clinic = landmark(-half + pitch / 2, half - pitch / 2, 24, 12, 18, 0xe8eef2, 'Solara Clinic');
  // Pier jutting into the bay.
  const pier = new THREE.Mesh(new THREE.BoxGeometry(10, 1, 60), new THREE.MeshLambertMaterial({ color: 0x8a6a42 }));
  pier.position.set(half - 60, 0.6, half + 55); scene.add(pier);

  // Mission marker beacon (reused, moved by missions.js).
  const beacon = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 60, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffb300, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  beam.position.y = 30; beacon.add(beam);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3, 0.35, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0xffb300 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.4; beacon.add(ring);
  beacon.visible = false; scene.add(beacon);

  function isRoad(x, z) {
    // Inside a road strip (or the beach/south strip) counts as road.
    for (const line of roadLines) {
      if (Math.abs(x - line) < road / 2 + 1) return true;
      if (Math.abs(z - line) < road / 2 + 1) return true;
    }
    return z > half - 2;
  }
  function collideCircle(x, z, r) {
    for (const c of colliders) {
      if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) return c;
    }
    return null;
  }
  function nearestRoadPoint(x, z) {
    let bx = roadLines[0], bz = roadLines[0];
    for (const l of roadLines) { if (Math.abs(l - x) < Math.abs(bx - x)) bx = l; if (Math.abs(l - z) < Math.abs(bz - z)) bz = l; }
    return Math.abs(bx - x) < Math.abs(bz - z) ? { x: bx, z } : { x, z: bz };
  }

  return {
    sun, sky, skyMat, hemi, clouds, water, lamps, beacon, beam, ring,
    colliders, buildings, roadLines, garage, bank, clinic, pierPos: { x: half - 60, z: half + 40 },
    isRoad, collideCircle, nearestRoadPoint,
    clampToCity(x, z) {
      const m = half + 40;
      return { x: Math.max(-m, Math.min(m, x)), z: Math.max(-m, Math.min(half + 80, z)) };
    },
  };
}
