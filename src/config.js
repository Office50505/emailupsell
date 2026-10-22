import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInt(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? fallback, 10);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

const emailMode = process.env.EMAIL_MODE ?? 'preview';
if (!['preview', 'live'].includes(emailMode)) throw new Error('EMAIL_MODE must be preview or live');

export const config = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: required('DATABASE_URL'),
  databaseSsl: process.env.DATABASE_SSL !== 'false',
  shopDomain: required('SHOPIFY_SHOP_DOMAIN').replace(/^https?:\/\//, '').replace(/\/$/, ''),
  adminAccessToken: required('SHOPIFY_ADMIN_ACCESS_TOKEN'),
  webhookSecret: required('SHOPIFY_WEBHOOK_SECRET'),
  jobSecret: required('JOB_SECRET'),
  unsubscribeSecret: required('UNSUBSCRIBE_SECRET'),
  emailMode,
  emailFrom: required('EMAIL_FROM'),
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  storeUrl: (process.env.STORE_URL ?? 'https://printmivo.com').replace(/\/$/, ''),
  abandonedCheckoutDelayMinutes: positiveInt('ABANDONED_CHECKOUT_DELAY_MINUTES', '90'),
  postPurchaseDelayDays: positiveInt('POST_PURCHASE_DELAY_DAYS', '7'),
  marketingCooldownDays: positiveInt('MARKETING_COOLDOWN_DAYS', '7')
};

if (config.emailMode === 'live' && !config.resendApiKey) {
  throw new Error('RESEND_API_KEY is required when EMAIL_MODE=live');
}
