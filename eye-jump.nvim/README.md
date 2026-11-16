# Eye jump

Jump to a character near your gaze in Neovim, using a Tobii Eye Tracker 5 and a separate macOS bridge.

> **Prototype:** The fullscreen tracker calibration and bridge have not yet been tested together on real hardware. See [limitations](#limitations-and-development) before relying on them.

## Features

- Jump to the nearest visible matching character within a configurable radius.
- Optionally cycle through the other matches from the same gaze snapshot.
- Check the current gaze mapping with a live marker and search-radius outline.
- Save tracker calibration and editor alignment separately for reuse.

[Requirements](#requirements) · [Installation](#installation) · [Quick start](#quick-start) · [Usage](#usage) · [Configuration](#configuration) · [API](#api) · [Guides](#guides)

## Requirements

- macOS, a runtime-mode Tobii Eye Tracker 5, Node.js, pnpm and Neovim.
- A tracker-mounted display. Rotated displays are not supported. The bridge checks tracker identity and saved display geometry, but cannot verify the physical display, screen scale, user, or tracker position; recalibrate when the setup changes.
- Neovim in Ghostty. Begin with one display, one Ghostty terminal surface, one tmux pane if using tmux, and one Neovim window. Other layouts need separate coordinate mapping and have not been verified.

## Installation

Add this local checkout to [lazy.nvim](https://github.com/folke/lazy.nvim). The plugin installs **no bindings by default**; all keys below are examples and can be changed or removed. The `;` and `,` mappings are optional.

```lua
{
  dir = vim.fn.expand('~/Repos/eye-tracker-things/eye-jump.nvim'),
  main = 'eye_jump',
  event = 'VeryLazy',
  opts = {},
  keys = {
    { '<leader>ej', function() require('eye_jump').jump() end, desc = 'Jump near gaze' },
    { '<leader>ec', function() require('eye_jump').calibrate() end, desc = 'Calibrate eye alignment' },
    { '<leader>es', function() require('eye_jump').show_status() end, desc = 'Eye tracker status' },
    { '<leader>te', function() require('eye_jump').toggle_debug() end, desc = 'Toggle gaze marker' },
    { ';', function()
      if not require('eye_jump').next_candidate() then
        vim.cmd.normal({ tostring(vim.v.count1) .. ';', bang = true })
      end
    end, mode = 'n', desc = 'Next gaze candidate or native repeat' },
    { ',', function()
      if not require('eye_jump').previous_candidate() then
        vim.cmd.normal({ tostring(vim.v.count1) .. ',', bang = true })
      end
    end, mode = 'n', desc = 'Previous gaze candidate or native repeat' },
  },
}
```

`dir` is lazy.nvim's local-directory option. Change it if the plugin directory is elsewhere. lazy.nvim loads only the plugin; install and run the bridge separately from the `eye-jump.nvim` directory.

## Quick start

Connect the tracker and close any other app using it. In a terminal in the `eye-jump.nvim` directory (not the repository root):

```sh
pnpm install --frozen-lockfile
pnpm setup:sdl
pnpm bridge
```

Leave the bridge running. In its terminal, press `c` to calibrate the tracker if there is no suitable saved calibration: select the tracker-mounted display, enter its measurements, confirm the fullscreen dot is on that display, then press Space to start and for each of the nine dots. Escape cancels. See [tracker calibration](docs/calibration.md#tracker-calibration) for display selection and recovery.

Open Neovim on the tracked display in a separate terminal, with the plugin configured above:

1. Use `show_status()` (example: `<leader>es`) and check `ready = true`.
2. Use `calibrate()` (example: `<leader>ec`) for the **separate editor alignment**. Look steadily at each highlighted cell and press Space. This alignment is required unless you configure a manual viewport.
3. Optionally use `toggle_debug()` (example: `<leader>te`) to check the live marker. Look near a character, invoke `jump()` (example: `<leader>ej`), then type that character.

On later runs, start the bridge with `pnpm bridge`; saved tracker calibration and editor alignment are reused when compatible. Check the marker after moving or resizing the terminal and recalibrate if it looks wrong. Press `q` in the bridge terminal to stop it. See [editor alignment](docs/calibration.md#editor-alignment).

## Usage

In normal mode, `jump()` captures gaze when invoked and waits for one character; Escape cancels. It selects the nearest visible match within the captured radius. If gaze is outside the editor or there is no match, the cursor stays put. Matches hidden in closed folds are skipped.

The radius defaults to **10 character widths**, not a number of matches. The search area is circular in fitted display-space, accounting for character-cell aspect ratio. Distance is calculated in the fitted tracker-gaze coordinate space; calibration error or a sheared fit can make it differ from exact screen-space distance.

Matching supports Unicode and is independent of Neovim's `ignorecase` and `smartcase`: `smart` matches lowercase input in either case and uppercase input exactly; `sensitive` always matches exactly; `insensitive` always ignores case.

The jump freezes all matching candidates within the radius, with no count cap, ordered by original gaze distance, then line and byte position. `next_candidate()` and `previous_candidate()` cycle silently without wrapping. They return `true` when handled, including at either end, and `false` when no valid session exists. The optional mappings above fall back to native `;` and `,` with their count when no session is active.

There is no timeout or resampling: later gaze movement or staleness does not change the frozen list. Unrelated movement, editing, buffer, window or layout changes, entering insert mode, a new jump, calibration or stop invalidate the session. Native `f`, `F`, `t` and `T` also cancel it, even when they do not move the cursor.

`toggle_debug()` shows a live colored gaze marker and, by default, an ASCII radius outline. Both follow current gaze rather than the frozen jump snapshot. They do not move the cursor or change the buffer, and disappear when gaze is invalid, stale, outside the editor, or during editor alignment. No gaze data is logged.

## Configuration

Pass options through lazy.nvim's `opts` or call `require('eye_jump').setup(opts)` after adding the checkout to your runtime path.

<details>
<summary>Defaults</summary>

```lua
{
  case_mode = 'smart',
  search_radius = 10,
  show_search_radius = true,
  socket = vim.fn.expand('~/.local/share/eye-jump/gaze.sock'),
  max_age_ms = 200,
  allow_demo = false,
  alignment_path = vim.fn.stdpath('state') .. '/eye-jump/alignment.json',
}
```

</details>

`search_radius` and `max_age_ms` must be positive finite numbers. Set `show_search_radius = false` to hide the debug outline. `allow_demo = true` opts into synthetic frames; see the [bridge guide](docs/bridge.md#synthetic-demo). A custom `socket` must match the bridge's `EYE_JUMP_SOCKET`.

The optional `viewport = { x = 0, y = 0, width = 1, height = 1 }` sets a fixed fallback rectangle for the entire Neovim grid, in fractions of the tracked display. It is not set by default and must be updated manually after layout changes. A compatible saved alignment takes precedence.

## API

All functions are available from `require('eye_jump')`:

| Function | Purpose |
| --- | --- |
| `setup(opts)` | Configure the plugin, load saved alignments and connect to the bridge. |
| `jump()` | Capture gaze and prompt for a character. |
| `next_candidate()`, `previous_candidate()` | Silently navigate the frozen candidate list; return whether the action was handled. |
| `calibrate()` | Start editor alignment. |
| `toggle_debug()` | Toggle the live marker and optional outline. |
| `status()` | Return connection, gaze and alignment status. `connected` means the socket is connected; `ready` additionally requires a recent valid gaze sample. |
| `show_status()` | Display the status. |
| `stop()` | Stop the connection, debug marker and active alignment. |

## Guides

- [Tracker calibration and editor alignment](docs/calibration.md): measurements, display selection, saved data and troubleshooting.
- [Bridge](docs/bridge.md): startup, preview, protocol, demo, socket safety and recovery.

## Limitations and development

Only normal mode is implemented; visual and operator-pending mappings are deliberately untouched. Real-device calibration, the native fullscreen window, terminal geometry and actual gaze accuracy remain unvalidated. Staleness is measured from local socket receipt, not the hardware timestamp.

Run the tests from the `eye-jump.nvim` directory:

```sh
pnpm test
```

After `pnpm setup:sdl`, `GAZE_TEST_SDL=1 pnpm test:bridge` additionally tests the real SDL binding with its headless dummy video driver and a simulated tracker. Tests cover socket permissions/streaming, synthetic tracker startup, simulated calibration and cancellation/recovery, fullscreen window protocol, Neovim socket reception, synthetic alignment and one-shot movement, bounded matching, candidate cycling, outline cleanup, tabs and multibyte text.

## License

GPL-3.0-only; see [LICENSE](LICENSE). The bridge uses the vendored tobiifree SDK; see [third-party notices](THIRD_PARTY_NOTICES.md).
