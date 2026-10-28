import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false
});

export async function upsertContact({ email, customerId = null, firstName = null, marketingState = 'UNKNOWN' }) {
  const result = await pool.query(
    `INSERT INTO email_contacts (shop_domain, email, customer_id, first_name, marketing_state)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (shop_domain, email) DO UPDATE SET
       customer_id = COALESCE(EXCLUDED.customer_id, email_contacts.customer_id),
       first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), email_contacts.first_name),
       marketing_state = EXCLUDED.marketing_state,
       updated_at = NOW()
     RETURNING *`,
    [config.shopDomain, email, customerId, firstName, marketingState]
  );
  return result.rows[0];
}

export async function suppressContact(email, reason) {
  await pool.query(
    `INSERT INTO email_contacts (shop_domain, email, marketing_state, suppressed_at, suppression_reason)
     VALUES ($1, $2, 'UNSUBSCRIBED', NOW(), $3)
     ON CONFLICT (shop_domain, email) DO UPDATE SET
       marketing_state = 'UNSUBSCRIBED', suppressed_at = NOW(), suppression_reason = $3, updated_at = NOW()`,
    [config.shopDomain, email, reason]
  );
}

export async function recordOrder({ orderId, email, customerId, orderNumber, orderedAt, lineItems }) {
  await pool.query(
    `INSERT INTO email_orders (shop_domain, order_id, email, customer_id, order_number, ordered_at, line_items)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (shop_domain, order_id) DO NOTHING`,
    [config.shopDomain, orderId, email, customerId, orderNumber, orderedAt, JSON.stringify(lineItems ?? [])]
  );
}

export async function enqueueCampaign({ campaignType, sourceId, recipientEmail, recipientName, payload, dueAt }) {
  const result = await pool.query(
    `INSERT INTO email_campaign_jobs
       (shop_domain, campaign_type, source_id, recipient_email, recipient_name, payload, due_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     ON CONFLICT (shop_domain, campaign_type, source_id) DO NOTHING
     RETURNING *`,
    [config.shopDomain, campaignType, sourceId, recipientEmail, recipientName, JSON.stringify(payload), dueAt]
  );
  return result.rows[0] ?? null;
}

export async function claimDueJobs(limit = 25) {
  const result = await pool.query(
    `WITH candidates AS (
       SELECT id FROM email_campaign_jobs
       WHERE status = 'queued' AND due_at <= NOW()
       ORDER BY due_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE email_campaign_jobs jobs
     SET status = 'sending', updated_at = NOW()
     FROM candidates
     WHERE jobs.id = candidates.id
     RETURNING jobs.*`,
    [limit]
  );
  return result.rows;
}

export async function sendEligibility(job, cooldownDays) {
  const result = await pool.query(
    `SELECT
       contacts.marketing_state,
       contacts.suppressed_at,
       EXISTS (
         SELECT 1 FROM email_campaign_jobs sent
         WHERE sent.shop_domain = $1
           AND sent.recipient_email = $2
           AND sent.status = 'sent'
           AND NOT ($5 = 'abandoned_checkout_follow_up' AND sent.campaign_type = 'abandoned_checkout')
           AND sent.sent_at > NOW() - ($3::text || ' days')::interval
       ) AS recently_sent,
       EXISTS (
         SELECT 1 FROM email_orders orders
         WHERE orders.shop_domain = $1
           AND orders.email = $2
           AND orders.ordered_at > COALESCE(($6::jsonb ->> 'checkoutUpdatedAt')::timestamptz, $4)
       ) AS ordered_since_due
     FROM email_contacts contacts
     WHERE contacts.shop_domain = $1 AND contacts.email = $2`,
    [config.shopDomain, job.recipient_email, cooldownDays, job.due_at, job.campaign_type, JSON.stringify(job.payload ?? {})]
  );
  const contact = result.rows[0];
  if (!contact) return { allowed: false, reason: 'missing_contact' };
  if (contact.marketing_state !== 'SUBSCRIBED') return { allowed: false, reason: 'not_marketing_subscribed' };
  if (contact.suppressed_at) return { allowed: false, reason: 'suppressed' };
  if (contact.recently_sent) return { allowed: false, reason: 'frequency_capped' };
  if (['abandoned_checkout', 'abandoned_checkout_follow_up'].includes(job.campaign_type) && contact.ordered_since_due) return { allowed: false, reason: 'ordered_after_abandonment' };
  return { allowed: true };
}

