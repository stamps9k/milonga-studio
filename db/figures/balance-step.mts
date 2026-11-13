import { defineFigure } from "../../src/libs/dance/authoring.mts";

/** Side, close, side to the lead's right, rising on the first side
 *  step. Starts on the lead's right foot (follow's left), i.e. with the
 *  weight on his left, which is how Forward Waltz ends. */
export default defineFigure({
  name: "Balance Step",
  style: "waltz",
  time: "3/4",
  steps: [
    {
      both: "side right",
      foot: "R",
      by: 0.3,
      rise: 0.05,
      beat: 1,
      label: "side, rising",
    },
    {
      both: "close",
      beat: 2,
      label: { lead: "close left to right", follow: "close right to left" },
    },
    { both: "side right", by: 0.3, beat: 3, label: "side again" },
  ],
  expectEnd: {
    feet: {
      lead: { L: [0.2, 0], R: [0.7, 0] },
      follow: { L: [0.7, 0.4], R: [0.2, 0.4] },
    },
    facing: { lead: 0, follow: 180 },
  },
});
