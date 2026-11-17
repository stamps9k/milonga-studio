import * as THREE from "three";

import type { BodyProportions } from "../body/proportions.mts";
import type { PartnerSkeleton } from "../body/skeleton.mts";
import { headingVector, twoBoneJoint, vec } from "../body/vector3.mts";
import type { Point3D } from "../body/vector3.mts";
import type { Foot, Partner } from "../dance/step.mts";
import { toThree } from "./scene3d.mts";

/**
 * Character models for the 3D view: rigged human figures that dance the
 * same skeleton as the mannequin (src/libs/body/), as an alternative look.
 *
 * A model brings its own bones, with its own lengths and rest pose. Each
 * frame, CharacterRig poses those bones from the body solver's skeleton:
 * it puts the model's hip joints on ours, turns the model to the
 * dancer's facing, and points each leg and arm bone along our limbs,
 * with knees and elbows worked out again for the model's own bone
 * lengths so its feet land exactly on our ankles and its hands on our
 * wrists. Spine, neck and head keep the model's rest pose, turned with
 * the body (our skeleton's torso is upright too).
 *
 * This file has no WebGL: it works on Three.js bones (plain objects), so
 * it is tested under node:test with a hand-built rig.
 */

/** Which model each dancer wears. Files live in public/models/ (served
 *  from /models/), with their licence and source in a README there. */
export const CHARACTER_MODELS: Record<Partner, { url: string; name: string }> =
  {
    lead: {
      url: "/models/quaternius/superhero_male.glb",
      name: "Quaternius Superhero (male)",
    },
    follow: {
      url: "/models/quaternius/superhero_female.glb",
      name: "Quaternius Superhero (female)",
    },
  };

/**
 * Bone names in the model, for the joints we drive. These are the names
 * Unreal Engine's standard skeleton uses (also used by Quaternius's
 * Universal Base Characters and many other rigged models).
 */
export const MODEL_BONES = {
  pelvis: "pelvis",
  left: {
    thigh: "thigh_l",
    calf: "calf_l",
    foot: "foot_l",
    ball: "ball_l",
    toeEnd: "ball_leaf_l",
    upperArm: "upperarm_l",
    lowerArm: "lowerarm_l",
    hand: "hand_l",
    /** The middle finger's first bone: the hand bone is aimed through
     *  it, at the skeleton's fingertip. */
    middle: "middle_01_l",
  },
  right: {
    thigh: "thigh_r",
    calf: "calf_r",
    foot: "foot_r",
    ball: "ball_r",
    toeEnd: "ball_leaf_r",
    upperArm: "upperarm_r",
    lowerArm: "lowerarm_r",
    hand: "hand_r",
    /** The middle finger's first bone: the hand bone is aimed through
     *  it, at the skeleton's fingertip. */
    middle: "middle_01_r",
  },
} as const;

type LimbBones = Record<keyof (typeof MODEL_BONES)["left"], THREE.Object3D>;

/**
 * The fingers we curl, each a chain of three bones from the knuckle
 * (`index_01_l` ... `index_03_l`, Unreal-style names). The thumb is left
 * as modelled. Index and little finger also give the hand's width, which
 * with the way it points says which side the palm is on (palmOf).
 */
const FINGERS = ["index", "middle", "ring", "pinky"] as const;
type Finger = (typeof FINGERS)[number];

/**
 * How far each finger joint bends (radians) at a grip of 1, from the
 * knuckle out: about a loose fist. A grip of 0.6 (the joined hands) is
 * 0.6 of each. Provisional (2026-11-17).
 */
const CURL = [1.4, 1.6, 1.1] as const;

/**
 * The thumb (`thumb_01_l` ... `thumb_03_l`) closes too, by THUMB_CURL
 * (radians, at a grip of 1) at each joint. Its base swings in towards the
 * fingers (the way the hand points), along the side of the hand held;
 * its outer joints bend towards the palm. Bending the base towards the
 * palm instead swung the thumb out in front of the hand. Each joint's
 * axis is worked out from wherever it points, since the thumb's bending
 * axis differs from the fingers' and from model to model. Provisional
 * (2026-11-17).
 */
const THUMB_CURL = [0.6, 0.4, 0.4] as const;

/** Floor space (x, y, height) from Three.js's axes: toThree reversed. */
function toFloor(v: THREE.Vector3): Point3D {
  return vec(v.x, -v.z, v.y);
}

function three(point: Point3D): THREE.Vector3 {
  return new THREE.Vector3(...toThree(point));
}

