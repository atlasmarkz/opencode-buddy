# opencode-buddy v0.5.0

## What's in this release

The buddy is now driven by **what you actually do in opencode**, not just slash commands. Submit a prompt and the buddy starts working; finish a turn and it earns xp; long-idle and it naps to recover energy. 10+ new event hooks bind the buddy's state machine to opencode's live session events, with a balanced metabolism so stats actually drift over time instead of monotonically decaying.

## Highlights

### Work-driven progression (xp comes from coding)

`/buddy-play` no longer gives meaningful xp (+1 instead of +5). Instead, every real session event feeds the buddy:

| Trigger | Reward |
| --- | --- |
| Prompt submitted (`session.next.prompted`) | enter `working` state, mark `lastPromptAt` |
| Tool call succeeds (`session.next.tool.success`) | per-tool xp (read=1, edit/write/bash=3, others=2), +0.2 happy |
| **3 consecutive successes without failure** | +5 xp streak bonus |
| Same tool called >5 times in one turn | xp halved (anti-grind) |
| Tool fails | -1 happy, -0.5 energy, streak reset; 2+ failures in a turn → `scared` |
| Todo completed (`todo.updated`) | +5 xp per item |
| **Turn complete (`session.idle`)** | base +10 xp + accumulated (cap 30), `celebrating` for 3s, toast surfaces "Turn complete +N xp" or "Level up!" |

### Reward events (the buddy actually gets fed)

Previously the buddy could only be fed via `/buddy-feed`. Now coding feeds it too:

| Event | Effect |
| --- | --- |
| File edited (`file.edited`) | +1 hunger (30s global throttle) |
| Shell command finished (`session.next.shell.ended`) | +1 hunger, +1 energy |
| Permission granted (`permission.replied` once/always) | +3 hunger, +1 happy |
| Git branch switched (`vcs.branch.updated`) | +3 hunger, +1 happy |
| Session history compacted (`session.compacted`) | +10 energy, +2 happy |
| **Idle >5 min, no prompt** | +5 energy (5 min cooldown) |
| **Level up** | +5 hunger, +3 energy, +3 happy |

### Circadian rhythm + sleep recovery

- **Sleeping** (when energy < 20) now recovers `+1 energy/min` instead of draining. The buddy heals itself if you walk away.
- **Late night (23:00–05:00 local)** drains energy 1.5× faster — the buddy gets tired with you.

### Rebalanced metabolism

Natural decay slowed down and turn costs cut roughly in half so stats actually float in a healthy range instead of free-falling:

| Stat | Before (per min) | After |
| --- | --- | --- |
| hunger decay | -0.5 | **-0.3** |
| happiness decay | -0.3 | **-0.2** |
| energy decay | -0.2 | **-0.15** |

| Stat (per turn) | Before | After |
| --- | --- | --- |
| hunger cost | -3 to -13 | **-2 to -8** |
| energy cost | -2 to -12 | **-1 to -7** |
| happiness reward | +5 −2·fail | **+1 −1·fail** |

Slash commands stay strong (`/buddy-feed` +25 hunger, `/buddy-rest` +30 energy) so they remain useful when things really drop.

### Verified balance

Simulated five usage profiles, starting 80/80/100 (hunger/happy/energy):

| Scenario | hunger | happy | energy | level |
| --- | --- | --- | --- | --- |
| Light 1h (3 prompt × 3 tools) | 67 | 79 | 89 | Lv2 |
| Medium 1h (6 prompt × 5 tools) | 75 | 80 | 88 | Lv3 |
| Heavy 1h (12 prompt × 8 tools) | 96 | 84 | 81 | Lv4 |
| Heavy 4h | 96 | 82 | **8** (auto-sleeps to recover) | Lv8 |
| Medium 8h workday | 54 | 66 | **0** (time to /buddy-rest) | Lv7 |

Stats now actually drift up and down — no more single-direction decay, no more happiness pinning at 100.

## Full changelog since v0.4.0

**State machine (`src/state.js`)**

- New: `awardXp`, `onPromptStart`, `onToolSuccess`, `onToolFailure`, `onTurnDone(state, xp, stats)`, `onTodoCompleted`, `onFileEdited`
- New: `onPermissionAllowed`, `onShellSuccess`, `onBranchUpdated`, `onCompacted`, `onIdleRecovery`, `onStreak`
- New: `toolXp(name)` weight table (read=1, glob=1, edit/write/bash=3, default=2)
- `tick`: sleeping now recovers energy; night-hours multiplier
- `maybeLevelUp`: now grants +5 hunger / +3 energy / +3 happy
- `play`: xp +5 → +1, happy +20 → +15

**TUI plugin (`src/tui-plugin.jsx`)**

- In-memory `turnAccum` per session: tracks xp, tools, failures, streak, per-tool counts
- New event hooks: `session.next.prompted`, `session.next.tool.called`, `session.next.tool.success`, `session.next.tool.failed`, `todo.updated`, `file.edited`, `permission.replied`, `session.next.shell.ended`, `vcs.branch.updated`, `session.compacted`
- Idle-recovery timer polls every 60s, grants `+5 energy` after 5 min without a prompt
- Streak detection: every 3rd consecutive tool success triggers `onStreak`
- Anti-grind: same tool used >5 times in a turn → weight halved
- `session.idle` settlement is atomic (single load + single save), surfaces `Level up!` or `Turn complete +N xp` toast
- Per-turn xp hard cap of 30 to prevent runaway sessions

## Install / upgrade

```bash
npm install -g opencode-buddy
# restart opencode
```

Requires opencode ≥ 1.15.

## License

MIT
