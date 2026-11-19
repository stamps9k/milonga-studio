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
- `footprints.mts`: where and when each foot is placed in a sequence
  (`sequenceFootprints`), numbered with its count, and which placements
  are taken or coming up at an instant (`footprintsAtBeat`).
- `serialize.mts`: converts builder state into a `Sequence` record.
- `persistence.mts`: validates saved/shared Dance snapshots and legacy bare
  Sequence JSON. Input limits bound rendering/metronome work, not technique.
  Rebuilds cached resolved poses while preserving saved floor transforms and
  authored figure poses. Do not run provisional figure-authoring checks on
  imported snapshots; legacy snapshots may contain figures from before the
  catalogue repairs. Version 1 is the existing Dance shape, unchanged by local saving.
- `tempo.mts`: the playback tempo range and the metronome's clicks for a
  sequence (`metronomeClicks`: one as each count lands, at the end of its
  beat, count 1 of each bar accented, bars running on across figures).
- `weight.mts`: where a partner's weight is on the floor (`centerOfWeight`)
  and which foot is the standing foot; `bodyPosition` adds the optional
  horizontal pelvis displacement for both renderers.
- `authoring.mts`: `defineFigure`, which turns a dancer-level description
  (relative directions, mirrored steps, counts) into a figure's steps and
  poses and checks it, and `parseFigureDefinition`, which checks the shape
  of a JSON figure file. Used by the seed figures in `db/figures/*.json`;
  the guide is `db/FIGURES.md`.

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
- Renderers convert floor space to screen space themselves. `Renderer2D` flips
  Y so floor-north is screen-up. Do not bake screen conventions into the
  model.

## Units

- The floor unit is the metre (owner's decision, 2026-11-17, ahead of the
  3D view, which needs real body sizes). Lengths (`distance`, `arcLength`,
  positions, `rise`) are all in metres: a walking step is about `0.5`, the
  closed stance's feet are `0.2` apart. Write "metres" rather than "floor
  units" in new comments.
- Curvature is 1 / radius, in 1/metres.
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
  only appear at playback (`usePlayback` advances at the tempo the user
  sets with `useTempo`; the per-dance starting tempos are there too, not
  in the model, since they're about music rather than steps).
- Bars come from each figure's `timeSignature` and run continuously
  through a sequence, because figures needn't fill whole bars (a tango
  S Q Q S is a bar and a half of 2/4). A change of time signature starts
  a new bar (`metronomeClicks`).

## Frames, placement and derived data

- Every figure is authored in its own local frame: the frame of the named
  stance it starts in (`stancePose` in `authoring.mts`). For closed hold
  that is the lead's feet centred on the origin, facing 0 degrees. For
  the two promenade stances it is the closed hold the couple opened from,
  so the lead starts facing 315 (owner's decision, 2026-11-16, to keep promenade
  figures' numbers readable). Where a figure actually sits on the floor
  belongs to its `SequenceEntry.transform`, never to the figure; chaining
  lines up the lead's facing whatever it starts at.
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
  unless it adds an explicit consistency check. Seeded figures are written
  with `defineFigure`, which calculates `endPose` by folding the steps and
  checks it against the figure's optional `expectEnd`.
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

- An arc sets off along the partner's frame orientation immediately
  before the step, turned by the arc's optional `setOff` (degrees, 0 when
  left out; `arcHeading` in `fold.mts`). `defineFigure` builds arcs only
  for a step's `path` (`curveAround`): `"around the front"` sets off the
  way the dancer faces, `"around the back"` diagonally back towards the
  landing side (`AROUND_THE_BACK_SET_OFF`, provisional). The Open Natural
  Turn's uncrossing uses `"around the back"` with a -100-degree departure
  after its clearance repair. Closed Promenade overrides
  that preset with authoring-only `pathSetOff` (degrees clockwise from each
  dancer before the step): -50 lead / +50 follow, making shallow arcs
  almost along travel instead of the wide 135-degree back swing.
  Row `path` and `pathSetOff` can also name lead/follow separately; an
  omitted partner keeps the ordinary route. This lets Back Corté curve only
  the lead's third step without changing the follow's mirrored placement. The
  result uses existing `Movement.arc.setOff`; no new persisted field.
  Trails draw arcs as curves (`ARC_TRAIL_SAMPLES`).
