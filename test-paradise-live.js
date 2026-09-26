// Script de teste local - NAO CONTÉM SECRETS HARDCODED
// Para testar, defina PARADISE_API_KEY no seu ambiente local
const PARADISE_BASE = "https://multi.paradisepags.com";
const PARADISE_API_KEY = process.env.PARADISE_API_KEY;

if (!PARADISE_API_KEY) {
  console.error("Defina PARADISE_API_KEY no ambiente antes de rodar este teste");
  process.exit(1);
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

async function testarParadise() {
  console.log("\n=== TESTE PARADISE PAYMENTS ===\n");
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

  try {
    const resp = await fetch(`${PARADISE_BASE}/api/v1/transaction.php`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": PARADISE_API_KEY,
      },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    console.log("Status:", resp.status);
    console.log("Resultado:", JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Erro:", err.message);
  }
}

testarParadise();