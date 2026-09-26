import battleThemeUrl from "../assets/the_final_battle.ogg";
import type { PongStatus } from "./types";

type Cue = "start" | "hit" | "perfect" | "joker" | "early_penalty" | "loss" |
  "point" | "level" | "winner" | "pause";

export class PongAudio {
  private context: AudioContext | null = null;
  private music: HTMLAudioElement | null = null;
  private lastSession = -1;
  private lastFeedback = 0;
  effectsEnabled = true;
  musicEnabled = true;

  private audioContext(): AudioContext | null {
    try {
      this.context ??= new AudioContext();
      if (this.context.state === "suspended") void this.context.resume().catch(() => undefined);
      return this.context;
    } catch { return null; }
  }

  private tone(frequency: number, duration: number, delay = 0, shape: OscillatorType = "sine",
               volume = 0.13, endFrequency = frequency) {
    const context = this.audioContext();
    if (!context) return;
    const at = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = shape;
    oscillator.frequency.setValueAtTime(frequency, at);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(35, endFrequency), at + duration);
    gain.gain.setValueAtTime(0.001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + Math.min(0.025, duration / 3));
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
  }

  play(cue: Cue) {
    if (!this.effectsEnabled) return;
    switch (cue) {
      case "start":
        [262, 392, 523].forEach((note, index) => this.tone(note, .18, index * .09, "triangle", .09));
        break;
      case "hit":
        this.tone(370, .11, 0, "sine", .14, 510);
        this.tone(740, .07, .018, "triangle", .045, 820);
        break;
      case "perfect":
        [523, 659, 784, 1046].forEach((note, index) =>
          this.tone(note, .24, index * .055, "sine", .095));
        break;
      case "joker":
        this.tone(510, .13, 0, "triangle", .1, 350);
        this.tone(315, .13, .11, "sine", .07, 275);
        break;
      case "early_penalty":
      case "loss":
        this.tone(300, .24, 0, "triangle", .14, 120);
        this.tone(165, .28, .08, "sine", .08, 82);
        break;
      case "point":
        [392, 494, 587].forEach((note, index) => this.tone(note, .16, index * .07, "triangle", .1));
        break;
      case "level":
        [392, 523, 659, 784, 1046].forEach((note, index) =>
          this.tone(note, .25, index * .08, "triangle", .085));
        break;
      case "winner":
        [392, 523, 659, 784, 1046, 1318].forEach((note, index) =>
          this.tone(note, .45, index * .1, "triangle", .08));
        break;
      case "pause":
        this.tone(330, .13, 0, "sine", .07, 260);
        break;
    }
  }

  async startMusic(): Promise<string> {
    if (!this.musicEnabled) return "Music is off.";
    try {
      this.music ??= new Audio(battleThemeUrl);
      this.music.loop = true;
      this.music.volume = 0.16;
      await this.music.play();
      return "Playing The Final Battle by skrjablin.";
    } catch (error) {
      return `Music unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  stopMusic() {
    if (!this.music) return;
    this.music.pause();
    this.music.currentTime = 0;
  }

  onStatus(status: PongStatus) {
    if (!status.active && status.phase === "finished") this.stopMusic();
    if (status.session_id !== this.lastSession) {
      this.lastSession = status.session_id;
      this.lastFeedback = status.feedback_seq;
      return;
    }
    if (status.feedback_seq <= this.lastFeedback) return;
    this.lastFeedback = status.feedback_seq;
    const cue = status.feedback_kind as Cue;
    this.play(cue);
  }

  dispose() {
    this.stopMusic();
    this.music = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
