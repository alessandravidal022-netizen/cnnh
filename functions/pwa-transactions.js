const { getSupabase } = require("./lib/supabase");

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
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
        "Access-Control-Allow-Methods": "GET,OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "GET") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const since = event.queryStringParameters?.since || new Date(Date.now() - 3600000).toISOString();
  const limit = Math.min(parseInt(event.queryStringParameters?.limit || "20", 10), 50);

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("transactions")
      .select("transaction_id,status,amount,customer_name,created_at,paid_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[PWA] Supabase error:", error.message);
      return jsonResponse(500, { error: "Database error" });
    }

    return jsonResponse(200, { transactions: data || [] });
  } catch (err) {
    console.error("[PWA] Error:", err.message);
    return jsonResponse(500, { error: "Internal error" });
  }
};