function worldPosition(object: THREE.Object3D): THREE.Vector3 {
  return object.getWorldPosition(new THREE.Vector3());
}

/**
 * Turns `bone` (keeping its position) so that `child`, wherever it now
 * sits, lies on the line from the bone towards `target`. The turn is the
 * smallest one that does it, applied on top of the bone's current
 * orientation, so the bone keeps its rest twist.
 */
function aim(
  bone: THREE.Object3D,
  child: THREE.Object3D,
  target: THREE.Vector3,
) {
  bone.updateWorldMatrix(true, true);
  const origin = worldPosition(bone);
  const current = worldPosition(child).sub(origin).normalize();
  const wanted = target.clone().sub(origin);
  if (wanted.lengthSq() < 1e-12 || current.lengthSq() < 1e-12) return;
  wanted.normalize();
  const turn = new THREE.Quaternion().setFromUnitVectors(current, wanted);
  const world = bone.getWorldQuaternion(new THREE.Quaternion());
  const parentWorld = bone.parent
    ? bone.parent.getWorldQuaternion(new THREE.Quaternion())
    : new THREE.Quaternion();
  bone.quaternion.copy(parentWorld.invert().multiply(turn.multiply(world)));
  bone.updateWorldMatrix(false, true);
}

/** Turns `bone` (keeping its position) by `turn`, a rotation in world
 *  space, on top of its current orientation. */
function turnWorld(bone: THREE.Object3D, turn: THREE.Quaternion) {
  bone.updateWorldMatrix(true, false);
  const world = bone.getWorldQuaternion(new THREE.Quaternion());
  const parentWorld = bone.parent
    ? bone.parent.getWorldQuaternion(new THREE.Quaternion())
    : new THREE.Quaternion();
  bone.quaternion.copy(
    parentWorld.invert().multiply(turn.clone().multiply(world)),
  );
  bone.updateWorldMatrix(false, true);
}

/**
 * Which way a model's hand points (`along`, wrist to middle knuckle) and
 * which way its palm faces (`palm`, at right angles to that), worked out
 * from where its knuckles are, in world space. Across the knuckles from
 * the little finger to the index finger is towards the thumb; for a
 * right hand pointing away from you with the thumb to the left, the palm
 * faces down, which is (towards the thumb) x (along); a left hand is the
 * mirror image, (along) x (towards the thumb). Anatomy rather than the
 * model's bone axes, so it holds for any model with these bones.
 */
function palmOf(
  side: Foot,
  hand: THREE.Object3D,
  fingers: Record<Finger, THREE.Object3D[]>,
): { along: THREE.Vector3; palm: THREE.Vector3 } {
  const wrist = worldPosition(hand);
  const along = worldPosition(fingers.middle[0]).sub(wrist).normalize();
  const thumbwards = worldPosition(fingers.index[0]).sub(
    worldPosition(fingers.pinky[0]),
  );
  const palm =
    side === "right"
      ? new THREE.Vector3().crossVectors(thumbwards, along)
      : new THREE.Vector3().crossVectors(along, thumbwards);
  palm.addScaledVector(along, -palm.dot(along)).normalize();
  return { along, palm };
}

/** Finds a bone by name, or explains which model lacks it. */
function bone(model: THREE.Object3D, name: string): THREE.Object3D {
  const found = model.getObjectByName(name);
  if (!found) {
    throw new Error(`the character model has no bone called "${name}"`);
  }
  return found;
}

/**
 * One dancer's character model, posed from the body solver's skeleton.
 *
 * The model is expected to stand in its rest pose facing +Z (glTF's
 * "front"), feet on the ground, with Unreal-style bone names
 * (MODEL_BONES). It is scaled so its leg (hip joint to ankle) is as long
 * as the dancer's (BodyProportions), which keeps its hips at our height
 * and its stride the same as ours.
 */
export class CharacterRig {
  /** Add this to the scene. */
  readonly object = new THREE.Group();
  private readonly pelvis: THREE.Object3D;
  private readonly limbs: Record<Foot, LimbBones>;
  private readonly fingers: Record<Foot, Record<Finger, THREE.Object3D[]>>;
  private readonly thumbs: Record<Foot, THREE.Object3D[]>;
  /** Every bone we turn, with its rest orientation, to start each frame
   *  from the rest pose (so nothing drifts from frame to frame). */
  private readonly rest = new Map<THREE.Object3D, THREE.Quaternion>();
  private readonly lengths: Record<
    Foot,
    { thigh: number; shin: number; upperArm: number; forearm: number }
  >;

