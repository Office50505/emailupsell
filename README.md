# Printmivo Email Upsell

Private, single-store campaign service for consent-safe lifecycle flows:

1. An abandoned-checkout recovery email, queued 90 minutes after a shopper leaves an open checkout with an email address.
2. A no-purchase follow-up, queued only after the recovery email is sent and skipped if the shopper orders.
3. A post-purchase add-on email, queued 7 days after a subscribed customer places an order.

The service starts in `EMAIL_MODE=preview`. Preview mode records a send as `preview_<uuid>` and writes it to logs; it cannot deliver to a customer. Set `EMAIL_MODE=live` and add a verified Resend account/key only after test approval.

## Embedded Email Studio

The app URL is a secure, embedded Shopify Admin dashboard. It includes:

- a visual flow map that shows exactly what happens after a cart is abandoned, a purchase happens, or no purchase happens;
- editable subject lines, preview text, message, CTA and destination for every email step;
- per-flow enable/disable controls, timing, frequency caps, and template modules (product hero, recommendations and brand footer);
- subscriber, suppression, scheduled, delivered, skipped and failed-delivery counts;
- an inbox-style live preview, test-send workflow, and an audit-friendly delivery log with masked recipient addresses.

Campaign settings are stored in PostgreSQL, so scheduler runs use the saved values rather than the fallback environment defaults. The service runs its schema migration on start; `npm run db:migrate` can also be used manually.

## Guardrails

- No email is queued without an email address.
- Only `SUBSCRIBED` contacts can send.
- An unsubscribe link writes a local suppression record immediately.
- A 7-day send cooldown applies across campaigns.
- An abandoned-checkout job is skipped if an order for that email is recorded after the checkout was updated. The follow-up path uses the same purchase check and exits silently after an order.
- Idempotent source IDs prevent duplicate campaign jobs.

## Shopify setup

Create a Dev Dashboard app for this service and grant the minimum required scopes:

- `read_orders` — abandoned checkouts and orders
- `read_customers` — email marketing consent
- `read_products` — product information attached to an abandoned checkout

Set webhook subscriptions to:

- `https://YOUR-EMAIL-SERVICE/webhooks/orders/create`
- `https://YOUR-EMAIL-SERVICE/webhooks/customers/email-marketing-consent/update`

In the Dev Dashboard, copy the app's Client ID and Client secret from **Settings** into `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET`. Set the **App URL** to `https://YOUR-EMAIL-SERVICE` and keep **Embed app in Shopify admin** enabled. The service exchanges those credentials for a fresh 24-hour token automatically, uses the same client secret to verify Shopify webhooks, and validates App Bridge session tokens before serving dashboard data.

The service queries the GraphQL `abandonedCheckouts` connection during its scheduled job. It requires the staff/API permission to manage abandoned checkouts.

## Railway setup

1. Create a separate Railway service and PostgreSQL database.
2. Add variables from `.env.example`; keep `EMAIL_MODE=preview` initially.
3. Set Railway's build command to `npm run build` and start command to `npm start` (the start command applies the safe schema migration automatically).
4. Schedule an authenticated request every 15 minutes:

```sh
curl -X POST https://YOUR-EMAIL-SERVICE/jobs/run \
  -H "Authorization: Bearer $JOB_SECRET"
```

5. Confirm preview events and skipped jobs in Railway logs.
6. Verify the sending domain (SPF, DKIM, DMARC), set `RESEND_API_KEY`, switch to `EMAIL_MODE=live`, then deploy.

## Local development

```sh
cp .env.example .env
npm install
psql "$DATABASE_URL" -f db/schema.sql
npm test
npm start
```
