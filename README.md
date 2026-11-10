# opencode-buddy

A virtual pet companion for opencode. In the TUI it lives in the sidebar as ASCII art; in OpenCode Desktop it floats over the window as an SVG pet you can drag, feed, and play with. **One buddy per opencode session** — switch sessions and you meet a different buddy; reopen the same session later and yours is exactly as you left it. Hatches, grows, and **earns xp from your actual coding** — every tool call, every completed turn, every approved permission feeds the buddy.

![Demo — the buddy in the opencode TUI sidebar (toast notification on the left, buddy panel on the right with hunger / happy / energy bars and a transitioning state)](assets/buddy-demo.gif)

```
┌──────────────────────────┐
│  opencode TUI            │
│                          │
│  > your prompt here      │
│                          │
│         sidebar          │
│ ┌──────────────────────┐ │
│ │ Quack the duck       │ │
│ │       __             │ │
│ │     <(o )___         │ │
│ │      ( ._> /         │ │
│ │       `--'           │ │
│ │ ──────────────────── │ │
│ │ hunger ████████░░ 79 │ │
│ │ happy  ████████░░ 79 │ │
│ │ energy ██████████ 100│ │
│ │ idle · Lv 1 · xp 0   │ │
│ └──────────────────────┘ │
└──────────────────────────┘
```

Since v0.5.0 the buddy is **work-driven**: xp comes from the LLM calling tools, finishing turns, and you approving permissions — not from slash commands. Slash commands stay around for "I want to feed my pet right now" interactions. The buddy gets tired when you push it hard, naps to recover when you walk away, and slows down late at night.

Since v0.6.0 the buddy is **per-session**: each opencode session has its own state file at `~/.config/opencode-buddy/sessions/<sessionID>.json`, so multiple windows and projects never share or fight over a buddy. Sessions idle for 14+ days are automatically deleted by a daily LRU sweep.

## Install

Requires OpenCode 2 (`@opencode/plugin` 2.2.6+), including OpenCode Desktop 2.2.6+.

```bash
npm install -g @mark_future_ai/opencode-buddy
```

The `postinstall` script automatically registers the plugin in your global config:

- `opencode.json` → [`plugins`](https://opencode.ai/docs/config) entry; OpenCode loads the server part (`.` → `src/server-plugin.js`), the TUI part (`./tui` → `src/tui-plugin.jsx`), and the Desktop part (`./gui-experimental` → `dist/gui-experimental.cjs`) from it.

The `postinstall` is JSONC-safe — it leaves any file that contains comments alone and asks you to add the entry manually:

```jsonc
// ~/.config/opencode/opencode.json
{
  "plugins": ["@mark_future_ai/opencode-buddy"]
}
```

Restart opencode. The buddy appears in the TUI sidebar and, in OpenCode Desktop, floats over the window.

> Upgrading from 0.6.x? opencode-buddy 1.0 moves to the OpenCode 2 plugin API and no longer runs on OpenCode 1. Remove the old `plugin` entry from `opencode.json` and the `plugin` entry from `tui.json`; `npm install -g @mark_future_ai/opencode-buddy` adds the V2 `plugins` entry for you.

## Usage

### Desktop floating pet

In OpenCode Desktop the buddy floats over the window:

- **Drag** anywhere; the position is remembered.
- **Click** for the stats card (food / happy / energy / xp).
- **Right-click** to feed, play, rest, rename, or switch pets.
- **Hide** from the right-click menu; bring it back with the command palette (`Cmd+K` / `Ctrl+K`) → **Toggle floating pet**.
- **Built-in** lists the six SVG presets. **Pets** lists custom packs installed on disk.

The TUI sidebar keeps working at the same time. Custom packs are Desktop-only; the TUI keeps rendering the built-in ASCII species.

### Slash commands

Type `/` in the prompt to see the slash commands. The buddy ships with seven:

| Slash command | Effect |
| --- | --- |
| `/buddy` | Show the current session buddy's stats as a toast |
| `/buddy-feed` | Feed the buddy (+25 hunger, -5 energy) |
| `/buddy-play` | Play with the buddy (+15 happiness, +1 xp, -10 energy, -5 hunger) |
| `/buddy-rest` | Let the buddy rest (+30 energy) |
| `/buddy-list` | List every active session's buddy (name, species, level) |
| `/buddy-rename` | Open a prompt to rename the buddy (max 20 chars) |
| `/buddy-switch` | Open a picker to switch to duck, cat, dragon, axolotl, robot, or ghost |

`/buddy-play` only gives +1 xp — meaningful xp comes from coding (see below). All slash commands except `/buddy-list` target the **current** opencode session's buddy (read from the active TUI route).

### Automatic reactions (work-driven xp & rewards)

The buddy listens to opencode's live session events. Every event tweaks the buddy's stats so the sidebar actually drifts in response to what you're doing:

| Trigger | Effect |
| --- | --- |
| Prompt submitted | enter `working` state, mark `lastPromptAt` |
| Tool call succeeds | +xp per tool (read=1, edit/write/bash=3, others=2), +0.2 happy |
| 3 consecutive tool successes (no failure) | +5 xp streak bonus |
| Same tool used >5 times in one turn | xp halved for that tool (anti-grind) |
| Tool call fails | -1 happy, -0.5 energy, streak reset; 2+ fails → `scared` |
| File edited (`filesystem.changed`) | +1 hunger (30s global throttle) |
| Shell command finished | +1 hunger, +1 energy |
| Permission granted (once/always) | +3 hunger, +1 happy |
| Git branch switched | +3 hunger, +1 happy |
| Session history compacted | +10 energy, +2 happy |
| Idle >5 min without a prompt | +5 energy (5 min cooldown) |
| **Turn finished (`session.execution.succeeded`)** | +10 base xp + accumulated (cap 30/turn), 3s `celebrating`, toast `Turn complete +N xp` or `Level up!` |
| Session error | 5s `scared` |
| **Level up** | +5 hunger, +3 energy, +3 happy |

### Passive metabolism

Between events the buddy slowly drifts on a natural clock:

| Stat | Per minute | Notes |
| --- | --- | --- |
| hunger | -0.3 | always |
| happiness | -0.2 | always |
| energy | -0.15 (×1.5 at 23:00–05:00) | drains 1.5× faster late at night |
| energy (sleeping) | **+1.0** | the buddy heals itself if you walk away |

Hard thresholds:

- **Energy < 20** → `sleeping` (animation pauses; energy recovers passively)
- **Hunger < 25** → `scared` for 30 s

State lives in `~/.config/opencode-buddy/sessions/<sessionID>.json` — one file per opencode session. Switch sessions in opencode and the sidebar swaps to the corresponding buddy. Reopen the same session later and the buddy is exactly as you left it.

### Per-session storage

```
~/.config/opencode-buddy/
└── sessions/                      # active buddies
    ├── __default__.json           # fallback for LLM tool calls with no session arg
    ├── abc-123.json               # session "abc-123"
    └── def-456.json               # session "def-456"
