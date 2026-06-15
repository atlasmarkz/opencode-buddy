/** @jsxImportSource @opentui/solid */
import { createSignal, createMemo, onCleanup } from "solid-js"
import * as persistence from "./persistence.js"
import {
  tick as tickState,
  scared as scaredState,
  deriveState,
  feed,
  play,
  rest,
  rename,
  switchSpecies,
  onPromptStart,
  onToolSuccess,
  onToolFailure,
  onTurnDone,
  onTodoCompleted,
  onFileEdited,
  onPermissionAllowed,
  onShellSuccess,
  onBranchUpdated,
  onCompacted,
  onIdleRecovery,
  onStreak,
  toolXp,
} from "./state.js"
import { renderFrame, frameCount, frameIntervalMs, SPECIES } from "./species.js"

const ANIMATION_TICK_MS = frameIntervalMs()
const REFRESH_TICK_MS = 1500

const FALLBACK_SESSION = "__default__"

const norm = (sid) => (sid && typeof sid === "string" ? sid : FALLBACK_SESSION)

function View(props) {
  const api = props.api
  const sessionID = norm(props.session_id)
  const theme = () => api.theme.current
  const frame = props.frame
  const [state, setState] = createSignal(null)
  const [lastMtime, setLastMtime] = createSignal(0)
  const [tick, setTick] = createSignal(0)

  const refresh = async () => {
    try {
      const mt = await persistence.mtime(sessionID)
      if (mt === 0) {
        // No file yet → hatch a fresh buddy for this session
        const fresh = {
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
          idleAt: Date.now(),
          state: "idle",
          stateUntil: 0,
          stateReason: "",
        }
        await persistence.save(sessionID, fresh)
        setLastMtime(Date.now())
        setState(fresh)
        setTick(tick() + 1)
        return
      }
      if (mt !== lastMtime()) {
        setLastMtime(mt)
        const onDisk = await persistence.load(sessionID)
        if (onDisk) {
          const ticked = tickState(onDisk)
          const derived = deriveState(ticked)
          setState(derived)
          setTick(tick() + 1)
          persistence.save(sessionID, derived).catch(() => {})
        }
      }
    } catch (err) {
      console.error("[buddy] refresh error", err)
    }
  }

  refresh()
  const refreshTimer = setInterval(refresh, REFRESH_TICK_MS)
  onCleanup(() => clearInterval(refreshTimer))

  // The frame signal lives at the plugin level (see tui() below). It
  // is passed in as a prop so this View can read its current value
  // without owning a timer of its own.

  const current = state
  const species = () => (current() ? current().species : "duck")
  const buddyState = () => (current() ? current().state : "idle")
  const fc = createMemo(() => frameCount(species(), buddyState()))
  const lines = createMemo(() => renderFrame(species(), buddyState(), frame() % Math.max(1, fc())))

  const barStr = (v) => {
    const filled = Math.round((v / 100) * 10)
    return "|" + "\u2588".repeat(filled) + "\u2591".repeat(10 - filled) + "|"
  }

  const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "")

  const speciesColor = () => {
    const sp = current()?.species
    if (sp === "cat") return theme().accent
    if (sp === "duck") return theme().success
    if (sp === "dragon") return theme().error
    if (sp === "axolotl") return theme().accent
    if (sp === "robot") return theme().info
    if (sp === "ghost") return theme().text
    return theme().text
  }

  const SPINNER = ["\u25D0", "\u25D3", "\u25D1", "\u25D2"]
  const spinner = () => SPINNER[frame() % SPINNER.length]

  return (
    <box>
      <text fg={theme().accent}>{spinner()}  {current() ? current().name + " the " + current().species : "BUDDY"}</text>
      <text fg={speciesColor()}>{stripAnsi(lines()[0] ?? "")}</text>
      <text fg={speciesColor()}>{stripAnsi(lines()[1] ?? "")}</text>
      <text fg={speciesColor()}>{stripAnsi(lines()[2] ?? "")}</text>
      <text fg={speciesColor()}>{stripAnsi(lines()[3] ?? "")}</text>
      <text fg={speciesColor()}>{stripAnsi(lines()[4] ?? "")}</text>
      <text fg={speciesColor()}>{stripAnsi(lines()[5] ?? "")}</text>
      <text fg={theme().textMuted}>hunger {barStr(current()?.hunger ?? 0)} {Math.floor(current()?.hunger ?? 0)}</text>
      <text fg={theme().textMuted}>happy  {barStr(current()?.happiness ?? 0)} {Math.floor(current()?.happiness ?? 0)}</text>
      <text fg={theme().textMuted}>energy {barStr(current()?.energy ?? 0)} {Math.floor(current()?.energy ?? 0)}</text>
      <text fg={theme().textMuted}>{current()?.state ?? "..."}  Lv{current()?.level ?? 1}  xp{current()?.xp ?? 0}/{(current()?.level ?? 1) * 50}</text>
    </box>
  )
}

