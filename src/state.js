export const DEFAULT_STATE = {
  species: "duck",
  name: "Quack",
  hunger: 80,
  happiness: 80,
  energy: 100,
  xp: 0,
  level: 1,
  hatchedAt: Date.now(),
  lastFed: Date.now(),
  lastPlayed: Date.now(),
  lastTick: Date.now(),
  // idleAt is bumped on every state write. The LRU sweeper uses it
  // to decide which session files to delete.
  idleAt: Date.now(),
  state: "idle",
  stateUntil: 0,
  stateReason: "",
};

const CLAMP = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

// Late-night hours (23:00-05:00 local) drain energy 1.5x as fast.
function nightMultiplier(now) {
  const h = new Date(now).getHours();
  return h >= 23 || h < 5 ? 1.5 : 1;
}

export function tick(state, now = Date.now()) {
  const minutes = (now - state.lastTick) / 60_000;
  if (minutes <= 0) return state;
  const sleeping = state.state === "sleeping";
  const nightMul = nightMultiplier(now);
  return {
    ...state,
    hunger: CLAMP(state.hunger - 0.3 * minutes),
    happiness: CLAMP(state.happiness - 0.2 * minutes),
    energy: sleeping
      ? CLAMP(state.energy + 1.0 * minutes)
      : CLAMP(state.energy - 0.15 * minutes * nightMul),
    lastTick: now,
  };
}

export function feed(state) {
  return {
    ...state,
    hunger: CLAMP(state.hunger + 25),
    energy: CLAMP(state.energy - 5),
    lastFed: Date.now(),
    lastTick: Date.now(),
  };
}

export function play(state) {
  const next = {
    ...state,
    happiness: CLAMP(state.happiness + 15),
    energy: CLAMP(state.energy - 10),
    hunger: CLAMP(state.hunger - 5),
    lastPlayed: Date.now(),
    lastTick: Date.now(),
    xp: state.xp + 1,
  };
  return maybeLevelUp(next);
}

export function rest(state) {
  return { ...state, energy: CLAMP(state.energy + 30), lastTick: Date.now() };
}

export function rename(state, name) {
  return { ...state, name: String(name).slice(0, 20), lastTick: Date.now() };
}

export function switchSpecies(state, species) {
  return { ...state, species, lastTick: Date.now() };
}

export function hatch(overrides = {}) {
  return {
    ...DEFAULT_STATE,
    ...overrides,
    lastTick: Date.now(),
  };
}

export function celebrate(state) {
  return {
    ...state,
    state: "celebrating",
    stateUntil: Date.now() + 4000,
    lastTick: Date.now(),
  };
}

export function scared(state) {
  return {
    ...state,
    state: "scared",
    stateUntil: Date.now() + 5000,
    lastTick: Date.now(),
  };
}

export function working(state) {
  if (state.state === "celebrating" && Date.now() < state.stateUntil) return state;
  if (state.state === "scared" && Date.now() < state.stateUntil) return state;
  return { ...state, state: "working", stateUntil: 0, lastTick: Date.now() };
}

export function deriveState(state, now = Date.now()) {
  if (state.state === "celebrating" && now < state.stateUntil) return state;
  if (state.state === "scared" && now < state.stateUntil) return state;
  if (state.energy < 20) return { ...state, state: "sleeping", lastTick: now };
  if (state.hunger < 25) {
    return { ...state, state: "scared", stateUntil: now + 30_000, lastTick: now };
  }
  if (state.state === "working") return state;
  return { ...state, state: "idle", lastTick: now };
}

function maybeLevelUp(state) {
  const xpNeeded = state.level * 50;
  if (state.xp < xpNeeded) return state;
  return {
    ...state,
    level: state.level + 1,
    xp: state.xp - xpNeeded,
    happiness: CLAMP(state.happiness + 3),
    hunger: CLAMP(state.hunger + 5),
    energy: CLAMP(state.energy + 3),
    lastTick: Date.now(),
  };
}

// ---------- Work-driven progression (driven by opencode events) ----------

// Per-tool xp weight. Heavier work = more xp.
const TOOL_XP = {
  read: 1,
  glob: 1,
  grep: 1,
  list: 1,
  webfetch: 1,
  edit: 3,
  write: 3,
  bash: 3,
  patch: 3,
  multiedit: 3,
  todowrite: 2,
  task: 3,
};

export function toolXp(toolName) {
  if (!toolName) return 2;
  const key = String(toolName).toLowerCase();
  return TOOL_XP[key] ?? 2;
}

// Generic xp award. Always passes through level-up.
export function awardXp(state, amount) {
  if (!amount || amount <= 0) return state;
  const next = { ...state, xp: state.xp + Math.floor(amount), lastTick: Date.now() };
  return maybeLevelUp(next);
}

