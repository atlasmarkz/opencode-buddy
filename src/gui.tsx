import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createSignal,
  onCleanup,
} from "solid-js"
import { Portal } from "solid-js/web"
import { Command, Plugin, Slot, Style } from "@opencode/plugin/gui"
import css from "./gui.css?inline"
import { SPECIES } from "./species.js"
import { BuddyIpc } from "./buddy-ipc.js"

const SIZE = 150
const POS_KEY = "opencode-buddy.pos"
const FALLBACK_SESSION = "__default__"
const SPECIES_COLOR: Record<string, string> = {
  duck: "#ffd43b",
  cat: "#f6a96b",
  dragon: "#6bcb77",
  axolotl: "#ffb3c7",
  robot: "#7ef7c7",
  ghost: "#c9c4f5",
}

type Buddy = {
  species: string
  name: string
  hunger: number
  happiness: number
  energy: number
  xp: number
  level: number
  state: string
  stateUntil: number
}

type PackInfo = {
  id: string
  name: string
  description: string
  source: "local" | "codex"
}

type PackPayload = PackInfo & { dataUrl: string }
type PacksResponse = {
  packs: PackInfo[]
  active: string | null
  visible: boolean
}

const CELL_W = 96
const CELL_H = 104
const CODEX_ATLAS = {
  columns: 8,
  rows: 9,
  animations: {
    idle: { row: 0, frames: 6, frameDurations: [280, 110, 110, 140, 140, 320] },
    "running-right": { row: 1, frames: 8, frameDurations: [120, 120, 120, 120, 120, 120, 120, 220] },
    "running-left": { row: 2, frames: 8, frameDurations: [120, 120, 120, 120, 120, 120, 120, 220] },
    waving: { row: 3, frames: 4, frameDurations: [140, 140, 140, 280] },
    jumping: { row: 4, frames: 5, frameDurations: [140, 140, 140, 140, 280] },
    failed: { row: 5, frames: 8, frameDurations: [140, 140, 140, 140, 140, 140, 140, 240] },
    waiting: { row: 6, frames: 6, frameDurations: [150, 150, 150, 150, 150, 260] },
    running: { row: 7, frames: 6, frameDurations: [120, 120, 120, 120, 120, 220] },
    review: { row: 8, frames: 6, frameDurations: [150, 150, 150, 150, 150, 280] },
  },
} as const

const STATE_ANIM: Record<string, keyof typeof CODEX_ATLAS.animations> = {
  idle: "idle",
  working: "running",
  celebrating: "jumping",
  scared: "failed",
  sleeping: "waiting",
}

// Module-level so palette commands can toggle the same stats card / visibility.
const [statsPinned, setStatsPinned] = createSignal(false)
const [petVisible, setPetVisible] = createSignal(true)

const clamp = (value: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, value))

function initialPos() {
  try {
    const saved = JSON.parse(localStorage.getItem(POS_KEY) || "null")
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return saved
  } catch {
    // ignore malformed local state
  }
  return {
    x: clamp(window.innerWidth - SIZE - 24, 8, window.innerWidth - SIZE - 8),
    y: clamp(window.innerHeight - SIZE - 80, 8, window.innerHeight - SIZE - 8),
  }
}

function savePos(pos: { x: number; y: number }) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(pos))
  } catch {
    // ignore quota/privacy errors
  }
}

type Pixel = string | null
type PixelDot = { x: number; y: number; c: string }

type PixelPalette = {
  outline: string
  dark: string
  base: string
  light: string
  accent: string
  cheek: string
  white: string
  black: string
}

const PIXEL_PALETTES: Record<string, PixelPalette> = {
  duck: {
    outline: "#3D2B0F", dark: "#E0A800", base: "#FFD84D", light: "#FFF3B0",
    accent: "#FF9F1C", cheek: "#FF9FB2", white: "#FFFFFF", black: "#2B2118",
  },
  cat: {
    outline: "#3A2416", dark: "#D97A3A", base: "#F6A96B", light: "#FFE8D6",
    accent: "#FF8FA3", cheek: "#FF9FB2", white: "#FFFFFF", black: "#2B2118",
  },
  dragon: {
    outline: "#1F3A22", dark: "#3F9E52", base: "#7BD389", light: "#D9FFE0",
    accent: "#F2D388", cheek: "#FFB3C7", white: "#FFFFFF", black: "#1F2A18",
  },
  axolotl: {
    outline: "#4A2333", dark: "#FF7A9E", base: "#FFB3C7", light: "#FFE3EC",
    accent: "#FF7A9E", cheek: "#FF7FA3", white: "#FFFFFF", black: "#3A2430",
  },
  robot: {
    outline: "#1B2430", dark: "#8496AA", base: "#D5DFEA", light: "#F4F8FC",
    accent: "#7EF7C7", cheek: "#6EE7F9", white: "#FFFFFF", black: "#1B2430",
  },
  ghost: {
    outline: "#3D3654", dark: "#C9C4F5", base: "#E8E4FF", light: "#FFFFFF",
    accent: "#C9C4F5", cheek: "#FFA3C0", white: "#FFFFFF", black: "#3D3654",
  },
}

