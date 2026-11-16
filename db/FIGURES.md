# Writing figures

Figures live in `db/figures/`, one JSON file each. Every `*.json` file in that
folder is loaded, checked and seeded by `npm run db:reset`. Adding, editing or
removing a figure means adding, editing or removing its file. There's no code
to change.

You describe the steps the way a dancer would: who moves, which way, how far,
on which count. The helper (`defineFigure` in `src/libs/dance/authoring.mts`)
works out the rest: which foot, weight, floor directions, timing and the end
pose. It then checks the result.

To add a figure:

1. Create `db/figures/<name>.json`. Copying an existing file is the quickest
   start.
2. Run `npm run db:reset` (with the API stopped), then reload the app.

If anything is wrong in any figure file, the reset stops before touching the
database and lists every problem, each with its file name and where in the
file it is. `npm test` runs the same checks.

To try out figures without changing `db/figures/`, put them in another folder
and run `FIGURES_DIR=path/to/folder npm run db:reset`.

## A complete example

```json
{
  "name": "Forward Waltz",
  "style": "waltz",
  "time": "3/4",
  "notes": "Forward, side, close.",
  "steps": [
    { "both": "forward", "by": 0.4, "beat": 1 },
    { "both": "diagonal forward right", "by": 0.5657, "beat": 2, "rise": 0.05 },
    { "both": "close", "beat": 3 }
  ],
  "expectEnd": {
    "stance": "closed",
    "moved": { "forward": 0.4, "right": 0.4 }
  }
}
```

## The figure

| Field       | Meaning                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| `name`      | Shown in the library. Must be unique across the figure files.                                          |
| `style`     | Free-form tag that groups the library: `"tango"`, `"waltz"`, `"cha-cha"`, …                            |
| `time`      | Time signature: `"3/4"` or `"4/4"`.                                                                    |
| `start`     | Starting stance. Only `"closed"` so far, which is the default.                                         |
| `slow`      | Beats in an S when using `length`. Default 2 (so a Q is 1). Use `1` for tango-style counting.          |
| `steps`     | The steps, in time order.                                                                              |
| `expectEnd` | Optional, but recommended: where the figure should finish. See below.                                  |
| `notes`     | Optional free text for whoever edits the file: sources, caveats, open questions. Not shown in the app. |

Closed stance: the lead stands at the origin facing line of dance, feet 20 cm
apart; the follow faces him 40 cm away.

## Steps

Each entry in `steps` is one moment. Write either:

- `"both": <action>`: the lead does it and the follow mirrors it, or
- `"lead": …` and/or `"follow": …`: each partner separately (for ochos,
  crosses, and anything else where they don't mirror).

**Mirroring** means the follow uses the other foot and travels the same way
across the floor, with the same distance, timing and turn. Facing each other,
the lead's forward is her back, his side left is her side right, and his
diagonal forward right is her diagonal back left.

A partner can be written as just an action (`"lead": "forward"`, using the
options on the row), or as an object with its own options:

```json
{ "follow": { "go": "pivot", "turn": { "left": "1/8" } }, "length": "Q" }
```

### Actions

| Action                                               | Meaning                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| `"forward"`, `"back"`, `"side left"`, `"side right"` | Travel that way, relative to the dancer's own facing. Needs `by`.  |
| `"diagonal forward left"` and the other diagonals    | The same, at 45°.                                                  |
| a number, such as `10` or `-10`                      | Degrees clockwise from forward, for angles in between. Needs `by`. |
| `"close"`                                            | Bring the free foot beside the standing foot (stance width apart). |
| `"in place"`                                         | Change weight onto the free foot without moving it (a recover).    |
| `"pivot"`                                            | Turn on the standing foot without moving it. Needs `turn`.         |

The four diagonals are `"diagonal forward left"`, `"diagonal forward right"`,
`"diagonal back left"` and `"diagonal back right"`. Directions are measured
from the way the dancer faces **before** the step's turn.

### Options

Write these on the row, where they apply to `both` and to a partner written as
just an action, or inside a partner object.

| Option            | Meaning                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `"by"`            | Distance in metres.                                                                                                                   |
| `"turn"`          | `{ "right": "1/8" }` (clockwise, natural) or `{ "left": "3/8" }` (anticlockwise, reverse). A plain number such as `0.125` also works. |
| `"foot"`          | `"L"` or `"R"`. Usually left out; see below. With `both`, it's the lead's foot.                                                       |
| `"rise"`          | Rise at the end of the step, in metres (e.g. `0.05`). Default 0.                                                                      |
| `"weight": false` | A step without weight, such as a tap: the foot moves, the weight stays.                                                               |
| `"air": true`     | An airborne action (boleo, gancho): the free leg goes out and back, carrying no weight.                                               |
| `"label"`         | Text shown for the step. One string, or `{ "lead": …, "follow": … }`. Default: generated.                                             |

### Which foot

You rarely need `foot`. A travelling step, a close or an in-place step always
uses the **free** foot (the one without the weight), and a pivot uses the
**standing** foot. The starting weight is worked out from each partner's first
step: if the lead's first step is with his right foot, he must start standing
on his left. With no foot given at all, the lead starts standing on his right
and the follow on her left.

Give `foot` when the first step isn't the usual one (for example `"foot": "R"`
to start a figure on the lead's right), or just to be explicit. If the foot
you give is carrying the weight, the reset stops with an error rather than
quietly using the other foot.

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
steps don't get there (within 1 mm), the reset stops and lists the feet that
are off. That's what catches a mistranslated step.

Either a named stance, moved and turned as a whole (`moved`, `turned` and
`leadStandingOn` are optional, and `leadStandingOn` also checks the weight):

```json
"expectEnd": {
  "stance": "closed",
  "moved": { "forward": 0.4, "right": 0.3 },
  "turned": { "right": "1/4" },
  "leadStandingOn": "L"
}
```

or exact foot positions, for endings that aren't a named stance (an open,
mid-stride finish), with `facing` optional:

```json
"expectEnd": {
  "feet": {
    "lead": { "L": [-0.1, 0.6], "R": [0.1, 0] },
    "follow": { "L": [0.1, 0.4], "R": [-0.1, 1.0] }
  },
  "facing": { "lead": 0, "follow": 180 }
}
```

Coordinates are in metres in the figure's own frame: the lead starts at the
origin facing +y (line of dance), with +x to his right.

## What gets checked

The reset stops, listing every problem with its file and location, if:

- a file isn't valid JSON, has an unknown field (`"beats"` instead of
  `"beat"`), a misspelt direction, or a value of the wrong type;
- two files use the same figure name;
- a step moves the foot carrying the weight, or a pivot uses the free foot;
- a direction has no `by`, or a pivot has no `turn`;
- a figure mixes `beat` and `length`, a step has neither, or beats are out of
  order;
- one partner has two steps starting at the same time;
- the steps don't end where `expectEnd` says.

The sample dances in `db/seed.mts` refer to figures by name. If one of their
figures is missing (because a file was renamed or removed), that sample is
skipped with a warning, and the rest of the seed carries on.

## Not supported yet

Curved paths (all steps travel in straight lines), crossing positions
(`"cross"`), and stances other than closed hold. These will be added when a
figure needs them.
