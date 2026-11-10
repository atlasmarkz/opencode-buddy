// Custom pet packs. Kinds:
//   local ~/.config/opencode-buddy/pets/<dir>/pet.json
//   codex ~/.codex/pets/<dir>/pet.json
// Codex packs are the 8x9 atlas documented at codex-pets-react: 192x208
// cells, rows idle/running-right/running-left/waving/jumping/failed/waiting/running/review.
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"

const MAX_SPRITE_BYTES = 5 * 1024 * 1024
const MIME = { ".webp": "image/webp", ".png": "image/png", ".gif": "image/gif" }
const cache = new Map()

const configDir = () => path.join(os.homedir(), ".config", "opencode-buddy")
const localDir = () => path.join(configDir(), "pets")
const codexDir = () => path.join(os.homedir(), ".codex", "pets")
const settingsFile = () => path.join(configDir(), "pets.json")

function publicMeta(meta) {
  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    source: meta.source,
  }
}

async function readMeta(dir, source) {
  const meta = JSON.parse(await fs.readFile(path.join(dir, "pet.json"), "utf8"))
  const version = meta.spriteVersionNumber ?? 2
  if (version !== 2) throw new Error(`Unsupported pet format v${version}`)

  const sprite = meta.spritesheetPath || "spritesheet.webp"
  if (
    path.basename(sprite) !== sprite ||
    sprite.startsWith(".") ||
    sprite === ""
  ) {
    throw new Error("Invalid spritesheetPath")
  }

  const ext = path.extname(sprite).toLowerCase()
  const mime = MIME[ext]
  if (!mime) throw new Error(`Unsupported spritesheet type: ${ext}`)

  const spritePath = path.join(dir, sprite)
  const stat = await fs.stat(spritePath)
  if (!stat.isFile()) throw new Error("Missing spritesheet")
  if (stat.size > MAX_SPRITE_BYTES) throw new Error("Spritesheet too large")

  return {
    id: `${source}:${path.basename(dir)}`,
    name: String(meta.displayName || meta.name || path.basename(dir)),
    description: String(meta.description || ""),
    source,
    dir,
    spritePath,
    mime,
    mtimeMs: stat.mtimeMs,
  }
}

async function scan(base, source) {
  let entries
  try {
    entries = await fs.readdir(base, { withFileTypes: true })
  } catch {
    return []
  }

  const packs = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      packs.push(await readMeta(path.join(base, entry.name), source))
    } catch {
      // A broken pack should not hide the rest.
    }
  }
  return packs
}

export async function listPacks() {
  const [local, codex] = await Promise.all([
    scan(localDir(), "local"),
    scan(codexDir(), "codex"),
  ])

  const seen = new Set()
  const packs = []
  for (const pack of [...local, ...codex]) {
    const dirName = pack.id.slice(pack.id.indexOf(":") + 1)
    if (seen.has(dirName)) continue
    seen.add(dirName)
    packs.push(publicMeta(pack))
  }
  packs.sort((a, b) => a.name.localeCompare(b.name))
  return packs
}

export async function readPack(id) {
  const [source, ...rest] = String(id || "").split(":")
  const dirName = rest.join(":")
  if (
    (source !== "local" && source !== "codex") ||
    !dirName ||
    dirName.startsWith(".") ||
    dirName.includes("/") ||
    dirName.includes("\\")
  ) {
    throw new Error("Unknown pet")
  }

  const base = source === "local" ? localDir() : codexDir()
  const meta = await readMeta(path.join(base, dirName), source)
  const cached = cache.get(meta.id)
  if (cached && cached.mtimeMs === meta.mtimeMs) {
    return cached.payload
  }

  const data = await fs.readFile(meta.spritePath)
  const payload = {
    ...publicMeta(meta),
    dataUrl: `data:${meta.mime};base64,${data.toString("base64")}`,
  }
  cache.set(meta.id, { mtimeMs: meta.mtimeMs, payload })
  return payload
}

async function readSettings() {
  try {
    const data = JSON.parse(await fs.readFile(settingsFile(), "utf8"))
    return {
      pet: typeof data.pet === "string" && data.pet ? data.pet : null,
      visible: typeof data.visible === "boolean" ? data.visible : true,
    }
  } catch {
    return { pet: null, visible: true }
  }
}

async function writeSettings(next) {
  await fs.mkdir(configDir(), { recursive: true })
  const tmp = `${settingsFile()}.tmp`
  await fs.writeFile(
    tmp,
    `${JSON.stringify({ pet: next.pet ?? null, visible: next.visible !== false }, null, 2)}\n`,
  )
  await fs.rename(tmp, settingsFile())
}

export async function getActive() {
  return (await readSettings()).pet
}

export async function setActive(id) {
  const pet = typeof id === "string" && id ? id : null
  if (pet) await readPack(pet) // validate before saving
  await writeSettings({ ...(await readSettings()), pet })
  return pet
}

export async function getVisible() {
  return (await readSettings()).visible
}

export async function setVisible(visible) {
  await writeSettings({ ...(await readSettings()), visible: !!visible })
  return !!visible
}
