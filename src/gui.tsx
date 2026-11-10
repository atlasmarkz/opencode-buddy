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
type PacksResponse = { packs: PackInfo[]; active: string | null }

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

// Module-level so palette commands can toggle the same stats card.
const [statsPinned, setStatsPinned] = createSignal(false)

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

function Face(props: {
  x: number
  y: number
  scale?: number
  dark?: string
  cheek?: string
  mouth?: boolean
  cheeks?: boolean
}) {
  const dark = props.dark ?? "#3a2b2b"
  const cheek = props.cheek ?? "#ff9fb2"
  return (
    <g
      class="buddy-face"
      transform={`translate(${props.x} ${props.y}) scale(${props.scale ?? 1})`}
    >
      <g class="buddy-eyes-open">
        <ellipse cx="-9" cy="0" rx="4.6" ry="5.5" fill={dark} />
        <ellipse cx="9" cy="0" rx="4.6" ry="5.5" fill={dark} />
        <circle cx="-10.7" cy="-2.1" r="1.8" fill="#fff" opacity=".95" />
        <circle cx="7.3" cy="-2.1" r="1.8" fill="#fff" opacity=".95" />
        <circle cx="-7.3" cy="2.4" r=".9" fill="#fff" opacity=".65" />
        <circle cx="10.7" cy="2.4" r=".9" fill="#fff" opacity=".65" />
      </g>
      <g
        class="buddy-eyes-happy"
        fill="none"
        stroke={dark}
        stroke-width="2.4"
        stroke-linecap="round"
      >
        <path d="M-13 2 q4 -6 8 0" />
        <path d="M5 2 q4 -6 8 0" />
      </g>
      <g
        class="buddy-eyes-sleep"
        fill="none"
        stroke={dark}
        stroke-width="2.2"
        stroke-linecap="round"
      >
        <path d="M-13 0 q4 4 8 0" />
        <path d="M5 0 q4 4 8 0" />
      </g>
      <g class="buddy-eyes-wide">
        <ellipse cx="-9" cy="0" rx="5.4" ry="6.4" fill="#fff" />
        <ellipse cx="9" cy="0" rx="5.4" ry="6.4" fill="#fff" />
        <circle cx="-9" cy="1" r="2.6" fill={dark} />
        <circle cx="9" cy="1" r="2.6" fill={dark} />
        <circle cx="-10.2" cy="-.6" r="1" fill="#fff" />
        <circle cx="7.8" cy="-.6" r="1" fill="#fff" />
      </g>
      <Show when={props.mouth !== false}>
        <path
          class="buddy-mouth-smile"
          d="M-4 9 q4 4 8 0"
          fill="none"
          stroke={dark}
          stroke-width="2"
          stroke-linecap="round"
        />
        <path class="buddy-mouth-open" d="M-4 8 q4 7 8 0 q-4 2 -8 0" fill={dark} />
        <path
          class="buddy-mouth-sleep"
          d="M-2 9 q2 -2 4 0"
          fill="none"
          stroke={dark}
          stroke-width="1.8"
          stroke-linecap="round"
        />
        <path
          class="buddy-mouth-wavy"
          d="M-5 9 q2 -3 4 0 q2 3 4 0"
          fill="none"
          stroke={dark}
          stroke-width="1.9"
          stroke-linecap="round"
        />
      </Show>
      <Show when={props.cheeks !== false}>
        <ellipse class="buddy-blush" cx="-16" cy="8" rx="5" ry="3" fill={cheek} />
        <ellipse class="buddy-blush" cx="16" cy="8" rx="5" ry="3" fill={cheek} />
      </Show>
    </g>
  )
}

