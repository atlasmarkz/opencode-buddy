// v1 server plugin. Provides the `buddy` tool the LLM can call.
// Loaded by opencode via package.json `main` (server-kind entrypoint).
// All actions operate on a per-session buddy state. If no `session`
// argument is provided, falls back to a synthetic "__default__" buddy.

import { tool } from "@opencode-ai/plugin";
import * as state from "./state.js";
import * as persistence from "./persistence.js";
import { SPECIES, renderFrame, maxFrameHeight } from "./species.js";

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

async function BuddyPlugin() {
  return {
    tool: {
      buddy: tool({
        description: DESCRIPTION,
        args: {
          action: tool.schema
            .string()
            .describe(
              `One of: status, feed, play, rest, switch, rename, hatch, ascii, list, help. For switch/rename/hatch, also pass the "species" or "name" argument. For per-session targeting, pass "session" with the opencode sessionID.`,
            ),
          species: tool.schema
            .string()
            .optional()
            .describe(`Species for switch/hatch: ${SPECIES_LIST}`),
          name: tool.schema
            .string()
            .optional()
            .describe(`Name for rename/hatch (max 20 chars).`),
          frame: tool.schema
            .number()
            .int()
            .min(0)
            .max(10)
            .optional()
            .describe(`Frame index for ascii action.`),
          session: tool.schema
            .string()
            .optional()
            .describe(`Opencode sessionID to target. Default: "__default__".`),
        },
        async execute(args) {
          const action = (args.action || "").toLowerCase();
          const species = (args.species || "").toLowerCase();
          const name = args.name;
          const frame = args.frame ?? 0;
          const sid = norm(args.session);

          if (action === "list") {
            const sessions = await persistence.listSessions();
            if (sessions.length === 0) return "No session buddies yet.";
            return sessions
              .map((b) => `· ${b.name} the ${b.species} Lv${b.level} (${b.sessionID})`)
              .join("\n");
          }

          let s = await loadOrInit(sid);

          switch (action) {
            case "":
            case "status":
              return summary(s);
            case "feed":
              s = state.feed(s);
              await persistence.save(sid, s);
              return `${s.name} munches happily. ${summary(s)}`;
            case "play":
              s = state.play(s);
              await persistence.save(sid, s);
              return `${s.name} plays! ${summary(s)}`;
            case "rest":
              s = state.rest(s);
              await persistence.save(sid, s);
              return `${s.name} curls up. ${summary(s)}`;
            case "switch": {
              if (!species) return `Pick a species: ${SPECIES_LIST}`;
              if (!SPECIES.includes(species))
                return `Unknown species "${species}". Valid: ${SPECIES_LIST}`;
              s = state.switchSpecies(s, species);
              await persistence.save(sid, s);
              return `${s.name} transformed into a ${species}. ${summary(s)}`;
            }
            case "rename": {
              if (!name) return `Provide a name with the "name" argument.`;
              s = state.rename(s, name);
              await persistence.save(sid, s);
              return `Renamed to ${s.name}. ${summary(s)}`;
            }
            case "hatch": {
              const sp = species && SPECIES.includes(species) ? species : "duck";
              s = state.hatch({ species: sp, name: name || "Buddy" });
              await persistence.save(sid, s);
              return `Hatched a new ${sp} named ${s.name}. ${summary(s)}`;
            }
            case "ascii": {
              const lines = renderFrame(s.species, s.state, frame);
              return [
                "```",
                ...lines,
                "```",
                `${s.name} the ${s.species} · ${s.state}`,
                `hunger ${Math.floor(s.hunger)}  happy ${Math.floor(s.happiness)}  energy ${Math.floor(s.energy)}  xp ${s.xp}/${s.level * 50}`,
              ].join("\n");
            }
            case "help":
              return DESCRIPTION;
            default:
              return `Unknown action "${args.action}". Try: action=help`;
          }
        },
      }),
    },
  };
}

export default {
  id: "opencode-buddy",
  server: BuddyPlugin,
};
