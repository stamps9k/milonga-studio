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

/** Click pitches in Hz: higher on the first beat of a bar so the bar
 *  can be heard. */
const ACCENT_PITCH = 1600;
const BEAT_PITCH = 1000;
/** Click length in seconds, and its peak volume (0 to 1). */
const CLICK_SECONDS = 0.04;
const ACCENT_VOLUME = 0.5;
const BEAT_VOLUME = 0.3;

export interface ClickPlayer {
  /** Current time on the audio clock, in seconds. */
  now(): number;
  /** Schedule a click at `atTime` on the audio clock. Returns a function
   *  that cancels it if it hasn't played yet. */
  click(atTime: number, accent: boolean): () => void;
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
    resume: () => context.resume(),
    click(atTime, accent) {
      const start = Math.max(atTime, context.currentTime);
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = accent ? ACCENT_PITCH : BEAT_PITCH;
      // A fast attack and exponential decay sounds like a tick rather
      // than a beep. Exponential ramps can't reach 0, hence 0.001.
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(
        accent ? ACCENT_VOLUME : BEAT_VOLUME,
        start + 0.002,
      );
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
