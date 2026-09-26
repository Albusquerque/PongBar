import { useEffect, useRef } from "react";
import type { PongStatus } from "../types";

const DIGITS = [
  ["11111", "10001", "10001", "10001", "10001", "10001", "11111"],
  ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  ["11111", "00001", "00001", "11111", "10000", "10000", "11111"],
  ["11111", "00001", "00001", "01111", "00001", "00001", "11111"],
  ["10001", "10001", "10001", "11111", "00001", "00001", "00001"],
  ["11111", "10000", "10000", "11111", "00001", "00001", "11111"],
  ["11111", "10000", "10000", "11111", "10001", "10001", "11111"],
  ["11111", "00001", "00010", "00100", "00100", "00100", "00100"],
  ["11111", "10001", "10001", "11111", "10001", "10001", "11111"],
  ["11111", "10001", "10001", "11111", "00001", "00001", "11111"],
];
const WORD = {
  P: ["1110", "1001", "1001", "1110", "1000", "1000", "1000"],
  O: ["0110", "1001", "1001", "1001", "1001", "1001", "0110"],
  N: ["1001", "1101", "1101", "1011", "1011", "1001", "1001"],
  G: ["0111", "1000", "1000", "1011", "1001", "1001", "0111"],
  B: ["1110", "1001", "1001", "1110", "1001", "1001", "1110"],
  A: ["0110", "1001", "1001", "1111", "1001", "1001", "1001"],
  R: ["1110", "1001", "1001", "1110", "1010", "1001", "1001"],
};
const SMALL: Record<string, string[]> = {
  "1": ["010", "110", "010", "010", "111"], "7": ["111", "001", "010", "010", "010"],
  L: ["100", "100", "100", "100", "111"], E: ["111", "100", "110", "100", "111"],
  D: ["110", "101", "101", "101", "110"], A: ["010", "101", "111", "101", "101"],
  R: ["110", "101", "110", "101", "101"], C: ["011", "100", "100", "100", "011"],
};
const STAGES = ["#56d8d1", "#649eff", "#bd79f5", "#ffa64c", "#ff6759"];
const DURATIONS: Record<string, number> = { perfect: 1900, level: 2200, point: 1800, winner: 4000 };

function cueLabel(status: PongStatus, cueAge: number) {
  if (status.paused) return "PAUSE";
  if (status.preview || (status.cue === "winner" && cueAge < 4000)) {
    if (status.cue === "winner") return "FINAL CELEBRATION";
  }
  if (status.phase === "finished" && !status.preview) return status.mode === "solo" ? "GAME OVER" : "WINNER";
  if (status.cue === "level" && (status.preview || cueAge < 2200)) return "JACKPOT";
  if (status.cue === "perfect" && (status.preview || cueAge < 1900)) return "PERFECT";
  if (status.cue === "joker" && cueAge < 900) return `EARLY · ${status.jokers?.[status.cue_side] ?? 0} JOKERS`;
  if (status.cue === "point" && (status.preview || cueAge < 1800)) return "POINT";
  if (status.phase === "ready") return "GET READY";
  return status.mode ? "SCORE" : "1D PONG";
}

