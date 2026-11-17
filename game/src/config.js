// Shared constants and the story's mission chain. All names, places and people are original.
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
export const CAR = { maxSpeed: 38, accel: 16, brake: 30, steer: 1.9 };

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
