import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { aimAt, levelFlight, transportFlight, turnFlight } from '../src/flight.js';

const direction = (camera) => camera.getWorldDirection(new THREE.Vector3());
const close = (a, b) => assert.ok(a.distanceTo(b) < 1e-8, `${a.toArray()} != ${b.toArray()}`);
function observer(up) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.copy(up).multiplyScalar(1.001);
  camera.up.copy(up);
  const ahead = new THREE.Vector3(0, 0, -1);
  if (Math.abs(ahead.dot(up)) > 0.9) ahead.set(1, 0, 0);
  ahead.projectOnPlane(up).normalize();
  camera.lookAt(camera.position.clone().add(ahead));
  return camera;
}
for (const [name, up] of [['equator', new THREE.Vector3(1, 0, 0)], ['north pole', new THREE.Vector3(0, 1, 0)], ['south pole', new THREE.Vector3(0, -1, 0)]]) {
  test(`Q/E turn around the local vertical at ${name}`, () => {
    const camera = observer(up);
    const original = direction(camera);
    turnFlight(camera, Math.PI / 2, 0);
    close(direction(camera), original.clone().applyAxisAngle(up, Math.PI / 2));
    turnFlight(camera, -Math.PI / 2, 0);
    close(direction(camera), original);
    close(camera.up, up);
  });
  test(`pitch stays stable and cannot flip at ${name}`, () => {
    const camera = observer(up);
    turnFlight(camera, 0, 100);
    assert.ok(Math.abs(direction(camera).dot(up) - Math.sin(1.52)) < 1e-8);
    for (let i = 0; i < 100; i++) turnFlight(camera, 0.1, 0);
    assert.ok(camera.quaternion.toArray().every(Number.isFinite));
    close(camera.up, up);
  });
}
test('Look at Earth preserves observer and points directly at Earth above or below horizon', () => {
  for (const target of [new THREE.Vector3(200, 20, -10), new THREE.Vector3(-200, 20, -10)]) {
    const camera = observer(new THREE.Vector3(1, 0, 0));
    const position = camera.position.clone();
    aimAt(camera, target);
    close(camera.position, position);
    close(direction(camera), target.clone().sub(position).normalize());
  }
});
test('movement across the Moon transports heading and maintains a level horizon', () => {
  const up = new THREE.Vector3(1, 0, 0);
  const camera = observer(up);
  const forward = direction(camera);
  const nextUp = new THREE.Vector3(0.9, 0.3, -0.2).normalize();
  camera.position.copy(nextUp).multiplyScalar(1.001);
  transportFlight(camera, up);
  close(direction(camera), forward.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, nextUp)));
  close(camera.up, nextUp);
});
test('entering flight preserves heading and handles a vertical initial view', () => {
  const camera = observer(new THREE.Vector3(1, 0, 0));
  const before = direction(camera);
  levelFlight(camera);
  close(direction(camera), before);
  camera.lookAt(new THREE.Vector3());
  levelFlight(camera);
  assert.ok(camera.quaternion.toArray().every(Number.isFinite));
});