const PIXEL_N = 48
const PIXEL_SCALE = 1.5

function pixelGrid(): Pixel[][] {
  return Array.from({ length: PIXEL_N }, () => Array<Pixel>(PIXEL_N).fill(null))
}

function pxRaw(g: Pixel[][], x: number, y: number, c: Pixel) {
  if (x >= 0 && x < PIXEL_N && y >= 0 && y < PIXEL_N) g[y][x] = c
}

function px(g: Pixel[][], bx: number, by: number, c: Pixel) {
  pxRaw(g, Math.round(bx * PIXEL_SCALE), Math.round(by * PIXEL_SCALE), c)
}

function fillRect(g: Pixel[][], x: number, y: number, w: number, h: number, c: Pixel) {
  const x0 = Math.round(x * PIXEL_SCALE)
  const y0 = Math.round(y * PIXEL_SCALE)
  const x1 = Math.round((x + w) * PIXEL_SCALE)
  const y1 = Math.round((y + h) * PIXEL_SCALE)
  for (let yy = y0; yy < y1; yy++)
    for (let xx = x0; xx < x1; xx++) pxRaw(g, xx, yy, c)
}

function fillEllipse(
  g: Pixel[][], cx: number, cy: number, rx: number, ry: number, c: Pixel,
) {
  for (let y = 0; y < PIXEL_N; y++)
    for (let x = 0; x < PIXEL_N; x++) {
      const bx = (x + 0.5) / PIXEL_SCALE
      const by = (y + 0.5) / PIXEL_SCALE
      const dx = (bx - cx) / rx
      const dy = (by - cy) / ry
      if (dx * dx + dy * dy <= 1) pxRaw(g, x, y, c)
    }
}

function fillTriangle(
  g: Pixel[][], x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, c: Pixel,
) {
  const minX = Math.floor(Math.min(x1, x2, x3) * PIXEL_SCALE)
  const maxX = Math.ceil(Math.max(x1, x2, x3) * PIXEL_SCALE)
  const minY = Math.floor(Math.min(y1, y2, y3) * PIXEL_SCALE)
  const maxY = Math.ceil(Math.max(y1, y2, y3) * PIXEL_SCALE)
  const sign = (ax: number, ay: number, bx: number, by: number, x: number, y: number) =>
    (x - ax) * (by - ay) - (bx - ax) * (y - ay)
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const bx = (x + 0.5) / PIXEL_SCALE
      const by = (y + 0.5) / PIXEL_SCALE
      const d1 = sign(x1, y1, x2, y2, bx, by)
      const d2 = sign(x2, y2, x3, y3, bx, by)
      const d3 = sign(x3, y3, x1, y1, bx, by)
      const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
      const hasPos = d1 > 0 || d2 > 0 || d3 > 0
      if (!(hasNeg && hasPos)) pxRaw(g, x, y, c)
    }
}

function pixelLine(
  g: Pixel[][], x0: number, y0: number, x1: number, y1: number,
  c: Pixel, thick = 1,
) {
  let x = Math.round(x0 * PIXEL_SCALE)
  let y = Math.round(y0 * PIXEL_SCALE)
  const tx = Math.round(x1 * PIXEL_SCALE)
  const ty = Math.round(y1 * PIXEL_SCALE)
  const t = Math.max(1, Math.round(thick * PIXEL_SCALE))
  const dx = Math.abs(tx - x)
  const sx = x < tx ? 1 : -1
  const dy = -Math.abs(ty - y)
  const sy = y < ty ? 1 : -1
  let err = dx + dy
  for (;;) {
    for (let oy = 0; oy < t; oy++)
      for (let ox = 0; ox < t; ox++) pxRaw(g, x + ox, y + oy, c)
    if (x === tx && y === ty) break
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x += sx }
    if (e2 <= dx) { err += dx; y += sy }
  }
}

