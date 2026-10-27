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

function layout({ preheader, heading, copy, ctaLabel, ctaUrl, email }) {
  const safeCtaUrl = escapeHtml(ctaUrl);
  const safeUnsubscribeUrl = escapeHtml(unsubscribeUrl(email));

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
  <body style="margin:0;padding:0;background-color:#f5f3ef;color:#1c211e;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
    <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:0;padding:0;background-color:#f5f3ef;border-collapse:collapse;">
      <tr>
        <td align="center" style="padding:28px 14px 36px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;border-collapse:collapse;">
            <tr>
              <td style="padding:0 10px 14px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="color:#134f3d;font-family:Georgia,'Times New Roman',serif;font-size:25px;font-weight:bold;letter-spacing:-1px;line-height:1;">printmivo</td>
                    <td align="right" style="color:#6e756f;font-size:10px;font-weight:bold;letter-spacing:1.4px;line-height:1;text-transform:uppercase;">Made for your mark</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="overflow:hidden;border:1px solid #deded7;border-radius:18px;background-color:#fffdfa;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="padding:34px 34px 27px;background-color:#eaf6ee;border-bottom:1px solid #d3ead9;">
                      <p style="margin:0 0 13px;color:#247451;font-size:11px;font-weight:bold;letter-spacing:1.5px;line-height:1.2;text-transform:uppercase;">A note from Printmivo</p>
                      <h1 style="margin:0;color:#17211b;font-family:Georgia,'Times New Roman',serif;font-size:35px;font-weight:normal;letter-spacing:-1.3px;line-height:1.08;">${escapeHtml(heading)}</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:30px 34px 10px;">
                      <p style="margin:0;color:#3f4942;font-size:16px;line-height:1.65;">${emailCopy(copy)}</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:18px 34px 31px;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;">
                        <tr>
                          <td align="center" bgcolor="#ee2937" style="border-radius:10px;">
                            <a href="${safeCtaUrl}" style="display:inline-block;padding:15px 24px;border:1px solid #ee2937;border-radius:10px;color:#ffffff;font-size:15px;font-weight:bold;line-height:1;text-align:center;text-decoration:none;">${escapeHtml(ctaLabel)}</a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 34px 30px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;border-top:1px solid #e6e3dc;">
                        <tr>
                          <td style="padding-top:20px;color:#59665e;font-size:12px;line-height:1.55;">Thoughtful details. Professional results. Built to make every impression count.</td>
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
