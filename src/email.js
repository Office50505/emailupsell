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

function emailCopy(value) {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

const brandLogoUrl = 'https://printmivo.com/cdn/shop/t/9/assets/printmivo-editorial-wordmark.png?width=360';
const defaultProductHeroUrl = 'https://printmivo.com/cdn/shop/t/9/assets/printmivo-hero-permanent-v1.webp?width=1200';

function productVisual(job) {
  const lineItem = job.payload?.lineItems?.[0] ?? {};
  const image = lineItem.image;
  const imageUrl = typeof image === 'string' ? image : image?.url ?? image?.src;

  return {
    // Shopify sends an image URL for abandoned checkout line items. Orders that
    // do not include one retain the on-brand permanent-stamp fallback.
    url: imageUrl || defaultProductHeroUrl,
    alt: lineItem.title ? `${lineItem.title} from Printmivo` : 'Custom Printmivo stamp on branded packaging'
  };
}

function layout({ preheader, heading, copy, ctaLabel, ctaUrl, email, campaignType, product }) {
  const safeCtaUrl = escapeHtml(ctaUrl);
  const safeUnsubscribeUrl = escapeHtml(unsubscribeUrl(email));
  const isRecovery = campaignType === 'abandoned_checkout';
  const eyebrow = isRecovery ? 'YOUR CUSTOM STAMP IS WAITING' : 'MAKE EVERY PACKAGE MEMORABLE';
  const productLabel = isRecovery ? 'Your brand, ready to make an impression.' : 'A small detail that makes your packaging feel considered.';

  // Table markup and inline styles are deliberate: Gmail and most mobile clients
  // consistently render this layout, unlike the CSS-dependent former version.
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>${escapeHtml(preheader)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f1eb;color:#18221c;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
    <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:0;padding:0;background-color:#f4f1eb;border-collapse:collapse;">
      <tr>
        <td align="center" style="padding:30px 14px 40px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;border-collapse:collapse;">
            <tr>
              <td align="center" style="padding:0 0 20px;">
                <a href="${escapeHtml(config.storeUrl)}" style="display:inline-block;text-decoration:none;">
                  <img src="${brandLogoUrl}" width="154" alt="Printmivo" style="display:block;width:154px;max-width:154px;height:auto;border:0;outline:none;text-decoration:none;">
                </a>
              </td>
            </tr>
            <tr>
              <td style="overflow:hidden;border:1px solid #dcd8cf;border-radius:18px;background-color:#fffdfa;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="padding:0;background-color:#dcefe2;">
                      <img src="${escapeHtml(product.url)}" width="600" alt="${escapeHtml(product.alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;">
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:30px 36px 10px;">
                      <p style="margin:0 0 14px;color:#14734f;font-size:11px;font-weight:bold;letter-spacing:1.55px;line-height:1.3;text-transform:uppercase;">${eyebrow}</p>
                      <h1 style="margin:0;color:#17211b;font-family:Georgia,'Times New Roman',serif;font-size:36px;font-weight:normal;letter-spacing:-1.25px;line-height:1.12;">${escapeHtml(heading)}</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:18px 36px 10px;">
                      <p style="margin:0;color:#435148;font-size:16px;line-height:1.65;">${emailCopy(copy)}</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:22px 36px 26px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background-color:#edf8ef;border:1px solid #cde5d3;border-radius:12px;">
                        <tr>
                          <td style="padding:14px 16px;color:#176044;font-size:13px;font-weight:bold;line-height:1.45;">${productLabel}</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 36px 34px;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;">
                        <tr>
                          <td align="center" bgcolor="#ef2b3a" style="border-radius:9px;">
                            <a href="${safeCtaUrl}" style="display:inline-block;padding:16px 27px;border:1px solid #ef2b3a;border-radius:9px;color:#ffffff;font-size:15px;font-weight:bold;line-height:1;text-align:center;text-decoration:none;">${escapeHtml(ctaLabel)} &nbsp;→</a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 36px 30px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;border-top:1px solid #e6e3dc;">
                        <tr>
                          <td style="padding-top:20px;color:#667269;font-size:12px;line-height:1.55;">Thoughtful details. Professional results. Built to make every impression count.</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:22px 20px 0;color:#747a74;font-size:11px;line-height:1.6;">
                You received this because you opted in to Printmivo marketing.<br>
                <a href="${safeUnsubscribeUrl}" style="color:#315f4c;text-decoration:underline;">Unsubscribe</a> from future marketing emails.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
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
      email: job.recipient_email,
      campaignType: job.campaign_type,
      product: productVisual(job)
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