function pixelOutline(g: Pixel[][], color: string) {
  const seen = Array.from({ length: PIXEL_N }, () => Array<boolean>(PIXEL_N).fill(false))
  let best: Array<[number, number]> = []

  for (let y = 0; y < PIXEL_N; y++)
    for (let x = 0; x < PIXEL_N; x++) {
      if (g[y][x] === null || seen[y][x]) continue
      const stack: Array<[number, number]> = [[x, y]]
      const comp: Array<[number, number]> = []
      seen[y][x] = true
      while (stack.length) {
        const [cx, cy] = stack.pop()!
        comp.push([cx, cy])
        for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
          if (nx < 0 || nx >= PIXEL_N || ny < 0 || ny >= PIXEL_N) continue
          if (seen[ny][nx] || g[ny][nx] === null) continue
          seen[ny][nx] = true
          stack.push([nx, ny])
        }
      }
      if (comp.length > best.length) best = comp
    }

  const copy = g.map((row) => row.slice())
  for (const [x, y] of best) {
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || nx >= PIXEL_N || ny < 0 || ny >= PIXEL_N) continue
      if (copy[ny][nx] === null) g[ny][nx] = color
    }
  }
}

function pixelTone(
  g: Pixel[][], c: string,
  test: (x: number, y: number) => boolean,
) {
  for (let y = 0; y < PIXEL_N; y++)
    for (let x = 0; x < PIXEL_N; x++) {
      if (g[y][x] !== null && test((x + 0.5) / PIXEL_SCALE, (y + 0.5) / PIXEL_SCALE))
        g[y][x] = c
    }
}

function pixelFace(
  g: Pixel[][], p: PixelPalette, state: string, mouth = true,
) {
  const eyes = (color: string) => {
    if (state === "celebrating") {
      px(g, 11, 12, color); px(g, 12, 11, color); px(g, 13, 12, color)
      px(g, 18, 12, color); px(g, 19, 11, color); px(g, 20, 12, color)
    } else if (state === "sleeping") {
      fillRect(g, 11, 12, 3, 1, color)
      fillRect(g, 18, 12, 3, 1, color)
    } else if (state === "scared") {
      fillRect(g, 10, 10, 4, 4, p.white)
      fillRect(g, 18, 10, 4, 4, p.white)
      fillRect(g, 11, 11, 2, 3, color)
      fillRect(g, 19, 11, 2, 3, color)
    } else {
      fillRect(g, 11, 11, 2, 3, color)
      fillRect(g, 19, 11, 2, 3, color)
      px(g, 11, 11, p.white)
      px(g, 19, 11, p.white)
    }
  }
  eyes(p.black)

  if (mouth) {
    if (state === "celebrating") {
      fillRect(g, 14, 16, 4, 2, p.black)
      fillRect(g, 15, 17, 2, 1, p.accent)
    } else if (state === "sleeping") {
      fillRect(g, 15, 17, 2, 1, p.black)
    } else if (state === "scared") {
      px(g, 14, 16, p.black); px(g, 15, 17, p.black)
      px(g, 16, 16, p.black); px(g, 17, 17, p.black)
    } else {
      px(g, 15, 16, p.black); px(g, 16, 17, p.black); px(g, 17, 16, p.black)
    }
  }

  fillRect(g, 8, 15, 2, 1, p.cheek)
  fillRect(g, 22, 15, 2, 1, p.cheek)
}

function robotFace(g: Pixel[][], p: PixelPalette, state: string) {
  if (state === "celebrating") {
    px(g, 12, 12, p.accent); px(g, 13, 11, p.accent); px(g, 14, 12, p.accent)
    px(g, 17, 12, p.accent); px(g, 18, 11, p.accent); px(g, 19, 12, p.accent)
    fillRect(g, 14, 14, 4, 2, p.accent)
  } else if (state === "sleeping") {
    fillRect(g, 12, 12, 3, 1, p.accent)
    fillRect(g, 17, 12, 3, 1, p.accent)
    fillRect(g, 15, 14, 2, 1, p.accent)
  } else if (state === "scared") {
    fillRect(g, 11, 10, 4, 4, p.white)
    fillRect(g, 17, 10, 4, 4, p.white)
    fillRect(g, 12, 11, 2, 3, p.black)
    fillRect(g, 18, 11, 2, 3, p.black)
    px(g, 14, 15, p.accent); px(g, 15, 14, p.accent)
    px(g, 16, 15, p.accent); px(g, 17, 14, p.accent)
  } else {
    fillRect(g, 12, 10, 3, 4, p.accent)
    fillRect(g, 17, 10, 3, 4, p.accent)
    fillRect(g, 14, 15, 4, 1, p.accent)
  }
}

