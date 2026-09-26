"""PongBar rules and the 17-LED frames shared by play and previews."""

from __future__ import annotations

import math
import time

LED_COUNT = 17
BLACK = (0, 0, 0)
WHITE = (245, 245, 235)
CYAN = (0, 175, 215)
PINK = (235, 65, 135)
GOLD = (255, 196, 73)
CHAMPAGNE = (255, 238, 170)
STAGES = ((0, 80, 95), (30, 65, 160), (100, 55, 165), (180, 85, 10), (190, 28, 25))
PATTERN_DURATIONS = {"perfect": 1.9, "level": 2.2, "point": 1.8, "winner": 4.0}
JOKERS_PER_PLAYER = 3
SPEEDS = (0.25, 0.23, 0.21, 0.19, 0.17)


def dim(colour, amount):
    return tuple(round(channel * amount) for channel in colour)


def bright(colour):
    return tuple(min(255, round(channel * 1.65 + 25)) for channel in colour)


def clean_frame(frame):
    if len(frame) != LED_COUNT:
        raise ValueError("PongBar frame must have 17 pixels")
    return tuple(tuple(max(0, min(255, int(channel))) for channel in pixel) for pixel in frame)


class PongGame:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.session_id = 0
        self.best_streak = 0
        self.stop()

    def stop(self, reason=""):
        now = self.clock()
        self.active = False
        self.preview_kind = ""
        self.mode = ""
        self.phase = "idle"
        self.input_source = "touch"
        self.action_buttons = ()
        self.gamepad_indices = ()
        self.input_connected = True
        self.scores = [0, 0]
        self.lives = 3
        self.jokers = [JOKERS_PER_PLAYER, JOKERS_PER_PLAYER]
        self.returns = 0
        self.streak = 0
        self.ball = 8.0
        self.direction = 1
        self.server = 0
        self.winner = -1
        self.cue = ""
        self.cue_at = now
        self.cue_side = 1
        self.phase_started = now
        self.last_tick = now
        self.paused_at = None
        self.pause_reason = str(reason or "")
        self.feedback_seq = 0
        self.feedback_player = -1
        self.feedback_kind = ""
        self.message = "Choose a mode to start PongBar."

    @property
    def level_index(self):
        return min(4, self.returns // 5)

    def start(self, mode, indices=(), input_source="touch", action_buttons=()):
        if mode not in {"solo", "duel"}:
            raise ValueError("Choose solo or duel mode")
        if input_source not in {"touch", "steam", "browser"}:
            raise ValueError("Unknown controller source")
        indices = tuple(indices)
        expected = 0 if input_source == "touch" else 1 if mode == "solo" else 2
        if len(indices) != expected or len(set(indices)) != len(indices):
            raise ValueError("Choose one controller for solo or two distinct controllers for duel")
        if any(type(index) is not int or index < 0 or index >= 0xffffffff for index in indices):
            raise ValueError("Invalid controller index")
        action_buttons = tuple(action_buttons)
        if len(action_buttons) != expected or any(
            type(button) is not int or button < 0 or button > 255 for button in action_buttons
        ):
            raise ValueError("Set a return button for each controller")
        self.stop()
        self.session_id += 1
        now = self.clock()
        self.active = True
        self.mode = mode
        self.phase = "ready"
        self.phase_started = now
        self.last_tick = now
        self.cue = "ready"
        self.cue_at = now
        self.input_source = input_source
        self.action_buttons = action_buttons
        self.gamepad_indices = indices
        self.input_connected = True
        self.message = "Get ready: return the white ball inside your end zone."
        return self.status()

    def preview(self, kind):
        if kind not in PATTERN_DURATIONS:
            raise ValueError("Unknown sequence")
        self.stop()
        self.mode = "solo"
        self.preview_kind = kind
        self.cue = kind
        self.cue_at = self.clock()
        self.phase = "finished" if kind == "winner" else "idle"
        if kind == "perfect":
            self.returns = self.streak = 1
        elif kind == "level":
            self.returns = self.streak = 5
        elif kind == "point":
            self.lives = 2
        else:
            self.returns = 12
            self.lives = 0
            self.winner = 0
        self.message = "Looping preview. Start a game to play."
        return self.status()

    def _feedback(self, player, kind):
        self.feedback_seq += 1
        self.feedback_player = player
        self.feedback_kind = kind

    def press(self, player, session_id):
        if session_id != self.session_id or not self.active or self.phase != "rally" or self.paused_at is not None:
            return False
        if player not in (0, 1) or (self.mode == "solo" and player != 0):
            return False
        if player != (0 if self.direction < 0 else 1):
            self.message = "Wait for the ball to travel toward your side."
            return False
        now = self.clock()
        self._move(now)
        if self.phase != "rally":
            return False
        distance = self.ball - 1 if player == 0 else 15 - self.ball
        if not 0 <= distance <= 1.8:
            if distance > 1.8:
                if self.jokers[player] > 0:
                    self.jokers[player] -= 1
                    self.cue = "joker"
                    self.cue_at = now
                    self.cue_side = player
                    self._feedback(player, "joker")
                    self.message = f"Too early! Player {player + 1}: {self.jokers[player]} jokers left."
                else:
                    self._point(1 - player, now)
                    self._feedback(player, "early_penalty")
                    consequence = "Life lost." if self.mode == "solo" else f"Point for player {2 - player}."
                    self.message = f"Player {player + 1} pressed early with no jokers left. {consequence}"
            return False
        self.direction *= -1
        self.streak += 1
        self.returns += 1
        if self.mode == "solo":
            self.best_streak = max(self.best_streak, self.streak)
        kind = "perfect" if distance <= 0.55 else "hit"
        self.cue = kind
        self.cue_at = now
        self.cue_side = player
        self._feedback(player, kind)
        self.message = "Perfect return!" if kind == "perfect" else "Great return! Keep going."
        if self.returns % 5 == 0:
            self.phase = "level"
            self.phase_started = now
            self.cue = "level"
            self.cue_at = now
            self._feedback(player, "level")
            self.message = f"Jackpot! Level {self.level_index + 1}: new colour, faster ball."
        return True

    def _point(self, scorer, now):
        if self.mode == "solo":
            self.lives -= 1
            self._feedback(0, "loss")
            if self.lives <= 0:
                self.winner = 1
        else:
            self.scores[scorer] += 1
            self._feedback(scorer, "point")
            if self.scores[scorer] >= 5:
                self.winner = scorer
        self.streak = 0
        self.server = 1 - self.server
        self.cue_side = scorer
        self.phase = "finished" if self.winner >= 0 else "point"
        if self.phase == "finished" and self.mode == "duel":
            self._feedback(scorer, "winner")
        self.phase_started = now
        self.cue = "winner" if self.phase == "finished" else "point"
        self.cue_at = now
        self.message = ("Game over. Your best streak is saved." if self.mode == "solo" else
                        f"Player {scorer + 1} wins!") if self.phase == "finished" else (
                        f"{self.lives} lives left." if self.mode == "solo" else f"Point for player {scorer + 1}!")

    def _move(self, now):
        if self.phase != "rally":
            self.last_tick = now
            return
        elapsed = max(0.0, min(0.5, now - self.last_tick))
        self.last_tick = now
        self.ball += self.direction * elapsed / SPEEDS[self.level_index]
        if self.mode == "solo" and self.direction > 0 and self.ball >= 15:
            self.ball = 15 - (self.ball - 15)
            self.direction = -1
        elif self.ball <= 1:
            self.ball = 1
            self._point(1, now)
        elif self.ball >= 15:
            self.ball = 15
            self._point(0, now)

    def advance(self, allowed=True, reason=""):
        if not self.active:
            return
        now = self.clock()
        if not allowed:
            if self.paused_at is None:
                self.paused_at = now
            self.pause_reason = reason or "Game paused"
            return
        if self.paused_at is not None:
            paused_for = now - self.paused_at
            self.phase_started += paused_for
            self.cue_at += paused_for
            self.last_tick = now
            self.paused_at = None
            self.pause_reason = ""
        age = now - self.phase_started
        if self.phase == "ready" and age >= 1.5:
            self.phase = "rally"
            self.phase_started = now
            self.last_tick = now
            self.ball = 8.0
            self.direction = 1 if self.server == 0 else -1
        elif self.phase == "point" and age >= 1.8:
            self.phase = "ready"
            self.phase_started = now
            self.cue = "ready"
            self.cue_at = now
            self.message = "New serve. Watch the white ball."
        elif self.phase == "level" and age >= 0.55:
            self.phase = "rally"
            self.phase_started = now
            self.last_tick = now
        elif self.phase == "finished" and age >= 4.0:
            self.active = False
        else:
            self._move(now)

    def _pattern(self, frame, now, stage):
        kind = self.preview_kind or self.cue
        if kind == "joker" and now - self.cue_at < 0.4:
            first = 0 if self.cue_side == 0 else 14
            flash = GOLD if int((now - self.cue_at) / 0.1) % 2 == 0 else BLACK
            for index in range(first, first + 3):
                if index != round(self.ball):
                    frame[index] = flash
            return "EARLY · JOKER USED"
        duration = PATTERN_DURATIONS.get(kind)
        if not duration:
            return ""
        elapsed = now - self.cue_at
        if elapsed < 0 or (not self.preview_kind and elapsed >= duration):
            return ""
        age = elapsed % duration if self.preview_kind else elapsed
        frame[:] = [dim(stage, 0.18)] * LED_COUNT
        stage_bright = bright(stage)
        if kind == "perfect":
            radius = int((age % 0.95) / 0.95 * 9)
            for index in range(LED_COUNT):
                distance = abs(index - 8)
                if distance < radius:
                    frame[index] = dim(stage_bright, 0.55)
                if distance == radius or distance == radius + 1:
                    frame[index] = WHITE if distance == radius else CYAN
            return "PERFECT · WHITE STARBURST"
        if kind == "level":
            reach = min(17, int(age / 0.85 * 18))
            for index in range(reach):
                frame[index] = stage_bright
            if age >= 0.85:
                frame[:] = [stage_bright] * LED_COUNT
                if age < 1.3:
                    radius = int((age - 0.85) * 22)
                    for index in range(LED_COUNT):
                        if abs(index - 8) <= radius:
                            frame[index] = CHAMPAGNE
                elif age < 1.95:
                    frame[min(16, int((age - 1.3) / 0.65 * 17))] = WHITE
            if reach < 17:
                frame[max(0, reach - 1)] = WHITE
            return "JACKPOT · COLOUR WIPE"
        if kind == "point":
            colour = CYAN if self.cue_side == 0 else PINK
            front = min(16, int(age / 1.1 * 17))
            for index in range(LED_COUNT):
                position = index if self.cue_side == 0 else 16 - index
                if position <= front:
                    frame[index] = WHITE if position == front else colour
            if age >= 1.1:
                beat = int((age - 1.1) / 0.18) % 2
                frame[:] = [dim(colour, 0.55) if beat else colour] * LED_COUNT
                frame[0 if self.cue_side == 0 else 16] = WHITE
            return "POINT · EDGE WAVE"
        if age < 0.8:
            radius = int(age / 0.8 * 9)
            for index in range(LED_COUNT):
                if abs(index - 8) <= radius:
                    frame[index] = WHITE if abs(index - 8) == radius else GOLD
        elif age < 3.15:
            palette = (bright(CYAN), bright(STAGES[1]), bright(STAGES[2]), GOLD, bright(PINK))
            shift = int((age - 0.8) * 8)
            for index in range(LED_COUNT):
                frame[index] = WHITE if (index + shift) % 5 == 0 else palette[((index + shift) // 2) % len(palette)]
        else:
            frame[:] = [CHAMPAGNE if math.sin((age - 3.15) * math.pi * 5) > 0 else GOLD] * LED_COUNT
            frame[8] = WHITE
        return "FINAL · RAINBOW FINALE"

    def frame(self):
        now = self.paused_at if self.paused_at is not None else self.clock()
        stage = STAGES[self.level_index]
        frame = [dim(stage, 0.5)] * LED_COUNT
        frame[0], frame[1] = CYAN, dim(CYAN, 0.48)
        frame[15], frame[16] = dim(PINK, 0.48), PINK
        if self.phase == "rally" and self.active:
            frame[max(1, min(15, round(self.ball)))] = WHITE
        elif self.phase == "ready" and self.active:
            for index in range(max(0, 3 - int((now - self.phase_started) / 0.5))):
                frame[7 + index] = WHITE
        pattern = self._pattern(frame, now, stage)
        return clean_frame(frame), pattern

    def status(self):
        frame, pattern = self.frame()
        now = self.paused_at if self.paused_at is not None else self.clock()
        return {
            "active": self.active, "preview": bool(self.preview_kind), "preview_kind": self.preview_kind,
            "session_id": self.session_id, "mode": self.mode, "phase": self.phase,
            "input_source": self.input_source, "action_buttons": list(self.action_buttons),
            "gamepad_indices": list(self.gamepad_indices), "input_connected": self.input_connected,
            "scores": list(self.scores), "lives": self.lives, "jokers": list(self.jokers),
            "returns": self.returns,
            "streak": self.streak, "best_streak": self.best_streak, "level": self.level_index + 1,
            "ball": self.ball, "direction": self.direction, "winner": self.winner,
            "paused": self.paused_at is not None, "pause_reason": self.pause_reason,
            "feedback_seq": self.feedback_seq, "feedback_player": self.feedback_player,
            "feedback_kind": self.feedback_kind, "cue": self.preview_kind or self.cue,
            "cue_age_ms": max(0, round((now - self.cue_at) * 1000)), "cue_side": self.cue_side,
            "colors": [list(pixel) for pixel in frame], "pattern": pattern,
            "message": self.message,
        }
