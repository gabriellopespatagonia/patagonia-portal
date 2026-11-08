/* =========================================================
   Portal do Cliente — Financeiro e Comercial
   ========================================================= */
(async function () {
  const PB = window.PB, UI = PB.ui, f = PB.fmt, C = UI.COR;
  const usuario = await PB.auth.exigir("cliente");
  if (!usuario) return;
  UI.usuarioRodape(usuario);

  let dados = null, clienteId = usuario.clienteId, meses = [], abaAtual = "geral";
  const $ = (id) => document.getElementById(id);

  // Consultor pode visualizar o portal de qualquer cliente
  if (usuario.papel === "consultor") {
    const lista = await PB.api.get("/clientes");
    const sel = $("sel-cliente"); sel.classList.remove("hidden");
    sel.innerHTML = lista.map((c) => `<option value="${c.id}">${PB.esc(c.nome)}</option>`).join("");
    clienteId = new URLSearchParams(location.search).get("cliente") || lista[0]?.id;
    sel.value = clienteId;
    sel.addEventListener("change", () => { clienteId = sel.value; carregar(); chat.limpar(); });
  }

  const chat = UI.chat($("chat"), () => clienteId, [
    "Como foi o resultado do último mês?",
    "Quais despesas mais cresceram?",
    "Meu caixa é suficiente para os próximos 3 meses?",
    "Quem são meus 5 principais clientes?"
  ]);

  /* Resumos do período (um por relatório) */
  const periodoTxt = () => `${f.mes(meses[0])} a ${f.mes(meses.at(-1))}`;
  const perguntaIA = (nome) => (r) => `Faça uma análise do relatório ${nome} da empresa no período de ${periodoTxt()}. ` +
    `Observações automáticas já identificadas: ${r.obs.join(" | ")}. Explique os pontos mais relevantes, as possíveis causas e o que acompanhar nos próximos meses, em até 250 palavras.`;
  const resumos = {
    dre: UI.resumo($("rs-dre"), { gerar: () => PB.analise.dre(dados, meses), perguntaIA: perguntaIA("DRE"), clienteId: () => clienteId }),
    dfc: UI.resumo($("rs-dfc"), { gerar: () => PB.analise.dfc(dados, meses), perguntaIA: perguntaIA("DFC (fluxo de caixa por atividade)"), clienteId: () => clienteId }),
    fluxo: UI.resumo($("rs-fluxo"), { gerar: () => PB.analise.fluxo(dados, horizonteFluxo()), perguntaIA: perguntaIA("Fluxo de Caixa (realizado e previsto)"), clienteId: () => clienteId }),
    proj: UI.resumo($("rs-proj"), { gerar: () => PB.analise.projecoes(dados, meses, $("sel-cenario").value, simulacao), perguntaIA: perguntaIA("Projeções"), clienteId: () => clienteId }),
    com: UI.resumo($("rs-com"), { gerar: () => PB.analise.comercial(dados, meses), perguntaIA: perguntaIA("Comercial (vendas, clientes e produtos)"), clienteId: () => clienteId })
  };

  async function carregar() {
    $("erro").innerHTML = "";
    try {
      dados = await PB.api.get(`/dados?cliente=${encodeURIComponent(clienteId)}`);
      if (!dados) throw new Error("Ainda não há dados publicados para esta empresa.");
    } catch (e) {
      $("erro").innerHTML = `<div class="alert alert-error">${PB.esc(e.message)}</div>`; return;
    }
    $("empresa-nome").textContent = dados.cliente.nome + " · " + (dados.cliente.cnpj || "");
    $("atualizado").textContent = "Atualizado em " + new Date(dados.atualizadoEm).toLocaleDateString("pt-BR");
    const abertos = PB.mesesDisponiveis(dados).filter((m) => PB.statusFechamento(dados, m) !== "Fechado").slice(-3);
    $("atualizado").title = abertos.length ? "Meses ainda não fechados (prévia): " + abertos.map(f.mes).join(", ") : "Todos os meses fechados";
    if (abertos.length) $("atualizado").textContent += ` · ${abertos.map(f.mes).join(", ")} em prévia`;
    simulacaoCarregar();
    definirPeriodo(); render();
  }

  function definirPeriodo() {
    const todos = PB.mesesDisponiveis(dados);
    const p = $("sel-periodo").value;
    meses = p === "ano" ? todos.filter((m) => m.startsWith(todos.at(-1).slice(0, 4))) : todos.slice(-Number(p));
  }
  $("sel-periodo").addEventListener("change", () => { definirPeriodo(); render(); });

  UI.navegacao((view) => { if (view) abaAtual = view; if (dados) render(); });

  function render() {
    if (!dados) return;
    if (abaAtual === "geral") renderGeral();
    if (abaAtual === "financeiro") { renderDRE(); renderDFC(); renderFluxo(); renderProj(); resumos.dre.atualizar(); resumos.dfc.atualizar(); resumos.fluxo.atualizar(); resumos.proj.atualizar(); }
    if (abaAtual === "comercial") { renderComercial(); resumos.com.atualizar(); }
    if (abaAtual === "documentos") UI.documentos($("docs"), clienteId);
  }

  /* ---------- Visão geral ---------- */
  const PALETA = UI.PALETA;
  const somaArr = (a) => PB.soma(a, (x) => x);
  // período anterior de mesmo tamanho (para variação dos KPIs)
  function periodoAnterior() {
    const todos = PB.mesesDisponiveis(dados), i = todos.indexOf(meses[0]);
    return i >= meses.length ? todos.slice(i - meses.length, i) : null;
  }
  function graficoComposicao(idPizza, idBarras, comp, limite = 6) {
    const top = comp.slice(0, limite), resto = comp.slice(limite);
    const series = resto.length ? [...top, { nome: "Outros", valores: meses.map((_, i) => PB.soma(resto, (c) => c.valores[i])), total: PB.soma(resto, (c) => c.total) }] : top;
    UI.grafico(idPizza, { type: "doughnut", data: { labels: series.map((s) => s.nome), datasets: [{ data: series.map((s) => s.total), backgroundColor: PALETA, borderColor: "#fff", borderWidth: 2 }] },
      options: { cutout: "62%", plugins: { legend: { position: "bottom", labels: { boxWidth: 8, usePointStyle: true, font: { family: "Poppins", size: 11 } } },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${f.moeda(c.parsed)} (${f.pct(c.parsed / PB.soma(series, (s) => s.total))})` } } } } });
    UI.grafico(idBarras, { type: "bar", data: { labels: meses.map(f.mes), datasets: series.map((s, k) => ({ label: s.nome, data: s.valores, backgroundColor: PALETA[k % PALETA.length], stack: "a", borderRadius: 1 })) },
      options: { plugins: { legend: { display: false } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: UI.compacto } } } } });
  }

  function renderGeral() {
    const dre = PB.calc.dre(dados, meses), t = dre.totais;
    const ant = periodoAnterior(), tA = ant ? PB.calc.dre(dados, ant).totais : null;
    const fat = somaArr(t.receitaBruta), lb = somaArr(t.lucroBruto), lo = somaArr(t.ebitda), ll = somaArr(t.liquido);
    const v = (atual, chave) => (tA ? (atual - somaArr(tA[chave])) / Math.abs(somaArr(tA[chave]) || 1) : null);
    const leg = ant ? "vs período anterior" : "";
    $("per-comp").textContent = `${f.mes(meses[0])} a ${f.mes(meses.at(-1))}`;
    $("kpis-comp").innerHTML =
      UI.kpiFin("Faturamento", fat, null, v(fat, "receitaBruta"), leg) +
      UI.kpiFin("Resultado Operacional Bruto (Margem de Contribuição)", lb, lb / fat, v(lb, "lucroBruto"), leg) +
      UI.kpiFin("Resultado Operacional Líquido (EBITDA)", lo, lo / fat, v(lo, "ebitda"), leg) +
      UI.kpiFin("Resultado Líquido", ll, ll / fat, v(ll, "liquido"), leg);
    UI.grafico("ch-geral-res", { type: "bar", data: { labels: meses.map(f.mes), datasets: [
      { label: "Faturamento (Receita Bruta)", data: t.receitaBruta, backgroundColor: C.teal, borderRadius: 3 },
      { label: "Resultado Operacional Líquido (EBITDA)", data: t.ebitda, type: "line", borderColor: C.navy, backgroundColor: C.navy, tension: .3 },
      { label: "Resultado Líquido", data: t.liquido, type: "line", borderColor: C.amber, backgroundColor: C.amber, tension: .3 }
    ] } });

    const desp = PB.calc.composicao(dados, meses, ["DV", "DF"]);
    const cus = PB.calc.composicao(dados, meses, ["CV"]);
    const totDesp = PB.soma(desp.porCategoria, (g) => g.total), totCus = PB.soma(cus.porCategoria, (g) => g.total);
    $("tot-desp").textContent = `${f.moeda(totDesp)} · ${f.pct(totDesp / fat)} do faturamento (Despesas Variáveis e Despesas Fixas)`;
    $("tot-cus").textContent = `${f.moeda(totCus)} · ${f.pct(totCus / fat)} do faturamento (Custos Variáveis)`;
    graficoComposicao("ch-desp-pizza", "ch-desp-barras", desp.porCategoria, 7);
    graficoComposicao("ch-cus-pizza", "ch-cus-barras", cus.porCategoria, 6);

    // Caixa
    const fl = PB.calc.fluxo(dados, horizonteFluxo());
    const real = fl.linhas.filter((l) => !l.previsto), prev = fl.linhas.filter((l) => l.previsto);
    const cl = PB.calc.caixaLivre(dados, meses);
    const fclTot = somaArr(cl.fcl), queima = cl.fcl.filter((x) => x < 0).length;
    $("per-caixa").textContent = `realizado até ${real.length ? f.mes(real.at(-1).mes) : "—"}${prev.length ? " · previsto até " + f.mes(prev.at(-1).mes) : ""}`;
    const card = (titulo, valor, legenda) => `<div class="kpi-card"><span>${titulo}</span><b class="${valor < 0 ? "down" : ""}">${f.moeda(valor)}</b><small class="muted">${legenda}</small></div>`;
    $("kpis-caixa").innerHTML =
      card("Saldo de caixa realizado", real.at(-1)?.saldoFinal || 0, real.length ? "em " + f.mes(real.at(-1).mes) : "") +
      card("Saldo de caixa previsto", (prev.at(-1) || real.at(-1))?.saldoFinal || 0, prev.length ? "em " + f.mes(prev.at(-1).mes) : "sem lançamentos previstos") +
      card(fclTot >= 0 ? "Geração de caixa livre" : "Queima de caixa livre", fclTot, "no período selecionado") +
      card("Média mensal de caixa livre", fclTot / meses.length, queima ? `${queima} mês(es) com queima` : "sem meses de queima");
    const idxUlt = real.length - 1;
    UI.grafico("ch-geral-caixa", { type: "line", data: { labels: fl.linhas.map((l) => f.mes(l.mes)), datasets: [
      { label: "Realizado", data: fl.linhas.map((l, i) => (i <= idxUlt ? l.saldoFinal : null)), borderColor: C.teal, backgroundColor: C.tealLight, fill: true, tension: .3 },
      { label: "Previsto", data: fl.linhas.map((l, i) => (i >= idxUlt ? l.saldoFinal : null)), borderColor: C.sky, borderDash: [6, 4], tension: .3, pointBackgroundColor: "#fff" }
    ] } });
    UI.grafico("ch-geral-fcl", { type: "bar", data: { labels: meses.map(f.mes), datasets: [
      { label: "Caixa livre do mês", data: cl.fcl, backgroundColor: cl.fcl.map((x) => (x >= 0 ? C.green : C.red)), borderRadius: 3 },
      { label: "Acumulado", data: cl.acumulado, type: "line", borderColor: C.navy, backgroundColor: C.navy, tension: .3 }
    ] } });
  }

  function horizonteFluxo() {
    const ultimoPrev = dados.lancamentos.reduce((m, l) => (l.data.slice(0, 7) > m ? l.data.slice(0, 7) : m), meses.at(-1));
    return PB.mesesEntre(meses[0], ultimoPrev);
  }

  /* ---------- DRE ---------- */
  function renderDRE() {
    const dre = PB.calc.dre(dados, meses), t = dre.totais;
    const det = $("dre-detalhe").checked;
    const linhas = det ? dre.linhas : dre.linhas.filter((l) => l.tipo !== "conta");
    UI.tabelaDemonstrativo($("tb-dre"), meses, linhas, { av: t.receitaBruta, titulo: "Estrutura da DRE" });
    const s = (a) => PB.soma(a, (x) => x);
    $("kpis-dre").innerHTML =
      UI.kpi("Receita Bruta no período", f.moeda(s(t.receitaBruta))) +
      UI.kpi("Margem de Contribuição", f.pct(s(t.margemContribuicao) / s(t.receitaBruta))) +
      UI.kpi("Margem EBITDA", f.pct(s(t.ebitda) / s(t.receitaBruta))) +
      UI.kpi("Resultado Líquido no período", f.moeda(s(t.liquido)));
    document.getElementById("aviso-nc")?.remove();
    if (dre.naoClassificadas.length) $("kpis-dre").insertAdjacentHTML("afterend", `<div class="alert alert-warn" id="aviso-nc">Contas sem classificação no plano de contas (alocadas provisoriamente): ${dre.naoClassificadas.map(PB.esc).join(", ")}</div>`);
    const pct = (v) => f.pct(v);
    UI.grafico("ch-margens", { type: "line", _fmt: pct, data: { labels: meses.map(f.mes), datasets: [
      { label: "Margem de Contribuição", data: dre.margem(t.margemContribuicao), borderColor: C.teal, tension: .3 },
      { label: "Margem EBITDA", data: dre.margem(t.ebitda), borderColor: C.navy, tension: .3 },
      { label: "Margem Líquida", data: dre.margem(t.liquido), borderColor: C.amber, tension: .3 }
    ] } });
    $("exp-dre").onclick = () => UI.exportarExcel(`DRE - ${dados.cliente.nome}.xlsx`, [{ nome: "DRE", linhas: UI.demonstrativoParaAoa(meses, dre.linhas) }]);
  }
  $("dre-detalhe").addEventListener("change", () => { document.getElementById("aviso-nc")?.remove(); renderDRE(); });
  $("dfc-detalhe").addEventListener("change", () => renderDFC());

  /* ---------- DFC ---------- */
  function renderDFC() {
    const d = PB.calc.dfc(dados, meses);
    UI.tabelaDemonstrativo($("tb-dfc"), meses, $("dfc-detalhe").checked ? d.linhas : d.linhas.filter((l) => l.tipo !== "conta"), { titulo: "Estrutura do DFC" });
    UI.grafico("ch-dfc", { type: "bar", data: { labels: meses.map(f.mes), datasets: [
      { label: "Fluxo de Caixa Operacional", data: d.totais.OPE, backgroundColor: C.teal, borderRadius: 2, stack: "a" },
      { label: "Fluxo de Caixa de Investimentos", data: d.totais.INV, backgroundColor: C.amber, borderRadius: 2, stack: "a" },
      { label: "Fluxo de Caixa de Financiamentos", data: d.totais.FIN, backgroundColor: C.navy, borderRadius: 2, stack: "a" },
      { label: "Variação de caixa", data: d.variacao, type: "line", borderColor: C.red, backgroundColor: C.red, tension: .3 }
    ] }, options: { scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: UI.compacto } } } } });
    $("exp-dfc").onclick = () => UI.exportarExcel(`DFC - ${dados.cliente.nome}.xlsx`, [{ nome: "DFC", linhas: UI.demonstrativoParaAoa(meses, d.linhas) }]);
  }

  /* ---------- Fluxo de caixa ---------- */
  function renderFluxo() {
    const fl = PB.calc.fluxo(dados, horizonteFluxo());
    const L = fl.linhas, prev = L.filter((l) => l.previsto), real = L.filter((l) => !l.previsto);
    const menor = prev.reduce((m, l) => (l.saldoFinal < m.saldoFinal ? l : m), prev[0] || L.at(-1));
    $("kpis-fluxo").innerHTML =
      UI.kpi("Saldo atual", f.moeda(real.at(-1)?.saldoFinal), null, real.length ? f.mes(real.at(-1).mes) : "") +
      UI.kpi("Entradas no período realizado", f.moeda(PB.soma(real, (l) => l.entradas))) +
      UI.kpi("Saídas no período realizado", f.moeda(PB.soma(real, (l) => l.saidas))) +
      UI.kpi("Menor saldo previsto", f.moeda(menor?.saldoFinal), null, menor ? "em " + f.mes(menor.mes) : "");
    UI.grafico("ch-fluxo", { type: "bar", data: { labels: L.map((l) => f.mes(l.mes)), datasets: [
      { label: "Entradas", data: L.map((l) => l.entradas), backgroundColor: L.map((l) => (l.previsto ? C.tealLight : C.teal)), borderRadius: 2 },
      { label: "Saídas", data: L.map((l) => -l.saidas), backgroundColor: L.map((l) => (l.previsto ? C.redLight : C.red)), borderRadius: 2 },
      { label: "Saldo final", data: L.map((l) => l.saldoFinal), type: "line", borderColor: C.navy, backgroundColor: C.navy, tension: .3 }
    ] } });
    UI.tabelaSimples($("tb-fluxo"), [
      { campo: "mes", titulo: "Mês", fmt: (v, l) => f.mes(v) + (l.previsto ? ' <span class="badge badge-warn">previsto</span>' : "") },
      { campo: "saldoInicial", titulo: "Saldo inicial", fmt: f.moeda }, { campo: "entradas", titulo: "Entradas", fmt: f.moeda },
      { campo: "saidas", titulo: "Saídas", fmt: f.moeda }, { campo: "liquido", titulo: "Resultado de caixa", fmt: (v) => `<span class="${v < 0 ? "down" : ""}">${f.moeda(v)}</span>` },
      { campo: "saldoFinal", titulo: "Saldo final", fmt: (v) => `<b class="${v < 0 ? "down" : ""}">${f.moeda(v)}</b>` }
    ], L);
    $("exp-fluxo").onclick = () => UI.exportarExcel(`Fluxo de Caixa - ${dados.cliente.nome}.xlsx`, [{ nome: "Fluxo", linhas: [["Mês", "Situação", "Saldo inicial", "Entradas", "Saídas", "Saldo final"], ...L.map((l) => [l.mes, l.previsto ? "Previsto" : "Realizado", l.saldoInicial, l.entradas, l.saidas, l.saldoFinal].map((v) => (typeof v === "number" ? Math.round(v) : v)))] }]);
  }

  /* ---------- Projeções ---------- */
  function renderProj() {
    const cen = $("sel-cenario").value;
    const pj = dados.projecoes.filter((p) => p.cenario === cen);
    const dre = PB.calc.dre(dados, meses.slice(-6));
    const labels = [...dre.meses, ...pj.map((p) => p.mes)].map(f.mes);
    const realRec = dre.totais.receitaBruta, realRes = dre.totais.liquido;
    const pad = (arr, n, antes) => (antes ? [...Array(n).fill(null), ...arr] : [...arr, ...Array(n).fill(null)]);
    const resProj = pj.map((p) => p.receita - (p.custos || 0) - (p.despesas || 0));
    UI.grafico("ch-proj", { type: "bar", data: { labels, datasets: [
      { label: "Receita realizada", data: pad(realRec, pj.length), backgroundColor: C.teal, borderRadius: 2 },
      { label: `Receita projetada (${cen})`, data: pad(pj.map((p) => p.receita), realRec.length, true), backgroundColor: C.tealLight, borderRadius: 2 },
      { label: "Resultado", data: [...realRes, ...resProj], type: "line", borderColor: C.amber, backgroundColor: C.amber, tension: .3,
        segment: { borderDash: (ctx) => (ctx.p1DataIndex >= realRes.length ? [6, 4] : undefined) } }
    ] } });
    UI.tabelaSimples($("tb-proj"), [
      { campo: "mes", titulo: "Mês", fmt: f.mes }, { campo: "receita", titulo: "Receita", fmt: f.moeda }, { campo: "custos", titulo: "Custos", fmt: f.moeda },
      { campo: "despesas", titulo: "Despesas", fmt: f.moeda }, { campo: "resultado", titulo: "Resultado", fmt: (v) => `<b class="${v < 0 ? "down" : ""}">${f.moeda(v)}</b>` },
      { campo: "investimentos", titulo: "Investimentos", fmt: f.moeda }, { campo: "observacao", titulo: "Observação" }
    ], pj.map((p, i) => ({ ...p, resultado: resProj[i] })));
    renderSimulacao();
  }
  $("sel-cenario").addEventListener("change", () => { renderProj(); resumos.proj.atualizar(); });

  /* ---------- Simulador de premissas (conversa com a IA) ---------- */
  let premissas = PB.projecao.padrao(), simulacao = null;
  const chaveSim = () => "pb_premissas_" + clienteId;
  function simulacaoCarregar() {
    try { premissas = JSON.parse(localStorage.getItem(chaveSim())) || PB.projecao.padrao(); } catch { premissas = PB.projecao.padrao(); }
    simLog.innerHTML = ""; simMsg("Descreva como quer ajustar as premissas. Por exemplo: \"use média móvel de 3 meses\", \"considere a perda do cliente X a partir de jan/27\", \"crescimento de 1,5% ao mês\" ou \"custos de 40% da receita\".", "bot");
  }
  function simulacaoSalvar() { try { localStorage.setItem(chaveSim(), JSON.stringify(premissas)); } catch { } }
  const simRaiz = $("sim-chat");
  simRaiz.innerHTML = `<div class="chat"><div class="chat-log" aria-live="polite"></div>
    <form class="chat-form"><textarea placeholder="Ex.: considere a perda do cliente Grupo Andes a partir de fev/27" required></textarea><button class="btn btn-primary" type="submit">Aplicar</button></form></div>`;
  const simLog = simRaiz.querySelector(".chat-log"), simForm = simRaiz.querySelector("form"), simTa = simForm.querySelector("textarea");
  const simHist = [];
  function simMsg(txt, quem, extra = "") { const d = document.createElement("div"); d.className = `msg ${quem} ${extra}`; d.textContent = txt; simLog.appendChild(d); simLog.scrollTop = simLog.scrollHeight; return d; }
  simForm.addEventListener("submit", async (e) => {
    e.preventDefault(); const msg = simTa.value.trim(); if (!msg) return; simTa.value = "";
    simMsg(msg, "user"); const esp = simMsg("Ajustando premissas…", "bot", "loading");
    try {
      // sem IA no servidor, usa a interpretação local dos comandos mais comuns
      const r = document.body.classList.contains("sem-ia")
        ? PB.projecao.interpretarLocal(msg, premissas, dados)
        : await PB.api.post("/premissas", { clienteId, mensagem: msg, premissas, historico: simHist.slice(-8) });
      premissas = { ...PB.projecao.padrao(), ...r.premissas };
      esp.classList.remove("loading"); esp.textContent = r.resposta;
      simHist.push({ role: "user", content: msg }, { role: "assistant", content: r.resposta });
      simulacaoSalvar(); renderSimulacao(); resumos.proj.atualizar();
    } catch (err) { esp.classList.remove("loading"); esp.textContent = "Não foi possível ajustar: " + err.message; }
  });
  simTa.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); simForm.requestSubmit(); } });
  $("sim-reset").addEventListener("click", () => { premissas = PB.projecao.padrao(); simulacaoSalvar(); simMsg("Premissas restauradas para o padrão.", "bot"); renderSimulacao(); });
  if (usuario.papel === "consultor") $("sim-publicar").classList.remove("hidden");
  $("sim-publicar").addEventListener("click", async () => {
    if (!simulacao || !confirm("Substituir o cenário Base publicado por esta simulação?")) return;
    const novos = simulacao.linhas.map((l) => ({ mes: l.mes, cenario: "Base", receita: Math.round(l.receita), custos: Math.round(l.custos + l.deducoes + l.despVariaveis), despesas: Math.round(l.despesas), investimentos: 0, observacao: "Simulação: " + simulacao.descricao.slice(0, 2).join("; ") }));
    const novo = { ...dados, projecoes: [...dados.projecoes.filter((p) => p.cenario !== "Base"), ...novos], atualizadoEm: new Date().toISOString().slice(0, 19) };
    try { await PB.api.post("/dados", { clienteId, dados: novo }); dados = novo; renderProj(); alert("Cenário Base atualizado e publicado."); } catch (err) { alert("Erro: " + err.message); }
  });

  function renderSimulacao() {
    simulacao = PB.projecao.calcular(dados, premissas);
    $("sim-premissas").innerHTML = simulacao.descricao.map((d) => `<li>${PB.esc(d)}</li>`).join("");
    const hist = simulacao.base.hist.slice(-6), dreH = PB.calc.dre(dados, hist);
    const base = dados.projecoes.filter((p) => p.cenario === "Base");
    const labels = [...hist, ...simulacao.linhas.map((l) => l.mes)].map(f.mes);
    const nH = hist.length, vazio = Array(nH).fill(null);
    UI.grafico("ch-sim", { type: "bar", data: { labels, datasets: [
      { label: "Faturamento realizado", data: [...dreH.totais.receitaBruta, ...simulacao.linhas.map(() => null)], backgroundColor: C.teal, borderRadius: 2 },
      { label: "Faturamento simulado", data: [...vazio, ...simulacao.linhas.map((l) => l.receita)], backgroundColor: C.sky, borderRadius: 2 },
      { label: "Projeção publicada (Base)", data: [...vazio, ...simulacao.linhas.map((l) => (base.find((p) => p.mes === l.mes) || {}).receita ?? null)], type: "line", borderColor: C.navy, borderDash: [6, 4], tension: .3 },
      { label: "Resultado líquido simulado", data: [...dreH.totais.liquido, ...simulacao.linhas.map((l) => l.liquido)], type: "line", borderColor: C.amber, backgroundColor: C.amber, tension: .3 }
    ] } });
    UI.tabelaSimples($("tb-sim"), [
      { campo: "mes", titulo: "Mês", fmt: f.mes }, { campo: "receita", titulo: "Receita Bruta", fmt: f.moeda }, { campo: "deducoes", titulo: "Deduções da Receita Bruta", fmt: f.moeda },
      { campo: "custos", titulo: "Custos Variáveis", fmt: f.moeda }, { campo: "despVariaveis", titulo: "Despesas Variáveis", fmt: f.moeda },
      { campo: "lucroBruto", titulo: "Margem de Contribuição", fmt: f.moeda }, { campo: "despesas", titulo: "Despesas Fixas", fmt: f.moeda },
      { campo: "operacional", titulo: "EBITDA", fmt: f.moeda }, { campo: "liquido", titulo: "Resultado Líquido", fmt: (v) => `<b class="${v < 0 ? "down" : ""}">${f.moeda(v)}</b>` }
    ], simulacao.linhas);
  }

  /* ---------- Comercial ---------- */
  function renderComercial() {
    const c = PB.calc.comercial(dados, meses);
    $("kpis-com").innerHTML =
      UI.kpi("Faturamento no período", f.moeda(c.total)) +
      UI.kpi("Pedidos / vendas", f.num(c.totalPedidos)) +
      UI.kpi("Ticket médio", f.moeda(c.totalPedidos ? c.total / c.totalPedidos : 0)) +
      UI.kpi("Clientes atendidos", f.num(c.totalClientes));
    UI.grafico("ch-vol", { type: "bar", data: { labels: meses.map(f.mes), datasets: [
      { label: "Faturamento", data: c.faturamento, backgroundColor: C.teal, borderRadius: 3, yAxisID: "y" },
      { label: "Pedidos", data: c.pedidos, type: "line", borderColor: C.navy, backgroundColor: C.navy, yAxisID: "y1", tension: .3 }
    ] }, options: { scales: { x: { grid: { display: false } }, y: { ticks: { callback: UI.compacto } }, y1: { position: "right", grid: { display: false } } },
      plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${x.dataset.yAxisID === "y1" ? x.parsed.y : f.moeda(x.parsed.y)}` } } } } });
    const ind = [
      { nome: "Faturamento", valores: c.faturamento, fmt: f.moeda }, { nome: "Nº de pedidos", valores: c.pedidos, fmt: f.num },
      { nome: "Ticket médio", valores: c.ticket, fmt: f.moeda }, { nome: "Clientes ativos", valores: c.clientesAtivos, fmt: f.num },
      { nome: "Novos clientes", valores: c.novosClientes, fmt: f.num }
    ];
    $("tb-vol").innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>Indicador</th>${meses.map((m) => `<th>${f.mes(m)}</th>`).join("")}</tr></thead><tbody>${
      ind.map((i) => `<tr><td>${i.nome}</td>${i.valores.map((v) => `<td>${i.fmt(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    $("exp-com").onclick = () => UI.exportarExcel(`Comercial - ${dados.cliente.nome}.xlsx`, [
      { nome: "Indicadores", linhas: [["Indicador", ...meses], ...ind.map((i) => [i.nome, ...i.valores.map(Math.round)])] },
      { nome: "Clientes", linhas: [["Cliente", "Faturamento", "Pedidos"], ...c.porCliente.map((x) => [x.nome, Math.round(x.valor), x.vendas])] },
      { nome: "Produtos e Serviços", linhas: [["Item", "Faturamento", "Quantidade"], ...c.porItem.map((x) => [x.nome, Math.round(x.valor), x.qtd])] }
    ]);

    // Curva ABC
    let acum = 0;
    const abc = c.porCliente.map((x) => { acum += x.valor; const p = acum / c.total; return { ...x, part: x.valor / c.total, acum: p, classe: p <= 0.8 ? "A" : p <= 0.95 ? "B" : "C" }; });
    const badge = (v) => `<span class="badge ${v === "A" ? "badge-ok" : v === "B" ? "badge-warn" : "badge-info"}">${v}</span>`;
    UI.tabelaSimples($("tb-cli"), [
      { campo: "nome", titulo: "Cliente" }, { campo: "valor", titulo: "Faturamento", fmt: f.moeda }, { campo: "vendas", titulo: "Pedidos", fmt: f.num },
      { campo: "part", titulo: "Part.", fmt: f.pct }, { campo: "acum", titulo: "Acum.", fmt: f.pct }, { campo: "classe", titulo: "ABC", fmt: badge }
    ], abc);
    UI.grafico("ch-cli", { type: "bar", _fmt: f.num, data: { labels: meses.map(f.mes), datasets: [
      { label: "Clientes ativos", data: c.clientesAtivos, backgroundColor: C.teal, borderRadius: 2 },
      { label: "Novos clientes", data: c.novosClientes, backgroundColor: C.sky, borderRadius: 2 }
    ] } });

    UI.tabelaSimples($("tb-prod"), [
      { campo: "nome", titulo: "Produto/Serviço" }, { campo: "tipo", titulo: "Tipo" }, { campo: "qtd", titulo: "Qtd.", fmt: f.num },
      { campo: "valor", titulo: "Faturamento", fmt: f.moeda }, { campo: "part", titulo: "Part.", fmt: f.pct }
    ], c.porItem.map((x) => ({ ...x, tipo: (dados.vendas.find((v) => v.item === x.nome) || {}).tipoItem, part: x.valor / c.total })));
    UI.grafico("ch-cat", { type: "doughnut", data: { labels: c.porCategoria.map((x) => x.nome), datasets: [{ data: c.porCategoria.map((x) => x.valor), backgroundColor: PALETA, borderColor: "#fff", borderWidth: 2 }] }, options: { cutout: "62%" } });

    const cols = (t) => [{ campo: "nome", titulo: t }, { campo: "valor", titulo: "Faturamento", fmt: f.moeda }, { campo: "vendas", titulo: "Pedidos", fmt: f.num }, { campo: "ticket", titulo: "Ticket médio", fmt: f.moeda }];
    const tk = (arr) => arr.map((x) => ({ ...x, ticket: x.vendas ? x.valor / x.vendas : 0 }));
    UI.tabelaSimples($("tb-vend"), cols("Vendedor"), tk(c.porVendedor));
    const vs = dados.vendas.filter((v) => meses.includes(v.data.slice(0, 7)));
    const reg = {}; vs.forEach((v) => { const k = v.regiao || "(não informado)"; reg[k] = reg[k] || { nome: k, valor: 0, s: new Set() }; reg[k].valor += v.valorTotal; reg[k].s.add(v.numero); });
    UI.tabelaSimples($("tb-reg"), cols("Região"), tk(Object.values(reg).map((r) => ({ nome: r.nome, valor: r.valor, vendas: r.s.size })).sort((a, b) => b.valor - a.valor)));
  }

  carregar();
})();