function buildPet(species: string, state: string): PixelDot[] {
  const p = PIXEL_PALETTES[species] ?? PIXEL_PALETTES.duck
  const g = pixelGrid()

  if (species === "duck") {
    fillEllipse(g, 16, 20, 9, 8, p.base)
    fillEllipse(g, 16, 12, 9, 8, p.base)
    px(g, 24, 20, p.base); px(g, 25, 19, p.base); px(g, 26, 19, p.base); px(g, 27, 18, p.base)
    fillEllipse(g, 8, 20, 2, 4, p.dark)
    fillEllipse(g, 24, 20, 2, 4, p.dark)
    fillRect(g, 11, 28, 3, 2, p.accent)
    fillRect(g, 18, 28, 3, 2, p.accent)
    fillTriangle(g, 14, 5, 16, 1, 19, 5, p.base)
    pixelTone(g, p.dark, (_x, y) => y >= 22)
    pixelTone(g, p.light, (x, y) => x >= 10 && x <= 11 && y >= 6 && y <= 6)
    fillEllipse(g, 16, 22, 5, 4, p.light)
    fillRect(g, 13, 15, 6, 2, p.accent)
    fillRect(g, 14, 17, 4, 1, p.accent)
    pixelOutline(g, p.outline)
    pixelFace(g, p, state, false)
  } else if (species === "cat") {
    pixelLine(g, 24, 23, 28, 20, p.base, 2)
    pixelLine(g, 28, 20, 29, 16, p.base, 2)
    pixelLine(g, 29, 16, 27, 14, p.light, 2)
    fillTriangle(g, 7, 10, 9, 3, 13, 10, p.base)
    fillTriangle(g, 9, 9, 10, 5, 12, 9, p.accent)
    fillTriangle(g, 25, 10, 23, 3, 19, 10, p.base)
    fillTriangle(g, 23, 9, 22, 5, 20, 9, p.accent)
    fillEllipse(g, 16, 21, 8, 7, p.base)
    fillEllipse(g, 16, 12, 9, 8, p.base)
    fillRect(g, 10, 27, 4, 2, p.light)
    fillRect(g, 18, 27, 4, 2, p.light)
    fillEllipse(g, 16, 15, 4, 3, p.light)
    px(g, 13, 7, p.dark); px(g, 14, 8, p.dark)
    px(g, 16, 7, p.dark); px(g, 18, 7, p.dark); px(g, 19, 8, p.dark)
    pixelTone(g, p.dark, (_x, y) => y >= 22)
    pixelTone(g, p.light, (x, y) => x >= 10 && x <= 11 && y >= 6 && y <= 6)
    pixelOutline(g, p.outline)
    fillRect(g, 15, 14, 2, 1, p.accent)
    px(g, 15, 16, p.black); px(g, 16, 17, p.black); px(g, 17, 16, p.black)
    pixelFace(g, p, state, false)
    pixelLine(g, 9, 15, 4, 14, p.dark)
    pixelLine(g, 9, 16, 4, 17, p.dark)
    pixelLine(g, 23, 15, 28, 14, p.dark)
    pixelLine(g, 23, 16, 28, 17, p.dark)
  } else if (species === "dragon") {
    pixelLine(g, 23, 24, 28, 21, p.base, 3)
    pixelLine(g, 28, 21, 29, 18, p.base, 2)
    fillTriangle(g, 29, 18, 31, 16, 29, 15, p.dark)
    fillTriangle(g, 4, 17, 10, 18, 6, 23, p.dark)
    fillTriangle(g, 28, 17, 22, 18, 26, 23, p.dark)
    fillEllipse(g, 16, 21, 8, 7, p.base)
    fillEllipse(g, 16, 12, 9, 8, p.base)
    fillEllipse(g, 16, 23, 5, 4, p.light)
    fillTriangle(g, 12, 4, 16, 1, 20, 4, p.light)
    fillRect(g, 13, 15, 6, 2, p.light)
    px(g, 14, 15, p.dark); px(g, 18, 15, p.dark)
    fillRect(g, 11, 28, 3, 2, p.dark)
    fillRect(g, 18, 28, 3, 2, p.dark)
    pixelTone(g, p.dark, (_x, y) => y >= 22)
    pixelTone(g, p.light, (x, y) => x >= 10 && x <= 11 && y >= 6 && y <= 6)
    pixelOutline(g, p.outline)
    pixelFace(g, p, state, true)
    px(g, 14, 17, p.white); px(g, 18, 17, p.white)
  } else if (species === "axolotl") {
    pixelLine(g, 8, 10, 3, 6, p.accent, 2)
    pixelLine(g, 7, 13, 2, 12, p.accent, 2)
    pixelLine(g, 8, 16, 3, 19, p.accent, 2)
    pixelLine(g, 24, 10, 29, 6, p.accent, 2)
    pixelLine(g, 25, 13, 30, 12, p.accent, 2)
    pixelLine(g, 24, 16, 29, 19, p.accent, 2)
    pixelLine(g, 24, 23, 28, 22, p.base, 2)
    pixelLine(g, 28, 22, 30, 19, p.light, 2)
    fillEllipse(g, 16, 21, 7, 7, p.base)
    fillEllipse(g, 16, 12, 9, 8, p.base)
    px(g, 12, 4, p.accent); px(g, 13, 3, p.accent); px(g, 14, 4, p.accent)
    px(g, 15, 3, p.accent); px(g, 16, 2, p.accent); px(g, 17, 3, p.accent)
    px(g, 18, 4, p.accent); px(g, 19, 3, p.accent)
    fillEllipse(g, 16, 23, 4, 3, p.light)
    px(g, 8, 22, p.base); px(g, 24, 22, p.base)
    pixelTone(g, p.dark, (_x, y) => y >= 22)
    pixelTone(g, p.light, (x, y) => x >= 10 && x <= 11 && y >= 6 && y <= 6)
    pixelOutline(g, p.outline)
    pixelFace(g, p, state, true)
  } else if (species === "robot") {
    pixelLine(g, 16, 6, 16, 3, p.dark, 1)
    fillRect(g, 15, 2, 3, 2, p.accent)
    fillRect(g, 6, 10, 2, 5, p.dark)
    fillRect(g, 24, 10, 2, 5, p.dark)
    fillRect(g, 8, 6, 16, 12, p.base)
    fillRect(g, 10, 8, 12, 8, p.black)
    fillRect(g, 11, 18, 10, 8, p.base)
    fillRect(g, 14, 20, 4, 3, p.black)
    fillRect(g, 15, 21, 2, 1, p.accent)
    fillRect(g, 8, 18, 2, 7, p.dark)
    fillRect(g, 22, 18, 2, 7, p.dark)
    fillRect(g, 12, 26, 3, 2, p.dark)
    fillRect(g, 17, 26, 3, 2, p.dark)
    pixelTone(g, p.dark, (_x, y) => y >= 23)
    pixelTone(g, p.light, (x, y) => x >= 10 && x <= 11 && y >= 7 && y <= 7)
    pixelOutline(g, p.outline)
    robotFace(g, p, state)
  } else {
    fillRect(g, 8, 7, 16, 14, p.base)
    fillEllipse(g, 16, 7, 8, 4, p.base)
    fillEllipse(g, 6, 18, 2, 3, p.base)
    fillEllipse(g, 26, 18, 2, 3, p.base)
    fillTriangle(g, 8, 21, 10, 24, 12, 21, p.base)
    fillTriangle(g, 12, 21, 14, 24, 16, 21, p.base)
    fillTriangle(g, 16, 21, 18, 24, 20, 21, p.base)
    fillTriangle(g, 20, 21, 22, 24, 24, 21, p.base)
    pixelTone(g, p.dark, (_x, y) => y >= 19)
    pixelTone(g, p.light, (x, y) => x >= 10 && x <= 11 && y >= 7 && y <= 7)
    pixelOutline(g, p.outline)
    pixelFace(g, p, state, true)
  }

  const pixels: PixelDot[] = []
  for (let y = 0; y < PIXEL_N; y++)
    for (let x = 0; x < PIXEL_N; x++) {
      const c = g[y][x]
      if (c) pixels.push({ x, y, c })
    }
  return pixels
}

