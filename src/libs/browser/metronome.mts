/**
 * The metronome's sound: short synthesised clicks played with the Web
 * Audio API, so no audio files or dependencies are needed.
 *
 * Clicks are scheduled at a time on the audio clock rather than played
 * when a frame happens to notice a beat has passed. Animation frames
 * arrive every 16 ms or so, which is enough jitter to hear; the audio
 * clock places each click to the sample. useMetronome works out when
 * each beat falls and asks for the click slightly ahead of time.
 */

import type { ClickKind } from "../dance/tempo.mts";

/** Each kind of click's pitch (Hz) and peak volume (0 to 1): highest and
 *  loudest on count 1 of a bar so the bar can be heard, and lowest and
 *  quietest on the optional half beats so they fill in without hiding
 *  the counts. */
const CLICK_SOUND: Record<ClickKind, { pitch: number; volume: number }> = {
  accent: { pitch: 1600, volume: 0.5 },
  beat: { pitch: 1000, volume: 0.3 },
  half: { pitch: 800, volume: 0.15 },
};
/** Click length in seconds. */
const CLICK_SECONDS = 0.04;

export interface ClickPlayer {
  /** Current time on the audio clock, in seconds. */
  now(): number;
  /** How long after its scheduled time a sound actually comes out of the
   *  speakers, in seconds, as the browser reports it: processing plus
   *  output latency. Usually around 0.01-0.05 s, but Bluetooth speakers
   *  and headphones can add 0.1-0.3 s. 0 where the browser doesn't say. */
  latency(): number;
  /** Schedule a click at `atTime` on the audio clock. Returns a function
   *  that cancels it if it hasn't played yet. */
  click(atTime: number, kind: ClickKind): () => void;
  /** Start the audio clock. Browsers only allow this in response to a
   *  user gesture (a click or key press), so call it from one. */
  resume(): Promise<void>;
}

/** A ClickPlayer, or null where the browser has no Web Audio. */
export function createClickPlayer(): ClickPlayer | null {
  const AudioContextClass =
    typeof window === "undefined" ? undefined : window.AudioContext;
  if (!AudioContextClass) return null;
  const context = new AudioContextClass();

  return {
    now: () => context.currentTime,
    latency: () => (context.baseLatency ?? 0) + (context.outputLatency ?? 0),
    resume: () => context.resume(),
    click(atTime, kind) {
      const sound = CLICK_SOUND[kind];
      const start = Math.max(atTime, context.currentTime);
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = sound.pitch;
      // A fast attack and exponential decay sounds like a tick rather
      // than a beep. Exponential ramps can't reach 0, hence 0.001.
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(sound.volume, start + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.001, start + CLICK_SECONDS);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + CLICK_SECONDS);
      return () => {
        try {
          oscillator.stop();
        } catch {
          // Already stopped or never started: nothing to cancel.
        }
      };
    },
  };
}