- A straight step's foot passes close beside the standing foot when its
  line runs past it (a walk, forward or back, or a diagonal that passes
  the standing foot), as feet brush past each other, rather than
  travelling the straight line (`passingPoint` and `stepPassings` in
  `fold.mts`, 2026-11-17, provisional). The stored movement is unchanged
  and still says where the foot lands; only the route is worked out
  while folding. The foot comes in to `PASSING_GAP` (10 cm, centre to
  centre) from the standing foot, but only as far as the partner's
  standing feet allow (10 cm from them too): in the offset hold the
  lead's right foot walks between the follow's feet, so it mostly stays
  straight. Side steps, closes, airborne steps and arcs keep their own
  routes. Decided once per step from where the feet are when it starts,
  so playback, trails and the figure checks agree. The two curve pieces
  share the step's time by their lengths, so the foot keeps an even
  pace. The foot also comes in only as far as keeps the two feet's
  outlines (`footprintGap`) a centimetre apart, so feet pointing
  different ways, as in a turn, pass a little wider than parallel ones.
- A moving foot travels at a steady speed along its path unless the
  caller passes `PoseOptions.footEasing`; both renderers pass `footEase`
  (smoothstep: the foot sets off gently and lands softly, and is halfway
  at half time). Provisional (2026-11-17). Easing never changes where a
  foot ends up, so the checks and footprints are unaffected.
- Rise and footwork (2026-11-17, before the figure clean-up, so charts
  are transcribed once): `DanceStep.riseTiming: "late"` holds the rise and
  changes it over the last third of the step (`LATE_RISE_SHARE`, a
  judgement call), for a chart's "commence to rise at end of 1" or "lower
  at end of 3"; otherwise the rise changes evenly. `DanceStep.footwork`
  keeps the chart's letters ("HT", "T", "TH", "BF": heel, toe, ball,
  flat). Only the first letter is drawn: `footPitchAt` tips the stepping
  foot toes up for a heel lead or heel up for a toe or ball lead, by up
  to `LEAD_PITCH` (20°), growing over the middle of its travel and
  rolling flat as it lands; the pose carries it as `FootState.pitch`
  (only mid-step) and the body solver tips the foot about its heel or
  ball. Being up on the toes after landing comes from the rise, as
  before. There is no default footwork: forward steps are heel leads in
  ballroom but ball-flat in Latin, and the model has no style-specific
  rules, so figures say it. Both are stored (`dance_steps.rise_timing`,
  `dance_steps.footwork`); additive and optional, so no schemaVersion
  bump.
- Weight, orientation and rise are interpolated linearly across a step's
  interval. The schema only records their values at the end of each step.
  The exception is a step with `weightTiming: "late"`: its foot arrives at
  `LATE_WEIGHT_FOOT_SHARE` (two thirds) of the step and the weight changes
  over the rest (`stepPhases` in `fold.mts`). `defineFigure` marks every
  close that takes weight as late. The owner agreed this suits closes in
  all the dances they do (waltz, tango, blues, jitterbug, cha-cha);
  travelling steps stay even until a figure needs otherwise, when a
  per-step option in the figure format is the planned next step.
- `centerOfWeight` remains the weighted-foot support point. `bodyPosition`
  adds optional `bodyOffset` (metres in floor space). The fold interpolates
  that offset linearly to each step target; omission returns to zero. Floor
  placement rotates this vector without translating it. Both renderers and
  the hold check use `bodyPosition`. Figure authoring uses forward/right in
  each dancer's facing after the turn, independently of foot mirroring.
  This additive optional field stays in snapshot schemaVersion 1; old
  snapshots have zero displacement. SQLite needs a reset for the new columns.
