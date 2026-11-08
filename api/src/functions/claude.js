// POST /api/claude  { clienteId, pergunta, historico: [{role, content}] }
// Responde dúvidas e gera textos de relatório com base nos dados publicados do
// cliente (lidos no servidor — o navegador não envia os números) e no contexto
// cadastrado pelo consultor (setor, peculiaridades, benchmarks).
const { app } = require("@azure/functions");
const sp = require("../lib/graph");
const { exigirAcessoCliente, httpErro, rota } = require("../lib/acesso");
const { resumir, contextoCliente, descreverEstrutura } = require("../lib/resumo");
const { perguntar } = require("../lib/claude");

const SISTEMA = `Você é o assistente financeiro da Patagonia Business, empresa de consultoria e BPO Financeiro.
Você conversa com clientes e consultores sobre os relatórios gerenciais (DRE, DFC, fluxo de caixa, projeções) e os dados comerciais (vendas, clientes, produtos e serviços) da empresa indicada nos dados abaixo.

Como responder:
- Responda em português do Brasil, de forma clara e objetiva, como um consultor financeiro experiente falando com um empresário.
- Baseie-se nos dados fornecidos e no contexto da empresa. Se a informação não estiver disponível, diga isso e sugira falar com o consultor responsável.
- Cite números em reais (R$) e percentuais, indicando o mês ou período a que se referem. "Faturamento" é a Receita Bruta; percentuais de margem são sobre a Receita Bruta.
- Use sempre os nomes da estrutura padrão da Patagonia, por extenso, sem abreviar (ex.: "Resultado Operacional Bruto - Margem de Contribuição", "Resultado Operacional Líquido - EBITDA").
- Nos dados, receitas/entradas são positivas e despesas/saídas são negativas.
- Estrutura padrão da DRE:\n${descreverEstrutura("DRE")}
- Estrutura padrão do DFC:\n${descreverEstrutura("DFC")}
- Meses com fechamento diferente de "Fechado" são prévias e podem mudar — avise quando usar esses meses.
- Quando pedirem um texto de relatório (comentário executivo, pauta de reunião), entregue o texto pronto para uso.
- Não dê recomendações de investimento em ativos financeiros específicos; mantenha-se na gestão financeira da empresa.
- Use texto simples (sem tabelas markdown); listas curtas com "•" são bem-vindas.`;

app.http("claude", {
  methods: ["POST"], authLevel: "anonymous", route: "claude",
  handler: rota(async (req) => {
    const { clienteId, pergunta, historico = [] } = await req.json();
    const u = await exigirAcessoCliente(req, clienteId);
    if (!pergunta || String(pergunta).length > 6000) throw httpErro(400, "Pergunta vazia ou muito longa");
    const dados = await sp.lerJson(`Clientes/${clienteId}/publicado/dados.json`);
    if (!dados) throw httpErro(404, "Ainda não há dados publicados para este cliente");
    const cadastro = ((await sp.lerJson("config/clientes.json")) || []).find((c) => c.id === clienteId);

    const { texto } = await perguntar({
      system: [
        { type: "text", text: SISTEMA + `\n\nPerfil de quem pergunta: ${u.papel === "consultor" ? "consultor da Patagonia (pode receber análises técnicas)" : "cliente (empresário)"}.` },
        // Contexto e dados em bloco separado e cacheado: as perguntas seguintes da conversa reaproveitam o cache
        { type: "text", text: `CONTEXTO DA EMPRESA:\n${contextoCliente(cadastro) || "(não informado)"}\n\nDADOS DA EMPRESA (JSON):\n${JSON.stringify(resumir(dados))}`, cache_control: { type: "ephemeral" } }
      ],
      messages: [
        ...historico.filter((m) => ["user", "assistant"].includes(m.role) && typeof m.content === "string").slice(-10),
        { role: "user", content: String(pergunta) }
      ]
    });
    return { resposta: texto || "Não obtive uma resposta. Tente novamente." };
  })
});
