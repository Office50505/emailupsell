import crypto from 'node:crypto';

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function hmac(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64');
}

export function safelyEqual(left, right) {
  const leftBuffer = Buffer.from(left ?? '');
  const rightBuffer = Buffer.from(right ?? '');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function hasValidWebhookHmac(rawBody, signature, secret) {
  return safelyEqual(hmac(rawBody, secret), signature);
}

export function unsubscribeSignature({ email, expires }, secret) {
  return crypto.createHmac('sha256', secret).update(`${normalizeEmail(email)}:${expires}`).digest('hex');
}

export function verifyUnsubscribeSignature({ email, expires, signature }, secret, now = Date.now()) {
  if (!email || !expires || !signature || Number(expires) < now) return false;
  return safelyEqual(unsubscribeSignature({ email, expires }, secret), signature);
}
