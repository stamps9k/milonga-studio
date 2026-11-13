import { defineFigure } from "../../src/libs/dance/authoring.mts";

/** Forward break, recover, then cha-cha-cha back into place, counted
 *  1, 2, 3, 3&, 4 within one measure. Ends with the weight on the
 *  lead's left, ready for Side Basic. */
export default defineFigure({
  name: "Cha-Cha Basic",
  style: "cha-cha",
  time: "4/4",
  steps: [
    {
      both: "forward",
      by: 0.3,
      beat: 1,
      label: { lead: "rock forward", follow: "rock back" },
    },
    { both: "in place", beat: 2, label: "recover weight" },
    {
      both: "back",
      by: 0.3,
      beat: 3,
      label: { lead: "cha: step back", follow: "cha: step forward" },
    },
    { both: "in place", beat: 3.5, label: "cha: in place" },
    { both: "in place", beat: 4, label: "cha: in place" },
  ],
  expectEnd: { stance: "closed", leadStandingOn: "L" },
});
