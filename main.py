"""Decky entry point for the standalone PongBar 1D Pong game."""

from __future__ import annotations

import os
import sys
import asyncio

import decky

PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(PLUGIN_DIR, "py_modules"))

from pongbar.backend import PongBackend  # noqa: E402


class Plugin:
    async def _main(self):
        self.backend = PongBackend(decky.DECKY_PLUGIN_SETTINGS_DIR, decky.logger)
        self.backend.start()
        decky.logger.info("[PongBar] standalone 0.1.0 loaded")

    async def _unload(self):
        self.backend.stop()

    async def _uninstall(self):
        self.backend.stop()

    async def get_status(self):
        return self.backend.status()

    async def start_game(self, mode: str, gamepad_indices, input_source: str, action_buttons):
        return self.backend.start_game(mode, gamepad_indices, input_source, action_buttons)

    async def stop_game(self):
        return self.backend.stop_game()

    async def preview_pattern(self, kind: str):
        return self.backend.preview(kind)

    async def stop_preview(self):
        return self.backend.stop_preview()

    async def press(self, session_id: int, player: int):
        return self.backend.press(session_id, player)

    async def ping_input(self):
        return True

    async def heartbeat(self):
        return self.backend.heartbeat()

    async def set_input_state(self, session_id: int, connected: bool):
        return self.backend.set_input_state(session_id, connected)

    async def set_game_running(self, running: bool):
        return self.backend.set_game_running(running)

    async def set_paused(self, paused: bool):
        return self.backend.set_paused(paused)

    async def set_setting(self, key: str, value: bool):
        return self.backend.set_setting(key, value)

    async def list_hid_outputs(self):
        return self.backend.haptics.devices()

    async def pulse_hid_output(self, device_id: str, kind: str = "test"):
        return await asyncio.to_thread(self.backend.pulse_hid_output, device_id, kind)
