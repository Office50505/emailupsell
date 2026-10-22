# Printmivo Email Upsell

Private, single-store campaign service for two consent-safe flows:

1. An abandoned-checkout recovery email, queued 90 minutes after a shopper leaves an open checkout with an email address.
2. A post-purchase add-on email, queued 7 days after a subscribed customer places an order.

The service starts in `EMAIL_MODE=preview`. Preview mode records a send as `preview_<uuid>` and writes it to logs; it cannot deliver to a customer. Set `EMAIL_MODE=live` and add a verified Resend account/key only after test approval.

## Guardrails

- No email is queued without an email address.
- Only `SUBSCRIBED` contacts can send.
- An unsubscribe link writes a local suppression record immediately.
- A 7-day send cooldown applies across campaigns.
- An abandoned-checkout job is skipped if an order for that email is recorded after the job became due.
- Idempotent source IDs prevent duplicate campaign jobs.

## Shopify setup

Create a Dev Dashboard app for this service and grant the minimum required scopes:

- `read_orders` — abandoned checkouts and orders
- `read_customers` — email marketing consent
- `read_products` — product information attached to an abandoned checkout

Set webhook subscriptions to:

- `https://YOUR-EMAIL-SERVICE/webhooks/orders/create`
- `https://YOUR-EMAIL-SERVICE/webhooks/customers/email-marketing-consent/update`

In the Dev Dashboard, copy the app's Client ID and Client secret from **Settings** into `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET`. The service exchanges those credentials for a fresh 24-hour token automatically, and uses the same client secret to verify Shopify webhooks.

The service queries the GraphQL `abandonedCheckouts` connection during its scheduled job. It requires the staff/API permission to manage abandoned checkouts.

## Railway setup

1. Create a separate Railway service and PostgreSQL database.
2. Run `psql "$DATABASE_URL" -f db/schema.sql` once.
3. Add variables from `.env.example`; keep `EMAIL_MODE=preview` initially.
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
