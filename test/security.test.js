import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, unsubscribeSignature, verifyUnsubscribeSignature } from '../src/security.js';

test('normalizes email addresses', () => {
  assert.equal(normalizeEmail('  Customer@Printmivo.com '), 'customer@printmivo.com');
});

test('validates non-expired unsubscribe signatures', () => {
  const secret = 'test-secret';
  const expires = Date.now() + 10_000;
  const signature = unsubscribeSignature({ email: 'hello@example.com', expires }, secret);
  assert.equal(verifyUnsubscribeSignature({ email: 'hello@example.com', expires, signature }, secret), true);
  assert.equal(verifyUnsubscribeSignature({ email: 'other@example.com', expires, signature }, secret), false);
});
