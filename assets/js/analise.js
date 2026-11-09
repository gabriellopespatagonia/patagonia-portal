/* =========================================================
   Análises: composição de custos/despesas, caixa livre,
   motor de projeção por premissas e textos de resumo.
   ========================================================= */
(function () {
  const PB = window.PB, f = PB.fmt, soma = PB.soma;
  const tot = (a) => soma(a, (x) => x);
  /* Fluxo de caixa livre = caixa operacional + caixa de investimentos (DFC) */
  PB.calc.caixaLivre = function (dados, meses) {
    const d = PB.calc.dfc(dados, meses);
    const fcl = meses.map((_, i) => d.totais.OPE[i] + d.totais.INV[i]);
    let ac = 0; const acumulado = fcl.map((v) => (ac += v));
    return { fcl, acumulado, ope: d.totais.OPE, inv: d.totais.INV, fin: d.totais.FIN };
  };

  /* Meses com status de fechamento */
  PB.statusFechamento = (dados, mes) => ((dados.fechamentos || {})[mes] || {}).status || "Aberto";

  /* =========================================================
     MOTOR DE PROJEÇÃO POR PREMISSAS
     ========================================================= */
  PB.projecao = {};
  PB.projecao.padrao = () => ({
    janela: 12, crescimentoMensal: 0, horizonte: 6, custosPct: null, reajusteDespesas: 0,
    clientesPerdidos: [], ajustes: []
  });
  PB.projecao.calcular = function (dados, p) {
    const todos = PB.mesesDisponiveis(dados);
    const hist = todos.slice(-p.janela);
    const dre = PB.calc.dre(dados, hist), v = dre.valor;
    const T = (id) => tot(v(id));
    const n = hist.length || 1, RB = T("RB");
    const recMedia = RB / n;
    // percentuais sobre o faturamento (valores de despesa são negativos na estrutura)
    const dedPct = RB ? -T("DED") / RB : 0;
    const cusPct = p.custosPct != null ? p.custosPct : RB ? -T("CV") / RB : 0;
    const dvPct = RB ? -T("DV") / RB : 0;
    const irPct = RB ? -T("filhos:RAIR") / RB : 0;
    const despMedia = -T("DF") / n * (1 + (p.reajusteDespesas || 0));
    const daMedia = -T("filhos:EBITDA") / n;
    const finMedia = (T("RNO") + T("RF")) / n;
    // participação de cada cliente perdido no faturamento da janela
    const vendasJanela = dados.vendas.filter((v) => hist.includes(v.data.slice(0, 7)));
    const totalVendas = soma(vendasJanela, (v) => v.valorTotal) || 1;
    const perdidos = (p.clientesPerdidos || []).map((c) => {
      const part = soma(vendasJanela.filter((v) => v.cliente === c.cliente), (v) => v.valorTotal) / totalVendas;
      return { ...c, participacao: part };
    });
    const ultimo = todos.at(-1);
    const [y, m] = ultimo.split("-").map(Number);
    const futuros = PB.mesesEntre(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`, "2100-01").slice(0, p.horizonte);
    const linhas = futuros.map((mes, i) => {
      let receita = recMedia * Math.pow(1 + (p.crescimentoMensal || 0), i + 1);
      const perda = perdidos.filter((c) => !c.aPartirDe || mes >= c.aPartirDe).reduce((s, c) => s + c.participacao, 0);
      receita *= 1 - Math.min(perda, 1);
      const aj = (p.ajustes || []).filter((a) => a.mes === mes);
      receita += soma(aj.filter((a) => a.tipo === "Receita"), (a) => a.valor);
      const deducoes = receita * dedPct, custos = receita * cusPct, despVariaveis = receita * dvPct;
      const despesas = despMedia + soma(aj.filter((a) => a.tipo === "Despesa"), (a) => a.valor);
      const lucroBruto = receita - deducoes - custos - despVariaveis; // margem de contribuição
      const operacional = lucroBruto - despesas;                        // EBITDA
      const liquido = operacional - daMedia + finMedia - receita * irPct;
      return { mes, receita, deducoes, custos, despVariaveis, despesas, lucroBruto, operacional, liquido };
    });
    const descricao = [
      `Receita base: média móvel de ${n} meses (${f.mes(hist[0])} a ${f.mes(hist.at(-1))}) = ${f.moeda(recMedia)}/mês`,
      `Crescimento mensal: ${f.pct(p.crescimentoMensal || 0)}`,
      `Deduções da Receita Bruta: ${f.pct(dedPct)} do faturamento · Custos Variáveis: ${f.pct(cusPct)} do faturamento${p.custosPct != null ? " (premissa ajustada)" : " (histórico)"} · Despesas Variáveis: ${f.pct(dvPct)} do faturamento`,
      `Despesas Fixas: ${f.moeda(despMedia)}/mês${p.reajusteDespesas ? ` (reajuste de ${f.pct(p.reajusteDespesas)})` : ""}`,
      ...perdidos.map((c) => `Perda do cliente ${c.cliente} (${f.pct(c.participacao)} do faturamento)${c.aPartirDe ? " a partir de " + f.mes(c.aPartirDe) : ""}`),
      ...(p.ajustes || []).map((a) => `${a.tipo === "Receita" ? "Receita" : "Despesa"} pontual em ${f.mes(a.mes)}: ${f.moeda(a.valor)}${a.descricao ? " — " + a.descricao : ""}`)
    ];
    return { linhas, descricao, base: { recMedia, dedPct, cusPct, dvPct, despMedia, irPct, finMedia, daMedia, hist } };
  };

  /* Interpretação local de comandos (modo demonstração / sem IA) */
  PB.projecao.interpretarLocal = function (texto, p, dados) {
    const t = texto.toLowerCase(); const novo = JSON.parse(JSON.stringify(p)); const feito = [];
    const num = (s) => parseFloat(String(s).replace(",", "."));
    if (/restaur|padr[aã]o|zerar|resetar/.test(t)) return { premissas: PB.projecao.padrao(), resposta: "Premissas restauradas para o padrão (média móvel de 12 meses, sem crescimento)." };
    let r;
    if ((r = t.match(/m[eé]dia(?: m[oó]vel)?(?: de)? (\d+)/)) || (r = t.match(/[uú]ltimos (\d+) meses/))) { novo.janela = Math.max(1, Math.min(24, +r[1])); feito.push(`base de cálculo alterada para média móvel de ${novo.janela} meses`); }
    if ((r = t.match(/cresc\w*(?: de)? (-?\d+[,.]?\d*)\s*%(\s*(ao|por) ano)?/))) { novo.crescimentoMensal = r[2] ? Math.pow(1 + num(r[1]) / 100, 1 / 12) - 1 : num(r[1]) / 100; feito.push(`crescimento de ${f.pct(novo.crescimentoMensal)} ao mês`); }
    if ((r = t.match(/custos?(?: de| em| para)? (\d+[,.]?\d*)\s*%/))) { novo.custosPct = num(r[1]) / 100; feito.push(`custos em ${f.pct(novo.custosPct)} da receita`); }
    if ((r = t.match(/reajuste\D*(\d+[,.]?\d*)\s*%/))) { novo.reajusteDespesas = num(r[1]) / 100; feito.push(`reajuste de ${f.pct(novo.reajusteDespesas)} nas despesas`); }
    if ((r = t.match(/(?:horizonte|pr[oó]ximos)(?: de)? (\d+) meses/))) { novo.horizonte = Math.max(1, Math.min(24, +r[1])); feito.push(`horizonte de ${novo.horizonte} meses`); }
    if (/perd|sa[ií]da|sem o cliente|cancel/.test(t)) {
      const clientes = [...new Set(dados.vendas.map((v) => v.cliente))];
      const achado = clientes.filter((c) => t.includes(c.toLowerCase())).sort((a, b) => b.length - a.length)[0]
        || clientes.find((c) => c.toLowerCase().split(" ").filter((w) => w.length > 3).some((w) => t.includes(w)));
      if (achado) {
        const mm = t.match(/a partir de (\w{3})\w*[\/ ]?(\d{2,4})?/);
        const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
        let aPartirDe = null;
        if (mm && MES.includes(mm[1])) { const ano = mm[2] ? (mm[2].length === 2 ? "20" + mm[2] : mm[2]) : PB.mesesDisponiveis(dados).at(-1).slice(0, 4); aPartirDe = `${ano}-${String(MES.indexOf(mm[1]) + 1).padStart(2, "0")}`; }
        novo.clientesPerdidos = novo.clientesPerdidos.filter((c) => c.cliente !== achado).concat({ cliente: achado, aPartirDe });
        feito.push(`considerada a perda do cliente ${achado}${aPartirDe ? " a partir de " + f.mes(aPartirDe) : ""}`);
      } else feito.push("não encontrei esse cliente na base de vendas — confira o nome");
    }
    return { premissas: novo, resposta: feito.length ? "Feito: " + feito.join("; ") + "." : "Não entendi o ajuste. Exemplos: \"média móvel de 3 meses\", \"crescimento de 2% ao mês\", \"considere a perda do cliente X a partir de jan/27\", \"custos de 40%\", \"reajuste de 5% nas despesas\"." };
  };

  /* =========================================================
     TEXTOS DE RESUMO (observações automáticas)
     ========================================================= */
  const varPct = (a, b) => (b ? (a - b) / Math.abs(b) : null);
  const sinal = (v) => (v == null ? "" : (v >= 0 ? "alta de " : "queda de ") + f.pct(Math.abs(v)));
  const metade = (arr) => { const h = Math.floor(arr.length / 2); return [arr.slice(0, h), arr.slice(h)]; };
  function emAberto(dados, meses) { return meses.filter((m) => PB.statusFechamento(dados, m) !== "Fechado"); }

  PB.analise = {};
  PB.analise.dre = function (dados, meses) {
    const dre = PB.calc.dre(dados, meses), t = dre.totais;
    const fat = tot(t.receitaBruta), rl = tot(t.receitaLiquida);
    const mb = tot(t.lucroBruto) / fat, mo = tot(t.ebitda) / fat, ml = tot(t.liquido) / fat;
    const [a, b] = metade(meses.map((_, i) => i));
    const mlA = soma(a, (i) => t.liquido[i]) / (soma(a, (i) => t.receitaBruta[i]) || 1), mlB = soma(b, (i) => t.liquido[i]) / (soma(b, (i) => t.receitaBruta[i]) || 1);
    const prejuizo = meses.filter((_, i) => t.liquido[i] < 0);
    const desp = PB.calc.composicao(dados, meses, ["DV", "DF"]);
    const n = Math.min(3, Math.floor(meses.length / 2));
    const cresc = desp.porCategoria.map((c) => ({ nome: c.nome, v: varPct(tot(c.valores.slice(-n)), tot(c.valores.slice(-2 * n, -n))), dif: tot(c.valores.slice(-n)) - tot(c.valores.slice(-2 * n, -n)) }))
      .filter((c) => c.v != null && c.dif > 0).sort((x, y) => y.dif - x.dif).slice(0, 3);
    const ult = t.receitaBruta.at(-1), media = fat / meses.length;
    const obs = [
      `Faturamento de ${f.moeda(fat)} no período (${f.mes(meses[0])} a ${f.mes(meses.at(-1))}), média de ${f.moeda(media)}/mês. O último mês ficou ${ult >= media ? "acima" : "abaixo"} da média (${sinal(varPct(ult, media))}).`,
      `Margem de contribuição de ${f.pct(mb)}, margem EBITDA (resultado operacional líquido) de ${f.pct(mo)} e margem líquida de ${f.pct(ml)} sobre o faturamento.`,
      meses.length >= 4 ? `A margem líquida ${mlB >= mlA ? "melhorou" : "piorou"} da primeira para a segunda metade do período (${f.pct(mlA)} → ${f.pct(mlB)}).` : null,
      desp.porCategoria[0] ? `Maior despesa (variável ou fixa): ${desp.porCategoria[0].nome} (${f.moeda(desp.porCategoria[0].total)}, ${f.pct(desp.porCategoria[0].total / fat)} do faturamento).` : null,
      cresc.length ? `Despesas que mais cresceram nos últimos ${n} meses: ${cresc.map((c) => `${c.nome} (+${f.moeda(c.dif)}, ${sinal(c.v)})`).join("; ")}.` : null,
      prejuizo.length ? `Atenção: Prejuízo em ${prejuizo.length} mês(es): ${prejuizo.map(f.mes).join(", ")}.` : "Todos os meses do período fecharam com lucro líquido.",
      emAberto(dados, meses).length ? `Observação: Meses ainda não fechados (valores sujeitos a ajuste): ${emAberto(dados, meses).map(f.mes).join(", ")}.` : null
    ];
    return { titulo: "Resumo da DRE", obs: obs.filter(Boolean) };
  };
  PB.analise.dfc = function (dados, meses) {
    const c = PB.calc.caixaLivre(dados, meses), dre = PB.calc.dre(dados, meses);
    const ope = tot(c.ope), inv = tot(c.inv), fin = tot(c.fin), fcl = tot(c.fcl), ebitda = tot(dre.totais.ebitda);
    const queima = meses.filter((_, i) => c.fcl[i] < 0);
    return { titulo: "Resumo da DFC", obs: [
      `As operações ${ope >= 0 ? "geraram" : "consumiram"} ${f.moeda(Math.abs(ope))} de caixa no período.`,
      ebitda > 0 ? `Conversão do lucro operacional em caixa: ${f.pct(ope / ebitda)} (caixa operacional ÷ lucro operacional). ${ope / ebitda < 0.8 ? "Abaixo de 80% — vale revisar prazos de recebimento e estoques." : "Boa conversão."}` : null,
      inv ? `Investimentos: ${f.moeda(Math.abs(inv))} ${inv < 0 ? "aplicados" : "recebidos"} (compra/venda de ativos).` : "Não houve movimentação de investimentos no período.",
      fin ? `Financiamentos: saldo ${fin >= 0 ? "positivo" : "negativo"} de ${f.moeda(Math.abs(fin))} (empréstimos, amortizações e distribuição de lucros).` : null,
      `Fluxo de caixa livre (operacional + investimentos): ${f.moeda(fcl)} — a empresa ${fcl >= 0 ? "gerou" : "queimou"} caixa no período.`,
      queima.length ? `Atenção: Queima de caixa livre em: ${queima.map(f.mes).join(", ")}.` : "Caixa livre positivo em todos os meses."
    ].filter(Boolean) };
  };
  PB.analise.fluxo = function (dados, mesesHorizonte) {
    const fl = PB.calc.fluxo(dados, mesesHorizonte).linhas;
    const real = fl.filter((l) => !l.previsto), prev = fl.filter((l) => l.previsto);
    const saldo = real.at(-1)?.saldoFinal || 0;
    const saidaMedia = soma(real.slice(-3), (l) => l.saidas) / Math.min(3, real.length || 1);
    const menor = prev.reduce((m, l) => (l.saldoFinal < m.saldoFinal ? l : m), prev[0] || real.at(-1));
    const hoje = new Date().toISOString().slice(0, 10);
    const vencidos = dados.lancamentos.filter((l) => PB.caixaPrevisto(l) && l.data < hoje);
    return { titulo: "Resumo do Fluxo de Caixa", obs: [
      `Saldo de caixa atual: ${f.moeda(saldo)}${real.length ? " (" + f.mes(real.at(-1).mes) + ")" : ""}.`,
      saidaMedia ? `Cobertura: o saldo atual paga ${(saldo / saidaMedia).toFixed(1).replace(".", ",")} mês(es) de saídas médias (${f.moeda(saidaMedia)}/mês nos últimos 3 meses).` : null,
      prev.length ? `Menor saldo previsto: ${f.moeda(menor.saldoFinal)} em ${f.mes(menor.mes)}. ${menor.saldoFinal < 0 ? "Atenção: há risco de caixa negativo — antecipe recebíveis ou renegocie pagamentos." : menor.saldoFinal < saidaMedia ? "Atenção: saldo previsto abaixo de 1 mês de saídas." : "Sem risco de caixa negativo no horizonte previsto."}` : "Não há lançamentos previstos cadastrados para os próximos meses.",
      vencidos.length ? `Observação: ${vencidos.length} lançamento(s) previsto(s) com data já vencida (${f.moeda(soma(vencidos, (l) => l.valor))}) — confirmar baixa ou reprogramar.` : null
    ].filter(Boolean) };
  };
  PB.analise.projecoes = function (dados, meses, cenario, simulacao) {
    const pj = dados.projecoes.filter((p) => p.cenario === cenario);
    const dre = PB.calc.dre(dados, meses.slice(-6));
    const mediaReal = tot(dre.totais.receitaBruta) / dre.meses.length;
    const mediaProj = pj.length ? soma(pj, (p) => p.receita) / pj.length : 0;
    const res = pj.map((p) => p.receita - (p.custos || 0) - (p.despesas || 0));
    const outros = ["Base", "Otimista", "Conservador"].map((c) => ({ c, r: soma(dados.projecoes.filter((p) => p.cenario === c), (p) => p.receita) }));
    const obs = [
      pj.length ? `Cenário ${cenario}: receita média projetada de ${f.moeda(mediaProj)}/mês, ${sinal(varPct(mediaProj, mediaReal))} sobre a média realizada dos últimos 6 meses (${f.moeda(mediaReal)}).` : "Não há projeção publicada pelo consultor para este cenário.",
      pj.length ? `Resultado projetado acumulado de ${f.moeda(tot(res))} em ${pj.length} meses${res.some((v) => v < 0) ? "; atenção: há meses com resultado negativo" : ""}.` : null,
      outros.every((o) => o.r) ? `Faixa entre cenários (receita acumulada): ${f.moeda(Math.min(...outros.map((o) => o.r)))} a ${f.moeda(Math.max(...outros.map((o) => o.r)))}.` : null,
      simulacao ? `Sua simulação atual projeta lucro líquido acumulado de ${f.moeda(soma(simulacao.linhas, (l) => l.liquido))} em ${simulacao.linhas.length} meses.` : null
    ];
    return { titulo: "Resumo das Projeções", obs: obs.filter(Boolean) };
  };
  PB.analise.comercial = function (dados, meses) {
    const c = PB.calc.comercial(dados, meses);
    const top5 = c.porCliente.slice(0, 5), conc = soma(top5, (x) => x.valor) / (c.total || 1);
    const [a, b] = metade(c.faturamento);
    return { titulo: "Resumo Comercial", obs: [
      `${f.num(c.totalPedidos)} pedidos para ${f.num(c.totalClientes)} clientes, ticket médio de ${f.moeda(c.total / (c.totalPedidos || 1))}.`,
      `Faturamento da segunda metade do período: ${sinal(varPct(tot(b) / (b.length || 1), tot(a) / (a.length || 1)))} em relação à primeira.`,
      `Os 5 maiores clientes concentram ${f.pct(conc)} das vendas${conc > 0.5 ? " — concentração elevada, risco relevante em caso de perda" : ""}.`,
      c.porItem[0] ? `Item mais vendido: ${c.porItem[0].nome} (${f.pct(c.porItem[0].valor / c.total)} do faturamento).` : null
    ].filter(Boolean) };
  };

  /* Conclusões locais para apresentação (usadas quando a IA não está disponível) */
  PB.analise.conclusoesLocais = function (dados, meses) {
    const dre = PB.analise.dre(dados, meses), dfc = PB.analise.dfc(dados, meses), com = PB.analise.comercial(dados, meses);
    const fl = PB.analise.fluxo(dados, PB.mesesEntre(meses[0], dados.lancamentos.reduce((m, l) => (l.data.slice(0, 7) > m ? l.data.slice(0, 7) : m), meses.at(-1))));
    const limpa = (s) => s.replace(/^(Atenção|Observação): /, "");
    const atencao = [...dre.obs, ...dfc.obs, ...fl.obs].filter((s) => /Atenção:/.test(s)).map(limpa);
    return {
      resumoExecutivo: dre.obs.slice(0, 2).join(" "),
      destaques: [dre.obs[2], dfc.obs[4], com.obs[0], com.obs[2]].filter(Boolean).map(limpa),
      pontosAtencao: atencao.length ? atencao : ["Nenhum alerta crítico identificado no período."],
      recomendacoes: [
        "Acompanhar mensalmente as margens bruta e operacional e as despesas que mais cresceram.",
        "Manter o fluxo de caixa previsto atualizado para pelo menos 90 dias.",
        "Reduzir a dependência dos maiores clientes ampliando a base ativa."
      ],
      conclusao: "Conclusões geradas automaticamente a partir dos números. Ative o assistente de IA (Claude) no servidor para obter uma análise contextualizada ao setor da empresa."
    };
  };
})();
