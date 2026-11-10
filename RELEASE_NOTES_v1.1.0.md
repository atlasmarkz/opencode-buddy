# @mark_future_ai/opencode-buddy v1.1.0

The buddy now lives in **OpenCode Desktop** as a floating pet, while the TUI
sidebar keeps working.

## Floating Desktop pet

- SVG/CSS pet floats over the Desktop window: drag to move, click for stats,
  right-click for feed / play / rest / rename / switch.
- Six built-in presets: duck, cat, dragon, axolotl, robot, ghost.
- Work state drives the animation: idle, working, celebrating, scared, and
  sleeping.
- Show or hide with the right-click menu or the command palette:
  **Toggle floating pet** (`Cmd+K` / `Ctrl+K`).
- Position and visibility are remembered.

## Custom pet packs

- Loads community packs in the **Codex pet format** (`pet.json` +
  `spritesheet.webp`).
- Auto-detects `~/.codex/pets/<id>/` (read-only) and
  `~/.config/opencode-buddy/pets/<id>/`.
- Spritesheet: 8×9 atlas, 192×208 px cells, WebP/PNG/GIF up to 5 MB.
- Switch packs from the right-click menu → **Pets**; **Built-in** returns to
  the six presets.
- Custom packs are Desktop-only; the TUI keeps the built-in ASCII species.

## Under the hood

- Server-side progression (`ctx.event.subscribe`) now owns prompt/tool/turn
  events, so Desktop-only sessions gain XP even when the TUI is not running.
- Added `./gui-experimental` (prebuilt CJS) and a Vite build.
- The TUI part no longer subscribes to events; it renders the shared state.

## Install

Requires OpenCode 2.2.6+.

```bash
npm install -g @mark_future_ai/opencode-buddy
```

Then open OpenCode Desktop and reload the window. In the TUI the buddy appears
in the sidebar as before.
