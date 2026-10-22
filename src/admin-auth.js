import { jwtVerify } from 'jose';
import { config } from './config.js';

const signingKey = new TextEncoder().encode(config.shopifyClientSecret);

export async function requireEmbeddedAdmin(request, response, next) {
  const authorization = request.get('Authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return response.status(401).json({ error: 'An embedded Shopify Admin session is required.' });

  try {
    const { payload } = await jwtVerify(token, signingKey, {
      algorithms: ['HS256'],
      audience: config.shopifyClientId
    });
    const destination = new URL(String(payload.dest ?? ''));
    if (destination.hostname !== config.shopDomain) throw new Error('Token was issued for another shop.');
    request.shopifySession = payload;
    next();
  } catch (error) {
    console.warn('Rejected embedded admin session:', error.message);
    response.status(401).json({ error: 'Your Shopify Admin session has expired. Refresh and try again.' });
  }
}