  constructor(model: THREE.Object3D, body: BodyProportions) {
    this.object.add(model);
    this.pelvis = bone(model, MODEL_BONES.pelvis);
    const limb = (side: Foot): LimbBones => {
      const names = MODEL_BONES[side];
      return {
        thigh: bone(model, names.thigh),
        calf: bone(model, names.calf),
        foot: bone(model, names.foot),
        ball: bone(model, names.ball),
        toeEnd: bone(model, names.toeEnd),
        upperArm: bone(model, names.upperArm),
        lowerArm: bone(model, names.lowerArm),
        hand: bone(model, names.hand),
        middle: bone(model, names.middle),
      };
    };
    this.limbs = { left: limb("left"), right: limb("right") };
    const fingers = (side: Foot) => {
      const suffix = side === "left" ? "l" : "r";
      return Object.fromEntries(
        FINGERS.map((finger) => [
          finger,
          [1, 2, 3].map((joint) =>
            bone(model, `${finger}_0${joint}_${suffix}`),
          ),
        ]),
      ) as Record<Finger, THREE.Object3D[]>;
    };
    this.fingers = { left: fingers("left"), right: fingers("right") };
    const thumb = (side: Foot) =>
      [1, 2, 3, 4].map((joint) =>
        bone(
          model,
          `thumb_0${joint}${joint === 4 ? "_leaf" : ""}_${side === "left" ? "l" : "r"}`,
        ),
      );
    this.thumbs = { left: thumb("left"), right: thumb("right") };
    for (const object of [
      this.pelvis,
      ...Object.values(this.limbs.left),
      ...Object.values(this.limbs.right),
      ...Object.values(this.fingers.left).flat(),
      ...Object.values(this.fingers.right).flat(),
      ...this.thumbs.left,
      ...this.thumbs.right,
    ]) {
      this.rest.set(object, object.quaternion.clone());
    }

    // Scale so the model's leg matches the dancer's.
    model.updateWorldMatrix(true, true);
    const between = (a: THREE.Object3D, b: THREE.Object3D) =>
      worldPosition(a).distanceTo(worldPosition(b));
    const left = this.limbs.left;
    const modelLeg =
      between(left.thigh, left.calf) + between(left.calf, left.foot);
    const scale = (body.thigh + body.shin) / modelLeg;
    this.object.scale.setScalar(scale);
    // Measured now the model is scaled (world positions include it).
    const lengths = (side: Foot) => {
      const l = this.limbs[side];
      return {
        thigh: between(l.thigh, l.calf),
        shin: between(l.calf, l.foot),
        upperArm: between(l.upperArm, l.lowerArm),
        forearm: between(l.lowerArm, l.hand),
      };
    };
    this.lengths = { left: lengths("left"), right: lengths("right") };

    model.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        // Skinned meshes are culled by their rest-pose bounds, which a
        // dancing pose leaves behind.
        object.frustumCulled = false;
      }
    });
  }

  /** Poses the model as `skeleton` (one dancer, one instant). */
  pose(skeleton: PartnerSkeleton): void {
    for (const [object, quaternion] of this.rest) {
      object.quaternion.copy(quaternion);
    }

    // Face the dancer's way: the model faces +Z; a compass heading h
    // faces (sin h, 0, -cos h) in Three.js, which is +Z turned by
    // (180° - h) about the vertical.
    this.object.position.set(0, 0, 0);
    this.object.rotation.set(0, Math.PI - (skeleton.facing * Math.PI) / 180, 0);
    this.object.updateWorldMatrix(true, true);
    // Then move the whole model so the point between its hip joints is
    // on our hips (which is that point in our skeleton). The model's
    // pelvis bone itself sits a little lower, so placing it instead
    // would leave the legs a couple of centimetres short of the feet.
    const between = worldPosition(this.limbs.left.thigh)
      .add(worldPosition(this.limbs.right.thigh))
      .multiplyScalar(0.5);
    const offset = three(skeleton.joints.hips).sub(between);
    this.object.position.copy(offset);
    this.object.updateWorldMatrix(true, true);

    const { joints, feet } = skeleton;
    const forward = headingVector(skeleton.facing);
    const right = headingVector(skeleton.facing + 90);
    for (const side of ["left", "right"] as const) {
      const l = this.limbs[side];
      const lengths = this.lengths[side];

      // Leg: knee from the model's own thigh and shin lengths, bending
      // the way the toes point (heel to toe along the floor, which is
      // the body's facing unless the foot is pointed further round), so
      // the ankle lands exactly on ours.
      const hip = toFloor(worldPosition(l.thigh));
      const ankle = joints[`${side}Foot`];
      const { heel, toeTip } = feet[side];
      const toes = Math.hypot(toeTip.x - heel.x, toeTip.y - heel.y);
      const kneePole =
        toes > 1e-9
          ? vec((toeTip.x - heel.x) / toes, (toeTip.y - heel.y) / toes, 0)
          : forward;
      const knee = twoBoneJoint(
        hip,
        ankle,
        lengths.thigh,
        lengths.shin,
        kneePole,
      );
      aim(l.thigh, l.calf, three(knee));
      aim(l.calf, l.foot, three(ankle));
      aim(l.foot, l.ball, three(joints[`${side}Toes`]));
      aim(l.ball, l.toeEnd, three(feet[side].toeTip));

      // Arm: elbow from the model's own lengths, bending down and out as
      // the body solver's do, so the wrist lands on ours.
      const shoulder = toFloor(worldPosition(l.upperArm));
      const wrist = joints[`${side}Hand`];
      const outwards = side === "left" ? -1 : 1;
      const elbow = twoBoneJoint(
        shoulder,
        wrist,
        lengths.upperArm,
        lengths.forearm,
        {
          x: right.x * outwards,
          y: right.y * outwards,
          z: -1,
        },
      );
      aim(l.upperArm, l.lowerArm, three(elbow));
      aim(l.lowerArm, l.hand, three(wrist));
      // Hand: pointing the way the skeleton's does (on her back, up the
      // lead's arm, upright at the joined hands). Left in its rest pose,
      // the hand carried straight on from the forearm, so the lead's
      // right hand stuck out past the follow's back instead of lying on
      // it. Only the direction is set: the smallest turn that does it,
      // so the palm keeps the forearm's twist.
      aim(l.hand, l.middle, three(skeleton.fingertips[side]));
      this.shapeHand(side, skeleton);
    }
  }
  /**
   * Turns a hand (already pointing at the skeleton's fingertip) about
   * the way it points until its palm faces the skeleton's palm, then
   * curls its fingers by the skeleton's grip. Together these make the
   * joined hands clasp, palm to palm with the fingers round each other,
   * instead of standing open side by side.
   */
  private shapeHand(side: Foot, skeleton: PartnerSkeleton): void {
    const hand = this.limbs[side].hand;
    const fingers = this.fingers[side];
    const along = palmOf(side, hand, fingers).along;
    const wanted = new THREE.Vector3(...toThree(skeleton.palms[side]));
    wanted.addScaledVector(along, -wanted.dot(along));
    if (wanted.lengthSq() < 1e-12) return;
    wanted.normalize();
    // Roll: the signed angle from the model's palm to the wanted one,
    // about the way the hand points. (A plain shortest turn between the
    // two could pick another axis when they are opposite.)
    const palm = palmOf(side, hand, fingers).palm;
    const angle = Math.atan2(
      new THREE.Vector3().crossVectors(palm, wanted).dot(along),
      palm.dot(wanted),
    );
    turnWorld(hand, new THREE.Quaternion().setFromAxisAngle(along, angle));

    // Curl: every joint turns the same way, about the axis that carries
    // the way the hand points towards the palm (along x palm), so the
    // fingers close onto the palm side.
    const grip = Math.min(1, Math.max(0, skeleton.grips[side]));
    if (grip === 0) return;
    const axis = new THREE.Vector3().crossVectors(along, wanted).normalize();
    for (const chain of Object.values(fingers)) {
      chain.forEach((joint, index) => {
        turnWorld(
          joint,
          new THREE.Quaternion().setFromAxisAngle(axis, grip * CURL[index]),
        );
      });
    }
    const thumb = this.thumbs[side];
    for (let index = 0; index < 3; index++) {
      const joint = thumb[index];
      const pointing = worldPosition(thumb[index + 1])
        .sub(worldPosition(joint))
        .normalize();
      const axis = new THREE.Vector3().crossVectors(
        pointing,
        index === 0 ? along : wanted,
      );
      if (axis.lengthSq() < 1e-12) continue;
      turnWorld(
        joint,
        new THREE.Quaternion().setFromAxisAngle(
          axis.normalize(),
          grip * THUMB_CURL[index],
        ),
      );
    }
  }
}
