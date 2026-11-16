import test from 'node:test';
import assert from 'node:assert/strict';
import { pinStatus, pinDescription } from '../src/pin-status.js';

test('marker categories are distinct', () => {
  assert.equal(pinStatus({group:'lander'}), 'landed');
  assert.equal(pinStatus({group:'lander',failed:true}), 'failed');
  assert.equal(pinStatus({group:'lander',approximate:true}), 'approximate');
  assert.equal(pinStatus({group:'artemis',proxy:true}), 'future');
  assert.equal(pinStatus({group:'feature'}), 'feature');
});
test('failed outcome overrides approximate coordinate display', () => {
  const place = {group:'failed',failed:true,approximate:true};
  assert.equal(pinStatus(place), 'failed');
  assert.match(pinDescription(place), /approximate/i);
});
