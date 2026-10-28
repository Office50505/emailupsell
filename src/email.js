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
// Match the actual permanent-stamp product image customers see on the store.
// This is also used in dashboard tests where there is no live cart line item.
const defaultProductHeroUrl = 'https://cdn.shopify.com/s/files/1/0852/6000/9693/files/ChatGPTImageSep27_2026_06_31_21PM_207ad5ae-4da9-4c55-9b64-c4a6d6d41add.png?v=1790514740';
const refillInkImageUrl = 'https://cdn.shopify.com/s/files/1/0852/6000/9693/files/WhatsAppImage2026-04-25at19.18.27.jpg?v=1788956879&width=440&height=300&crop=center';
const stickerImageUrl = 'https://cdn.shopify.com/s/files/1/0852/6000/9693/files/ChatGPTImageSep11_2026_05_15_27PM.png?v=1789127383&width=440&height=300&crop=center';
const refillInkUrl = `${config.storeUrl}/products/permanent-refill-ink`;
const stickerUrl = `${config.storeUrl}/products/custom-logo-stickers-500-pcs-%E2%AD%90-by-stampmymark%C2%AE`;

function heroImageUrl(value) {
  try {
    const url = new URL(value);
    // Shopify's CDN makes a real 2:1 crop, not merely a CSS-scaled portrait.
    // This preserves a strong visual while keeping the main email compact.
    if (url.hostname.endsWith('shopify.com') || url.hostname === 'printmivo.com') {
      url.searchParams.set('width', '1200');
      url.searchParams.set('height', '600');
      url.searchParams.set('crop', 'center');
    }
    return url.toString();
  } catch (_error) {
    return value;
  }
}

function productVisual(job) {
  const lineItem = job.payload?.lineItems?.[0] ?? {};
  const image = lineItem.image;
  const imageUrl = typeof image === 'string' ? image : image?.url ?? image?.src;

  return {
    // Shopify sends an image URL for abandoned checkout line items. Orders that
    // do not include one retain the on-brand permanent-stamp fallback.
    url: heroImageUrl(imageUrl || defaultProductHeroUrl),
    alt: lineItem.title ? `${lineItem.title} from Printmivo` : 'Custom Printmivo stamp on branded packaging'
  };
}

