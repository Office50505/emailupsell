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
           AND sent.sent_at > NOW() - ($3::text || ' days')::interval
       ) AS recently_sent,
       EXISTS (
         SELECT 1 FROM email_orders orders
         WHERE orders.shop_domain = $1
           AND orders.email = $2
           AND orders.ordered_at > $4
       ) AS ordered_since_due
     FROM email_contacts contacts
     WHERE contacts.shop_domain = $1 AND contacts.email = $2`,
    [config.shopDomain, job.recipient_email, cooldownDays, job.due_at]
  );
  const contact = result.rows[0];
  if (!contact) return { allowed: false, reason: 'missing_contact' };
  if (contact.marketing_state !== 'SUBSCRIBED') return { allowed: false, reason: 'not_marketing_subscribed' };
  if (contact.suppressed_at) return { allowed: false, reason: 'suppressed' };
  if (contact.recently_sent) return { allowed: false, reason: 'frequency_capped' };
  if (job.campaign_type === 'abandoned_checkout' && contact.ordered_since_due) return { allowed: false, reason: 'ordered_after_abandonment' };
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
