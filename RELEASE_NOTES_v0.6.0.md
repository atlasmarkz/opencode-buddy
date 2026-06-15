# opencode-buddy v0.6.0

## What's in this release

Each opencode session now has its **own buddy**. Open a session, work for a while, close it — next time you open that session, the same buddy is there with the stats you left it at. Open a different session and you meet a different buddy. Buddy state moved from a single global file to per-session files under `~/.config/opencode-buddy/sessions/`, with an LRU archiver to keep the directory from growing without bound.

## Highlights

### Per-session storage

- **Before:** one global `state.json`. Every opencode window in the same user account shared a single buddy, fighting over xp.
- **After:** `~/.config/opencode-buddy/sessions/<sessionID>.json`. Each session has an independent buddy. Reopen the same session and the buddy is exactly as you left it.

State file location:

```
~/.config/opencode-buddy/
├── sessions/
│   ├── __default__.json
│   ├── abc-123.json
│   └── def-456.json
└── archive/                # session files idle > 30 days
```

### Automatic backward-compatible migration

On first load, if a legacy `state.json` exists at the old location it is **automatically renamed** to `sessions/__default__.json` (a synthetic fallback session used when no opencode session is in scope — e.g. from the LLM tool with no `session` argument). The old file is removed after migration.

### LRU archiver

A background timer runs once on plugin load and once per day. Session files whose `idleAt` is older than 30 days are moved from `sessions/` to `archive/`. They remain on disk (cheap; ~500 bytes per file) and can be hand-restored, but no longer appear in listings or take up the active set.

- 100 active sessions = ~50 KB
- 10 000 archived sessions = ~5 MB

### New slash command: `/buddy-list`

Lists every active session buddy with its name, species, and level. The current session's buddy is marked with `→`.

```
→ Quack the duck Lv3 (abc-123)
· Rex the dragon Lv1 (def-456)
· Buddy the cat Lv2 (ghi-789)
```

### `buddy` LLM tool: optional `session` argument

The LLM can now target a specific session's buddy by passing `session=<sessionID>` to the `buddy` tool. Without it, the tool falls back to the `__default__` synthetic session. A new `action=list` returns a summary across all session buddies.

### Events without sessionID routed sensibly

Two opencode events don't carry a `sessionID` (`file.edited` and `vcs.branch.updated`). Rather than drop them, the plugin tracks the **most recently active session** and applies the bonus there. With per-session storage this is the right model — you can only be "in" one session at a time per TUI.

## Full changelog since v0.5.0

**`src/persistence.js`** — rewritten

- New directory `~/.config/opencode-buddy/sessions/`; per-session files `<key>.json`
- `load(sessionID)`, `save(sessionID, state)`, `mtime(sessionID)` — all take a session key
- `save()` auto-bumps `idleAt: Date.now()` on every write
- Path sanitization: only `[A-Za-z0-9_-]{1,128}` accepted as-is; anything else hashed to a stable hex key
- `sweep(maxAgeMs)`: moves idle files to `archive/`
- `listSessions()`: returns `{sessionID, name, species, level, idleAt}[]` sorted by recency
- Legacy `state.json` auto-migrates on first read

**`src/state.js`**

- `DEFAULT_STATE` and `hatch()` initialize `idleAt: Date.now()`

**`src/tui-plugin.jsx`**

- `mutate(sessionID, fn)` takes sessionID first; all event handlers and slash commands pass it through
- View is keyed by sessionID; the slot re-renderer keeps a per-session View cache
- Slash commands read the current session from `api.route.current.params.sessionID` (fallback `__default__`)
- `lastActiveSessionID` tracked for events without sessionID (`file.edited`, `vcs.branch.updated`)
- Idle-recovery timer now iterates **all** sessions in `listSessions()` (not just one), giving inactive sessions a chance to recover
- LRU sweep timer: runs at boot, then every 24h
- `/buddy-list` command + `buddy.list` palette entry

**`src/server-plugin.js`**

- `buddy` tool accepts optional `session: string` argument
- New `action=list` returns all session buddies

## Install / upgrade

```bash
npm install -g opencode-buddy
# restart opencode
```

The postinstall registers the plugin in `~/.config/opencode/opencode.json` and `~/.config/opencode/tui.json` as before. On first launch, the existing global `state.json` (if any) is migrated to `sessions/__default__.json` automatically.

Requires opencode ≥ 1.15.

## License

MIT
