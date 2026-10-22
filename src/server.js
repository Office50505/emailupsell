import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { requireEmbeddedAdmin } from './admin-auth.js';
import { queueAbandonedCheckouts, processDueJobs, queuePostPurchaseOrder } from './campaigns.js';
import { dashboardSummary, getCampaignSettings, jobCounts, listCampaignSettings, recordOrder, suppressContact, updateCampaignSettings, upsertContact } from './db.js';
import { deliverEmail, renderCampaignPreview } from './email.js';
import { hasValidWebhookHmac, normalizeEmail, verifyUnsubscribeSignature } from './security.js';
import { contactFromMarketingWebhook, contactFromOrder } from './webhooks.js';

const app = express();
const dashboardDir = path.join(process.cwd(), 'public', 'app');
const campaignTypes = new Set(['abandoned_checkout', 'post_purchase_upsell']);

function rawWebhook(handler) {
  return [express.raw({ type: 'application/json' }), async (request, response) => {
    const rawBody = request.body;
    if (!hasValidWebhookHmac(rawBody, request.get('X-Shopify-Hmac-Sha256'), config.webhookSecret)) {
      return response.status(401).json({ error: 'Invalid webhook signature' });
    }
    try {
      await handler(JSON.parse(rawBody.toString('utf8')));
      response.status(200).json({ ok: true });
    } catch (error) {
      console.error(error);
      response.status(500).json({ error: 'Webhook processing failed' });
    }
  }];
}

function isSetting(value) {
  const validStrings = ['subject', 'preheader', 'heading', 'body', 'ctaLabel', 'ctaUrl']
    .every(key => typeof value?.[key] === 'string' && value[key].trim().length > 0 && value[key].length <= 2000);
  return Boolean(value && typeof value.enabled === 'boolean'
    && Number.isInteger(value.delayMinutes) && value.delayMinutes >= 5 && value.delayMinutes <= 43200
    && Number.isInteger(value.cooldownDays) && value.cooldownDays >= 1 && value.cooldownDays <= 90
    && validStrings
    && (/^https?:\/\//.test(value.ctaUrl) || value.ctaUrl === '{{recovery_url}}'));
}

app.get('/health', async (_request, response) => response.json({ ok: true, emailMode: config.emailMode, jobs: await jobCounts() }));

app.post('/webhooks/orders/create', ...rawWebhook(async order => {
  const contact = contactFromOrder(order);
  if (!contact.email) return;
  await upsertContact(contact);
  await recordOrder({
    orderId: String(order.id), email: contact.email, customerId: contact.customerId,
    orderNumber: order.name ?? String(order.order_number ?? ''), orderedAt: order.created_at ?? new Date().toISOString(), lineItems: order.line_items
  });
  if (contact.marketingState === 'SUBSCRIBED') await queuePostPurchaseOrder(order);
}));

app.post('/webhooks/customers/email-marketing-consent/update', ...rawWebhook(async payload => {
  const contact = contactFromMarketingWebhook(payload);
  if (contact.email) await upsertContact(contact);
}));

app.get('/unsubscribe', async (request, response) => {
  const { email, expires, signature } = request.query;
  if (!verifyUnsubscribeSignature({ email, expires, signature }, config.unsubscribeSecret)) {
    return response.status(400).send('This unsubscribe link is invalid or expired.');
  }
  await suppressContact(normalizeEmail(email), 'email_link');
  response.type('html').send('<main style="font-family:Arial;padding:3rem"><h1>You are unsubscribed.</h1><p>You will no longer receive Printmivo marketing emails.</p></main>');
});

app.post('/jobs/run', express.json(), async (request, response) => {
  if (request.get('Authorization') !== `Bearer ${config.jobSecret}`) return response.status(401).json({ error: 'Unauthorized' });
  try {
    const abandonment = await queueAbandonedCheckouts();
    const delivery = await processDueJobs();
    response.json({ ok: true, abandonment, delivery, mode: config.emailMode });
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: 'Campaign run failed' });
  }
});

app.get('/app-config.js', (_request, response) => {
  response.type('application/javascript').send(`window.__PRINTMIVO_APP__=${JSON.stringify({ apiKey: config.shopifyClientId, shop: config.shopDomain })};`);
});

app.use('/api/admin', express.json({ limit: '100kb' }), requireEmbeddedAdmin);

app.get('/api/admin/dashboard', async (_request, response) => {
  const [settings, summary] = await Promise.all([listCampaignSettings(), dashboardSummary()]);
  response.json({ settings, summary, mode: config.emailMode });
});

app.put('/api/admin/campaigns/:campaignType', async (request, response) => {
  const { campaignType } = request.params;
  if (!campaignTypes.has(campaignType) || !isSetting(request.body)) return response.status(422).json({ error: 'Enter valid campaign settings before saving.' });
  const setting = await updateCampaignSettings(campaignType, request.body);
  response.json({ setting });
});

app.get('/api/admin/campaigns/:campaignType/preview', async (request, response) => {
  if (!campaignTypes.has(request.params.campaignType)) return response.status(404).json({ error: 'Campaign not found.' });
  const setting = await getCampaignSettings(request.params.campaignType);
  response.json(renderCampaignPreview(setting));
});

app.post('/api/admin/campaigns/:campaignType/test', async (request, response) => {
  if (!campaignTypes.has(request.params.campaignType)) return response.status(404).json({ error: 'Campaign not found.' });
  const to = normalizeEmail(request.body?.email);
  if (!to || !/^\S+@\S+\.\S+$/.test(to)) return response.status(422).json({ error: 'Enter a valid test recipient email.' });
  const setting = await getCampaignSettings(request.params.campaignType);
  const email = renderCampaignPreview(setting);
  const delivery = await deliverEmail({ to, ...email });
  response.json({ ok: true, id: delivery.id, mode: config.emailMode });
});

app.use(express.static(dashboardDir, { maxAge: '1h', index: 'index.html' }));
app.get('/app', (_request, response) => response.sendFile(path.join(dashboardDir, 'index.html')));

app.listen(config.port, () => console.log(`Printmivo email-upsell service listening on :${config.port} (${config.emailMode})`));
