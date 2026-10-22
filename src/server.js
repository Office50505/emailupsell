import express from 'express';
import { config } from './config.js';
import { queueAbandonedCheckouts, processDueJobs, queuePostPurchaseOrder } from './campaigns.js';
import { jobCounts, recordOrder, suppressContact, upsertContact } from './db.js';
import { hasValidWebhookHmac, normalizeEmail, verifyUnsubscribeSignature } from './security.js';
import { contactFromMarketingWebhook, contactFromOrder } from './webhooks.js';

const app = express();
app.get('/health', async (_request, response) => response.json({ ok: true, emailMode: config.emailMode, jobs: await jobCounts() }));

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

app.listen(config.port, () => console.log(`Printmivo email-upsell service listening on :${config.port} (${config.emailMode})`));
