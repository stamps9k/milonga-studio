import type { Foot, Partner } from "./step.mts";
import type { FootState, PartnerPose, Point2D, Pose } from "./pose.mts";
import type { FloorTransform } from "./sequence.mts";
import {
  RAD_TO_DEG,
  addPoints,
  normalizeDegrees,
  rotatePoint,
  subPoints,
} from "./heading.mts";

/**
 * Places Figures on the actual floor, and composes consecutive figures
 * in a Sequence so the couple's position doesn't teleport between them.
 *
 * A Figure's Poses are expressed in its own local frame (origin, facing
 * 0 degrees -- see step.mts). FloorTransform is a rigid 2D transform
 * (rotate about the origin, then translate) that maps that local frame
 * onto a real spot on the floor for one occurrence of the figure. See
 * heading.mts for the shared rotation/heading convention used here.
 */

const PARTNERS: readonly Partner[] = ["lead", "follow"];
const FEET: readonly Foot[] = ["left", "right"];

/**
 * Applies a FloorTransform to a Pose: rotates every foot position and
 * partner orientation by `transform.rotation` about the local origin,
 * then translates positions by `transform.position`. Rise is untouched
 * -- it's vertical displacement, unaffected by a planar transform.
 */
export function applyTransform(transform: FloorTransform, pose: Pose): Pose {
  const applyToPartner = (partnerPose: PartnerPose): PartnerPose => {
    const applyToFoot = (foot: FootState): FootState => ({
      position: addPoints(
        rotatePoint(foot.position, transform.rotation),
        transform.position,
      ),
      weight: foot.weight,
    });

    return {
      left: applyToFoot(partnerPose.left),
      right: applyToFoot(partnerPose.right),
      orientation: normalizeDegrees(
        partnerPose.orientation + transform.rotation,
      ),
      rise: partnerPose.rise,
    };
  };

  return {
    lead: applyToPartner(pose.lead),
    follow: applyToPartner(pose.follow),
  };
}

/** The 4 foot positions of a Pose in a fixed order -- the point
 *  correspondence fitTransform needs between two poses. */
function footPoints(pose: Pose): Point2D[] {
  const points: Point2D[] = [];
  for (const partner of PARTNERS) {
    for (const foot of FEET) {
      points.push(pose[partner][foot].position);
    }
  }
  return points;
}

function centroid(points: Point2D[]): Point2D {
  const sum = points.reduce((acc, p) => addPoints(acc, p), {
    x: 0,
    y: 0,
  });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/**
 * Finds the rigid 2D transform (rotate, then translate) that best maps
 * `source`'s 4 foot positions onto `target`'s, in a least-squares sense
 * (2D orthogonal Procrustes, aka Kabsch restricted to rotation, no
 * reflection/scaling).
 *
 * Used to chain figures in a Sequence: fitting a figure's startPose onto
 * the previous entry's resolvedEndPose gives the FloorTransform that
 * continues the couple's position and facing instead of jumping. When
 * the two figures are authored to actually connect (their transition
 * stance matches up to rotation/translation), the fit is exact --
 * applyTransform(result, source) reproduces target exactly. When they
 * aren't, this is the closest rigid placement available; the leftover
 * gap is a natural (currently unused) signal for a future "these two
 * figures don't connect cleanly" check.
 */
export function fitTransform(source: Pose, target: Pose): FloorTransform {
  const sourcePoints = footPoints(source);
  const targetPoints = footPoints(target);

  const sourceCentroid = centroid(sourcePoints);
  const targetCentroid = centroid(targetPoints);

  let crossSum = 0;
  let dotSum = 0;
  for (let i = 0; i < sourcePoints.length; i++) {
    const s = subPoints(sourcePoints[i], sourceCentroid);
    const t = subPoints(targetPoints[i], targetCentroid);
    crossSum += s.x * t.y - s.y * t.x;
    dotSum += s.x * t.x + s.y * t.y;
  }

  // atan2(crossSum, dotSum) is the standard orthogonal-Procrustes result
  // for the usual counterclockwise/+X-origin rotation convention; negated
  // here because rotatePoint above uses the clockwise/+Y-origin (compass
  // bearing) convention instead -- see its comment.
  const rotation =
    crossSum === 0 && dotSum === 0
      ? 0
      : Math.atan2(-crossSum, dotSum) * RAD_TO_DEG;

  const position = subPoints(
    targetCentroid,
    rotatePoint(sourceCentroid, rotation),
  );

  return { position, rotation: normalizeDegrees(rotation) };
}
