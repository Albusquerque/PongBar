import { Router } from "@decky/ui";
import { getStatus, pingInput, press, pulseHidOutput, setGameRunning, setInputState } from "./api";
import type { Device, Diagnostic, HapticProbe, PongStatus, PressResult } from "./types";

type SteamControllerInfo = { nControllerIndex: number; strName: string; eControllerType: number;
  eRumblePreference: number; bHaptics: boolean };
declare const SteamClient: {
  Input?: { RegisterForControllerInputMessages?: (
    callback: (index: number, button: number, pressed: boolean) => void,
  ) => { unregister?: () => void } | undefined;
    RegisterForControllerListChanges?: (
      callback: (controllers: SteamControllerInfo[]) => void,
    ) => { unregister?: () => void } | undefined;
    TriggerSimpleHapticEvent?: (controllerIndex: number, hapticType: number,
      intensity: number, gain: number, otherIntensity: number) => unknown };
} | undefined;

type HapticActuator = { playEffect?: (type: "dual-rumble", options: {
  duration: number; strongMagnitude: number; weakMagnitude: number;
}) => Promise<unknown>; effects?: readonly string[] };
type DiagnosticRecord = Diagnostic & { samples: number[] };
type ButtonCapture = { source: "steam" | "browser"; index: number; readyAt: number;
  resolve: (button: number) => void; reject: (reason: Error) => void; timer: number };

function browserPads(): (Gamepad | null)[] {
  try { return Array.from(navigator.getGamepads?.() ?? []); }
  catch { return []; }
}

class PongInputs {
  private alive = false;
  private screenOpen = false;
  private status: PongStatus | null = null;
  private steamHook: { unregister?: () => void } | undefined;
  private steamListHook: { unregister?: () => void } | undefined;
  private steamControllerInfo = new Map<number, SteamControllerInfo>();
  private steamAvailable = false;
  private steamDevices = new Map<number, Device & { seenAt: number }>();
  private heldSteam = new Set<string>();
  private heldBrowser = new Map<string, boolean>();
  private capture: ButtonCapture | null = null;
  private records = new Map<string, DiagnosticRecord>();
  private hapticProbes = new Map<string, HapticProbe>();
  private hidAssignments: (string | null)[] = [null, null];
  private pollTimer: number | undefined;
  private statusTimer: number | undefined;
  private appTimer: number | undefined;
  private statusPending = false;
  private lastConnection = "";
  private lastRunning = false;

  start() {
    if (this.alive) return;
    this.alive = true;
    this.ensureSteamHook();
    this.pollTimer = window.setInterval(() => this.readBrowser(), 25);
    this.appTimer = window.setInterval(() => this.detectRunningGame(), 2000);
    this.detectRunningGame();
    void this.refresh();
  }

  stop() {
    this.alive = false;
    window.clearInterval(this.pollTimer);
    window.clearTimeout(this.statusTimer);
    window.clearInterval(this.appTimer);
    this.steamHook?.unregister?.();
    this.steamListHook?.unregister?.();
    this.steamHook = undefined;
    this.steamListHook = undefined;
    this.steamAvailable = false;
    this.heldSteam.clear();
    this.heldBrowser.clear();
    this.cancelCapture();
  }

  setScreenOpen(open: boolean) {
    this.screenOpen = open;
    if (!open) this.cancelCapture();
  }

