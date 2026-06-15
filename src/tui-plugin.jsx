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

function View(props) {
  const api = props.api
  const theme = () => api.theme.current
  const frame = props.frame
  const [state, setState] = createSignal(null)
  const [lastMtime, setLastMtime] = createSignal(0)
  const [tick, setTick] = createSignal(0)

  const refresh = async () => {
    try {
      const mt = await persistence.mtime()
      if (mt === 0) {
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
          state: "idle",
          stateUntil: 0,
          stateReason: "",
        }
        await persistence.save(fresh)
        setLastMtime(Date.now())
        setState(fresh)
        setTick(tick() + 1)
        return
      }
      if (mt !== lastMtime()) {
        setLastMtime(mt)
        const onDisk = await persistence.load()
        if (onDisk) {
          const ticked = tickState(onDisk)
          const derived = deriveState(ticked)
          setState(derived)
          setTick(tick() + 1)
          persistence.save(derived).catch(() => {})
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
  const species = () => {
    const v = current()
    return v ? v.species : "duck"
  }
  // Only animate when the buddy is awake (not sleeping). Sleeping
  // buddies hold a single frame so the user can see they're resting.
  const buddyState = () => {
    const v = current()
    return v ? v.state : "idle"
  }
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
  // The animation timer lives at the plugin level so it survives View
  // remounts. We expose a single global frame counter via a SolidJS
  // signal stored on the api object, which every View can read.
  // This decouples the animation loop from any individual View's
  // lifecycle.
  const [getFrame, setFrame] = createSignal(0)
  api.__buddyFrame = { getFrame, setFrame }
  setInterval(async () => {
    // Read current state from disk. If the buddy is sleeping or has
    // very low energy, freeze the frame so animation visually pauses
    // — a sleeping buddy should not be flickering.
    const s = await persistence.load()
    const sleeping = s && (s.state === "sleeping" || s.energy < 20)
    if (!sleeping) setFrame((f) => f + 1)
  }, ANIMATION_TICK_MS)

  // Cache the View element so slot re-renders don't recreate it.
  const viewCache = new Map()

  api.slots.register({
    order: 50,
    slots: {
      sidebar_content(_ctx, props) {
        const key = props.session_id ?? "default"
        if (!viewCache.has(key)) {
          viewCache.set(key, <View api={api} session_id={props.session_id} frame={getFrame} />)
        }
        return viewCache.get(key)
      },
    },
  })

  const feedBuddy = async () => {
    const s = await persistence.load()
    if (!s) return
    const next = feed(s)
    await persistence.save(next)
    api.ui.toast({ variant: "success", title: "Yum!", message: `${next.name} ate a snack.` })
  }
  const playBuddy = async () => {
    const s = await persistence.load()
    if (!s) return
    const next = play(s)
    await persistence.save(next)
    api.ui.toast({ variant: "success", title: "Woohoo!", message: `${next.name} played (+1xp).` })
  }
  const restBuddy = async () => {
    const s = await persistence.load()
    if (!s) return
    const next = rest(s)
    await persistence.save(next)
    api.ui.toast({ variant: "info", title: "Zzz", message: `${next.name} is napping.` })
  }
  const statusBuddy = async () => {
    const s = await persistence.load()
    if (!s) return
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
          const s = await persistence.load()
          if (!s) return
          const next = rename(s, value)
          await persistence.save(next)
          api.ui.toast({ variant: "success", title: "Renamed", message: `Now called ${next.name}.` })
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
        const s = await persistence.load()
        if (!s) return
        const next = switchSpecies(s, sp)
        await persistence.save(next)
        api.ui.toast({ variant: "success", title: "Morphed", message: `Now a ${sp}.` })
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

  // ---------- Work-driven progression ----------
  //
  // Buddy's xp now comes from real coding activity, not just /buddy-play.
  // We listen to opencode session events, accumulate per-turn xp in
  // memory (to avoid hammering the disk), and settle once at turn end.

  const TURN_XP_CAP = 30 // hard cap so a single noisy turn can't level-flood
  const FILE_EDIT_THROTTLE_MS = 30_000
  const SCARED_FAILURE_THRESHOLD = 2
  const STREAK_THRESHOLD = 3 // award streak bonus on Nth consecutive success
  const SAME_TOOL_HALVE_AFTER = 5 // 6th+ call of the same tool in a turn → xp halved
  const IDLE_RECOVERY_MS = 5 * 60_000 // 5 min of no prompt → recovery eligible
  const IDLE_RECOVERY_CHECK_MS = 60_000 // poll every minute

  let lastFileEditedAt = 0
  let lastIdleRecoveryAt = 0

  // sessionID -> {
  //   xp, tools, failures, streak, lastTodoCompletedCount,
  //   toolCounts: {name->n}, __lastToolWeight
  // }
  const turnAccum = new Map()

  const getAccum = (sessionID) => {
    const key = sessionID ?? "default"
    let a = turnAccum.get(key)
    if (!a) {
      a = {
        xp: 0,
        tools: 0,
        failures: 0,
        streak: 0,
        lastTodoCompletedCount: 0,
        toolCounts: {},
      }
      turnAccum.set(key, a)
    }
    return a
  }
  const resetAccum = (sessionID) => {
    const key = sessionID ?? "default"
    turnAccum.delete(key)
  }

  // Helper: load → transform → save. Swallow errors so a buddy
  // hiccup never breaks the host session.
  const mutate = async (fn) => {
    try {
      const s = await persistence.load()
      if (!s) return
      const next = fn(s)
      if (!next || next === s) return
      await persistence.save(next)
    } catch (err) {
      console.error("[buddy] mutate error", err)
    }
  }

  // User just submitted a prompt → buddy starts working.
  api.event.on("session.next.prompted", async (ev) => {
    const sessionID = ev?.properties?.sessionID
    getAccum(sessionID) // ensure fresh accumulator exists
    await mutate((s) => onPromptStart(s))
  })

  // Tool succeeded → accumulate xp in memory, tiny mood bump on disk.
  // Also tracks per-turn streaks: every Nth consecutive success without
  // a failure grants a small bonus via onStreak.
  api.event.on("session.next.tool.success", async (ev) => {
    const sessionID = ev?.properties?.sessionID
    const a = getAccum(sessionID)
    const weight = a.__lastToolWeight ?? 2
    a.xp = Math.min(TURN_XP_CAP, a.xp + weight)
    a.tools += 1
    a.streak += 1
    a.__lastToolWeight = undefined
    await mutate((s) => onToolSuccess(s))
    // Award streak bonus on every Nth consecutive success (3, 6, 9, …)
    if (a.streak > 0 && a.streak % STREAK_THRESHOLD === 0) {
      await mutate((s) => onStreak(s))
    }
  })

  // Tool was called → remember its xp weight so the matching success
  // event can credit the right amount. Halve the weight once the same
  // tool has been used more than SAME_TOOL_HALVE_AFTER times in this turn
  // (anti-grind).
  api.event.on("session.next.tool.called", (ev) => {
    const sessionID = ev?.properties?.sessionID
    const name = ev?.properties?.tool
    const a = getAccum(sessionID)
    const key = (name || "_").toLowerCase()
    a.toolCounts[key] = (a.toolCounts[key] ?? 0) + 1
    let weight = toolXp(name)
    if (a.toolCounts[key] > SAME_TOOL_HALVE_AFTER) {
      weight = Math.max(1, Math.floor(weight / 2))
    }
    a.__lastToolWeight = weight
  })

  // Tool failed → mood dip; break the streak; if too many in one turn,
  // briefly scared.
  api.event.on("session.next.tool.failed", async (ev) => {
    const sessionID = ev?.properties?.sessionID
    const a = getAccum(sessionID)
    a.failures += 1
    a.streak = 0
    await mutate((s) => {
      const dipped = onToolFailure(s)
      return a.failures >= SCARED_FAILURE_THRESHOLD ? scaredState(dipped) : dipped
    })
  })

  // Todo list updated → count newly-completed items, +5 xp each.
  api.event.on("todo.updated", async (ev) => {
    const sessionID = ev?.properties?.sessionID
    const todos = ev?.properties?.todos ?? []
    const completedNow = todos.filter((t) => t.status === "completed").length
    const a = getAccum(sessionID)
    const delta = completedNow - a.lastTodoCompletedCount
    a.lastTodoCompletedCount = completedNow
    if (delta <= 0) return
    await mutate((s) => onTodoCompleted(s, delta))
  })

  // File edited by any tool → small hunger refill, throttled globally.
  api.event.on("file.edited", async () => {
    const now = Date.now()
    if (now - lastFileEditedAt < FILE_EDIT_THROTTLE_MS) return
    lastFileEditedAt = now
    await mutate((s) => onFileEdited(s))
  })

  // Turn finished → settle accumulated xp + base bonus + work metabolism,
  // celebrate, surface a toast if the buddy levelled up.
  api.event.on("session.idle", async (ev) => {
    const sessionID = ev?.properties?.sessionID
    const a = getAccum(sessionID)
    const earned = a.xp
    const stats = { tools: a.tools, failures: a.failures }
    resetAccum(sessionID)
    try {
      const before = await persistence.load()
      if (!before) return
      const after = onTurnDone(before, earned, stats)
      await persistence.save(after)
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

  // Session errored → spooked.
  api.event.on("session.error", async () => {
    await mutate((s) => scaredState(s))
  })

  // User approved a permission → small hunger reward.
  api.event.on("permission.replied", async (ev) => {
    if (ev?.properties?.reply !== "once" && ev?.properties?.reply !== "always") return
    await mutate((s) => onPermissionAllowed(s))
  })

  // Shell command finished successfully (the event itself doesn't carry
  // an error flag, but a separate session.next.tool.failed will fire on
  // genuine failure; here we treat any ended shell as productive work).
  api.event.on("session.next.shell.ended", async () => {
    await mutate((s) => onShellSuccess(s))
  })

  // Git branch switched → small hunger refill.
  api.event.on("vcs.branch.updated", async () => {
    await mutate((s) => onBranchUpdated(s))
  })

  // Session history was compacted → shed fatigue.
  api.event.on("session.compacted", async () => {
    await mutate((s) => onCompacted(s))
  })

  // Idle-recovery timer: if no prompt has been submitted for
  // IDLE_RECOVERY_MS and we haven't already recovered recently, give a
  // small energy bump. Skipped while the buddy is actively `working`.
  const idleTimer = setInterval(async () => {
    try {
      const s = await persistence.load()
      if (!s) return
      if (s.state === "working") return
      const now = Date.now()
      const last = s.lastPromptAt ?? s.hatchedAt ?? now
      if (now - last < IDLE_RECOVERY_MS) return
      if (now - lastIdleRecoveryAt < IDLE_RECOVERY_MS) return
      lastIdleRecoveryAt = now
      await mutate((cur) => onIdleRecovery(cur))
    } catch (err) {
      console.error("[buddy] idle recovery error", err)
    }
  }, IDLE_RECOVERY_CHECK_MS)
  api.lifecycle?.onDispose?.(() => clearInterval(idleTimer))
}

const plugin = { id: "opencode-buddy", tui }
export default plugin
