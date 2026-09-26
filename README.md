# PongBar

PongBar is a standalone Decky Loader game built for the official Steam
Machine's 17 LED light bar. The physical strip is the playfield, while a dense
64 x 28 dot matrix on screen shows the score, lives, levels and feedback.

## Features

- Solo mode with three lives and a saved best streak.
- Two player duel mode, first to five points.
- Five colour and speed levels.
- Three early press jokers for each player.
- SteamUI controller input, Browser Gamepad input and on-screen controls.
- Looping previews for perfect returns, levels, points and victory.
- Procedural sound effects and an optional offline CC0 battle theme.
- Optional Steam Controller 2026 HID haptic diagnostics.

PongBar takes control of the light bar only while a game or preview is active.
It detects another LED writer, pauses instead of fighting for the device, and
restores the previous frame only when it still owns the bar.

## Install

1. Install [Decky Loader](https://decky.xyz/).
2. Download `PongBar-v0.1.0.zip` from the
   [v0.1.0 release](https://github.com/Albusquerque/PongBar/releases/tag/v0.1.0).
3. Open **Decky > Settings > General** and enable **Developer mode** if the
   **Developer** section is not already visible.
4. Open **Decky > Settings > Developer > Install Plugin from ZIP** and select
   the archive without extracting it.
5. Open PongBar and choose **Play or preview sequences**.

Physical LED play requires a Steam Machine exposing 17 `valve-leds` sysfs
devices. The on-screen game remains usable when the physical bar is absent.

## Play

Press the configured return button when the white ball reaches your two LED
end zone. A successful return extends the streak. Every five returns changes
the colour and increases the speed.

On the Steam input path, press **A** once so each controller appears. A is the
default return button and can be remapped. On-screen play uses the visible
buttons, Space for player one and Enter for player two.

See [controller compatibility](docs/CONTROLLER_COMPATIBILITY.md) for input and
haptic diagnostics. A successful software write is not proof of visible LED
output or felt vibration. Those results must be confirmed on the hardware.

## Build

```bash
npm install
npm run build
npm run package
```

The installable archive is written to `out/PongBar-v0.1.0.zip`.

PongBar is released under the BSD 3-Clause license. Music attribution and the
CC0 source are documented in [MUSIC_CREDITS.md](assets/MUSIC_CREDITS.md).
