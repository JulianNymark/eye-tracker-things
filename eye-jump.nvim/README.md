# Eye jump

macOS + Neovim prototype for Tobii Eye Tracker 5. Look near a character and
invoke the jump action to move to it.

The bridge can calibrate the tracker using a fullscreen window. The 
nvim plugin calibrates the offset of the window within the display. So 
currently it requires two calibrations, there's probably a reliable way for
nvim to get the window coordinates (its own rectangle on screen) via an API, but 
the `:winpos` command failed to work for me (running kitty -> tmux -> nvim probably breaks something).
The double calibration seems fairly reliable though, and a calibration should be remembered.

## Quick start

Connect the tracker and close any other app using it.

1. **Install once:**

   ```sh
   pnpm install --frozen-lockfile
   pnpm setup:sdl
   ```

2. **Start the bridge** and leave it running:

   ```sh
   pnpm bridge
   ```

   If the saved calibration is for the tracker-mounted display and its physical
   setup is unchanged, you can reuse it. Otherwise, press `c`, choose the
   tracker-mounted display, and enter its measurements. Confirm the fullscreen
   dot is on that display, then press Space to start and again for each of the
   nine dots. Escape cancels.

3. **Open Neovim** on the tracked display in a separate terminal. With the
   [plugin configured](#neovim-setup), use its actions in normal mode:
   - `show_status()` — check that `ready = true`.
   - `calibrate()` — align the editor: look steadily at the center of each
     highlighted cell and press Space. This is separate from tracker calibration
     and is currently required for jumps.
   - `toggle_debug()` — toggle a live marker showing where gaze maps in Neovim.
   - Look near a character, ini brand still strong
- Ikke prøvd å bruke Innblikk før

- ryddoke `jump()`, then type that character.

On later runs, start with `pnpm bridge`; the saved editor alignment is reused.
Check the marker after moving or resizing the terminal and recalibrate when it
looks wrong. Press `q` in the bridge terminal to stop it.

The fullscreen window and tracker calibration are still experimental and have
not yet been tested together on real hardware. See [tracker calibration](#tracker-calibration)
for recovery and display-selection details.

## Requirements

- macOS, a runtime-mode Tobii Eye Tracker 5, Node.js and pnpm.
- A tracker-mounted display. After calibration, the bridge checks tracker
  identity but cannot verify that the display arrangement,
  screen scale, user, or physical tracker position still match the calibration.
  Keep them unchanged; recalibrate if needed. Rotated displays are not supported.
- Neovim in Ghostty. Begin with one display, one Ghostty terminal surface, one
  tmux pane if using tmux, and one Neovim window. Other layouts need separate
  coordinate mapping and have not been verified.

## Start the bridge

```sh
pnpm install --frozen-lockfile
pnpm setup:sdl
pnpm bridge
```

This claims the tracker, reapplies saved geometry and calibration if available,
and streams gaze to `~/.local/share/eye-jump/gaze.sock`. Gaze remains disabled
until the tracker is calibrated. In an interactive terminal,
press `c` to calibrate or `q` to quit; Ctrl-C also stops the bridge. Piped or
noninteractive startup only streams gaze. `pnpm setup:sdl` installs SDL's
prebuilt native binding if it is missing; it downloads the binding from the
upstream GitHub release. No Electron or browser is used.

The bridge streams the tracker's unfiltered gaze for responsiveness. Invalid or
off-display points are discarded rather than falling back to smoothed gaze.
Editor alignment still averages recent samples while you look at each target.

To check the fullscreen window without connecting or changing the tracker:

```sh
pnpm displays                  # list available displays
pnpm preview:calibration       # first display
pnpm preview:calibration 2     # second display, if present
```

The preview displays the same dots and logs their display-normalized positions;
Space starts and advances, and Escape cancels. It never accesses the tracker or saves a
calibration.

The bridge does not flash firmware, reset the USB device, record screen contents,
or move the mouse.

### Tracker calibration

Press `c` in the bridge terminal and choose the display with the tracker mounted
below it. The list shows each screen's number, size, and desktop position. Enter
accepts the currently saved display when it still matches; otherwise choose a
number explicitly. Display numbers can change when the display layout changes.
SDL may report generic names; use `pnpm preview:calibration <number>` and the
fullscreen confirmation to identify the tracker-mounted screen visually.

The bridge then asks for four measurements in millimeters:
visible screen width, visible screen height, bottom-edge height above the
tracker sensor center, and screen depth offset. For depth, negative means the
screen is behind the tracker; positive means toward the user. Enter accepts the previous value in
brackets for the currently calibrated display; decimal commas and dots are
accepted. A different display requires all four measurements. Enter `q` or
press Ctrl-C to cancel the prompts.

The bridge opens a separate SDL fullscreen window on the chosen display. The
terminal prints instructions; the window shows only the targets.
Confirm the dot is on the tracker-mounted screen, then press Space to start.
Look at each of the nine dots and press Space; Escape cancels. Target
coordinates are calculated from the actual window content bounds and full
display bounds, including any inset. SDL display geometry must uniquely match
the saved display; ambiguous or changed geometry aborts the session. Geometry
alone cannot prove the physical monitor's identity, so confirm the dot location
before starting. Keep the tracker and display fixed throughout.

After success, the bridge saves a profile at
`~/.local/share/eye-jump/tracker-calibration.json`. On later starts, it loads
that profile for the same tracker. The
last successful display and measurements are remembered; selecting a different
display does not overwrite them until calibration succeeds. Only one bridge
profile is retained, not a separate profile per display.
At startup the bridge checks whether the saved display geometry matches exactly
one SDL display that is not reported as rotated. If not, gaze stays disabled
until you select and calibrate a display. This check does not prove physical
monitor identity and is repeated after calibration, not continuously while the
bridge is running.
Gaze frames include the selected display's ID/name, bounds, and scale alongside
the normalized point; SDL-created IDs are geometry-derived, not hardware IDs.
On cancellation or an error, it attempts to reconnect and restore the previous
calibration if one exists. Without a previous calibration, gaze stays disabled
until a calibration succeeds. If recovery fails, restart the bridge. A crash,
unplug, or device fault can prevent automatic recovery, but
the prior profile files are not deleted. These tracker and native-window paths
have automated mock tests, but still need real-device and native GUI testing.

For a **synthetic** stream that requires no tracker or calibration:

```sh
pnpm bridge --demo
```

Demo points move continuously and are labeled `demo`; the plugin rejects them
unless explicitly enabled. `GAZE_JUMP_SOCKET` can override the bridge's socket
path; set the same path in the Neovim config. Its parent directory must be
owned by your user and private. The bridge never removes an existing socket at
startup; if a crash leaves one behind, confirm no bridge is running before
removing it.

## Neovim setup

The plugin installs no keybindings; choose your own. Add the repo to Neovim's
runtime path, then configure the plugin. This lazy.nvim example suggests
normal-mode bindings that you can customize:

```lua
{
  -- When published, replace dir with 'owner/repository'.
  dir = vim.fn.expand('~/Repos/eye-tracker-things/eye-jump.nvim'),
  main = 'gaze_jump',
  event = 'VeryLazy',
  opts = {
    case_mode = 'smart', -- 'smart' (default), 'sensitive', or 'insensitive'
    search_radius = 10, -- positive finite radius in character widths
    show_search_radius = true, -- show the boundary with the live marker
  },
  keys = {
    { '<leader>ej', function() require('gaze_jump').jump() end, desc = 'Jump near gaze' },
    { '<leader>ec', function() require('gaze_jump').calibrate() end, desc = 'Calibrate eye alignment' },
    { '<leader>es', function() require('gaze_jump').show_status() end, desc = 'Eye tracker status' },
    { '<leader>te', function() require('gaze_jump').toggle_debug() end, desc = 'Toggle gaze marker' },
    -- Optional: correct a gaze jump, otherwise preserve native ; and ,.
    { ';', function()
      local gaze = require('gaze_jump')
      if not gaze.next_candidate() then
        vim.cmd.normal({ tostring(vim.v.count1) .. ';', bang = true })
      end
    end, mode = 'n', desc = 'Next gaze candidate or native repeat' },
    { ',', function()
      local gaze = require('gaze_jump')
      if not gaze.previous_candidate() then
        vim.cmd.normal({ tostring(vim.v.count1) .. ',', bang = true })
      end
    end, mode = 'n', desc = 'Previous gaze candidate or native repeat' },
  },
}
```

`dir` is lazy.nvim's local-directory option. After publishing, replace it with
the repository URL or `owner/repository`; keep `main`, `opts`, and your chosen
keys. lazy.nvim loads the Neovim plugin only—the bridge remains a separate
process that you install and start from the checkout.
You can choose another jump key, such as `s`. The optional `;` and `,`
mappings are normal-mode only and fall back to their native commands when
there is no valid correction session.

`require('gaze_jump').status().connected` reports the bridge socket connection;
`ready` additionally requires a recent valid gaze sample. A connected bridge
can still lack gaze, for example while the tracker is being calibrated.

### Editor alignment

Invoke `require('gaze_jump').calibrate()`. For each of nine targets, look
steadily at the center of the highlighted cell and press Space. Escape cancels
without replacing the previous alignment. The plugin averages recent valid
samples and fits an affine mapping from Neovim's grid to the tracker's
calibrated display coordinates. It reports the fit error
and rejects highly inconsistent or degenerate samples. This is **not Tobii
tracker calibration**: it does not write the device or tracker profile.

Press `s` during alignment to show a snapshot without advancing: `B` is bridge
connection, `G` is gaze freshness, `N` is the number of usable recent samples,
`S` is their time span in milliseconds, `A` is the newest sample's age in
milliseconds, and `P` is the latest normalized display point, if available.

Successful alignment is saved in Neovim's state directory under
`eye-jump/alignment.json`; only fit coefficients and setup metadata are saved,
not the samples. Demo alignment uses a separate file. Saved alignment is loaded
on startup and reused for the same tracker setup and display. When the terminal
row/column count changes, it adapts the saved mapping assuming the grid origin
and cell size have not changed.

The plugin cannot detect a moved window, font-size change, different tmux pane,
or all display changes. Use the live marker to check alignment and recalibrate
when it looks wrong. A successful tracker calibration changes the setup
fingerprint, so editor alignment must be repeated. Alignment assumes the
terminal grid stays on the tracked display. Automatic window/grid geometry
discovery is not yet implemented; the operating system's outer window rectangle
alone does not account for terminal padding and tmux panes.

`show_status()` shows `ready = false` if there is no recent valid gaze and
`aligned = false` if alignment is unavailable for the current setup. If gaze is
available, `alignment` explains whether the saved calibration is ready,
resized, missing, or belongs to another tracker setup. Escape cancels character
input. By default, matching uses smart case: a lowercase
character matches either case; an uppercase character matches exact case.
Set `case_mode = 'sensitive'` to always match exact case, or `'insensitive'` to
always ignore case. Matching supports Unicode and is independent of Neovim's
`'ignorecase'` and `'smartcase'` options.

`jump()` captures gaze when invoked, then instantly selects the nearest matching
visible character within that captured search radius once the character is typed.
If gaze is outside the editor or there is no match within the radius, the cursor
stays put. `search_radius` defaults to 10 character widths and must be a positive
finite number. The calibrated display-space search area is circular and respects
the aspect ratio of character cells. Matches hidden inside closed folds are
skipped. Distance is calculated in the fitted tracker-gaze coordinate space;
calibration error or a sheared fit can make it differ from exact screen-space
distance.

The jump freezes all matching candidates within the radius, without a count cap,
ordered by their original gaze distance, with ties ordered by line and byte
position. `next_candidate()` and `previous_candidate()` traverse that list
without wrapping. They return `true` when the correction is handled, including
at either end of the list, and `false` when there is no valid correction session.
There is no timeout or resampling: later gaze movement or staleness does not
change the frozen candidates. The session ends on unrelated movement, editing,
buffer, window or layout changes, entering insert mode, a new jump, calibration
or stop. Native `f`, `F`, `t` and `T` also cancel it, even if they do not move
the cursor.

The marker toggled by `toggle_debug()` displays the latest mapped gaze as a
colored dot in the editor, with an ASCII search-radius boundary by default. Set
`show_search_radius = false` to hide the boundary. Both are live, not a frozen
outline after a jump: the jump uses the sample captured when `jump()` was
invoked, which may differ from where the marker moves afterward. The marker does
not move the cursor or change the buffer. It disappears when gaze is invalid,
stale, outside the editor, or during editor alignment. No gaze data is logged.

For synthetic testing, opt in with `require('gaze_jump').setup({ allow_demo = true })`
and run `pnpm bridge --demo`. The moving demo points are not useful for a real
calibration; demo alignment is isolated from real alignment.

As an alternative to interactive alignment, `setup` accepts an optional
`viewport = { x = ..., y = ..., width = ..., height = ... }`: the entire
Neovim grid rectangle as fractions of the tracked display. It is a fixed
fallback and must be updated manually after any layout change.

## Tests and limitations

```sh
pnpm test
```

After `pnpm setup:sdl`, `GAZE_TEST_SDL=1 pnpm test:bridge` additionally tests
the real SDL binding with its headless dummy video driver and a simulated tracker.

Tests cover socket permissions/streaming, synthetic tracker startup, simulated
tracker calibration and cancellation/recovery, the fullscreen window protocol,
Neovim socket reception, synthetic alignment and one-shot movement, tabs, and
multibyte text. They do not validate the native fullscreen window, real-device
calibration, terminal geometry, or actual gaze accuracy. Staleness is measured
from local socket receipt, not the hardware timestamp. Only normal mode is
implemented; visual and operator-pending mappings are deliberately left untouched.

The bridge uses the vendored tobiifree SDK;
see [third-party notices](THIRD_PARTY_NOTICES.md). GPL-3.0-only.
