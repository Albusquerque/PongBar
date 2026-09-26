# PongBar 0.1.0: controllers and haptics

PongBar is a 1D Pong game played across the Steam Machine's 17 LED light bar. This document separates documented API behavior, what PongBar implements, and what still requires a physical Steam Machine check.

## Input paths

| Path | Evidence | PongBar behavior |
| --- | --- | --- |
| SteamUI controller events | [`@decky/ui` types](https://github.com/SteamDeckHomebrew/decky-frontend-lib/blob/main/src/globals/steam-client/Input.ts) expose `RegisterForControllerInputMessages` and name button code `0` as A. This is a Steam client interface, not a documented public plugin compatibility contract. | A button event makes a controller visible. A is the default return button; “Change P1/P2 button” captures the actual received code. |
| Browser Gamepad | The [W3C Gamepad specification](https://www.w3.org/TR/gamepad/) defines `navigator.getGamepads()` and gamepad button state. Visibility depends on the SteamUI browser and user interaction. | PongBar polls connected browser gamepads. Players capture a return button before starting. |
| On-screen | No controller required. | Full game using the visible return buttons, Space and Enter. |

Controller indexes from SteamUI and Browser Gamepad are **not interchangeable**. PongBar does not guess a mapping between them.

## Why the first vibration route did not work

The first implementation sent haptics **only** through `Gamepad.vibrationActuator.playEffect` and only when `input_source === "browser"`. The SteamUI controller path used on the reported Steam Machine photo had no haptic output at all. Also, a controller observed through SteamUI can be absent from `navigator.getGamepads()`; those are separate interfaces. The [W3C specification](https://www.w3.org/TR/gamepad/) permits a gamepad without a vibration actuator, and [MDN's `playEffect` reference](https://developer.mozilla.org/en-US/docs/Web/API/GamepadHapticActuator/playEffect) records browser support and errors. Thus detecting input never proved rumble capability.

## SteamUI and Browser Gamepad haptic investigation

PongBar now exposes two independent diagnostic routes:

1. **Steam input events:** call the SteamUI `SteamClient.Input.TriggerSimpleHapticEvent` wrapper with the observed controller index. The [Decky frontend types](https://github.com/SteamDeckHomebrew/decky-frontend-lib/blob/main/src/globals/steam-client/Input.ts) expose a five-argument wrapper. This is distinct from the public six-argument `ISteamInput` game API. Valve's [Steam Input output documentation](https://partner.steamgames.com/doc/api/ISteamInput) confirms that compatible controllers can play haptic pulses and traditional rumble, but does not define this SteamUI wrapper's exact parameter meaning or guarantee it for plugins. PongBar sends a bounded experimental pulse and does not alter saved controller settings.
2. **Browser Gamepad:** check that a connected gamepad exposes `vibrationActuator.playEffect` and, if reported, supports `dual-rumble`. Await the result or exception. A resolved API call confirms software completion only; it does not prove the user felt the effect.

“Try P1/P2 haptics” calls the selected route even if automatic game haptics are off and shows whether the API was missing, rejected the call, or accepted it. The player must report whether the controller physically moved. When automatic haptics are on, PongBar uses the selected path for returns, jokers, points, levels and victory. Failures never block play.

**Hardware limits:** Valve documents that haptic pulses only work on supported controllers; traditional rumble may be ignored on unsupported models. A SteamUI pulse is an experimental client API call and may be no-op despite returning normally. No controller family is yet claimed as physically validated for this route.

The first Steam Machine trial found **no felt vibration**, so a returned SteamUI call is not evidence of working feedback. A diagnostic build registered for Steam's controller-list changes and showed the controller name, type, `bHaptics` flag and rumble preference when Steam supplied them. This callback may not provide a list immediately; reconnecting a controller can generate a change. The screen also shows each Browser Gamepad's dual-rumble API presence. A separate **Probe this device** button is provided for every visible interface and displays the API's return value. The `bHaptics` flag is diagnostic information, not a guarantee of traditional rumble. If Steam reports rumble **off**, change the controller preference in Steam's own settings; PongBar does not alter it.

The reported device is the **Steam Controller released in 2026**, not the 2015 model. Valve lists it separately as `k_ESteamInputType_SteamController2026` in the current Steamworks API, and its [Steam client update notes](https://www.steamdeck.com/en/news?p=17&pubDate=20260422) refer to distinct rumble haptics. Documentation for the original controller's trackpad pulses cannot establish the behavior of the new controller's grip rumble. No publicly documented mapping from Decky's SteamUI `controllerIndex` and `TriggerSimpleHapticEvent` parameters to the new controller's grip rumble has been found. The current SteamUI pulse route therefore remains unverified for this model.

Valve's documented [Steamworks `ISteamInput`](https://partner.steamgames.com/doc/api/ISteamInput) distinguishes traditional `TriggerVibration` from touchpad `TriggerHapticPulse` and requires an `InputHandle_t` for a game. The Decky-exposed SteamUI wrapper takes a controller index and has no documented guarantee that it triggers a conventional rumble motor. PongBar does not treat those indexes and handles as interchangeable.

## Steam Controller 2026 HID rumble

The user confirmed that vibration works in another Steam game on the same Steam Machine, while the SteamUI route reported success with no felt vibration. Version 0.1.0 therefore does not use the SteamUI wrapper for automatic feedback. Its Decky backend enumerates only Valve HID devices with Steam Controller 2026 product IDs `1302` (wired), `1303` (Bluetooth), `1304` or `1305` (wireless puck); for pucks it selects interfaces 2–5 as [SDL's Triton driver](https://github.com/libsdl-org/SDL/blob/main/src/joystick/hidapi/SDL_hidapi_steam_triton.c) does. It sends SDL's 10-byte output report `0x80` through Linux hidraw, repeating at 40 ms because SDL documents a roughly 50 ms controller safety timeout. It sends a zero-speed report at the end. The [Linux HID documentation](https://docs.kernel.org/hid/hidraw.html) specifies `write()` for output reports. PongBar does not send feature reports, disable lizard mode, change firmware, or modify Steam's rumble preferences.

The backend re-enumerates devices before every write and accepts only a selected ID from that list. When one output is found, P1 receives it automatically. With multiple outputs, the player uses **Pulse** to identify each physical controller and assigns separate outputs to P1 and P2. Automatic cues run only when **Controller haptics** is on. The backend refuses output while another Steam game is reported running. HID writes are software evidence; physical vibration and coexistence with Steam Input still require the Steam Machine trial. A wireless puck can expose several interfaces even with one controller; probe rather than infer which interface controls a given device.

## Setup and diagnosis

1. Open the full-screen page and choose Solo or Duel.
2. On Steam input, press A once on each controller so it appears. Select P1 and P2 if needed; A is ready by default.
3. If A does not suit the controller mapping, use “Change P1/P2 button” and press the desired button after arming capture. The capture expires after 12 seconds.
4. Start the game. During a rally, press the configured button near your two-LED end zone. An early press uses one of each player's three jokers. With no jokers left, the next early press loses a life or grants the opponent a point.
5. Under Sound & feel, use **Pulse** for each listed HID output and note which physical controller vibrates. Assign the corresponding output to P1 or P2. In solo mode, a single output is assigned automatically. Turn **Controller haptics ON** for feedback during play. If Pulse reports a write but nothing is felt, record its exact message, connection method (USB, Bluetooth or puck), and SteamOS version.

The Steam input hook does not provide a reliable disconnect signal, so Steam-path sessions cannot infer a disconnect from silence. The browser path pauses when a selected gamepad disappears. Controller haptics are independent of the LED bar and do not require root access.

## Measurement scope

Input → backend timing starts when SteamUI or the browser delivers the event. It excludes wireless/USB transmission. Accepted hit → LED timing ends at the software write to the LED device; it excludes physical diffusion. Neither timing metric measures audio output or haptic motor onset. The plugin must be checked on the Steam Machine to establish perceived latency and real vibration.
