// V2 server plugin. Registers the `buddy` tool the LLM can call.
// Loaded by opencode via package.json `main` (server part).
// All actions operate on a per-session buddy state. If no `session`
// argument is provided, falls back to a synthetic "__default__" buddy.

import { Plugin } from "@opencode/plugin";
import * as state from "./state.js";
import * as persistence from "./persistence.js";
import { SPECIES, renderFrame } from "./species.js";
import {
  onPromptStart,
  onToolSuccess,
  onToolFailure,
  onTurnDone,
  onFileEdited,
  onPermissionAllowed,
  onShellSuccess,
  onBranchUpdated,
  onCompacted,
  onIdleRecovery,
  onStreak,
  toolXp,
  scared as scaredState,
} from "./state.js";

const SPECIES_LIST = SPECIES.join(", ");

const DESCRIPTION = `Interact with your virtual buddy companion for a given opencode session. Pass an "action" argument and an optional "session" (the opencode sessionID; default: a synthetic global buddy).

Actions:
  status                  - print current stats as a one-liner
  feed                    - feed the buddy (+25 hunger, -5 energy)
  play                    - play with the buddy (+15 happiness, +1 xp)
  rest                    - let the buddy rest (+30 energy)
  switch <species>        - change species (${SPECIES_LIST})
  rename <name>           - rename the buddy (max 20 chars)
  hatch [species] [name]  - start a brand new buddy
  ascii [frame]           - render the current buddy as ASCII art
  list                    - list all session buddies with their name/level
  help                    - list available actions

The buddy lives in the opencode sidebar. Use this tool whenever the
user wants to interact with their buddy.`;

function summary(s) {
  return `${s.name} the ${s.species} | Lv ${s.level} | ${s.state} | hunger ${Math.floor(s.hunger)} happiness ${Math.floor(s.happiness)} energy ${Math.floor(s.energy)} | xp ${s.xp}/${s.level * 50}`;
}

const FALLBACK_SESSION = "__default__";
const norm = (sid) => (sid && typeof sid === "string" ? sid : FALLBACK_SESSION);

async function loadOrInit(sessionID) {
  const sid = norm(sessionID);
  const s = await persistence.load(sid);
  if (s) return s;
  const fresh = state.hatch();
  await persistence.save(sid, fresh);
  return fresh;
}

async function mutate(sessionID, fn) {
  const sid = norm(sessionID);
  const cur = await loadOrInit(sid);
  const next = fn(cur);
  await persistence.save(sid, next);
  return next;
}

const TURN_XP_CAP = 30;
const FILE_EDIT_THROTTLE_MS = 30_000;
const SCARED_FAILURE_THRESHOLD = 2;
const STREAK_THRESHOLD = 3;
const SAME_TOOL_HALVE_AFTER = 5;
const IDLE_RECOVERY_MS = 5 * 60_000;
const IDLE_RECOVERY_CHECK_MS = 60_000;
const IDLE_DELETE_MS = 14 * 24 * 60 * 60_000;
const ARCHIVE_CHECK_MS = 24 * 60 * 60_000;

