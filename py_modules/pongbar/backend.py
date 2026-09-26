"""Thread-safe 1D Pong session, settings, LED ownership and diagnostics."""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path

from .game import PongGame
from .hardware import ValveLeds
from .hid_haptics import TritonRumble


class PongBackend:
    def __init__(self, settings_dir, logger, clock=time.monotonic):
        self.clock = clock
        self.logger = logger
        self.lock = threading.RLock()
        self.settings_file = Path(settings_dir) / "pongbar.json"
        self.settings = self._load_settings()
        self.game = PongGame(clock)
        self.haptics = TritonRumble()
        self.game.best_streak = self.settings["best_streak"]
        self.hardware = None
        self.hardware_error = ""
        try:
            self.hardware = ValveLeds(self.settings["reverse_led_order"])
        except (RuntimeError, OSError) as error:
            self.hardware_error = str(error)
        self.conflict = False
        self.game_running = False
        self.user_paused = False
        self.heartbeat_at = 0.0
        self.saved_frame = None
        self.owned_signature = None
        self.last_frame = None
        self.last_write_at = 0.0
        self.led_write_ms = None
        self.led_write_count = 0
        self.pending_hit_at = None
        self.stop_event = threading.Event()
        self.thread = None

    def _load_settings(self):
        defaults = {"best_streak": 0, "vibration_enabled": False, "reverse_led_order": True}
        try:
            data = json.loads(self.settings_file.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                defaults["best_streak"] = max(0, min(9999, int(data.get("best_streak", 0))))
                defaults["vibration_enabled"] = data.get("vibration_enabled") is True
                defaults["reverse_led_order"] = data.get("reverse_led_order") is not False
        except (OSError, ValueError, TypeError):
            pass
        return defaults

    def _save_settings(self):
        self.settings_file.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.settings_file.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.settings, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, self.settings_file)

    def start(self):
        if self.thread is not None:
            return
        self.thread = threading.Thread(target=self._run, name="PongBarLED", daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self.haptics.stop()
        if self.thread is not None:
            self.thread.join(timeout=2.0)
            self.thread = None
        with self.lock:
            self.game.stop()
            self._release_hardware()

    def _release_hardware(self):
        if self.hardware and self.saved_frame is not None and self.owned_signature is not None:
            try:
                if self.hardware.signature() == self.owned_signature:
                    self.hardware.write(self.saved_frame)
            except OSError as error:
                self.hardware_error = f"Could not restore LEDs: {error}"
        self.saved_frame = None
        self.owned_signature = None
        self.last_frame = None
        self.last_write_at = 0.0

    def _run(self):
        while not self.stop_event.wait(0.05):
            with self.lock:
                try:
                    self._tick()
                except Exception as error:
                    self.hardware_error = f"LED error: {type(error).__name__}: {error}"[:200]
                    self.conflict = True
                    self.game.advance(False, "LED bar unavailable")
                    self._release_hardware()
                    self.logger.warning("[PongBar] %s", self.hardware_error)

    def _tick(self):
        now = self.clock()
        if self.game.preview_kind and now - self.heartbeat_at > 5:
            self.game.stop("Preview stopped: screen closed")
        screen_missing = self.game.input_source == "touch" and now - self.heartbeat_at > 5
        allowed = not (self.game_running or self.user_paused or self.conflict or screen_missing
                       or not self.game.input_connected)
        reason = ("Another app is using the LED bar" if self.conflict else
                  "Game paused" if self.user_paused else
                  "A Steam game is running" if self.game_running else
                  "Return to the PongBar screen" if screen_missing else
                  "Controller disconnected" if not self.game.input_connected else "")
        self.game.advance(allowed, reason)
        if self.game.best_streak > self.settings["best_streak"]:
            self.settings["best_streak"] = self.game.best_streak
            self._save_settings()
        if not (self.game.active or self.game.preview_kind) or self.conflict:
            self._release_hardware()
            return
        if not self.hardware:
            return
        if self.last_write_at and now - self.last_write_at < 0.05:
            return
        if self.owned_signature is not None and self.hardware.signature() != self.owned_signature:
            self.conflict = True
            self.hardware_error = "Another app changed the LEDs. Disable its effect, then restart PongBar."
            self.game.advance(False, self.hardware_error)
            self._release_hardware()
            return
        frame, _ = self.game.frame()
        if frame == self.last_frame:
            return
        if self.saved_frame is None:
            self.saved_frame = self.hardware.read_frame()
        self.hardware.write(frame)
        self.owned_signature = self.hardware.signature()
        self.last_frame = frame
        self.last_write_at = now
        if self.pending_hit_at is not None:
            self.led_write_ms = (self.clock() - self.pending_hit_at) * 1000
            self.led_write_count += 1
            self.pending_hit_at = None

    def heartbeat(self):
        with self.lock:
            self.heartbeat_at = self.clock()
            return True

    def start_game(self, mode, indices, source, buttons):
        with self.lock:
            if self.game_running:
                raise ValueError("Close the running Steam game before starting PongBar")
            self._release_hardware()
            self.conflict = False
            self.hardware_error = "" if self.hardware else self.hardware_error
            self.user_paused = False
            self.heartbeat_at = self.clock()
            self.led_write_ms = None
            self.led_write_count = 0
            self.pending_hit_at = None
            self.game.start(mode, indices, source, buttons)
            return self.status()

    def stop_game(self):
        with self.lock:
            self.game.stop("Game stopped")
            self.user_paused = False
            self.conflict = False
            self._release_hardware()
            return self.status()

    def preview(self, kind):
        with self.lock:
            if self.game.active:
                raise ValueError("End the game before previewing a sequence")
            self._release_hardware()
            self.conflict = False
            self.hardware_error = "" if self.hardware else self.hardware_error
            self.heartbeat_at = self.clock()
            self.game.preview(kind)
            return self.status()

    def stop_preview(self):
        with self.lock:
            if self.game.preview_kind:
                self.game.stop()
                self._release_hardware()
            return self.status()

    def press(self, session_id, player):
        with self.lock:
            accepted = self.game.press(player, session_id)
            if accepted:
                self.pending_hit_at = self.clock()
            return {"accepted": accepted, "status": self.status()}

    def set_input_state(self, session_id, connected):
        with self.lock:
            if self.game.session_id == session_id and self.game.active:
                self.game.input_connected = bool(connected)
            return self.status()

    def set_game_running(self, running):
        with self.lock:
            self.game_running = bool(running)
            if self.game_running and (self.game.active or self.game.preview_kind):
                self.game.stop("Game stopped: a Steam game started")
                self._release_hardware()
            return self.status()

    def set_paused(self, paused):
        with self.lock:
            self.user_paused = bool(paused)
            return self.status()

    def set_setting(self, key, value):
        if key not in {"vibration_enabled", "reverse_led_order"} or type(value) is not bool:
            raise ValueError("Invalid PongBar setting")
        with self.lock:
            self.settings[key] = value
            if key == "reverse_led_order" and self.hardware:
                self.hardware.reverse = value
                self.last_frame = None
            self._save_settings()
            return self.status()

    def pulse_hid_output(self, device_id, kind):
        with self.lock:
            if self.game_running:
                raise RuntimeError("Stop the other Steam game before testing PongBar vibration")
        return self.haptics.pulse(device_id, kind)

    def status(self):
        with self.lock:
            result = self.game.status()
            result.update({
                "version": "0.1.0",
                "hardware_available": self.hardware is not None,
                "hardware_owner": "other" if self.conflict else "PongBar" if self.owned_signature else "free",
                "hardware_error": self.hardware_error,
                "led_write_ms": self.led_write_ms,
                "led_write_pending": self.pending_hit_at is not None,
                "led_write_count": self.led_write_count,
                "game_running": self.game_running,
                "vibration_enabled": self.settings["vibration_enabled"],
                "reverse_led_order": self.settings["reverse_led_order"],
                "best_streak": max(result["best_streak"], self.settings["best_streak"]),
            })
            return result