export async function markSent(id, providerMessageId) {
  await pool.query(
    `UPDATE email_campaign_jobs SET status = 'sent', provider_message_id = $2, sent_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [id, providerMessageId]
  );
}

export async function markSkipped(id, reason) {
  await pool.query(
    `UPDATE email_campaign_jobs SET status = 'skipped', skip_reason = $2, updated_at = NOW() WHERE id = $1`,
    [id, reason]
  );
}

export async function markFailed(id, error) {
  await pool.query(
    `UPDATE email_campaign_jobs SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
    [id, String(error).slice(0, 1000)]
  );
}

export async function jobCounts() {
  const result = await pool.query(
    `SELECT status, COUNT(*)::int AS count FROM email_campaign_jobs WHERE shop_domain = $1 GROUP BY status`,
    [config.shopDomain]
  );
  return Object.fromEntries(result.rows.map(row => [row.status, row.count]));
}

const defaults = {
  abandoned_checkout: {
    enabled: true,
    delayMinutes: config.abandonedCheckoutDelayMinutes,
    cooldownDays: config.marketingCooldownDays,
    subject: 'Your Printmivo order is waiting',
    preheader: 'Your custom stamp is ready when you are.',
    heading: 'Still thinking it over{{first_name}}?',
    body: 'Your selected Printmivo items are still saved. Finish checkout whenever you are ready.',
    ctaLabel: 'Return to checkout',
    ctaUrl: '{{recovery_url}}',
    template: { heroEnabled: true, recommendationsEnabled: true, footerEnabled: true }
  },
  abandoned_checkout_follow_up: {
    enabled: true,
    delayMinutes: 24 * 60,
    cooldownDays: config.marketingCooldownDays,
    subject: 'A little reminder from Printmivo',
    preheader: 'Your custom stamp is still ready when you are.',
    heading: 'Your custom stamp is still waiting{{first_name}}',
    body: 'Your saved Printmivo items are ready whenever you are. Complete your order when the timing feels right.',
    ctaLabel: 'Return to checkout',
    ctaUrl: '{{recovery_url}}',
    template: { heroEnabled: true, recommendationsEnabled: false, footerEnabled: true }
  },
  post_purchase_upsell: {
    enabled: true,
    delayMinutes: config.postPurchaseDelayDays * 24 * 60,
    cooldownDays: config.marketingCooldownDays,
    subject: 'Complete your Printmivo kit',
    preheader: 'A few finishing touches for your next order.',
    heading: 'A useful next step{{first_name}}',
    body: 'Keep your branding consistent with practical add-ons picked for your recent Printmivo order.',
    ctaLabel: 'Shop recommended add-ons',
    ctaUrl: `${config.storeUrl}/collections/all?utm_source=printmivo-email&utm_medium=upsell&utm_campaign=post_purchase`,
    template: { heroEnabled: true, recommendationsEnabled: true, footerEnabled: true }
  }
};

function toSetting(row) {
  return {
    campaignType: row.campaign_type,
    enabled: row.enabled,
    delayMinutes: row.delay_minutes,
    cooldownDays: row.cooldown_days,
    subject: row.subject,
    preheader: row.preheader,
    heading: row.heading,
    body: row.body,
    ctaLabel: row.cta_label,
    ctaUrl: row.cta_url,
    template: row.template_json ?? { heroEnabled: true, recommendationsEnabled: true, footerEnabled: true },
    updatedAt: row.updated_at
  };
}