function PetArt(props: { species: string; state: string }) {
  const pixels = () => buildPet(props.species, props.state)
  return (
    <svg
      class={`buddy-pet pixel-art species-${props.species} is-${props.state}`}
      viewBox="0 0 48 48"
      shape-rendering="crispEdges"
      role="img"
      aria-label={`${props.species} buddy, ${props.state}`}
    >
      <rect x="15" y="45" width="18" height="1" fill="#000" opacity=".28" />
      <rect x="16" y="46" width="15" height="1" fill="#000" opacity=".14" />
      <g class="buddy-body">
        <For each={pixels()}>
          {(p) => <rect x={p.x} y={p.y} width="1" height="1" fill={p.c} />}
        </For>
      </g>
      <g class="buddy-work-prop">
        <rect x="15" y="36" width="18" height="9" fill="#1B2430" />
        <rect x="17" y="38" width="14" height="3" fill="#7EF7C7" opacity=".55" />
        <rect x="12" y="45" width="24" height="2" fill="#374151" />
      </g>
      <Show when={props.state === "sleeping"}>
        <g class="buddy-zzz">
          <rect x="36" y="7" width="4" height="1" fill="#C9C4F5" />
          <rect x="38" y="9" width="2" height="1" fill="#C9C4F5" />
          <rect x="36" y="11" width="4" height="1" fill="#C9C4F5" />
          <rect x="42" y="3" width="3" height="1" fill="#C9C4F5" />
          <rect x="42" y="6" width="3" height="1" fill="#C9C4F5" />
        </g>
      </Show>
      <Show when={props.state === "celebrating"}>
        <g class="buddy-sparkles">
          <rect x="6" y="7" width="1" height="4" fill="#FDE68A" />
          <rect x="4" y="9" width="4" height="1" fill="#FDE68A" />
          <rect x="40" y="13" width="1" height="4" fill="#FDE68A" />
          <rect x="39" y="15" width="4" height="1" fill="#FDE68A" />
          <rect x="37" y="34" width="1" height="4" fill="#FDE68A" />
          <rect x="36" y="36" width="4" height="1" fill="#FDE68A" />
        </g>
      </Show>
      <Show when={props.state === "scared"}>
        <g class="buddy-sweat">
          <rect x="39" y="15" width="3" height="3" fill="#7DD3FC" />
          <rect x="39" y="18" width="1" height="2" fill="#7DD3FC" />
        </g>
      </Show>
    </svg>
  )
}

