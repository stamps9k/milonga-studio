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

| Field         | Meaning                                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | Shown in the library. Must be unique across the figure files.                                                                                  |
| `style`       | Free-form tag that groups the library: `"tango"`, `"waltz"`, `"cha-cha"`, …                                                                    |
| `time`        | Time signature: `"3/4"` or `"4/4"`.                                                                                                            |
| `start`       | Starting stance: `"closed"` (the default), `"crossed promenade"`, `"promenade apart"`, `"tango promenade"` or `"contra check"`. See "Stances". |
| `slow`        | Beats in an S when using `length`. Default 2 (so a Q is 1). Use `1` for tango-style counting.                                                  |
| `steps`       | The steps, in time order.                                                                                                                      |
| `expectEnd`   | Optional, but recommended: where the figure should finish. See below.                                                                          |
| `expectBeats` | Optional, but recommended: how many beats the figure lasts. See below.                                                                         |
| `skipChecks`  | Only for figures known to be wrong: checks to leave out until they're fixed. See "What gets checked".                                          |
| `notes`       | Optional free text for whoever edits the file: sources, caveats, open questions. Not shown in the app.                                         |

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

On a step that turns, the partners keep their places in the hold, so the
couple turns together round a **turning centre**, and their steps differ:
whoever is on the outside of the turn travels further. The step you write is
the centre's step. Choose the centre with `"turnCentre"` on the row:

- `"lead"`: he takes the step as written, and she travels round him;
- `"follow"`: she takes the mirror of it (his 0.4 forward is her 0.4 back), and
  he travels round her;
- `"between"`: the point halfway between their moving feet takes it, and both
  travel round it, as in a pivot.

Left out, the centre is whoever the step sends backward, since the partner
going back is on the inside of an ordinary turn: the lead when he steps back,
the follow when he steps forward, and the point between them for a step
straight to the side. So on a forward turning step, write the follow's step
as the lead would describe it, and he swings round her:

```json
{
  "both": { "forward": 0.4, "right": 0.5 },
  "turn": { "right": "1/4" },
  "beat": 2
}
```

is Box Turn (forward half)'s count 2: she goes 0.4 back and 0.5 to her left,
and he lands 0.9 forward and 0.2 right of where his foot was.
`"turnCentre"` only goes with `both` and a `turn`, on a step that travels.

Put a `both` turn on a travelling step, or on the close straight after one.
On a close, the bodies keep turning through it, as a chart's "1/8 between 2 and
3": the feet were already placed for the whole turn by the step before, so they
land exactly where they would with all the turn on that step, while each body
turns on its own count. For example, the book's box turn turns the bodies an
eighth on the side step and an eighth on the close:

```json
{ "both": { "forward": 0.4, "right": 0.5 }, "turn": { "right": "1/8" }, "pointing": { "follow": { "right": "1/8" } }, "beat": 2 },
{ "both": "close", "turn": { "right": "1/8" }, "beat": 3 }
```

A turn can also start earlier, spread over several mirrored steps (a chart's
"commence to turn" on count 1): the couple still ends exactly in hold. Starting
the turn on count 1 is what keeps the partner on the outside of a turn from
lunging round on count 2; see the backward halves of the box turns.

