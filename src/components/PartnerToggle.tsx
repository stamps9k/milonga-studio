import type { Partner } from "../libs/dance/step.mts";
import { PARTNER_COLOR, PARTNER_NAME } from "./canvasStyle.mts";

interface PartnerToggleProps {
  shown: Record<Partner, boolean>;
  onToggle: (partner: Partner) => void;
}

/**
 * Show or hide each dancer on the 2D canvas, overlaid in its top-right
 * corner. Each button is a toggle (aria-pressed) with a swatch in the
 * partner's colour. The last dancer still shown can't be hidden, so the
 * canvas is never empty while there is a sequence.
 */
const PartnerToggle = ({ shown, onToggle }: PartnerToggleProps) => {
  const shownCount = (Object.keys(shown) as Partner[]).filter(
    (partner) => shown[partner],
  ).length;
  return (
    <div
      className="partner-toggle"
      role="group"
      aria-label="Show or hide dancers">
      <style>{`
        .partner-toggle {
          position: absolute;
          top: 0.5rem;
          right: 0.5rem;
          display: flex;
          gap: 0.25rem;
          padding: 0.25rem;
          border-radius: 6px;
          background-color: rgba(20, 22, 28, 0.82);
        }
        .partner-toggle button {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.15rem 0.5rem;
          border: 1px solid transparent;
          border-radius: 4px;
          background: none;
          font-size: 0.72rem;
          color: var(--bs-body-color, #ccc);
          cursor: pointer;
        }
        .partner-toggle button[aria-pressed="true"] {
          border-color: var(--bs-secondary-color, #999);
        }
        .partner-toggle button[aria-pressed="false"] {
          opacity: 0.55;
          text-decoration: line-through;
        }
        .partner-toggle button:disabled {
          cursor: default;
        }
        .partner-toggle .swatch {
          width: 0.6rem;
          height: 0.6rem;
          border-radius: 50%;
        }
      `}</style>
      {(["lead", "follow"] as const).map((partner) => {
        const isShown = shown[partner];
        return (
          <button
            key={partner}
            type="button"
            aria-pressed={isShown}
            disabled={isShown && shownCount === 1}
            title={
              isShown && shownCount === 1
                ? "At least one dancer stays shown"
                : `${isShown ? "Hide" : "Show"} the ${PARTNER_NAME[partner].toLowerCase()}`
            }
            onClick={() => onToggle(partner)}>
            <span
              className="swatch"
              style={{ backgroundColor: PARTNER_COLOR[partner] }}
            />
            {PARTNER_NAME[partner]}
          </button>
        );
      })}
    </div>
  );
};

export default PartnerToggle;
