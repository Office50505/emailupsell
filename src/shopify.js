import { config } from './config.js';

const endpoint = `https://${config.shopDomain}/admin/api/2026-07/graphql.json`;

async function graphql(query, variables) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': config.adminAccessToken },
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
        lineItems(first: 10) { nodes { title quantity variant { product { handle title } } } }
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
