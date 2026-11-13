import { defineFigure } from "../../src/libs/dance/authoring.mts";

/** Forward, side, close. The side step travels diagonally forward on a
 *  3-4-5 triangle (0.3 across for 0.4 forward, 0.5 travelled), so the
 *  moving foot finishes level with the one that stepped forward, and
 *  carries the waltz rise. */
const DIAGONAL_3_4_5 = (Math.atan2(0.3, 0.4) * 180) / Math.PI;

export default defineFigure({
  name: "Forward Waltz",
  style: "waltz",
  time: "3/4",
  steps: [
    {
      both: "forward",
      by: 0.4,
      beat: 1,
      label: { lead: "step forward", follow: "step back" },
    },
    {
      both: DIAGONAL_3_4_5,
      by: 0.5,
      rise: 0.05,
      beat: 2,
      label: "side, rising",
    },
    {
      both: "close",
      beat: 3,
      label: { lead: "close left to right", follow: "close right to left" },
    },
  ],
  expectEnd: {
    stance: "closed",
    moved: { forward: 0.4, right: 0.3 },
    leadStandingOn: "L",
  },
});
