# Dance model guidance

This folder is the domain model and simulation core. It is shared by the 2D
renderer, the future 3D renderer, the API (`api/assemble.mts`) and the
database schema (`db/schema.sql`), so changes here ripple outward. The root
`AGENTS.md` still applies; this file adds the conventions specific to the
model. Where a convention below is marked provisional, it is the current
implementation's choice, not a confirmed dance rule.

## Module overview

- `step.mts`: `DanceStep`, `Movement`, `Figure`, `TimeSignature` and related
  types. A step is a delta for one foot of one partner.
- `pose.mts`: `Point2D`, `FootState`, `PartnerPose`, `Pose`. A pose is the
  resolved state of all four feet and both frames at one instant.
- `sequence.mts`: `FloorTransform`, `SequenceEntry`, `Sequence`.
- `dance.mts`: `Dance`, the saved/shared record wrapping a sequence with
  tempo, notes and `schemaVersion`.
- `heading.mts`: the shared angle and vector primitives. Use these instead of
  writing new trigonometry.
- `fold.mts`: folds a figure's steps into foot trails and interpolated poses
  over time, at figure and sequence level.
- `floor.mts`: applies floor transforms and fits the transform that chains
  one figure onto the end of the previous one.
- `join.mts`: measures how cleanly one figure follows another (foot gaps,
  facing changes, stepping off a weighted foot) once placed.
- `serialize.mts`: converts builder state into a `Sequence` record.

Everything here is plain data and pure functions with no React, DOM or
network dependencies. Keep it that way so it stays testable under `node:test`
and usable by any renderer.

## Coordinate and heading conventions

- Floor space is a 2D plane with +Y as "north", meaning the line of dance and
  the direction a figure's local frame faces at 0 degrees. +X is "east".
- Every heading-like value (`DanceStep.orientation`,
  `PartnerPose.orientation`, `Movement.direction`, `FloorTransform.rotation`)
  is in degrees, uses 0 = +Y, and increases clockwise, like a compass
  bearing. This is not the usual maths convention (0 = +X,
  counterclockwise). `heading.mts` documents and implements it. A movement
  with `direction: 90` travels purely in +X.
- Normalize stored and computed headings to [0, 360) with
  `normalizeDegrees`. Interpolate headings with `lerpAngleDegrees`, which
  takes the shortest way round (350 to 10 is a 20-degree turn).
- `Movement.arc` curvature is signed: positive curves right (clockwise),
  negative curves left. It is never exactly 0; a straight path must use the
  `straight` variant so consumers can pattern-match instead of comparing
  floats.
- A pivot is a `straight` movement with distance 0 plus a changed
  `orientation`. It does not need its own variant.
- Renderers convert floor space to screen space themselves. `Canvas2D` flips
  Y so floor-north is screen-up. Do not bake screen conventions into the
  model.

## Units

- Lengths (`distance`, `arcLength`, positions, `rise`) are in floor units.
  The `Movement` type comment suggests centimetres as an example, but the
  seed data and tests use metre-scale values (a walking step is `0.6`). Treat
  metres as the working convention. The unit is not yet formally fixed, so
  flag any change that depends on it, and update the `step.mts` comment if
  the owner confirms a unit.
- Curvature is 1 / radius in the same floor units.
- `weight` is 0 to 1: the share of the partner's weight on that foot at the
  end of the step. 0 for airborne actions and pure embellishments.
- `rise` is vertical displacement from neutral standing height, used for
  waltz-style rise and fall and left at 0 for flat styles.

## Timing

- `DanceStep.beat` is 1-indexed within the figure, and `duration` is in
  beats and may be fractional (for quick-quick-slow phrasing). A step
  occupies the local interval `[beat - 1, beat - 1 + duration)`.
- A figure's length is the latest point any step finishes
  (`figureDurationBeats`). Sequences play entries back to back.
- Steps are stored interleaved for both partners and sorted by `beat` when
  folded. Both partners often step at the same time with different
  durations, so "current step" is tracked per partner.
- Tempo lives on `Dance`, not on figures. The model works in beats; seconds
  only appear at playback.

## Frames, placement and derived data

