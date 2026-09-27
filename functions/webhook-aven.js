const { getSupabase } = require("./lib/supabase");

const UTMIFY_TOKEN = "lzASZob4ldSJJc3jT1LILy9alPxWJgpnPhCh";

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

async function sendUtmifyPaid(transactionId, amountCents, customer, createdAt, utms) {
  try {
    const gatewayFeeCents = Math.round(amountCents * 0.02);
    const netCents = amountCents - gatewayFeeCents;
    const payload = {
      orderId: transactionId,
      platform: "AvenPayments",
      paymentMethod: "pix",
      status: "paid",
      createdAt: createdAt || new Date().toISOString().replace("T", " ").slice(0, 19),
      approvedDate: new Date().toISOString().replace("T", " ").slice(0, 19),
      customer: {
        name: customer?.name || null,
        email: customer?.email || null,
        phone: customer?.phone || null,
        document: customer?.taxId || null,
        country: "BR",
        ip: "177.0.0.1",
      },
      products: [{
        id: "loja-shopify-br-001",
        name: "SHOPIFY LOJA 03",
        quantity: 1,
        priceInCents: amountCents,
      }],
      trackingParameters: {
        utm_source: utms?.utmSource || utms?.utm_source || null,
        utm_campaign: utms?.utmCampaign || utms?.utm_campaign || null,
        utm_medium: utms?.utmMedium || utms?.utm_medium || null,
        utm_content: utms?.utmContent || utms?.utm_content || null,
        utm_term: utms?.utmTerm || utms?.utm_term || null,
      },
      commission: {
        totalPriceInCents: amountCents,
        gatewayFeeInCents: gatewayFeeCents,
        userCommissionInCents: netCents,
        currency: "BRL",
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    await fetch("https://api.utmify.com.br/api-credentials/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-token": UTMIFY_TOKEN },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    console.log("[UTMify] ✓ Pago via webhook Aven:", transactionId);
  } catch (err) {
    console.error("[UTMify] Erro webhook (não bloqueia):", err.message);
  }
}

exports.handler = async (event) => {
  console.log("[WEBHOOK-AVEN] ===== WEBHOOK RECEBIDO =====");

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch (err) {
    console.error("[WEBHOOK-AVEN] JSON inválido:", err.message);
    return jsonResponse(400, { error: "JSON inválido" });
  }

  console.log("[WEBHOOK-AVEN] Payload:", JSON.stringify(body).substring(0, 500));

  // Aven envia o objeto payment direto no body do webhook
  const transactionId = String(body.id || "");
  const rawStatus = (body.status || "").toUpperCase();
  const amountCents = body.amount || 0;
  const payer = body.payer || {};
  const utms = body.utms || {};
  const paidAt = body.paidAt || null;
  const createdAt = body.createdAt || null;

  if (!transactionId) {
    console.error("[WEBHOOK-AVEN] Sem id no payload");
    return jsonResponse(200, { received: true, warning: "no transaction id" });
  }

  // Mapear status da Aven para status interno
  let internalStatus;
  let isPaid = false;

  switch (rawStatus) {
    case "PAID":
      internalStatus = "paid";
      isPaid = true;
      break;
    case "REFUSED":
      internalStatus = "rejected";
      break;
    case "REFUNDED":
      internalStatus = "refunded";
      break;
    case "CHARGEDBACK":
      internalStatus = "charged_back";
      break;
    case "MED":
      internalStatus = "dispute";
      break;
    case "PROCESSING":
      internalStatus = "processing";
      break;
    case "PENDING":
      internalStatus = "pending";
      break;
    default:
      internalStatus = rawStatus.toLowerCase() || "unknown";
  }

  console.log("[WEBHOOK-AVEN] TX:", transactionId, "| Status Aven:", rawStatus, "-> Interno:", internalStatus);

  // Atualizar Supabase
  try {
    const supabase = getSupabase();

    if (isPaid) {
      const { data: existing } = await supabase
        .from("transactions")
        .select("status")
        .eq("transaction_id", transactionId)
        .single();

      const alreadyPaid = existing?.status === "paid";

      await supabase
        .from("transactions")
        .update({
          status: "paid",
          paid_at: paidAt || new Date().toISOString(),
        })
        .eq("transaction_id", transactionId);

      console.log("[WEBHOOK-AVEN] ✓ Supabase atualizado:", transactionId, "-> paid");

      if (!alreadyPaid) {
        await sendUtmifyPaid(
          transactionId,
          amountCents,
          { name: payer.name, email: payer.email, phone: payer.phone, taxId: payer.taxId },
          createdAt,
          utms
        );
      }
    } else {
      await supabase
        .from("transactions")
        .update({ status: internalStatus })
        .eq("transaction_id", transactionId);

      console.log("[WEBHOOK-AVEN] ✓ Supabase atualizado:", transactionId, "->", internalStatus);
    }
  } catch (err) {
    console.error("[WEBHOOK-AVEN] Erro Supabase:", err.message);
  }

  return jsonResponse(200, { received: true, transaction_id: transactionId, status: internalStatus });
};