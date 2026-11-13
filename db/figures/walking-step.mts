import { defineFigure } from "../../src/libs/dance/authoring.mts";

/** One walking step: the lead walks forward on his left, the follow
 *  walks back on her right. Ends mid-stride (open), so the expected end
 *  is given as exact foot positions rather than a stance. */
export default defineFigure({
  name: "Walking Step",
  style: "tango",
  time: "4/4",
  steps: [
    {
      both: "forward",
      by: 0.6,
      length: "Q",
      label: { lead: "walk forward", follow: "walk back" },
    },
  ],
  expectEnd: {
    feet: {
      lead: { L: [-0.1, 0.6], R: [0.1, 0] },
      follow: { L: [0.1, 0.4], R: [-0.1, 1.0] },
    },
    facing: { lead: 0, follow: 180 },
  },
});
