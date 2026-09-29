const { getSupabase } = require("./lib/supabase");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "adin";
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
const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
const token = authHeader.replace(/^Bearer\s+/i, "").trim();
if (token !== ADMIN_PASSWORD) {
return jsonResponse(401, { error: "Unauthorized" });
}
try {
const supabase = getSupabase();
if (event.httpMethod === "GET") {
const { data, error } = await supabase.from("site_config").select("key,value").eq("key", "receiver_name");
if (error) return jsonResponse(500, { error: error.message });
const value = data && data.length > 0 ? data[0].value : "TRADYEX PAYMENTS";
return jsonResponse(200, { receiver_name: value });
}
if (event.httpMethod === "POST") {
let body = {};
try { body = event.body ? JSON.parse(event.body) : {}; } catch { return jsonResponse(400, { error: "Invalid JSON" }); }
const newValue = (body.receiver_name || "").toString().trim();
if (!newValue) return jsonResponse(400, { error: "receiver_name is required" });
const { error } = await supabase.from("site_config").upsert({ key: "receiver_name", value: newValue, updated_at: new Date().toISOString() }, { onConflict: "key" });
if (error) return jsonResponse(500, { error: error.message });
return jsonResponse(200, { success: true, receiver_name: newValue });
}
return jsonResponse(405, { error: "Method not allowed" });
} catch (err) {
console.error("[ADMIN-CONFIG] Error:", err.message);
return jsonResponse(500, { error: "Internal error" });
}
};