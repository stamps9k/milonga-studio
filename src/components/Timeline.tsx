/** One figure's stretch of the timeline, for the segment bar under the
 *  scrubber. */
export interface TimelineSegment {
  label: string;
  startBeat: number;
  endBeat: number;
}

interface TimelineProps {
  beat: number;
  /** One segment per figure, in order; empty for an empty sequence. */
  segments?: TimelineSegment[];
  /** Index into `segments` of the figure currently playing, or null. */
  currentSegment?: number | null;
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
  segments = [],
  currentSegment = null,
  totalBeats,
  playing,
  onToggle,
  onSeek,
  onStepBy,
}: TimelineProps) => {
  const disabled = totalBeats <= 0;

  return (
    <div className="d-flex align-items-center gap-3">
      <style>{`
        /* The segment bar is inset by half the range thumb's width
           (Bootstrap's 1rem thumb) on each side, because the thumb's
           centre -- which marks the position -- never reaches the
           input's outer edges. That keeps each segment boundary under
           the beat it represents. */
        .timeline-segments {
          display: flex;
          gap: 2px;
          margin: 0 0.5rem;
          height: 1.25rem;
        }
        .timeline-segment {
          min-width: 0;
          padding: 0 0.25rem;
          border: none;
          border-radius: 3px;
          background-color: rgba(255, 255, 255, 0.06);
          color: var(--bs-secondary-color, #999);
          font-size: 0.7rem;
          line-height: 1.25rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          text-align: left;
          cursor: pointer;
        }
        .timeline-segment:hover {
          background-color: rgba(255, 255, 255, 0.12);
        }
        .timeline-segment.current {
          background-color: var(--amber-dim);
          color: var(--amber);
          font-weight: 600;
        }
      `}</style>
      <button
        className="btn btn-outline-light transport-btn p-2 d-flex align-items-center justify-content-center"
        type="button"
        disabled={disabled}
        title="Back 1 beat"
        onClick={() => onStepBy(-1)}>
        <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
          <rect x="3" y="3" width="2" height="14" />
          <polygon points="16,3 16,17 4,10" />
        </svg>
      </button>
      <button
        className="btn btn-accent transport-play p-2 d-flex align-items-center justify-content-center"
        type="button"
        disabled={disabled}
        title={playing ? "Pause" : "Play"}
        onClick={onToggle}>
        {playing ? (
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <rect x="5" y="2" width="4" height="16" />
            <rect x="11" y="2" width="4" height="16" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <polygon points="6,2 6,18 19,10" />
          </svg>
        )}
      </button>
      <button
        className="btn btn-outline-light transport-btn p-2 d-flex align-items-center justify-content-center"
        type="button"
        disabled={disabled}
        title="Forward 1 beat"
        onClick={() => onStepBy(1)}>
        <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
          <rect x="15" y="3" width="2" height="14" />
          <polygon points="4,3 4,17 16,10" />
        </svg>
      </button>
      <div className="flex-fill mx-2 d-flex flex-column">
        <input
          type="range"
          className="form-range"
          min={0}
          max={Math.max(totalBeats, 0.0001)}
          step={0.01}
          value={beat}
          disabled={disabled}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
        {/* One segment per figure, sized by its length in beats. The
            figure playing now is highlighted; clicking a segment jumps
            to the start of that figure. */}
        {totalBeats > 0 && segments.length > 0 && (
          <div className="timeline-segments">
            {segments.map((segment, index) =>
              segment.endBeat > segment.startBeat ? (
                <button
                  key={index}
                  type="button"
                  className={
                    "timeline-segment" +
                    (index === currentSegment ? " current" : "")
                  }
                  style={{
                    flexGrow: segment.endBeat - segment.startBeat,
                    flexBasis: 0,
                  }}
                  title={`${segment.label} (beats ${formatBeats(segment.startBeat)}–${formatBeats(segment.endBeat)})`}
                  aria-current={index === currentSegment ? "step" : undefined}
                  onClick={() => onSeek(segment.startBeat)}>
                  {segment.label}
                </button>
              ) : null,
            )}
          </div>
        )}
      </div>
      <span className="font-monospace text-body-secondary flex-shrink-0">
        {formatBeats(beat)} / {formatBeats(totalBeats)} beats
      </span>
    </div>
  );
};

export default Timeline;
