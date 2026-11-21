import * as THREE from 'three';

/**
 * A riding pose for the detailed (skinned) characters, which have no seated
 * clip: applied over whatever the animation sampled, each frame. Each limb is
 * turned so its bone points along a direction in the rider's own frame
 * (forward is the figure's +z, left its +x), so it works whatever the bones'
 * rest orientations are. Bone names are the shared character skeleton's.
 */

const q = new THREE.Quaternion(), parentQ = new THREE.Quaternion(), worldQ = new THREE.Quaternion();
const from = new THREE.Vector3(), to = new THREE.Vector3(), current = new THREE.Vector3();

/** Turn `bone` (in world space) so the line to `child` points along `dir`. */
function aim(bone: THREE.Object3D | undefined, child: THREE.Object3D | undefined, dir: THREE.Vector3): void {
  if (!bone || !child || !bone.parent) return;
  bone.getWorldPosition(from); child.getWorldPosition(to);
  current.subVectors(to, from);
  if (current.lengthSq() < 1e-10) return;
  q.setFromUnitVectors(current.normalize(), dir);
  bone.parent.getWorldQuaternion(parentQ);
  bone.getWorldQuaternion(worldQ);
  bone.quaternion.copy(parentQ.invert().multiply(q.multiply(worldQ)));
  bone.updateMatrixWorld(true);
}

/** Directions, in the rider's frame, for each limb astride a 1920s motorcycle. */
const POSE: { bone: string; child: string; dir: [number, number, number] }[] = [
  // A slight lean over the tank.
  { bone: 'Spine02', child: 'Spine01', dir: [.3, 1, 0] },
  // Thighs along the tank, knees down to the footboards, feet flat on them.
  { bone: '{S}UpLeg', child: '{S}Leg', dir: [.8, -.55, .17] },
  { bone: '{S}Leg', child: '{S}Foot', dir: [.2, -1, .03] },
  { bone: '{S}Foot', child: '{S}ToeBase', dir: [1, -.12, 0] },
  // Arms reaching forward and down to the handlebar grips.
  { bone: '{S}Arm', child: '{S}ForeArm', dir: [.62, -.55, .3] },
  { bone: '{S}ForeArm', child: '{S}Hand', dir: [.92, -.15, .1] },
];

const forward = new THREE.Vector3(), left = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
const groupQ = new THREE.Quaternion(), dir = new THREE.Vector3();

/** Pose `model` (a skinned character inside `frame`, which carries its place and heading). */
export function poseRider(model: THREE.Object3D, frame: THREE.Object3D): void {
  frame.getWorldQuaternion(groupQ);
  forward.set(0, 0, 1).applyQuaternion(groupQ);
  left.set(1, 0, 0).applyQuaternion(groupQ);
  for (const { bone, child, dir: [f, u, s] } of POSE) {
    const sides = bone.includes('{S}') ? [['Left', 1], ['Right', -1]] as const : [['', 1]] as const;
    for (const [side, sign] of sides) {
      dir.set(0, 0, 0).addScaledVector(forward, f).addScaledVector(up, u).addScaledVector(left, s * sign).normalize();
      aim(model.getObjectByName(bone.replace('{S}', side)), model.getObjectByName(child.replace('{S}', side)), dir);
    }
  }
}

/** World height of the rider's hips (to sit them on the saddle). */
export function hipHeight(model: THREE.Object3D): number | null {
  const hips = model.getObjectByName('Hips');
  return hips ? hips.getWorldPosition(from).y : null;
}
