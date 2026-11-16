# Calibration

[Back to README](../README.md) · [Bridge guide](bridge.md)

Eye jump uses two separate calibrations: the bridge calibrates the tracker against a display, and the plugin aligns Neovim's grid to that display. The latter is required for jumps unless a manual viewport is configured. The fullscreen window and tracker calibration have been tested together on real hardware on two different Macs; other platforms have not been tested.

## Tracker calibration

Connect the tracker, close any other app using it, and start the bridge as described in the [quick start](../README.md#quick-start). If a saved calibration is for the tracker-mounted display and the physical setup is unchanged, it can be reused. Otherwise, press `c` in the bridge terminal.

1. Choose the display with the tracker mounted below it. The list shows each screen's number, size and desktop position. Enter accepts the currently saved display when it still matches; otherwise choose a number explicitly. Display numbers can change with the layout. SDL may report generic names; use `pnpm preview:calibration <number>` and the fullscreen confirmation to identify the screen visually.
2. Enter four measurements in millimeters: visible screen width, visible screen height, bottom-edge height above the tracker sensor center, and screen depth offset. Negative depth means the screen is behind the tracker; positive means toward the user. Enter accepts the previous value in brackets for the currently calibrated display. Decimal commas and dots are accepted; a different display requires all four measurements. Enter `q` or press Ctrl-C to cancel the prompts.
3. The bridge opens a separate SDL fullscreen window on the chosen display. The terminal prints instructions; the window shows only targets. Confirm the dot is on the tracker-mounted screen, then press Space to start. Look at each of the nine dots and press Space; Escape cancels. Keep tracker and display fixed throughout.

Target coordinates use the actual window content bounds and full display bounds, including any inset. SDL display geometry must uniquely match the saved display; ambiguous or changed geometry aborts the session. Geometry cannot prove the physical monitor's identity, so confirm the dot location before starting.

After success, the bridge saves `~/.local/share/eye-jump/tracker-calibration.json`. On later starts it loads the profile for the same tracker. The last successful display and measurements are remembered; selecting a different display does not overwrite them until calibration succeeds. Only one bridge profile is retained, not one per display.

At startup the bridge checks whether saved display geometry matches exactly one SDL display that is not reported as rotated. Otherwise gaze stays disabled until you select and calibrate a display. The check is repeated after calibration, not continuously while the bridge runs, and cannot prove physical monitor identity. The bridge cannot verify changes in display arrangement, screen scale, user, or physical tracker position; keep these unchanged or recalibrate. Frames include the chosen display's ID/name, bounds and scale; SDL-created IDs are geometry-derived, not hardware IDs.

On cancellation or error, the bridge attempts to reconnect and restore the previous calibration, if any. Without one, gaze stays disabled until calibration succeeds. If recovery fails, restart the bridge. A crash, unplug or device fault can prevent automatic recovery, but prior profile files are not deleted. Automated mock tests also cover tracker and native-window paths; they do not guarantee recovery from every hardware or GUI failure.

## Editor alignment

With a calibrated bridge streaming fresh gaze, invoke `require('eye_jump').calibrate()`. For each of nine targets, look steadily at the center of the highlighted cell and press Space. Escape cancels without replacing the previous alignment. This does **not** calibrate the Tobii tracker or write its profile.

The plugin averages recent valid samples and fits an affine mapping from Neovim's grid to the tracker's calibrated display coordinates. It reports fit error and rejects highly inconsistent or degenerate samples. Press `s` during alignment to show a snapshot without advancing:

| Field | Meaning |
| --- | --- |
| `B` | Bridge connection |
| `G` | Gaze freshness |
| `N` | Number of usable recent samples |
| `S` | Sample time span in milliseconds |
| `A` | Newest sample age in milliseconds |
| `P` | Latest normalized display point, if available |

Successful alignment is saved under `eye-jump/alignment.json` in Neovim's state directory. Only fit coefficients and setup metadata are saved, not the samples. Demo alignment uses a separate file. On startup, saved alignment is reused for the same tracker setup and display. When terminal row/column counts change, the mapping adapts assuming the grid origin and cell size have not changed.

The plugin cannot detect a moved window, font-size change, different tmux pane, or all display changes. Check the live marker and recalibrate when it looks wrong. Successful tracker calibration changes the setup fingerprint, so editor alignment must be repeated. Alignment assumes the terminal grid stays on the tracked display. Automatic window/grid geometry discovery is not yet implemented; an outer window rectangle alone does not account for terminal padding or tmux panes.

`show_status()` reports `ready = false` without recent valid gaze and `aligned = false` when alignment is unavailable for the current setup. When gaze is available, `alignment` explains whether saved alignment is ready, resized, missing, or belongs to another tracker setup. A socket connection alone does not guarantee gaze, for example during tracker calibration.

As an alternative to interactive alignment, [configure a manual viewport](../README.md#configuration) for the entire grid. This fixed fallback must be updated after layout changes. Demo points are not useful for real calibration; demo alignment is isolated from real alignment.