function SpritePet(props: { dataUrl: string; state: string }) {
  const [frame, setFrame] = createSignal(0)
  const anim = () => CODEX_ATLAS.animations[STATE_ANIM[props.state] ?? "idle"]

  createEffect(() => {
    props.dataUrl
    if (
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setFrame(0)
      return
    }
    const current = anim()
    let index = 0
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      setFrame(index)
      timer = setTimeout(() => {
        index = (index + 1) % current.frames
        tick()
      }, current.frameDurations[index])
    }
    tick()
    onCleanup(() => clearTimeout(timer))
  })

  return (
    <div class="buddy-sprite-wrap">
      <div
        class={`buddy-sprite is-${props.state}`}
        style={{
          "background-image": `url(${props.dataUrl})`,
          "background-position": `${-frame() * CELL_W}px ${-anim().row * CELL_H}px`,
        }}
      />
    </div>
  )
}

function Stat(props: { label: string; value: number; tone: string }) {
  const pct = () => clamp(props.value, 0, 100)
  return (
    <div class="buddy-stat">
      <span>{props.label}</span>
      <div class="buddy-track">
        <div class={`buddy-fill ${props.tone}`} style={{ width: `${pct()}%` }} />
      </div>
    </div>
  )
}

function RenameDialog(props: {
  initial: string
  onSave: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = createSignal(props.initial)
  return (
    <div class="buddy-dialog-backdrop">
      <form
        class="buddy-dialog"
        onSubmit={(event) => {
          event.preventDefault()
          const next = name().trim()
          if (next) props.onSave(next)
        }}
      >
        <h3>Rename buddy</h3>
        <input
          maxlength={20}
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
        />
        <div class="buddy-dialog-actions">
          <button type="button" onClick={props.onCancel}>Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </form>
    </div>
  )
}

function PetOverlay(props: { ctx: any }) {
  const ipc = props.ctx.main(BuddyIpc)
  const [buddy, setBuddy] = createSignal<Buddy | null>(null)
  const [menu, setMenu] = createSignal(false)
  const [hover, setHover] = createSignal(false)
  const [pos, setPos] = createSignal(initialPos())
  const [drag, setDrag] = createSignal(false)
  const [error, setError] = createSignal("")
  const [packs, setPacks] = createSignal<PackInfo[]>([])
  const [activeId, setActiveId] = createSignal<string | null>(null)
  const [activePack, setActivePack] = createSignal<PackPayload | null>(null)

  const sid = () => props.ctx.sessions.current()?.id ?? FALLBACK_SESSION

  const refresh = async () => {
    try {
      const next = (await ipc.get({ sessionID: sid() })) as Buddy
      if (next) {
        setBuddy(next)
        setError("")
      }
    } catch (err: any) {
      setError(String(err?.message ?? err))
    }
  }

  const loadPacks = async () => {
    try {
      const res = (await ipc.packs()) as PacksResponse
      setPacks(Array.isArray(res?.packs) ? res.packs : [])
      setActiveId(res?.active ?? null)
      setPetVisible(res?.visible !== false)
      if (res?.active) {
        try {
          setActivePack((await ipc.pack({ id: res.active })) as PackPayload)
        } catch {
          setActivePack(null)
        }
      } else {
        setActivePack(null)
      }
    } catch {
      // Pack discovery is best-effort; the built-in pets still work.
    }
  }

  createEffect(() => {
    sid()
    refresh()
    void loadPacks()
    const timer = setInterval(refresh, 1500)
    onCleanup(() => clearInterval(timer))
  })

  const act = async (action: string, value?: string) => {
    setMenu(false)
    try {
      const next = (await ipc.mutate({ sessionID: sid(), action, value })) as Buddy
      if (next) setBuddy(next)
      if (action === "switch") {
        await ipc.selectPet({})
        setActiveId(null)
        setActivePack(null)
      }
      const message =
        action === "feed" ? "Yum!" :
        action === "play" ? "Wheee!" :
        action === "rest" ? "Zzz..." :
        action === "rename" ? "New name, who dis?" :
        action === "switch" ? `Now a ${value}.` : "Done."
      props.ctx.toast.show({ title: "Buddy", message })
    } catch (err: any) {
      props.ctx.toast.show({
        title: "Buddy",
        message: String(err?.message ?? err),
        variant: "error",
      })
    }
  }

  const selectPack = async (id: string | null) => {
    setMenu(false)
    try {
      await ipc.selectPet(id ? { id } : {})
      setActiveId(id)
      if (id) {
        setActivePack((await ipc.pack({ id })) as PackPayload)
        props.ctx.toast.show({ title: "Buddy", message: "Pet changed." })
      } else {
        setActivePack(null)
      }
    } catch (err: any) {
      props.ctx.toast.show({
        title: "Buddy",
        message: String(err?.message ?? err),
        variant: "error",
      })
    }
  }

  const setVisible = async (visible: boolean) => {
    setMenu(false)
    setPetVisible(visible)
    try {
      await ipc.setVisible({ visible })
    } catch {
      // Best-effort persistence; the toggle still works for this window.
    }
  }

  const openRename = () => {
    setMenu(false)
    if (!props.ctx.dialogs?.open) return
    props.ctx.dialogs.open((dialog: any) => (
      <RenameDialog
        initial={buddy()?.name ?? ""}
        onCancel={() => dialog.close()}
        onSave={async (name) => {
          await act("rename", name)
          dialog.close()
        }}
      />
    ))
  }

  let pointer: {
    startX: number
    startY: number
    offsetX: number
    offsetY: number
    moved: boolean
  } | null = null

  const onDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    pointer = {
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - pos().x,
      offsetY: event.clientY - pos().y,
      moved: false,
    }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const onMove = (event: PointerEvent) => {
    if (!pointer) return
    if (
      Math.abs(event.clientX - pointer.startX) +
        Math.abs(event.clientY - pointer.startY) >
      4
    ) {
      pointer.moved = true
      setDrag(true)
    }
    if (!pointer.moved) return
    const next = {
      x: clamp(event.clientX - pointer.offsetX, 8, window.innerWidth - SIZE - 8),
      y: clamp(event.clientY - pointer.offsetY, 8, window.innerHeight - SIZE - 8),
    }
    setPos(next)
  }

  const onUp = () => {
    if (!pointer) return
    const moved = pointer.moved
    pointer = null
    setDrag(false)
    if (moved) savePos(pos())
    else setStatsPinned(!statsPinned())
  }

  createEffect(() => {
    const onResize = () => {
      setPos((p) => ({
        x: clamp(p.x, 8, window.innerWidth - SIZE - 8),
        y: clamp(p.y, 8, window.innerHeight - SIZE - 8),
      }))
    }
    window.addEventListener("resize", onResize)
    onCleanup(() => window.removeEventListener("resize", onResize))
  })

  createEffect(() => {
    if (!menu()) return
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest(".buddy-menu") && !target.closest(".buddy-hit")) {
        setMenu(false)
      }
    }
    window.addEventListener("pointerdown", close, true)
    onCleanup(() => window.removeEventListener("pointerdown", close, true))
  })

  const showCard = () => statsPinned() || hover() || menu()
  const d = () => buddy()
  const bubbleBelow = () => pos().y < 190
  const menuRight = () => pos().x < 180
  const xpPct = () => {
    const b = buddy()
    if (!b) return 0
    const need = b.level * 50
    return clamp(((b.xp % need) / need) * 100, 0, 100)
  }

  return (
    <Show when={petVisible()}>
    <div
      class="buddy-floating"
      classList={{ "is-dragging": drag() }}
      style={{ left: `${pos().x}px`, top: `${pos().y}px` }}
    >
      <Show when={showCard() && d()}>
        <div class="buddy-bubble" classList={{ below: bubbleBelow() }}>
          <div class="buddy-bubble-title">
            <span class="buddy-name">{d()!.name}</span>
            <span class="buddy-level">Lv {d()!.level}</span>
          </div>
          <div class="buddy-species-tag">
            {activePack()
              ? `${activePack()!.name} · ${activePack()!.source}`
              : d()!.species}
          </div>
          <Stat label="Food" value={d()!.hunger} tone="food" />
          <Stat label="Happy" value={d()!.happiness} tone="happy" />
          <Stat label="Energy" value={d()!.energy} tone="energy" />
          <Stat label="XP" value={xpPct()} tone="xp" />
          <div class="buddy-meta">
            <span class="buddy-state">{d()!.state}</span> · {d()!.xp} xp
          </div>
        </div>
      </Show>

      <Show when={menu()}>
        <div
          class="buddy-menu"
          classList={{ right: menuRight() }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => act("feed")}>
            <span class="buddy-menu-icon">🍎</span>Feed
          </button>
          <button type="button" onClick={() => act("play")}>
            <span class="buddy-menu-icon">🎾</span>Play
          </button>
          <button type="button" onClick={() => act("rest")}>
            <span class="buddy-menu-icon">💤</span>Rest
          </button>
          <div class="buddy-menu-label">Built-in</div>
          <div class="buddy-species">
            <For each={SPECIES}>
              {(species) => (
                <button
                  type="button"
                  classList={{
                    active: !activeId() && buddy()?.species === species,
                  }}
                  onClick={() => act("switch", species)}
                >
                  <span
                    class="buddy-dot"
                    style={{ background: SPECIES_COLOR[species] }}
                  />
                  {species}
                </button>
              )}
            </For>
          </div>
          <div class="buddy-menu-label">Pets</div>
          <Show
            when={packs().length > 0}
            fallback={<div class="buddy-menu-empty">No custom pets installed</div>}
          >
            <div class="buddy-packs">
              <For each={packs()}>
                {(pack) => (
                  <button
                    type="button"
                    classList={{ active: activeId() === pack.id }}
                    title={pack.description}
                    onClick={() => selectPack(pack.id)}
                  >
                    <span class="buddy-pack-source">
                      {pack.source === "codex" ? "Codex" : "Local"}
                    </span>
                    {pack.name}
                  </button>
                )}
              </For>
            </div>
          </Show>
          <Show when={activeId()}>
            <button type="button" onClick={() => selectPack(null)}>
              <span class="buddy-menu-icon">↩</span>Use built-in
            </button>
          </Show>
          <button type="button" onClick={openRename}>
            <span class="buddy-menu-icon">✏️</span>Rename…
          </button>
          <button type="button" onClick={() => setVisible(false)}>
            <span class="buddy-menu-icon">👻</span>Hide pet
          </button>
        </div>
      </Show>

      <div
        class="buddy-hit"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onContextMenu={(event) => {
          event.preventDefault()
          if (!menu()) void loadPacks()
          setMenu(!menu())
        }}
        title={error() || "Drag to move · click for stats · right-click for actions"}
      >
        <Show when={d()} fallback={<div class="buddy-loading">…</div>}>
          <Show
            when={activePack()}
            fallback={<PetArt species={d()!.species} state={d()!.state} />}
          >
            <SpritePet dataUrl={activePack()!.dataUrl} state={d()!.state} />
          </Show>
        </Show>
      </div>
    </div>
    </Show>
  )
}

