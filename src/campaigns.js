import { claimDueJobs, enqueueCampaign, getCampaignSettings, markFailed, markSent, markSkipped, sendEligibility } from './db.js';
import { deliverEmail, renderEmail } from './email.js';
import { listOpenAbandonedCheckouts } from './shopify.js';
import { normalizeEmail } from './security.js';

function dueInMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

export async function queueAbandonedCheckouts() {
  const setting = await getCampaignSettings('abandoned_checkout');
  if (!setting?.enabled) return { scanned: 0, queued: 0, disabled: true };
  const checkouts = await listOpenAbandonedCheckouts();
  let queued = 0;
  for (const checkout of checkouts) {
    const email = normalizeEmail(checkout.customer?.defaultEmailAddress?.emailAddress);
    if (!email || checkout.completedAt) continue;
    const job = await enqueueCampaign({
      campaignType: 'abandoned_checkout',
      sourceId: checkout.id,
      recipientEmail: email,
      recipientName: checkout.customer?.firstName ?? null,
      dueAt: dueInMinutes(setting.delayMinutes),
      payload: {
        recoveryUrl: checkout.abandonedCheckoutUrl,
        checkoutUpdatedAt: checkout.updatedAt,
        lineItems: checkout.lineItems?.nodes ?? []
      }
    });
    if (job) queued += 1;
  }
  return { scanned: checkouts.length, queued };
}

export async function queuePostPurchaseOrder(order) {
  const setting = await getCampaignSettings('post_purchase_upsell');
  if (!setting?.enabled) return null;
  const email = normalizeEmail(order.email ?? order.customer?.email);
  if (!email) return null;
  return enqueueCampaign({
    campaignType: 'post_purchase_upsell',
    sourceId: String(order.id),
    recipientEmail: email,
    recipientName: order.customer?.first_name ?? order.customer?.firstName ?? null,
    dueAt: dueInMinutes(setting.delayMinutes),
    payload: { orderId: String(order.id), orderName: order.name ?? order.order_number ?? '', lineItems: order.line_items ?? [] }
  });
}

export async function processDueJobs() {
  const jobs = await claimDueJobs();
  const summary = { claimed: jobs.length, sent: 0, skipped: 0, failed: 0 };
  for (const job of jobs) {
    try {
      const setting = await getCampaignSettings(job.campaign_type);
      if (!setting?.enabled) {
        await markSkipped(job.id, 'campaign_disabled');
        summary.skipped += 1;
        continue;
      }
      const eligibility = await sendEligibility(job, setting.cooldownDays);
      if (!eligibility.allowed) {
        await markSkipped(job.id, eligibility.reason);
        summary.skipped += 1;
        continue;
      }
      const email = renderEmail(job, setting);
      const delivery = await deliverEmail({ to: job.recipient_email, ...email });
      await markSent(job.id, delivery.id);
      // A recovery email starts a deterministic second branch. The job stays
      // safe and idempotent, then exits automatically if an order appears.
      if (job.campaign_type === 'abandoned_checkout') {
        const followUp = await getCampaignSettings('abandoned_checkout_follow_up');
        if (followUp?.enabled) {
          await enqueueCampaign({
            campaignType: 'abandoned_checkout_follow_up',
            sourceId: job.source_id,
            recipientEmail: job.recipient_email,
            recipientName: job.recipient_name,
            payload: { ...job.payload, recoveryStartedAt: new Date().toISOString() },
            dueAt: dueInMinutes(followUp.delayMinutes)
          });
        }
      }
      summary.sent += 1;
    } catch (error) {
      await markFailed(job.id, error);
      summary.failed += 1;
    }
  }
  return summary;
}
