/**
 * Billing guard: the budget for this project publishes its spend to Pub/Sub several times a day, and this
 * function disconnects the project from its billing account as soon as the spend (after free-tier usage and
 * credits) is above zero. The site then keeps only what works without billing (sign-in and Firestore's free
 * quota); the game server stops. Reconnect billing in the console to bring it back.
 */
import { cloudEvent } from '@google-cloud/functions-framework';

const PROJECT_ID = process.env.PROJECT_ID;
const LIMIT = Number(process.env.COST_LIMIT ?? 0);

async function token() {
  const res = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } },
  );
  return (await res.json()).access_token;
}

cloudEvent('stopBilling', async (event) => {
  const msg = JSON.parse(Buffer.from(event.data.message.data, 'base64').toString());
  console.log(
    `Budget "${msg.budgetDisplayName}": cost ${msg.costAmount} ${msg.currencyCode} (limit ${LIMIT})`,
  );
  if (!(msg.costAmount > LIMIT)) return;
  const url = `https://cloudbilling.googleapis.com/v1/projects/${PROJECT_ID}/billingInfo`;
  const headers = { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' };
  const info = await (await fetch(url, { headers })).json();
  if (!info.billingEnabled) return console.log('Billing is already disconnected');
  const res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ billingAccountName: '' }) });
  console.log(`Disconnected billing from ${PROJECT_ID}: HTTP ${res.status} ${await res.text()}`);
});