// A new turn just started. Move buddy into `working` unless they are
// locked into celebrate/scared/sleeping. Record the prompt timestamp
// so the idle-recovery timer can tell how long it's been since the
// user last engaged.
export function onPromptStart(state) {
  const next = { ...state, lastPromptAt: Date.now(), lastTick: Date.now() };
  if (state.state === "celebrating" && Date.now() < state.stateUntil) return next;
  if (state.state === "scared" && Date.now() < state.stateUntil) return next;
  if (state.energy < 20) return next;
  return { ...next, state: "working", stateUntil: 0 };
}

// A single tool call succeeded — tiny mood bump, no xp here. xp is
// accumulated in memory by the caller and granted at turn end via
// `onTurnDone` to avoid disk thrash and to enforce per-turn caps.
export function onToolSuccess(state) {
  return {
    ...state,
    happiness: CLAMP(state.happiness + 0.2),
    lastTick: Date.now(),
  };
}

// A single tool call failed — mood dip and small energy cost. Caller
// decides whether to bump `scared` based on repeat failures.
export function onToolFailure(state) {
  return {
    ...state,
    happiness: CLAMP(state.happiness - 1),
    energy: CLAMP(state.energy - 0.5),
    lastTick: Date.now(),
  };
}

// Turn finished. Grant base xp (completed a task) + the per-turn
// accumulated xp (capped by caller). Apply work metabolism: harder
// turns (more tool calls) cost more hunger/energy; failures sap
// happiness; a clean finish bumps happiness. Celebrate briefly.
export function onTurnDone(state, accumulatedXp = 0, stats = {}) {
  const BASE = 10;
  const tools = Math.max(0, stats.tools ?? 0);
  const failures = Math.max(0, stats.failures ?? 0);
  const totalXp = BASE + Math.max(0, Math.floor(accumulatedXp));

  const hungerCost = Math.min(8, 2 + 0.3 * tools);
  const energyCost = Math.min(7, 1 + 0.2 * tools);
  const happinessDelta = 1 - 1 * failures;

  const next = {
    ...state,
    xp: state.xp + totalXp,
    hunger: CLAMP(state.hunger - hungerCost),
    energy: CLAMP(state.energy - energyCost),
    happiness: CLAMP(state.happiness + happinessDelta),
    lastTick: Date.now(),
  };
  const leveled = maybeLevelUp(next);
  return {
    ...leveled,
    state: "celebrating",
    stateUntil: Date.now() + 3000,
  };
}

// One or more todos transitioned to completed.
export function onTodoCompleted(state, count = 1) {
  if (count <= 0) return state;
  return awardXp(state, 5 * count);
}

// A file was edited — buddy gets a small hunger refill ("code is food").
// Throttling is the caller's responsibility.
export function onFileEdited(state) {
  return {
    ...state,
    hunger: CLAMP(state.hunger + 1),
    lastTick: Date.now(),
  };
}

// User approved a permission request — buddy gets fed.
export function onPermissionAllowed(state) {
  return {
    ...state,
    hunger: CLAMP(state.hunger + 3),
    happiness: CLAMP(state.happiness + 1),
    lastTick: Date.now(),
  };
}

// A shell command finished successfully — small hunger refill + tiny
// energy kick (sense of accomplishment).
export function onShellSuccess(state) {
  return {
    ...state,
    hunger: CLAMP(state.hunger + 1),
    energy: CLAMP(state.energy + 1),
    lastTick: Date.now(),
  };
}

// Git branch switched.
export function onBranchUpdated(state) {
  return {
    ...state,
    hunger: CLAMP(state.hunger + 3),
    happiness: CLAMP(state.happiness + 1),
    lastTick: Date.now(),
  };
}

// Session history was compacted — buddy sheds context fatigue.
export function onCompacted(state) {
  return {
    ...state,
    energy: CLAMP(state.energy + 10),
    happiness: CLAMP(state.happiness + 2),
    lastTick: Date.now(),
  };
}

// Long idle period — passive energy recovery. Caller enforces cooldown.
export function onIdleRecovery(state) {
  return {
    ...state,
    energy: CLAMP(state.energy + 5),
    lastTick: Date.now(),
  };
}

// Streak bonus — N consecutive successful tool calls without a failure.
// Pure xp reward, no happiness bump (happiness has too many sources
// already; keeping streak as a progression incentive).
export function onStreak(state) {
  const next = {
    ...state,
    xp: state.xp + 5,
    lastTick: Date.now(),
  };
  return maybeLevelUp(next);
}
