import { defineFigure } from "../../src/libs/dance/authoring.mts";

/** Cha-Cha Basic's shape done sideways: side break to the lead's right,
 *  recover, then cha-cha-cha back into place. Starts on the lead's
 *  right foot, which is where Cha-Cha Basic leaves the weight free. */
export default defineFigure({
  name: "Side Basic",
  style: "cha-cha",
  time: "4/4",
  steps: [
    { both: "side right", foot: "R", by: 0.3, beat: 1, label: "side break" },
    { both: "in place", beat: 2, label: "recover weight" },
    { both: "side left", by: 0.3, beat: 3, label: "cha: side" },
    { both: "in place", beat: 3.5, label: "cha: in place" },
    { both: "in place", beat: 4, label: "cha: in place" },
  ],
  expectEnd: { stance: "closed", leadStandingOn: "R" },
});
