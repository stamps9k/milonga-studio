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

## Editor help

Each figure file starts with:

```json
"$schema": "../figure.schema.json",
```

That line points your editor at `db/figure.schema.json`, which describes the
format. VS Code then autocompletes field names and directions as you type,
shows a short description when you hover over a field, and underlines
mistakes such as `"beats"` instead of `"beat"` or `"forwards"` instead of
`"forward"`. Keep the line when you copy a file. The app and the seed ignore
it.

The schema checks the file's shape only. Whether the steps make sense as
dancing (weight, timing, `expectEnd`) is checked when you run the reset.

If anything is wrong in any figure file, the reset stops before touching the
database and lists every problem, each with its file name and where in the
file it is. `npm test` runs the same checks.

To try out figures without changing `db/figures/`, put them in another folder
and run `FIGURES_DIR=path/to/folder npm run db:reset`.

## A complete example

```json
{
  "$schema": "../figure.schema.json",
  "name": "LF Closed Change",
  "style": "waltz",
  "time": "3/4",
  "notes": "Forward on the left foot, side on the right, close.",
  "steps": [
    { "both": "forward", "by": 0.5, "foot": "L", "beat": 1 },
    { "both": { "forward": 0.5, "right": 0.2 }, "beat": 2, "label": "side" },
    { "both": "close", "beat": 3 }
  ],
  "expectBeats": 3,
  "expectEnd": {
    "stance": "closed",
    "moved": { "forward": 0.5, "right": 0.2 },
    "leadStandingOn": "L"
  }
}
```

## The figure

| Field         | Meaning                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `name`        | Shown in the library. Must be unique across the figure files.                                           |
| `style`       | Free-form tag that groups the library: `"tango"`, `"waltz"`, `"cha-cha"`, …                             |
| `time`        | Time signature: `"3/4"` or `"4/4"`.                                                                     |
| `start`       | Starting stance: `"closed"` (the default), `"crossed promenade"` or `"promenade apart"`. See "Stances". |
| `slow`        | Beats in an S when using `length`. Default 2 (so a Q is 1). Use `1` for tango-style counting.           |
| `steps`       | The steps, in time order.                                                                               |
| `expectEnd`   | Optional, but recommended: where the figure should finish. See below.                                   |
| `expectBeats` | Optional, but recommended: how many beats the figure lasts. See below.                                  |
| `skipChecks`  | Only for figures known to be wrong: checks to leave out until they're fixed. See "What gets checked".   |
| `notes`       | Optional free text for whoever edits the file: sources, caveats, open questions. Not shown in the app.  |

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

On a step that turns, the follow stays in the same place relative to the lead,
so the couple turns together. Her step then differs from his: whoever is on
the outside of the turn travels further. Put a `both` turn on a travelling
step. A turn on a `both` close, in place or pivot is an error, because each
partner would turn on their own standing foot and the hold would come apart.

A partner can be written as just an action (`"lead": "forward"`, using the
options on the row), or as an object with its own options:

```json
{ "follow": { "go": "pivot", "turn": { "left": "1/8" } }, "length": "Q" }
```

### Actions

| Action                                               | Meaning                                                                                               |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `"forward"`, `"back"`, `"side left"`, `"side right"` | Travel that way, relative to the dancer's own facing. Needs `by`.                                     |
| `"diagonal forward left"` and the other diagonals    | The same, at 45°.                                                                                     |
| a number, such as `10` or `-10`                      | Degrees clockwise from forward, for angles in between. Needs `by`.                                    |
| `{ "forward": 0.9, "right": 0.2 }`                   | Travel this far forward and right, in metres. No `by`. See below.                                     |
| `"close"`                                            | Bring the free foot beside the standing foot (stance width apart, or `by` apart), then change weight. |
| `"in place"`                                         | Change weight onto the free foot without moving it (a recover).                                       |
| `"pivot"`                                            | Turn on the standing foot without moving it. Needs `turn`.                                            |

The four diagonals are `"diagonal forward left"`, `"diagonal forward right"`,
`"diagonal back left"` and `"diagonal back right"`. Directions are measured
from the way the dancer faces **before** the step's turn.

On a **close**, the playback brings the foot in over the first two thirds of
the step and changes weight in the last third, the way a close is danced. Every
other step moves the weight evenly across the step. For a close that doesn't
change weight at all (a tango collect, say), add `"weight": false`.

An **offset** says where the moving foot goes: so many metres forward and so
many to the right of where it is now, with negative numbers for back and left.
Either part can be left out. It's the same step as a number of degrees with
`by`, but reads as the move you have in mind and avoids long decimals:

```json
{
  "both": { "forward": 0.9, "right": 0.2 },
  "turn": { "right": "1/4" },
  "beat": 2
}
```

is the same as `"both": 12.5288…, "by": 0.9220…`. Like the other directions, it's
measured from the facing before the step's turn. With `both`, the follow
mirrors it (his 0.9 forward is her 0.9 back). A partner can be written as an
offset directly (`"lead": { "right": -0.2 }`) or as `"go"` inside a partner
object with its own options. The default label describes the offset, such as
"0.9 forward, 0.2 right, turning 1/4 right".

