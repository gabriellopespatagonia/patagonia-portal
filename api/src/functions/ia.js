// Rotas de IA: ajuste de premissas de projeção, pesquisa de benchmarks do setor
// e conclusões para a apresentação de resultados.
const { app } = require("@azure/functions");
const sp = require("../lib/graph");
const { exigirAcessoCliente, exigirConsultor, httpErro, rota } = require("../lib/acesso");
const { resumir, contextoCliente } = require("../lib/resumo");
const { perguntar } = require("../lib/claude");

const cadastroDe = async (id) => ((await sp.lerJson("config/clientes.json")) || []).find((c) => c.id === id);
const dadosDe = async (id) => {
  const d = await sp.lerJson(`Clientes/${id}/publicado/dados.json`);
  if (!d) throw httpErro(404, "Ainda não há dados publicados para este cliente");
  return d;
};

/* ---------------------------------------------------------
   POST /api/premissas { clienteId, mensagem, premissas, historico }
   O Claude devolve as novas premissas em JSON (saída estruturada);
   o navegador recalcula a projeção com o mesmo motor de cálculo.
   --------------------------------------------------------- */
const SCHEMA_PREMISSAS = {
  type: "object", additionalProperties: false,
  required: ["premissas", "resposta"],
  properties: {
    resposta: { type: "string", description: "Explicação curta, em português, do que foi alterado" },
    premissas: {
      type: "object", additionalProperties: false,
      required: ["janela", "crescimentoMensal", "horizonte", "custosPct", "reajusteDespesas", "clientesPerdidos", "ajustes"],
      properties: {
        janela: { type: "integer", description: "Meses da média móvel usada como base de receita (1 a 24)" },
        crescimentoMensal: { type: "number", description: "Crescimento mensal composto da receita, em fração (0.02 = 2% ao mês)" },
        horizonte: { type: "integer", description: "Quantidade de meses projetados (1 a 24)" },
        custosPct: { type: ["number", "null"], description: "Custos Variáveis como fração do faturamento; null = usar o histórico" },
        reajusteDespesas: { type: "number", description: "Reajuste das Despesas Fixas, em fração (0.05 = 5%)" },
        clientesPerdidos: { type: "array", items: { type: "object", additionalProperties: false, required: ["cliente", "aPartirDe"],
          properties: { cliente: { type: "string", description: "Nome exatamente como aparece na lista de clientes" }, aPartirDe: { type: ["string", "null"], description: "AAAA-MM ou null (desde o primeiro mês)" } } } },
        ajustes: { type: "array", items: { type: "object", additionalProperties: false, required: ["mes", "tipo", "valor", "descricao"],
          properties: { mes: { type: "string", description: "AAAA-MM" }, tipo: { type: "string", enum: ["Receita", "Despesa"] }, valor: { type: "number" }, descricao: { type: "string" } } } }
      }
    }
  }
};

app.http("premissas", {
  methods: ["POST"], authLevel: "anonymous", route: "premissas",
  handler: rota(async (req) => {
    const { clienteId, mensagem, premissas, historico = [] } = await req.json();
    await exigirAcessoCliente(req, clienteId);
    if (!mensagem || String(mensagem).length > 2000) throw httpErro(400, "Mensagem inválida");
    const d = await dadosDe(clienteId);
    const meses = [...new Set(d.lancamentos.filter((l) => l.status === "Realizado").map((l) => l.competencia))].sort();
    const clientes = Object.entries(d.vendas.reduce((o, v) => ((o[v.cliente] = (o[v.cliente] || 0) + v.valorTotal), o), {}))
      .sort((a, b) => b[1] - a[1]).slice(0, 80).map(([n]) => n);
    const system = `Você ajusta as PREMISSAS de um modelo de projeção financeira a pedido do usuário.
O modelo funciona assim: receita base = média móvel dos últimos "janela" meses de receita bruta realizada; cresce "crescimentoMensal" ao mês (composto);
clientes perdidos reduzem a receita pela participação deles no faturamento; Deduções da Receita Bruta, Custos Variáveis e Despesas Variáveis seguem o percentual histórico sobre o faturamento ("custosPct" substitui o percentual dos Custos Variáveis);
Despesas Fixas = média da janela × (1 + reajusteDespesas); "ajustes" são receitas/despesas pontuais em um mês.
Altere somente o que o usuário pediu e mantenha o restante igual às premissas atuais. Se o pedido for ambíguo, faça a interpretação mais razoável e explique.
Último mês realizado: ${meses.at(-1)}. Meses disponíveis no histórico: ${meses.length}.
Clientes da base (use o nome exato): ${clientes.join(" | ")}`;
    const { texto } = await perguntar({
      system, effort: "low", max_tokens: 4000,
      output_config: { format: { type: "json_schema", schema: SCHEMA_PREMISSAS } },
      messages: [
        ...historico.filter((m) => ["user", "assistant"].includes(m.role) && typeof m.content === "string").slice(-8),
        { role: "user", content: `Premissas atuais: ${JSON.stringify(premissas)}\n\nPedido: ${mensagem}` }
      ]
    });
    const r = JSON.parse(texto);
    r.premissas.janela = Math.max(1, Math.min(24, r.premissas.janela));
    r.premissas.horizonte = Math.max(1, Math.min(24, r.premissas.horizonte));
    return r;
  })
});