- `body/balance.mts` provides lateral balance diagnostics, enforced by
  dense catalogue tests for all figures (no deep-figure exemptions). In each
  dancer's frame, the pelvis may lean at most 10 degrees sideways from the
  weighted-foot support point, measured over the solved hip-to-weighted-ankle
  height. Loaded hip-to-ankle leg angles use a normalised weight RMS, limited
  to 20 degrees; a free leg contributes zero, opposite leans cannot cancel,
  and transfers stay continuous. These are provisional ordinary-dance
  plausibility limits, not human fall thresholds. They ignore forward travel,
  momentum, torso centre-of-mass changes and partner support. Playback and
  imported snapshots are not clamped or rejected by these diagnostics.
- An airborne step's excursion goes out along its movement for the first
  half of the step and retraces it for the second half
  (`airborneExcursionAt` in `fold.mts`).
- `fitTransform` takes the couple's facing from the lead's frame alone and
  ignores the follow's, which can legitimately differ (the Ocho). Any
  follow facing difference is reported by `assessJoin` instead.
- Feet have their own direction (added 2026-11-17, the owner's agreed
  order of model changes): `DanceStep.footDirection` is where the
  stepping foot points as it lands, and `FootState.direction` where a
  foot points in a pose. Both are left out when the foot points the way
  the body faces, so data without them means what it always did; read a
  pose's with `footHeading`. `orientation` stays the body's facing, which
  the hold, the mirroring and the turning centre all use. A stepping foot
  turns as it travels, arriving at its direction. The other foot follows
  `swivelStandingFoot` (provisional): it is never twisted further from
  the body than it already was, so it holds while the body turns towards
  it (a chart's "body completes the turn") and swivels with the body
  once the body passes it or turns away. With nothing pointed that's the
  foot turning with the body, as before. Footprints, the 2D feet, the
  skeleton's feet and the knees (which bend over the toes) use the foot's
  direction. Figure files point a foot with `pointing`, measured from the
  body's facing after the step, so a chart's "3/8 between 1 and 2, body
  turns less" is `turn` 1/4 plus `pointing` 1/8. Turned-out feet, and a
  foot pointing differently from the step's facing at a join, aren't
  checked.
- `assessJoin` applies explicit stationary support transfers before checking
  the first travelling step. A contra-check recovery replaces weight on RF/LF
  before moving LF/RF; using only boundary weights falsely rejected it. Airborne
  steps do not transfer support. It still rejects moving a fully loaded foot.
- `assessJoin`'s tolerances (`JOIN_FOOT_GAP_TOLERANCE`, 5 cm, and
  `JOIN_FACING_TOLERANCE`, 10 degrees) are judgement calls, not technique.
- Seed figures (`db/seed.mts`) are plausible test data, not syllabus
  transcriptions. Seeded sequences are chained with `fitTransform`, like
  the app's sequence builder. All seeded sequences now join cleanly, including
  Argentine tango (see `test/db/seed.test.mts`). Its practice combinations use
  Walking Step and Collect (50 cm walk plus a separate unweighted collection),
  Side Step and Collect (the accepted 35 cm step plus an unweighted collection),
  and Weight Change (one stationary Q before Ocho). Each action has an explicit
  count; there is no boundary teleport or automatic transition. The standalone
  open Walking Step/Side Step and accepted Cruzada/Ocho remain unchanged. Basic
  Combination takes six Q counts; Ocho Combination takes seven. All figure and
  full-leg clearance checks remain active; timing/dimensions are provisional.
- The free-foot rule above, and the rule that one partner never has two
  steps in progress at once, are checked against the seed as provisional
  rules.
