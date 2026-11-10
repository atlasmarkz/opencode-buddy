#!/usr/bin/env node
// Postinstall: register the buddy plugin in opencode's V2 config so the user
// only needs to run `npm install -g opencode-buddy` and restart opencode.
//
// We touch one file: ~/.config/opencode/opencode.json (both the server and
// TUI parts load from the same `plugins` entry).
//
// We are idempotent: if the entry is already present, we leave it alone.
// We never overwrite a user's existing config — we only add the `plugins` key.

import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"

const PLUGIN_SPEC = "opencode-buddy"
const CONFIG_DIR = path.join(os.homedir(), ".config", "opencode")
const SERVER_CONFIG = path.join(CONFIG_DIR, "opencode.json")

async function readJSON(filepath) {
  try {
    const raw = await fs.readFile(filepath, "utf8")
    return { raw, data: JSON.parse(raw) }
  } catch (err) {
    if (err.code === "ENOENT") return null
    throw err
  }
}

function hasComments(raw) {
  // JSONC comments: // line comments and /* block */ comments.
  return /\/\/[^\n]*|\/\*[\s\S]*?\*\//.test(raw)
}

function ensurePluginArray(data, spec) {
  if (!data || typeof data !== "object") return false
  const list = Array.isArray(data.plugins) ? data.plugins : []
  if (list.some((entry) => entry === spec)) return false
  list.push(spec)
  data.plugins = list
  return true
}

async function main() {
  const existing = await readJSON(SERVER_CONFIG)

  if (existing && hasComments(existing.raw)) {
    // Don't touch JSONC files with comments — we'd strip them.
    return
  }

  const isNew = !existing
  const data = isNew ? { $schema: "https://opencode.ai/config.json" } : existing.data

  const changed = ensurePluginArray(data, PLUGIN_SPEC)
  if (!changed && !isNew) return

  await fs.mkdir(path.dirname(SERVER_CONFIG), { recursive: true })
  await fs.writeFile(SERVER_CONFIG, JSON.stringify(data, null, 2) + "\n")
  console.log(`[opencode-buddy] ${isNew ? "created" : "updated"} ${SERVER_CONFIG}`)
}

main().catch((err) => {
  console.error("[opencode-buddy] postinstall: failed to register plugin", err.message)
  // Don't fail the install — the user can configure manually if needed.
  process.exit(0)
})
