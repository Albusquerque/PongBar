import { definePlugin, routerHook } from "@decky/api";
import { Button as DeckyButton, ButtonItem, Dropdown, Focusable, Navigation, NavEntryPositionPreferences, PanelSection, PanelSectionRow, staticClasses } from "@decky/ui";
import type { ButtonProps } from "@decky/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import { getStatus, heartbeat, listHidOutputs, previewPattern, pulseHidOutput, setPaused, setSetting, startGame, stopGame, stopPreview } from "./api";
import type { HidOutput } from "./api";
import { PongAudio } from "./audio";
import { Matrix } from "./components/Matrix";
import { pongInputs } from "./input";
import { styles } from "./styles";
import type { Device, Mode, Pattern, PongStatus, Source } from "./types";

const STAGE_COLORS = ["#56d8d1", "#649eff", "#bd79f5", "#ffa64c", "#ff6759"];
const PATTERNS: { key: Pattern; title: string; detail: string }[] = [
  { key: "perfect", title: "Perfect return", detail: "Symmetric white starburst" },
  { key: "level", title: "Jackpot · new colour", detail: "Colour wipe and level up" },
  { key: "point", title: "Point scored", detail: "Wave from the scorer's side" },
  { key: "winner", title: "Final celebration", detail: "Rainbow sweep and golden finale" },
];
type Snapshot = ReturnType<typeof pongInputs.snapshot>;

function Button({ className = "", onGamepadFocus, onGamepadBlur, ...props }: ButtonProps) {
  const [focused, setFocused] = useState(false);
  return <DeckyButton {...props} className={`${className}${focused ? " pb-gamepad-focus" : ""}${props.disabled ? " pb-disabled" : ""}`}
    onGamepadFocus={(event) => { setFocused(true); onGamepadFocus?.(event); }}
    onGamepadBlur={(event) => { setFocused(false); onGamepadBlur?.(event); }} />;
}

function Logo() {
  return <div className="pb-brand"><div className="pb-brand-icon" aria-hidden="true">
    {Array.from({ length: 20 }, (_, index) => <i key={index} />)}
  </div><div><h1>Pong<span>Bar</span></h1><p className="pb-subtitle">1D PONG · 17 LED ARCADE · VERSION 0.1.0</p></div></div>;
}

function Rail({ status }: { status: PongStatus }) {
  return <div className="pb-rail-panel">
    <div className="pb-rail-header"><div><span>Steam Machine light bar</span><strong>17 LEDs · live signal</strong></div>
      <div className="pb-rail-pattern">{status.pattern || "Rally in progress"}</div></div>
    <div className="pb-rail" role="img" aria-label={`PongBar 1D Pong light bar, ${status.pattern || status.phase}`}>
      {status.colors.map((color, index) => {
        const lit = color.some((channel) => channel > 12);
        const rgb = `rgb(${color.join(",")})`;
        return <i key={index} style={{ background: lit ? rgb : "#233943",
          boxShadow: lit ? `0 0 12px ${rgb}` : "none" }} />;
      })}
    </div>
    <div className="pb-rail-scale"><span>P1 · LEFT</span><span>LED 9 · CENTRE</span><span>P2 · RIGHT</span></div>
  </div>;
}