export async function ensureCampaignSettings() {
  for (const [campaignType, setting] of Object.entries(defaults)) {
    await pool.query(
      `INSERT INTO email_campaign_settings
       (shop_domain, campaign_type, enabled, delay_minutes, cooldown_days, subject, preheader, heading, body, cta_label, cta_url, template_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
       ON CONFLICT (shop_domain, campaign_type) DO NOTHING`,
      [config.shopDomain, campaignType, setting.enabled, setting.delayMinutes, setting.cooldownDays, setting.subject, setting.preheader, setting.heading, setting.body, setting.ctaLabel, setting.ctaUrl, JSON.stringify(setting.template)]
    );
  }
}

export async function getCampaignSettings(campaignType) {
  await ensureCampaignSettings();
  const result = await pool.query(
    `SELECT * FROM email_campaign_settings WHERE shop_domain = $1 AND campaign_type = $2`,
    [config.shopDomain, campaignType]
  );
  return result.rows[0] ? toSetting(result.rows[0]) : null;
}

export async function listCampaignSettings() {
  await ensureCampaignSettings();
  const result = await pool.query(
    `SELECT * FROM email_campaign_settings WHERE shop_domain = $1 ORDER BY campaign_type`,
    [config.shopDomain]
  );
  return result.rows.map(toSetting);
}

export async function updateCampaignSettings(campaignType, setting) {
  await ensureCampaignSettings();
  const result = await pool.query(
    `UPDATE email_campaign_settings SET
       enabled = $3, delay_minutes = $4, cooldown_days = $5, subject = $6, preheader = $7,
       heading = $8, body = $9, cta_label = $10, cta_url = $11, template_json = $12::jsonb, updated_at = NOW()
     WHERE shop_domain = $1 AND campaign_type = $2
     RETURNING *`,
    [config.shopDomain, campaignType, setting.enabled, setting.delayMinutes, setting.cooldownDays, setting.subject, setting.preheader, setting.heading, setting.body, setting.ctaLabel, setting.ctaUrl, JSON.stringify(setting.template ?? {})]
  );
  return result.rows[0] ? toSetting(result.rows[0]) : null;
}

export async function dashboardSummary() {
  await ensureCampaignSettings();
  const [jobs, subscribers, suppressed, recent] = await Promise.all([
    pool.query(
      `SELECT campaign_type, status, COUNT(*)::int AS count
       FROM email_campaign_jobs WHERE shop_domain = $1
       GROUP BY campaign_type, status`,
      [config.shopDomain]
    ),
    pool.query(`SELECT COUNT(*)::int AS count FROM email_contacts WHERE shop_domain = $1 AND marketing_state = 'SUBSCRIBED' AND suppressed_at IS NULL`, [config.shopDomain]),
    pool.query(`SELECT COUNT(*)::int AS count FROM email_contacts WHERE shop_domain = $1 AND suppressed_at IS NOT NULL`, [config.shopDomain]),
    pool.query(
      `SELECT campaign_type, recipient_email, status, due_at, sent_at, created_at
       FROM email_campaign_jobs WHERE shop_domain = $1
       ORDER BY COALESCE(sent_at, due_at, created_at) DESC LIMIT 8`,
      [config.shopDomain]
    )
  ]);
  const counts = { abandoned_checkout: {}, abandoned_checkout_follow_up: {}, post_purchase_upsell: {} };
  for (const row of jobs.rows) counts[row.campaign_type][row.status] = row.count;
  return {
    audience: { subscribed: subscribers.rows[0].count, suppressed: suppressed.rows[0].count },
    counts,
    recent: recent.rows.map(row => ({
      campaignType: row.campaign_type,
      recipient: row.recipient_email.replace(/(^.).*(@.*$)/, '$1•••$2'),
      status: row.status,
      timestamp: row.sent_at ?? row.due_at ?? row.created_at
    }))
  };
}