function PetArt(props: { species: string; state: string }) {
  return (
    <svg
      class={`buddy-pet species-${props.species} is-${props.state}`}
      viewBox="0 0 120 120"
      role="img"
      aria-label={`${props.species} buddy, ${props.state}`}
    >
      <defs>
        <filter id="buddy-soft" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id="buddy-shadow-blur" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
        <radialGradient id="duck-head" cx="36%" cy="26%" r="80%">
          <stop offset="0" stop-color="#fffbe0" />
          <stop offset="55%" stop-color="#ffe066" />
          <stop offset="100%" stop-color="#f7c948" />
        </radialGradient>
        <linearGradient id="duck-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffe066" />
          <stop offset="100%" stop-color="#f5b800" />
        </linearGradient>
        <linearGradient id="duck-beak" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffc14d" />
          <stop offset="100%" stop-color="#f59f00" />
        </linearGradient>
        <radialGradient id="cat-head" cx="36%" cy="26%" r="80%">
          <stop offset="0" stop-color="#fff3e3" />
          <stop offset="58%" stop-color="#ffd0a6" />
          <stop offset="100%" stop-color="#f6a96b" />
        </radialGradient>
        <linearGradient id="cat-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffd0a6" />
          <stop offset="100%" stop-color="#e8904f" />
        </linearGradient>
        <radialGradient id="dragon-head" cx="36%" cy="26%" r="80%">
          <stop offset="0" stop-color="#e5ffe9" />
          <stop offset="55%" stop-color="#8ee59a" />
          <stop offset="100%" stop-color="#5fbe6c" />
        </radialGradient>
        <linearGradient id="dragon-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#8ee59a" />
          <stop offset="100%" stop-color="#4fae5b" />
        </linearGradient>
        <radialGradient id="axo-head" cx="36%" cy="26%" r="80%">
          <stop offset="0" stop-color="#fff4f7" />
          <stop offset="55%" stop-color="#ffc9d8" />
          <stop offset="100%" stop-color="#ffa8c0" />
        </radialGradient>
        <linearGradient id="axo-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffc9d8" />
          <stop offset="100%" stop-color="#ff9fb8" />
        </linearGradient>
        <linearGradient id="robot-head" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#eef3f8" />
          <stop offset="100%" stop-color="#9aa7b8" />
        </linearGradient>
        <linearGradient id="robot-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#d7dee7" />
          <stop offset="100%" stop-color="#7b8794" />
        </linearGradient>
        <linearGradient id="ghost-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f3f1ff" />
          <stop offset="100%" stop-color="#c9c4f5" />
        </linearGradient>
      </defs>

      <ellipse class="buddy-aura" cx="60" cy="68" rx="42" ry="38" filter="url(#buddy-soft)" />
      <ellipse
        class="buddy-shadow"
        cx="60"
        cy="111"
        rx="26"
        ry="4.5"
        filter="url(#buddy-shadow-blur)"
      />

      <Switch>
        <Match when={props.species === "duck"}>
          <g class="buddy-body">
            <ellipse cx="60" cy="86" rx="25" ry="20" fill="url(#duck-body)" />
            <ellipse cx="60" cy="48" rx="26" ry="25" fill="url(#duck-head)" />
            <ellipse cx="48" cy="34" rx="10" ry="6" fill="#fff" opacity=".26" transform="rotate(-24 48 34)" />
            <path d="M45 29 q-5 -13 7 -15 q-1 9 3 12" fill="#f7b731" />
            <path d="M53 26 q1 -10 9 -9 q-3 7 0 10" fill="#ffd43b" />
            <ellipse class="buddy-wing" cx="35" cy="86" rx="9" ry="13" fill="#f5b800" transform="rotate(18 35 86)" />
            <ellipse class="buddy-wing" cx="85" cy="86" rx="9" ry="13" fill="#f5b800" transform="rotate(-18 85 86)" />
            <ellipse cx="60" cy="89" rx="14" ry="12" fill="#fff6cc" opacity=".6" />
            <path d="M51 57 q9 -5 18 0 q-3 9 -9 9 q-6 0 -9 -9" fill="url(#duck-beak)" />
            <path d="M54 58 q6 -2 12 0" stroke="#e8890c" stroke-width="1.4" fill="none" stroke-linecap="round" />
            <path d="M48 104 l-4 7 M48 104 l0 8 M48 104 l4 7" stroke="#f59f00" stroke-width="3" stroke-linecap="round" />
            <path d="M72 104 l-4 7 M72 104 l0 8 M72 104 l4 7" stroke="#f59f00" stroke-width="3" stroke-linecap="round" />
            <Face x="60" y="46" dark="#4a3418" cheek="#ff9fb2" mouth={false} />
          </g>
        </Match>

        <Match when={props.species === "cat"}>
          <g class="buddy-body">
            <path
              class="buddy-tail"
              d="M83 93 q22 -2 18 -23 q-2 -8 -10 -6"
              fill="none"
              stroke="url(#cat-body)"
              stroke-width="9"
              stroke-linecap="round"
            />
            <path d="M91 64 q5 2 6 6" stroke="#fff1e0" stroke-width="5" stroke-linecap="round" />
            <path d="M38 35 L31 12 L53 27 Z" fill="url(#cat-head)" />
            <path d="M41 31 L37 19 L49 27 Z" fill="#ffb3c7" />
            <path d="M82 35 L89 12 L67 27 Z" fill="url(#cat-head)" />
            <path d="M79 31 L83 19 L71 27 Z" fill="#ffb3c7" />
            <ellipse cx="60" cy="86" rx="24" ry="20" fill="url(#cat-body)" />
            <ellipse cx="60" cy="90" rx="14" ry="12" fill="#fff1e0" opacity=".75" />
            <circle cx="60" cy="48" r="26" fill="url(#cat-head)" />
            <ellipse cx="48" cy="34" rx="9" ry="5" fill="#fff" opacity=".3" transform="rotate(-24 48 34)" />
            <path d="M52 24 q2 6 0 9 M60 23 q0 7 0 10 M68 24 q-2 6 0 9" stroke="#d97a3a" stroke-width="2" stroke-linecap="round" opacity=".55" />
            <ellipse cx="60" cy="61" rx="12" ry="8" fill="#fff8ef" opacity=".92" />
            <path d="M57 57 h6 l-3 4 z" fill="#ff8fa3" />
            <path d="M60 61 v3 M57 63 q3 3 6 0" fill="none" stroke="#c97b4a" stroke-width="1.7" stroke-linecap="round" />
            <path d="M44 58 l-12 -2 M44 62 l-12 2 M76 58 l12 -2 M76 62 l12 2" stroke="#c97b4a" stroke-width="1.2" stroke-linecap="round" opacity=".65" />
            <ellipse cx="47" cy="104" rx="8" ry="5" fill="#fff1e0" />
            <ellipse cx="73" cy="104" rx="8" ry="5" fill="#fff1e0" />
            <Face x="60" y="46" dark="#3a2b2b" cheek="#ff9fb2" mouth={false} />
          </g>
        </Match>

        <Match when={props.species === "dragon"}>
          <g class="buddy-body">
            <path
              class="buddy-tail"
              d="M83 94 q21 4 18 -15 q-1 -7 -8 -7"
              fill="none"
              stroke="#4fae5b"
              stroke-width="8"
              stroke-linecap="round"
            />
            <path d="M96 72 l9 -6 l-9 -4 z" fill="#4fae5b" />
            <path d="M39 78 q-21 -18 -28 -2 q11 2 15 12 q6 -1 13 -10" fill="#3f9e52" opacity=".92" />
            <path d="M81 78 q21 -18 28 -2 q-11 2 -15 12 q-6 -1 -13 -10" fill="#3f9e52" opacity=".92" />
            <ellipse cx="60" cy="86" rx="24" ry="20" fill="url(#dragon-body)" />
            <ellipse cx="60" cy="90" rx="13" ry="12" fill="#fff3c4" opacity=".85" />
            <circle cx="60" cy="48" r="26" fill="url(#dragon-head)" />
            <ellipse cx="48" cy="34" rx="9" ry="5" fill="#fff" opacity=".28" transform="rotate(-24 48 34)" />
            <path d="M45 29 q-4 -13 6 -16 q-1 10 3 14" fill="#f2d388" />
            <path d="M75 29 q4 -13 -6 -16 q1 10 -3 14" fill="#f2d388" />
            <path d="M57 23 l3 -9 l3 9" fill="#a8f0b0" />
            <ellipse cx="60" cy="61" rx="9" ry="6" fill="#d8ffdd" opacity=".65" />
            <circle cx="55" cy="55" r="1" fill="#3f9e52" />
            <circle cx="65" cy="55" r="1" fill="#3f9e52" />
            <path d="M55 62 q5 4 10 0" fill="none" stroke="#2f3a20" stroke-width="1.8" stroke-linecap="round" />
            <path d="M53 61 l2 4 l2 -4 M63 61 l2 4 l2 -4" fill="#fff" />
            <ellipse cx="48" cy="104" rx="8" ry="5" fill="#4fae5b" />
            <ellipse cx="72" cy="104" rx="8" ry="5" fill="#4fae5b" />
            <Face x="60" y="46" dark="#2f3a20" cheek="#ff9fb2" mouth={false} />
          </g>
        </Match>

        <Match when={props.species === "axolotl"}>
          <g class="buddy-body">
            <path
              class="buddy-tail"
              d="M83 96 q18 6 20 -10 q-2 -8 -10 -8"
              fill="none"
              stroke="#ff8fab"
              stroke-width="9"
              stroke-linecap="round"
              opacity=".9"
            />
            <path d="M87 98 q12 2 16 -4" stroke="#ffc9d8" stroke-width="4" stroke-linecap="round" />
            <g stroke="#ff8fab" stroke-width="4.5" stroke-linecap="round" fill="none">
              <path d="M38 42 q-14 -8 -18 -16" />
              <path d="M36 51 q-16 -2 -20 -2" />
              <path d="M38 60 q-14 6 -18 14" />
              <path d="M82 42 q14 -8 18 -16" />
              <path d="M84 51 q16 -2 20 -2" />
              <path d="M82 60 q14 6 18 14" />
            </g>
            <g fill="#ff8fab">
              <circle cx="20" cy="26" r="3" />
              <circle cx="16" cy="49" r="3" />
              <circle cx="20" cy="74" r="3" />
              <circle cx="100" cy="26" r="3" />
              <circle cx="104" cy="49" r="3" />
              <circle cx="100" cy="74" r="3" />
            </g>
            <ellipse cx="60" cy="86" rx="23" ry="19" fill="url(#axo-body)" />
            <ellipse cx="60" cy="90" rx="13" ry="12" fill="#fff0f4" opacity=".8" />
            <circle cx="60" cy="50" r="25" fill="url(#axo-head)" />
            <ellipse cx="48" cy="37" rx="9" ry="5" fill="#fff" opacity=".3" transform="rotate(-24 48 37)" />
            <path d="M60 27 q6 -10 12 -3 q-6 1 -8 8" fill="#ff8fab" opacity=".7" />
            <ellipse cx="38" cy="88" rx="6" ry="9" fill="#ffc9d8" transform="rotate(20 38 88)" />
            <ellipse cx="82" cy="88" rx="6" ry="9" fill="#ffc9d8" transform="rotate(-20 82 88)" />
            <Face x="60" y="50" dark="#5b3a4a" cheek="#ff7fa3" />
          </g>
        </Match>

        <Match when={props.species === "robot"}>
          <g class="buddy-body">
            <path d="M60 26 v-9" stroke="#8b98a8" stroke-width="3" stroke-linecap="round" />
            <circle class="buddy-antenna" cx="60" cy="13" r="5" fill="#6ee7f9" />
            <rect x="34" y="26" width="52" height="45" rx="14" fill="url(#robot-head)" />
            <rect x="41" y="34" width="38" height="30" rx="9" fill="#1b2430" />
            <g class="buddy-robot-face">
              <g class="buddy-robot-eyes-open">
                <rect x="47" y="43" width="8" height="10" rx="3" fill="#7ef7c7" />
                <rect x="65" y="43" width="8" height="10" rx="3" fill="#7ef7c7" />
                <rect x="49" y="45" width="3" height="4" rx="1.5" fill="#eafff8" opacity=".85" />
                <rect x="67" y="45" width="3" height="4" rx="1.5" fill="#eafff8" opacity=".85" />
              </g>
              <g class="buddy-robot-eyes-happy" fill="none" stroke="#7ef7c7" stroke-width="2.4" stroke-linecap="round">
                <path d="M47 50 q4 -6 8 0" />
                <path d="M65 50 q4 -6 8 0" />
              </g>
              <g class="buddy-robot-eyes-sleep" fill="none" stroke="#7ef7c7" stroke-width="2.4" stroke-linecap="round">
                <path d="M47 49 q4 4 8 0" />
                <path d="M65 49 q4 4 8 0" />
              </g>
              <g class="buddy-robot-eyes-wide">
                <rect x="46" y="42" width="10" height="12" rx="3" fill="#7ef7c7" />
                <rect x="64" y="42" width="10" height="12" rx="3" fill="#7ef7c7" />
                <rect x="49" y="46" width="4" height="6" rx="2" fill="#0f172a" />
                <rect x="67" y="46" width="4" height="6" rx="2" fill="#0f172a" />
              </g>
              <path class="buddy-robot-mouth-smile" d="M55 57 q5 4 10 0" fill="none" stroke="#7ef7c7" stroke-width="2" stroke-linecap="round" />
              <path class="buddy-robot-mouth-open" d="M55 56 q5 7 10 0 q-5 2 -10 0" fill="#7ef7c7" />
              <path class="buddy-robot-mouth-sleep" d="M57 57 q3 -2 6 0" fill="none" stroke="#7ef7c7" stroke-width="1.8" stroke-linecap="round" />
              <path class="buddy-robot-mouth-wavy" d="M54 57 q2 -3 4 0 q2 3 4 0" fill="none" stroke="#7ef7c7" stroke-width="1.9" stroke-linecap="round" />
            </g>
            <circle cx="32" cy="48" r="5" fill="#8b98a8" />
            <circle cx="88" cy="48" r="5" fill="#8b98a8" />
            <rect x="42" y="72" width="36" height="28" rx="10" fill="url(#robot-body)" />
            <rect x="50" y="80" width="20" height="12" rx="4" fill="#1b2430" />
            <circle class="buddy-robot-core" cx="60" cy="86" r="3.2" fill="#6ee7f9" />
            <rect x="30" y="76" width="8" height="18" rx="4" fill="#8b98a8" />
            <rect x="82" y="76" width="8" height="18" rx="4" fill="#8b98a8" />
            <rect x="46" y="100" width="12" height="6" rx="3" fill="#7b8794" />
            <rect x="62" y="100" width="12" height="6" rx="3" fill="#7b8794" />
          </g>
        </Match>

        <Match when={props.species === "ghost"}>
          <g class="buddy-body">
            <path
              d="M34 100 v-44 q0 -30 26 -30 q26 0 26 30 v44 l-9 -7 l-8 7 l-9 -7 l-8 7 l-9 -7 z"
              fill="url(#ghost-body)"
            />
            <path d="M44 38 q4 -12 16 -14" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".35" fill="none" />
            <path d="M34 78 q-12 -4 -12 6 q7 -1 11 4" fill="url(#ghost-body)" />
            <path d="M86 78 q12 -4 12 6 q-7 -1 -11 4" fill="url(#ghost-body)" />
            <Face x="60" y="52" dark="#4e4868" cheek="#ffa3c0" />
          </g>
        </Match>
      </Switch>

      <g class="buddy-work-prop">
        <rect x="44" y="94" width="32" height="16" rx="4" fill="#1b2430" stroke="#4b5563" stroke-width="1.5" />
        <rect x="48" y="97" width="24" height="9" rx="2" fill="#0ea5e9" opacity=".22" />
        <path d="M52 102 l3 -3 l-3 -3 M56 99 h4" stroke="#7ef7c7" stroke-width="1.4" fill="none" stroke-linecap="round" />
        <rect x="40" y="109" width="40" height="3" rx="1.5" fill="#374151" />
      </g>

      <Show when={props.state === "sleeping"}>
        <g class="buddy-zzz">
          <text x="92" y="34">z</text>
          <text x="101" y="24">z</text>
        </g>
      </Show>
      <Show when={props.state === "celebrating"}>
        <g class="buddy-sparkles">
          <path d="M100 34 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2 z" />
          <path d="M20 50 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 z" />
          <path d="M96 66 l1.5 4 l4 1.5 l-4 1.5 l-1.5 4 l-1.5 -4 l-4 -1.5 l4 -1.5 z" />
        </g>
      </Show>
      <Show when={props.state === "scared"}>
        <path class="buddy-sweat" d="M96 44 q6 9 0 13 q-6 -4 0 -13" />
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
