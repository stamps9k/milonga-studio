import { useMemo } from "react";

import {
  sequenceCurrentStepsAtBeat,
  sequenceDurationBeats,
} from "../libs/dance/fold.mts";
import type { DanceStep, Partner } from "../libs/dance/step.mts";
import type { SequenceEntry } from "../libs/dance/sequence.mts";

interface ActiveStepProps {
  entries: SequenceEntry[];
  /** Same scrub/playback position Canvas2D and Timeline use, in beats
   *  along the whole sequence -- this always describes whatever the
   *  scrubber is currently sitting on, not just the end state. */
  currentBeat: number;
}

const PARTNERS: readonly Partner[] = ["lead", "follow"];

const PARTNER_LABEL: Record<Partner, string> = {
  lead: "LEAD",
  follow: "FOLLOW",
};

const PARTNER_WIDTH: Record<Partner, string> = {
  lead: "30%",
  follow: "30%",
};

const PARTNER_COLOR: Record<Partner, string> = {
  lead: "var(--amber)",
  follow: "var(--teal)",
};

/** Short human-readable summary of a step for the status bar. Prefers
 *  the figure author's own technique name (DanceStep.label) when given;
 *  otherwise synthesizes one from the raw movement, since most seeded
 *  steps don't have a label yet. A zero-distance straight movement is a
 *  pivot (see the Movement doc comment in step.mts) rather than an
 *  actual travelling step. */
function describeStep(step: DanceStep): string {
  if (step.label) return step.label;

  const foot = step.foot === "left" ? "Left" : "Right";

  if (step.movement.type === "straight") {
    if (step.movement.distance === 0) return `${foot} · pivot`;
    return `${foot} · ${Math.round(step.movement.direction)}° × ${step.movement.distance.toFixed(2)}`;
  }

  const way = step.movement.curvature > 0 ? "right" : "left";
  return `${foot} · arc ${way} × ${step.movement.arcLength.toFixed(2)}`;
}

const ActiveStep = ({ entries, currentBeat }: ActiveStepProps) => {
  const totalBeats = useMemo(() => sequenceDurationBeats(entries), [entries]);

  const info = useMemo(() => {
    if (entries.length === 0) return null;
    const forFold = entries.map((entry) => ({
      figure: entry.figure,
      transform: entry.transform,
    }));
    return sequenceCurrentStepsAtBeat(forFold, currentBeat);
  }, [entries, currentBeat]);

  return (
    <div className="d-flex align-items-center px-4 py-3 border-top font-monospace">
      <span
        className="text-body-secondary text-truncate d-inline-block flex-shrink-0 border-end pe-3"
        style={{ width: "17%" }}>
        BEAT <span className="text-body fw-bold">{currentBeat.toFixed(1)}</span>{" "}
        / {totalBeats.toFixed(1)}
      </span>

      <span
        className="text-body-secondary text-truncate d-inline-block flex-shrink-0 border-end ps-3 pe-3"
        style={{ width: "23%" }}>
        FIGURE{" "}
        <span className="fw-bold" style={{ color: "var(--amber)" }}>
          {info ? info.figureName : "—"}
        </span>
      </span>

      {PARTNERS.map((partner) => {
        const step = info ? info.steps[partner] : null;
        return (
          <span
            key={partner}
            className={
              "text-body-secondary text-truncate d-inline-block flex-shrink-0 ps-3" +
              (partner === "lead" ? " border-end pe-3" : "")
            }
            style={{ width: PARTNER_WIDTH[partner] }}>
            <span className="fw-bold" style={{ color: PARTNER_COLOR[partner] }}>
              {PARTNER_LABEL[partner]}
            </span>{" "}
            {step ? (
              <span className="text-body">
                {describeStep(step)}
                {step.contact === "air" && (
                  <span
                    className="ms-1 small"
                    style={{ color: PARTNER_COLOR[partner] }}>
                    (air)
                  </span>
                )}
              </span>
            ) : (
              <span className="text-body-secondary">resting</span>
            )}
          </span>
        );
      })}
    </div>
  );
};

export default ActiveStep;