function paint(canvas: HTMLCanvasElement, status: PongStatus, now: number, cueAge: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const accent = STAGES[Math.max(0, Math.min(4, status.level - 1))];
  const dot = (x: number, y: number, color: string, alpha = 1) => {
    if (x < 0 || x >= 64 || y < 0 || y >= 28) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc((x + .5) * 10, (y + .5) * 10, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  };
  ctx.fillStyle = "#070b12";
  ctx.fillRect(0, 0, 640, 280);
  for (let y = 0; y < 28; y++) for (let x = 0; x < 64; x++) dot(x, y, "#6b5847", .23);
  const chase = Math.floor(now / 65);
  for (let i = 0; i < 5; i++) {
    const x = (chase + i * 13) % 64;
    dot(x, 0, accent, i ? .43 : 1);
    dot(63 - x, 27, accent, i ? .43 : 1);
  }
  const showBrand = (status.phase === "idle" && !status.preview && !status.cue) ||
    (status.phase === "ready" && cueAge < 1250);
  if (showBrand) {
    const reveal = status.phase === "ready" ? Math.min(64, Math.floor(cueAge / 350 * 64)) : 64;
    "1D PONG".split("").forEach((letter, index) => {
      const color = index < 4 ? "#8deced" : index === 5 ? "#ffe19a" : "#ff91bc";
      WORD[letter as keyof typeof WORD].forEach((row, y) => {
        for (let col = 0; col < 4; col++) if (row[col] === "1") {
          for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
            const x = 1 + index * 9 + col * 2 + dx;
            if (x <= reveal) dot(x, 4 + y * 2 + dy, color);
          }
        }
      });
    });
    "17 LED ARCADE".split("").forEach((letter, index) => {
      SMALL[letter]?.forEach((row, y) => {
        for (let col = 0; col < 3; col++) if (row[col] === "1") dot(6 + index * 4 + col, 21 + y, "#d4b486", .82);
      });
    });
    const glint = Math.floor(now / 55) % 64;
    dot(glint, 2, "#f4ffff");
    dot(63 - glint, 19, "#f4ffff", .7);
    return;
  }
  const duration = DURATIONS[status.cue];
  const effectAge = status.preview && duration ? cueAge % duration : cueAge;
  if (status.cue === "level" && effectAge < 2200) {
    const sweep = Math.floor(effectAge / 25);
    for (let x = 0; x < Math.min(64, sweep); x++) {
      dot(x, 2, accent, x > sweep - 8 ? 1 : .5);
      dot(63 - x, 25, accent, x > sweep - 8 ? 1 : .5);
    }
  } else if (["perfect", "point", "winner"].includes(status.cue) &&
             effectAge < (status.cue === "winner" ? 4000 : 1900)) {
    const colour = status.cue === "point" ? "#ff729d" : "#ffe9b0";
    const reach = 2 + Math.floor((effectAge % 900) / 120);
    for (let i = 0; i < 8; i++) {
      dot(2 + i % 3, 5 + i * 2, colour, i < reach ? 1 : .3);
      dot(61 - i % 3, 5 + i * 2, colour, i < reach ? 1 : .3);
    }
  }
  const digit = (value: string, x: number, color: string) => {
    DIGITS[Number(value)].forEach((row, y) => {
      for (let col = 0; col < 5; col++) if (row[col] === "1") {
        for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) dot(x + col * 3 + dx, 3 + y * 3 + dy, color);
      }
    });
  };
  if (status.mode === "duel") {
    digit(String(Math.min(9, status.scores[0])), 11, "#9af1f3");
    digit(String(Math.min(9, status.scores[1])), 38, "#ffa2c8");
    for (const y of [9, 17]) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++)
      dot(31 + dx, y + dy, "#f4e4b4");
  } else {
    String(Math.min(999, status.returns)).padStart(3, "0").split("")
      .forEach((value, index) => digit(value, 6 + index * 18, "#ffd17d"));
  }
  for (let index = 0; index < 3; index++) {
    dot(4 + index * 3, 25, index < (status.jokers?.[0] ?? 3) ? "#ffd17d" : "#574f48");
    if (status.mode === "duel")
      dot(51 + index * 3, 25, index < (status.jokers?.[1] ?? 3) ? "#ffb1cb" : "#574f48");
  }
}

export function Matrix({ status }: { status: PongStatus }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef(status);
  const receivedAt = useRef(performance.now());
  useEffect(() => { latest.current = status; receivedAt.current = performance.now(); }, [status]);
  useEffect(() => {
    let frame = 0;
    let lastPaint = -100;
    const update = (now: number) => {
      if (now - lastPaint >= 48 && canvasRef.current) {
        const current = latest.current;
        const cueAge = current.cue_age_ms + Math.max(0, now - receivedAt.current);
        paint(canvasRef.current, current, now, cueAge);
        lastPaint = now;
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, []);
  const label = status.mode === "duel" ? `Player 1 ${status.scores[0]}, player 2 ${status.scores[1]}` :
    `${status.returns} returns, ${status.lives} lives, best ${status.best_streak}`;
  return <div className="pb-matrix-frame">
    <div className="pb-matrix-head"><span>PINBALL MATRIX · 64 × 28</span><strong>{cueLabel(status, status.cue_age_ms)}</strong></div>
    <canvas ref={canvasRef} width={640} height={280} role="img"
      aria-label={`PongBar 1D Pong matrix: ${label}. Level ${status.level}.`} />
    <div className="pb-matrix-foot"><span>CYAN · LEFT</span><span>WHITE · BALL</span><span>PINK · RIGHT</span></div>
  </div>;
}
