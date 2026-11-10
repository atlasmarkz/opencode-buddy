// Per-session persistent state.
// Files live at ~/.config/opencode-buddy/sessions/<sessionID>.json
// One buddy per opencode session. Switch sessions in opencode and the
// sidebar swaps to the corresponding buddy. Open the same session
// later and the buddy is still there.
//
// Legacy: a previous version stored a single global state.json at
// ~/.config/opencode-buddy/state.json. On first read with a new
// sessionID, we transparently migrate that file into the per-session
// store and remove the legacy file.
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

// Computed lazily so importing this module in a browser-side bundle does not
// touch Node APIs until a persistence function actually runs in main.
const dir = () => path.join(os.homedir(), ".config", "opencode-buddy");
const sessionsDir = () => path.join(dir(), "sessions");
const legacyFile = () => path.join(dir(), "state.json");

// "__default__" is the synthetic sessionID used by the LLM tool and
// other contexts where no real opencode session is available.
const DEFAULT_KEY = "__default__";

async function ensureMigrated() {
  // No caching: a user could downgrade to a v0.4 build and back to
  // v0.5, and we want the legacy file to migrate on its next
  // appearance. The check is one fs.access per call, which is cheap.
  try {
    await fs.mkdir(sessionsDir(), { recursive: true });
    await fs.access(legacyFile());
  } catch {
    return; // no legacy file
  }
  // Move legacy file into sessions/__default__.json (idempotent).
  const dest = path.join(sessionsDir(), `${DEFAULT_KEY}.json`);
  try {
    await fs.access(dest);
    // dest already exists — discard legacy to keep deterministic state.
    await fs.unlink(legacyFile());
  } catch {
    try {
      await fs.rename(legacyFile(), dest);
    } catch {
      // best-effort; nothing fatal
    }
  }
}

function keyFor(sessionID) {
  if (!sessionID || typeof sessionID !== "string") return DEFAULT_KEY;
  // Sanitize: only allow [A-Za-z0-9_-] to keep the path safe. Fall back
  // to a hex digest for anything weird.
  if (/^[A-Za-z0-9_-]{1,128}$/.test(sessionID)) return sessionID;
  let h = 0;
  for (let i = 0; i < sessionID.length; i++) {
    h = ((h << 5) - h + sessionID.charCodeAt(i)) | 0;
  }
  return `h${(h >>> 0).toString(16)}`;
}

function pathFor(sessionID) {
  return path.join(sessionsDir(), `${keyFor(sessionID)}.json`);
}

export async function load(sessionID) {
  await ensureMigrated();
  const fp = pathFor(sessionID);
  try {
    const raw = await fs.readFile(fp, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    // A truncated or otherwise corrupt save would otherwise break every
    // call. Keep the bytes for diagnosis and start fresh.
    if (err instanceof SyntaxError) {
      await fs.rename(fp, fp + ".corrupt").catch(() => {});
      return null;
    }
    throw err;
  }
}

export async function save(sessionID, state) {
  await ensureMigrated();
  const fp = pathFor(sessionID);
  await fs.mkdir(sessionsDir(), { recursive: true });
  // Bump idleAt on every write so the LRU sweeper can tell which
  // session files are still in active use. lastTick may be back-dated
  // by the tick() function for time-skip simulations; idleAt is the
  // wall-clock "last touched" timestamp.
  const enriched = { ...state, idleAt: Date.now() };
  const tmp = fp + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(enriched, null, 2));
  await fs.unlink(fp).catch(() => {});
  await fs.rename(tmp, fp);
}

export async function mtime(sessionID) {
  await ensureMigrated();
  const fp = pathFor(sessionID);
  try {
    const st = await fs.stat(fp);
    return st.mtimeMs;
  } catch (err) {
    if (err.code === "ENOENT") return 0;
    throw err;
  }
}

// LRU maintenance. Deletes session files whose `idleAt` is older than
// `maxAgeMs`. Returns the number of files removed.
export async function sweep(maxAgeMs) {
  await ensureMigrated();
  let removed = 0;
  let entries;
  try {
    entries = await fs.readdir(sessionsDir());
  } catch {
    return 0;
  }
  const now = Date.now();
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const fp = path.join(sessionsDir(), name);
    try {
      const raw = await fs.readFile(fp, "utf8");
      const data = JSON.parse(raw);
      const idle = typeof data.idleAt === "number" ? data.idleAt : data.lastTick;
      if (typeof idle !== "number" || now - idle < maxAgeMs) continue;
      await fs.unlink(fp);
      removed += 1;
    } catch {
      // Skip unreadable files; do not abort the whole sweep.
    }
  }
  return removed;
}

export async function listSessions() {
  await ensureMigrated();
  let entries;
  try {
    entries = await fs.readdir(sessionsDir());
  } catch {
    return [];
  }
  const out = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(sessionsDir(), name), "utf8");
      const data = JSON.parse(raw);
      out.push({
        sessionID: name.replace(/\.json$/, ""),
        name: data.name,
        species: data.species,
        level: data.level,
        idleAt: data.idleAt ?? data.lastTick ?? 0,
      });
    } catch {
      // skip
    }
  }
  out.sort((a, b) => (b.idleAt || 0) - (a.idleAt || 0));
  return out;
}

export function pathForDisplay(sessionID) {
  return pathFor(sessionID);
}
