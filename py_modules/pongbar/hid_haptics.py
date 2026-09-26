"""Bounded Steam Controller 2026 rumble via its HID output report.

The 10-byte report layout and 40 ms refresh interval follow SDL's Triton driver.
This module never sends feature reports or changes controller configuration.
"""

from __future__ import annotations

import os
import re
import threading
import time
from pathlib import Path


_HIDRAW = Path("/sys/class/hidraw")
_ALLOWED_PRODUCTS = {0x1302: "wired", 0x1303: "Bluetooth",
                     0x1304: "wireless puck", 0x1305: "wireless puck"}
_HID_ID = re.compile(r"^HID_ID=[0-9A-Fa-f]+:([0-9A-Fa-f]+):([0-9A-Fa-f]+)$", re.M)


def _rumble_report(left: int, right: int) -> bytes:
    """SDL Triton: report 0x80, type 0, intensity 0, two LE speeds, gains 0."""
    return bytes((0x80, 0, 0, 0, left & 255, left >> 8, 0,
                  right & 255, right >> 8, 0))


class TritonRumble:
    def __init__(self):
        self.stopping = threading.Event()
        self.lock = threading.Lock()
        self.active = set()

    def stop(self):
        self.stopping.set()

    def devices(self):
        if not _HIDRAW.is_dir():
            return []
        found = []
        for entry in sorted(_HIDRAW.glob("hidraw*")):
            try:
                device = (entry / "device").resolve(strict=True)
                uevent = (device / "uevent").read_text(encoding="ascii")
                match = _HID_ID.search(uevent)
                if not match or int(match.group(1), 16) != 0x28DE:
                    continue
                product = int(match.group(2), 16)
                if product not in _ALLOWED_PRODUCTS:
                    continue
                # The puck exposes several HID interfaces. SDL addresses 2–5.
                interface = None
                for parent in (device, *device.parents):
                    number = parent / "bInterfaceNumber"
                    if number.is_file():
                        interface = int(number.read_text(encoding="ascii").strip(), 16)
                        break
                if product in (0x1304, 0x1305) and interface not in (2, 3, 4, 5):
                    continue
                node = Path("/dev") / entry.name
                if not node.exists():
                    continue
                found.append({"id": f"{entry.name}:{device}", "node": str(node),
                              "label": f"Steam Controller 2026 · {_ALLOWED_PRODUCTS[product]} · {entry.name}"
                                       + (f" interface {interface}" if interface is not None else ""),
                              "product": product, "interface": interface})
            except (OSError, ValueError):
                continue
        return found

    def pulse(self, device_id: str, kind: str = "test"):
        if not isinstance(device_id, str) or len(device_id) > 300:
            raise ValueError("Invalid HID output selection")
        device = next((item for item in self.devices() if item["id"] == device_id), None)
        if device is None:
            raise RuntimeError("Steam Controller 2026 HID output unavailable; reconnect and select it again")
        if kind not in {"test", "hit", "perfect", "joker", "early_penalty",
                        "loss", "point", "level", "winner"}:
            kind = "hit"
        if self.stopping.is_set():
            raise RuntimeError("PongBar is stopping")
        with self.lock:
            if device_id in self.active:
                return {"result": "Previous rumble still playing", "writes": 0}
            self.active.add(device_id)
        try:
            duration = {"test": .32, "hit": .10, "perfect": .17, "joker": .11,
                        "early_penalty": .22, "loss": .24, "point": .21,
                        "level": .25, "winner": .35}[kind]
            speed = {"test": 32000, "hit": 18000, "perfect": 26000,
                     "joker": 12000, "early_penalty": 23000, "loss": 22000,
                     "point": 26000, "level": 30000,
                     "winner": 36000}[kind]
            report = _rumble_report(speed, speed)
            writes = 0
            fd = os.open(device["node"], os.O_WRONLY | os.O_NONBLOCK | os.O_CLOEXEC)
            try:
                end = time.monotonic() + duration
                while not self.stopping.is_set() and time.monotonic() < end:
                    if os.write(fd, report) != len(report):
                        raise OSError("Incomplete HID rumble report")
                    writes += 1
                    self.stopping.wait(.04)
                os.write(fd, _rumble_report(0, 0))
            finally:
                os.close(fd)
            return {"result": "HID reports written; confirm vibration by feel", "writes": writes}
        finally:
            with self.lock:
                self.active.discard(device_id)
