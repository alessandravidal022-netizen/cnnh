const webpush = require("web-push");
const { getSupabase } = require("./lib/supabase");

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails({
    subject: "mailto:admin@cnhbrasil-gov.netlify.app",
    publicKey: VAPID_PUBLIC_KEY,
    privateKey: VAPID_PRIVATE_KEY,
  });
}

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
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
      },
      body: "",
    };
  }
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.error("[PWA-PUSH] VAPID keys not configured");
    return jsonResponse(500, { error: "VAPID keys missing" });
  }

  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, { error: "Invalid JSON" });
  }

  const { title, message, tag, type, transactionId, amount, customerName } = body;
  if (!title || !message) {
    return jsonResponse(400, { error: "Missing title or message" });
  }

  const payload = JSON.stringify({
    title,
    body: message,
    icon: "https://plain-enam-prod-public.komododecks.com/202609/27/diNPEXPYl4KSyTz8DzNj/image.png",
    badge: "https://plain-enam-prod-public.komododecks.com/202609/27/diNPEXPYl4KSyTz8DzNj/image.png",
    tag: tag || `pix-${type || "notification"}-${transactionId || Date.now()}`,
    renotify: true,
    vibrate: type === "paid" ? [200, 100, 200] : [100, 50, 100],
    data: { url: "/admin/pwa.html", type, transactionId },
  });

  try {
    const supabase = getSupabase();
    const { data: subscriptions, error } = await supabase
      .from("pwa_subscriptions")
      .select("endpoint, keys_p256dh, keys_auth");

    if (error) {
      console.error("[PWA-PUSH] DB error:", error.message);
      return jsonResponse(500, { error: "Failed to fetch subscriptions" });
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log("[PWA-PUSH] No subscribers found");
      return jsonResponse(200, { success: true, sent: 0, message: "No subscribers" });
    }

    let sent = 0;
    let failed = 0;
    const staleIds = [];

    for (const sub of subscriptions) {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.keys_p256dh,
          auth: sub.keys_auth,
        },
      };

      try {
        await webpush.sendNotification(pushSubscription, payload);
        sent++;
      } catch (err) {
        failed++;
        console.error("[PWA-PUSH] Send failed:", err.statusCode, sub.endpoint.substring(0, 50));
        // Remove stale subscriptions (404/410 = device unsubscribed)
        if (err.statusCode === 404 || err.statusCode === 410) {
          const staleId = Buffer.from(sub.endpoint).toString("base64").slice(0, 64);
          staleIds.push(staleId);
        }
      }
    }

    // Clean up stale subscriptions
    if (staleIds.length > 0) {
      await supabase.from("pwa_subscriptions").delete().in("id", staleIds);
      console.log(`[PWA-PUSH] Cleaned ${staleIds.length} stale subscriptions`);
    }

    console.log(`[PWA-PUSH] Sent: ${sent}, Failed: ${failed}`);
    return jsonResponse(200, { success: true, sent, failed, total: subscriptions.length });
  } catch (err) {
    console.error("[PWA-PUSH] Error:", err.message);
    return jsonResponse(500, { error: "Push send failed: " + err.message });
  }
};