function layout({ preheader, heading, copy, ctaLabel, ctaUrl, email, campaignType, product, template = {} }) {
  const safeCtaUrl = escapeHtml(ctaUrl);
  const safeUnsubscribeUrl = escapeHtml(unsubscribeUrl(email));
  const isRecovery = campaignType === 'abandoned_checkout';
  const eyebrow = isRecovery ? 'YOUR CUSTOM STAMP IS WAITING' : 'MAKE EVERY PACKAGE MEMORABLE';
  const productLabel = isRecovery ? 'Your brand, ready to make an impression.' : 'A small detail that makes your packaging feel considered.';
  const showHero = template.heroEnabled !== false;
  const showRecommendations = template.recommendationsEnabled !== false;
  const showFooter = template.footerEnabled !== false;

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
  <body style="margin:0;padding:0;background-color:#f4f1eb;background-image:linear-gradient(#f4f1eb,#f4f1eb);color:#18221c;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
    <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f4f1eb" style="width:100%;margin:0;padding:0;background-color:#f4f1eb;background-image:linear-gradient(#f4f1eb,#f4f1eb);border-collapse:collapse;">
      <tr>
        <td align="center" style="padding:30px 14px 40px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;border-collapse:collapse;">
            <tr>
              <td align="center" bgcolor="#fffdfa" style="padding:18px 0 20px;background-color:#fffdfa;background-image:linear-gradient(#fffdfa,#fffdfa);border:1px solid #dcd8cf;border-bottom:0;border-radius:18px 18px 0 0;">
                <a href="${escapeHtml(config.storeUrl)}" style="display:inline-block;text-decoration:none;background-color:#fffdfa;background-image:linear-gradient(#fffdfa,#fffdfa);">
                  <img src="${brandLogoUrl}" width="154" alt="Printmivo" style="display:block;width:154px;max-width:154px;height:auto;border:0;outline:none;text-decoration:none;">
                </a>
              </td>
            </tr>
            <tr>
              <td bgcolor="#fffdfa" style="overflow:hidden;border:1px solid #dcd8cf;border-radius:0 0 18px 18px;background-color:#fffdfa;background-image:linear-gradient(#fffdfa,#fffdfa);">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                  ${showHero ? `<tr>
                    <td bgcolor="#dcefe2" style="padding:0;background-color:#dcefe2;background-image:linear-gradient(#dcefe2,#dcefe2);">
                      <img src="${escapeHtml(product.url)}" width="600" height="300" alt="${escapeHtml(product.alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;">
                    </td>
                  </tr>` : ''}
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
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#edf8ef" style="border-collapse:collapse;background-color:#edf8ef;background-image:linear-gradient(#edf8ef,#edf8ef);border:1px solid #cde5d3;border-radius:12px;">
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
            ${showRecommendations ? `<tr>
              <td style="padding:22px 0 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#fffdfa" style="border-collapse:separate;border-spacing:0;background-color:#fffdfa;background-image:linear-gradient(#fffdfa,#fffdfa);border:1px solid #dcd8cf;border-radius:16px;overflow:hidden;">
                  <tr>
                    <td width="50%" valign="top" style="width:50%;padding:0;">
                      <a href="${refillInkUrl}" style="display:block;text-decoration:none;"><img src="${refillInkImageUrl}" width="300" height="205" alt="Permanent Refill Ink" style="display:block;width:100%;height:auto;border:0;outline:none;text-decoration:none;"></a>
                    </td>
                    <td width="50%" valign="middle" style="width:50%;padding:24px 22px;">
                      <p style="margin:0 0 8px;color:#15714e;font-size:10px;font-weight:bold;letter-spacing:1.25px;line-height:1.3;text-transform:uppercase;">COMPLETE YOUR KIT</p>
                      <h2 style="margin:0 0 8px;color:#17211b;font-family:Georgia,'Times New Roman',serif;font-size:23px;font-weight:normal;letter-spacing:-.5px;line-height:1.15;">Permanent Refill Ink</h2>
                      <p style="margin:0 0 12px;color:#435148;font-size:13px;line-height:1.45;">Keep every print crisp and ready to go.</p>
                      <a href="${refillInkUrl}" style="color:#1a694b;font-size:13px;font-weight:bold;line-height:1.4;text-decoration:underline;">Shop refill ink</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 0 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#fffdfa" style="border-collapse:separate;border-spacing:0;background-color:#fffdfa;background-image:linear-gradient(#fffdfa,#fffdfa);border:1px solid #dcd8cf;border-radius:16px;overflow:hidden;">
                  <tr>
                    <td width="50%" valign="middle" style="width:50%;padding:24px 22px;">
                      <p style="margin:0 0 8px;color:#15714e;font-size:10px;font-weight:bold;letter-spacing:1.25px;line-height:1.3;text-transform:uppercase;">MAKE IT YOURS</p>
                      <h2 style="margin:0 0 8px;color:#17211b;font-family:Georgia,'Times New Roman',serif;font-size:23px;font-weight:normal;letter-spacing:-.5px;line-height:1.15;">Custom Logo Stickers</h2>
                      <p style="margin:0 0 12px;color:#435148;font-size:13px;line-height:1.45;">A finishing touch for every package you send.</p>
                      <a href="${stickerUrl}" style="color:#1a694b;font-size:13px;font-weight:bold;line-height:1.4;text-decoration:underline;">Shop custom stickers</a>
                    </td>
                    <td width="50%" valign="top" style="width:50%;padding:0;">
                      <a href="${stickerUrl}" style="display:block;text-decoration:none;"><img src="${stickerImageUrl}" width="300" height="205" alt="Custom Logo Stickers — 500 pcs" style="display:block;width:100%;height:auto;border:0;outline:none;text-decoration:none;"></a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>` : ''}
            ${showFooter ? `<tr>
              <td style="padding:16px 0 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#173f31" style="border-collapse:collapse;background-color:#173f31;background-image:linear-gradient(#173f31,#173f31);border-radius:16px;">
                  <tr>
                    <td align="center" style="padding:30px 28px 32px;">
                      <p style="margin:0 0 8px;color:#a9d8b9;font-size:10px;font-weight:bold;letter-spacing:1.45px;line-height:1.3;text-transform:uppercase;">PRINTMIVO</p>
                      <h2 style="margin:0 0 20px;color:#ffffff;font-family:Georgia,'Times New Roman',serif;font-size:27px;font-weight:normal;letter-spacing:-.65px;line-height:1.16;">Make every package feel considered.</h2>
                      <a href="${escapeHtml(config.storeUrl)}" style="display:inline-block;padding:13px 21px;border:1px solid #ffffff;border-radius:8px;color:#ffffff;font-size:13px;font-weight:bold;line-height:1;text-align:center;text-decoration:none;">Shop Printmivo</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>` : ''}
            <tr>
              <td align="center" style="padding:26px 20px 0;color:#747a74;font-size:11px;line-height:1.7;">
                <strong style="color:#315f4c;letter-spacing:.6px;text-transform:uppercase;">Stay connected</strong><br>
                <a href="${escapeHtml(config.storeUrl)}" style="color:#315f4c;text-decoration:underline;">Printmivo.com</a> &nbsp;·&nbsp; Reply to this email for help<br>
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
      product: productVisual(job),
      template: setting.template
    })
  };
}

export function renderCampaignPreview(setting) {
  return renderEmail({
    campaign_type: setting.campaignType,
    recipient_name: 'Avery',
    recipient_email: 'preview@printmivo.com',
    payload: {
      recoveryUrl: `${config.storeUrl}/checkout`,
      lineItems: [{ title: 'Permanent Logo Stamp – Printmivo', image: { url: defaultProductHeroUrl } }]
    }
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