- `defineFigure`'s closed stance (feet 20 cm apart, partners 40 cm apart,
  the follow `HOLD_OFFSET`, 10 cm, to the lead's right, so his right foot
  is in line with the gap between hers), its mirroring (the follow uses the
  other foot and travels the same floor direction), "close" (beside the
  standing foot at stance width, across the facing after the turn) and its
  default starting weight (lead on his right, follow on her left) are
  agreed defaults, not technique. The offset hold is the owner's request
  (2026-11-17); its size is half the stance width, at the small end of
  the references' "up to half a body width", and the same for every
  dance (real tango's is larger). Every stance keeps it, so in the
  promenades the follow is 10 cm behind the lead along the line of
  travel, as in real promenade.
- On a turning `both` step the couple keeps its hold and turns round a
  centre (`TurnCentre`, the row's `turnCentre`): "lead" (he takes the
  step as written, she goes round him), "follow" (she takes its mirror,
  he goes round her) or "between" (the point halfway between their moving
  feet takes it). Left out, it's whoever the written step sends backward,
  or "between" for a step straight to the side: references agree the
  partner going backward is on the inside of an ordinary turn, and only
  pivots turn round a point between the partners (owner's decision,
  2026-11-17). So a written turning step is the centre's step, which
  means a forward turning step is the follow's mirror of it. A `both`
  turn on in place or a pivot is still rejected: each partner would
  turn on their own standing foot. A `both` turn on a close is allowed
  (owner's option A, 2026-11-17): the bodies turn on the close, as a
  chart's "1/8 between 2 and 3", but the feet were already placed for it.
  `defineFigure` carries the close's turn back into the previous row's
  foot placement (`carriedTurn`; that row must be a mirrored travelling
  step), while each body turns only by its own row's `turn`. So the
  footprints are those of the whole turn on the travelling step, the
  bodies turn in the book's timing, and the plain closes finish exactly
  in hold. At that travelling step's end the follow is in the position
  of the hold the turn finishes in (about 30 cm further round for an
  eighth), and the hold check judges it against that. A turn may also
  be spread over consecutive mirrored travelling steps (begun on count
  1, as a chart's "commence to turn"): in hold the lead's left foot
  pairs with the follow's right and his right with her left, and each
  pair turns by everything since it was last placed (`pairFacing`), so
  the couple still ends exactly in hold (2026-11-17).
- The "crossed promenade" stance (`authoring.mts`) is the owner's whisk
  ending: each partner opened an eighth, the crossing foot `CROSS_BEHIND`
  (25 cm) behind and `CROSS_ACROSS` (5 cm) across the other, measured
  from the lead's right foot. Its default starting weight is on the
  crossed feet. Standard technique has the follow make most of the
  opening; the even split is the owner's.
- The "promenade apart" stance is where the owner's Promenade Chassé
  ends: the same V and frame as crossed promenade, with each trailing
  foot `PROMENADE_SIDE_STEP` (40 cm) back along the line of travel and
  `PROMENADE_CLOSE_WIDTH` (10 cm) to the side, measured from the lead's
  left foot. The partners are `PROMENADE_SEPARATION` (about 7 cm) further
  apart each than in crossed promenade, to leave room for the Open
  Natural Turn's first stride (owner's request).
- The "tango promenade" stance is where the owner's tango Progressive
  Link ends: the same V and frame, feet apart and uncrossed, each
  outside foot `TANGO_PROMENADE_WIDTH` (60 cm, from the owner's wide
  step) along the line of travel from the inside foot, measured from the
  lead's right foot, partners at closed hold's distance and offset. Its default
  starting weight is on the inside feet.
- The "contra check" stance is the new waltz pair's shared checked pose, in
  the original closed frame. Lead LF / follow RF travel 40 cm forward/back
  and 14 cm inward, with 15° left body rotation and 3 cm lowering. Their moving
  feet retain directions 0/180; the other feet follow the bodies. CBMP crosses
  in the body frame deliberately, so this named starting stance permits that
  initial foot order just like crossed promenade. This is not a check bypass:
  dense tests cover every footprint and full thigh/shin capsule throughout both
  figures and their boundary with linear/eased motion. Default body reach,
  lowering and lateral balance limits remain unchanged. The owner confirmed
  back-side-close in closed hold over the recovery's three counts. The preceding
  check takes three counts (arrive on 1, hold 2–3); its depth, timing, modest
  shaping and recovery rise are provisional for review, not syllabus claims.
  Recovery ends in ordinary closed stance, lead RF / follow LF weighted. The
  new name is authoring-only; existing pose/step fields persist it unchanged.
  A separate Contra Check Recovery (Promenade) shares the same entry and first
  recovery count, steps out/open on 2, and holds/lowers without closing on 3.
  It ends in the existing promenade-apart stance, lead LF / follow RF weighted,
  exactly matching Open Natural Turn. Original closed recovery is unchanged.
  This is a provisional three-count development using the owner's existing
  symmetric 45° opening model, not a claim of standard syllabus timing. Both
  alternatives have dense full-footprint and thigh/shin clearance regressions.
- `defineFigure` checks the whole movement of a figure (`checkFeet`,
  sampled every sixteenth of a beat): in each dancer's frame the left
  foot stays left of the right (the owner's rule, 2026-11-16) unless a
  step is marked `cross: true` or the figure starts crossed; while the
  feet are crossed the foot in front stays in front, so legs never pass
  through each other (added 2026-11-17, part of the "crossed feet"
  check); and no lead foot comes within `PARTNER_FOOT_CLEARANCE` (10 cm, a
  judgement call: just over a foot's width, so his foot can pass beside
  hers in the offset hold; it was 15 cm before the offset) of a follow
  foot; and ("own feet", added 2026-11-17) neither dancer's own two feet,
  drawn as footprints (`FOOTPRINT_LENGTH` 26 cm by `FOOTPRINT_WIDTH` 9 cm,
  rounded strips along the way each foot points; `footprintGap` in
  `fold.mts`), overlap by more than a few millimetres, except while
  crossed on purpose by a `cross` step. The crossed-feet check compares
  only the feet's middles, so before this a foot could land on the other
  or swing its toes into it unnoticed (the forward box halves did).
  No current catalogue figure opts out with `skipChecks`; a catalogue
  regression guards against silently reintroducing exclusions. Intentional
  crosses remain marked explicitly and have dedicated clearance tests. The box
  turns pass every check. Closed Promenade also
  passes every check after its provisional 2026-11-18 adjustment: the first
  slow advances 4 cm and widens each outer foot 6 cm from the unchanged
  starting stance. Authored body offsets bring the hips nearly into contact
  as the inner legs pass, with feet pointing along travel; both partners
  uncross on shallow arcs close beneath the hips. Intermediate offsets return
  to zero on the close.
  Original connection poses and timing are preserved. Dense regression tests
  check full mannequin thigh/shin capsules as well as footprints and reach.
  These are provisional dimensions for the owner's subjective review.
  Back Corté now passes all authoring checks too: the lead's third step
  departs 144 degrees left on a compact arc, with the foot pointed another
  eighth left to its final heading while the body completes the turn on the
  close. All landings and connection poses, the first two steps, and the
  follow's route are unchanged. Dense tests check footprint clearance for
  the whole figure and full mannequin leg capsules during the repaired turn
  and close. The unchanged first walking phase has a pre-existing ~1 cm
  inter-partner capsule-proxy overlap, outside this targeted foot repair.
  Promenade Chassé also has no authoring or body-test exclusions after its
  provisional 2026-11-18 repair: first travel is 25 cm instead of 50 cm,
  count 2 uses shallow outward arcs (departures -65 lead / +65 follow) and
  a 6 cm pelvis displacement back along travel. All landings from count 2
  onward, entry/exit poses, 1 2 & 3 timing, rise profile and the original
  10 cm late-weight close remain. Default-body hip lowering stays below
  11 cm and the lateral balance checks pass. Full-footprint tests cover the
  figure. The leg-capsule proxy still overlaps by up to ~2.5 cm during the
  initial crossed-stance release; the close and final step clear capsules.
  That residual proxy limitation is documented, not full mesh clearance.
  Open Natural Turn has no figure-level authoring or body-test exclusions.
  Its deeper opening travels 15 cm farther along the line for each inner foot:
  lead 80 cm along -x/22 cm inward, follow about 54.74 cm along -x/4.97 cm inward.
  Shallow departures are -20 lead/+30 follow, with both feet pointing along
  travel. Pelvis offsets are lead floor +4 cm x/+4 cm y and follow -4 cm x/+4 cm y;
  the pelvis rods approach within 2.4 cm. The lead keeps 5/100/30 degrees of
  body turn; the follow keeps the original turns. Earlier closed hold is not
  needed. Count-2 departures -100 lead/+50 follow and a -70 follow closing
  departure accommodate the deeper placements. The lead stride deliberately
  crosses in the body frame (`cross: true`), but dense full-footprint and
  thigh/shin checks cover the whole figure without skipping that interval.
  Default mannequin capsules clear by over 1 cm; hip lowering stays below 5 cm.
  Original entry/exit, count-2 outer-foot landings, weights, timing and flat
  rise remain; body offsets reset on the close. The preceding Chassé is unchanged.
  These are provisional modelling choices for subjective review; shared reach,
  lowering, balance and geometry limits remain unchanged.
  Cruzada now has no figure-level exclusions. The owner confirmed the usual
  left-in-front cross. The lead's 30 cm walk and closed entry are unchanged;
  the follow walks back 40 cm, then crosses left 3 cm across/26 cm in front
  of right, on a +100-degree departure with 30-degree turnout on each foot.
  No body offsets are needed. Both Q counts, facings, rise and finishing
  support remain. Full footprints and all thigh/shin capsule pairs clear
  through the whole figure, including the intentional `cross: true` step.
  The corrected follow exit replaces the old direction-bug endpoint. It
  finishes crossed; the practice sequence now approaches it through collected variants.
  Dimensions and route are provisional for subjective review.
  Ocho now has no authoring or body-test exclusions. Its compact back ochos
  alternate a 30-degree left pivot and 60-degree right pivot (follow facings
  150/210), with 20 cm back/10 cm left on the first travelling step and 20 cm
  straight back on the second. Lead's first step is 5 cm right/12 cm forward;
  the second 20 cm step at -10 degrees is unchanged. Existing passing-foot
  routing clears both legs without body offsets or cross flags. Original
  entry, four Q counts, pivot/support order, final support, lead's final right
  landing and flat rise remain. The erroneous sideways follow exit changes;
  it still ends mid-stride; the practice sequence uses collection/weight change before it.
  Dense full-footprint/thigh/shin regressions cover both pivots and walks.
  Ocho also rejoins the reach/lowering catalogue tests, removing their last
  exclusion. Pivot angles and dimensions are provisional for subjective review.
  Side Step removes the catalogue's final authoring exclusions. Lead right /
  follow left travel 35 cm sideways in one Q, starting on lead left/follow right
  and finishing on lead right/follow left. Closed foot positions, facings and
  rise remain; the old crossed exit and opposite support assignments are fixed.
  No cross flags, arcs, pointing or shaping are needed. All footprints and
  thigh/shin pairs clear throughout, with under 6 cm hip lowering. Adjacent
  Walking Step/Cruzada foot order agrees; the common practice sequence uses
  collected variants to close the position gaps. All catalogue authoring/body checks now run
  without figure-level exclusions, using the unchanged shared limits.

- `defineFigure` also checks the hold (`checkHold`, added 2026-11-17): at
  the end of every row, the follow's body position must be within
  `HOLD_TOLERANCE` (20 cm) of where closed hold or promenade puts it from
  the lead's, with her facing within `HOLD_FACING_TOLERANCE` (30°) of that
  position's. The model has no arms, so this stands in for them, catching
  separately written steps that leave a partner out of reach. Mirrored
  steps keep the hold by construction. The positions and tolerances are
  provisional judgement calls. Explicit body shaping also allows a close
  promenade reference (27 cm centre separation) with the same tolerances,
  reflecting hip contact while supporting feet open a passing channel.
  Unshaped figures keep the original checks. All current figures now run the
  hold check, including the repaired Ocho; its compact alternating pivots
  fit the existing reference without changing any tolerance.
- The model changes agreed with the owner on 2026-11-17 (a hold check,
  foot direction separate from the body's facing, a couple turn that
  continues through a close) are all done; see above. The box turns use
  all three, with the book's turn timing.

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
