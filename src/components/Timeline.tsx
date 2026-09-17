interface TimelineProps {
  beat: number;
  totalBeats: number;
  playing: boolean;
  onToggle: () => void;
  onSeek: (beat: number) => void;
  onStepBy: (delta: number) => void;
}

function formatBeats(value: number): string {
  return value.toFixed(1);
}

const Timeline = ({
  beat,
  totalBeats,
  playing,
  onToggle,
  onSeek,
  onStepBy,
}: TimelineProps) => {
  const disabled = totalBeats <= 0;

  return (
    <div className="d-flex align-items-center gap-3">
      <button
        className="btn btn-outline-light transport-btn p-2"
        type="button"
        disabled={disabled}
        title="Back 1 beat"
        onClick={() => onStepBy(-1)}
      >
        <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
          <rect x="3" y="5" width="2" height="14" />
          <polygon points="16,5 16,19 4,12" />
        </svg>
      </button>
      <button
        className="btn btn-amber transport-play p-0 d-flex align-items-center justify-content-center"
        type="button"
        disabled={disabled}
        title={playing ? "Pause" : "Play"}
        onClick={onToggle}
      >
        {playing ? (
          <svg width="17" height="17" viewBox="0 0 20 20" fill="currentColor">
            <rect x="5" y="4" width="4" height="16" />
            <rect x="11" y="4" width="4" height="16" />
          </svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 20 20" fill="currentColor">
            <polygon points="6,4 6,20 19,12" />
          </svg>
        )}
      </button>
      <button
        className="btn btn-outline-light transport-btn p-2"
        type="button"
        disabled={disabled}
        title="Forward 1 beat"
        onClick={() => onStepBy(1)}
      >
        <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
          <rect x="15" y="5" width="2" height="14" />
          <polygon points="4,5 4,19 16,12" />
        </svg>
      </button>
      <input
        type="range"
        className="form-range flex-fill mx-2"
        min={0}
        max={Math.max(totalBeats, 0.0001)}
        step={0.01}
        value={beat}
        disabled={disabled}
        onChange={(event) => onSeek(Number(event.target.value))}
      />
      <span className="font-mono text-body-secondary flex-shrink-0">
        {formatBeats(beat)} / {formatBeats(totalBeats)} beats
      </span>
    </div>
  );
};

export default Timeline;
