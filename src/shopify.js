import { config } from './config.js';

const endpoint = `https://${config.shopDomain}/admin/api/2026-07/graphql.json`;

let accessToken = null;
let accessTokenExpiresAt = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < accessTokenExpiresAt - 60_000) return accessToken;

  const response = await fetch(`https://${config.shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.shopifyClientId,
      client_secret: config.shopifyClientSecret
    })
  });

  const payload = await response.json();
  if (!response.ok || !payload.access_token || !payload.expires_in) {
    throw new Error(`Shopify token request failed (${response.status})`);
  }

  accessToken = payload.access_token;
  accessTokenExpiresAt = Date.now() + Number(payload.expires_in) * 1000;
  return accessToken;
}

async function graphql(query, variables) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await getAccessToken() },
    body: JSON.stringify({ query, variables })
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.map(error => error.message).join('; ') || `Shopify request failed (${response.status})`);
  }
  return payload.data;
}

const ABANDONED_CHECKOUTS_QUERY = `#graphql
  query DueAbandonedCheckouts($first: Int!, $query: String!) {
    abandonedCheckouts(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        createdAt
        updatedAt
        completedAt
        abandonedCheckoutUrl
        customer { firstName defaultEmailAddress { emailAddress } }
        lineItems(first: 10) { nodes { title quantity image { url } variant { product { handle title } } } }
      }
    }
  }
`;

export async function listOpenAbandonedCheckouts() {
  const data = await graphql(ABANDONED_CHECKOUTS_QUERY, {
    first: 100,
    query: 'status:open recovery_state:not_recovered email_state:not_sent'
  });
  return data.abandonedCheckouts.nodes;
}