A turn on a `both` close needs a mirrored travelling step before it. A turn on
a `both` in place or pivot is an error, because each partner would turn on
their own standing foot and the hold would come apart.

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
{ "both": { "forward": 0.9, "right": 0.2 }, "beat": 2 }
```

is the same as `"both": 12.5288…, "by": 0.9220…`. Like the other directions, it's
measured from the facing before the step's turn. With `both`, the follow
mirrors it (his 0.9 forward is her 0.9 back). A partner can be written as an
offset directly (`"lead": { "right": -0.2 }`) or as `"go"` inside a partner
object with its own options. The default label describes the offset, such as
"0.9 forward, 0.2 right".

### Options

Write these on the row, where they apply to `both` and to a partner written as
just an action, or inside a partner object.

| Option            | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"by"`            | Distance in metres.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `"turn"`          | `{ "right": "1/8" }` (clockwise, natural) or `{ "left": "3/8" }` (anticlockwise, reverse). A plain number such as `0.125` also works.                                                                                                                                                                                                                                                                                                                                                                            |
| `"pointing"`      | How much further round than the body the moving foot points when it lands, written like `turn` and measured from the body's facing after the step's turn. A chart's "3/8 between 1 and 2, body turns less" is `"turn": { "right": "1/4" }` (the body) with `"pointing": { "right": "1/8" }` (the foot the rest of the way). On a row it can be one each: `{ "follow": { "right": "1/8" } }`. Default: the way the body faces. See "Foot direction" below.                                                        |
| `"foot"`          | `"L"` or `"R"`. Usually left out; see below. With `both`, it's the lead's foot.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `"rise"`          | Rise at the end of the step, in metres (e.g. `0.05`). Default 0.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `"riseTiming"`    | `"late"`: the rise holds and changes at the end of the step, for a chart's "commence to rise at end of 1" or "lower at end of 3". Default `"even"`: it changes steadily across the step ("continue to rise on 2").                                                                                                                                                                                                                                                                                               |
| `"bodyOffset"`    | Optional pelvis displacement in metres, e.g. `{ "forward": 0.05, "right": 0.03 }`, measured in each dancer's facing after the turn. Independent of foot mirroring, including on `both` rows. Interpolates linearly from the previous displacement; omission returns to zero. Feet and support weights are unchanged. Used provisionally in Closed Promenade to keep hips close while the feet leave a passing channel.                                                                                           |
| `"footwork"`      | The chart's footwork: letters for the parts of the foot that meet the floor, in order, H heel, T toe, B ball, F flat (`"HT"`, `"T"`, `"TH"`, `"BF"`). The first letter decides how the foot lands: heel first (toes up), toe or ball first (heel up), or flat. On a row it can be one each: `{ "lead": "HT", "follow": "TH" }`. Default: none, the foot travels flat.                                                                                                                                            |
| `"weight": false` | A step without weight, such as a tap: the foot moves, the weight stays.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `"air": true`     | An airborne action (boleo, gancho): the free leg goes out and back, carrying no weight.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `"pathSetOff"`    | Optional departure angle in degrees clockwise from this dancer's facing before the step. Requires `path`; overrides its preset departure while preserving the landing point. For example, Closed Promenade uses -50 for lead and +50 for follow to pass close beneath the hips. Compiles to the existing arc `setOff`, so no database/snapshot field is added.                                                                                                                                                   |
| `"cross": true`   | The step crosses the feet on purpose (a whisk's cross behind). Without it, a step may not put the left foot to the right of the right foot. See "What gets checked".                                                                                                                                                                                                                                                                                                                                             |
| `"path"`          | The foot curves instead of going straight, and lands where the step says. `"around the front"`: it sets off the way the dancer faces (before the step's turn), for a foot that swings round in front of the body on a turning step. `"around the back"`: it sets off diagonally back towards the side it lands on, so it passes behind the standing foot; use it to uncross feet that crossed with this foot behind (the Open Natural Turn's count 2). The curve may turn at most 120° from the way it sets off. |
| `"label"`         | Text shown for the step. One string, or `{ "lead": …, "follow": … }`. Default: generated.                                                                                                                                                                                                                                                                                                                                                                                                                        |

### How a foot travels

A step written as a direction or an offset lands where it says, but the foot
doesn't slide there in a straight line. If it passes the standing foot on the
way (a walk forward or back, or a diagonal that goes past it), it curves in to
pass close beside it, about 10 cm centre to centre, as feet brush past each
other. It keeps a centimetre between the feet's outlines, so feet pointing
different ways pass a little wider. It comes in only as far as the partner's
feet allow, so a lead's right
foot walking between the follow's feet stays nearly straight. Side steps and
closes go straight. Use `"path"` for a foot that should go round the front or
the back instead.

On a row, `path` and `pathSetOff` can name partners separately, for example
`"path": { "lead": "around the back" }` and
`"pathSetOff": { "lead": -144 }`. An omitted partner keeps the ordinary route.
The angles use each dancer's facing before the step. This lets the lead in
Back Corté pass round the standing foot without changing the follow's route
or either landing point. A partner written as an object with `go` still uses
only its own options. These authoring options compile to existing movements;
there is no new database or snapshot field.

### Foot direction

`turn` turns the body; a foot points the way the body faces unless the step
says `pointing`. Ballroom charts give each partner's **amount of turn** for
the feet, and add "body turns less" where the body lags behind, so write the
body's turn as `turn` and the rest as `pointing`. The bodies stay in hold:
on a mirrored turning step both partners' bodies turn the same, while the
partner on the inside of the turn usually points the foot further round.

The other foot follows the body. While the body turns towards the way it
points it stays put (the body catches up, a chart's "body completes the
turn"); once the body faces the way it points, or turns away from it, it
swivels with the body.

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
  in front and 10 cm to his right (as in real closed hold, where the partners
  are offset rather than toe to toe): his right foot is straight in front of
  the gap between her feet. By default the lead stands on his right and the
  follow on her left.
- **`"crossed promenade"`**: where a whisk ends. From closed hold, each partner
  has opened an eighth (the lead to his left, the follow to her right) into a V
  that opens to the lead's left. The crossing foot (the lead's left, the
  follow's right) is 25 cm behind the other foot and 5 cm across it, in the
  opened facing. The lead's right foot is at the origin, the follow's left foot
  is 40 cm in front of it and 10 cm to its right (the closed hold's offset),
  and before opening the lead faced line of dance. So the lead faces 315° and
  the follow 225°, and she is 10 cm behind him along the line of travel, as in
  a real promenade. By default each partner stands on
  the crossed foot.

- **`"promenade apart"`**: where the Promenade Chassé ends. It's the same V, in
  the same frame (the lead faces 315°, the follow 225°, and the line of travel
  runs towards −x), but with the feet apart. The lead's left foot is at the
  origin, the follow's right is about 54 cm from it across the line (the
  chassé separates the partners by about 7 cm each to make room for the next
  stride) and 10 cm behind it along the line, and each
  partner's other foot is 40 cm back along the line and 10 cm to the side,
  where it closed. By default each partner stands on the leading foot (the
  lead's left, the follow's right).
- **`"tango promenade"`**: the ballroom tango promenade, where the Progressive
  Link ends and the Closed Promenade starts. The same V and frame (the lead
  faces 315°, the follow 225°, travel towards −x), with the feet apart and
  uncrossed. The lead's right foot is at the origin and his left 60 cm along
  the line of travel; the follow's left is 40 cm across the line from his right
  and 10 cm behind it along the line, and her right 60 cm along the line from
  her left. By default each
  partner stands on the inside foot (the lead's right, the follow's left).

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
  start of a figure that starts in `"crossed promenade"` or `"contra check"`
  until they first uncross. While the feet are crossed, the foot in front must stay in front,
  so they uncross the way they crossed: if the foot that was behind came out
  in front, its leg would have gone through the other leg. To uncross a foot
  that crossed behind, take it `"path": "around the back"`;
- at any moment, one of a dancer's own feet overlaps the other (feet are
  treated as footprints about 26 cm long and 9 cm wide, pointing the way each
  foot points), except while they are crossed by a step with `"cross": true`;
- at any moment, one of the lead's feet comes within 10 cm of one of the
  follow's feet, centre to centre, so one would tread on the other (a foot is
  about 9 cm wide, so walking forward in the offset hold, his foot passing 10 cm
  beside hers, is allowed);
