const https = require("https");
const { getSupabase } = require("./lib/supabase");
const AVEN_BASE = "api.avenpayments.com";
const AVEN_API_KEY = process.env.AVEN_API_KEY;
const UTMIFY_TOKEN = "lzASZob4ldSJJc3jT1LILy9alPxWJgpnPhCh";

function httpsRequest(hostname, path, method, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const options = { hostname, path, method, headers, timeout: timeoutMs || 10000 };
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

async function sendUtmifyPaid(txData, transactionId) {
  try {
    const amountCents = Math.round((txData.amount || 20) * 100);
    const gatewayFeeCents = Math.round(amountCents * 0.02);
    const payload = JSON.stringify({
      orderId: transactionId,
      platform: "AvenPayments",
      paymentMethod: "pix",
      status: "paid",
      createdAt: txData.created_at || new Date().toISOString().replace("T", " ").slice(0, 19),
      approvedDate: new Date().toISOString().replace("T", " ").slice(0, 19),
      customer: {
        name: txData.customer_name || null,
        email: txData.customer_email || null,
        phone: txData.customer_phone || null,
        document: txData.customer_cpf || null,
        country: "BR",
        ip: "177.0.0.1",
      },
      products: [{ id: "loja-shopify-br-001", name: "SHOPIFY LOJA 03", quantity: 1, priceInCents: amountCents }],
      trackingParameters: {
        utm_source: txData.utm_source || null,
        utm_campaign: txData.utm_campaign || null,
        utm_medium: txData.utm_medium || null,
      },
      commission: {
        totalPriceInCents: amountCents,
        gatewayFeeInCents: gatewayFeeCents,
        userCommissionInCents: amountCents - gatewayFeeCents,
        currency: "BRL",
      },
    });
    await httpsRequest("api.utmify.com.br", "/api-credentials/orders", "POST", {
      "Content-Type": "application/json",
      "x-api-token": UTMIFY_TOKEN,
      "Content-Length": Buffer.byteLength(payload),
    }, payload, 3000);
    console.log("[UTMify] OK Pago enviado:", transactionId);
  } catch (err) {
    console.error("[UTMify] Erro (nao bloqueia):", err.message);
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
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" }, body: "" };
  }

  let transactionId = event.queryStringParameters?.id || event.queryStringParameters?.transactionId;
  if (event.httpMethod === "POST") {
    try {
      const b = event.body ? JSON.parse(event.body) : {};
      transactionId = b?.transactionId || b?.id || transactionId;
    } catch {}
  }

  if (!transactionId) {
    return jsonResponse(400, { success: false, error: "Informe o transactionId" });
  }

  if (!AVEN_API_KEY) {
    console.error("[CheckPayment] AVEN_API_KEY nao configurada");
    return jsonResponse(500, { success: false, error: "Credenciais nao configuradas", debug: "AVEN_API_KEY ausente" });
  }

  let resp;
  try {
    resp = await httpsRequest(AVEN_BASE, `/v1/payment/${encodeURIComponent(transactionId)}`, "GET", {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${AVEN_API_KEY}`,
    }, null, 10000);
  } catch (err) {
    return jsonResponse(502, { success: false, error: "Falha ao consultar status: " + String(err) });
  }

  let parsed = {};
  try { parsed = JSON.parse(resp.body); } catch { parsed = {}; }

  const rawStatus = (parsed.status || "PENDING").toUpperCase();
  let status;
  let paid = false;

  if (rawStatus === "PAID") { status = "paid"; paid = true; }
  else if (rawStatus === "REFUSED") { status = "rejected"; }
  else if (rawStatus === "REFUNDED") { status = "refunded"; }
  else if (rawStatus === "CHARGEDBACK") { status = "charged_back"; }
  else if (rawStatus === "PROCESSING") { status = "processing"; }
  else { status = "pending"; }

  try {
    const supabase = getSupabase();
    if (paid) {
      const { data: txData } = await supabase
        .from("transactions")
        .select("status,customer_name,customer_email,customer_phone,customer_cpf,amount,created_at,utm_source,utm_campaign,utm_medium")
        .eq("transaction_id", transactionId)
        .single();
      const alreadyPaid = txData?.status === "paid";
      await supabase.from("transactions").update({
        status: "paid",
        paid_at: parsed.paidAt || new Date().toISOString(),
      }).eq("transaction_id", transactionId);
      if (!alreadyPaid && txData) await sendUtmifyPaid(txData, transactionId);
    } else {
      await supabase.from("transactions").update({ status }).eq("transaction_id", transactionId);
    }
  } catch (err) {
    console.error("[Supabase] Erro ao atualizar status (continuando):", err.message);
  }

  return jsonResponse(200, { success: true, transactionId, status, paid });
};