const PARADISE_BASE = "https://multi.paradisepags.com";
const PARADISE_API_KEY = "sk_e99dc338d9b76bf872ee3fdfb5ae478b8f192e46cabe3736e1cce5dbc4ff1730";

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

async function testarParadise() {
  console.log("\n=== TESTE PARADISE PAYMENTS ===\n");
  console.log("API Key:", PARADISE_API_KEY.substring(0, 10) + "...");
  console.log("Endpoint:", `${PARADISE_BASE}/api/v1/transaction.php`);

  const reference = `TEST_${Date.now()}`;
  const cpf = gerarCpfValido();

  const payload = {
    amount: 2000,
    description: "Produto Digital",
    reference: reference,
    source: "api_externa",
    customer: {
      name: "Joao da Silva",
      email: "joao.silva.teste@gmail.com",
      phone: "11999999999",
      document: cpf,
    },
  };

  console.log("\nPayload enviado:");
  console.log(JSON.stringify(payload, null, 2));
  console.log("\nEnviando requisicao...\n");

  try {
    const resp = await fetch(`${PARADISE_BASE}/api/v1/transaction.php`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": PARADISE_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    console.log("Status HTTP:", resp.status);
    console.log("Resposta bruta:", text.substring(0, 800));

    if (!resp.ok) {
      console.error("\nERRO na requisicao!");
      return;
    }

    const data = JSON.parse(text);
    console.log("\n=== RESULTADO ===");
    console.log("Status:", data.status);
    console.log("Transaction ID:", data.transaction_id);
    console.log("External ID:", data.id);
    console.log("Amount:", data.amount, "centavos");
    console.log("Acquirer:", data.acquirer);
    console.log("Expires At:", data.expires_at);
    console.log("Tem QR Code:", !!data.qr_code);
    console.log("Tem QR Code Base64:", !!data.qr_code_base64);

    if (data.qr_code) {
      console.log("\nPIX Code (copie e cole no app do banco):");
      console.log(data.qr_code);
    }

    if (data.qr_code_base64) {
      console.log("\nQR Code Image (base64) recebido: SIM");
    }

    console.log("\n=== TESTE CONCLUIDO COM SUCESSO ===\n");
  } catch (err) {
    console.error("\nERRO ao chamar API:", err.message);
  }
}

testarParadise();