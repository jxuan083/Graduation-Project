import assert from 'node:assert/strict';
import test from 'node:test';
import { careAvailability } from '../frontend/features/pets/care-state.js';
const pet = { pet_face_url: 'puppy.png', pet_energy: 50, pet_happiness: 70, pet_cleanliness: 60 };
test('care explains full stats, low energy and rescue before a request is sent', () => {
    assert.equal(careAvailability({ ...pet, pet_energy: 100 }, 'feed').disabled, true);
    assert.equal(careAvailability({ ...pet, pet_cleanliness: 95 }, 'wipe').disabled, true);
    assert.equal(careAvailability({ ...pet, pet_energy: 8 }, 'play').label, '先吃一點東西');
    assert.equal(careAvailability({ ...pet, pet_is_caged: true }, 'feed').label, '完成聚會解鎖');
    assert.equal(careAvailability(pet, 'feed').disabled, false);
});
test('an uncertain result can be reconciled with the same request despite a refreshed cooldown', () => {
    const refreshed = { ...pet, pet_energy: 100, pet_cooldowns: { feed: 599 } };
    assert.equal(careAvailability(refreshed, 'feed', { pending: 'feed' }).disabled, false);
    assert.equal(careAvailability(refreshed, 'play', { pending: 'feed' }).disabled, true);
    assert.equal(careAvailability(refreshed, 'feed', { pending: 'feed', busy: true }).disabled, true);
    assert.equal(careAvailability(refreshed, 'feed').remaining, 599);
});
