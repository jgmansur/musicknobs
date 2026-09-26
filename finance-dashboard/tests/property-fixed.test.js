import test from 'node:test';
import assert from 'node:assert/strict';
import {
    partnerEmails, projectPropertyFixedExpense, propertySharePercent,
} from '../property-fixed.js';

const property = {
    owners: [
        { name: 'Yo', percent: 33.34, email: 'jay@example.com' },
        { name: 'Socia', percent: 66.66, email: 'SOCIA@example.com' },
    ],
};

test('uses Jay share for the personal fixed expense', () => {
    const result = projectPropertyFixedExpense(property, { amount: 3000, notifyPartners: true });
    assert.equal(result.sharePercent, 33.34);
    assert.equal(result.myAmount, 1000.2);
});

test('sends reminders to partners, not the self owner', () => {
    assert.deepEqual(partnerEmails(property), ['socia@example.com']);
    const result = projectPropertyFixedExpense(property, {
        amount: 1000,
        notifyPartners: true,
        alertEmails: 'contador@example.com, socia@example.com',
    });
    assert.deepEqual(result.alertEmails, ['socia@example.com', 'contador@example.com']);
});

test('can disable partner reminders while keeping explicit recipients', () => {
    const result = projectPropertyFixedExpense(property, {
        amount: 1000,
        notifyPartners: false,
        alertEmails: 'contador@example.com',
    });
    assert.deepEqual(result.alertEmails, ['contador@example.com']);
});

test('falls back to the stored property percentage', () => {
    assert.equal(propertySharePercent({ miPorcentaje: 25 }), 25);
});
