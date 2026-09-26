import { callable } from "@decky/api";
import type { Mode, Pattern, PongStatus, PressResult, Source } from "./types";

export const getStatus = callable<[], PongStatus>("get_status");
export const startGame = callable<[Mode, number[], Source, number[]], PongStatus>("start_game");
export const stopGame = callable<[], PongStatus>("stop_game");
export const previewPattern = callable<[Pattern], PongStatus>("preview_pattern");
export const stopPreview = callable<[], PongStatus>("stop_preview");
export const press = callable<[number, number], PressResult>("press");
export const pingInput = callable<[], boolean>("ping_input");
export const heartbeat = callable<[], boolean>("heartbeat");
export const setInputState = callable<[number, boolean], PongStatus>("set_input_state");
export const setGameRunning = callable<[boolean], PongStatus>("set_game_running");
export const setPaused = callable<[boolean], PongStatus>("set_paused");
export const setSetting = callable<["vibration_enabled" | "reverse_led_order", boolean], PongStatus>("set_setting");
export interface HidOutput { id: string; node: string; label: string; product: number; interface: number | null }
export interface HidPulseResult { result: string; writes: number }
export const listHidOutputs = callable<[], HidOutput[]>("list_hid_outputs");
export const pulseHidOutput = callable<[string, string], HidPulseResult>("pulse_hid_output");
