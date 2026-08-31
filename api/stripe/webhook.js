import Stripe from "stripe";
import { neon } from "@neondatabase/serverless";

/**
 * Stripe webhook: verifies the signature and records money movements in the
 * payments table, so the CRM ledger fills itself.
 *
 * Ships inert: with STRIPE_WEBHOOK_SECRET or DATABASE_URL unset it answers
 * 503 and touches nothing. Sandbox and live events both land here; livemode
 * is recorded per row.
 */

export const config = { api: { bodyParser: false } };

function rawBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (c) => chunks.push(c));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }
  const whsec = process.env.STRIPE_WEBHOOK_SECRET;
  const dburl = process.env.DATABASE_URL;
  if (!whsec || !dburl) {
    console.warn("[stripe] webhook not configured");
    return response.status(503).json({ error: "Webhook not configured" });
  }

  let event;
  try {
    const body = await rawBody(request);
    const sig = request.headers["stripe-signature"];
    // Verification only needs the endpoint secret, not an API key.
    event = Stripe.webhooks.constructEvent(body, sig, whsec);
  } catch (err) {
    return response.status(400).json({ error: "Signature verification failed" });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object;
      const md = s.metadata || {};
      const sql = neon(dburl);
      // The slug in public.events is "pistonpoweredranch", no hyphens. This
      // used to default to the hyphenated spelling, which matches no row, and
      // an INSERT ... SELECT with no matching row inserts nothing and reports
      // success. Every payment would have looked booked and been absent.
      const slug = md.event_slug || "pistonpoweredranch";
      const wrote = await sql`
        insert into payments (event_id, kind, stripe_object, amount_cents, currency, status, payer_email, livemode)
        select e.id, ${md.kind || "other"}, ${s.id}, ${s.amount_total}, ${s.currency || "usd"},
               ${s.payment_status || "paid"}, ${(s.customer_details && s.customer_details.email) || null},
               ${Boolean(event.livemode)}
        from events e where e.slug = ${slug}
        on conflict (stripe_object) do update set status = excluded.status
        returning id`;
      // Fail loudly. Stripe retries a 500, so a payment that did not book stays
      // visible as a failing delivery instead of disappearing quietly.
      if (!wrote || wrote.length === 0) {
        console.error("[stripe] no events row for slug:", slug, "payment not booked:", s.id);
        return response.status(500).json({ error: "No matching event", slug });
      }
    }
    return response.status(200).json({ received: true });
  } catch (err) {
    console.error("[stripe] ledger write failed:", err.message);
    return response.status(500).json({ error: "Ledger write failed" });
  }
}
