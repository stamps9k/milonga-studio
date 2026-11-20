/**
 * defineFigure: works out the starting weight, then folds a figure
 * definition's rows into the model's steps and poses and checks them.
 */

import {
  stepOverlapError,
  isFreeFootFollow,
  bodyHeadingBefore,
} from "../overlap.mts";
import { figureDurationBeats, poseAtBeat } from "../fold.mts";
import {
  addPoints,
  angleBetweenDegrees,
  normalizeDegrees,
  rotatePoint,
  scalePoint,
  subPoints,
} from "../heading.mts";
import type { Point2D } from "../pose.mts";
import type {
  DanceStep,
  Figure,
  Foot,
  Partner,
  TimeSignature,
} from "../step.mts";
import { checkExpectedEnd, checkFeet, checkHold } from "./checks.mts";
import { DIRECTION_DEGREES, FigureError } from "./definition.mts";
import type {
  AuthoredFigure,
  FigureDefinition,
  StepRow,
} from "./definition.mts";
import {
  TURN_CENTRE_FRACTION,
  applyMove,
  chooseFoot,
  defaultLabel,
  defaultTurnCentre,
  mirrorName,
  moveTo,
  movesOfRow,
  turnDegrees,
} from "./moves.mts";
import type { PartnerState } from "./moves.mts";
import { FOOT, OTHER, stancePose } from "./stances.mts";
import type { StanceName } from "./stances.mts";

function parseTime(time: string, name: string): TimeSignature {
  const match = /^(\d+)\/(\d+)$/.exec(time);
  if (!match) throw new FigureError(`${name}: time must look like "3/4"`);
  return { beatsPerMeasure: Number(match[1]), beatUnit: Number(match[2]) };
}

/** Who stands on which foot before a stance's first step, when the step
 *  doesn't say: in closed hold the lead is on his right (stepping off
 *  the left) and the follow on her left; in crossed promenade each is
 *  on the crossed foot, which is how a whisk ends. */
const DEFAULT_STANDING: Record<StanceName, Record<Partner, Foot>> = {
  closed: { lead: "right", follow: "left" },
  "crossed promenade": { lead: "left", follow: "right" },
  "promenade apart": { lead: "left", follow: "right" },
  "tango promenade": { lead: "right", follow: "left" },
  "contra check": { lead: "left", follow: "right" },
  "spin turn finish": { lead: "left", follow: "right" },
};

/** Which foot each partner stands on at the start, worked out from
 *  their first step: a travelling step uses the free foot, so the
 *  partner stands on the other one; a pivot is on the standing foot. A
 *  partner with no foot given on their first step starts standing on
 *  the usual foot: the lead on his right, the follow on her left. */
function inferStanding(
  rows: StepRow[],
  name: string,
  stance: StanceName,
): Record<Partner, Foot> {
  const defaults = DEFAULT_STANDING[stance];
  const standing: Partial<Record<Partner, Foot>> = {};
  for (const [index, row] of rows.entries()) {
    for (const { partner, move } of movesOfRow(
      row,
      `${name}, step ${index + 1}`,
    )) {
      if (standing[partner]) continue;
      let foot: Foot | undefined = move.foot ? FOOT[move.foot] : undefined;
      if (row.both !== undefined && partner === "follow" && row.foot) {
        foot = OTHER[FOOT[row.foot]];
      }
      if (foot === undefined) {
        // Nothing to infer from: the stance's usual starting weight.
        standing[partner] = defaults[partner];
      } else {
        standing[partner] = move.go === "pivot" ? foot : OTHER[foot];
      }
    }
    if (standing.lead && standing.follow) break;
  }
  return {
    lead: standing.lead ?? defaults.lead,
    follow: standing.follow ?? defaults.follow,
  };
}

/**
 * Turns a dancer-level description into the model's figure data. Throws
 * a FigureError naming the figure and step on any inconsistency.
 */
