import { defineFigure } from "../../src/libs/dance/authoring.mts";

/** A pair of back ochos: on each, the follow pivots on her standing
 *  foot and steps across, while the lead takes a small step to each
 *  side of line of dance. */
export default defineFigure({
  name: "Ocho",
  style: "tango",
  time: "4/4",
  steps: [
    {
      lead: { go: 10, by: 0.2, label: "small lead step" },
      follow: {
        go: "pivot",
        foot: "L",
        turn: { left: 1 / 8 },
        label: "pivot on left",
      },
      length: "Q",
    },
    {
      follow: { go: "side right", by: 0.3, label: "back ocho step" },
      length: "Q",
    },
    {
      lead: { go: -10, by: 0.2, label: "small lead step" },
      follow: { go: "pivot", turn: { left: 1 / 4 }, label: "pivot on right" },
      length: "Q",
    },
    {
      follow: { go: "side right", by: 0.3, label: "back ocho step" },
      length: "Q",
    },
  ],
  expectEnd: {
    feet: {
      lead: { L: [-0.065, 0.197], R: [0.065, 0.197] },
      follow: { L: [0.312, 0.188], R: [-0.312, 0.188] },
    },
    facing: { lead: 0, follow: 45 },
  },
});
