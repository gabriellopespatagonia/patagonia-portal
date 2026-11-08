/* =========================================================
   CONFIGURAÇÃO GERAL — edite aqui antes de publicar
   ========================================================= */
window.PB_CONFIG = {
  empresa: "Patagonia Business",
  email: "contato@patagoniabusiness.com.br",
  whatsapp: "5500000000000",

  /*
   * MODO
   *  "auto"     → usa o login real (Azure Static Web Apps + Microsoft Entra ID)
   *               quando publicado, e o modo demonstração quando aberto localmente.
   *  "demo"     → força o modo demonstração (dados fictícios, sem servidor).
   *  "producao" → força o modo real.
   */
  modo: "auto",

  // Endereço base das funções de API (Azure Functions integradas ao Static Web App)
  apiBase: "/api",

  // Provedor de login do Azure Static Web Apps ("aad" = Microsoft Entra ID / Microsoft 365)
  provedorLogin: "aad",

  /*
   * USUÁRIOS DE DEMONSTRAÇÃO (somente modo demo / visualização local).
   * Não use em produção: em produção o login é feito pela Microsoft.
   */
  usuariosDemo: [
    { email: "cliente@demo.com", senha: "demo123", nome: "Ana Souza", papel: "cliente", clienteId: "alfa-distribuidora" },
    { email: "cliente2@demo.com", senha: "demo123", nome: "Bruno Lima", papel: "cliente", clienteId: "beta-servicos" },
    { email: "consultor@demo.com", senha: "demo123", nome: "Consultor Patagonia", papel: "consultor" }
  ]
};