const tui = async (api) => {
  // Plugin-level frame signal. Always advances; per-session sleeping
  // buddies just render the same frame, which is cheap and simpler
  // than per-session signals.
  const [getFrame, setFrame] = createSignal(0)
  api.__buddyFrame = { getFrame, setFrame }
  setInterval(() => setFrame((f) => f + 1), ANIMATION_TICK_MS)

  // Per-session View cache so the View survives slot re-renders.
  const viewCache = new Map()

  api.slots.register({
    order: 50,
    slots: {
      sidebar_content(_ctx, props) {
        const key = norm(props.session_id)
        if (!viewCache.has(key)) {
          viewCache.set(key, <View api={api} session_id={props.session_id} frame={getFrame} />)
        }
        return viewCache.get(key)
      },
    },
  })

  // The current opencode session from the TUI route. Fallback to
  // FALLBACK_SESSION when on the home screen (no active session).
  const currentSessionID = () => {
    try {
      const r = api.route?.current
      if (r && r.name === "session" && r.params?.sessionID) return norm(r.params.sessionID)
    } catch {}
    return FALLBACK_SESSION
  }

  // Mutate helper: load → transform → save, per session. Swallow errors
  // so a buddy hiccup never breaks the host session.
  const mutate = async (sessionID, fn) => {
    try {
      const sid = norm(sessionID)
      const s = await persistence.load(sid)
      if (!s) return null
      const next = fn(s)
      if (!next || next === s) return next
      await persistence.save(sid, next)
      return next
    } catch (err) {
      console.error("[buddy] mutate error", err)
      return null
    }
  }

  // ---------- Slash commands ----------

  const feedBuddy = async () => {
    const sid = currentSessionID()
    const next = await mutate(sid, (s) => feed(s))
    if (next) api.ui.toast({ variant: "success", title: "Yum!", message: `${next.name} ate a snack.` })
  }
  const playBuddy = async () => {
    const sid = currentSessionID()
    const next = await mutate(sid, (s) => play(s))
    if (next) api.ui.toast({ variant: "success", title: "Woohoo!", message: `${next.name} played (+1xp).` })
  }
  const restBuddy = async () => {
    const sid = currentSessionID()
    const next = await mutate(sid, (s) => rest(s))
    if (next) api.ui.toast({ variant: "info", title: "Zzz", message: `${next.name} is napping.` })
  }
  const statusBuddy = async () => {
    const sid = currentSessionID()
    const s = await persistence.load(sid)
    if (!s) {
      api.ui.toast({ variant: "info", title: "No buddy", message: "Open a session to hatch a buddy." })
      return
    }
    api.ui.toast({
      variant: "info",
      title: `${s.name} the ${s.species}`,
      message: `Lv${s.level} xp${s.xp}/${s.level * 50} - hunger ${Math.floor(s.hunger)} happy ${Math.floor(s.happiness)} energy ${Math.floor(s.energy)}`,
    })
  }
  const renameBuddy = () => {
    api.ui.dialog.replace(() => (
      <api.ui.DialogPrompt
        title="Rename buddy"
        placeholder="New name (max 20 chars)"
        onConfirm={async (value) => {
          const sid = currentSessionID()
          const next = await mutate(sid, (s) => rename(s, value))
          if (next) api.ui.toast({ variant: "success", title: "Renamed", message: `Now called ${next.name}.` })
        }}
        onCancel={() => {}}
      />
    ))
  }
  const switchBuddy = () => {
    const options = SPECIES.map((sp) => ({
      title: sp,
      value: sp,
      onSelect: async () => {
        const sid = currentSessionID()
        const next = await mutate(sid, (s) => switchSpecies(s, sp))
        if (next) api.ui.toast({ variant: "success", title: "Morphed", message: `Now a ${sp}.` })
        api.ui.dialog.clear()
      },
    }))
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title="Switch species"
        options={options}
        onSelect={() => {}}
      />
    ))
  }

  const listBuddies = async () => {
    const sessions = await persistence.listSessions()
    if (sessions.length === 0) {
      api.ui.toast({ variant: "info", title: "No buddies", message: "Open a session to hatch one." })
      return
    }
    const cur = currentSessionID()
    const lines = sessions
      .map((b) => {
        const tag = b.sessionID === cur ? "→" : "·"
        const short = b.sessionID === "__default__"
          ? "default"
          : b.sessionID.replace(/^ses_/, "").slice(0, 6) + "…"
        return `${tag} ${b.name} the ${b.species} Lv${b.level} (${short})`
      })
      .join("\n")
    api.ui.toast({
      variant: "info",
      title: `${sessions.length} session${sessions.length === 1 ? "" : "s"}`,
      message: lines,
      duration: 5000,
    })
  }

  api.keymap.registerLayer({
    commands: [
      {
        namespace: "palette",
        name: "buddy.feed",
        title: "Feed buddy",
        slashName: "buddy-feed",
        category: "Buddy",
        run() {
          api.ui.dialog.clear()
          void feedBuddy()
        },
      },
      {
        namespace: "palette",
        name: "buddy.play",
        title: "Play with buddy",
        slashName: "buddy-play",
        category: "Buddy",
        run() {
          api.ui.dialog.clear()
          void playBuddy()
        },
      },
      {
        namespace: "palette",
        name: "buddy.rest",
        title: "Buddy rests",
        slashName: "buddy-rest",
        category: "Buddy",
        run() {
          api.ui.dialog.clear()
          void restBuddy()
        },
      },
      {
        namespace: "palette",
        name: "buddy.status",
        title: "Show buddy status",
        slashName: "buddy",
        slashAliases: ["buddy-status"],
        category: "Buddy",
        run() {
          api.ui.dialog.clear()
          void statusBuddy()
        },
      },
      {
        namespace: "palette",
        name: "buddy.list",
        title: "List all session buddies",
        slashName: "buddy-list",
        category: "Buddy",
        run() {
          api.ui.dialog.clear()
          void listBuddies()
        },
      },
      {
        namespace: "palette",
        name: "buddy.rename",
        title: "Rename buddy",
        slashName: "buddy-rename",
        category: "Buddy",
        run() {
          renameBuddy()
        },
      },
      {
        namespace: "palette",
        name: "buddy.switch",
        title: "Switch buddy species",
        slashName: "buddy-switch",
        category: "Buddy",
        run() {
          switchBuddy()
        },
      },
    ],
    bindings: [],
  })

  // ---------- Work-driven progression (per session) ----------

  const TURN_XP_CAP = 30
  const FILE_EDIT_THROTTLE_MS = 30_000
  const SCARED_FAILURE_THRESHOLD = 2
  const STREAK_THRESHOLD = 3
  const SAME_TOOL_HALVE_AFTER = 5
  const IDLE_RECOVERY_MS = 5 * 60_000
  const IDLE_RECOVERY_CHECK_MS = 60_000
  const ARCHIVE_AFTER_MS = 30 * 24 * 60 * 60_000 // 30 days idle → archive
  const ARCHIVE_CHECK_MS = 24 * 60 * 60_000 // check once per day

  // File-edited is global (no sessionID in the event). Apply to the
  // most recently active session. Global throttle prevents spam.
  let lastFileEditedAt = 0
  let lastActiveSessionID = FALLBACK_SESSION
  const rememberActive = (sid) => {
    const n = norm(sid)
    if (n) lastActiveSessionID = n
  }

  // sessionID -> { xp, tools, failures, streak, lastTodoCompletedCount, toolCounts, __lastToolWeight }
  const turnAccum = new Map()

  const getAccum = (sessionID) => {
    const key = norm(sessionID)
    let a = turnAccum.get(key)
    if (!a) {
      a = { xp: 0, tools: 0, failures: 0, streak: 0, lastTodoCompletedCount: 0, toolCounts: {} }
      turnAccum.set(key, a)
    }
    return a
  }
  const resetAccum = (sessionID) => turnAccum.delete(norm(sessionID))

  // User submitted a prompt → buddy starts working.
  api.event.on("session.next.prompted", async (ev) => {
    const sid = ev?.properties?.sessionID
    rememberActive(sid)
    getAccum(sid)
    await mutate(sid, (s) => onPromptStart(s))
  })

  api.event.on("session.next.tool.success", async (ev) => {
    const sid = ev?.properties?.sessionID
    rememberActive(sid)
    const a = getAccum(sid)
    const weight = a.__lastToolWeight ?? 2
    a.xp = Math.min(TURN_XP_CAP, a.xp + weight)
    a.tools += 1
    a.streak += 1
    a.__lastToolWeight = undefined
    await mutate(sid, (s) => onToolSuccess(s))
    if (a.streak > 0 && a.streak % STREAK_THRESHOLD === 0) {
      await mutate(sid, (s) => onStreak(s))
    }
  })

  api.event.on("session.next.tool.called", (ev) => {
    const sid = ev?.properties?.sessionID
    rememberActive(sid)
    const name = ev?.properties?.tool
    const a = getAccum(sid)
    const key = (name || "_").toLowerCase()
    a.toolCounts[key] = (a.toolCounts[key] ?? 0) + 1
    let weight = toolXp(name)
    if (a.toolCounts[key] > SAME_TOOL_HALVE_AFTER) {
      weight = Math.max(1, Math.floor(weight / 2))
    }
    a.__lastToolWeight = weight
  })

  api.event.on("session.next.tool.failed", async (ev) => {
    const sid = ev?.properties?.sessionID
    rememberActive(sid)
    const a = getAccum(sid)
    a.failures += 1
    a.streak = 0
    await mutate(sid, (s) => {
      const dipped = onToolFailure(s)
      return a.failures >= SCARED_FAILURE_THRESHOLD ? scaredState(dipped) : dipped
    })
  })

  api.event.on("todo.updated", async (ev) => {
    const sid = ev?.properties?.sessionID
    rememberActive(sid)
    const todos = ev?.properties?.todos ?? []
    const completedNow = todos.filter((t) => t.status === "completed").length
    const a = getAccum(sid)
    const delta = completedNow - a.lastTodoCompletedCount
    a.lastTodoCompletedCount = completedNow
    if (delta <= 0) return
    await mutate(sid, (s) => onTodoCompleted(s, delta))
  })

  // No sessionID in file.edited; route to last active session.
  api.event.on("file.edited", async () => {
    const now = Date.now()
    if (now - lastFileEditedAt < FILE_EDIT_THROTTLE_MS) return
    lastFileEditedAt = now
    await mutate(lastActiveSessionID, (s) => onFileEdited(s))
  })

  api.event.on("session.idle", async (ev) => {
    const sid = ev?.properties?.sessionID
    rememberActive(sid)
    const a = getAccum(sid)
    const earned = a.xp
    const stats = { tools: a.tools, failures: a.failures }
    resetAccum(sid)
    try {
      const before = await persistence.load(norm(sid))
      if (!before) return
      const after = onTurnDone(before, earned, stats)
      await persistence.save(norm(sid), after)
      if (after.level > before.level) {
        api.ui.toast({
          variant: "success",
          title: "Level up!",
          message: `${after.name} reached Lv${after.level} (+${10 + earned} xp).`,
        })
      } else if (earned > 0 || stats.tools > 0) {
        api.ui.toast({
          variant: "info",
          title: "Turn complete",
          message: `${after.name} earned ${10 + earned} xp from ${stats.tools} tool call${stats.tools === 1 ? "" : "s"}.`,
          duration: 2000,
        })
      }
    } catch (err) {
      console.error("[buddy] turn settlement error", err)
    }
  })

  api.event.on("session.error", async (ev) => {
    const sid = ev?.properties?.sessionID
    rememberActive(sid)
    await mutate(sid, (s) => scaredState(s))
  })

  api.event.on("permission.replied", async (ev) => {
    const sid = ev?.properties?.sessionID
    rememberActive(sid)
    if (ev?.properties?.reply !== "once" && ev?.properties?.reply !== "always") return
    await mutate(sid, (s) => onPermissionAllowed(s))
  })

  api.event.on("session.next.shell.ended", async (ev) => {
    const sid = ev?.properties?.sessionID
    rememberActive(sid)
    await mutate(sid, (s) => onShellSuccess(s))
  })

  // vcs.branch.updated has no sessionID; route to last active.
  api.event.on("vcs.branch.updated", async () => {
    await mutate(lastActiveSessionID, (s) => onBranchUpdated(s))
  })

  api.event.on("session.compacted", async (ev) => {
    const sid = ev?.properties?.sessionID
    rememberActive(sid)
    await mutate(sid, (s) => onCompacted(s))
  })

  // Idle-recovery + LRU sweep. Iterates all session files so inactive
  // sessions also recover (and so the sweep sees them).
  const idleTimer = setInterval(async () => {
    try {
      const sessions = await persistence.listSessions()
      const now = Date.now()
      for (const meta of sessions) {
        const sid = meta.sessionID
        const s = await persistence.load(sid)
        if (!s) continue
        // Don't recover while a session is actively in `working` state.
        if (s.state === "working") continue
        const last = s.lastPromptAt ?? s.hatchedAt ?? now
        if (now - last < IDLE_RECOVERY_MS) continue
        // Per-session cooldown to avoid stacking recovery every minute.
        if (now - (s.lastIdleRecoveryAt ?? 0) < IDLE_RECOVERY_MS) continue
        await mutate(sid, (cur) => {
          const next = onIdleRecovery(cur)
          return { ...next, lastIdleRecoveryAt: now }
        })
      }
    } catch (err) {
      console.error("[buddy] idle recovery error", err)
    }
  }, IDLE_RECOVERY_CHECK_MS)
  api.lifecycle?.onDispose?.(() => clearInterval(idleTimer))

  // LRU sweep: archive session files that haven't been touched in
  // ARCHIVE_AFTER_MS. Runs once at boot, then once a day.
  const runSweep = async () => {
    try {
      const n = await persistence.sweep(ARCHIVE_AFTER_MS)
      if (n > 0) console.log(`[buddy] archived ${n} idle session file${n === 1 ? "" : "s"}`)
    } catch (err) {
      console.error("[buddy] sweep error", err)
    }
  }
  void runSweep()
  const sweepTimer = setInterval(runSweep, ARCHIVE_CHECK_MS)
  api.lifecycle?.onDispose?.(() => clearInterval(sweepTimer))
}

const plugin = { id: "opencode-buddy", tui }
export default plugin
