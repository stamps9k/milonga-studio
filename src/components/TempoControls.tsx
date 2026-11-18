import { useState } from "react";

import {
  type ClickDivision,
  MAX_TEMPO,
  MIN_TEMPO,
  clicksPerBeat,
} from "../libs/dance/tempo.mts";

interface TempoControlsProps {
  bpm: number;
  /** The sequence's default tempo, shown so the user knows what Reset
   *  goes back to. */
  defaultBpm: number;
  /** True once the user has set the tempo themselves. */
  adjusted: boolean;
  onBpmChange: (bpm: number) => void;
  onTap: () => void;
  onReset: () => void;
  metronomeOn: boolean;
  onMetronomeToggle: () => void;
  clickDivision: ClickDivision;
  onClickDivisionChange: (division: ClickDivision) => void;
}

/**
 * The playback tempo row under the timeline: the BPM (typed, or nudged
 * one at a time with − and +), a Tap button to set it by tapping along
 * to music, a Reset back to the dance's default, the metronome switch,
 * and whether it clicks every beat or every half beat. With half beats,
 * a note gives the clicks a minute, which is the number a music app or
 * track listing would show for tango's four-to-a-bar pulse.
 *
 * The number field keeps what is being typed as a draft and only
 * applies it on Enter or when the field loses focus, so typing "120"
 * doesn't pass through 1 and 12 (which would be clamped to the minimum
 * on the way).
 */
const TempoControls = ({
  bpm,
  defaultBpm,
  adjusted,
  onBpmChange,
  onTap,
  onReset,
  metronomeOn,
  onMetronomeToggle,
  clickDivision,
  onClickDivisionChange,
}: TempoControlsProps) => {
  const perBeat = clicksPerBeat(clickDivision);
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft !== null) {
      const value = Number(draft);
      if (draft.trim() !== "" && Number.isFinite(value)) onBpmChange(value);
      setDraft(null);
    }
  };

  return (
    <div className="tempo-controls d-flex align-items-center gap-2 flex-wrap">
      <style>{`
        .tempo-controls .tempo-input {
          width: 4.5rem;
          text-align: center;
        }
        .tempo-controls .tempo-default {
          font-size: 0.8rem;
        }
      `}</style>
      <span className="tempo-label eyebrow me-1">Tempo</span>
      <button
        type="button"
        className="btn btn-outline-light btn-sm"
        title="1 BPM slower"
        disabled={bpm <= MIN_TEMPO}
        onClick={() => onBpmChange(bpm - 1)}>
        −
      </button>
      <input
        type="number"
        className="form-control form-control-sm bg-transparent border-secondary-subtle text-body tempo-input"
        aria-label="Tempo in beats per minute"
        min={MIN_TEMPO}
        max={MAX_TEMPO}
        step={1}
        value={draft ?? String(bpm)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") setDraft(null);
        }}
      />
      <button
        type="button"
        className="btn btn-outline-light btn-sm"
        title="1 BPM faster"
        disabled={bpm >= MAX_TEMPO}
        onClick={() => onBpmChange(bpm + 1)}>
        +
      </button>
      <span className="text-body-secondary">BPM</span>
      <button
        type="button"
        className="btn btn-outline-light btn-sm ms-2"
        title={
          perBeat > 1
            ? "Tap along with the clicks (two a beat) to set the tempo"
            : "Tap along with the clicks (one a beat) to set the tempo"
        }
        onClick={onTap}>
        Tap
      </button>
      {adjusted ? (
        <button
          type="button"
          className="btn btn-link btn-sm text-body-secondary tempo-default"
          title={`Back to this dance's default of ${defaultBpm} BPM`}
          onClick={onReset}>
          Reset to {defaultBpm}
        </button>
      ) : (
        <span className="text-body-secondary tempo-default">
          (this dance&apos;s default)
        </span>
      )}
      {perBeat > 1 && (
        <span className="text-body-secondary tempo-default">
          {bpm * perBeat} clicks a minute
        </span>
      )}
      <div className="metronome-toggle form-check form-switch ms-auto mb-0">
        <input
          className="form-check-input"
          type="checkbox"
          role="switch"
          id="metronome-switch"
          checked={metronomeOn}
          onChange={onMetronomeToggle}
        />
        <label className="form-check-label" htmlFor="metronome-switch">
          Metronome
        </label>
      </div>
      <select
        className="form-select form-select-sm bg-transparent border-secondary-subtle text-body w-auto"
        aria-label="Metronome clicks"
        value={clickDivision}
        onChange={(event) =>
          onClickDivisionChange(event.target.value as ClickDivision)
        }>
        <option value="beat">Every beat</option>
        <option value="half beat">Every half beat</option>
      </select>
    </div>
  );
};

export default TempoControls;
