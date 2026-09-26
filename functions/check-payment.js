const { getSupabase } = require("./lib/supabase");

const PARADISE_BASE = "https://multi.paradisepags.com";
const PARADISE_API_KEY = process.env.PARADISE_API_KEY;
const UTMIFY_TOKEN = "lzASZob4ldSJJc3jT1LILy9alPxWJgpnPhCh";

async function sendUtmifyPaid(txData, transactionId) {
  try {
    const amountCents = Math.round((txData.amount || 65.70) * 100);
    const gatewayFeeCents = Math.round(amountCents * 0.02);
    const payload = {
      orderId: transactionId,
      platform: "Paradise",
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
      products: [{
        id: "loja-shopify-br-001",
        name: "SHOPIFY LOJA 03",
        quantity: 1,
        priceInCents: amountCents,
      }],
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
    };

    await fetch("https://api.utmify.com.br/api-credentials/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-token": UTMIFY_TOKEN },
      body: JSON.stringify(payload),
    });
    console.log("[UTMify] ✓ Pago enviado:", transactionId);
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

  if (!PARADISE_API_KEY) {
    console.error("[CheckPayment] PARADISE_API_KEY não configurada");
    return jsonResponse(500, {
      success: false,
      error: "Credenciais não configuradas",
      debug: "PARADISE_API_KEY ausente",
    });
  }

  // Consultar na Paradise via query.php?action=get_transaction&id={id}
  let statusResp, text = "";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const url = `${PARADISE_BASE}/api/v1/query.php?action=get_transaction&id=${encodeURIComponent(transactionId)}`;
    statusResp = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": PARADISE_API_KEY,
      },
      signal: controller.signal,
    });
    text = await statusResp.text();
    clearTimeout(timeout);
  } catch (err) {
    return jsonResponse(502, {
      success: false,
      error: "Falha ao consultar status: " + String(err),
    });
  }

  let parsed = {};
  try { parsed = JSON.parse(text); } catch { parsed = {}; }

  // Se a resposta for array (list_transactions), pegar o primeiro
  const data = Array.isArray(parsed) ? parsed[0] || {} : parsed;
  const rawStatus = (data.status || "pending").toLowerCase();

  // Mapear statuses da Paradise
  let status;
  let paid = false;
  if (rawStatus === "approved") {
    status = "paid";
    paid = true;
  } else if (rawStatus === "failed" || rawStatus === "chargeback") {
    status = "rejected";
  } else if (rawStatus === "refunded") {
    status = "refunded";
  } else {
    status = "pending";
  }

  // Atualizar Supabase
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
        paid_at: new Date().toISOString(),
      }).eq("transaction_id", transactionId);
      if (!alreadyPaid && txData) await sendUtmifyPaid(txData, transactionId);
    } else {
      await supabase.from("transactions").update({ status }).eq("transaction_id", transactionId);
    }
  } catch (err) {
    console.error("[Supabase] Erro ao atualizar status (continuando):", err.message);
  }

  return jsonResponse(200, {
    success: true,
    transactionId,
    status,
    paid,
  });
};