// Progression runs in the server so Desktop-only sessions (which never load
// the TUI part) still feed, level and animate their buddy.
async function runProgression(ctx, signal) {
  let lastFileEditedAt = 0;
  let lastActiveSessionID = FALLBACK_SESSION;
  const turnAccum = new Map();

  const rememberActive = (sid) => {
    const n = norm(sid);
    if (n) lastActiveSessionID = n;
  };
  const getAccum = (sessionID) => {
    const key = norm(sessionID);
    let a = turnAccum.get(key);
    if (!a) {
      a = { xp: 0, tools: 0, failures: 0, streak: 0, toolCounts: {} };
      turnAccum.set(key, a);
    }
    return a;
  };
  const resetAccum = (sessionID) => turnAccum.delete(norm(sessionID));

  const handle = async (ev) => {
    const type = ev?.type;
    const data = ev?.data;
    const sid = data?.sessionID;

    switch (type) {
      case "session.execution.started": {
        rememberActive(sid);
        getAccum(sid);
        await mutate(sid, (s) => onPromptStart(s));
        return;
      }
      case "session.tool.input.started": {
        rememberActive(sid);
        const a = getAccum(sid);
        const key = (data?.name || "_").toLowerCase();
        a.toolCounts[key] = (a.toolCounts[key] ?? 0) + 1;
        let weight = toolXp(data?.name);
        if (a.toolCounts[key] > SAME_TOOL_HALVE_AFTER) {
          weight = Math.max(1, Math.floor(weight / 2));
        }
        a.__lastToolWeight = weight;
        return;
      }
      case "session.tool.success": {
        rememberActive(sid);
        const a = getAccum(sid);
        const weight = a.__lastToolWeight ?? 2;
        a.xp = Math.min(TURN_XP_CAP, a.xp + weight);
        a.tools += 1;
        a.streak += 1;
        a.__lastToolWeight = undefined;
        await mutate(sid, (s) => onToolSuccess(s));
        if (a.streak > 0 && a.streak % STREAK_THRESHOLD === 0) {
          await mutate(sid, (s) => onStreak(s));
        }
        return;
      }
      case "session.tool.failed": {
        rememberActive(sid);
        const a = getAccum(sid);
        a.failures += 1;
        a.streak = 0;
        await mutate(sid, (s) => {
          const dipped = onToolFailure(s);
          return a.failures >= SCARED_FAILURE_THRESHOLD ? scaredState(dipped) : dipped;
        });
        return;
      }
      case "filesystem.changed": {
        const now = Date.now();
        if (now - lastFileEditedAt < FILE_EDIT_THROTTLE_MS) return;
        lastFileEditedAt = now;
        await mutate(lastActiveSessionID, (s) => onFileEdited(s));
        return;
      }
      case "session.execution.succeeded": {
        rememberActive(sid);
        const a = getAccum(sid);
        const earned = a.xp;
        const stats = { tools: a.tools, failures: a.failures };
        resetAccum(sid);
        const before = await persistence.load(norm(sid));
        if (!before) return;
        const after = onTurnDone(before, earned, stats);
        await persistence.save(norm(sid), after);
        return;
      }
      case "session.execution.failed": {
        rememberActive(sid);
        await mutate(sid, (s) => scaredState(s));
        return;
      }
      case "permission.replied": {
        rememberActive(sid);
        if (data?.reply !== "once" && data?.reply !== "always") return;
        await mutate(sid, (s) => onPermissionAllowed(s));
        return;
      }
      case "session.shell.ended": {
        rememberActive(sid);
        await mutate(sid, (s) => onShellSuccess(s));
        return;
      }
      case "vcs.branch.updated": {
        await mutate(lastActiveSessionID, (s) => onBranchUpdated(s));
        return;
      }
      case "session.compaction.ended": {
        rememberActive(sid);
        await mutate(sid, (s) => onCompacted(s));
        return;
      }
    }
  };

  const idleTimer = setInterval(async () => {
    try {
      const sessions = await persistence.listSessions();
      const now = Date.now();
      for (const meta of sessions) {
        const sid = meta.sessionID;
        const s = await persistence.load(sid);
        if (!s) continue;
        if (s.state === "working") continue;
        const last = s.lastPromptAt ?? s.hatchedAt ?? now;
        if (now - last < IDLE_RECOVERY_MS) continue;
        if (now - (s.lastIdleRecoveryAt ?? 0) < IDLE_RECOVERY_MS) continue;
        await mutate(sid, (cur) => {
          const next = onIdleRecovery(cur);
          return { ...next, lastIdleRecoveryAt: now };
        });
      }
    } catch (err) {
      console.error("[buddy] idle recovery error", err);
    }
  }, IDLE_RECOVERY_CHECK_MS);

  const runSweep = async () => {
    try {
      const n = await persistence.sweep(IDLE_DELETE_MS);
      if (n > 0) console.log(`[buddy] swept ${n} idle session file${n === 1 ? "" : "s"}`);
    } catch (err) {
      console.error("[buddy] sweep error", err);
    }
  };
  void runSweep();
  const sweepTimer = setInterval(runSweep, ARCHIVE_CHECK_MS);

  const stop = () => {
    clearInterval(idleTimer);
    clearInterval(sweepTimer);
  };
  signal.addEventListener("abort", stop, { once: true });

  try {
    for await (const ev of ctx.event.subscribe({ signal })) {
      try {
        await handle(ev);
      } catch (err) {
        console.error("[buddy] event error", ev?.type, err);
      }
    }
  } catch (err) {
    if (!signal.aborted) console.error("[buddy] event stream error", err);
  } finally {
    stop();
  }
}