### Options

Write these on the row, where they apply to `both` and to a partner written as
just an action, or inside a partner object.

| Option            | Meaning                                                                                                                                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"by"`            | Distance in metres.                                                                                                                                                                                                                                                             |
| `"turn"`          | `{ "right": "1/8" }` (clockwise, natural) or `{ "left": "3/8" }` (anticlockwise, reverse). A plain number such as `0.125` also works.                                                                                                                                           |
| `"foot"`          | `"L"` or `"R"`. Usually left out; see below. With `both`, it's the lead's foot.                                                                                                                                                                                                 |
| `"rise"`          | Rise at the end of the step, in metres (e.g. `0.05`). Default 0.                                                                                                                                                                                                                |
| `"weight": false` | A step without weight, such as a tap: the foot moves, the weight stays.                                                                                                                                                                                                         |
| `"air": true`     | An airborne action (boleo, gancho): the free leg goes out and back, carrying no weight.                                                                                                                                                                                         |
| `"cross": true`   | The step crosses the feet on purpose (a whisk's cross behind). Without it, a step may not put the left foot to the right of the right foot. See "What gets checked".                                                                                                            |
| `"path"`          | `"around the front"`: the foot curves instead of going straight. It sets off the way the dancer faces (before the step's turn) and curves round to land where the step says, for a foot that swings round in front of the body on a turning step. At most 120° from the facing. |
| `"label"`         | Text shown for the step. One string, or `{ "lead": …, "follow": … }`. Default: generated.                                                                                                                                                                                       |

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

## Stances

A stance is a named position for both partners, used by `start` and by
`expectEnd`'s `stance`.

- **`"closed"`**: closed hold. The midpoint of the lead's feet is at the origin,
  feet 20 cm apart. The lead faces line of dance and the follow faces him, 40 cm
  in front. By default the lead stands on his right and the follow on her left.
- **`"crossed promenade"`**: where a whisk ends. From closed hold, each partner
  has opened an eighth (the lead to his left, the follow to her right) into a V
  that opens to the lead's left. The crossing foot (the lead's left, the
  follow's right) is 25 cm behind the other foot and 5 cm across it, in the
  opened facing. The lead's right foot is at the origin, the follow's left foot
  is 40 cm in front of it, and before opening the lead faced line of dance. So
  the lead faces 315° and the follow 225°. By default each partner stands on
  the crossed foot.

- **`"promenade apart"`**: where the Promenade Chassé ends. It's the same V, in
  the same frame (the lead faces 315°, the follow 225°, and the line of travel
  runs towards −x), but with the feet apart. The lead's left foot is at the
  origin, the follow's right is 40 cm from it across the line, and each
  partner's other foot is 40 cm back along the line and 10 cm to the side,
  where it closed. By default each partner stands on the leading foot (the
  lead's left, the follow's right).

`"crossed promenade"` measures from the lead's right foot rather than the
middle of his feet, so a whisk's ending reads as where that foot went:

```json
"expectEnd": {
  "stance": "crossed promenade",
  "moved": { "forward": 0.5, "right": 0.3 },
  "leadStandingOn": "L"
}
```

A figure that starts in a stance is placed after the previous figure by
matching the stances, so a figure starting in `"crossed promenade"` follows a
whisk with no gap. It's called "crossed" because a feet-apart promenade, such
as tango's, starts differently and would be a separate stance.

## Checking the length: `expectBeats`

The figure's length in beats is also worked out from the steps: the latest
point any step finishes. `expectBeats` states how long it should be, as an
independent check on the timing. It catches, for example, a `"Q"` written
where an `"S"` was meant, which `expectEnd` can't see.

```json
"expectBeats": 3,
```

It's optional, but every figure in `db/figures/` has one.

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
- the steps don't end where `expectEnd` says, or don't last as many beats as
  `expectBeats` says;
- at any moment, a dancer's left foot is to the right of their right foot, in
  their own frame (the feet are crossed). Crossing is allowed during a step
  marked `"cross": true` and until the feet uncross afterwards, or from the
  start of a figure that starts in `"crossed promenade"` until they first
  uncross;
- at any moment, one of the lead's feet comes within 15 cm of one of the
  follow's feet, centre to centre, so one would tread on the other.

The last two are checked through the whole figure, not just at its end. A
figure known to be wrong can skip them until it's rewritten, with
`"skipChecks": ["crossed feet", "partner spacing"]` (either or both). Say why in
`notes`, and remove it once the figure is fixed.

The sample dances in `db/seed.mts` refer to figures by name. If one of their
figures is missing (because a file was renamed or removed), that sample is
skipped with a warning, and the rest of the seed carries on.

## Not supported yet

Curved paths other than `"around the front"`, and stances other than closed
hold and the two promenades. These
will be added when a figure needs them.
