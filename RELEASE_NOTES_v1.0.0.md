# opencode-buddy v1.0.0

## What's in this release

opencode-buddy now uses the **OpenCode 2 plugin API** (`@opencode/plugin` 2.2.6+). The buddy renders in the same sidebar slot and every existing buddy state file keeps working, but the plugin implementation is a full port: V1 plugin functions no longer run in OpenCode 2, so this release drops OpenCode 1 support.

## Breaking changes

- **Requires OpenCode 2.2.6+**, including OpenCode Desktop 2.2.6+.
- The plugin is registered under `plugins` in `~/.config/opencode/opencode.json`. The old `tui.json` entry and the V1 `plugin` key are no longer used.
- `npm install -g opencode-buddy` still registers the plugin automatically. Upgrading users should remove the old `plugin` entry from `opencode.json` and the entry from `tui.json`.
- Node 18+ is unchanged.

## Migration details

- **Server part:** `buddy` tool registered through `ctx.tool.transform` with a JSON Schema input and structured `{ content }` results.
- **TUI part:** `Plugin.define` + `setup(context)`; sidebar claim moved to the `sidebar.content` slot; slash commands moved to `context.keymap.layer`; rename/switch dialogs use the promise-based `ui.dialog` API; theme colors use the V2 semantic tokens.
- **Events:** subscriptions moved to the V2 event stream — `session.execution.started/succeeded/failed`, `session.tool.input.started/success/failed`, `session.shell.ended`, `session.compaction.ended`, `permission.replied`, `filesystem.changed`, and `vcs.branch.updated`.
- **Todo xp removed:** OpenCode 2 no longer emits the todo event the V1 plugin used (+5 xp per completed todo). All other xp and reward sources are unchanged.
- **Cleanup:** timers and event subscriptions are released through the cleanup function returned by `setup`.

## Fix

- A truncated or corrupt session file no longer breaks every buddy action. The bad file is renamed to `<id>.json.corrupt` and the session starts with a fresh buddy.

## Install

```bash
npm install -g opencode-buddy
```

The buddy appears in the sidebar on the next OpenCode start.
