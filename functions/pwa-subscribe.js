const { getSupabase } = require("./lib/supabase");

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "POST,OPTIONS" }, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch { return jsonResponse(400, { error: "Invalid JSON" }); }

  const subscription = body.subscription;
  if (!subscription || !subscription.endpoint) {
    return jsonResponse(400, { error: "Missing subscription" });
  }

  try {
    const supabase = getSupabase();
    const subId = Buffer.from(subscription.endpoint).toString("base64").slice(0, 64);

    await supabase.from("pwa_subscriptions").upsert({
      id: subId,
      endpoint: subscription.endpoint,
      keys_p256dh: subscription.keys?.p256dh || "",
      keys_auth: subscription.keys?.auth || "",
      created_at: new Date().toISOString(),
    }, { onConflict: "id" });

    console.log("[PWA] Subscription saved:", subId);
    return jsonResponse(200, { success: true, id: subId });
  } catch (err) {
    console.error("[PWA] Subscribe error:", err.message);
    return jsonResponse(500, { error: "Failed to save subscription" });
  }
};