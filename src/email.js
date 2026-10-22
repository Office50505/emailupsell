import crypto from 'node:crypto';
import { config } from './config.js';
import { unsubscribeSignature } from './security.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function unsubscribeUrl(email) {
  const expires = Date.now() + 365 * 24 * 60 * 60 * 1000;
  const signature = unsubscribeSignature({ email, expires }, config.unsubscribeSecret);
  return `${config.storeUrl}/apps/email-upsell/unsubscribe?email=${encodeURIComponent(email)}&expires=${expires}&signature=${signature}`;
}

function layout({ preheader, heading, copy, ctaLabel, ctaUrl, email }) {
  return `<!doctype html><html><body style="margin:0;background:#f6f4f1;font-family:Arial,sans-serif;color:#202120">
  <span style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</span>
  <main style="max-width:600px;margin:0 auto;background:#fff;padding:40px 32px">
    <p style="color:#176b4c;font-weight:700;letter-spacing:.08em">PRINTMIVO</p>
    <h1 style="font-size:28px;line-height:1.2">${escapeHtml(heading)}</h1>
    <p style="font-size:16px;line-height:1.6">${escapeHtml(copy)}</p>
    <p><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#ee2634;color:#fff;padding:14px 22px;border-radius:6px;text-decoration:none;font-weight:700">${escapeHtml(ctaLabel)}</a></p>
    <hr style="border:0;border-top:1px solid #e8e5df;margin:32px 0 20px">
    <p style="font-size:12px;line-height:1.5;color:#686868">You received this because you opted in to Printmivo marketing. <a href="${unsubscribeUrl(email)}">Unsubscribe</a>.</p>
  </main></body></html>`;
}

function replaceTokens(value, job) {
  const firstName = job.recipient_name ? ` ${job.recipient_name}` : '';
  return String(value ?? '')
    .replaceAll('{{first_name}}', firstName)
    .replaceAll('{{recovery_url}}', job.payload?.recoveryUrl ?? config.storeUrl);
}

export function renderEmail(job, setting) {
  return {
    subject: replaceTokens(setting.subject, job),
    html: layout({
      preheader: replaceTokens(setting.preheader, job),
      heading: replaceTokens(setting.heading, job),
      copy: replaceTokens(setting.body, job),
      ctaLabel: replaceTokens(setting.ctaLabel, job),
      ctaUrl: replaceTokens(setting.ctaUrl, job),
      email: job.recipient_email
    })
  };
}

export function renderCampaignPreview(setting) {
  return renderEmail({
    recipient_name: 'Avery',
    recipient_email: 'preview@printmivo.com',
    payload: { recoveryUrl: `${config.storeUrl}/checkout` }
  }, setting);
}

export async function deliverEmail({ to, subject, html }) {
  if (config.emailMode === 'preview') {
    const id = `preview_${crypto.randomUUID()}`;
    console.log(JSON.stringify({ event: 'email.preview', id, to, subject }));
    return { id };
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.emailFrom, to: [to], subject, html })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `Resend failed (${response.status})`);
  return { id: body.id };
}
