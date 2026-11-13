import { defineFigure } from "../../src/libs/dance/authoring.mts";

/** One sideways step to the lead's right. Reproduced as originally
 *  seeded: the lead moves his free (left) foot to the right and the
 *  follow mirrors with her right foot, so both end with their feet
 *  crossed. That may not be what's intended -- a side step to the right
 *  would usually start from the right foot -- and is left for the owner
 *  to confirm. */
export default defineFigure({
  name: "Side Step",
  style: "tango",
  time: "4/4",
  steps: [
    {
      both: "side right",
      by: 0.35,
      length: "Q",
      label: { lead: "side step", follow: "side step (mirrored)" },
    },
  ],
  expectEnd: {
    feet: {
      lead: { L: [0.25, 0], R: [0.1, 0] },
      follow: { L: [0.1, 0.4], R: [0.25, 0.4] },
    },
    facing: { lead: 0, follow: 180 },
  },
});
