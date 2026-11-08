/* =========================================================
   ESTRUTURA PADRÃO DA DRE E DO DFC — Patagonia Business
   Fonte única usada pelo site (navegador) e pela API (Node).
   ATENÇÃO: o arquivo api/src/lib/estrutura.js é uma cópia
   deste — ao alterar aqui, copie para lá.

   Tipos de nó:
     grupo     → soma das linhas (e subgrupos) abaixo dele
     subgrupo  → grupo dentro de outro grupo (DFC)
     linha     → linha analítica da estrutura: recebe as contas analíticas do plano
     resultado → soma de outros nós (fórmula em "soma")
   Valores são assinados: entradas/receitas positivas, saídas/despesas negativas.
   ========================================================= */
(function (raiz, fabrica) {
  const E = fabrica();
  if (typeof module === "object" && module.exports) module.exports = E;
  else raiz.PB_ESTRUTURA = E;
})(typeof self !== "undefined" ? self : this, function () {
  const NAO_DRE = "Não compõe a DRE";
  const NAO_DFC = "Não compõe o DFC";
  const CMV = "Custo das Mercadorias Vendidas, dos Produtos Vendidos e dos Serviços Prestados (CMV/CPV/CSP)";

  const g = (id, nome, sinal, extra = {}) => ({ id, nome, sinal, tipo: "grupo", ...extra });
  const sg = (id, nome, sinal, pai) => ({ id, nome, sinal, tipo: "subgrupo", pai });
  const l = (pai, nome, sinal = "-") => ({ id: pai + ":" + nome, nome, sinal, tipo: "linha", pai });
  const r = (id, nome, soma, sinal = "=") => ({ id, nome, sinal, tipo: "resultado", soma });

  const DRE = [
    g("RB", "Receita Bruta", "+", { atribuivel: true }),
    g("DED", "Deduções da Receita Bruta", "-"),
    l("DED", "Vendas Canceladas"), l("DED", "Descontos Concedidos"), l("DED", "Impostos sobre Vendas"), l("DED", "Outras Deduções da Receita Bruta"),
    r("RL", "Receita Líquida", ["RB", "DED"]),
    g("CV", "Custos Variáveis", "-"),
    l("CV", CMV), l("CV", "Mão de Obra Direta"),
    g("DV", "Despesas Variáveis", "-"),
    l("DV", "Despesas com Vendas"), l("DV", "Despesas com Operação e Logística"),
    r("MC", "Resultado Operacional Bruto - Margem de Contribuição", ["RL", "CV", "DV"]),
    g("DF", "Despesas Fixas", "-"),
    l("DF", "Despesa com Pessoal"), l("DF", "Despesas com Comercial"), l("DF", "Despesas com Marketing"),
    l("DF", "Despesas com Ocupação"), l("DF", "Despesas Administrativas"), l("DF", "Despesas de Diretoria"),
    r("EBITDA", "Resultado Operacional Líquido - EBITDA", ["MC", "DF"]),
    l("EBITDA", "Depreciação e Amortização"),
    r("EBIT", "Resultado Operacional - EBIT", ["EBITDA", "filhos:EBITDA"]),
    g("RNO", "Resultado Não Operacional", "+/-"),
    l("RNO", "Outras Receitas não Operacionais", "+"), l("RNO", "Outras Despesas não Operacionais"),
    g("RF", "Resultado Financeiro", "+/-"),
    l("RF", "Receitas Financeiras", "+"), l("RF", "Despesas Financeiras"),
    r("RAIR", "Resultado Antes dos Impostos e Participações", ["EBIT", "RNO", "RF"]),
    l("RAIR", "Provisão para Imposto de Renda Pessoa Jurídica (IRPJ) / Pessoa Física (IRPF)"),
    l("RAIR", "Provisão para Contribuição Social sobre o Lucro Líquido (CSLL)"),
    l("RAIR", "Participações, Debêntures e Outras"),
    r("RLIQ", "Resultado Líquido", ["RAIR", "filhos:RAIR"]),
    l("RLIQ", "Distribuição de Lucros"),
    r("RLAD", "Resultado Líquido Após Distribuições", ["RLIQ", "filhos:RLIQ"])
  ];

  const DFC = [
    r("FCO", "Fluxo de Caixa Operacional (FCO)", ["ENT_FCO", "SAI_FCO"]),
    g("ENT_FCO", "Entradas do Fluxo de Caixa Operacional", "+"),
    l("ENT_FCO", "Receita Bruta", "+"), l("ENT_FCO", "Outras Entradas", "+"),
    g("SAI_FCO", "Saídas do Fluxo de Caixa Operacional", "-"),
    sg("SAI_DED", "Deduções da Receita Bruta", "-", "SAI_FCO"),
    l("SAI_DED", "Vendas Canceladas"), l("SAI_DED", "Descontos Concedidos"), l("SAI_DED", "Impostos sobre Vendas"), l("SAI_DED", "Outras Deduções da Receita Bruta"),
    sg("SAI_CV", "Custos Variáveis", "-", "SAI_FCO"),
    l("SAI_CV", CMV), l("SAI_CV", "Mão de Obra Direta"),
    sg("SAI_DV", "Despesas Variáveis", "-", "SAI_FCO"),
    l("SAI_DV", "Despesas com Vendas"), l("SAI_DV", "Despesas com Operação e Logística"),
    sg("SAI_DF", "Despesas Fixas", "-", "SAI_FCO"),
    l("SAI_DF", "Despesa com Pessoal"), l("SAI_DF", "Despesas com Comercial"), l("SAI_DF", "Despesas com Marketing"),
    l("SAI_DF", "Despesas com Ocupação"), l("SAI_DF", "Despesas Administrativas"), l("SAI_DF", "Despesas de Diretoria"),
    l("SAI_DF", "Outras Receitas não Operacionais", "+"), l("SAI_DF", "Outras Despesas não Operacionais"),
    r("FCF", "Fluxo de Caixa de Financiamentos (FCF)", ["ENT_FCF", "SAI_FCF"]),
    g("ENT_FCF", "Entradas do Fluxo de Caixa de Financiamentos", "+", { atribuivel: true }),
    g("SAI_FCF", "Saídas do Fluxo de Caixa de Financiamentos", "-", { atribuivel: true }),
    r("FCI", "Fluxo de Caixa de Investimentos (FCI)", ["ENT_FCI", "SAI_FCI"]),
    g("ENT_FCI", "Entradas do Fluxo de Caixa de Investimentos", "+", { atribuivel: true }),
    g("SAI_FCI", "Saídas do Fluxo de Caixa de Investimentos", "-", { atribuivel: true }),
    r("VAR", "Variação Líquida do Caixa (FCO + FCF + FCI)", ["FCO", "FCF", "FCI"])
  ];

  const ESTR = { DRE, DFC };

  /** Nomes que podem receber contas analíticas (referências válidas no plano de contas). */
  function atribuiveis(tipo) {
    return ESTR[tipo].filter((n) => n.tipo === "linha" || n.atribuivel).map((n) => n.nome);
  }
  /** Caminho completo de cada referência, ex.: "Despesas Fixas › Despesas com Ocupação". */
  function caminhos(tipo) {
    const mapa = Object.fromEntries(ESTR[tipo].map((n) => [n.id, n]));
    return ESTR[tipo].filter((n) => n.tipo === "linha" || n.atribuivel).map((n) => {
      const partes = [n.nome]; let p = n.pai;
      while (p && mapa[p]) { partes.unshift(mapa[p].nome); p = mapa[p].pai; }
      return { nome: n.nome, caminho: partes.join(" › ") };
    });
  }
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  /** Encontra a referência válida (tolerante a acentos e maiúsculas). */
  function acharReferencia(tipo, texto) {
    if (!texto) return null;
    const t = norm(texto);
    if (t === norm(NAO_DRE) || t === norm(NAO_DFC)) return tipo === "DRE" ? NAO_DRE : NAO_DFC;
    return atribuiveis(tipo).find((n) => norm(n) === t) || null;
  }

  /**
   * Calcula a estrutura.
   * @param tipo "DRE" | "DFC"
   * @param folhas { [nomeReferencia]: number[] }  valores assinados por mês
   * @param contas { [nomeReferencia]: [{ nome, numero, valores }] }  (opcional, para detalhar)
   * @param n quantidade de meses
   */
  function calcular(tipo, folhas, contas, n) {
    const nos = ESTR[tipo], mapa = Object.fromEntries(nos.map((x) => [x.id, x]));
    const zero = () => Array(n).fill(0);
    const add = (a, b) => a.map((v, i) => v + b[i]);
    const cache = {};
    function valor(id) {
      if (cache[id]) return cache[id];
      let v;
      if (id.startsWith("filhos:")) {
        const pai = id.slice(7);
        v = nos.filter((x) => x.pai === pai && x.tipo === "linha").reduce((s, x) => add(s, valor(x.id)), zero());
      } else {
        const no = mapa[id];
        if (no.tipo === "linha") v = folhas[no.nome] ? [...folhas[no.nome]] : zero();
        else if (no.tipo === "resultado") v = no.soma.reduce((s, k) => add(s, valor(k)), zero());
        else {
          v = no.atribuivel && folhas[no.nome] ? [...folhas[no.nome]] : zero();
          nos.filter((x) => x.pai === id && x.tipo !== "resultado").forEach((x) => (v = add(v, valor(x.id))));
        }
      }
      return (cache[id] = v);
    }
    const nivel = (no) => (no.tipo === "linha" ? (mapa[no.pai] && mapa[no.pai].tipo === "subgrupo" ? 2 : 1) : no.tipo === "subgrupo" ? 1 : 0);
    const linhas = [];
    nos.forEach((no) => {
      const estilo = no.tipo === "resultado" ? "res" : no.tipo === "grupo" ? "grp" : no.tipo === "subgrupo" ? "sgrp" : "";
      linhas.push({ id: no.id, nome: `(${no.sinal}) ${no.nome}`, rotulo: no.nome, tipo: no.tipo, estilo, nivel: nivel(no), valores: valor(no.id) });
      if ((no.tipo === "linha" || no.atribuivel) && contas && contas[no.nome]) {
        contas[no.nome].slice().sort((a, b) => String(a.numero).localeCompare(String(b.numero), "pt-BR", { numeric: true }))
          .forEach((c) => linhas.push({ id: no.id + "#" + c.numero, nome: `${c.numero ? c.numero + " · " : ""}${c.nome}`, tipo: "conta", estilo: "conta", nivel: nivel(no) + 1, valores: c.valores }));
      }
    });
    return { linhas, valor };
  }

  return { DRE, DFC, NAO_DRE, NAO_DFC, CMV, atribuiveis, caminhos, acharReferencia, calcular, norm };
});
