/* =========================================================
   Área do Consultor / BPO Financeiro
   ========================================================= */
(async function () {
  const PB = window.PB, UI = PB.ui, IMP = PB.importacao, f = PB.fmt;
  const usuario = await PB.auth.exigir("consultor");
  if (!usuario) return;
  if (usuario.papel !== "consultor") { location.replace("../cliente/index.html"); return; }
  UI.usuarioRodape(usuario);

  const $ = (id) => document.getElementById(id);
  const log = (msg) => { const el = $("log"); el.textContent = (el.textContent === "Aguardando arquivo…" ? "" : el.textContent + "\n") + `[${new Date().toLocaleTimeString("pt-BR")}] ${msg}`; el.scrollTop = el.scrollHeight; };
  let clientes = [], clienteId = null, base = null, pendente = null, arquivoAtual = null, periodoCA = null;

  async function carregarClientes() {
    clientes = await PB.api.get("/clientes");
    const sel = $("sel-cliente");
    sel.innerHTML = clientes.map((c) => `<option value="${c.id}">${PB.esc(c.nome)}</option>`).join("");
    clienteId = clienteId || clientes[0]?.id; sel.value = clienteId;
    renderClientes();
  }
  $("sel-cliente").addEventListener("change", async (e) => { clienteId = e.target.value; await carregarBase(); renderClientes(); refrescar(); });

  async function carregarBase() {
    try { base = await PB.api.get(`/dados?cliente=${encodeURIComponent(clienteId)}`); } catch { base = null; }
    if (!base) {
      const c = clientes.find((x) => x.id === clienteId);
      base = { versaoModelo: PB.MODELO.versao, cliente: { id: c.id, nome: c.nome, cnpj: c.cnpj, origem: c.origem }, atualizadoEm: null, planoContas: [], contas: [], lancamentos: [], vendas: [], projecoes: [] };
    }
    const origem = { contaazul: "Conta Azul", planilha: "Planilha padrão", outro: "Outro ERP" }[base.cliente.origem] || base.cliente.origem;
    $("origem-badge").textContent = "Origem do cliente: " + origem;
    $("imp-origem").value = "ca-auto";
    $("imp-origem").dispatchEvent(new Event("change"));
  }

  let viewAtual = "clientes";
  UI.navegacao((v) => {
    if (v) viewAtual = v;
    // a gestão da equipe não depende de cliente: esconde o seletor "Cliente em edição"
    $("filtro-cliente").classList.toggle("hidden", viewAtual === "equipe");
    refrescar();
  });
  function refrescar() {
    if (!base) return;
    if (viewAtual === "clientes") renderFicha();
    if (viewAtual === "equipe") renderEquipe();
    if (viewAtual === "importar") renderContaAzul();
    if (viewAtual === "plano") renderPlano();
    if (viewAtual === "modelos") renderDicionario();
    if (viewAtual === "sharepoint") UI.documentos($("docs"), clienteId);
    if (viewAtual === "relatorios") renderRelatorios();
    if (viewAtual === "conferencia") renderConferencia();
  }

  /* ---------- Relatórios do cliente: o mesmo painel do cliente, embutido ---------- */
  function renderRelatorios() {
    const fr = $("frame-cliente"), url = `../cliente/index.html?cliente=${encodeURIComponent(clienteId)}&embed=1#geral`;
    if (fr.dataset.cliente !== clienteId) { fr.dataset.cliente = clienteId; fr.src = url; }
  }
  const abrirRelatorios = (id) => { if (id) { clienteId = id; $("sel-cliente").value = id; } document.querySelector('.side-link[data-view="relatorios"]').click(); };

  /* ---------- Conferência da DRE com o Conta Azul ---------- */
  const estruturas = {}; // por cliente: { linhas } ou { erro }
  let estruturaCA = null, mapaCA = new Map(), confSeletor = null;
  const nomeSemCodigo = (s) => String(s || "").replace(/^\s*\d[\d.]*\s*[-–]\s*/, "");
  const codigoDe = (s) => (/^\s*(\d[\d.]*)\s*[-–]/.exec(String(s || "")) || [])[1] || "";
  async function carregarEstruturaCA(forcar) {
    if (!forcar && estruturas[clienteId]) estruturaCA = estruturas[clienteId];
    else if (PB.isDemo()) estruturaCA = estruturas[clienteId] = { erro: "Modo demonstração: a estrutura da DRE do Conta Azul vem da integração." };
    else if (base.cliente.origem !== "contaazul") estruturaCA = estruturas[clienteId] = { erro: "Cliente sem Conta Azul: a conferência usa a sugestão pelo nome das categorias." };
    else {
      try { estruturaCA = estruturas[clienteId] = await PB.api.get(`/contaazul/dre?cliente=${encodeURIComponent(clienteId)}`); }
      catch (e) { estruturaCA = estruturas[clienteId] = { erro: "Não foi possível ler a DRE do Conta Azul (" + e.message.slice(0, 140) + "). Conecte o cliente em Importar e publicar → Integração Conta Azul." }; }
    }
    mapaCA = new Map();
    (estruturaCA.linhas || []).forEach((li) => li.categorias.forEach((c) => { if (c.nome) mapaCA.set("n:" + PB.E.norm(nomeSemCodigo(c.nome)), li); if (c.codigo) mapaCA.set("c:" + c.codigo, li); }));
  }
  const linhaCAObj = (cat) => mapaCA.get("n:" + PB.E.norm(nomeSemCodigo(cat))) || (codigoDe(cat) && mapaCA.get("c:" + codigoDe(cat))) || null;
  const linhaCA = (cat) => (linhaCAObj(cat) || {}).descricao || "";
  const grupoDRE = (nomeLinha) => { const n = PB.E.DRE.find((x) => x.nome === nomeLinha); return n ? (n.tipo === "linha" ? n.pai : n.id) : null; };

  async function renderConferencia(forcar) {
    if (!confSeletor) confSeletor = UI.seletorPeriodo($("conf-periodo"), { chave: "pb_conf_periodo", aoMudar: () => renderConferencia() });
    confSeletor.atualizar(PB.mesesDisponiveis(base));
    const meses = confSeletor.meses();
    $("conf-status").innerHTML = `<p class="muted">Carregando a estrutura da DRE do Conta Azul…</p>`;
    await carregarEstruturaCA(forcar === true);
    const temCA = !!(estruturaCA.linhas && estruturaCA.linhas.length);
    const L = base.lancamentos.filter((l) => PB.naDRE(l) && meses.includes(l.competencia));
    const semVisao = L.filter((l) => !l.visao).length;
    // valores por categoria (receita +, despesa −)
    const cats = new Map();
    L.forEach((l) => { const c = cats.get(l.categoria) || { cat: l.categoria, valor: 0, rec: 0, desp: 0 }; const v = l.tipo === "Receita" ? l.valor : -l.valor; c.valor += v; if (v >= 0) c.rec += v; else c.desp -= v; cats.set(l.categoria, c); });
    const lista = [...cats.values()].map((c) => {
      const tipo = c.rec >= c.desp ? "Receita" : "Despesa", li = linhaCAObj(c.cat), conta = PB.contaDe(base, c.cat);
      const sug = PB.sugestaoDRE(li ? li.descricao : "", c.cat, tipo);
      const atual = conta ? conta.refDRE || "" : "";
      return { ...c, tipo, li, conta, atual, sug, sugDFC: conta && conta.refDFC && atual === sug ? conta.refDFC : PB.sugestaoDFC(sug, tipo), ok: atual && atual === sug };
    }).sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
    const st = [];
    st.push(temCA ? `<div class="alert alert-info">Estrutura da DRE do Conta Azul carregada: ${estruturaCA.linhas.length} linhas. Período: ${meses.length ? (meses.length === 1 ? f.mes(meses[0]) : f.mes(meses[0]) + " a " + f.mes(meses.at(-1))) : "—"}.</div>` : `<div class="alert alert-warn">${PB.esc(estruturaCA.erro || "Estrutura do Conta Azul indisponível.")}</div>`);
    if (semVisao) st.push(`<div class="alert alert-warn">${semVisao} lançamento(s) do período vieram de importações antigas (sem visão de competência). Importe a <b>Visão Competência</b> do Conta Azul destes meses para a conferência ficar exata.</div>`);
    const divergentes = lista.filter((x) => !x.ok).length;
    st.push(`<p style="margin:8px 0 0"><span class="badge ${divergentes ? "badge-warn" : "badge-ok"}">${divergentes} categoria(s) divergentes ou sem classificação</span> <span class="badge badge-info">${lista.length} categoria(s) com valor no período</span></p>`);
    $("conf-status").innerHTML = st.join("");

    // DRE do portal e grupos comparáveis
    const dre = PB.calc.dre(base, meses), soma = (id) => PB.soma(dre.valor(id) || [], (x) => x);
    const grupoCA = {};
    lista.forEach((x) => { const g = grupoDRE(PB.sugestaoDRE(x.li ? x.li.descricao : "", x.cat, x.tipo)); grupoCA[g] = (grupoCA[g] || 0) + x.valor; });
    const gc = (...ids) => ids.reduce((s, id) => s + (grupoCA[id] || 0), 0);
    const totalCA = PB.soma(lista.filter((x) => !temCA || x.li), (x) => x.valor);
    const linhasResumo = [
      ["Faturamento (Receita Bruta)", gc("RB"), soma("RB")],
      ["(−) Deduções da Receita Bruta", gc("DED"), soma("DED")],
      ["(=) Receita Líquida", gc("RB", "DED"), soma("RL")],
      ["(−) Custos Variáveis", gc("CV"), soma("CV")],
      ["(−) Despesas Variáveis e Fixas", gc("DV", "DF", "EBITDA"), soma("DV") + soma("DF") + PB.soma(dre.valor("EBITDA:Depreciação e Amortização") || [], (x) => x)],
      ["(+/−) Resultado Não Operacional", gc("RNO"), soma("RNO")],
      ["(+/−) Resultado Financeiro", gc("RF"), soma("RF")],
      ["(−) Impostos sobre o lucro e participações", gc("RAIR"), soma("RLIQ") - soma("RAIR")],
      [temCA ? "(=) Resultado (todas as categorias da DRE do Conta Azul)" : "(=) Resultado (todas as categorias)", totalCA, soma("RLIQ")]
    ];
    $("conf-resumo").innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th style="text-align:left">Linha</th><th>${temCA ? "Conta Azul" : "Pela categoria"}</th><th>Portal</th><th>Diferença</th><th></th></tr></thead><tbody>${
      linhasResumo.map(([n, a, b]) => { const d = Math.round((b - a) * 100) / 100; return `<tr><td style="text-align:left">${n}</td><td>${f.moeda(a)}</td><td>${f.moeda(b)}</td><td class="${Math.abs(d) >= 0.01 ? "neg" : ""}">${f.moeda(d)}</td><td>${Math.abs(d) < 0.01 ? '<span class="badge badge-ok">confere</span>' : '<span class="badge badge-warn">diferente</span>'}</td></tr>`; }).join("")
    }</tbody></table></div><p class="muted" style="font-size:12px;margin-top:8px">Distribuição de lucros e categorias marcadas como “Não compõe a DRE” ficam fora do resultado do portal.</p>`;

    // DRE do Conta Azul reproduzida
    if (temCA) {
      const porLinha = new Map(); lista.forEach((x) => { if (x.li) porLinha.set(x.li.id, (porLinha.get(x.li.id) || 0) + x.valor); });
      const filhos = (id) => estruturaCA.linhas.filter((y) => y.pai === id);
      const valorDe = (li) => (porLinha.get(li.id) || 0) + filhos(li.id).reduce((s, y) => s + valorDe(y), 0);
      let acumulado = 0;
      const rows = estruturaCA.linhas.map((li) => {
        let v;
        if (li.nivel === 0 && li.totalizador && !li.temFilhos) v = acumulado;
        else { v = valorDe(li); if (li.nivel === 0) acumulado += v; }
        const nota = li.custoMedio ? ' <span class="badge badge-warn" title="No Conta Azul esta linha usa o custo médio do estoque, que não vem das categorias financeiras">custo médio do estoque</span>' : "";
        return `<tr class="${li.totalizador ? "res" : li.temFilhos ? "grp" : ""}"><td style="text-align:left;padding-left:${12 + li.nivel * 18}px">${PB.esc((li.codigo ? li.codigo + " " : "") + li.descricao)}${nota}</td><td>${f.moeda(v)}</td></tr>`;
      });
      const fora = lista.filter((x) => !x.li);
      if (fora.length) rows.push(`<tr class="sgrp"><td style="text-align:left">Categorias sem linha na DRE do Conta Azul: ${fora.map((x) => PB.esc(x.cat)).join(", ")}</td><td>${f.moeda(PB.soma(fora, (x) => x.valor))}</td></tr>`);
      $("conf-dre-ca").innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th style="text-align:left">Linha da DRE do Conta Azul</th><th>Valor no período</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
    } else $("conf-dre-ca").innerHTML = `<p class="muted">Disponível para clientes conectados ao Conta Azul pela integração.</p>`;

    // categorias
    const filtro = $("conf-filtro").value;
    const vis = lista.filter((x) => !filtro || !x.ok);
    $("conf-categorias").innerHTML = vis.length ? `<div class="table-wrap"><table class="data left"><thead><tr><th>Categoria</th><th>Valor no período</th><th>Linha no Conta Azul</th><th>Classificação atual (DRE)</th><th>Classificação sugerida (DRE)</th><th>DFC</th></tr></thead><tbody>${
      vis.map((x) => `<tr data-cat="${PB.esc(x.cat)}" data-tipo="${x.tipo}"><td>${PB.esc(x.cat)}</td><td style="text-align:right">${f.moeda(x.valor)}</td><td>${x.li ? PB.esc(x.li.descricao) : '<span class="muted">—</span>'}</td>
        <td>${x.atual ? PB.esc(x.atual) : '<span class="badge badge-err">sem classificação</span>'} ${x.ok ? '<span class="badge badge-ok">ok</span>' : x.atual ? '<span class="badge badge-warn">diverge</span>' : ""}</td>
        <td><select class="d">${opcoesRef("DRE", x.sug)}</select></td><td><select class="f">${opcoesRef("DFC", x.sugDFC)}</select></td></tr>`).join("")
    }</tbody></table></div>` : `<div class="alert alert-info">Todas as categorias do período estão classificadas como na DRE do Conta Azul.</div>`;
  }
  $("conf-filtro").addEventListener("change", () => renderConferencia());
  $("conf-recarregar").addEventListener("click", () => renderConferencia(true));
  $("conf-aplicar").addEventListener("click", async () => {
    const trs = [...document.querySelectorAll("#conf-categorias tr[data-cat]")];
    if (!trs.length) return alert("Não há categorias para aplicar.");
    if (!confirm(`Aplicar a classificação de ${trs.length} categoria(s) ao plano de contas de ${base.cliente.nome} e republicar os relatórios?`)) return;
    const plano = base.planoContas = base.planoContas || [];
    let seq = plano.filter((c) => String(c.numero).startsWith("99.")).length, criadas = 0, alteradas = 0;
    trs.forEach((tr) => {
      const cat = tr.dataset.cat, d = tr.querySelector(".d").value, fx = tr.querySelector(".f").value;
      if (!d || !fx) return;
      const conta = PB.contaDe(base, cat);
      if (conta) { if (conta.refDRE !== d || conta.refDFC !== fx) { conta.refDRE = d; conta.refDFC = fx; alteradas++; } }
      else {
        if (!plano.some((c) => c.numero === "99")) plano.push({ numero: "99", nome: "Contas Importadas a Revisar", tipo: "Sintética", refDRE: "", refDFC: "" });
        plano.push({ numero: `99.${String(++seq).padStart(3, "0")}`, nome: nomeSemCodigo(cat).trim(), tipo: "Analítica", refDRE: d, refDFC: fx }); criadas++;
      }
    });
    const vp = IMP.validarPlano(plano);
    if (vp.erros.length) return alert("O plano ficou com erros:\n\n• " + vp.erros.slice(0, 10).map((e) => e.msg).join("\n• "));
    base.planoContas = vp.plano; base.atualizadoEm = new Date().toISOString().slice(0, 19);
    try { await PB.api.post("/dados", { clienteId, dados: base }); alert(`${alteradas} conta(s) reclassificada(s) e ${criadas} criada(s). Relatórios republicados.`); renderConferencia(); const fr = $("frame-cliente"); fr.dataset.cliente = ""; }
    catch (e) { alert("Erro ao publicar: " + e.message); }
  });

  /* ---------- Clientes ---------- */
  function renderClientes() {
    UI.tabelaSimples($("tb-clientes"), [
      { campo: "nome", titulo: "Cliente", fmt: (v, c) => `<b>${PB.esc(v)}</b><br><span class="muted" style="font-size:12px">${PB.esc(c.cnpj || "")}</span>` },
      { campo: "origem", titulo: "Origem", fmt: (v) => `<span class="badge ${v === "contaazul" ? "badge-info" : "badge-ok"}">${v === "contaazul" ? "Conta Azul" : "Planilha padrão"}</span>` },
      { campo: "atualizadoEm", titulo: "Última publicação", fmt: (v) => {
        if (!v) return `<span class="badge badge-err">Sem dados</span>`;
        const dias = Math.floor((Date.now() - new Date(v)) / 864e5);
        return `${new Date(v).toLocaleDateString("pt-BR")} <span class="badge ${dias > 35 ? "badge-warn" : "badge-ok"}">${dias > 35 ? "desatualizado" : "em dia"}</span>`;
      } },
      { campo: "ultimoFechado", titulo: "Fechamento", fmt: (v, c) => `${v ? "Fechado até " + f.mes(v) : "Nenhum mês fechado"}${(c.mesesAbertos || []).length ? ` <span class="badge badge-warn">${c.mesesAbertos.length} em aberto</span>` : ' <span class="badge badge-ok">em dia</span>'}` },
      { campo: "id", titulo: "Ações", fmt: (id) => `<button class="btn ${id === clienteId ? "btn-primary" : "btn-outline"} btn-sm" data-acao="ficha" data-id="${id}">Ficha</button> <button class="btn btn-outline btn-sm" data-acao="importar" data-id="${id}">Importar</button> <button class="btn btn-outline btn-sm" data-acao="relatorios" data-id="${id}">Relatórios</button>` }
    ], clientes);
    $("tb-clientes").querySelectorAll("[data-acao=ficha]").forEach((b) => b.addEventListener("click", async () => {
      clienteId = b.dataset.id; $("sel-cliente").value = clienteId; await carregarBase(); renderClientes(); renderFicha();
      $("ficha").scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    $("tb-clientes").querySelectorAll("[data-acao=importar]").forEach((b) => b.addEventListener("click", async () => {
      clienteId = b.dataset.id; $("sel-cliente").value = clienteId; await carregarBase();
      document.querySelector('.side-link[data-view="importar"]').click();
    }));
    $("tb-clientes").querySelectorAll("[data-acao=relatorios]").forEach((b) => b.addEventListener("click", async () => {
      clienteId = b.dataset.id; $("sel-cliente").value = clienteId; await carregarBase(); abrirRelatorios();
    }));
  }
  $("btn-novo").addEventListener("click", () => $("painel-novo").classList.toggle("hidden"));
  $("form-novo").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = $("n-nome").value.trim();
    const id = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    try {
      await PB.api.post("/clientes", { id, nome, cnpj: $("n-cnpj").value, origem: $("n-origem").value, emailUsuario: $("n-email").value, responsavel: usuario.nome, setor: $("n-setor").value, contexto: $("n-contexto").value });
      e.target.reset(); $("painel-novo").classList.add("hidden"); clienteId = id; await carregarClientes(); await carregarBase();
    } catch (err) { alert("Erro ao cadastrar: " + err.message); }
  });

  /* ---------- Importação ---------- */
  $("imp-origem").addEventListener("change", () => $("campo-tipo-item").classList.toggle("hidden", $("imp-origem").value !== "ca-vendas"));
  const drop = $("drop"), inp = $("arquivo");
  ["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("drag"); }));
  drop.addEventListener("drop", (e) => e.dataTransfer.files[0] && processar(e.dataTransfer.files[0]));
  inp.addEventListener("change", () => inp.files[0] && processar(inp.files[0]));

  async function processar(arquivo) {
    arquivoAtual = arquivo;
    log(`Lendo "${arquivo.name}" (${(arquivo.size / 1024).toFixed(0)} KB) para ${base.cliente.nome}…`);
    try {
      const buf = await arquivo.arrayBuffer();
      // datas chegam como número serial do Excel e são convertidas sem erro de fuso horário
      const wb = XLSX.read(buf, { type: "array" });
      const fmt = $("imp-origem").value;
      let r = fmt === "padrao" ? IMP.lerPadrao(wb)
        : fmt === "ca-auto" ? IMP.lerContaAzulRelatorio(wb)
        : fmt === "ca-competencia" ? IMP.lerContaAzulCompetencia(wb)
        : fmt === "ca-extrato" ? IMP.lerContaAzulExtrato(wb)
        : IMP.lerContaAzulVendas(wb, $("imp-tipoitem").value);
      // formato escolhido não confere com o arquivo: lê pelo tipo detectado
      if (!Object.keys(r.parcial).length && r.tipoDetectado && (fmt === "ca-competencia" || fmt === "ca-extrato")) {
        log("• " + r.avisos[0] + " Lendo pelo tipo detectado…");
        r = IMP.lerContaAzulRelatorio(wb);
      }
      r.avisos.forEach((a) => log("• " + a));
      const qtd = Object.entries(r.parcial).map(([k, v]) => `${k}: ${v.length}`).join(" | ");
      log(qtd ? "Registros lidos → " + qtd : "Nenhum registro reconhecido.");
      if (!qtd) return;
      pendente = r.parcial; periodoCA = null;
      if ($("imp-modo").value === "contaazul" || r.tipoDetectado) $("imp-modo").value = "meses";
      validarEExibir();
    } catch (e) { log("ERRO: " + e.message); }
    inp.value = "";
  }

  function validarEExibir() {
    const v = IMP.validar(pendente, base.planoContas);
    $("painel-validacao").classList.remove("hidden");
    $("resumo-validacao").innerHTML = `<span class="badge ${v.erros.length ? "badge-err" : "badge-ok"}">${v.erros.length} erro(s)</span> <span class="badge badge-warn">${v.alertas.length} alerta(s)</span> <span class="badge ${v.semPlano.length ? "badge-warn" : "badge-ok"}">${v.semPlano.length} conta(s) fora do plano de contas</span>`;
    const itens = [...v.erros.map((e) => ({ ...e, nivel: "Erro" })), ...v.alertas.map((e) => ({ ...e, nivel: "Alerta" }))].slice(0, 200);
    $("validacao").innerHTML = itens.length ? "" : `<div class="alert alert-info">Nenhum problema encontrado nas linhas importadas.</div>`;
    if (itens.length) UI.tabelaSimples($("validacao"), [
      { campo: "nivel", titulo: "Nível", fmt: (x) => `<span class="badge ${x === "Erro" ? "badge-err" : "badge-warn"}">${x}</span>` },
      { campo: "aba", titulo: "Aba" }, { campo: "linha", titulo: "Linha" }, { campo: "msg", titulo: "Problema" }
    ], itens);
    // contas novas (não existem no plano): cria como analíticas e aloca na estrutura
    if (v.semPlano.length) {
      $("pendencias-plano").innerHTML = `<h3 style="font-size:15px;margin-top:18px">Contas novas — aloque na estrutura da DRE e do DFC</h3>
        <p class="muted" style="font-size:13px;margin:0 0 8px">Serão criadas como contas analíticas dentro da conta sintética “99 — Contas Importadas a Revisar”. Depois, ajuste número e posição em <b>Plano de contas</b>.</p>
        <div class="table-wrap"><table class="data left"><thead><tr><th>Conta Analítica</th><th>Referência na Estrutura da DRE</th><th>Referência na Estrutura do DFC</th></tr></thead><tbody>${
          v.semPlano.map((c) => {
            // tipo predominante da categoria (pelo valor) e sugestão pela linha da DRE do Conta Azul (se conhecida) e pelo nome
            const ls = (pendente.lancamentos || []).filter((l) => l.categoria === c), sRec = PB.soma(ls.filter((l) => l.tipo === "Receita"), (l) => l.valor), sDesp = PB.soma(ls.filter((l) => l.tipo === "Despesa"), (l) => l.valor);
            const tipo = sRec >= sDesp ? "Receita" : "Despesa", sd = PB.sugestaoDRE(linhaCA(c), c, tipo);
            return `<tr data-cat="${PB.esc(c)}"><td>${PB.esc(c)}</td><td><select class="d">${opcoesRef("DRE", sd)}</select></td><td><select class="f">${opcoesRef("DFC", PB.sugestaoDFC(sd, tipo))}</select></td></tr>`; }).join("")
        }</tbody></table></div><button class="btn btn-dark btn-sm" style="margin-top:10px" id="btn-aplicar-depara">Criar contas e aplicar</button>`;
      $("btn-aplicar-depara").addEventListener("click", () => {
        const plano = pendente.planoContas || (pendente.planoContas = JSON.parse(JSON.stringify(base.planoContas)));
        if (!plano.some((c) => c.numero === "99")) plano.push({ numero: "99", nome: "Contas Importadas a Revisar", tipo: "Sintética", refDRE: "", refDFC: "" });
        let seq = plano.filter((c) => String(c.numero).startsWith("99.")).length;
        // rótulo do Conta Azul "4.3.06 - Fornec. ..." → conta com o nome (o número fica na descrição do lançamento e casa pelo nome)
        $("pendencias-plano").querySelectorAll("tr[data-cat]").forEach((tr) => { const m = /^\s*\d[\d.]*\s*[-–]\s*(.+)$/.exec(tr.dataset.cat); plano.push({ numero: `99.${String(++seq).padStart(3, "0")}`, nome: m ? m[1].trim() : tr.dataset.cat, tipo: "Analítica", refDRE: tr.querySelector(".d").value, refDFC: tr.querySelector(".f").value }); });
        log(`${v.semPlano.length} conta(s) analítica(s) criada(s) e alocada(s) na estrutura.`);
        validarEExibir();
      });
    } else $("pendencias-plano").innerHTML = "";
    // prévia: DRE (competência) ou DFC (caixa), nos meses do arquivo
    const previa = IMP.mesclar(base, pendente, $("imp-modo").value, periodoCA);
    const L = pendente.lancamentos || [];
    const soCaixa = L.length && L.every((l) => l.visao === "Caixa");
    const mesesArq = [...new Set(L.map((l) => (soCaixa ? l.data : l.competencia || l.data || "").slice(0, 7)).filter(Boolean))].sort();
    const meses = (mesesArq.length ? mesesArq : PB.mesesDisponiveis(previa)).slice(-6);
    $("painel-preview").classList.remove("hidden");
    $("painel-preview").querySelector("h2").textContent = soCaixa ? "3. Prévia do DFC (visão de caixa) após a importação" : "3. Prévia da DRE (visão de competência) após a importação";
    if (meses.length) {
      const r = soCaixa ? PB.calc.dfc(previa, meses) : PB.calc.dre(previa, meses);
      UI.tabelaDemonstrativo($("preview-dre"), meses, r.linhas.filter((l) => l.tipo !== "conta"));
    }
    $("btn-publicar").disabled = v.erros.length > 0;
    $("btn-publicar").title = v.erros.length ? "Corrija os erros antes de publicar" : "";
  }
  $("imp-modo").addEventListener("change", () => pendente && validarEExibir());

  $("btn-publicar").addEventListener("click", async () => {
    const novo = IMP.mesclar(base, pendente, $("imp-modo").value, periodoCA);
    $("btn-publicar").disabled = true;
    try {
      if ($("chk-bruto").checked && arquivoAtual) {
        log("Arquivando original no SharePoint (pasta bruto)…");
        await PB.api.post("/arquivos", { clienteId, pasta: "bruto", nome: `${new Date().toISOString().slice(0, 10)} - ${arquivoAtual.name}`, conteudoBase64: await paraBase64(arquivoAtual) });
      }
      log("Publicando base padronizada…");
      await PB.api.post("/dados", { clienteId, dados: novo });
      base = novo; pendente = null; periodoCA = null;
      log(`Publicado em ${new Date().toLocaleString("pt-BR")}. O cliente já vê os relatórios atualizados.`);
      $("painel-validacao").classList.add("hidden"); $("painel-preview").classList.add("hidden");
      await carregarClientes();
    } catch (e) { log("ERRO ao publicar: " + e.message); $("btn-publicar").disabled = false; }
  });
  $("btn-ver-portal").addEventListener("click", () => abrirRelatorios());
  const paraBase64 = (file) => new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(r.result.split(",")[1]); r.onerror = erro; r.readAsDataURL(file); });

  /* =========================================================
     PLANO DE CONTAS — estrutura padrão DRE / DFC
     ========================================================= */
  // <option> com o caminho completo na estrutura (o valor gravado é o nome da linha)
  function opcoesRef(tipo, sel) {
    const nao = tipo === "DRE" ? PB.E.NAO_DRE : PB.E.NAO_DFC;
    return `<option value="">— selecione —</option>` + PB.E.caminhos(tipo).map((c) => `<option value="${PB.esc(c.nome)}" ${c.nome === sel ? "selected" : ""}>${PB.esc(c.caminho)}</option>`).join("")
      + `<option value="${nao}" ${sel === nao ? "selected" : ""}>${nao}</option>`;
  }
  const ordemNum = (a, b) => String(a.numero).localeCompare(String(b.numero), "pt-BR", { numeric: true });
  function usoPorConta(plano) {
    const ref = { planoContas: plano }, uso = {};
    base.lancamentos.forEach((l) => { const c = PB.contaDe(ref, l.categoria); if (c) uso[c.numero] = (uso[c.numero] || 0) + 1; });
    return uso;
  }
  function renderPlano() {
    const plano = base.planoContas.slice().sort(ordemNum);
    const uso = usoPorConta(plano), filtro = $("plano-filtro").value;
    const nivel = (n) => String(n).split(".").length - 1;
    const linhas = plano.filter((p) => !filtro || (filtro === "pend" && p.tipo === "Analítica" && (!p.refDRE || !p.refDFC)) || (filtro === "uso" && uso[p.numero]));
    $("tb-plano").innerHTML = `<div class="table-wrap"><table class="data left"><thead><tr><th style="width:110px">Número da Conta</th><th>Nome da Conta</th><th style="width:120px">Tipo da Conta</th><th>Referência na Estrutura da DRE</th><th>Referência na Estrutura do DFC</th><th>Lançamentos</th><th></th></tr></thead><tbody>${
      linhas.map((p) => { const i = base.planoContas.indexOf(p), sint = p.tipo === "Sintética";
        return `<tr data-i="${i}" class="${sint ? "sgrp" : ""}"><td><input class="n" value="${PB.esc(p.numero)}" style="padding:6px 8px"></td>
        <td><input class="c" value="${PB.esc(p.nome)}" style="padding:6px 8px;margin-left:${nivel(p.numero) * 14}px;width:calc(100% - ${nivel(p.numero) * 14}px);${sint ? "font-weight:700" : ""}"></td>
        <td><select class="t" style="padding:6px 8px"><option ${!sint ? "selected" : ""}>Analítica</option><option ${sint ? "selected" : ""}>Sintética</option></select></td>
        <td>${sint ? '<span class="muted">—</span>' : `<select class="d" style="padding:6px 8px;${p.refDRE ? "" : "border-color:var(--red-500)"}">${opcoesRef("DRE", p.refDRE)}</select>`}</td>
        <td>${sint ? '<span class="muted">—</span>' : `<select class="f" style="padding:6px 8px;${p.refDFC ? "" : "border-color:var(--red-500)"}">${opcoesRef("DFC", p.refDFC)}</select>`}</td>
        <td>${uso[p.numero] || 0}</td><td><button class="btn btn-outline btn-sm rm" ${uso[p.numero] ? "disabled title='Conta com lançamentos'" : ""}>Remover</button></td></tr>`; }).join("")
    }</tbody></table></div><p class="muted" style="font-size:13px;margin-top:10px">${plano.filter((p) => p.tipo === "Sintética").length} contas sintéticas · ${plano.filter((p) => p.tipo !== "Sintética").length} contas analíticas · ${plano.filter((p) => p.tipo !== "Sintética" && (!p.refDRE || !p.refDFC)).length} analíticas sem referência</p>`;
    $("tb-plano").querySelectorAll(".rm").forEach((b) => b.addEventListener("click", () => { lerPlano(); base.planoContas.splice(+b.closest("tr").dataset.i, 1); renderPlano(); }));
    $("tb-plano").querySelectorAll("select.t").forEach((s) => s.addEventListener("change", () => { lerPlano(); renderPlano(); }));
    renderEstruturas();
  }
  function lerPlano() {
    $("tb-plano").querySelectorAll("tr[data-i]").forEach((tr) => {
      const p = base.planoContas[+tr.dataset.i]; if (!p) return;
      p.numero = tr.querySelector(".n").value.trim(); p.nome = tr.querySelector(".c").value.trim(); p.tipo = tr.querySelector(".t").value;
      p.refDRE = p.tipo === "Analítica" ? (tr.querySelector(".d")?.value || p.refDRE || "") : "";
      p.refDFC = p.tipo === "Analítica" ? (tr.querySelector(".f")?.value || p.refDFC || "") : "";
    });
    base.planoContas = base.planoContas.filter((p) => p.numero || p.nome);
  }
  function renderEstruturas() {
    ["DRE", "DFC"].forEach((t) => {
      const r = PB.E.calcular(t, {}, null, 0);
      $("estr-" + t.toLowerCase()).innerHTML = `<div class="table-wrap"><table class="data left"><tbody>${r.linhas.map((l) => `<tr class="${l.estilo}"><td style="padding-left:${12 + l.nivel * 18}px">${PB.esc(l.nome)}</td></tr>`).join("")}</tbody></table></div>`;
    });
  }
  $("plano-filtro").addEventListener("change", () => { lerPlano(); renderPlano(); });
  $("btn-add-cat").addEventListener("click", () => { lerPlano(); base.planoContas.push({ numero: "", nome: "Nova conta", tipo: "Analítica", refDRE: "", refDFC: "" }); $("plano-filtro").value = ""; renderPlano(); });
  $("btn-salvar-plano").addEventListener("click", async () => {
    lerPlano();
    const vp = IMP.validarPlano(base.planoContas);
    if (vp.erros.length) return alert("Corrija antes de salvar:\n\n• " + vp.erros.slice(0, 12).map((e) => e.msg).join("\n• ") + (vp.erros.length > 12 ? `\n… e mais ${vp.erros.length - 12}` : ""));
    base.planoContas = vp.plano; base.atualizadoEm = new Date().toISOString().slice(0, 19);
    try { await PB.api.post("/dados", { clienteId, dados: base }); renderPlano(); alert("Plano de contas salvo e relatórios republicados."); } catch (e) { alert("Erro: " + e.message); }
  });

  /* Planilha padrão do plano de contas: baixar e carregar */
  $("btn-plano-modelo").addEventListener("click", () => IMP.gerarModeloPlano([], "Patagonia - Planilha Padrão do Plano de Contas.xlsx").catch((e) => alert(e.message)));
  $("btn-plano-atual").addEventListener("click", () => { lerPlano(); IMP.gerarModeloPlano(base.planoContas, `Plano de Contas - ${base.cliente.nome}.xlsx`, base.cliente.nome).catch((e) => alert(e.message)); });
  let planoCarregado = null;
  $("plano-arquivo").addEventListener("change", async (e) => {
    const arq = e.target.files[0]; e.target.value = ""; if (!arq) return;
    const el = $("plano-validacao");
    try {
      const wb = XLSX.read(await arq.arrayBuffer(), { type: "array" });
      const r = IMP.lerPlano(wb);
      if (r.erro) { el.innerHTML = `<div class="alert alert-error">${PB.esc(r.erro)}</div>`; return; }
      const vp = IMP.validarPlano(r.registros);
      planoCarregado = vp.plano;
      // contas usadas nos lançamentos que deixariam de existir
      const ref = { planoContas: vp.plano };
      const orfas = [...new Set(base.lancamentos.map((l) => l.categoria).filter((c) => !PB.contaDe(ref, c)))];
      const sint = vp.plano.filter((c) => c.tipo === "Sintética").length, anal = vp.plano.length - sint;
      const itens = [...vp.erros.map((x) => ({ ...x, nivel: "Erro" })), ...vp.alertas.map((x) => ({ ...x, nivel: "Alerta" }))];
      el.innerHTML = `<div class="ca-status"><b>${PB.esc(arq.name)}</b><span>${vp.plano.length} contas (${sint} sintéticas, ${anal} analíticas)</span>
          <span class="badge ${vp.erros.length ? "badge-err" : "badge-ok"}">${vp.erros.length} erro(s)</span><span class="badge badge-warn">${vp.alertas.length} alerta(s)</span>
          <span class="badge ${orfas.length ? "badge-warn" : "badge-ok"}">${orfas.length} conta(s) dos lançamentos fora do plano</span></div>
        <div id="plano-erros"></div>
        ${orfas.length ? `<div class="alert alert-warn">Estas contas aparecem nos lançamentos mas não existem como analíticas no plano carregado (ficarão sem classificação): ${orfas.slice(0, 30).map(PB.esc).join(", ")}${orfas.length > 30 ? "…" : ""}</div>` : ""}
        <div id="plano-previa"></div>
        <div style="display:flex;gap:10px;margin-top:12px"><button class="btn btn-primary" id="btn-aplicar-plano" ${vp.erros.length ? "disabled title='Corrija os erros na planilha e carregue novamente'" : ""}>Substituir plano e publicar</button><button class="btn btn-outline" id="btn-cancelar-plano">Cancelar</button></div>`;
      if (itens.length) UI.tabelaSimples($("plano-erros"), [
        { campo: "nivel", titulo: "Nível", fmt: (x) => `<span class="badge ${x === "Erro" ? "badge-err" : "badge-warn"}">${x}</span>` },
        { campo: "linha", titulo: "Linha da planilha" }, { campo: "msg", titulo: "Problema" }], itens.slice(0, 200));
      if (!vp.erros.length) {
        const ms = PB.mesesDisponiveis(base).slice(-3);
        if (ms.length) { $("plano-previa").innerHTML = `<h3 style="font-size:15px;margin-top:14px">Prévia da DRE com o novo plano (últimos 3 meses)</h3><div id="plano-previa-tb"></div>`;
          UI.tabelaDemonstrativo($("plano-previa-tb"), ms, PB.calc.dre({ ...base, planoContas: vp.plano }, ms).linhas.filter((l) => l.tipo !== "conta")); }
      }
      $("btn-cancelar-plano").onclick = () => { planoCarregado = null; el.innerHTML = ""; };
      $("btn-aplicar-plano").onclick = async () => {
        if (!confirm(`Substituir o plano de contas de ${base.cliente.nome} (${base.planoContas.length} contas) pelo plano carregado (${planoCarregado.length} contas)?`)) return;
        base.planoContas = planoCarregado; base.atualizadoEm = new Date().toISOString().slice(0, 19);
        try { await PB.api.post("/dados", { clienteId, dados: base }); el.innerHTML = `<div class="alert alert-info">Plano de contas substituído e relatórios republicados.</div>`; renderPlano(); }
        catch (err) { alert("Erro: " + err.message); }
      };
    } catch (err) { el.innerHTML = `<div class="alert alert-error">Não foi possível ler a planilha: ${PB.esc(err.message)}</div>`; }
  });

  /* ---------- Modelos ---------- */
  function renderDicionario() {
    $("versao-modelo").textContent = "Versão " + PB.MODELO.versao;
    $("dicionario").innerHTML = Object.entries(PB.MODELO.abas).map(([n, d]) => `<h3 style="font-size:15px;margin:16px 0 4px">${n}</h3><p class="muted" style="font-size:13px;margin-bottom:6px">${d.descricao}</p>
      <div class="table-wrap"><table class="data left"><thead><tr><th>Coluna</th><th>Obrigatória</th><th>Tipo</th><th>Orientação</th></tr></thead><tbody>${
        d.colunas.map((c) => `<tr><td><b>${c.titulo}</b></td><td>${c.obrigatorio ? "Sim" : "—"}</td><td>${c.tipo}</td><td style="white-space:normal">${PB.esc(c.ajuda || (c.opcoes ? c.opcoes.join(", ") : ""))}</td></tr>`).join("")}</tbody></table></div>`).join("");
  }
  $("dl-modelo").addEventListener("click", () => IMP.gerarModelo(null, "Patagonia - Modelo Padrao de Coleta.xlsx"));
  $("dl-modelo-comp").addEventListener("click", () => IMP.gerarModeloContaAzul("competencia", base && base.planoContas).catch((e) => alert(e.message)));
  $("dl-modelo-ext").addEventListener("click", () => IMP.gerarModeloContaAzul("extrato", base && base.planoContas).catch((e) => alert(e.message)));
  $("dl-base").addEventListener("click", () => IMP.gerarModelo(base, `Base - ${base.cliente.nome}.xlsx`));
  $("dl-exemplo").addEventListener("click", () => {
    const ex = PB.demoGerar("exemplo", "Empresa Exemplo Ltda", "", "planilha", 0.3, 5, 0.5);
    ex.lancamentos = ex.lancamentos.filter((l) => l.competencia >= "2026-09"); ex.vendas = ex.vendas.filter((v) => v.data >= "2026-10");
    IMP.gerarModelo(ex, "Patagonia - Modelo Exemplo Preenchido.xlsx");
  });

  /* ---------- SharePoint ---------- */
  $("btn-atualizar-docs").addEventListener("click", () => UI.documentos($("docs"), clienteId));
  $("form-upload").addEventListener("submit", async (e) => {
    e.preventDefault();
    const arq = $("up-arquivo").files[0]; if (!arq) return;
    try {
      await PB.api.post("/arquivos", { clienteId, pasta: $("up-pasta").value, nome: arq.name, conteudoBase64: await paraBase64(arq) });
      e.target.reset(); UI.documentos($("docs"), clienteId);
    } catch (err) { alert("Erro no envio: " + err.message); }
  });

  /* =========================================================
     FICHA DO CLIENTE
     ========================================================= */
  const clienteAtual = () => clientes.find((c) => c.id === clienteId) || {};
  function renderFicha() {
    const c = clienteAtual();
    $("ficha-nome").textContent = c.nome || "";
    $("ficha-sub").textContent = [c.cnpj, c.setor].filter(Boolean).join(" · ");
    $("ficha-badges").innerHTML = `<span class="badge ${c.origem === "contaazul" ? "badge-info" : "badge-ok"}">${c.origem === "contaazul" ? "Conta Azul" : "Planilha padrão"}</span>`;
    renderSituacao(); renderAcessos(); renderContexto(); renderExportPeriodo();
  }

  /* ---------- Situação dos dados e fechamento ---------- */
  function diagnosticoMes(m) {
    const L = base.lancamentos.filter((l) => l.competencia === m);
    const real = L.filter(PB.naDRE);
    const hoje = new Date().toISOString().slice(0, 10);
    const vencidos = base.lancamentos.filter((l) => PB.caixaPrevisto(l) && l.data.startsWith(m) && l.data < hoje);
    const semPlano = new Set(real.filter((l) => { const c = PB.contaDe(base, l.categoria); return !c || !c.refDRE || !c.refDFC; }).map((l) => l.categoria));
    const vendas = base.vendas.filter((v) => v.data.startsWith(m));
    const receita = PB.soma(real.filter((l) => l.tipo === "Receita"), (l) => l.valor);
    const pend = [];
    if (!real.length) pend.push("sem lançamentos realizados");
    if (vencidos.length) pend.push(`${vencidos.length} previsto(s) vencido(s)`);
    if (semPlano.size) pend.push(`${semPlano.size} conta(s) sem referência na estrutura`);
    if (!vendas.length) pend.push("sem vendas");
    return { lanc: real.length, vendas: vendas.length, receita, pend };
  }
  function mesesSituacao() {
    const ms = PB.mesesDisponiveis(base);
    const atual = new Date().toISOString().slice(0, 7);
    const ult = ms.at(-1) || atual;
    return PB.mesesEntre(ms[0] || atual, ult > atual ? ult : atual).slice(-13);
  }
  function renderSituacao() {
    base.fechamentos = base.fechamentos || {};
    const ms = mesesSituacao();
    const diag = Object.fromEntries(ms.map((m) => [m, diagnosticoMes(m)]));
    const fechados = ms.filter((m) => PB.statusFechamento(base, m) === "Fechado");
    const comPend = ms.filter((m) => diag[m].pend.length && PB.statusFechamento(base, m) !== "Fechado");
    const dias = base.atualizadoEm ? Math.floor((Date.now() - new Date(base.atualizadoEm)) / 864e5) : null;
    const card = (t, v, s, cls = "") => `<div class="kpi-card"><span>${t}</span><b class="${cls}">${v}</b><small class="muted">${s}</small></div>`;
    $("sit-kpis").innerHTML =
      card("Último mês com dados", PB.mesesDisponiveis(base).length ? f.mes(PB.mesesDisponiveis(base).at(-1)) : "—", `${base.lancamentos.length} lançamentos · ${base.vendas.length} vendas na base`) +
      card("Fechado até", fechados.length ? f.mes(fechados.at(-1)) : "—", `${fechados.length} de ${ms.length} meses fechados`) +
      card("Meses com pendências", comPend.length, comPend.length ? comPend.map(f.mes).join(", ") : "nenhuma pendência", comPend.length ? "down" : "up") +
      card("Última publicação", dias == null ? "—" : dias + " dia(s)", base.atualizadoEm ? new Date(base.atualizadoEm).toLocaleString("pt-BR") : "nunca publicado", dias > 35 ? "down" : "");
    $("mes-grid").innerHTML = ms.slice().reverse().map((m) => {
      const st = PB.statusFechamento(base, m), d = diag[m], fe = base.fechamentos[m] || {};
      const cls = st === "Fechado" ? "fechado" : st === "Em revisão" ? "revisao" : "";
      return `<div class="mes-card ${cls}" data-mes="${m}"><b>${f.mes(m)}</b>
        <div>${d.lanc} lanç. · ${d.vendas} vendas</div><div>${f.moeda(d.receita)} de receita</div>
        <div class="chk">${d.pend.length ? "Pendências: " + d.pend.join("; ") : "Sem pendências"}</div>
        ${fe.em && st === "Fechado" ? `<div class="chk">por ${PB.esc((fe.por || "").split("@")[0])} em ${new Date(fe.em).toLocaleDateString("pt-BR")}</div>` : ""}
        <select aria-label="Status de ${f.mes(m)}">${["Aberto", "Em revisão", "Fechado"].map((o) => `<option ${o === st ? "selected" : ""}>${o}</option>`).join("")}</select>
        <input class="obs" placeholder="Observação" value="${PB.esc(fe.obs || "")}" style="margin-top:6px;padding:6px 8px;font-size:12px"></div>`;
    }).join("");
  }
  function lerFechamentos() {
    $("mes-grid").querySelectorAll(".mes-card").forEach((el) => {
      const m = el.dataset.mes, st = el.querySelector("select").value, obs = el.querySelector(".obs").value, ant = base.fechamentos[m] || {};
      if (st === "Aberto" && !obs && !ant.status) return;
      base.fechamentos[m] = { status: st, obs, em: ant.status === st ? ant.em : new Date().toISOString().slice(0, 19), por: ant.status === st ? ant.por : usuario.email };
    });
  }
  $("btn-fechar-prontos").addEventListener("click", () => {
    $("mes-grid").querySelectorAll(".mes-card").forEach((el) => { if (!diagnosticoMes(el.dataset.mes).pend.length) el.querySelector("select").value = "Fechado"; });
  });
  $("btn-salvar-fech").addEventListener("click", async () => {
    lerFechamentos(); base.atualizadoEm = new Date().toISOString().slice(0, 19);
    try { await PB.api.post("/dados", { clienteId, dados: base }); await carregarClientes(); renderSituacao(); alert("Fechamentos salvos e publicados para o cliente."); }
    catch (e) { alert("Erro: " + e.message); }
  });

  /* ---------- Acessos ---------- */
  async function renderAcessos() {
    const el = $("lista-acessos"); el.innerHTML = `<p class="muted">Carregando…</p>`;
    try {
      const lista = await PB.api.get(`/acessos?cliente=${encodeURIComponent(clienteId)}`);
      el.innerHTML = lista.length ? lista.map((a) => `<div class="acesso-row"><div><b>${PB.esc(a.nome || "")}</b><br><span class="muted" style="font-size:13px">${PB.esc(a.email)}</span></div>
        <div style="display:flex;gap:8px"><button class="btn btn-outline btn-sm" data-reset="${PB.esc(a.email)}">Reenviar instruções de acesso</button>
        <button class="btn btn-outline btn-sm" style="color:var(--red-500)" data-rm="${PB.esc(a.email)}">Remover acesso</button></div></div>`).join("")
        : `<div class="alert alert-warn">Nenhum e-mail com acesso a este cliente.</div>`;
      el.querySelectorAll("[data-reset]").forEach((b) => b.addEventListener("click", async () => {
        if (!confirm(`Reenviar as instruções de acesso para ${b.dataset.reset}?`)) return;
        try { const r = await PB.api.post("/acessos/redefinir", { clienteId, email: b.dataset.reset }); alert(r.simulado ? "Modo demonstração: o e-mail seria enviado agora." : "Instruções de acesso enviadas."); } catch (e) { alert("Erro: " + e.message); }
      }));
      el.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", async () => {
        if (!confirm(`Remover o acesso de ${b.dataset.rm} ao portal? A pessoa não conseguirá mais ver os dados deste cliente.`)) return;
        try { await PB.api.excluir(`/acessos?cliente=${encodeURIComponent(clienteId)}&email=${encodeURIComponent(b.dataset.rm)}`); renderAcessos(); } catch (e) { alert("Erro: " + e.message); }
      }));
    } catch (e) { el.innerHTML = `<div class="alert alert-error">${PB.esc(e.message)}</div>`; }
  }
  $("form-acesso").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await PB.api.post("/acessos", { clienteId, email: $("ac-email").value.trim(), nome: $("ac-nome").value.trim(), enviarConvite: $("ac-convite").checked });
      e.target.reset(); $("ac-convite").checked = true; renderAcessos();
    } catch (err) { alert("Erro: " + err.message); }
  });

  /* ---------- Contexto e benchmarks ---------- */
  let fontesBm = [];
  function renderContexto() {
    const c = clienteAtual();
    $("cx-setor").value = c.setor || ""; $("cx-texto").value = c.contexto || "";
    $("bm-texto").value = (c.benchmarks || {}).texto || ""; fontesBm = (c.benchmarks || {}).fontes || [];
    renderFontes((c.benchmarks || {}).em);
  }
  function renderFontes(em) {
    $("bm-fontes").innerHTML = fontesBm.length ? `<b>Fontes${em ? " (pesquisa de " + new Date(em).toLocaleDateString("pt-BR") + ")" : ""}:</b><ul>${fontesBm.map((x) => `<li><a href="${PB.esc(x.url)}" target="_blank" rel="noopener">${PB.esc(x.titulo || x.url)}</a></li>`).join("")}</ul>` : "";
  }
  async function salvarCliente(campos, msg) {
    try { await PB.api.patch("/clientes", { id: clienteId, ...campos }); Object.assign(clienteAtual(), campos); alert(msg); }
    catch (e) { alert("Erro: " + e.message); }
  }
  $("btn-salvar-contexto").addEventListener("click", () => salvarCliente({ setor: $("cx-setor").value.trim(), contexto: $("cx-texto").value.trim() }, "Contexto salvo."));
  $("btn-salvar-bm").addEventListener("click", () => salvarCliente({ benchmarks: { texto: $("bm-texto").value, fontes: fontesBm, em: new Date().toISOString() } }, "Benchmarks salvos."));
  $("btn-benchmarks").addEventListener("click", async (e) => {
    if (!$("cx-setor").value.trim() && !$("cx-texto").value.trim()) return alert("Preencha o setor ou o contexto da empresa antes de pesquisar.");
    await PB.api.patch("/clientes", { id: clienteId, setor: $("cx-setor").value.trim(), contexto: $("cx-texto").value.trim() }).catch(() => { });
    e.target.disabled = true; const txt = e.target.textContent; e.target.textContent = "Pesquisando… (pode levar até 1 minuto)";
    try { const r = await PB.api.post("/benchmarks", { clienteId }); $("bm-texto").value = r.texto; fontesBm = r.fontes || []; renderFontes(r.em); }
    catch (err) { alert("Erro na pesquisa: " + err.message); }
    e.target.disabled = false; e.target.textContent = txt;
  });

  /* ---------- Exportações ---------- */
  function renderExportPeriodo() {
    const ms = PB.mesesDisponiveis(base);
    const opts = ms.map((m) => `<option value="${m}">${f.mes(m)}</option>`).join("");
    $("ex-de").innerHTML = opts; $("ex-ate").innerHTML = opts;
    if (ms.length) { $("ex-de").value = ms[Math.max(0, ms.length - 12)]; $("ex-ate").value = ms.at(-1); }
  }
  const logEx = (m) => { const el = $("log-export"); el.textContent = (el.textContent.startsWith("Selecione") ? "" : el.textContent + "\n") + `[${new Date().toLocaleTimeString("pt-BR")}] ${m}`; el.scrollTop = el.scrollHeight; };
  const periodoExport = () => {
    const de = $("ex-de").value, ate = $("ex-ate").value;
    if (!de || de > ate) { alert("Período inválido."); return null; }
    return PB.mesesDisponiveis(base).filter((m) => m >= de && m <= ate);
  };
  $("btn-exp-xlsx").addEventListener("click", async (e) => {
    const ms = periodoExport(); if (!ms) return;
    e.target.disabled = true; logEx(`Gerando planilha de ${f.mes(ms[0])} a ${f.mes(ms.at(-1))}…`);
    try { const nome = await PB.exportar.planilha(base, clienteAtual(), ms); logEx("Planilha gerada: " + nome); } catch (err) { logEx("ERRO: " + err.message); console.error(err); }
    e.target.disabled = false;
  });
  async function conclusoes(ms) {
    if (!$("ex-ia").checked) return PB.analise.conclusoesLocais(base, ms);
    logEx("Pedindo ao Claude as conclusões do período (pode levar até 1 minuto)…");
    try { return await PB.api.post("/apresentacao", { clienteId, meses: ms }); }
    catch (err) { logEx("Não foi possível usar a IA (" + err.message + "). Usando conclusões automáticas."); return PB.analise.conclusoesLocais(base, ms); }
  }
  ["pptx", "pdf"].forEach((fmt) => $("btn-exp-" + fmt).addEventListener("click", async (e) => {
    const ms = periodoExport(); if (!ms) return;
    e.target.disabled = true;
    try {
      const conc = await conclusoes(ms);
      logEx(`Montando a apresentação (${fmt.toUpperCase()})…`);
      const nome = await PB.exportar.apresentacao(base, clienteAtual(), ms, conc, fmt);
      logEx("" + (fmt === "pdf" ? "Apresentação aberta para salvar em PDF (Ctrl+P → Salvar como PDF)." : "Apresentação gerada: " + nome));
    } catch (err) { logEx("ERRO: " + err.message); console.error(err); }
    e.target.disabled = false;
  }));

  /* =========================================================
     CONTA AZUL — integração via API
     ========================================================= */
  async function renderContaAzul() {
    const c = clienteAtual(), el = $("ca-status");
    $("painel-ca").classList.toggle("hidden", c.origem !== "contaazul");
    if (c.origem !== "contaazul") return;
    const ms = PB.mesesDisponiveis(base);
    if (!$("ca-de").value) { $("ca-de").value = ms.at(-1) || new Date().toISOString().slice(0, 7); $("ca-ate").value = new Date().toISOString().slice(0, 7); }
    el.textContent = "Verificando conexão…";
    let st = { conectado: false };
    try { st = await PB.api.get(`/contaazul/status?cliente=${encodeURIComponent(clienteId)}`); } catch { }
    $("ca-sync").classList.toggle("hidden", !st.conectado);
    el.innerHTML = st.conectado
      ? `<span class="badge badge-ok">Conectado</span><span>${PB.esc(st.empresa || "Conta Azul")} · desde ${new Date(st.em).toLocaleDateString("pt-BR")}</span><button class="btn btn-outline btn-sm" id="btn-ca-off">Desconectar</button>`
      : `<span class="badge badge-warn">Não conectado</span><span>Autorize o acesso com o login do cliente no Conta Azul (somente leitura dos dados financeiros e de vendas).</span><button class="btn btn-primary btn-sm" id="btn-ca-on">Conectar ao Conta Azul</button>`;
    $("btn-ca-on")?.addEventListener("click", async () => {
      if (PB.isDemo()) { await PB.api.post("/contaazul/conectar-demo", { clienteId }); return renderContaAzul(); }
      location.href = `${PB_CONFIG.apiBase}/contaazul/conectar?cliente=${encodeURIComponent(clienteId)}`;
    });
    $("btn-ca-off")?.addEventListener("click", async () => {
      if (!confirm("Desconectar a integração com o Conta Azul deste cliente?")) return;
      await PB.api.post("/contaazul/desconectar", { clienteId }); renderContaAzul();
    });
  }
  $("btn-ca-sync").addEventListener("click", async (e) => {
    const de = $("ca-de").value, ate = $("ca-ate").value;
    if (!de || !ate || de > ate) return alert("Período inválido.");
    const btn = e.target; btn.disabled = true;
    log(`Buscando no Conta Azul de ${f.mes(de)} a ${f.mes(ate)}: visão de competência e extrato de movimentações do período…`);
    try {
      if (PB.isDemo()) {
        const r = await PB.api.post("/contaazul/sincronizar", { clienteId, de, ate });
        (r.avisos || []).forEach((a) => log("• " + a));
        $("imp-modo").value = "meses"; arquivoAtual = null; periodoCA = null; pendente = r.parcial; validarEExibir();
        btn.disabled = false; return;
      }
      // 1) lista de parcelas, contas, transferências e vendas
      const lista = await PB.api.post("/contaazul/sincronizar", { clienteId, de, ate, etapa: "lista" });
      (lista.avisos || []).forEach((a) => log("• " + a));
      // 2) detalhes: baixas (data de caixa e conta) de tudo que teve pagamento e rateio das parcelas com mais de uma categoria.
      //    O que não mudou desde a última busca vem da memória (lista.cache); o resto é consultado em lotes curtos.
      const altP = new Map(lista.parcelas.map((p) => [p.id, p.alteracao])), altV = new Map(lista.vendas.map((v) => [v.id, v.alteracao]));
      const det = { parcelas: [...(lista.cache?.parcelas || [])], vendas: [...(lista.cache?.vendas || [])], falhas: [], totalFalhas: 0 };
      const temP = new Set(det.parcelas.map((d) => d.id)), temV = new Set(det.vendas.map((v) => v.id));
      // detalhe só quando necessário: baixas de quem teve pagamento no período; rateio de quem tem mais de uma categoria/centro de custo
      const filaP = lista.parcelas.filter((p) => (p.porPgto || p.categorias.length > 1 || p.centros.length > 1) && !temP.has(p.id)).map((p) => p.id);
      const filaV = lista.vendas.filter((v) => !/CANCEL|ORCAMENTO|ORÇAMENTO|RECUSAD|ESPERANDO/i.test(v.situacao) && !temV.has(v.id)).map((v) => v.id);
      const total = filaP.length + filaV.length; let feitos = 0, lote = 40, falhasSeguidas = 0, novosP = [], novosV = [];
      const dormir = (s) => new Promise((ok) => setTimeout(ok, s * 1000));
      const gravarMemoria = async () => {
        if (!novosP.length && !novosV.length) return;
        const p = novosP, v = novosV; novosP = []; novosV = [];
        try { await PB.api.post("/contaazul/sincronizar", { clienteId, etapa: "cache", parcelas: p, vendas: v }); } catch { novosP.push(...p); novosV.push(...v); }
      };
      if (total) log(`Detalhando ${total} pagamento(s)/venda(s) novos ou alterados (o Conta Azul permite cerca de 600 consultas por minuto)…`);
      let passo = 0;
      while (filaP.length || filaV.length) {
        const ps = filaP.splice(0, lote), vs = filaV.splice(0, Math.max(0, lote - ps.length));
        let r;
        try { r = await PB.api.post("/contaazul/sincronizar", { clienteId, etapa: "detalhes", parcelas: ps, vendas: vs }); falhasSeguidas = 0; }
        catch (err) {
          // falha de rede/tempo: devolve à fila, reduz o lote e tenta de novo (até 4 vezes seguidas)
          filaP.unshift(...ps); filaV.unshift(...vs);
          if (++falhasSeguidas > 4) { await gravarMemoria(); throw new Error(`a busca parou após várias falhas (${err.message}). Os detalhes já obtidos ficaram salvos; clique em buscar de novo para continuar.`); }
          lote = Math.max(10, Math.floor(lote / 2)); log(`Falha temporária (${err.message}). Tentando de novo com lotes de ${lote}…`); await dormir(5); continue;
        }
        det.parcelas.push(...r.parcelas); det.vendas.push(...r.vendas); det.falhas.push(...r.falhas); det.totalFalhas += r.totalFalhas;
        r.parcelas.forEach((d) => novosP.push({ id: d.id, alt: altP.get(d.id), d }));
        r.vendas.forEach((v) => novosV.push({ id: v.id, alt: altV.get(v.id), itens: v.itens }));
        filaP.unshift(...r.pendentesParcelas); filaV.unshift(...r.pendentesVendas);
        feitos = total - filaP.length - filaV.length;
        log(`Detalhando pagamentos e itens… ${feitos} de ${total}`);
        if (++passo % 5 === 0) await gravarMemoria();
        if (r.esperar) { await gravarMemoria(); log(`Limite de consultas do Conta Azul atingido — aguardando ${r.esperar} s para continuar…`); await dormir(r.esperar); }
      }
      await gravarMemoria();
      // 3) monta o extrato no modelo padrão
      const m = IMP.montarContaAzulAPI(lista, det);
      m.avisos.forEach((a) => log("• " + a));
      periodoCA = null;
      $("imp-modo").value = "meses"; arquivoAtual = null; pendente = m.parcial; validarEExibir();
    } catch (err) { log("ERRO: " + err.message); }
    btn.disabled = false;
  });
  // retorno do fluxo OAuth (?contaazul=ok|erro)
  const retornoCA = new URLSearchParams(location.search).get("contaazul");
  if (retornoCA) setTimeout(() => alert(retornoCA === "ok" ? "Conta Azul conectado com sucesso." : "Não foi possível conectar ao Conta Azul: " + retornoCA), 300);

  /* =========================================================
     EQUIPE DE CONSULTORES — acessos à área do consultor
     ========================================================= */
  async function renderEquipe() {
    const el = $("lista-equipe"); el.innerHTML = `<p class="muted">Carregando…</p>`;
    try {
      const lista = await PB.api.get("/consultores");
      $("equipe-total").textContent = `${lista.length} consultor(es)`;
      const eu = (usuario.email || "").toLowerCase();
      el.innerHTML = lista.length ? lista.map((c) => {
        const proprio = c.email.toLowerCase() === eu, unico = lista.length === 1;
        return `<div class="acesso-row"><div><b>${PB.esc(c.nome || c.email)}</b>${proprio ? ' <span class="badge badge-info">você</span>' : ""}<br>
          <span class="muted" style="font-size:13px">${PB.esc(c.email)}${c.criadoEm ? " · acesso desde " + new Date(c.criadoEm).toLocaleDateString("pt-BR") : ""}</span></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-outline btn-sm" data-reset="${PB.esc(c.email)}">Enviar recuperação de senha</button>
          <button class="btn btn-outline btn-sm" style="color:var(--ferrugem)" data-rm="${PB.esc(c.email)}" ${proprio || unico ? `disabled title="${proprio ? "Você não pode remover o próprio acesso" : "É preciso manter ao menos um consultor"}"` : ""}>Remover acesso</button></div></div>`;
      }).join("") : `<div class="alert alert-warn">Nenhum consultor cadastrado.</div>`;
      el.querySelectorAll("[data-reset]").forEach((b) => b.addEventListener("click", async () => {
        if (!confirm(`Enviar e-mail de recuperação de senha para ${b.dataset.reset}?`)) return;
        try { const r = await PB.api.post("/consultores/redefinir", { email: b.dataset.reset }); alert(r.simulado ? "Modo demonstração: o e-mail seria enviado agora." : "E-mail de recuperação enviado."); }
        catch (e) { alert("Erro: " + e.message); }
      }));
      el.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", async () => {
        if (!confirm(`Remover o acesso de ${b.dataset.rm} à área do consultor?\n\nA pessoa deixa de ver e editar os dados de todos os clientes.`)) return;
        try { await PB.api.excluir(`/consultores?email=${encodeURIComponent(b.dataset.rm)}`); renderEquipe(); }
        catch (e) { alert("Erro: " + e.message); }
      }));
    } catch (e) { el.innerHTML = `<div class="alert alert-error">${PB.esc(e.message)}</div>`; }
  }
  $("form-equipe").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await PB.api.post("/consultores", { email: $("eq-email").value.trim(), nome: $("eq-nome").value.trim(), enviarConvite: $("eq-convite").checked });
      e.target.reset(); $("eq-convite").checked = true; renderEquipe();
      if (r.simulado && r.convite) alert("Modo demonstração: o convite seria enviado por e-mail agora.");
    } catch (err) { alert("Erro: " + err.message); }
  });

  /* ---------- Assistente ---------- */
  UI.chat($("chat"), () => clienteId, [
    "Escreva o comentário executivo do último mês para o relatório",
    "Aponte inconsistências ou variações atípicas nos lançamentos",
    "Compare o realizado com a projeção do cenário Base",
    "Sugira 3 pontos de pauta para a reunião de resultados"
  ]);

  await carregarClientes();
  await carregarBase();
  refrescar();
})();