export function defineFigure(definition: FigureDefinition): AuthoredFigure {
  const { name } = definition;
  const timeSignature = parseTime(definition.time, name);
  const rows = definition.steps;
  if (rows.length === 0) throw new FigureError(`${name}: has no steps`);

  const usesBeat = rows.some((row) => row.beat !== undefined);
  const usesLength = rows.some((row) => row.length !== undefined);
  if (usesBeat && usesLength) {
    throw new FigureError(
      `${name}: use either \`beat\` or \`length\` for every step, not a mix`,
    );
  }
  rows.forEach((row, index) => {
    if (row.beat === undefined && row.length === undefined) {
      throw new FigureError(
        `${name}, step ${index + 1}: needs a \`beat\` or a \`length\``,
      );
    }
  });

  const start = definition.start ?? "closed";
  const startPose = stancePose(start, inferStanding(rows, name, start));
  const state: Record<Partner, PartnerState> = {
    lead: {
      position: {
        left: startPose.lead.left.position,
        right: startPose.lead.right.position,
      },
      weight: {
        left: startPose.lead.left.weight,
        right: startPose.lead.right.weight,
      },
      orientation: startPose.lead.orientation,
    },
    follow: {
      position: {
        left: startPose.follow.left.position,
        right: startPose.follow.right.position,
      },
      weight: {
        left: startPose.follow.left.weight,
        right: startPose.follow.right.weight,
      },
      orientation: startPose.follow.orientation,
    },
  };

  // A turn on a mirrored close: the couple's bodies turn on the close,
  // but the feet were already placed for it on the step before.
  //
  // In hold each partner's weight is a fixed offset from the other's,
  // turned with the couple. A close only moves each body 10 cm sideways
  // (from the standing foot to the middle of the feet), so if the couple
  // were exactly in hold before the close, turning the bodies an eighth
  // on it would leave the follow about 30 cm out of place. Ballroom
  // charts have the bodies keep turning through the close (a natural
  // turn's "1/8 between 2 and 3") while the feet close normally, which
  // works because the step before already placed the feet for the whole
  // turn. So the close's turn is carried back into the previous
  // mirrored travelling step's foot placement (the couple's rotation
  // round its turning centre), while each body still turns only by its
  // own step's `turn`: after the close the couple is exactly in hold,
  // facing the way the whole turn leads. Owner's choice (option A,
  // 2026-11-17).
  const carriedTurn: number[] = rows.map(() => 0);
  rows.forEach((row, index) => {
    if (
      row.both !== "close" ||
      row.turn === undefined ||
      turnDegrees(row.turn) === 0
    ) {
      return;
    }
    const previous = rows[index - 1];
    const travelling =
      previous?.both !== undefined &&
      previous.air !== true &&
      previous.both !== "close" &&
      previous.both !== "in place" &&
      previous.both !== "pivot";
    if (!travelling) {
      throw new FigureError(
        `${name}, step ${index + 1}: with \`both\`, a turn on a close needs the step before it to be a mirrored (\`both\`) travelling step, which places the feet for the turn the close finishes`,
      );
    }
    carriedTurn[index - 1] = turnDegrees(row.turn);
  });

  // The same holds when the lead and the follow each close separately,
  // on the same beat and with the same turn: the steps before have put
  // the feet where the turned couple ends, so the hold check of the rows
  // in the beat before compares the bodies with the hold the turn
  // finishes in. Only the hold check reads carriedTurn for rows that
  // aren't `both`, so this places no feet. (2026-11-20, for the Reverse
  // Turn (4–6), which starts from an asymmetric stance and so can't
  // use mirrored steps.)
  const turningClose = (row: StepRow, who: Partner) => {
    const move = row[who];
    if (move === undefined) return undefined;
    const isObject = typeof move === "object" && "go" in move;
    const go = isObject ? move.go : move;
    const turn = isObject ? move.turn : row.turn;
    return go === "close" && turn !== undefined && turnDegrees(turn) !== 0
      ? turnDegrees(turn)
      : undefined;
  };
  rows.forEach((row) => {
    const leadTurn = turningClose(row, "lead");
    if (leadTurn === undefined || row.beat === undefined) return;
    const followTurn = rows
      .filter((other) => other.beat === row.beat)
      .map((other) => turningClose(other, "follow"))
      .find((turn) => turn !== undefined);
    if (followTurn !== leadTurn) return;
    const first = rows.findIndex((other) => other.beat === row.beat);
    const before = rows[first - 1]?.beat;
    if (before === undefined) return;
    rows.forEach((other, k) => {
      if (other.beat === before && other.both === undefined) {
        carriedTurn[k] = leadTurn;
      }
    });
  });

  // In hold the lead's left foot pairs with the follow's right, and his
  // right with her left (each is in front of the other). A mirrored
  // turning step only moves one pair, so the other pair is left in the
  // relation the couple had when it last moved. pairFacing records, per
  // pair (keyed by the lead's foot), the lead's facing that pair was
  // last placed for, and a mirrored travelling step turns its pair by
  // everything since: the turn so far, not just its own. Without this a
  // turn spread over consecutive steps (begun on count 1, say) leaves
  // the couple short of the hold by the earlier steps' turn. (2026-11-17)
  const pairFacing: Record<Foot, number> = {
    left: startPose.lead.orientation,
    right: startPose.lead.orientation,
  };

  // Resolve every move in row order, tracking each partner's state so
  // later steps know which foot is free, where "close" lands, etc.
  const slow = definition.slow ?? 2;
  let clock = 0; // S/Q style: beats elapsed (0-based)
  let previousBeat = -Infinity;
  const resolved: {
    step: Omit<DanceStep, "id" | "beat" | "duration">;
    start: number; // 0-based beat
    length?: number;
    frame: number;
    /** For checkFeet: whether the step crosses the feet on purpose, and
     *  which row it came from ("step 2"). */
    cross: boolean;
    where: string;
    /** For checkHold: the row (0-based) the step came from. */
    row: number;
  }[] = [];

  rows.forEach((row, index) => {
    const where = `${name}, step ${index + 1}`;
    for (const duration of [
      row.duration,
      typeof row.lead === "object" && "go" in row.lead
        ? row.lead.duration
        : undefined,
      typeof row.follow === "object" && "go" in row.follow
        ? row.follow.duration
        : undefined,
    ]) {
      if (
        duration !== undefined &&
        (!(duration > 0) ||
          !Number.isFinite(duration) ||
          row.length !== undefined)
      )
        throw new FigureError(
          `${where}: duration requires a positive number of beats and beat timing`,
        );
    }
    let start: number;
    let length: number | undefined;
    if (row.length !== undefined) {
      start = clock;
      length = row.length === "S" ? slow : slow / 2;
      clock += length;
    } else {
      const beat = row.beat!;
      if (!(beat >= 1)) throw new FigureError(`${where}: beats count from 1`);
      if (beat < previousBeat) {
        throw new FigureError(`${where}: steps must be listed in beat order`);
      }
      previousBeat = beat;
      start = beat - 1;
    }

    if (
      row.both !== undefined &&
      row.turn !== undefined &&
      turnDegrees(row.turn) !== 0 &&
      (row.both === "in place" || row.both === "pivot")
    ) {
      // On these steps each partner turns over their own standing foot,
      // which doesn't move, so the two can't swing round each other and
      // closed hold would silently come apart (the follow would end up
      // beside the lead instead of in front of him). A turning close is
      // different: see carriedTurn above.
      throw new FigureError(
        `${where}: with \`both\`, a turn can't go on "${row.both}": each partner would turn on their own standing foot and the hold would come apart. Put the turn on a travelling step, or write \`lead\` and \`follow\` separately`,
      );
    }
    if (row.turnCentre !== undefined) {
      if (row.both === undefined) {
        throw new FigureError(
          `${where}: \`turnCentre\` only goes with \`both\`; with \`lead\` and \`follow\` written separately, each step already says where that partner goes`,
        );
      }
      if (
        (row.turn === undefined || turnDegrees(row.turn) === 0) &&
        carriedTurn[index] === 0
      ) {
        throw new FigureError(
          `${where}: \`turnCentre\` needs a \`turn\` on the row (or a turning close after it)`,
        );
      }
      if (row.air === true) {
        throw new FigureError(
          `${where}: \`turnCentre\` can't go on an airborne step, which doesn't move the couple`,
        );
      }
    }

    let leadFoot: Foot | undefined;
    // Where each partner's moving foot lands on a travelling `both` row,
    // worked out together when the lead's step is reached (see below).
    let targets: Record<Partner, Point2D> | undefined;
    for (const { partner, move, label } of movesOfRow(row, where)) {
      let explicit: Foot | undefined = move.foot ? FOOT[move.foot] : undefined;
      if (row.both !== undefined && partner === "follow") {
        explicit = leadFoot ? OTHER[leadFoot] : undefined;
      }
      const foot = chooseFoot(
        move,
        state[partner],
        explicit,
        `${where} (${partner})`,
      );
      if (partner === "lead") leadFoot = foot;

      // With `both`, the partners keep their places in the hold: the
      // couple moves and turns as one, round a turning centre.
      //
      // Take the point C a fraction t of the way from the lead's moving
      // foot to the follow's (t = 0, 1 or 1/2 for a centre of "lead",
      // "follow" or "between"). C makes the step as written: it moves by
      // the lead's written displacement d. The couple turns round C by
      // the step's turn R, so each moving foot P lands at
      //
      //   C + d + R(P - C).
      //
      // With t = 0 the lead's foot lands exactly where his step says
      // and the follow swings round him; with t = 1 her foot lands where
      // the mirror of his step says (the same floor displacement) and
      // he swings round her. Whoever is further from C travels further:
      // the outside of the turn. Without a turn R does nothing and both
      // simply take the written step, the plain mirror, whatever the
      // centre.
      //
      // Airborne steps don't place a foot, so they keep the plain
      // mirror: the same floor direction as the lead.
      let partnerMove = move;
      const travels =
        typeof move.go === "number" || move.go in DIRECTION_DEGREES;
      if (
        row.both !== undefined &&
        partner === "lead" &&
        travels &&
        move.air !== true
      ) {
        const leadFrom = state.lead.position[foot];
        const followFrom = state.follow.position[OTHER[foot]];
        // Where the written step would put his foot, without changing
        // his state yet.
        const scratch = structuredClone(state.lead);
        applyMove("lead", move, foot, scratch, label, where);
        const displacement = subPoints(scratch.position[foot], leadFrom);
        const centre = row.turnCentre ?? defaultTurnCentre(move);
        const t = TURN_CENTRE_FRACTION[centre];
        const pivot = addPoints(
          leadFrom,
          scalePoint(subPoints(followFrom, leadFrom), t),
        );
        // The couple's facing the feet land for: after this step's own
        // turn, plus any the next close carries back (carriedTurn). The
        // pair turns from the facing it was last placed for
        // (pairFacing), which is this step's starting facing unless an
        // earlier mirrored step turned the couple while this pair stood.
        const placedFor =
          state.lead.orientation + turnDegrees(move.turn) + carriedTurn[index];
        const degrees =
          turnDegrees(move.turn) +
          carriedTurn[index] +
          angleBetweenDegrees(pairFacing[foot], state.lead.orientation);
        pairFacing[foot] = placedFor;
        const land = (from: Point2D) =>
          addPoints(
            addPoints(pivot, displacement),
            rotatePoint(subPoints(from, pivot), degrees),
          );
        targets = { lead: land(leadFrom), follow: land(followFrom) };
        if (t !== 0 && degrees !== 0) {
          partnerMove = moveTo(
            move,
            leadFrom,
            targets.lead,
            state.lead.orientation,
          );
        }
      }
      if (row.both !== undefined && partner === "follow" && travels) {
        if (targets) {
          partnerMove = moveTo(
            move,
            state.follow.position[foot],
            targets.follow,
            state.follow.orientation,
          );
        } else {
          const leadRelative =
            typeof move.go === "number"
              ? move.go
              : DIRECTION_DEGREES[move.go as keyof typeof DIRECTION_DEGREES];
          const absolute =
            state.lead.orientation - turnDegrees(move.turn) + leadRelative;
          partnerMove = {
            ...move,
            go: normalizeDegrees(absolute - state.follow.orientation),
          };
        }
      }
      const freeFollow =
        partnerMove.weight === false || partnerMove.weight === 0;
      const followsSupport =
        freeFollow &&
        resolved.some(
          (e) =>
            e.step.partner === partner &&
            e.step.foot !== foot &&
            e.step.weight > 0 &&
            e.length !== undefined &&
            e.start + e.length > start + 1e-9,
        );
      const savedFacing = state[partner].orientation,
        savedWeight = { ...state[partner].weight };
      const step = applyMove(
        partner,
        partnerMove,
        foot,
        state[partner],
        label,
        `${where} (${partner})`,
      );
      if (followsSupport) {
        state[partner].orientation = savedFacing;
        state[partner].weight = savedWeight;
      }
      if (partnerMove !== move && !label) {
        // Describe the step in the dancer's own terms, as written (the
        // follow's as the mirror of the lead's), not as the worked-out
        // direction in degrees.
        step.label = defaultLabel(
          partner === "follow" ? mirrorName(move.go) : move.go,
          move.turn,
          move.air === true,
        );
      }
      resolved.push({
        step,
        frame: savedFacing,
        start,
        length: partnerMove.duration ?? length,
        cross: partnerMove.cross === true,
        where: `step ${index + 1}`,
        row: index,
      });
      // Any other step that places a foot (a close, separately written
      // steps) leaves its pair in whatever relation the steps give; it
      // counts as placed for the lead's facing now.
      const travelledBoth =
        row.both !== undefined && travels && move.air !== true;
      if (
        !travelledBoth &&
        move.go !== "pivot" &&
        move.go !== "in place" &&
        move.air !== true
      ) {
        const pairKey = partner === "lead" ? foot : OTHER[foot];
        pairFacing[pairKey] = state.lead.orientation;
      }
    }
  });

  // Beat style: each step lasts until the same partner's next step, and
  // the last one until the end of its measure.
  const bpm = timeSignature.beatsPerMeasure;
  let steps: Omit<DanceStep, "id">[] = resolved.map((entry, index) => {
    let duration = entry.length;
    if (duration === undefined) {
      const next = resolved
        .slice(index + 1)
        .find(
          (other) =>
            other.step.partner === entry.step.partner &&
            other.start > entry.start,
        );
      duration = next
        ? next.start - entry.start
        : (Math.floor(entry.start / bpm) + 1) * bpm - entry.start;
    }
    return { ...entry.step, beat: entry.start + 1, duration };
  });

  const overlapError = stepOverlapError(steps);
  if (overlapError) throw new FigureError(`${name}: ${overlapError}`);

  // Rows resolve relative directions in the preceding row's final frame.
  // An overlapping arc is stored relative to its actual start-time frame,
  // preserving Movement.arc.setOff's runtime contract.
  steps = steps.map((step, index) =>
    isFreeFootFollow(step, steps) && step.movement.type === "arc"
      ? {
          ...step,
          movement: {
            ...step.movement,
            setOff:
              (step.movement.setOff ?? 0) +
              resolved[index].frame -
              bodyHeadingBefore(step, steps, startPose),
          },
        }
      : step,
  );

  const figure: Figure = {
    id: "authored",
    name,
    style: definition.style,
    timeSignature,
    steps: steps.map((step, index) => ({ ...step, id: String(index + 1) })),
    startPose,
    endPose: startPose,
  };
  const endPose = poseAtBeat(figure, figureDurationBeats(figure));

  checkFeet(
    name,
    figure,
    resolved.map(({ cross, where }) => ({ cross, where })),
    start === "crossed promenade" || start === "contra check",
    new Set(definition.skipChecks ?? []),
  );

  if (!(definition.skipChecks ?? []).includes("hold")) {
    // When each row has finished: the latest end of its steps.
    const rowEnds = new Map<number, number>();
    steps.forEach((step, index) => {
      const { row } = resolved[index];
      const end = step.beat - 1 + step.duration;
      rowEnds.set(row, Math.max(rowEnds.get(row) ?? 0, end));
    });
    checkHold(
      name,
      figure,
      rowEnds,
      carriedTurn,
      rows.map((row) => row.hold),
    );
  }

  if (definition.expectEnd) {
    checkExpectedEnd(name, definition.expectEnd, endPose);
  }
  if (definition.expectBeats !== undefined) {
    const beats = figureDurationBeats(figure);
    if (Math.abs(beats - definition.expectBeats) > 1e-9) {
      throw new FigureError(
        `${name}: the steps last ${beats} beats, but expectBeats says ${definition.expectBeats}`,
      );
    }
  }

  return {
    name,
    style: definition.style,
    timeSignature,
    startPose,
    endPose,
    steps,
  };
}