- after any step (once every step on its row has finished), the partners
  aren't in hold. The follow's weight must be within 20 cm of where closed hold
  or promenade puts it from the lead's, and she must face within 30° of the
  way that position faces. A row explicitly marked `"hold": "opposed promenade"`
  instead checks an opposite-facing, side-by-side formation: nominally 35 cm
  to the lead's right and 10 cm forward in the lead's frame. This puts the
  backward-moving lead slightly ahead along shared travel. The same distance
  and facing tolerances apply. The annotation is authoring-only, applies to
  that row alone, and does not enable the new formation on unmarked rows. Mirrored (`both`) steps keep the hold on their own,
  so this mostly checks steps written for `lead` and `follow` separately.

The format retains `"skipChecks"` for historical figure files, listing any of
`"crossed feet"`, `"own feet"`, `"partner spacing"` and `"hold"`. The current
catalogue uses no exclusions: every figure runs all authoring checks, and a
regression test prevents silently reintroducing bypasses. Intentional crosses
use `cross: true` for foot order; dedicated footprint and leg-clearance tests
cover the repaired crossing figures without skipping their crossing intervals.

The sample dances in `db/seed.mts` refer to figures by name. If one of their
figures is missing (because a file was renamed or removed), that sample is
skipped with a warning, and the rest of the seed carries on.

## Not supported yet

Curved paths other than `"around the front"` and `"around the back"`, and
stances other than the named positions above. These will be added when a
figure needs them.

## Continuous Argentine tango practice sequences

The seeded Basic Combination uses Walking Step and Collect → Side Step and
Collect → Cruzada (six Q counts). Ocho Combination uses Walking Step and Collect
→ Weight Change → Ocho (seven Q counts). Each collection takes its own Q and
keeps the weight on the supporting feet. Weight Change takes one Q with the
feet stationary, so Ocho begins on the correct support. These are explicit
catalogue figures and visible sequence entries, not automatic join adjustments.

The collected walk travels 50 cm for full-leg clearance; the original 60 cm
Walking Step and original one-count Side Step remain available with their open
endings. They still require a compatible next figure. The existing Cruzada and
Ocho movements are unchanged. New presets require reseeding; saved/exported
dances retain their embedded figures and sequence entries.

## Waltz contra check and closed recovery

`Contra Check` is the check portion of the figure over three counts: lead LF
forward / follow RF back in a narrowed CBMP track on 1, then hold the shape
through 2–3. It starts from normal closed stance, lead on RF / follow on LF.
The compact 40 cm travel, 14 cm inward placement, 15° left body turn and 3 cm
lowering are provisional dimensions for the owner's subjective review.

