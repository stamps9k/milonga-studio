# Writing figures

Seeded figures live in `db/figures/`, one file each, and are written with
`defineFigure` from `src/libs/dance/authoring.mts`. You describe the steps
the way a dancer would: who moves, which way, how far, on which count. The
helper works out the rest and checks the result.

To add a figure:

1. Create `db/figures/<name>.mts` (copy an existing one as a starting point).
2. Add it to `db/figures/index.mts`, and to `db/seed.mts` if it should be
   seeded.
3. Run `npm run db:reset`, then `npm test`. Any mistake in the figure stops
   the seed with a message naming the figure and step.

## A complete example

```ts
import { defineFigure } from "../../src/libs/dance/authoring.mts";

export default defineFigure({
  name: "Forward Waltz",
  style: "waltz",
  time: "3/4",
  steps: [
    { both: "forward", by: 0.4, beat: 1 },
    {
      both: "diagonal forward right",
      by: 0.4 * Math.SQRT2,
      beat: 2,
      rise: 0.05,
    },
    { both: "close", beat: 3 },
  ],
  expectEnd: { stance: "closed", moved: { forward: 0.4, right: 0.4 } },
});
```

## The figure

| Field       | Meaning                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------- |
| `name`      | Shown in the library.                                                                               |
| `style`     | Free-form tag that groups the library: `tango`, `waltz`, `cha-cha`, …                               |
| `time`      | Time signature, `"3/4"` or `"4/4"`.                                                                 |
| `start`     | Starting stance. Only `"closed"` so far, which is the default.                                      |
| `slow`      | Beats in an S when using `length`. Default 2 (so a Q is 1). Use `slow: 1` for tango-style counting. |
| `steps`     | The steps, in time order.                                                                           |
| `expectEnd` | Optional, but recommended: where the figure should finish. See below.                               |

Closed stance: the lead stands at the origin facing line of dance, feet 20 cm
apart; the follow faces him 40 cm away. These are `STANCE_WIDTH` and
`PARTNER_DISTANCE` in `authoring.mts`.

## Steps

Each entry in `steps` is one moment. Write either:

- `both: <action>`: the lead does it and the follow mirrors it, or
- `lead: …` and/or `follow: …`: each partner separately (for ochos, crosses
  and anything else where they don't mirror).

**Mirroring** means the follow uses the other foot and travels the same way
across the floor, with the same distance, timing and turn. Facing each other,
the lead's forward is her back, his side left is her side right, and his
diagonal forward right is her diagonal back left.

### Actions

| Action                                               | Meaning                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| `"forward"`, `"back"`, `"side left"`, `"side right"` | Travel that way, relative to the dancer's own facing. Needs `by`.  |
| `"diagonal forward left"` and the other diagonals    | The same, at 45°.                                                  |
| a number, such as `10` or `-10`                      | Degrees clockwise from forward, for angles in between. Needs `by`. |
| `"close"`                                            | Bring the free foot beside the standing foot (stance width apart). |
| `"in place"`                                         | Change weight onto the free foot without moving it (a recover).    |
| `"pivot"`                                            | Turn on the standing foot without moving it. Needs `turn`.         |

Directions are measured from the way the dancer faces **before** the step's
turn.

### Options

Write these on the row, where they apply to `both` and to a plain
`lead: "forward"`, or inside a partner object such as
`follow: { go: "pivot", turn: { left: 1 / 8 } }`.

| Option          | Meaning                                                                                |
| --------------- | -------------------------------------------------------------------------------------- |
| `by`            | Distance in metres.                                                                    |
| `turn`          | `{ right: 1 / 8 }` (clockwise, natural) or `{ left: 3 / 8 }` (anticlockwise, reverse). |
| `foot`          | `"L"` or `"R"`. Usually left out; see below. With `both`, it's the lead's foot.        |
| `rise`          | Rise at the end of the step, in metres (e.g. `0.05`). Default 0.                       |
| `weight: false` | A step without weight, such as a tap: the foot moves, the weight stays.                |
| `air: true`     | An airborne action (boleo, gancho): the free leg goes out and back, no weight.         |
| `label`         | Text shown for the step. One string, or `{ lead, follow }`. Default: generated.        |

### Which foot

You rarely need `foot`. A travelling step, a close or an in-place step
always uses the **free** foot (the one without the weight), and a pivot uses
the **standing** foot. The starting weight is worked out from each partner's
first step: if the lead's first step is with his right foot, he must start
standing on his left. With no foot given at all, the lead starts standing on
his right and the follow on her left.

Give `foot` when the first step isn't the usual one (for example
`foot: "R"` to start a figure on the lead's right), or just to be explicit.
If the foot you give is carrying the weight, the helper stops with an error
rather than quietly using the other foot.

### Timing

Use one style per figure:

- **`beat`**: when the step starts, counting from 1 (`1`, `2`, `3.5` for
  "3&"). Each step lasts until that partner's next step, and the last one
  until the end of the measure. Steps must be listed in beat order.
- **`length`**: `"S"` or `"Q"`. Steps follow one another, so S, Q, Q in 4/4
  runs 1–2, 3, 4.

## Checking the end: `expectEnd`

The figure's end pose is calculated from the steps, so you never type it.
`expectEnd` is an independent statement of where it should finish. If the
steps don't get there (within 1 mm), the helper stops and lists the feet
that are off. That's what catches a mistranslated step.

Either a named stance, moved and turned as a whole:

```ts
expectEnd: {
  stance: "closed",
  moved: { forward: 0.4, right: 0.3 }, // metres, in the figure's start frame
  turned: { right: 1 / 4 },            // optional
  leadStandingOn: "L",                 // optional: also check the weight
}
```

or exact foot positions, for endings that aren't a named stance (an open,
mid-stride finish):

```ts
expectEnd: {
  feet: {
    lead: { L: [-0.1, 0.6], R: [0.1, 0] },
    follow: { L: [0.1, 0.4], R: [-0.1, 1.0] },
  },
  facing: { lead: 0, follow: 180 }, // optional
}
```

Coordinates are in metres in the figure's own frame: the lead starts at the
origin facing +y (line of dance), with +x to his right.

## Errors the helper reports

It stops with a message naming the figure and step if:

- a step moves the foot carrying the weight, or a pivot uses the free foot;
- a direction has no `by`, or a pivot has no `turn`;
- a figure mixes `beat` and `length`, a step has neither, or beats are out
  of order;
- one partner has two steps starting at the same time;
- the steps don't end where `expectEnd` says.

## Not supported yet

Curved paths (all steps travel in straight lines), crossing positions
(`"cross"`), and stances other than closed hold. These will be added when a
figure needs them.