/* ---------------------------------------------------------
   POST /api/benchmarks { clienteId }  (consultor)
   Pesquisa na web, restrita a fontes confiáveis, conceitos e
   benchmarks do setor do cliente.
   --------------------------------------------------------- */
const DOMINIOS_PADRAO = ["ibge.gov.br", "bcb.gov.br", "gov.br", "sebrae.com.br", "fgv.br", "ipea.gov.br", "cni.com.br", "cnc.org.br",
  "abras.com.br", "valor.globo.com", "exame.com", "b3.com.br", "cvm.gov.br", "receita.economia.gov.br", "abihpec.org.br", "abimaq.org.br"];

app.http("benchmarks", {
  methods: ["POST"], authLevel: "anonymous", route: "benchmarks",
  handler: rota(async (req) => {
    await exigirConsultor(req);
    const { clienteId } = await req.json();
    await exigirAcessoCliente(req, clienteId);
    const c = await cadastroDe(clienteId);
    if (!c || (!c.setor && !c.contexto)) throw httpErro(400, "Cadastre o setor e o contexto da empresa antes de pesquisar");
    const dominios = (process.env.BENCHMARK_DOMINIOS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const { resposta, texto } = await perguntar({
      effort: "low", max_tokens: 8000,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6, allowed_domains: dominios.length ? dominios : DOMINIOS_PADRAO, user_location: { type: "approximate", country: "BR" } }],
      system: `Você é um analista de pesquisa da Patagonia Business (consultoria financeira para PMEs brasileiras).
Pesquise na web, apenas em fontes confiáveis (órgãos oficiais, entidades setoriais, institutos de pesquisa e imprensa econômica), e escreva em português do Brasil um resumo para o consultor com:
1) Conceitos e indicadores-chave do setor (o que acompanhar e por quê).
2) Benchmarks numéricos disponíveis (margens, custos, prazos médios, crescimento do setor, sazonalidade), sempre com a fonte e o ano.
3) Tendências e riscos recentes relevantes para uma PME do setor no Brasil.
Seja honesto: se não encontrar um número confiável, diga que não encontrou em vez de estimar. Texto simples, com tópicos "•", até 450 palavras.`,
      messages: [{ role: "user", content: `Setor: ${c.setor || "(não informado)"}\nContexto da empresa: ${c.contexto || "(não informado)"}` }]
    });
    // Fontes: citações dos blocos de texto
    const fontes = [], vistos = new Set();
    resposta.content.forEach((b) => (b.citations || []).forEach((ci) => {
      if (ci.url && !vistos.has(ci.url)) { vistos.add(ci.url); fontes.push({ titulo: ci.title || ci.url, url: ci.url }); }
    }));
    return { texto, fontes, em: new Date().toISOString() };
  })
});

/* ---------------------------------------------------------
   POST /api/apresentacao { clienteId, meses: ["AAAA-MM", ...] }  (consultor)
   Conclusões estruturadas para os slides de resultado.
   --------------------------------------------------------- */
const SCHEMA_CONCLUSOES = {
  type: "object", additionalProperties: false,
  required: ["resumoExecutivo", "destaques", "pontosAtencao", "recomendacoes", "conclusao"],
  properties: {
    resumoExecutivo: { type: "string", description: "3 a 4 frases com o resultado do período" },
    destaques: { type: "array", items: { type: "string" }, description: "4 a 6 destaques positivos ou relevantes, com números" },
    pontosAtencao: { type: "array", items: { type: "string" }, description: "3 a 5 pontos de atenção, com números" },
    recomendacoes: { type: "array", items: { type: "string" }, description: "3 a 5 recomendações práticas e específicas" },
    conclusao: { type: "string", description: "Parágrafo final de conclusão, até 90 palavras" }
  }
};

app.http("apresentacao", {
  methods: ["POST"], authLevel: "anonymous", route: "apresentacao",
  handler: rota(async (req) => {
    await exigirConsultor(req);
    const { clienteId, meses } = await req.json();
    await exigirAcessoCliente(req, clienteId);
    const [d, c] = await Promise.all([dadosDe(clienteId), cadastroDe(clienteId)]);
    const { texto } = await perguntar({
      effort: "medium", max_tokens: 8000,
      output_config: { format: { type: "json_schema", schema: SCHEMA_CONCLUSOES } },
      system: `Você é consultor sênior da Patagonia Business e está preparando a apresentação de resultados de um cliente (PME brasileira).
Escreva em português do Brasil, com linguagem executiva, frases curtas e números (R$ e %) do período. Use os nomes da estrutura padrão da DRE e do DFC por extenso, sem abreviar. Compare com benchmarks do setor quando disponíveis, citando que são referências de mercado.
Considere o contexto e as peculiaridades da empresa. Meses não fechados são prévias — mencione se influenciarem a leitura. Não invente números que não estejam nos dados.`,
      messages: [{ role: "user", content: `CONTEXTO DA EMPRESA:\n${contextoCliente(c) || "(não informado)"}\n\nDADOS DO PERÍODO (JSON):\n${JSON.stringify(resumir(d, meses))}` }]
    });
    return { ...JSON.parse(texto), origem: "claude" };
  })
});
