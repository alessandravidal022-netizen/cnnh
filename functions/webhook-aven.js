const https = require("https");
const { getSupabase } = require("./lib/supabase");
const UTMIFY_TOKEN = "lzASZob4ldSJJc3jT1LILy9alPxWJgpnPhCh";

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
      products: [{ id: "loja-shopify-br-001", name: "SHOPIFY LOJA 03", quantity: 1, priceInCents: amountCents }],
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
    });
    await httpsRequest("api.utmify.com.br", "/api-credentials/orders", "POST", {
      "Content-Type": "application/json",
      "x-api-token": UTMIFY_TOKEN,
      "Content-Length": Buffer.byteLength(payload),
    }, payload, 3000);
    console.log("[UTMify] OK Pago via webhook Aven:", transactionId);
  } catch (err) {
    console.error("[UTMify] Erro webhook (nao bloqueia):", err.message);
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
  console.log("[WEBHOOK-AVEN] ===== WEBHOOK RECEBIDO =====");

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
    console.error("[WEBHOOK-AVEN] JSON invalido:", err.message);
    return jsonResponse(400, { error: "JSON invalido" });
  }

  console.log("[WEBHOOK-AVEN] Payload:", JSON.stringify(body).substring(0, 500));

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

  let internalStatus;
  let isPaid = false;

  switch (rawStatus) {
    case "PAID": internalStatus = "paid"; isPaid = true; break;
    case "REFUSED": internalStatus = "rejected"; break;
    case "REFUNDED": internalStatus = "refunded"; break;
    case "CHARGEDBACK": internalStatus = "charged_back"; break;
    case "MED": internalStatus = "dispute"; break;
    case "PROCESSING": internalStatus = "processing"; break;
    case "PENDING": internalStatus = "pending"; break;
    default: internalStatus = rawStatus.toLowerCase() || "unknown";
  }

  console.log("[WEBHOOK-AVEN] TX:", transactionId, "| Status Aven:", rawStatus, "-> Interno:", internalStatus);

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

      console.log("[WEBHOOK-AVEN] Supabase atualizado:", transactionId, "-> paid");

      if (!alreadyPaid) {
        await sendUtmifyPaid(
          transactionId,
          amountCents,
          { name: payer.name, email: payer.email, phone: payer.phone, taxId: payer.taxId },
          createdAt,
          utms
        );
        const amountReais = (amountCents / 100).toFixed(2).replace(".", ",");
        await sendPushNotification(
          "✅ PIX Pago!",
          `R$ ${amountReais} confirmado!\n${payer.name || "Cliente"}\nID: ${transactionId}`,
          `pix-pago-${transactionId}`,
          "paid",
          transactionId,
          amountCents / 100,
          payer.name
        );
      }
    } else {
      await supabase
        .from("transactions")
        .update({ status: internalStatus })
        .eq("transaction_id", transactionId);

      console.log("[WEBHOOK-AVEN] Supabase atualizado:", transactionId, "->", internalStatus);
    }
  } catch (err) {
    console.error("[WEBHOOK-AVEN] Erro Supabase:", err.message);
  }

  return jsonResponse(200, { received: true, transaction_id: transactionId, status: internalStatus });
};