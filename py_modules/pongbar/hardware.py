"""Direct sysfs adapter for the official Steam Machine's 17-LED bar."""

from __future__ import annotations

import glob
import os
import re

from .game import LED_COUNT, clean_frame

LED_GLOB = "/sys/class/leds/valve-leds[[]*[]]"


def discover_paths():
    def number(path):
        match = re.search(r"\[(\d+)\]$", path)
        return int(match.group(1)) if match else -1
    return sorted(glob.glob(LED_GLOB), key=number)


class ValveLeds:
    def __init__(self, reverse=True):
        self.paths = discover_paths()
        if len(self.paths) != LED_COUNT:
            raise RuntimeError(f"Expected 17 valve-leds LEDs; found {len(self.paths)}")
        self.reverse = bool(reverse)

    def _logical_paths(self):
        return list(reversed(self.paths)) if self.reverse else self.paths

    @staticmethod
    def _read(path, field):
        with open(os.path.join(path, field), encoding="ascii") as handle:
            return handle.read().strip()

    def read_frame(self):
        return clean_frame([tuple(map(int, self._read(path, "multi_intensity").split()))
                            for path in self._logical_paths()])

    def signature(self):
        return tuple((self._read(path, "multi_intensity"), self._read(path, "brightness"))
                     for path in self.paths)

    def write(self, frame):
        for path, pixel in zip(self._logical_paths(), clean_frame(frame)):
            with open(os.path.join(path, "multi_intensity"), "w", encoding="ascii") as handle:
                handle.write(" ".join(map(str, pixel)))
