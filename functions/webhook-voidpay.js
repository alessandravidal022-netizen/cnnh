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

async function sendUtmify(transactionId, status, customer, amountCents, createdAt, utms) {
  try {
    const gatewayFeeCents = Math.round(amountCents * 0.02);
    const netCents = amountCents - gatewayFeeCents;
    const payload = {
      orderId: transactionId,
      platform: "VoidPay",
      paymentMethod: "pix",
      status,
      createdAt: createdAt || new Date().toISOString().replace("T", " ").slice(0, 19),
      approvedDate: status === "paid" ? new Date().toISOString().replace("T", " ").slice(0, 19) : null,
      customer: {
        name: customer?.name || null,
        email: customer?.email || null,
        phone: customer?.phone || null,
        document: customer?.document || null,
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
        utm_source: utms?.utm_source || null,
        utm_campaign: utms?.utm_campaign || null,
        utm_medium: utms?.utm_medium || null,
        utm_content: utms?.utm_content || null,
        utm_term: utms?.utm_term || null,
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
    console.log("[UTMify] ✓ Webhook enviado:", transactionId, status);
  } catch (err) {
    console.error("[UTMify] Erro (não bloqueia):", err.message);
  }
}

exports.handler = async (event) => {
  console.log("[WEBHOOK-VOIDPAY] ===== WEBHOOK RECEBIDO =====");

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

  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch { body = {}; }

  const eventType = body.event;
  const transaction = body.transaction || {};
  const client = body.client || {};
  const trackProps = body.trackProps || {};
  const transactionId = transaction.id;
  const status = transaction.status;

  console.log("[WEBHOOK-VOIDPAY] Event:", eventType, "| TX:", transactionId, "| Status:", status);

  if (!transactionId) {
    console.error("[WEBHOOK-VOIDPAY] ❌ Sem transaction ID");
    return jsonResponse(400, { error: "Missing transaction ID" });
  }

  // Mapear status VoidPay → status interno
  let internalStatus = "pending";
  if (eventType === "TRANSACTION_PAID" || status === "COMPLETED") {
    internalStatus = "paid";
  } else if (eventType === "TRANSACTION_CANCELED" || status === "FAILED") {
    internalStatus = "failed";
  } else if (eventType === "TRANSACTION_REFUNDED") {
    internalStatus = "refunded";
  } else if (eventType === "TRANSACTION_CHARGED_BACK") {
    internalStatus = "charged_back";
  }

  // Atualizar Supabase
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const supabase = getSupabase();
      const updateData = { status: internalStatus };
      if (internalStatus === "paid" && transaction.payedAt) {
        updateData.paid_at = transaction.payedAt;
      }
      await supabase
        .from("transactions")
        .update(updateData)
        .eq("transaction_id", transactionId);
      console.log("[Supabase] ✓ Atualizado:", transactionId, "→", internalStatus);
    } catch (err) {
      console.error("[Supabase] Erro:", err.message);
    }
  }

  // Notificar UTMify
  const amountCents = Math.round((transaction.amount || 0) * 100);
  if (amountCents > 0) {
    await sendUtmify(
      transactionId,
      internalStatus === "paid" ? "paid" : "waiting_payment",
      {
        name: client.name,
        email: client.email,
        phone: client.phone,
        document: client.cpf || client.document,
      },
      amountCents,
      transaction.createdAt,
      trackProps
    ).catch(err => console.error("[UTMify] Erro:", err.message));
  }

  console.log("[WEBHOOK-VOIDPAY] ✓ Processado com sucesso");
  return jsonResponse(200, { received: true, transactionId, status: internalStatus });
};