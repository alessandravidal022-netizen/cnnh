const { getSupabase } = require("./lib/supabase");

const UTMIFY_TOKEN = "lzASZob4ldSJJc3jT1LILy9alPxWJgpnPhCh";

async function sendUtmifyPaid(webhookData, transactionId) {
  try {
    const amountCents = webhookData.amount || 0;
    const gatewayFeeCents = Math.round(amountCents * 0.02);
    const customer = webhookData.customer || {};

    const payload = {
      orderId: transactionId,
      platform: "Paradise",
      paymentMethod: webhookData.payment_method || "pix",
      status: "paid",
      createdAt: webhookData.timestamp || new Date().toISOString().replace("T", " ").slice(0, 19),
      approvedDate: new Date().toISOString().replace("T", " ").slice(0, 19),
      customer: {
        name: customer.name || null,
        email: customer.email || null,
        phone: customer.phone || null,
        document: customer.document || null,
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
        utm_source: webhookData.tracking?.utm_source || null,
        utm_campaign: webhookData.tracking?.utm_campaign || null,
        utm_medium: webhookData.tracking?.utm_medium || null,
        utm_content: webhookData.tracking?.utm_content || null,
        utm_term: webhookData.tracking?.utm_term || null,
      },
      commission: {
        totalPriceInCents: amountCents,
        gatewayFeeInCents: gatewayFeeCents,
        userCommissionInCents: amountCents - gatewayFeeCents,
        currency: "BRL",
      },
    };

    await fetch("https://api.utmify.com.br/api-credentials/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-token": UTMIFY_TOKEN },
      body: JSON.stringify(payload),
    });
    console.log("[UTMify] ✓ Pago via webhook:", transactionId);
  } catch (err) {
    console.error("[UTMify] Erro webhook (não bloqueia):", err.message);
  }
}

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

exports.handler = async (event) => {
  console.log("[WEBHOOK-PARADISE] ===== WEBHOOK RECEBIDO =====");

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
    console.error("[WEBHOOK-PARADISE] JSON inválido:", err.message);
    return jsonResponse(400, { error: "JSON inválido" });
  }

  console.log("[WEBHOOK-PARADISE] Payload:", JSON.stringify(body).substring(0, 500));

  const transactionId = String(body.transaction_id || body.external_id || "");
  const rawStatus = (body.status || "").toLowerCase();
  const amount = body.amount || 0;

  if (!transactionId) {
    console.error("[WEBHOOK-PARADISE] Sem transaction_id no payload");
    // Retornar 200 para não ficar reenviando
    return jsonResponse(200, { received: true, warning: "no transaction_id" });
  }

  // Mapear status da Paradise para status interno
  let internalStatus;
  let isPaid = false;

  switch (rawStatus) {
    case "approved":
      internalStatus = "paid";
      isPaid = true;
      break;
    case "failed":
    case "chargeback":
      internalStatus = "rejected";
      break;
    case "refunded":
      internalStatus = "refunded";
      break;
    case "processing":
    case "under_review":
      internalStatus = "processing";
      break;
    case "pending":
      internalStatus = "pending";
      break;
    default:
      internalStatus = rawStatus || "unknown";
  }

  console.log("[WEBHOOK-PARADISE] TX:", transactionId, "| Status Paradise:", rawStatus, "-> Interno:", internalStatus);

  // Atualizar Supabase
  try {
    const supabase = getSupabase();

    if (isPaid) {
      // Verificar se já estava pago para evitar duplicata no UTMify
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
          paid_at: new Date().toISOString(),
        })
        .eq("transaction_id", transactionId);

      console.log("[WEBHOOK-PARADISE] ✓ Supabase atualizado:", transactionId, "-> paid");

      if (!alreadyPaid) {
        await sendUtmifyPaid(body, transactionId);
      }
    } else {
      await supabase
        .from("transactions")
        .update({ status: internalStatus })
        .eq("transaction_id", transactionId);

      console.log("[WEBHOOK-PARADISE] ✓ Supabase atualizado:", transactionId, "->", internalStatus);
    }
  } catch (err) {
    console.error("[WEBHOOK-PARADISE] Erro Supabase:", err.message);
  }

  // SEMPRE retornar 200 para a Paradise parar de reenviar
  return jsonResponse(200, { received: true, transaction_id: transactionId, status: internalStatus });
};