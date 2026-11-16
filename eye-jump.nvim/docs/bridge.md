# Bridge

[Back to README](../README.md) · [Calibration guide](calibration.md)

The macOS bridge is a separate process from the Neovim plugin. It claims the tracker, reapplies saved geometry and calibration if available, and streams gaze over a local Unix socket. Gaze remains disabled until the tracker is calibrated. No Electron or browser is used.

## Start and stop

From the `eye-jump.nvim` directory (not the repository root), with the tracker connected and other apps using it closed:

```sh
pnpm install --frozen-lockfile
pnpm setup:sdl
pnpm bridge
```

`pnpm setup:sdl` installs SDL's prebuilt native binding if missing, downloading it from the upstream GitHub release. In an interactive bridge terminal, press `c` to calibrate or `q` to quit; Ctrl-C also stops the bridge. Piped or noninteractive startup only streams gaze. For the calibration steps, display selection and recovery, see [tracker calibration](calibration.md#tracker-calibration).

The bridge streams the tracker's unfiltered gaze for responsiveness. Invalid or off-display points are discarded rather than replaced with smoothed gaze. Editor alignment averages recent samples while you look at each target. The bridge does not flash firmware, reset the USB device, record screen contents, or move the mouse.

## Display preview

Check the fullscreen window without connecting to or changing the tracker:

```sh
pnpm displays
pnpm preview:calibration
pnpm preview:calibration 2
```

The last command selects the second display, if present; omit the number for the first display. The preview shows the same dots and logs their display-normalized positions. Space starts and advances, and Escape cancels. It never accesses the tracker or saves a calibration. Use it to help identify the tracker-mounted screen when SDL reports generic display names.

## Socket and safety

The default socket is `~/.local/share/eye-jump/gaze.sock`. `EYE_JUMP_SOCKET` overrides the bridge socket path; configure the same `socket` path in Neovim. The socket's parent directory must be owned by your user and private. The bridge creates a missing directory with mode `0700` and sets the socket to `0600`.

Frames are newline-delimited JSON with `version: 1`, a `source` of `tobii` or `demo`, a display-normalized `point` or `null`, and display metadata. A null point indicates unavailable gaze, including invalid or off-display samples and calibration in progress. Frames can also include a setup fingerprint and aliases. Stale frames are not replayed to new clients; the bridge disconnects clients whose pending output exceeds 65,536 bytes.

The bridge never removes an existing socket at startup. If a crash leaves one behind, confirm no bridge is running before removing it. Calibration recovery and saved profile behavior are described in the [calibration guide](calibration.md#tracker-calibration).

## Synthetic demo

For a synthetic stream without a tracker or tracker calibration:

```sh
pnpm bridge --demo
```

Demo points move continuously and are labeled `demo`; the plugin rejects them unless explicitly enabled with `require('eye_jump').setup({ allow_demo = true })` or the equivalent lazy.nvim `opts`. Moving demo points are not useful for a real calibration, and demo alignment is isolated from real alignment.
