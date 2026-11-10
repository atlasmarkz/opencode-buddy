// Electron main side of the GUI pet. Reads and writes the same per-session
// JSON files as the TUI, so both forms share one buddy.
import * as persistence from "./persistence.js"
import * as state from "./state.js"
import * as pets from "./pets.js"
import { SPECIES } from "./species.js"
import { BuddyIpc } from "./buddy-ipc.js"

const FALLBACK_SESSION = "__default__"
const SAVE_EVERY_MS = 30_000
const lastSave = new Map()

const norm = (sid) => (sid && typeof sid === "string" ? sid : FALLBACK_SESSION)

async function loadOrInit(sid) {
  const saved = await persistence.load(sid)
  if (saved) return saved
  const fresh = state.hatch()
  await persistence.save(sid, fresh)
  return fresh
}

function changed(a, b) {
  return a.state !== b.state || a.stateUntil !== b.stateUntil || a.species !== b.species
}

async function get(input) {
  const sid = norm(input.sessionID)
  const saved = await loadOrInit(sid)
  const next = state.deriveState(state.tick(saved))
  const now = Date.now()
  if (changed(saved, next) || now - (lastSave.get(sid) ?? 0) > SAVE_EVERY_MS) {
    lastSave.set(sid, now)
    await persistence.save(sid, next)
  }
  return next
}

async function mutate(input) {
  const sid = norm(input.sessionID)
  const action = String(input.action || "").toLowerCase()
  const value = typeof input.value === "string" ? input.value : ""

  let s = state.deriveState(state.tick(await loadOrInit(sid)))

  switch (action) {
    case "feed":
      s = state.feed(s)
      break
    case "play":
      s = state.play(s)
      break
    case "rest":
      s = state.rest(s)
      break
    case "rename":
      if (!value) throw new Error("A name is required")
      s = state.rename(s, value)
      break
    case "switch":
      if (!SPECIES.includes(value)) throw new Error(`Unknown species: ${value}`)
      s = state.switchSpecies(s, value)
      break
    case "status":
      break
    default:
      throw new Error(`Unknown action: ${action}`)
  }

  s = state.deriveState(s)
  lastSave.set(sid, Date.now())
  await persistence.save(sid, s)
  return s
}

async function list() {
  return persistence.listSessions()
}

async function packs() {
  return { packs: await pets.listPacks(), active: await pets.getActive() }
}

async function pack(input) {
  return pets.readPack(input.id)
}

async function selectPet(input) {
  return { active: await pets.setActive(input.id) }
}

export function setup(ctx) {
  const provider = ctx.provide(BuddyIpc, {
    get,
    mutate,
    list,
    packs,
    pack,
    selectPet,
  })
  return () => provider.dispose()
}
