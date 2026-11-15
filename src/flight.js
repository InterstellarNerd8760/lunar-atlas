import * as THREE from 'three';

// All flight angles use the local lunar vertical, including at the poles.
export function levelFlight(camera) {
  const up = camera.position.clone().normalize();
  const forward = camera.getWorldDirection(new THREE.Vector3());
  const right = new THREE.Vector3().crossVectors(forward, up);
  if (right.lengthSq() < 1e-10) {
    right.set(1, 0, 0).applyQuaternion(camera.quaternion).projectOnPlane(up);
    if (right.lengthSq() < 1e-10) right.set(0, 0, 1).projectOnPlane(up);
  }
  right.normalize();
  const ahead = new THREE.Vector3().crossVectors(up, right).normalize();
  const pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(forward.dot(up), -1, 1)), -1.52, 1.52);
  forward.copy(ahead).multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch));
  camera.up.copy(up);
  camera.lookAt(camera.position.clone().add(forward));
}

export function turnFlight(camera, yaw, pitch) {
  levelFlight(camera);
  const up = camera.up;
  const forward = camera.getWorldDirection(new THREE.Vector3()).applyAxisAngle(up, yaw);
  const elevation = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(forward.dot(up), -1, 1)) + pitch, -1.52, 1.52);
  forward.projectOnPlane(up).normalize().multiplyScalar(Math.cos(elevation)).addScaledVector(up, Math.sin(elevation));
  camera.lookAt(camera.position.clone().add(forward));
}

export function transportFlight(camera, previousUp) {
  const up = camera.position.clone().normalize();
  camera.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(previousUp, up));
  levelFlight(camera);
}

// A distant target must change the view direction, never the observer position.
export function aimAt(camera, target) {
  camera.up.copy(camera.position).normalize();
  camera.lookAt(target);
}