`Contra Check Recovery (Closed)` is a descriptive name for the owner-confirmed
beginner back-side-close, not a formal syllabus title or a promenade exit.
On 1, replace weight onto lead RF / follow LF and unwind the contra turn;
on 2, step to the lead's left / follow's right, level with the standing feet;
on 3, close with weight and lower. It finishes in normal closed stance with
lead RF / follow LF weighted, ready for an LF figure or another check.

The new `"contra check"` named stance is the exact checked connection pose:
lead LF at (0.04, 0.4), RF at (0.1, 0); follow RF at (0.14, 0.8), LF at
(0.2, 0.4). The bodies face 345°/165°, the checking feet still point 0°/180°,
and both partners are lowered 3 cm. It is authoring metadata; compiled figures
use the existing pose/step storage with no database or snapshot schema change.
Intentional `cross: true` marks CBMP in the turned body frame. No figure skips
checks, and dense footprint/thigh/shin regressions include the full check,
recovery and boundary under linear and eased playback.

After reseeding, **Open → Waltz contra check practice** loads the six-count
pair at 84 BPM for review. Existing browser saves keep their embedded figures.

### Alternative promenade recovery

`Contra Check Recovery (Promenade)` is a separate selectable three-count
alternative. Its checked entry and count-1 stationary recovery are identical
to the closed recovery. On 2, lead LF / follow RF steps out into promenade,
opening the bodies to 315°/225°. On 3, hold/develop that feet-apart position
and lower without closing or changing support. Timing and dimensions are a
provisional visual proposal; the existing closed back-side-close is unchanged.

It ends in the existing `"promenade apart"` stance, translated by
(-0.3707106781, -0.0707106781) in the original closed frame. Both initially
supporting feet remain in place. Lead LF / follow RF are weighted at the
finish, ready for Open Natural Turn with matching positions, directions,
weights, rise and facing. No new stance, persisted field or check exception
is needed. Both recovery variants receive the full dense clearance tests.

After reseeding, **Open → Waltz contra check promenade practice** loads the
check plus this alternative; the original **Waltz contra check practice**
continues to load the closed option.

### Waltz weave and separate promenade close

`weave-from-promenade.json` is one six-count figure (two bars of 3/4), with
alternating support on every count. It uses the owner's feet-apart
`promenade apart` stance, without a Whisk or required preceding figure.
Promenade Chassé and Contra Check Recovery (Promenade) both connect to its entry.

The first two counts are preserved. On 3 both partners continue the follow's
left pivot together through a quarter turn (lead 270° to 180°, follow 90° to 0°).
Their relative sides swap, and the couple's centre travels northwest instead
of reversing east. This is within the owner's requested eighth-to-quarter
bias back towards the opening line. The outer lead route and compact follow
passing route keep the shared pivot together; a common 12 cm southward pelvis
displacement lets the hips follow it within ordinary reach and balance limits.

Counts 4–5 follow the new northward heading: lead backward and follow forward,
shoulder-to-shoulder with opposite facings. Lateral torso spacing remains
34–38 cm at count landings, with the lead 15 cm ahead along shared travel.
Rows 2–5 retain the checked `opposed promenade` formation. Count 4's follow arc
fits the new third landing; the remaining local movement/shaping retains the
accepted pattern, reoriented with the turn. Count 6 still opens to an exact
`promenade apart` stance, now rotated 180°, preserving all compatible joins.
The turn, dimensions and routes are provisional for subjective review.

`promenade-walk-and-close.json` is a separate three-count finish: inner feet
step through, outer feet step side/uncross, then the inner feet collect in
ordinary closed hold, lead RF / follow LF weighted. This descriptive name and
three equal counts reflect the owner's confirmed class ending; the owner
clarified that it comes **after** the six-count weave. It uses the reviewed
opening passing route and a compact uncrossing adapted from Closed Promenade,
with provisional waltz rise. Its collected exit connects to LF Closed Change
or Contra Check.

**Waltz weave practice** includes both figures, nine counts altogether. They
remain separately selectable so either can be used with another compatible
figure. Regression tests check the synchronized third-count pivot, side exchange,
opening-direction progress, opposed spacing and genuine subsequent travel, exact incoming/outgoing connections, and all footprint/thigh/shin
pairs across all nine counts and their join with linear/eased playback.
Normal reach, lowering and balance limits apply; there are no `skipChecks`.
The authoring parser and JSON editor schema both support the row-level hold
annotation. No persisted Pose/Step fields, database schema or snapshot version
change is needed.

The [BallroomDancers.com](https://www.ballroomdancers.com/dances/info.asp?sid=495)
and [Ballroom Guide](https://ballroomguide.github.io/BallroomGuide/standard/waltz/weave_from_pp.html)
references provide six-count weave context. The owner's path, modest preparation
turns, compact stride lengths, underturned alignment and curved passing routes
are modelling choices for subjective review, not an exact syllabus chart or a
claim that the separate finish has a formal syllabus name.