function App() {
  const [status, setStatus] = useState<PongStatus | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>(() => pongInputs.snapshot());
  const [mode, setMode] = useState<Mode>("solo");
  const [source, setSource] = useState<"steam" | "browser">("steam");
  const [buttons, setButtons] = useState<Record<string, number>>({});
  const [learning, setLearning] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [right, setRight] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hapticMessage, setHapticMessage] = useState("");
  const [hidOutputs, setHidOutputs] = useState<HidOutput[]>([]);
  const [hidSelections, setHidSelections] = useState<(string | null)[]>([null, null]);
  const [musicMessage, setMusicMessage] = useState("");
  const [effectsEnabled, setEffectsEnabled] = useState(true);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const audioRef = useRef<PongAudio | null>(null);
  if (!audioRef.current) audioRef.current = new PongAudio();
  const audio = audioRef.current;
  const statusRef = useRef<PongStatus | null>(null);
  statusRef.current = status;

  useEffect(() => {
    pongInputs.setScreenOpen(true);
    let alive = true;
    let pending = false;
    const refresh = () => {
      if (pending) return;
      pending = true;
      void getStatus().then((next) => {
        if (!alive) return;
        setStatus(next);
        pongInputs.applyStatus(next);
        audio.onStatus(next);
      }).catch((reason) => { if (alive) setError(String(reason)); })
        .finally(() => { pending = false; });
    };
    void heartbeat().catch(() => undefined);
    refresh();
    const statusTimer = window.setInterval(refresh, 100);
    const deviceTimer = window.setInterval(() => setSnapshot(pongInputs.snapshot()), 160);
    const heartbeatTimer = window.setInterval(() => void heartbeat().catch(() => undefined), 2000);
    return () => {
      alive = false;
      pongInputs.setScreenOpen(false);
      audio.dispose();
      window.clearInterval(statusTimer);
      window.clearInterval(deviceTimer);
      window.clearInterval(heartbeatTimer);
      if (statusRef.current?.preview) void stopPreview().catch(() => undefined);
    };
  }, [audio]);
  useEffect(() => {
    let alive = true;
    const refresh = () => void listHidOutputs().then((items) => {
      if (alive) setHidOutputs(items);
    }).catch(() => { if (alive) setHidOutputs([]); });
    refresh();
    const timer = window.setInterval(refresh, 1600);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  const hit = useCallback((player: number) => {
    const current = statusRef.current;
    if (!current?.active || current.input_source !== "touch") return;
    void pongInputs.pressTouch(current.session_id, player).then((result) => {
      setStatus(result.status);
      if (!result.accepted) setError(result.status.message);
      else setError("");
    }).catch((reason) => setError(String(reason)));
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      if ((event.target as HTMLElement | null)?.closest("button,select,input,textarea")) return;
      if (event.code === "Space") { event.preventDefault(); hit(0); }
      if (event.code === "Enter" && statusRef.current?.mode === "duel") { event.preventDefault(); hit(1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hit]);

  const devices = snapshot.devices.filter((device) => device.source === source);
  const player1 = left != null && devices.some((device) => device.index === left) ? left : devices[0]?.index ?? null;
  const player2 = right != null && right !== player1 && devices.some((device) => device.index === right) ? right :
    devices.find((device) => device.index !== player1)?.index ?? null;
  const output1 = hidOutputs.find((item) => item.id === hidSelections[0])?.id ??
    (hidOutputs.length === 1 ? hidOutputs[0].id : null);
  const output2 = hidOutputs.find((item) => item.id === hidSelections[1] && item.id !== output1)?.id ?? null;
  useEffect(() => { pongInputs.setHidAssignments([output1, output2]); }, [output1, output2]);
  const controllerReady = player1 !== null && (mode === "solo" || player2 !== null) &&
    (source === "steam" ? snapshot.steamAvailable : snapshot.browserAvailable) &&
    (source === "steam" || (buttons[`${source}:${player1}`] !== undefined &&
      (mode === "solo" || buttons[`${source}:${player2}`] !== undefined)));
  const canStart = !busy && !learning && !status?.active && !status?.game_running;

  const learn = async (index: number | null) => {
    if (index === null || learning || status?.active) return;
    const key = `${source}:${index}`;
    setLearning(key);
    setError("");
    try {
      const code = await pongInputs.captureNextButton(source, index);
      setButtons((current) => ({ ...current, [key]: code }));
    } catch (reason) {
      if (String(reason) !== "Error: Button capture cancelled.") setError(String(reason));
    } finally { setLearning(null); }
  };

  const start = async (chosenSource: Source) => {
    if (!canStart) return;
    setBusy(true);
    setError("");
    audio.play("start");
    void audio.startMusic().then(setMusicMessage);
    try {
      const indices = chosenSource === "touch" ? [] : mode === "solo" ? [player1!] : [player1!, player2!];
      const actionButtons = chosenSource === "touch" ? [] : indices.map((index) =>
        buttons[`${chosenSource}:${index}`] ?? (chosenSource === "steam" ? 0 : -1));
      const next = await startGame(mode, indices, chosenSource, actionButtons);
      setStatus(next);
      pongInputs.applyStatus(next);
      audio.onStatus(next);
    } catch (reason) { audio.stopMusic(); setError(String(reason)); }
    finally { setBusy(false); }
  };
  const change = async (key: "vibration_enabled" | "reverse_led_order", value: boolean) => {
    try { const next = await setSetting(key, value); setStatus(next); setError(""); }
    catch (reason) { setError(String(reason)); }
  };
  const preview = async (kind: Pattern) => {
    if (status?.active) return;
    try { const next = await previewPattern(kind); setStatus(next); audio.play(kind === "perfect" ? "perfect" :
      kind === "level" ? "level" : kind === "point" ? "point" : "winner"); setError(""); }
    catch (reason) { setError(String(reason)); }
  };
  const finish = async () => {
    try { const next = await stopGame(); audio.stopMusic(); setStatus(next); setError(""); }
    catch (reason) { setError(String(reason)); }
  };
  const pause = async () => {
    if (!status) return;
    try { const next = await setPaused(!status.paused); setStatus(next); audio.play("pause"); setError(""); }
    catch (reason) { setError(String(reason)); }
  };

  return <Focusable className="pb-app" navEntryPreferPosition={NavEntryPositionPreferences.PREFERRED_CHILD}>
    <style>{styles}</style><div className="pb-grid-bg" />
    <div className="pb-shell">
      <header className="pb-header"><Logo /><div className="pb-header-right">
        <span className="pb-tag">VERSION 0.1.0</span>
        <Button className="pb-back" onClick={() => Navigation.NavigateBack()}>← Back to Steam</Button>
      </div></header><div className="pb-topline" />
      {!status ? <div className="pb-card">{error || "Loading PongBar…"}</div> : <>
      <main className="pb-main">
        <section className="pb-stage" aria-label="PongBar 1D Pong playfield">
          <div className="pb-stage-heading"><div><span className="pb-kicker">1D PONG ON THE LIGHT BAR</span>
            <h2>One dimension. Seventeen lights.</h2>
            <p>Return the white ball at the cyan end. This is Pong compressed into one dimension: every five returns, the colour changes and the ball speeds up.</p>
          </div><span className={`pb-state-chip${status.hardware_owner === "other" ? " pb-alert" : ""}`}>
            <i />{status.preview ? "LOOPING PREVIEW" : status.paused ? "PAUSED" :
              status.active ? "GAME IN PROGRESS" : status.phase === "finished" ? "GAME OVER" : "READY TO PLAY"}
          </span></div>
          <Matrix status={status} />
          <Rail status={status} />
          <div className="pb-stage-foot"><span>{status.message}</span>
            <span>{status.hardware_available ? status.hardware_owner === "other" ? "Light bar in use" : "Physical light bar detected" : "Screen mode · physical light bar absent"}</span></div>
          {status.hardware_owner === "other" ? <div className="pb-hardware-warn">{status.hardware_error}</div> : null}
        </section>

        <aside className="pb-side">
          <section className="pb-card"><div className="pb-card-title"><h3>Score & progress</h3><span>{status.mode === "duel" ? "FIRST TO 5" : "3 LIVES"}</span></div>
            <div className="pb-score-grid">
              <div className="pb-score"><small>{status.mode === "duel" ? "Player 1" : "Returns"}</small>
                <strong>{String(status.mode === "duel" ? status.scores[0] : status.returns).padStart(2, "0")}</strong></div>
              <div className="pb-score"><small>{status.mode === "duel" ? "Player 2" : "Lives"}</small>
                <strong>{String(status.mode === "duel" ? status.scores[1] : status.lives).padStart(2, "0")}</strong></div>
              <div className="pb-score"><small>Level</small><strong>{String(status.level).padStart(2, "0")}</strong></div>
            </div>
            <div className="pb-level-track">{STAGE_COLORS.map((color, index) => <i key={color}
              className={status.level === index + 1 ? "pb-current" : ""}
              style={{ background: color, color }} />)}<span>01 → 05</span></div>
            <div className="pb-inline-badges"><span>Best streak · {status.best_streak}</span>
              <span>Current streak · {status.streak}</span>
              {status.mode === "duel" && status.winner >= 0 ? <span>Winner · P{status.winner + 1}</span> : null}</div>
            <div className="pb-jokers" aria-label="Early press jokers">
              <span>P1 JOKERS</span><strong>{"◆".repeat(status.jokers?.[0] ?? 3)}<i>{"◇".repeat(3 - (status.jokers?.[0] ?? 3))}</i></strong>
              {status.mode === "duel" ? <><span>P2 JOKERS</span>
                <strong>{"◆".repeat(status.jokers?.[1] ?? 3)}<i>{"◇".repeat(3 - (status.jokers?.[1] ?? 3))}</i></strong></> : null}
            </div>
            <p className="pb-control-hint">An early press uses one joker. With none left, the next early press costs a life or gives your opponent a point.</p>
          </section>

          <Focusable className="pb-card" navEntryPreferPosition={NavEntryPositionPreferences.PREFERRED_CHILD}>
            <div className="pb-card-title"><h3>New game</h3><span>SOLO OR DUEL</span></div>
            <div className="pb-segment" role="group" aria-label="Game mode">
              <Button className={`pb-mode${mode === "solo" ? " pb-selected" : ""}`} disabled={status.active}
                onClick={() => setMode("solo")}>Solo · 3 lives</Button>
              <Button className={`pb-mode${mode === "duel" ? " pb-selected" : ""}`} disabled={status.active}
                onClick={() => setMode("duel")}>Duel · first to 5</Button>
            </div>
            <div className="pb-field">CONTROLLER INPUT
              <Dropdown rgOptions={[{ data: "steam", label: "Steam input events" }, { data: "browser", label: "Browser Gamepad" }]}
                selectedOption={source} disabled={status.active} onChange={(option) => {
                  pongInputs.cancelCapture(); setSource(option.data as "steam" | "browser"); setLeft(null); setRight(null);
                }} />
            </div>
            <div className="pb-field">PLAYER 1 · CYAN SIDE
              <Dropdown rgOptions={devices.length ? devices.map((device) => ({ data: device.index,
                label: `${device.name} · #${device.index + 1}` })) : [{ data: -1, label: "No controller detected" }]}
                selectedOption={player1 ?? -1} disabled={status.active || devices.length === 0}
                onChange={(option) => setLeft(Number(option.data))} />
            </div>
            <div className="pb-calibration"><Button className="pb-button pb-quiet" disabled={status.active || player1 === null || Boolean(learning)}
              onClick={() => void learn(player1)}>{learning === `${source}:${player1}` ? "Press P1's button…" : "Change P1 button"}</Button>
              <span>{player1 === null ? "Waiting for controller" : buttons[`${source}:${player1}`] === undefined ?
                source === "steam" ? "A · ready by default" : "Button setup needed" :
                `Button ${buttons[`${source}:${player1}`]} ready`}</span></div>
            {mode === "duel" ? <div className="pb-field">PLAYER 2 · PINK SIDE
              <Dropdown rgOptions={devices.length < 2 ? [{ data: -1, label: "Waiting for second controller" }] :
                devices.filter((device) => device.index !== player1).map((device) => ({ data: device.index,
                  label: `${device.name} · #${device.index + 1}` }))}
                selectedOption={player2 ?? -1} disabled={status.active || devices.length < 2}
                onChange={(option) => setRight(Number(option.data))} />
            </div> : null}
            {mode === "duel" ? <div className="pb-calibration"><Button className="pb-button pb-quiet" disabled={status.active || player2 === null || Boolean(learning)}
              onClick={() => void learn(player2)}>{learning === `${source}:${player2}` ? "Press P2's button…" : "Change P2 button"}</Button>
              <span>{player2 === null ? "Waiting for second controller" : buttons[`${source}:${player2}`] === undefined ?
                source === "steam" ? "A · ready by default" : "Button setup needed" :
                `Button ${buttons[`${source}:${player2}`]} ready`}</span></div> : null}
            <p className="pb-control-hint">{source === "steam" ? snapshot.steamAvailable ?
              devices.length === 0 ? "Press A once on each controller to detect it. A is the default return button." :
                `${devices.length} controller${devices.length > 1 ? "s" : ""} seen through SteamUI. A returns the ball; you can change that button.` :
              "Steam input events are unavailable here. Try Browser Gamepad or on-screen play." :
              devices.length ? `${devices.length} Browser Gamepad controller${devices.length > 1 ? "s" : ""} available. Set one button per player.` :
                "No Browser Gamepad exposed. Press a controller button; SteamUI may also block this API."}</p>
            <div className="pb-actions">
              <Button className="pb-button pb-primary" preferredFocus disabled={!canStart || !controllerReady}
                onClick={() => void start(source)}>Play with controller</Button>
              <Button className="pb-button" disabled={!canStart} onClick={() => void start("touch")}>
                Play on screen</Button>
            </div>
            {status.active ? <div className="pb-actions">
              {status.input_source === "touch" ? <><Button className="pb-button pb-primary" onClick={() => hit(0)}>Return left · Space</Button>
                {status.mode === "duel" ? <Button className="pb-button pb-rose" onClick={() => hit(1)}>Return right · Enter</Button> : null}</> : null}
              <Button className="pb-button pb-quiet" disabled={status.hardware_owner === "other"}
                onClick={() => void pause()}>{status.paused ? "Resume" : "Pause"}</Button>
              <Button className="pb-button pb-quiet" onClick={() => void finish()}>End game</Button>
            </div> : null}
            {error ? <div className="pb-message pb-error" role="alert">{error}</div> : null}
            {status.game_running ? <div className="pb-message pb-error">Close the running Steam game to start PongBar.</div> : null}
          </Focusable>

          <section className="pb-card"><div className="pb-card-title"><h3>Pinball sequences</h3><span>LED PREVIEWS</span></div>
            <div className="pb-patterns">{PATTERNS.map((pattern) => <Button key={pattern.key}
              className={`pb-pattern-card${status.preview_kind === pattern.key ? " pb-current" : ""}`}
              disabled={status.active || status.game_running} onClick={() => void preview(pattern.key)}>
              <strong>{pattern.title}</strong><span>{pattern.detail}</span></Button>)}</div>
            <p className="pb-control-hint">Previews loop until stopped. PongBar restores the LEDs after the final celebration.</p>
            {status.preview ? <div className="pb-actions"><Button className="pb-button pb-quiet"
              onClick={() => void stopPreview().then(setStatus).catch((reason) => setError(String(reason)))}>
              Stop preview</Button></div> : null}
          </section>
        </aside>
      </main>
      <div className="pb-bottom">
        <section className="pb-card"><div className="pb-card-title"><h3>Live diagnostics</h3><span>RESPONSE IN MS</span></div>
          <div className="pb-diagnostic-row">
            <div className="pb-metric"><small>Input → backend</small><strong>{snapshot.diagnostics[0]?.lastMs == null ? "n/a" : snapshot.diagnostics[0].lastMs.toFixed(1)} <em>ms</em></strong></div>
            <div className="pb-metric"><small>Average · last 20</small><strong>{snapshot.diagnostics[0]?.averageMs == null ? "n/a" : snapshot.diagnostics[0].averageMs.toFixed(1)} <em>ms</em></strong></div>
            <div className="pb-metric"><small>Accepted hit → LED</small><strong>{status.led_write_ms == null ? "n/a" : status.led_write_ms.toFixed(1)} <em>ms</em></strong></div>
          </div>
          <div className="pb-diagnostics-list">{snapshot.diagnostics.length === 0 ?
            "Press a controller button, return the ball, or run a probe to see response times." :
            snapshot.diagnostics.slice(0, 3).map((item) => <div key={`${item.source}:${item.index}`}>
              <b>{item.source.toUpperCase()} {item.index >= 0 ? `#${item.index + 1}` : ""}</b>
              {item.button >= 0 ? ` · button ${item.button}` : ""} · {item.request === "hit" ? "return" : "probe"}
              {item.lastMs == null ? " · awaiting response" : ` · ${item.lastMs.toFixed(1)} ms`}
              {item.maxMs == null ? "" : ` · max ${item.maxMs.toFixed(1)} ms`}
              {item.request === "hit" && item.accepted !== null ? item.accepted ? " · accepted" : " · outside return window" : ""}
              {item.error ? ` · ${item.error.slice(0, 90)}` : ""}
            </div>)}
          </div>
          <div className="pb-actions"><Button className="pb-button pb-quiet" onClick={() => void pongInputs.probe().catch((reason) => setError(String(reason)))}>Measure backend</Button>
            <Button className="pb-button pb-quiet" onClick={() => { pongInputs.resetDiagnostics(); setSnapshot(pongInputs.snapshot()); }}>Clear</Button></div>
          <p className="pb-footer-note">Input timing starts when SteamUI delivers the event. LED timing ends at the software write. Neither includes controller transmission or light diffusion.</p>
        </section>
        <section className="pb-card"><div className="pb-card-title"><h3>Sound & feel</h3><span>EXPERIMENTAL</span></div>
          <Button className="pb-setting" onClick={() => { const enabled = !effectsEnabled;
            setEffectsEnabled(enabled); audio.effectsEnabled = enabled; if (enabled) audio.play("hit"); }}>
            <strong>Game sounds · {effectsEnabled ? "ON" : "OFF"}</strong>
            <small>Return, perfect return, joker, point, level and victory have distinct cues.</small>
          </Button>
          <Button className="pb-setting" onClick={() => { const enabled = !musicEnabled;
            setMusicEnabled(enabled); audio.musicEnabled = enabled;
            if (enabled && status.active) void audio.startMusic().then(setMusicMessage);
            else if (!enabled) audio.stopMusic(); }}>
            <strong>Epic battle music · {musicEnabled ? "ON" : "OFF"}</strong>
            <small>“The Final Battle” by skrjablin · CC0 · plays during a game.</small>
          </Button>
          {musicMessage && musicMessage.startsWith("Music unavailable") ? <div className="pb-message pb-error">{musicMessage}</div> : null}
          <Button className="pb-setting" onClick={() => void change("vibration_enabled", !status.vibration_enabled)}>
            <strong>Controller haptics · {status.vibration_enabled ? "ON" : "OFF"}</strong>
            <small>Steam Controller 2026: direct HID rumble. Choose the output below; game feedback uses the same route.</small>
          </Button>
          {source === "steam" ? <>
            <p className="pb-control-hint">{hidOutputs.length ? `${hidOutputs.length} Steam Controller 2026 HID output${hidOutputs.length === 1 ? "" : "s"} found. Pulse each to identify its physical controller.` :
              "No Steam Controller 2026 HID output found. Reconnect the controller; direct rumble needs a visible /dev/hidraw device."}</p>
            <div className="pb-actions">{hidOutputs.map((item) => <Button key={item.id} className="pb-button pb-quiet"
              onClick={() => void pulseHidOutput(item.id, "test").then((result) =>
                setHapticMessage(`${item.label} · ${result.result} · ${result.writes} reports`))
                .catch((reason) => setHapticMessage(`${item.label} · ${String(reason)}`))}>
              Pulse {item.label}</Button>)}</div>
            <div className="pb-field">P1 VIBRATION OUTPUT
              <Dropdown rgOptions={[{ data: "", label: "No output" }, ...hidOutputs.map((item) => ({ data: item.id, label: item.label }))]}
                selectedOption={output1 ?? ""} onChange={(option) => setHidSelections((current) => [String(option.data) || null, current[1]])} /></div>
            {mode === "duel" ? <div className="pb-field">P2 VIBRATION OUTPUT
              <Dropdown rgOptions={[{ data: "", label: "No output" }, ...hidOutputs.filter((item) => item.id !== output1).map((item) => ({ data: item.id, label: item.label }))]}
                selectedOption={output2 ?? ""} onChange={(option) => setHidSelections((current) => [current[0], String(option.data) || null])} /></div> : null}
          </> : null}
          {player1 !== null ? <div className="pb-actions"><Button className="pb-button pb-quiet"
            onClick={() => void pongInputs.tryVibration(source, player1, "test", 0).then((result) => setHapticMessage(`P1 · ${result.result}`))}>Try P1 vibration</Button>
            {mode === "duel" && player2 !== null ? <Button className="pb-button pb-quiet"
              onClick={() => void pongInputs.tryVibration(source, player2, "test", 1).then((result) => setHapticMessage(`P2 · ${result.result}`))}>Try P2 vibration</Button> : null}
            {hapticMessage ? <span className="pb-haptic-result">{hapticMessage}</span> : null}</div> : null}
          <div className="pb-diagnostics-list">{snapshot.hapticProbes.map((probe) =>
            <div key={`${probe.source}:${probe.index}`}>{probe.path} · #{probe.index + 1} · {probe.result}
              {probe.apiReturn === undefined ? "" : ` · API returned ${probe.apiReturn}`}</div>)}</div>
          <Button className="pb-setting" onClick={() => void change("reverse_led_order", !status.reverse_led_order)}>
            <strong>Reverse physical LEDs · {status.reverse_led_order ? "ON" : "OFF"}</strong>
            <small>Place the cyan end on the Steam Machine's left side.</small>
          </Button>
          <div className="pb-diagnostics-list">{snapshot.devices.map((device: Device) =>
            <div key={`${device.source}:${device.index}`}>
              <b>{device.source.toUpperCase()} #{device.index + 1} · {device.name}</b>
              {device.source === "steam" ? ` · Steam reports haptics ${device.hapticsReported === undefined ? "unknown" : device.hapticsReported ? "yes" : "no"} · rumble setting ${device.rumblePreference === undefined ? "unknown" : ["controller default", "off", "on"][device.rumblePreference] ?? device.rumblePreference} · type ${device.controllerType ?? "unknown"}` :
                ` · browser dual-rumble ${device.haptics ? "exposed" : "unavailable"}`}
              {device.lastButton >= 0 ? ` · button ${device.lastButton}` : ""}
              {device.source === "browser" ? <Button className="pb-button pb-quiet" onClick={() => void pongInputs.tryVibration(device.source, device.index)
                .then((result) => setHapticMessage(`${device.name} · ${result.result}${result.apiReturn === undefined ? "" : ` · API returned ${result.apiReturn}`}`))}>Probe browser rumble</Button> : null}
            </div>)}</div>
          <p className="pb-footer-note">PongBar releases the light bar if SignalBar or another app writes to it. Disable the other effect before playing again.</p>
        </section>
      </div></>}
    </div>
  </Focusable>;
}

function QuickPanel() {
  const [status, setStatus] = useState<PongStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const update = () => void getStatus().then((next) => { if (alive) setStatus(next); }).catch(() => undefined);
    update();
    const timer = window.setInterval(update, 1000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  return <PanelSection title="PongBar · 1D Pong · 0.1.0">
    <PanelSectionRow><div style={{ fontSize: ".83em", lineHeight: 1.45 }}>
      {status?.active ? `${status.mode} game · level ${status.level} · ${status.returns} returns` :
        "1D Pong on the Steam Machine's 17 LEDs. Solo, duel, pinball score and light sequences."}
    </div></PanelSectionRow>
    <PanelSectionRow><ButtonItem label="Open full-screen PongBar"
      onClick={() => { Navigation.CloseSideMenus(); Navigation.Navigate("/pongbar/play"); }}>
      Play or preview sequences</ButtonItem></PanelSectionRow>
  </PanelSection>;
}

export default definePlugin(() => {
  pongInputs.start();
  routerHook.addRoute("/pongbar/play", App);
  return { name: "PongBar", titleView: <div className={staticClasses.Title}>PongBar</div>,
    content: <QuickPanel />, icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 8v8M21 8v8M12 12h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M6 12h3m6 0h3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="1 2" />
    </svg>, alwaysRender: true,
    onDismount() { pongInputs.stop(); routerHook.removeRoute("/pongbar/play"); } };
});
