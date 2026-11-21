// Shared constants and the story's mission chain. All names, places and people are original.
// The 17.8 golden-hour shot time lives in main.js staging, not here, so normal play still starts at 08:00.
export const SAVE_KEY = 'solara-bay-save-v1';
export const STEP = 1 / 60;
export const CITY = {
  blocks: 8,          // blocks per side
  block: 40,          // block size (m)
  road: 14,           // road width (m)
  half: 0,            // filled in by city.js
};
CITY.pitch = CITY.block + CITY.road;
CITY.half = (CITY.blocks * CITY.pitch) / 2;

export const PLAYER = { walk: 6, run: 10.5, health: 100, radius: 0.6 };
export const CAR = { maxSpeed: 38, accel: 16, brake: 30, steer: 1.9, health: 100 };
// Armor: Rico starts with a half-full vest. It soaks half of every hit
// until it is gone; the Safe House (and only the Safe House) refills it.
export const ARMOR = { start: 50, max: 100, absorb: 0.5 };
// Brief invulnerability after any hit lands, so a surrounded player on
// foot cannot be deleted in under a second by stacked melee ticks.
export const IFRAME_SECONDS = 0.3;

export const CAR_MODELS = [
  { name: 'Solano Comet', color: 0xd43d2a, speed: 1.0, body: 'sedan' },
  { name: 'Vento GT', color: 0x2a6fd4, speed: 1.12, body: 'sport' },
  { name: 'Marlin Taxi', color: 0xf2c200, speed: 0.92, body: 'taxi' },
  { name: 'Palma Pickup', color: 0x4d8a3f, speed: 0.95, body: 'pickup' },
  { name: 'Bayside Van', color: 0xe8e4da, speed: 0.85, body: 'van' },
  { name: 'Solano Luxe', color: 0x22242a, speed: 1.05, body: 'sedan' },
  { name: 'Coral Coupe', color: 0xe26aa0, speed: 1.1, body: 'sport' },
  { name: 'Dune Buggy', color: 0xd98a2b, speed: 0.98, body: 'buggy' },
];

// Missions: id, title, briefing, kind. The state machine lives in missions.js.
export const MISSIONS = [
  {
    id: 'wheels', title: 'Job 1 — First Wheels',
    brief: 'Mara needs wheels. Steal any car — or take the Comet parked by the garage — and drive to the yellow marker at Mara\'s Garage.',
    kind: 'driveTo', reward: 150,
  },
  {
    id: 'delivery', title: 'Job 2 — Sunny Deliveries',
    brief: 'Mara has three packages for the boardwalk shops. Drive to each gold marker before the timer runs out. No police attention, please.',
    kind: 'deliver', reward: 350, timeLimit: 150,
  },
  {
    id: 'debt', title: 'Job 3 — The Debt',
    brief: 'Lenny "the Anchor" Ruiz owes Mara $800 and is hiding near the pier. Go on foot, convince him — fists or pistol — then take the cash and get back to the garage.',
    kind: 'fight', reward: 800,
  },
  {
    id: 'heat', title: 'Job 4 — Hot Afternoon',
    brief: 'A deal went loud. The police are on you — 3 stars. Lose them: break line of sight, then reach the blue safe-house marker with no stars left.',
    kind: 'escape', reward: 500,
  },
  {
    id: 'score', title: 'Job 5 — The Big Score',
    brief: 'The Meridian Bank on Ocean Drive. Grab the cash, then outrun a 4-star response to the safe house. Finish this and Solara Bay is yours, Rico.',
    kind: 'heist', reward: 2500,
  },
];

export const STORY_END = 'Solara Bay is yours. Mara slides the last envelope across the table and smiles: "Not bad for a guy who got out with forty bucks." — THE END. Free roam continues: keep driving, keep the stars down, keep the city.';

// ---------- pure helpers (no DOM, no THREE — unit-testable in Node) ----------

// A finite number or the fallback. Strings, booleans, NaN and Infinity
// from a hand-edited save are never trusted as numbers.
function numOr(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function clampNum(v, min, max, fallback) {
  return Math.max(min, Math.min(max, numOr(v, fallback)));
}

// Ammo is always a whole number of rounds, at display and at consumption.
export function intAmmo(v) {
  return Math.max(0, Math.floor(numOr(v, 0)));
}

// Armor split: the vest absorbs ARMOR.absorb of the hit while it lasts,
// the rest (plus whatever the vest could not cover) reaches health.
export function applyDamage(health, armor, amount) {
  const h = clampNum(health, 0, 100, 100);
  const a = clampNum(armor, 0, ARMOR.max, 0);
  const dmg = Math.max(0, numOr(amount, 0));
  if (dmg <= 0) return { health: h, armor: a };
  const absorbed = Math.min(a, dmg * ARMOR.absorb);
  return {
    health: Math.max(0, h - (dmg - absorbed)),
    armor: Math.max(0, a - absorbed),
  };
}

// Fractional heat for non-lethal aggression (a punch, a reckless bump):
// small offences add fractions of a star; each whole star is reported
// back so the caller can raise the wanted level, the rest carries over.
export function addHeat(heat, amount) {
  const total = Math.max(0, numOr(heat, 0)) + Math.max(0, numOr(amount, 0));
  const stars = Math.floor(total);
  return { heat: total - stars, stars };
}

// Validate a parsed save before anything trusts it. Every field is
// type-checked and clamped to its legal range; anything missing or
// malformed falls back to a fresh-run default, so a partly corrupt save
// still loads as a playable game instead of poisoning the state.
// Returns null only when the save is not an object at all.
export function sanitizeSave(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const bound = CITY.half + 40;
  const spawnX = -CITY.half + CITY.pitch / 2 + 10;
  const spawnZ = -CITY.half + CITY.pitch / 2 + 14;
  const timeRaw = numOr(raw.time, 8);
  const stashes = Array.isArray(raw.stashes)
    ? Array.from({ length: 8 }, (_, i) => !!raw.stashes[i])
    : Array.from({ length: 8 }, () => false);
  return {
    cash: Math.floor(clampNum(raw.cash, 0, 999999999, 40)),
    // A saved health of 0 would load Rico already dead — clamp to alive.
    health: clampNum(raw.health, 1, 100, 100),
    armor: clampNum(raw.armor, 0, ARMOR.max, ARMOR.start),
    missionIndex: Math.floor(clampNum(raw.missionIndex, 0, MISSIONS.length, 0)),
    x: clampNum(raw.x, -bound, bound, spawnX),
    z: clampNum(raw.z, -bound, CITY.half + 80, spawnZ),
    wanted: Math.floor(clampNum(raw.wanted, 0, 5, 0)),
    ammo: Math.floor(clampNum(raw.ammo, 0, 12, 12)),
    reserve: Math.floor(clampNum(raw.reserve, 0, 999, 36)),
    time: ((timeRaw % 24) + 24) % 24,
    stashes,
  };
}
