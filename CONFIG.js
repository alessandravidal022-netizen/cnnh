/**
 * CONFIGURAÇÃO CENTRAL - Valores padronizados
 * Mudar aqui afeta TODO o sistema: frontend, backend, pixels
 */

const CONFIG = {
  // Valor padrão do PIX em REAIS
  DEFAULT_AMOUNT: 20.00,

  // Detalhamento da taxa
  AMOUNTS: {
    TED: 5.00,       // Taxa banco
    TSA: 7.00,       // Taxa intermediária
    TPE: 8.00,       // Taxa plataforma
    TOTAL: 20.00     // Valor final (será cobrado 20.00)
  },

  // Loja
  STORE_NAME: "SHOPIFY LOJA 03",

  // Facebook Pixel IDs
  FACEBOOK_PIXELS: [
    "4327697327497010",
    "1078834241324397",
    "1527029111971432"
  ],

  // UTMify
  UTMIFY_PIXEL_ID: "6a2200f2ae65ba8b4e8c85c7",

  // Gateway
  GATEWAY_NAME: "AvenPayments",
  GATEWAY_API_BASE: "https://api.avenpayments.com/v1",

  // Supabase
  SUPABASE_TABLE: "transactions"
};

// Export para Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}