export default Plugin.define({
  id: "opencode-buddy",
  async setup(ctx) {
    const controller = new AbortController();
    void runProgression(ctx, controller.signal);

    await ctx.tool.transform((tools) => {
      tools.add({
        name: "buddy",
        description: DESCRIPTION,
        input: {
          type: "object",
          properties: {
            action: {
              type: "string",
              description:
                `One of: status, feed, play, rest, switch, rename, hatch, ascii, list, help. For switch/rename/hatch, also pass the "species" or "name" argument. For per-session targeting, pass "session" with the opencode sessionID.`,
            },
            species: {
              type: "string",
              description: `Species for switch/hatch: ${SPECIES_LIST}`,
            },
            name: {
              type: "string",
              description: `Name for rename/hatch (max 20 chars).`,
            },
            frame: {
              type: "integer",
              minimum: 0,
              maximum: 10,
              description: `Frame index for ascii action.`,
            },
            session: {
              type: "string",
              description: `Opencode sessionID to target. Default: "__default__".`,
            },
          },
          additionalProperties: false,
        },
        async execute(args) {
          const out = (text) => ({ content: text });
          const action = (args.action || "").toLowerCase();
          const species = (args.species || "").toLowerCase();
          const name = args.name;
          const frame = args.frame ?? 0;
          const sid = norm(args.session);

          if (action === "list") {
            const sessions = await persistence.listSessions();
            if (sessions.length === 0) return out("No session buddies yet.");
            return out(
              sessions
                .map((b) => {
                  const short = b.sessionID === "__default__"
                    ? "default"
                    : b.sessionID.replace(/^ses_/, "").slice(0, 6) + "…"
                  return `· ${b.name} the ${b.species} Lv${b.level} (${short})`
                })
                .join("\n"),
            );
          }

          let s = await loadOrInit(sid);

          switch (action) {
            case "":
            case "status":
              return out(summary(s));
            case "feed":
              s = state.feed(s);
              await persistence.save(sid, s);
              return out(`${s.name} munches happily. ${summary(s)}`);
            case "play":
              s = state.play(s);
              await persistence.save(sid, s);
              return out(`${s.name} plays! ${summary(s)}`);
            case "rest":
              s = state.rest(s);
              await persistence.save(sid, s);
              return out(`${s.name} curls up. ${summary(s)}`);
            case "switch": {
              if (!species) return out(`Pick a species: ${SPECIES_LIST}`);
              if (!SPECIES.includes(species))
                return out(`Unknown species "${species}". Valid: ${SPECIES_LIST}`);
              s = state.switchSpecies(s, species);
              await persistence.save(sid, s);
              return out(`${s.name} transformed into a ${species}. ${summary(s)}`);
            }
            case "rename": {
              if (!name) return out(`Provide a name with the "name" argument.`);
              s = state.rename(s, name);
              await persistence.save(sid, s);
              return out(`Renamed to ${s.name}. ${summary(s)}`);
            }
            case "hatch": {
              const sp = species && SPECIES.includes(species) ? species : "duck";
              s = state.hatch({ species: sp, name: name || "Buddy" });
              await persistence.save(sid, s);
              return out(`Hatched a new ${sp} named ${s.name}. ${summary(s)}`);
            }
            case "ascii": {
              const lines = renderFrame(s.species, s.state, frame);
              return out([
                "```",
                ...lines,
                "```",
                `${s.name} the ${s.species} · ${s.state}`,
                `hunger ${Math.floor(s.hunger)}  happy ${Math.floor(s.happiness)}  energy ${Math.floor(s.energy)}  xp ${s.xp}/${s.level * 50}`,
              ].join("\n"));
            }
            case "help":
              return out(DESCRIPTION);
            default:
              return out(`Unknown action "${args.action}". Try: action=help`);
          }
        },
      });
    });

    return () => controller.abort();
  },
});
