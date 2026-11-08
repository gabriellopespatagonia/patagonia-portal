// Cliente do Claude compartilhado pelas rotas de IA.
const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic(); // lê ANTHROPIC_API_KEY das configurações do aplicativo
const MODELO = process.env.CLAUDE_MODEL || "claude-opus-5-5";

/**
 * Chamada padrão: thinking adaptativo, fallback automático em caso de recusa
 * e checagem do stop_reason. Retorna { texto, resposta }.
 */
async function perguntar({ system, messages, effort = "medium", max_tokens = 16000, tools, output_config = {} }) {
  let msgs = [...messages], resposta;
  // pause_turn: ferramentas de servidor (ex.: busca na web) podem pausar o turno — continuamos até 3 vezes
  for (let i = 0; i < 4; i++) {
    resposta = await client.beta.messages.create({
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

module.exports = { perguntar, MODELO };
