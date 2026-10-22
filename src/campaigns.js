import { config } from './config.js';
import { claimDueJobs, enqueueCampaign, markFailed, markSent, markSkipped, sendEligibility } from './db.js';
import { deliverEmail, renderEmail } from './email.js';
import { listOpenAbandonedCheckouts } from './shopify.js';
import { normalizeEmail } from './security.js';

function dueInMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function dueInDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export async function queueAbandonedCheckouts() {
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
      dueAt: dueInMinutes(config.abandonedCheckoutDelayMinutes),
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
  const email = normalizeEmail(order.email ?? order.customer?.email);
  if (!email) return null;
  return enqueueCampaign({
    campaignType: 'post_purchase_upsell',
    sourceId: String(order.id),
    recipientEmail: email,
    recipientName: order.customer?.first_name ?? order.customer?.firstName ?? null,
    dueAt: dueInDays(config.postPurchaseDelayDays),
    payload: { orderId: String(order.id), orderName: order.name ?? order.order_number ?? '', lineItems: order.line_items ?? [] }
  });
}

export async function processDueJobs() {
  const jobs = await claimDueJobs();
  const summary = { claimed: jobs.length, sent: 0, skipped: 0, failed: 0 };
  for (const job of jobs) {
    try {
      const eligibility = await sendEligibility(job, config.marketingCooldownDays);
      if (!eligibility.allowed) {
        await markSkipped(job.id, eligibility.reason);
        summary.skipped += 1;
        continue;
      }
      const email = renderEmail(job);
      const delivery = await deliverEmail({ to: job.recipient_email, ...email });
      await markSent(job.id, delivery.id);
      summary.sent += 1;
    } catch (error) {
      await markFailed(job.id, error);
      summary.failed += 1;
    }
  }
  return summary;
}