- Every figure is authored in its own local frame, starting at the origin
  and facing 0 degrees. Where a figure actually sits on the floor belongs to
  its `SequenceEntry.transform`, never to the figure.
- `FloorTransform` rotates about the origin first, then translates.
- `fitTransform` chains figures by placing a figure's `startPose` onto the
  previous entry's `resolvedEndPose`: the rotation lines up the lead's
  frame, then the translation lines up the foot centroids. The fit is exact
  when figures are authored to connect. `assessJoin` (`join.mts`) measures
  whatever doesn't line up after that placement.
- `resolvedStartPose` and `resolvedEndPose` are caches derived from `figure`
  and `transform`. Recompute them when either changes; never edit them
  independently.
- `Figure.startPose` and `endPose` are currently hand-authored and are not
  guaranteed to equal the result of folding the figure's steps. Code in
  `fold.mts` does not assume they match, and new code should not either,
  unless it adds an explicit consistency check. For the seeded figures,
  `test/db/seed.test.mts` checks that they agree, so a seed change that
  breaks that fails the tests.
- Airborne (`contact: "air"`) steps describe a path for rendering but carry
  no weight and do not move the foot's resting position for the next step.
  `poseAtBeat` animates the foot out along the movement and back; the floor
  trails from `figureFootTrails` leave airborne steps out, because a trail
  records where feet are placed.
- A travelling step moves the partner's free foot, not the one carrying all
  of their weight. Zero-distance steps (weight changes and pivots) are
  exempt. The seed follows this, and `test/db/seed.test.mts` checks it.

## Provisional modelling choices

These are implementation choices that have not been checked against real
technique. Keep them labelled as provisional in comments, and raise them with
the owner before building more on top of them.

- An arc's initial tangent is the partner's frame orientation immediately
  before the step (`arcEndpoint` in `fold.mts`). No seeded figure uses arcs
  yet, for this reason.
- Weight, orientation and rise are interpolated linearly across a step's
  interval. The schema only records their values at the end of each step.
- An airborne step's excursion goes out along its movement for the first
  half of the step and retraces it for the second half
  (`airborneExcursionAt` in `fold.mts`).
- `fitTransform` takes the couple's facing from the lead's frame alone and
  ignores the follow's, which can legitimately differ (the Ocho). Any
  follow facing difference is reported by `assessJoin` instead.
- `assessJoin`'s tolerances (`JOIN_FOOT_GAP_TOLERANCE`, 5 cm, and
  `JOIN_FACING_TOLERANCE`, 10 degrees) are judgement calls, not technique.
- Seed figures (`db/seed.mts`) are plausible test data, not syllabus
  transcriptions. Seeded sequences are chained with `fitTransform`, like
  the app's sequence builder. The waltz and cha-cha sequences join
  cleanly; the tango ones don't yet (see `test/db/seed.test.mts`).
- The free-foot rule above, and the rule that one partner never has two
  steps in progress at once, are checked against the seed as provisional
  rules.

## Terminology

Use the existing domain terms in names, comments and the UI:

- Lead and follow (`Partner`), never "man/woman" or "leader/follower".
- Figure: a named, reusable pattern of steps, such as Walking Step, Cruzada
  or Ocho. Sequence: an ordered chain of figure occurrences. Dance: a saved
  sequence plus metadata.
- Step: one foot movement by one partner. Pose: the resolved couple state at
  an instant. Frame or orientation: the torso heading.
- Style: a free-form tag (`tango`, `waltz`, `cha-cha`, ...). Nothing in the
  model is style-specific, so avoid adding style-specific branches.
- Line of dance: the direction of travel around the floor, which is +Y and 0
  degrees in a figure's local frame.

## Changing the model

- Keep the detailed explanatory comments in these modules accurate. When
  behaviour changes, update the comment in the same commit.
- Persisted type changes need matching schema, assembly and seed updates and
  may need a `Dance.schemaVersion` bump (see the root `AGENTS.md`).
- Test geometry with tolerances, not exact equality. The existing suites use
  helpers such as `assertPoseClose` and `pointClose` with a small epsilon;
  reuse that pattern. Prefer worked examples whose expected values can be
  checked by hand (for example, a 90-degree movement of 0.3 ending at
  `(0.3, 0)`).
