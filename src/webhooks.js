import { normalizeEmail } from './security.js';

export function marketingState(value) {
  const state = String(value ?? '').trim().toUpperCase();
  if (['SUBSCRIBED', 'SUBSCRIBED_BY_CUSTOMER'].includes(state)) return 'SUBSCRIBED';
  if (['NOT_SUBSCRIBED', 'UNSUBSCRIBED', 'PENDING'].includes(state)) return state === 'NOT_SUBSCRIBED' ? 'UNSUBSCRIBED' : state;
  return 'UNKNOWN';
}

export function contactFromOrder(order) {
  return {
    email: normalizeEmail(order.email ?? order.customer?.email),
    customerId: order.customer?.admin_graphql_api_id ?? (order.customer?.id ? `gid://shopify/Customer/${order.customer.id}` : null),
    firstName: order.customer?.first_name ?? order.customer?.firstName ?? null,
    marketingState: marketingState(order.customer?.email_marketing_consent?.state ?? order.customer?.emailMarketingConsent?.state)
  };
}

export function contactFromMarketingWebhook(payload) {
  return {
    email: normalizeEmail(payload.email_address ?? payload.email),
    customerId: payload.customer_id ? `gid://shopify/Customer/${payload.customer_id}` : null,
    firstName: null,
    marketingState: marketingState(payload.email_marketing_consent?.state ?? payload.emailMarketingConsent?.state)
  };
}
