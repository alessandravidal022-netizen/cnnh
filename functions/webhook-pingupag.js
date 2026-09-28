const https = require("https");
const { getSupabase } = require("./lib/supabase");
const UTMIFY_TOKEN = "lzASZob4ldSJJc3jT1LILy9alPxWJgpnPhCh";

function httpsRequest(hostname, path, method, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const options = { hostname, path, method, headers, timeout: timeoutMs || 3000 };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")); });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function sendUtmifyPaid(transactionId, amountCents, customer, createdAt, utms) {
  try {
    const gatewayFeeCents = Math.round(amountCents * 0.02);
    const netCents = amountCents - gatewayFeeCents;
    const payload = JSON.stringify({
      orderId: transactionId,
      platform: "Pingupag",
      paymentMethod: "pix",
      status: "paid",
      createdAt: createdAt || new Date().toISOString().replace("T", " ").slice(0, 19),
      approvedDate: new Date().toISOString().replace("T", " ").slice(0, 19),
      customer: {
        name: customer?.name || null,
        email: customer?.email || null,
        phone: customer?.phone || null,
        document: customer?.document || null,
        country: "BR",
        ip: "177.0.0.1",
      },
      products: [{ id: "loja-shopify-br-001", name: "SHOPIFY LOJA 03", quantity: 1, priceInCents: amountCents }],
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
    });
    await httpsRequest("api.utmify.com.br", "/api-credentials/orders", "POST", {
      "Content-Type": "application/json",
      "x-api-token": UTMIFY_TOKEN,
      "Content-Length": Buffer.byteLength(payload),
    }, payload, 3000);
    console.log("[UTMify] OK Pago via webhook Pingupag:", transactionId);
  } catch (err) {
    console.error("[UTMify] Erro webhook (nao bloqueia):", err.message);
  }
}

async function sendPushNotification(title, message, tag, type, transactionId, amount, customerName) {
  try {
    const payload = JSON.stringify({ title, message, tag, type, transactionId, amount, customerName });
    await httpsRequest("cnhbrasil-gov.netlify.app", "/api/pwa-send-push", "POST", {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    }, payload, 5000);
    console.log("[PWA-PUSH] Notificação enviada:", tag);
  } catch (err) {
    console.error("[PWA-PUSH] Erro ao enviar push (não bloqueia):", err.message);
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
  console.log("[WEBHOOK-PINGUPAG] ===== WEBHOOK RECEBIDO =====");
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" }, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch (err) {
    console.error("[WEBHOOK-PINGUPAG] JSON invalido:", err.message);
    return jsonResponse(400, { error: "JSON invalido" });
  }

  console.log("[WEBHOOK-PINGUPAG] Payload:", JSON.stringify(body).substring(0, 500));

  const transactionId = String(body.transaction_id || body.external_id || "");
  const rawStatus = (body.status || "").toLowerCase();
  const amountCents = body.amount || 0;
  const customer = body.customer || {};
  const utms = body.tracking || {};
  const timestamp = body.timestamp || null;

  if (!transactionId) {
    console.error("[WEBHOOK-PINGUPAG] Sem transaction_id no payload");
    return jsonResponse(200, { received: true, warning: "no transaction id" });
  }

  let internalStatus;
  let isPaid = false;
  switch (rawStatus) {
    case "approved": internalStatus = "paid"; isPaid = true; break;
    case "failed": internalStatus = "rejected"; break;
    case "refunded": internalStatus = "refunded"; break;
    case "chargeback": internalStatus = "charged_back"; break;
    case "under_review": internalStatus = "dispute"; break;
    case "processing": internalStatus = "processing"; break;
    case "pending": internalStatus = "pending"; break;
    default: internalStatus = rawStatus || "unknown";
  }

  console.log("[WEBHOOK-PINGUPAG] TX:", transactionId, "| Status Pingupag:", rawStatus, "-> Interno:", internalStatus);

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
          paid_at: timestamp || new Date().toISOString(),
        })
        .eq("transaction_id", transactionId);

      console.log("[WEBHOOK-PINGUPAG] Supabase atualizado:", transactionId, "-> paid");

      if (!alreadyPaid) {
        await sendUtmifyPaid(
          transactionId,
          amountCents,
          { name: customer.name, email: customer.email, phone: customer.phone, document: customer.document },
          timestamp,
          utms
        );

        const amountReais = (amountCents / 100).toFixed(2).replace(".", ",");
        await sendPushNotification(
          "✅ PIX Pago!",
          `R$ ${amountReais} confirmado!\n${customer.name || "Cliente"}\nID: ${transactionId}`,
          `pix-pago-${transactionId}`,
          "paid",
          transactionId,
          amountCents / 100,
          customer.name
        );
      }
    } else {
      await supabase
        .from("transactions")
        .update({ status: internalStatus })
        .eq("transaction_id", transactionId);
      console.log("[WEBHOOK-PINGUPAG] Supabase atualizado:", transactionId, "->", internalStatus);
    }
  } catch (err) {
    console.error("[WEBHOOK-PINGUPAG] Erro Supabase:", err.message);
  }

  return jsonResponse(200, { received: true, transaction_id: transactionId, status: internalStatus });
};