import test from 'node:test';
import assert from 'node:assert/strict';
import { dueDateForMonth, normalizeEmails, reminderOffsets } from './fixed-reminders.js';

test('normalizes, validates and deduplicates reminder emails', () => {
    assert.deepEqual(normalizeEmails([' Jay@Example.com ', 'jay@example.com', 'bad']), ['jay@example.com']);
});

test('clamps a due day to the end of the month', () => {
    assert.equal(dueDateForMonth(2027, 2, 31), '2027-02-28');
    assert.equal(dueDateForMonth(2028, 2, 31), '2028-02-29');
});

test('reminds three days before and on the due date only', () => {
    assert.deepEqual(reminderOffsets('2026-09-22', '2026-09-25'), [3]);
    assert.deepEqual(reminderOffsets('2026-09-25', '2026-09-25'), [0]);
    assert.deepEqual(reminderOffsets('2026-09-23', '2026-09-25'), []);
});
