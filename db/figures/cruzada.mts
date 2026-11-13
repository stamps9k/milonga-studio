import { defineFigure } from "../../src/libs/dance/authoring.mts";

/** The lead walks forward while leading the follow into the cross.
 *  Reproduced as originally seeded, which is suspect: both of the
 *  follow's steps travel *forward* for her (towards the lead), as in the
 *  original Walking Step direction bug. A cruzada is normally led from
 *  the follow walking back. Left unchanged for the owner to correct
 *  when describing the tango figures. */
export default defineFigure({
  name: "Cruzada",
  style: "tango",
  time: "4/4",
  steps: [
    {
      lead: "forward",
      follow: "forward",
      by: 0.3,
      length: "Q",
      label: {
        lead: "forward, leading the cross",
        follow: "back, preparing cross",
      },
    },
    {
      follow: "forward",
      by: 0.15,
      length: "Q",
      label: "cross left behind right",
    },
  ],
  expectEnd: {
    feet: {
      lead: { L: [-0.1, 0.3], R: [0.1, 0] },
      follow: { L: [0.1, 0.25], R: [-0.1, 0.1] },
    },
    facing: { lead: 0, follow: 180 },
  },
});
