/** @jsxImportSource @opentui/solid */
import { createSignal, createMemo, onCleanup } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
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
  const sessionID = norm(props.session_id)
  const theme = () => props.theme
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
    const t = theme()
    switch (current()?.species) {
      case "cat": return t.hue.accent[500]
      case "duck": return t.text.feedback.success.base
      case "dragon": return t.text.feedback.error.base
      case "axolotl": return t.hue.accent[400]
      case "robot": return t.text.feedback.info.base
      case "ghost": return t.text.base
      default: return t.text.base
    }
  }

  const SPINNER = ["\u25D0", "\u25D3", "\u25D1", "\u25D2"]
  const spinner = () => SPINNER[frame() % SPINNER.length]

  return (
    <box>
      <text fg={theme().hue.accent[500]}>{spinner()}  {current() ? current().name + " the " + current().species : "BUDDY"}</text>
      <text fg={speciesColor()}>{stripAnsi(lines()[0] ?? "")}</text>
      <text fg={speciesColor()}>{stripAnsi(lines()[1] ?? "")}</text>
      <text fg={speciesColor()}>{stripAnsi(lines()[2] ?? "")}</text>
      <text fg={speciesColor()}>{stripAnsi(lines()[3] ?? "")}</text>
      <text fg={speciesColor()}>{stripAnsi(lines()[4] ?? "")}</text>
      <text fg={speciesColor()}>{stripAnsi(lines()[5] ?? "")}</text>
      <text fg={theme().text.muted}>hunger {barStr(current()?.hunger ?? 0)} {Math.floor(current()?.hunger ?? 0)}</text>
      <text fg={theme().text.muted}>happy  {barStr(current()?.happiness ?? 0)} {Math.floor(current()?.happiness ?? 0)}</text>
      <text fg={theme().text.muted}>energy {barStr(current()?.energy ?? 0)} {Math.floor(current()?.energy ?? 0)}</text>
      <text fg={theme().text.muted}>{current()?.state ?? "..."}  Lv{current()?.level ?? 1}  xp{current()?.xp ?? 0}/{(current()?.level ?? 1) * 50}</text>
    </box>
  )
}