  captureNextButton(source: "steam" | "browser", index: number): Promise<number> {
    this.cancelCapture();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (this.capture?.timer === timer) {
          this.capture = null;
          reject(new Error("No button received. Press the controller button and try again."));
        }
      }, 12000);
      this.capture = { source, index, readyAt: performance.now() + 350, resolve, reject, timer };
    });
  }

  cancelCapture() {
    const capture = this.capture;
    if (!capture) return;
    this.capture = null;
    window.clearTimeout(capture.timer);
    capture.reject(new Error("Button capture cancelled."));
  }

  private acceptCapture(source: "steam" | "browser", index: number, button: number): boolean {
    const capture = this.capture;
    if (!capture || capture.source !== source || capture.index !== index ||
        performance.now() < capture.readyAt) return false;
    this.capture = null;
    window.clearTimeout(capture.timer);
    capture.resolve(button);
    return true;
  }

  snapshot(): { steamAvailable: boolean; browserAvailable: boolean; devices: Device[];
    diagnostics: Diagnostic[]; hapticProbes: HapticProbe[]; steamHapticsAvailable: boolean } {
    const now = Date.now();
    const steam = [...this.steamDevices.values()].filter((device) => now - device.seenAt < 5 * 60_000)
      .map(({ seenAt: _seenAt, ...device }) => {
        const info = this.steamControllerInfo.get(device.index);
        return { ...device, name: info?.strName || device.name,
          haptics: info?.bHaptics ?? false, hapticsReported: info?.bHaptics,
          rumblePreference: info?.eRumblePreference, controllerType: info?.eControllerType };
      });
    const browser = browserPads().filter((pad): pad is Gamepad => Boolean(pad?.connected))
      .map((pad) => ({ source: "browser" as const, index: pad.index, name: pad.id.slice(0, 70) || `Controller ${pad.index + 1}`,
        lastButton: pad.buttons.findIndex((button) => button.pressed),
        pressed: pad.buttons.some((button) => button.pressed),
        haptics: Boolean((pad as Gamepad & { vibrationActuator?: HapticActuator }).vibrationActuator?.playEffect) }));
    return { steamAvailable: this.steamAvailable, browserAvailable: typeof navigator.getGamepads === "function",
      steamHapticsAvailable: typeof SteamClient !== "undefined" &&
        typeof SteamClient?.Input?.TriggerSimpleHapticEvent === "function",
      hapticProbes: [...this.hapticProbes.values()],
      devices: [...steam, ...browser], diagnostics: [...this.records.values()]
        .map(({ samples: _samples, ...record }) => record)
        .sort((a, b) => b.lastAt - a.lastAt) };
  }

  resetDiagnostics() { this.records.clear(); }
  setHidAssignments(assignments: (string | null)[]) {
    this.hidAssignments = assignments.slice(0, 2);
  }

  private measure<T>(source: Diagnostic["source"], index: number, button: number,
                     request: Diagnostic["request"], call: () => Promise<T>): Promise<T> {
    const key = `${source}:${index}`;
    let record = this.records.get(key);
    if (!record) {
      record = { source, index, button, request, count: 0, lastMs: null, averageMs: null,
        maxMs: null, lastAt: 0, failures: 0, error: "", accepted: null, samples: [] };
      this.records.set(key, record);
    }
    record.count++;
    record.button = button;
    record.request = request;
    record.lastAt = Date.now();
    const started = performance.now();
    return Promise.resolve().then(call).then((value) => {
      const elapsed = performance.now() - started;
      record!.samples.push(elapsed);
      if (record!.samples.length > 20) record!.samples.shift();
      record!.lastMs = elapsed;
      record!.averageMs = record!.samples.reduce((sum, sample) => sum + sample, 0) / record!.samples.length;
      record!.maxMs = Math.max(...record!.samples);
      record!.error = "";
      if (request === "hit") {
        const hit = value as PressResult;
        record!.accepted = hit.accepted;
        this.applyStatus(hit.status);
      }
      return value;
    }, (error: unknown) => {
      record!.failures++;
      record!.error = error instanceof Error ? error.message : String(error);
      throw error;
    });
  }

  probe() { return this.measure("manual", -1, -1, "probe", pingInput); }

  async tryVibration(source: "steam" | "browser", index: number, kind = "test", player = 0): Promise<HapticProbe> {
    const probe: HapticProbe = { source, index, path: source === "steam" ? "Steam Controller 2026 HID rumble" :
      "Browser Gamepad dual-rumble", available: false, attempted: false, result: "", at: Date.now() };
    try {
      if (source === "steam") {
        const output = this.hidAssignments[player];
        if (!output) {
          probe.result = "Select a Steam Controller 2026 HID output below first.";
        } else {
          probe.available = true;
          probe.attempted = true;
          const returned = await pulseHidOutput(output, kind);
          probe.apiReturn = `${returned.writes} reports`;
          probe.result = returned.result;
        }
      } else {
        const pad = browserPads()[index] as Gamepad & { vibrationActuator?: HapticActuator } | null;
        const actuator = pad?.connected ? pad.vibrationActuator : undefined;
        if (!actuator?.playEffect || (actuator.effects && !actuator.effects.includes("dual-rumble"))) {
          probe.result = "No dual-rumble actuator is exposed by SteamUI's browser.";
        } else {
          probe.available = true;
          probe.attempted = true;
          const result = await actuator.playEffect("dual-rumble", {
            duration: kind === "winner" ? 220 : kind === "test" ? 300 : 120,
            strongMagnitude: kind === "test" ? .7 : .48,
            weakMagnitude: kind === "test" ? .45 : .25,
          });
          probe.apiReturn = result === undefined ? "undefined" : String(result).slice(0, 80);
          probe.result = result === "preempted" ? "Effect interrupted by another command." :
            "Browser effect returned; physical vibration unconfirmed.";
        }
      }
    } catch (error) {
      probe.result = `Haptic command failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.hapticProbes.set(`${source}:${index}`, probe);
    return probe;
  }

  pressTouch(sessionId: number, player: number) {
    return this.measure("touch", player, -1, "hit", () => press(sessionId, player));
  }

  private ensureSteamHook() {
    if (!this.alive) return;
    try {
      const input = typeof SteamClient === "undefined" ? undefined : SteamClient?.Input;
      if (!this.steamAvailable) {
        const register = input?.RegisterForControllerInputMessages;
        if (typeof register === "function") {
          this.steamHook = register.call(input, (index, button, pressed) => this.onSteamButton(index, button, pressed));
          this.steamAvailable = true;
        }
      }
      if (!this.steamListHook && typeof input?.RegisterForControllerListChanges === "function") {
        this.steamListHook = input.RegisterForControllerListChanges((controllers) => {
          if (!Array.isArray(controllers)) return;
          this.steamControllerInfo = new Map(controllers.filter((item) =>
            item && Number.isInteger(item.nControllerIndex)).map((item) => [item.nControllerIndex, item]));
        });
      }
    } catch { /* SteamUI may expose this hook after plugin startup. */ }
  }

  private onSteamButton(index: number, button: number, rawPressed: boolean | number) {
    if (!this.alive || !Number.isInteger(index) || index < 0 || index >= 0xffffffff ||
        !Number.isInteger(button) || button < 0 || button > 255 ||
        ![true, false, 0, 1].includes(rawPressed)) return;
    const pressed = Boolean(rawPressed);
    const info = this.steamControllerInfo.get(index);
    this.steamDevices.set(index, { source: "steam", index, name: info?.strName || `Steam controller ${index + 1}`,
      lastButton: button, pressed, haptics: info?.bHaptics ?? false, seenAt: Date.now() });
    const key = `${index}:${button}`;
    const wasHeld = this.heldSteam.has(key);
    if (pressed) this.heldSteam.add(key);
    else this.heldSteam.delete(key);
    if (!pressed || wasHeld) return;
    if (this.acceptCapture("steam", index, button)) return;
    const status = this.status;
    const player = status?.gamepad_indices.indexOf(index) ?? -1;
    if (status?.active && !status.paused && status.input_source === "steam" &&
        player >= 0 && button === status.action_buttons[player]) {
      void this.measure("steam", index, button, "hit", () => press(status.session_id, player)).catch(() => undefined);
    } else if (this.screenOpen && !status?.active) {
      void this.measure("steam", index, button, "probe", pingInput).catch(() => undefined);
    }
  }

  private readBrowser() {
    if (!this.alive) return;
    const status = this.status;
    const present = new Set<string>();
    for (const pad of browserPads()) {
      if (!pad?.connected) continue;
      for (let button = 0; button < pad.buttons.length; button++) {
        const key = `${pad.index}:${button}`;
        present.add(key);
        const pressed = Boolean(pad.buttons[button]?.pressed || (pad.buttons[button]?.value ?? 0) > .75);
        const wasHeld = this.heldBrowser.get(key) ?? pressed;
        this.heldBrowser.set(key, pressed);
        if (!pressed || wasHeld) continue;
        if (this.acceptCapture("browser", pad.index, button)) continue;
        const player = status?.gamepad_indices.indexOf(pad.index) ?? -1;
        if (status?.active && !status.paused && status.input_source === "browser" && player >= 0 &&
            button === status.action_buttons[player]) {
          void this.measure("browser", pad.index, button, "hit", () => press(status.session_id, player))
            .catch(() => undefined);
        } else if (this.screenOpen && !status?.active) {
          void this.measure("browser", pad.index, button, "probe", pingInput).catch(() => undefined);
        }
      }
    }
    for (const key of this.heldBrowser.keys()) if (!present.has(key)) this.heldBrowser.delete(key);
  }

  applyStatus(status: PongStatus) {
    if (this.status?.session_id === status.session_id &&
        status.feedback_seq < this.status.feedback_seq) return;
    if (this.status?.session_id === status.session_id &&
        this.status.feedback_seq < status.feedback_seq && status.vibration_enabled &&
        status.input_source !== "touch" && status.feedback_player >= 0) {
      const index = status.gamepad_indices[status.feedback_player];
      if (index !== undefined) void this.tryVibration(status.input_source, index,
        status.feedback_kind, status.feedback_player);
    }
    this.status = status;
  }

  private async refresh() {
    if (!this.alive || this.statusPending) return;
    this.statusPending = true;
    try {
      this.ensureSteamHook();
      const status = await getStatus();
      if (!this.alive) return;
      this.applyStatus(status);
      if (status.active && status.input_source === "browser") {
        const devices = this.snapshot().devices.filter((item) => item.source === status.input_source);
        const connected = status.gamepad_indices.every((index) => devices.some((item) => item.index === index));
        const key = `${status.session_id}:${connected}`;
        if (key !== this.lastConnection) {
          this.lastConnection = key;
          this.applyStatus(await setInputState(status.session_id, connected));
        }
      } else this.lastConnection = "";
    } catch { /* Keep trying while Decky starts or reloads. */ }
    finally {
      this.statusPending = false;
      if (this.alive) this.statusTimer = window.setTimeout(() => void this.refresh(), this.status?.active ? 180 : 700);
    }
  }

  private detectRunningGame() {
    try {
      const app = Router?.MainRunningApp as { appid?: number | string; appID?: number | string } | undefined;
      const running = Number(app?.appid ?? app?.appID ?? 0) > 0;
      if (running !== this.lastRunning) {
        this.lastRunning = running;
        void setGameRunning(running).then((status) => this.applyStatus(status)).catch(() => undefined);
      }
    } catch { /* Steam router may not be ready yet. */ }
  }
}

export const pongInputs = new PongInputs();