```

- One file per opencode session. `1000 active sessions ≈ 500 KB`.
- `__default__` is a synthetic session used when no real opencode session is in scope (e.g. the LLM tool without a `session` argument). Upgrades from v0.4/v0.5 transparently migrate the legacy global `state.json` into `sessions/__default__.json` on first read.
- A background timer runs at plugin boot and once a day, **deleting** any session file whose `idleAt` is older than 14 days. The buddy is gone for good — no archive folder to clean up later.
- `/buddy-list` shows the active roster; the current session's buddy is marked with `→`.

### What you see in the sidebar

The sidebar shows the buddy's species-specific ASCII art, plus four lines under it:

```
[BDDY]  Quack the cat        <- species + name (preceded by a rotating status dot)
<art rows>                     <- 6 rows of the species art
hunger |████░░░░░░| 79         <- hunger bar
happy  |███░░░░░░░| 60         <- happiness bar
energy |███████░░░| 70         <- energy bar
idle  Lv1  xp5/50              <- state label + level + xp progress (xp needed = level * 50)
```

The bottom state label reflects the persisted `state` field in the session's file. It changes on session events (`celebrating` / `scared` / `working`) and on energy/hunger thresholds (auto `sleeping` or `scared`). The art's idle state has 3 frames; the sidebar re-renders the current frame each time the plugin-level frame signal advances.

## Custom pets (Desktop)

The six species below are the built-in presets. The Desktop pet also loads community packs in the [Codex pet format](https://github.com/backnotprop/codex-pets-react), so pets you already use in Codex work without conversion:

- `~/.codex/pets/<id>/pet.json` + `spritesheet.webp` — auto-detected, read-only.
- `~/.config/opencode-buddy/pets/<id>/pet.json` + spritesheet — OpenCode-local.

`pet.json`:

```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "description": "A tiny friend.",
  "spriteVersionNumber": 2,
  "spritesheetPath": "spritesheet.webp"
}
```

The spritesheet is an 8×9 atlas of 192×208 px cells (1536×1872 px total). Rows, top to bottom: `idle`, `running-right`, `running-left`, `waving`, `jumping`, `failed`, `waiting`, `running`, `review`. WebP, PNG, and GIF are accepted, up to 5 MB.

Right-click the pet → **Pets** → choose a pack. **Built-in** switches back to a preset. The buddy's hunger, happiness, energy, and xp stay per-session; the pack only changes the Desktop appearance.

## Six species

```
        duck                    cat                  dragon
          __                /\_/\                  /^^\
        <(o )___          ( o.o )                (o o)  ~~
         ( ._> /           > ^ <                  >w<    ~
          `--'            /|   |\                /| |\
       ~ idle ~         (_|   |_)               (_| |_)
                           meow                   rawr

      axolotl                robot                  ghost
       ^___^              [ O . O ]              .-"-"-.
      (o . o)             /|#####|\              ( o . o )
     \|_|_|/             / |#####| \             | ~  ~ |
      \| |/               |     |                |     |
       ) (               /| | | |\               \uuuuu/
     ~ ambien              beep                   boo
```

Each species has a per-character color palette. The idle state has 3 frames; `frameCount` is exposed so the View can pick a frame to render. The buddy renders whatever frame `frame() % fc()` returns at the moment of re-render.

## Architecture

```mermaid
flowchart LR
    subgraph User
        U[Opencode TUI user]
    end

    subgraph OpencodeTUI["opencode TUI process (binary)"]
        direction TB
        Config[("opencode.json<br/>plugins: [@mark_future_ai/opencode-buddy]")]
        Runtime[TuiPluginRuntime]
        Sidebar[Sidebar component]
        Prompt[Prompt component]
        Slots{{"slot registry<br/>sidebar.content"}}
        Keymap{{"keymap<br/>(slash commands)"}}
        Bus{{"event stream<br/>(execution/tool/file/<br/>perm/shell/vcs/...)"}}

        Config --> Runtime
        Runtime --> Slots
        Runtime --> Keymap
        Slots --> Sidebar
        Keymap --> Prompt
    end

    subgraph Buddy["opencode-buddy plugin (jsx)"]
        direction TB
        TUIEntry["tui part<br/>(id: opencode-buddy.tui)"]
        View[View component<br/>SolidJS]
        FrameSignal[("frame signal<br/>(plugin-level)")]
        AnimTick[setInterval 300ms<br/>frame++ gated by energy]
        RefreshTick[setInterval 1500ms<br/>mtime poll]
        IdleTimer[setInterval 60s<br/>idle-recovery]
        Hooks["event subscriptions (10+)<br/>execution.started / tool.input /<br/>tool.success / tool.failed /<br/>filesystem.changed / permission /<br/>shell / branch / compaction /<br/>execution.succeeded / failed"]
        TurnAccum[("turnAccum<br/>per-session memory<br/>xp · tools · failures ·<br/>streak · toolCounts")]
        SlashCmds["slash commands<br/>feed / play / rest /<br/>status / rename / switch"]

        TUIEntry --> FrameSignal
        TUIEntry --> View
        TUIEntry --> SlashCmds
        TUIEntry --> Hooks
        TUIEntry --> IdleTimer
        FrameSignal --> AnimTick
        View --> RefreshTick
        Hooks <--> TurnAccum
    end

    subgraph State["Persistent state (per session)"]
        direction TB
        StateRoot["~/.config/<br/>opencode-buddy/"]
        SessionsDir["sessions/"]
        Default[("__default__.json")]
        Sess1[("abc-123.json")]
        Sess2[("def-456.json")]

        StateRoot --> SessionsDir
        SessionsDir --> Default
        SessionsDir --> Sess1
        SessionsDir --> Sess2
    end

    U -->|types| Prompt
    Prompt -->|/buddy-feed etc| Keymap
    Keymap --> SlashCmds
    SlashCmds -->|"read+write per session"| SessionsDir
    SlashCmds -->|toast feedback| U

    Slots -->|invokes renderer| View
    View -->|render frame| Sidebar
    View -->|"reads mtime per session"| SessionsDir
    RefreshTick -->|state changed| View
    Bus -->|10+ event types| Hooks
    Hooks -->|"mutate per session"| SessionsDir
    Hooks -->|Level up! / Turn complete toast| U
    IdleTimer -->|"+5 energy per session"| SessionsDir
    AnimTick -->|"reads energy per session"| SessionsDir

    classDef store fill:#1e293b,stroke:#64748b,color:#f1f5f9
    class Default,Sess1,Sess2,TurnAccum store
```

### Boot flow

1. opencode reads `~/.config/opencode/opencode.json` and discovers the buddy entry under `plugins`.
2. The plugin runtime loads the server part (`.` → `src/server-plugin.js`) and the TUI part (`./tui` → `src/tui-plugin.jsx`) from the same package entry.
3. The TUI part's `setup(context)` runs once. It sets up:
   - A **plugin-level frame signal** + `setInterval` (300 ms) that ticks it. The View is passed the signal as a prop, so slot re-renders cannot freeze the animation.
   - The `sidebar.content` slot.
   - 7 **slash commands** on the keymap layer (including `/buddy-list`).
   - 10+ **event subscriptions** on the OpenCode event stream (`session.execution.started`, `session.tool.input.started`, `session.tool.success/failed`, `filesystem.changed`, `permission.replied`, `session.shell.ended`, `vcs.branch.updated`, `session.compaction.ended`, `session.execution.succeeded/failed`). Each handler resolves the target `sessionID` from the event (or `lastActiveSessionID` for events that don't carry one) and mutates that session's file in `sessions/`, updating the in-memory `turnAccum` along the way.
   - A 60-second **idle-recovery timer** that iterates all sessions in `sessions/` and grants `+5 energy` to any whose `lastPromptAt` is older than 5 min.
   - A daily **LRU sweep** that deletes session files whose `idleAt` is older than 14 days.
4. The TUI's sidebar slot resolves to the buddy's `View`. The View reads the frame signal and re-renders the buddy art on every tick.
5. The View also runs a 1500 ms timer that polls its **own session's** file mtime. When the file changes (slash command or event handler wrote to it), the View reloads and re-renders.
6. The animation timer advances unconditionally; per-session `sleeping` buddies just render the same static frame on every tick (cheap; the `renderFrame` is pure).
7. On `session.execution.succeeded`, the event handler settles the turn atomically for that session: load → apply `onTurnDone(state, accumXp, stats)` → save. If a level-up happened, a `Level up!` toast surfaces; otherwise `Turn complete +N xp from M tool calls`.

### How one entry loads both parts

A V2 plugin package exports its parts from one `package.json`; the `plugins` entry loads all of them:

- `.` → `src/server-plugin.js` (server part: the `buddy` LLM tool)
- `./tui` → `src/tui-plugin.jsx` (TUI part: sidebar slot, slash commands, keymap)

The TUI loads the TUI part of every plugin its server loads, so there is no second config file to keep in sync.

Slash commands and event subscriptions update state instantly without round-tripping through the LLM, which is the right UX for both "I want to feed my pet right now" interactions and "the LLM just finished a turn, react now" reactions.

## Project layout

```
opencode-buddy/
├── package.json
├── README.md
├── LICENSE
├── scripts/
│   └── postinstall.mjs     # auto-registers plugin in opencode.json (V2 `plugins`)
└── src/
    ├── tui-plugin.jsx     # TUI part: per-session slot + 7 slash commands + 10+ event subscriptions
    │                      #   + idle-recovery timer + daily LRU sweep
    ├── server-plugin.js   # Server part: LLM tool (accepts session arg) + action=list
    ├── species.js         # ASCII art + per-species palettes + 3-frame idle loop
    ├── state.js           # state machine: tick (night/sleep aware), feed, play, rest,
    │                      #   plus event-driven mutators (onPromptStart, onToolSuccess,
    │                      #   onToolFailure, onTurnDone, onTodoCompleted, onFileEdited,
    │                      #   onPermissionAllowed, onShellSuccess, onBranchUpdated,
    │                      #   onCompacted, onIdleRecovery, onStreak), maybeLevelUp
    └── persistence.js     # per-session load/save/mtime + sweep + listSessions + legacy migration
```

State lives at `~/.config/opencode-buddy/sessions/<sessionID>.json` (one file per opencode session, plus a `__default__` synthetic session for LLM tool calls outside a session). `~/.config` resolves via `os.homedir()` so it works on Linux, macOS, and Windows.

## Uninstall

```bash
npm uninstall -g @mark_future_ai/opencode-buddy
```

Then remove `"@mark_future_ai/opencode-buddy"` from the `plugins` array in `opencode.json` (the npm uninstall does not auto-edit user config).

## License

MIT
