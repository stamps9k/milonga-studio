import { test } from "node:test";
import assert from "node:assert/strict";

import { stancePose } from "../../src/libs/dance/authoring.mts";
import { applyTransform } from "../../src/libs/dance/floor.mts";
import type { PartnerPose } from "../../src/libs/dance/pose.mts";
import { DEFAULT_PROPORTIONS } from "../../src/libs/body/proportions.mts";
import {
  JOINT_NAMES,
  solvePartnerSkeleton,
  standingHipHeight,
  solveSkeleton,
} from "../../src/libs/body/skeleton.mts";
import type { PartnerSkeleton } from "../../src/libs/body/skeleton.mts";
import type { Point3D } from "../../src/libs/body/vector3.mts";
import { loadFigures } from "../../db/figures/index.mts";
import { figureDurationBeats, poseAtBeat } from "../../src/libs/dance/fold.mts";
import { distance, sub } from "../../src/libs/body/vector3.mts";

const LEAD = DEFAULT_PROPORTIONS.lead;

function close(actual: number, expected: number, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, got ${actual}`,
  );
}

/** The bones keep their lengths, whatever the pose. */
function assertBoneLengths(skeleton: PartnerSkeleton) {
  const { joints } = skeleton;
  for (const side of ["left", "right"] as const) {
    close(
      distance(joints[`${side}UpperLeg`], joints[`${side}LowerLeg`]),
      LEAD.thigh,
    );
    close(
      distance(joints[`${side}LowerLeg`], joints[`${side}Foot`]),
      LEAD.shin,
    );
    close(
      distance(joints[`${side}UpperArm`], joints[`${side}LowerArm`]),
      LEAD.upperArm,
    );
    close(
      distance(joints[`${side}LowerArm`], joints[`${side}Hand`]),
      LEAD.forearm,
    );
  }
}

/** A lead standing with his feet at the given floor spots, facing north,
 *  with `weightLeft` of his weight on the left foot. */
function lead(
  left: [number, number],
  right: [number, number],
  weightLeft: number,
  rise = 0,
  orientation = 0,
): PartnerPose {
  return {
    left: { position: { x: left[0], y: left[1] }, weight: weightLeft },
    right: { position: { x: right[0], y: right[1] }, weight: 1 - weightLeft },
    orientation,
    rise,
  };
}

test("solvePartnerSkeleton: standing in closed stance, the legs are straight and the hips at standing height", () => {
  const skeleton = solvePartnerSkeleton(
    lead([-0.1, 0], [0.1, 0], 0.5),
    LEAD,
    "lead",
  );
  assert.deepEqual(Object.keys(skeleton.joints), [...JOINT_NAMES]);
  // The hips are at standing height, within a millimetre (the feet are
  // a touch wider than the hips).
  close(skeleton.joints.hips.z, standingHipHeight(LEAD), 1e-3);
  close(skeleton.hipDrop, 0, 1e-3);
  assert.deepEqual(skeleton.legShortfall, { left: 0, right: 0 });
  // Hips over the middle of the feet; head straight above.
  close(skeleton.joints.hips.x, 0);
  close(skeleton.joints.head.x, 0);
  close(
    skeleton.joints.head.z - skeleton.joints.hips.z,
    LEAD.headHeight - standingHipHeight(LEAD),
  );
  // Feet flat on the floor, the toes pointing north.
  close(skeleton.feet.left.heel.z, 0);
  close(skeleton.joints.leftToes.z, 0);
  assert.ok(skeleton.joints.leftToes.y > skeleton.joints.leftFoot.y);
  assertBoneLengths(skeleton);
});

test("solvePartnerSkeleton: knees bend forwards, the way the body faces", () => {
  // Lowered by a rise of -0.1 (a knee bend), facing east (90).
  const skeleton = solvePartnerSkeleton(
    lead([0, 0.1], [0, -0.1], 0.5, -0.1, 90),
    LEAD,
    "lead",
  );
  for (const side of ["left", "right"] as const) {
    const knee = skeleton.joints[`${side}LowerLeg`];
    const hip = skeleton.joints[`${side}UpperLeg`];
    const ankle = skeleton.joints[`${side}Foot`];
    // Facing east, the knee is east of the line from hip to ankle.
    assert.ok(knee.x > (hip.x + ankle.x) / 2 + 0.01);
  }
  assertBoneLengths(skeleton);
});

test("solvePartnerSkeleton: a rise lifts the body and the heels; the balls of the feet stay down", () => {
  const flat = solvePartnerSkeleton(
    lead([-0.1, 0], [0.1, 0], 0.5),
    LEAD,
    "lead",
  );
  const risen = solvePartnerSkeleton(
    lead([-0.1, 0], [0.1, 0], 0.5, 0.1),
    LEAD,
    "lead",
  );
  close(risen.joints.hips.z - flat.joints.hips.z, 0.1);
  close(risen.joints.head.z - flat.joints.head.z, 0.1);
  close(risen.feet.left.heel.z, 0.1);
  close(risen.joints.leftToes.z, 0);
  close(risen.feet.left.toeTip.z, 0);
});

test("solvePartnerSkeleton: in a long stride the back heel releases and the hips sink a little", () => {
  // All the weight on the left foot, 0.5 ahead of the right (a waltz
  // forward step just completed).
  const skeleton = solvePartnerSkeleton(
    lead([-0.1, 0.5], [0.1, 0], 1),
    LEAD,
    "lead",
  );
  // The back foot rolls onto its ball: heel up, ball down.
  assert.ok(skeleton.feet.right.heel.z > 0.05);
  close(skeleton.joints.rightToes.z, 0);
  // The standing foot stays flat.
  close(skeleton.feet.left.heel.z, 0);
  // The hips sink, but only a few centimetres.
  assert.ok(skeleton.hipDrop > 0 && skeleton.hipDrop < 0.1);
  assert.deepEqual(skeleton.legShortfall, { left: 0, right: 0 });
  // The legs still join hip and ankle with their own lengths.
  assertBoneLengths(skeleton);
});

test("solvePartnerSkeleton: the back heel releases gradually as the weight leaves it, so the hips don't jump", () => {
  // A long stride with the weight moving forward off the back (right)
  // foot. Sampled finely through the weight change, the hips may move
  // only a little between neighbouring samples: no snap as the back
  // foot's weight passes half.
  let previous: number | null = null;
  let biggest = 0;
  for (let back = 0.7; back >= 0.1 - 1e-9; back -= 0.005) {
    const skeleton = solvePartnerSkeleton(
      lead([-0.1, 0.55], [0.1, 0], 1 - back),
      LEAD,
      "lead",
    );
    if (previous !== null)
      biggest = Math.max(biggest, Math.abs(skeleton.joints.hips.z - previous));
    previous = skeleton.joints.hips.z;
  }
  assert.ok(biggest < 0.005, `hips moved ${biggest} m in one step of weight`);
});

test("solvePartnerSkeleton: a foot no leg can reach is reported, not hidden", () => {
  const skeleton = solvePartnerSkeleton(
    lead([-0.1, 0], [3, 0], 1),
    LEAD,
    "lead",
  );
  assert.ok(skeleton.legShortfall.right > 1);
  close(skeleton.legShortfall.left, 0);
});

test("solveSkeleton: placing a pose on the floor moves the skeleton with it", () => {
  // Closed hold, then the same pose turned a quarter right and moved:
  // every joint turns and moves the same way, so the solver works in
  // floor space with the model's heading convention.
  const pose = stancePose("closed", { lead: "right", follow: "left" });
  const transform = { position: { x: 2, y: 1 }, rotation: 90 };
  const here = solveSkeleton(pose);
  const there = solveSkeleton(applyTransform(transform, pose));
  for (const partner of ["lead", "follow"] as const) {
    for (const joint of JOINT_NAMES) {
      const a = here[partner].joints[joint];
      const b = there[partner].joints[joint];
      // Turning 90° clockwise takes (x, y) to (y, -x).
      close(b.x, a.y + 2, 1e-9);
      close(b.y, -a.x + 1, 1e-9);
      close(b.z, a.z, 1e-9);
    }
  }
});

test("solveSkeleton: in closed hold the partners face each other, in hold", () => {
  const { lead: him, follow: her } = solveSkeleton(
    stancePose("closed", { lead: "right", follow: "left" }),
  );
  // The follow is in front of the lead (north of him), facing him.
  assert.ok(her.joints.hips.y > him.joints.hips.y);
  close(her.facing, 180);
  // His left hand is out to his left at about head height; his right
  // hand is in front of him, towards her back.
  assert.ok(him.joints.leftHand.x < him.joints.leftUpperArm.x - 0.1);
  assert.ok(him.joints.leftHand.z > him.joints.leftUpperArm.z);
  assert.ok(him.joints.rightHand.y > him.joints.chest.y + 0.2);
  // Each partner's joined hand is on the same side of the couple: his
  // left and her right are both west of the couple's middle.
  assert.ok(him.joints.leftHand.x < 0 && her.joints.rightHand.x < 0);
  // The elbows bend down, below the line from shoulder to hand.
  for (const skeleton of [him, her]) {
    for (const side of ["left", "right"] as const) {
      const shoulder = skeleton.joints[`${side}UpperArm`];
      const hand = skeleton.joints[`${side}Hand`];
      const elbow = skeleton.joints[`${side}LowerArm`];
      assert.ok(elbow.z < (shoulder.z + hand.z) / 2);
    }
  }
  // Her bones are her own (1.70 m), not his.
  const herThigh = sub(her.joints.leftUpperLeg, her.joints.leftLowerLeg);
  close(
    Math.hypot(herThigh.x, herThigh.y, herThigh.z),
    DEFAULT_PROPORTIONS.follow.thigh,
  );
});

/** How far apart two points are. */
const gap = (a: Point3D, b: Point3D) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

for (const stance of [
  "closed",
  "crossed promenade",
  "promenade apart",
] as const) {
  test(`solveSkeleton: in ${stance} the couple keeps hold`, () => {
    const { lead: him, follow: her } = solveSkeleton(
      stancePose(stance, { lead: "right", follow: "left" }),
    );
    // The joined hands meet: each wrist stops 5 cm short of the meeting
    // point, so they're about 10 cm apart, palm to palm.
    assert.ok(gap(him.joints.leftHand, her.joints.rightHand) < 0.12);
    // His right hand is on her back, just behind and below her left
    // shoulder; hers is on his right upper arm.
    assert.ok(gap(him.joints.rightHand, her.joints.leftUpperArm) < 0.2);
    // Her wrist is part-way down his upper arm (about 20 cm from his
    // shoulder), so her hand can lie along it up to his shoulder.
    assert.ok(gap(her.joints.leftHand, him.joints.rightUpperArm) < 0.25);
    // Her fingertips rest on his upper arm at the shoulder: within 6 cm
    // of the line from his shoulder to his elbow (the arm's surface, not
    // out in the air beside it).
    const shoulder = him.joints.rightUpperArm;
    const along = sub(him.joints.rightLowerArm, shoulder);
    const toTip = sub(her.fingertips.left, shoulder);
    const length2 = along.x ** 2 + along.y ** 2 + along.z ** 2;
    const t = Math.min(
      1,
      Math.max(
        0,
        (toTip.x * along.x + toTip.y * along.y + toTip.z * along.z) / length2,
      ),
    );
    const nearest = {
      x: shoulder.x + along.x * t,
      y: shoulder.y + along.y * t,
      z: shoulder.z + along.z * t,
    };
    assert.ok(
      gap(her.fingertips.left, nearest) < 0.06,
      `her fingertips ${gap(her.fingertips.left, nearest)} m off his arm`,
    );
    // The joined hands are out beyond the line between his left shoulder
    // and her right one, away from the middle of the couple (to his left
    // in closed hold, ahead in the open side of the V in promenade).
    const between = {
      x: (him.joints.leftUpperArm.x + her.joints.rightUpperArm.x) / 2,
      y: (him.joints.leftUpperArm.y + her.joints.rightUpperArm.y) / 2,
    };
    const middle = {
      x: (him.joints.hips.x + her.joints.hips.x) / 2,
      y: (him.joints.hips.y + her.joints.hips.y) / 2,
    };
    const outward =
      (him.joints.leftHand.x - between.x) * (between.x - middle.x) +
      (him.joints.leftHand.y - between.y) * (between.y - middle.y);
    assert.ok(outward > 0);
  });
}

test("solveSkeleton: in closed hold his right hand lies across her back; the joined hands point up", () => {
  const { lead: him, follow: her } = solveSkeleton(
    stancePose("closed", { lead: "right", follow: "left" }),
  );
  /** Unit direction from wrist to fingertip, and its length. */
  const pointing = (skeleton: PartnerSkeleton, side: "left" | "right") => {
    const along = sub(
      skeleton.fingertips[side],
      skeleton.joints[`${side}Hand`],
    );
    const length = Math.hypot(along.x, along.y, along.z);
    return {
      x: along.x / length,
      y: along.y / length,
      z: along.z / length,
      length,
    };
  };
  for (const [skeleton, body] of [
    [him, DEFAULT_PROPORTIONS.lead],
    [her, DEFAULT_PROPORTIONS.follow],
  ] as const) {
    for (const side of ["left", "right"] as const) {
      close(pointing(skeleton, side).length, body.hand, 1e-9);
    }
  }
  // She faces south, so her right (towards her spine from her left
  // shoulder blade) is west: his fingers point west and a little down,
  // not north out past her back the way his forearm points.
  const hisRight = pointing(him, "right");
  assert.ok(hisRight.x < -0.9, `fingers ${JSON.stringify(hisRight)}`);
  assert.ok(hisRight.z < 0 && hisRight.z > -0.5);
  assert.ok(Math.abs(hisRight.y) < 0.1);
  // The joined hands point upwards, crossed: each leans 20° from
  // upright, his out to the west (away from the couple) and hers in.
  const hisJoined = pointing(him, "left");
  const herJoined = pointing(her, "right");
  for (const hand of [hisJoined, herJoined]) {
    close(hand.z, Math.cos((20 * Math.PI) / 180), 1e-6);
  }
  assert.ok(hisJoined.x < -0.3 && herJoined.x > 0.3);
  // They clasp palm to palm: his palm faces north towards her hand, hers
  // south towards his, and both close their fingers round the other.
  assert.ok(him.palms.left.y > 0.9 && her.palms.right.y < -0.9);
  assert.equal(him.grips.left, 0.6);
  assert.equal(her.grips.right, 0.6);
  // His right palm is on her back (facing south, the way she faces);
  // her left palm is down on his arm. Both hands stay nearly open.
  assert.ok(him.palms.right.y < -0.9);
  assert.ok(her.palms.left.z < -0.8);
  assert.equal(him.grips.right, 0.15);
  assert.equal(her.grips.left, 0.15);
  // Every palm is a unit vector at right angles to the way its hand
  // points.
  for (const skeleton of [him, her]) {
    for (const side of ["left", "right"] as const) {
      const palm = skeleton.palms[side];
      const hand = pointing(skeleton, side);
      close(Math.hypot(palm.x, palm.y, palm.z), 1, 1e-9);
      close(palm.x * hand.x + palm.y * hand.y + palm.z * hand.z, 0, 1e-9);
    }
  }
  // Her left hand lies along his upper arm, fingers towards his
  // shoulder: from her wrist the fingers go up and back (south), and
  // the fingertips stay outside his shoulder, not in on his neck.
  const herLeft = pointing(her, "left");
  assert.ok(herLeft.z > 0 && herLeft.y < 0, `${JSON.stringify(herLeft)}`);
  assert.ok(her.fingertips.left.x > him.joints.rightUpperArm.x - 0.02);
  // His fingertips end near her spine (the line through her neck and
  // hips), not out beyond her right side.
  const spineX = her.joints.neck.x;
  assert.ok(Math.abs(him.fingertips.right.x - spineX) < 0.05);
});

test("solveSkeleton: the hold changes smoothly from closed to promenade and back", () => {
  // The Whisk goes from closed hold into crossed promenade.
  const whisk = loadFigures().find((figure) => figure.name === "Whisk");
  assert.ok(whisk);
  const figure = {
    ...whisk,
    id: "whisk",
    steps: whisk.steps.map((step, index) => ({ ...step, id: String(index) })),
  };
  let previous = solveSkeleton(poseAtBeat(figure, 0));
  for (let beat = 1 / 64; beat <= figureDurationBeats(figure); beat += 1 / 64) {
    const now = solveSkeleton(poseAtBeat(figure, beat));
    for (const partner of ["lead", "follow"] as const) {
      for (const joint of [
        "leftHand",
        "rightHand",
        "leftLowerArm",
        "rightLowerArm",
      ] as const) {
        assert.ok(
          gap(previous[partner].joints[joint], now[partner].joints[joint]) <
            0.03,
          `${partner} ${joint} jumps at beat ${beat}`,
        );
      }
      for (const side of ["left", "right"] as const) {
        assert.ok(
          gap(
            previous[partner].fingertips[side],
            now[partner].fingertips[side],
          ) < 0.03,
          `${partner} ${side} fingertip jumps at beat ${beat}`,
        );
        assert.ok(
          gap(previous[partner].palms[side], now[partner].palms[side]) < 0.1,
          `${partner} ${side} palm turns suddenly at beat ${beat}`,
        );
      }
    }
    assert.ok(
      gap(now.lead.joints.leftHand, now.follow.joints.rightHand) < 0.12,
    );
    previous = now;
  }
});

test("solveSkeleton: partners out of reach let go, back to the solo hold shape", () => {
  const pose = stancePose("closed", { lead: "right", follow: "left" });
  // Move the follow 3 m away.
  for (const foot of ["left", "right"] as const) {
    pose.follow[foot].position = {
      x: pose.follow[foot].position.x,
      y: pose.follow[foot].position.y + 3,
    };
  }
  const together = solveSkeleton(pose);
  const alone = solvePartnerSkeleton(pose.lead, LEAD, "lead");
  for (const joint of ["leftHand", "rightHand"] as const) {
    assert.ok(gap(together.lead.joints[joint], alone.joints[joint]) < 1e-9);
  }
  // The hands point straight on from the forearms again, palms in and
  // open, as when alone.
  for (const side of ["left", "right"] as const) {
    assert.ok(gap(together.lead.palms[side], alone.palms[side]) < 1e-9);
    assert.equal(together.lead.grips[side], 0);
    assert.equal(alone.grips[side], 0);
    assert.ok(
      gap(together.lead.fingertips[side], alone.fingertips[side]) < 1e-9,
    );
  }
});

test("solvePartnerSkeleton: a pointed foot lies along its direction, and its knee bends that way", () => {
  // The lead stands on his left with his right foot pointing 45° right
  // of his facing (0).
  const pose = lead([-0.1, 0], [0.1, 0.1], 1);
  pose.right.direction = 45;
  const skeleton = solvePartnerSkeleton(pose, LEAD, "lead");
  const { heel, toeTip } = skeleton.feet.right;
  const along = sub(toeTip, heel);
  close(Math.atan2(along.x, along.y) * (180 / Math.PI), 45, 1e-6);
  // The left foot still points the way he faces.
  const left = sub(skeleton.feet.left.toeTip, skeleton.feet.left.heel);
  close(left.x, 0, 1e-9);
  // The knee is ahead of the line from hip to ankle along the foot's
  // direction, not straight ahead.
  const knee = skeleton.joints.rightLowerLeg;
  const ankle = skeleton.joints.rightFoot;
  const hip = skeleton.joints.rightUpperLeg;
  const mid = { x: (hip.x + ankle.x) / 2, y: (hip.y + ankle.y) / 2 };
  const out = { x: knee.x - mid.x, y: knee.y - mid.y };
  if (Math.hypot(out.x, out.y) > 1e-6) {
    close(Math.atan2(out.x, out.y) * (180 / Math.PI), 45, 1);
  }
});

test("solvePartnerSkeleton: a landing foot's pitch tips it toes up (heel lead) or heel up (toe lead)", () => {
  for (const [pitch, up] of [
    [20, "toeTip"],
    [-20, "heel"],
  ] as const) {
    // Weight shared, feet level, so the leg reaches without peeling
    // further and only the pitch tips the foot.
    const pose = lead([-0.1, 0], [0.1, 0], 0.5);
    pose.right.pitch = pitch;
    const { heel, toeTip } = solvePartnerSkeleton(pose, LEAD, "lead").feet
      .right;
    const raised = up === "toeTip" ? toeTip : heel;
    const down = up === "toeTip" ? heel : toeTip;
    assert.ok(raised.z > down.z + 0.05, `${up} up for pitch ${pitch}`);
    // Tipped by 20°: the raised end is the foot's length times sin 20°
    // above the other, within the ball's offset.
    close(raised.z - down.z, Math.sin((20 * Math.PI) / 180) * 0.26, 0.04);
  }
});
