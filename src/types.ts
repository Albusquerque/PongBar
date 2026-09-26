export type RGB = [number, number, number];
export type Mode = "solo" | "duel";
export type Source = "touch" | "steam" | "browser";
export type Pattern = "perfect" | "level" | "point" | "winner";

export interface PongStatus {
  version: string;
  active: boolean;
  preview: boolean;
  preview_kind: Pattern | "";
  session_id: number;
  mode: Mode | "";
  phase: "idle" | "ready" | "rally" | "point" | "level" | "finished";
  input_source: Source;
  action_buttons: number[];
  gamepad_indices: number[];
  input_connected: boolean;
  scores: number[];
  lives: number;
  jokers: number[];
  returns: number;
  streak: number;
  best_streak: number;
  level: number;
  ball: number;
  direction: number;
  winner: number;
  paused: boolean;
  pause_reason: string;
  feedback_seq: number;
  feedback_player: number;
  feedback_kind: string;
  cue: string;
  cue_age_ms: number;
  cue_side: number;
  colors: RGB[];
  pattern: string;
  message: string;
  hardware_available: boolean;
  hardware_owner: "free" | "PongBar" | "other";
  hardware_error: string;
  led_write_ms: number | null;
  led_write_pending: boolean;
  led_write_count: number;
  game_running: boolean;
  vibration_enabled: boolean;
  reverse_led_order: boolean;
}

export interface PressResult { accepted: boolean; status: PongStatus }

export interface Device {
  source: "steam" | "browser";
  index: number;
  name: string;
  lastButton: number;
  pressed: boolean;
  haptics: boolean;
  rumblePreference?: number;
  controllerType?: number;
  hapticsReported?: boolean;
}

export interface Diagnostic {
  source: "steam" | "browser" | "touch" | "manual";
  index: number;
  button: number;
  request: "hit" | "probe";
  count: number;
  lastMs: number | null;
  averageMs: number | null;
  maxMs: number | null;
  lastAt: number;
  failures: number;
  error: string;
  accepted: boolean | null;
}

export interface HapticProbe {
  source: "steam" | "browser";
  index: number;
  path: string;
  available: boolean;
  attempted: boolean;
  result: string;
  apiReturn?: string;
  at: number;
}