export default Plugin.define({
  id: "opencode-buddy.tui",
  async setup(context) {
    // Plugin-level frame signal. Always advances; per-session sleeping
    // buddies just render the same frame, which is cheap and simpler
    // than per-session signals.
    const [getFrame, setFrame] = createSignal(0)
    const frameTimer = setInterval(() => setFrame((f) => f + 1), ANIMATION_TICK_MS)

    context.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID }) => (
        <View theme={context.theme} session_id={sessionID} frame={getFrame} />
      ),
    })

    // The current opencode session from the TUI route. Fallback to
    // FALLBACK_SESSION when on the home screen (no active session).
    const currentSessionID = () => {
      try {
        const r = context.ui.router.current()
        if (r?.type === "session" && r.sessionID) return norm(r.sessionID)
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

    const toast = (options) => context.ui.toast.show(options)

    // ---------- Slash commands ----------

    const feedBuddy = async () => {
      const sid = currentSessionID()
      const next = await mutate(sid, (s) => feed(s))
      if (next) toast({ variant: "success", title: "Yum!", message: `${next.name} ate a snack.` })
    }
    const playBuddy = async () => {
      const sid = currentSessionID()
      const next = await mutate(sid, (s) => play(s))
      if (next) toast({ variant: "success", title: "Woohoo!", message: `${next.name} played (+1xp).` })
    }
    const restBuddy = async () => {
      const sid = currentSessionID()
      const next = await mutate(sid, (s) => rest(s))
      if (next) toast({ variant: "info", title: "Zzz", message: `${next.name} is napping.` })
    }
    const statusBuddy = async () => {
      const sid = currentSessionID()
      const s = await persistence.load(sid)
      if (!s) {
        toast({ variant: "info", title: "No buddy", message: "Open a session to hatch a buddy." })
        return
      }
      toast({
        variant: "info",
        title: `${s.name} the ${s.species}`,
        message: `Lv${s.level} xp${s.xp}/${s.level * 50} - hunger ${Math.floor(s.hunger)} happy ${Math.floor(s.happiness)} energy ${Math.floor(s.energy)}`,
      })
    }
    const renameBuddy = async () => {
      const value = await context.ui.dialog.prompt({
        title: "Rename buddy",
        placeholder: "New name (max 20 chars)",
      })
      if (!value) return
      const sid = currentSessionID()
      const next = await mutate(sid, (s) => rename(s, value))
      if (next) toast({ variant: "success", title: "Renamed", message: `Now called ${next.name}.` })
    }
    const switchBuddy = async () => {
      const sp = await context.ui.dialog.select({
        title: "Switch species",
        options: SPECIES.map((value) => ({ title: value, value })),
      })
      if (!sp) return
      const sid = currentSessionID()
      const next = await mutate(sid, (s) => switchSpecies(s, sp))
      if (next) toast({ variant: "success", title: "Morphed", message: `Now a ${sp}.` })
    }

    const listBuddies = async () => {
      const sessions = await persistence.listSessions()
      if (sessions.length === 0) {
        toast({ variant: "info", title: "No buddies", message: "Open a session to hatch one." })
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
      toast({
        variant: "info",
        title: `${sessions.length} session${sessions.length === 1 ? "" : "s"}`,
        message: lines,
        duration: 5000,
      })
    }

    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [
        {
          id: "buddy.feed",
          title: "Feed buddy",
          group: "Buddy",
          palette: true,
          slash: { name: "buddy-feed" },
          run() {
            void feedBuddy()
          },
        },
        {
          id: "buddy.play",
          title: "Play with buddy",
          group: "Buddy",
          palette: true,
          slash: { name: "buddy-play" },
          run() {
            void playBuddy()
          },
        },
        {
          id: "buddy.rest",
          title: "Buddy rests",
          group: "Buddy",
          palette: true,
          slash: { name: "buddy-rest" },
          run() {
            void restBuddy()
          },
        },
        {
          id: "buddy.status",
          title: "Show buddy status",
          group: "Buddy",
          palette: true,
          slash: { name: "buddy", aliases: ["buddy-status"] },
          run() {
            void statusBuddy()
          },
        },
        {
          id: "buddy.list",
          title: "List all session buddies",
          group: "Buddy",
          palette: true,
          slash: { name: "buddy-list" },
          run() {
            void listBuddies()
          },
        },
        {
          id: "buddy.rename",
          title: "Rename buddy",
          group: "Buddy",
          palette: true,
          slash: { name: "buddy-rename" },
          run() {
            void renameBuddy()
          },
        },
        {
          id: "buddy.switch",
          title: "Switch buddy species",
          group: "Buddy",
          palette: true,
          slash: { name: "buddy-switch" },
          run() {
            void switchBuddy()
          },
        },
      ],
    }))

    // ---------- Work-driven progression (per session) ----------

    const TURN_XP_CAP = 30
    const FILE_EDIT_THROTTLE_MS = 30_000
    const SCARED_FAILURE_THRESHOLD = 2
    const STREAK_THRESHOLD = 3
    const SAME_TOOL_HALVE_AFTER = 5
    const IDLE_RECOVERY_MS = 5 * 60_000
    const IDLE_RECOVERY_CHECK_MS = 60_000
    const IDLE_DELETE_MS = 14 * 24 * 60 * 60_000 // 14 days idle → delete
    const ARCHIVE_CHECK_MS = 24 * 60 * 60_000 // check once per day

    // File-edited is global (no sessionID in the event). Apply to the
    // most recently active session. Global throttle prevents spam.
    let lastFileEditedAt = 0
    let lastActiveSessionID = FALLBACK_SESSION
    const rememberActive = (sid) => {
      const n = norm(sid)
      if (n) lastActiveSessionID = n
    }

    // sessionID -> { xp, tools, failures, streak, toolCounts, __lastToolWeight }
    const turnAccum = new Map()

    const getAccum = (sessionID) => {
      const key = norm(sessionID)
      let a = turnAccum.get(key)
      if (!a) {
        a = { xp: 0, tools: 0, failures: 0, streak: 0, toolCounts: {} }
        turnAccum.set(key, a)
      }
      return a
    }
    const resetAccum = (sessionID) => turnAccum.delete(norm(sessionID))

    const unsubscribers = []
    const on = (type, handler) => unsubscribers.push(context.data.on(type, handler))

    // User submitted a prompt → buddy starts working.
    on("session.execution.started", async (ev) => {
      const sid = ev?.data?.sessionID
      rememberActive(sid)
      getAccum(sid)
      await mutate(sid, (s) => onPromptStart(s))
    })

    on("session.tool.input.started", (ev) => {
      const sid = ev?.data?.sessionID
      rememberActive(sid)
      const name = ev?.data?.name
      const a = getAccum(sid)
      const key = (name || "_").toLowerCase()
      a.toolCounts[key] = (a.toolCounts[key] ?? 0) + 1
      let weight = toolXp(name)
      if (a.toolCounts[key] > SAME_TOOL_HALVE_AFTER) {
        weight = Math.max(1, Math.floor(weight / 2))
      }
      a.__lastToolWeight = weight
    })

    on("session.tool.success", async (ev) => {
      const sid = ev?.data?.sessionID
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

    on("session.tool.failed", async (ev) => {
      const sid = ev?.data?.sessionID
      rememberActive(sid)
      const a = getAccum(sid)
      a.failures += 1
      a.streak = 0
      await mutate(sid, (s) => {
        const dipped = onToolFailure(s)
        return a.failures >= SCARED_FAILURE_THRESHOLD ? scaredState(dipped) : dipped
      })
    })

    // No sessionID in filesystem.changed; route to last active session.
    on("filesystem.changed", async () => {
      const now = Date.now()
      if (now - lastFileEditedAt < FILE_EDIT_THROTTLE_MS) return
      lastFileEditedAt = now
      await mutate(lastActiveSessionID, (s) => onFileEdited(s))
    })

    on("session.execution.succeeded", async (ev) => {
      const sid = ev?.data?.sessionID
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
          toast({
            variant: "success",
            title: "Level up!",
            message: `${after.name} reached Lv${after.level} (+${10 + earned} xp).`,
          })
        } else if (earned > 0 || stats.tools > 0) {
          toast({
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

    on("session.execution.failed", async (ev) => {
      const sid = ev?.data?.sessionID
      rememberActive(sid)
      await mutate(sid, (s) => scaredState(s))
    })

    on("permission.replied", async (ev) => {
      const sid = ev?.data?.sessionID
      rememberActive(sid)
      if (ev?.data?.reply !== "once" && ev?.data?.reply !== "always") return
      await mutate(sid, (s) => onPermissionAllowed(s))
    })

    on("session.shell.ended", async (ev) => {
      const sid = ev?.data?.sessionID
      rememberActive(sid)
      await mutate(sid, (s) => onShellSuccess(s))
    })

    // vcs.branch.updated has no sessionID; route to last active.
    on("vcs.branch.updated", async () => {
      await mutate(lastActiveSessionID, (s) => onBranchUpdated(s))
    })

    on("session.compaction.ended", async (ev) => {
      const sid = ev?.data?.sessionID
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

    // LRU sweep: delete session files that haven't been touched in
    // IDLE_DELETE_MS. Runs once at boot, then once a day.
    const runSweep = async () => {
      try {
        const n = await persistence.sweep(IDLE_DELETE_MS)
        if (n > 0) console.log(`[buddy] swept ${n} idle session file${n === 1 ? "" : "s"}`)
      } catch (err) {
        console.error("[buddy] sweep error", err)
      }
    }
    void runSweep()
    const sweepTimer = setInterval(runSweep, ARCHIVE_CHECK_MS)

    return () => {
      clearInterval(frameTimer)
      clearInterval(idleTimer)
      clearInterval(sweepTimer)
      for (const off of unsubscribers) off()
    }
  },
})