export default Plugin.define({
  setup(ctx) {
    ctx.add(Style, css)
    ctx.add(Slot, {
      at: "window.bottom",
      order: 100,
      render: () => (
        <Portal mount={document.body}>
          <PetOverlay ctx={ctx} />
        </Portal>
      ),
    })

    const command = (id: string, title: string, run: () => void) => () => ({
      id,
      title,
      group: "Buddy",
      section: "session" as const,
      run,
    })
    const withSession = (action: string) => async () => {
      const sessionID = ctx.sessions.current()?.id ?? FALLBACK_SESSION
      try {
        await ctx.main(BuddyIpc).mutate({ sessionID, action })
        ctx.toast.show({ title: "Buddy", message: `${action} sent.` })
      } catch (err: any) {
        ctx.toast.show({
          title: "Buddy",
          message: String(err?.message ?? err),
          variant: "error",
        })
      }
    }
    ctx.add(Command, () => ({
      id: "buddy.toggle",
      title: "Toggle floating pet",
      keywords: ["buddy", "pet", "floating", "show", "hide"],
      group: "Buddy",
      section: "session" as const,
      slash: { name: "buddy-pet" },
      run: async () => {
        const visible = !petVisible()
        setPetVisible(visible)
        try {
          await ctx.main(BuddyIpc).setVisible({ visible })
        } catch {
          // The window-level toggle still applies.
        }
        ctx.toast.show({
          title: "Buddy",
          message: visible
            ? "Floating pet shown."
            : "Floating pet hidden. Type /buddy-pet to bring it back.",
        })
      },
    }))
    ctx.add(Command, command("buddy.feed", "Feed buddy", withSession("feed")))
    ctx.add(Command, command("buddy.play", "Play with buddy", withSession("play")))
    ctx.add(Command, command("buddy.rest", "Let buddy rest", withSession("rest")))
    ctx.add(
      Command,
      command("buddy.status", "Show buddy stats", () =>
        setStatsPinned(!statsPinned()),
      ),
    )
  },
  async main(ctx) {
    const main = await import("./gui-main.js")
    return main.setup(ctx)
  },
})
