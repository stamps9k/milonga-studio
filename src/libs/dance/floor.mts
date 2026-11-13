import type { Foot, Partner } from "./step.mts";
import type { FootState, PartnerPose, Point2D, Pose } from "./pose.mts";
import type { FloorTransform } from "./sequence.mts";
import {
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

/** The 4 foot positions of a Pose in a fixed order. */
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
 * Finds the rigid 2D transform (rotate, then translate) that places
 * `source` onto `target`: the rotation turns the lead's frame in
 * `source` to face the same way as the lead's frame in `target`, and
 * the translation then lines up the two poses' foot centroids.
 *
 * Used to chain figures in a Sequence: fitting a figure's startPose onto
 * the previous entry's resolvedEndPose gives the FloorTransform that
 * continues the couple's position and facing instead of jumping. When
 * the two figures are authored to actually connect (their transition
 * stance matches up to rotation/translation), the fit is exact --
 * applyTransform(result, source) reproduces target exactly. When they
 * aren't, assessJoin (join.mts) measures what's left over.
 *
 * Why the lead's frame decides the rotation, rather than the feet:
 * an earlier version found the rotation that best lined up all four
 * feet (least-squares / orthogonal Procrustes). That's exact for
 * congruent stances, but when a figure ends in a different stance shape
 * than the next one starts in -- say mid-stride, with the lead's feet
 * 0.6 apart front to back -- the best foot fit is a *turn*: it rotated
 * the next figure about 31 degrees even though both partners were still
 * facing straight down line of dance. Facing is what dancers keep
 * continuous between figures, and PartnerPose.orientation records it
 * directly, so it's used as-is and the feet only set the position.
 *
 * Provisional modelling choices:
 * - The lead's frame stands for the couple's facing. The follow's frame
 *   is ignored here because in some figures it legitimately turns away
 *   from the lead's (the Ocho ends with the follow at 45 degrees); any
 *   difference in the follow's facing shows up in assessJoin instead.
 * - With the rotation fixed, the centroid match is the least-squares
 *   translation: it splits any leftover stance mismatch evenly across
 *   all four feet rather than favouring, say, the weighted feet.
 */
export function fitTransform(source: Pose, target: Pose): FloorTransform {
  const rotation = normalizeDegrees(
    target.lead.orientation - source.lead.orientation,
  );
  const position = subPoints(
    centroid(footPoints(target)),
    rotatePoint(centroid(footPoints(source)), rotation),
  );
  return { position, rotation };
}
