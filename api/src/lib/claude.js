// Cliente do Claude compartilhado pelas rotas de IA.
// O cliente é criado só quando alguma rota de IA é chamada: sem ANTHROPIC_API_KEY
// configurada, o restante do portal (SharePoint, acessos, dados) continua funcionando
// e apenas as funções de IA respondem que o assistente está desativado.
const MODELO = process.env.CLAUDE_MODEL || "claude-opus-5-5";
let client = null;

const iaAtiva = () => !!process.env.ANTHROPIC_API_KEY;

function obterCliente() {
  if (!iaAtiva()) {
    const e = new Error("O assistente de IA não está ativado neste portal."); e.status = 503; throw e;
  }
  if (!client) {
    const Anthropic = require("@anthropic-ai/sdk");
    client = new Anthropic(); // lê ANTHROPIC_API_KEY das configurações do aplicativo
  }
  return client;
}

/**
 * Chamada padrão: thinking adaptativo, fallback automático em caso de recusa
 * e checagem do stop_reason. Retorna { texto, resposta }.
 */
async function perguntar({ system, messages, effort = "medium", max_tokens = 16000, tools, output_config = {} }) {
  const c = obterCliente();
  let msgs = [...messages], resposta;
  // pause_turn: ferramentas de servidor (ex.: busca na web) podem pausar o turno — continuamos até 3 vezes
  for (let i = 0; i < 4; i++) {
    resposta = await c.beta.messages.create({
      model: MODELO, max_tokens,
      thinking: { type: "adaptive" },
      output_config: { effort, ...output_config },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system, messages: msgs,
      ...(tools ? { tools } : {})
    });
    if (resposta.stop_reason !== "pause_turn") break;
    msgs = [...messages, { role: "assistant", content: resposta.content }];
  }
  if (resposta.stop_reason === "refusal") {
    const e = new Error("O assistente não pôde responder a esta solicitação."); e.status = 422; throw e;
  }
  const texto = resposta.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  return { texto, resposta };
}

module.exports = { perguntar, iaAtiva, MODELO };
