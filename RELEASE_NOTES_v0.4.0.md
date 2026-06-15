# opencode-buddy v0.4.0

## What's in this release

The buddy is now **visibly alive** in the sidebar — a real frame-by-frame animation system replaces the previous static art, every species sways with idle motion, and the dragon got a full redesign. Plus a Windows install fix and a screen-recorded demo in the README.

## Highlights

### Visible animation in the sidebar

Earlier releases technically had multiple frames, but solid-js never re-rendered the `<text>` rows inside the slot so you only ever saw frame 0. This release rebuilds the animation pipeline:

- A **plugin-level frame signal** drives the timer once per buddy, not once per render. Re-renders no longer reset the loop, and the loop is paused when the buddy is `sleeping` (no wasted ticks).
- Each ASCII row is a **fixed `<text>` element** instead of a `<For>` list, so solid actually re-renders them on every frame.
- The `View` element is **cached across slot re-renders**, so opencode swapping the slot contents doesn't recreate the buddy and restart the animation.
- Idle body **sway widened to 2 columns** so motion is obvious at sidebar width.

End result: the buddy actually moves. See the GIF at the top of the README.

### Dragon redesign + per-species idle motion

- The dragon was reworked from scratch — new silhouette, more readable at sidebar width.
- Every species (duck, cat, dragon, axolotl, robot, ghost) now has explicit per-frame body motion, not just blink/mouth animation.

### Cross-platform fix — Windows install no longer crashes

`postinstall` used `fs.rename` to swap the new config in. On Windows, `rename` fails when the destination already exists (POSIX semantics differ). Replaced with a copy + unlink fallback so global install works on Windows too.

### README demo

A short screen recording is now embedded inline at the top of the README. Iterated from mp4 → trimmed mp4 → 852 KB GIF so it previews directly on the GitHub repo page without a download.

## Full changelog since v0.3.4

**Animation system**
- `feat(anim)`: make buddy visibly animate in sidebar
- `feat(anim)`: increase idle body sway to 2 columns
- `fix(anim)`: replace `For` with fixed `<text>` elements so each row re-renders
- `fix(anim)`: cache the View element so slot re-renders don't recreate it
- `fix(anim)`: use `createEffect` with `setTimeout` loop for animation
- `fix(anim)`: drive frame from plugin-level timer, pause when sleeping

**Art**
- `feat(art)`: redesign dragon + add visible body motion to all species

**Reactive (explored, then reverted)**
- `feat(reactive)`: buddy reflects live LLM activity
- `revert`: drop reactive LLM activity tracking, keep simple persisted states (kept the codebase minimal — `session.idle` / `session.error` reactions from 0.3.4 are still in)

**Cross-platform**
- `fix`: `fs.rename` fails on Windows when destination exists

**Docs**
- `docs`: refresh README for 0.3.7 architecture (plugin-level frame signal)
- `docs`: add screen-recording demo to README
- `docs`: switch demo to inline-previewable mp4 (8.4MB) → trimmed to 20s (2.3MB) → final 852 KB GIF

## Install / upgrade

```bash
npm install -g opencode-buddy
# restart opencode
```

The `postinstall` script registers the plugin in both `~/.config/opencode/opencode.json` and `~/.config/opencode/tui.json`. JSONC files with comments are left alone — add manually:

```jsonc
// ~/.config/opencode/opencode.json
{ "plugin": ["opencode-buddy"] }
```

```jsonc
// ~/.config/opencode/tui.json
{ "$schema": "https://opencode.ai/tui.json", "plugin": ["opencode-buddy"] }
```

Requires opencode ≥ 1.15.

## License

MIT
