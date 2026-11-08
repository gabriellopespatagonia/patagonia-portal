/* =========================================================
   Componentes de interface compartilhados pelos portais
   ========================================================= */
(function () {
  const PB = window.PB, f = PB.fmt;
  const UI = (PB.ui = {});
  // Paleta da marca: azul Patagonia, azul-noite, azul-gelo + tons naturais (areia, musgo, ferrugem, pedra)
  const COR = {
    teal: "#0070bd", navy: "#0c2a4b", sky: "#5aaee8", amber: "#c2a878", red: "#b4573a", green: "#5f7f5a", grey: "#8a99aa",
    tealLight: "rgba(0,112,189,.16)", redLight: "rgba(180,87,58,.28)"
  };
  UI.COR = COR;
  UI.PALETA = ["#0070bd", "#0c2a4b", "#5aaee8", "#c2a878", "#5f7f5a", "#8a99aa", "#9cc9ea", "#b4573a", "#2f5f8a", "#d9cdb4"];
  if (window.Chart) { Chart.defaults.font.family = "Poppins"; Chart.defaults.color = "#5b6b7d"; }

  /* Navegação lateral + sub-abas */
  UI.navegacao = function (aoTrocar) {
    const links = document.querySelectorAll(".side-link[data-view]");
    const ir = (v) => {
      links.forEach((l) => l.classList.toggle("active", l.dataset.view === v));
      document.querySelectorAll(".view").forEach((s) => s.classList.toggle("active", s.id === "view-" + v));
      const ativo = document.querySelector(`.side-link[data-view="${v}"]`);
      document.getElementById("titulo").textContent = ativo ? ativo.textContent.trim() : "";
      document.querySelector(".sidebar").classList.remove("open");
      history.replaceState(null, "", "#" + v);
      aoTrocar && aoTrocar(v);
    };
    links.forEach((l) => l.addEventListener("click", () => ir(l.dataset.view)));
    document.querySelectorAll(".subtabs").forEach((tabs) => {
      tabs.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
        tabs.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
        const cont = tabs.parentElement;
        cont.querySelectorAll(":scope > .subview").forEach((s) => s.classList.toggle("active", s.id === b.dataset.sub));
        aoTrocar && aoTrocar(null, b.dataset.sub);
      }));
    });
    document.querySelector(".menu-btn")?.addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("open"));
    const inicial = location.hash.slice(1);
    ir(document.querySelector(`.side-link[data-view="${inicial}"]`) ? inicial : links[0].dataset.view);
  };

  /* Tabela de demonstrativo (linhas x meses) */
  UI.tabelaDemonstrativo = function (el, meses, linhas, opts = {}) {
    const total = opts.total !== false;
    const cab = `<tr><th>${opts.titulo || "Conta"}</th>${meses.map((m) => `<th>${f.mes(m)}</th>`).join("")}${total ? "<th>Total</th>" : ""}${opts.av ? "<th>AV %</th>" : ""}</tr>`;
    const base = opts.av ? PB.soma(opts.av, (x) => x) : 0;
    const corpo = linhas.map((l) => {
      const t = PB.soma(l.valores, (x) => x);
      const destaque = ["res", "total", "grp", "sub"].includes(l.estilo);
      const cel = (v) => `<td class="${v < 0 && destaque ? "neg" : ""}">${f.moeda(v)}</td>`;
      const recuo = 12 + (l.nivel || 0) * 18;
      return `<tr class="${l.estilo || ""}"><td style="padding-left:${recuo}px">${PB.esc(l.nome)}</td>${l.valores.map(cel).join("")}${total ? cel(t) : ""}${opts.av ? `<td>${f.pct(base ? t / base : 0)}</td>` : ""}</tr>`;
    }).join("");
    el.innerHTML = `<div class="table-wrap"><table class="data"><thead>${cab}</thead><tbody>${corpo}</tbody></table></div>`;
  };

  UI.tabelaSimples = function (el, colunas, linhas) {
    el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr>${colunas.map((c) => `<th>${c.titulo}</th>`).join("")}</tr></thead><tbody>${
      linhas.map((l) => `<tr class="${l._estilo || ""}">${colunas.map((c) => `<td>${c.fmt ? c.fmt(l[c.campo], l) : PB.esc(l[c.campo])}</td>`).join("")}</tr>`).join("")
    }</tbody></table></div>`;
  };

  /* Gráficos (Chart.js) */
  const charts = {};
  UI.grafico = function (id, config) {
    if (charts[id]) charts[id].destroy();
    const ctx = document.getElementById(id); if (!ctx || !window.Chart) return;
    // linhas sempre desenhadas por cima das barras
    (config.data.datasets || []).forEach((d) => { if (d.order == null) d.order = d.type === "line" ? 0 : 1; });
    config.options = Object.assign({
      responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8, font: { family: "Poppins", size: 11 } } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${config._fmt ? config._fmt(c.parsed.y ?? c.parsed) : f.moeda(c.parsed.y ?? c.parsed)}` } }
      },
      scales: config.type === "doughnut" ? {} : {
        x: { grid: { display: false }, ticks: { font: { family: "Poppins", size: 11 } } },
        y: { grid: { color: "#edf0f3" }, ticks: { font: { family: "Poppins", size: 11 }, callback: (v) => (config._fmt ? config._fmt(v) : compacto(v)) } }
      }
    }, config.options || {});
    charts[id] = new Chart(ctx, config);
  };
  function compacto(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return "R$ " + (v / 1e6).toFixed(1).replace(".", ",") + " mi";
    if (a >= 1e3) return "R$ " + Math.round(v / 1e3) + " mil";
    return "R$ " + v;
  }
  UI.compacto = compacto;

  UI.kpi = (titulo, valor, variacao, legenda) => {
    const cls = variacao == null ? "" : variacao >= 0 ? "up" : "down";
    const seta = variacao == null ? "" : variacao >= 0 ? "▲ " : "▼ ";
    return `<div class="kpi-card"><span>${titulo}</span><b>${valor}</b><small class="${cls}">${seta}${variacao == null ? "" : f.pct(Math.abs(variacao))} ${legenda || ""}</small></div>`;
  };
  UI.variacao = (arr) => (arr.length > 1 && arr.at(-2) ? (arr.at(-1) - arr.at(-2)) / Math.abs(arr.at(-2)) : null);

  /* Exportar tabela para Excel (SheetJS) */
  UI.exportarExcel = function (nomeArquivo, abas) {
    if (!window.XLSX) return alert("Biblioteca de planilhas não carregada.");
    const wb = XLSX.utils.book_new();
    abas.forEach(({ nome, linhas }) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), nome.slice(0, 31)));
    XLSX.writeFile(wb, nomeArquivo);
  };
  UI.demonstrativoParaAoa = (meses, linhas) => [["Conta", ...meses.map(f.mes), "Total"], ...linhas.map((l) => [l.nome, ...l.valores.map(Math.round), Math.round(PB.soma(l.valores, (x) => x))])];

  /* Lista de documentos (SharePoint via API) */
  UI.documentos = async function (el, clienteId) {
    el.innerHTML = `<p class="muted">Carregando documentos…</p>`;
    try {
      const docs = await PB.api.get(`/arquivos?cliente=${encodeURIComponent(clienteId)}`);
      if (!docs.length) { el.innerHTML = `<p class="muted">Nenhum documento disponível ainda.</p>`; return; }
      const pastas = { relatorios: "Relatório", bruto: "Dados enviados", publicado: "Base publicada", contratos: "Contrato" };
      el.innerHTML = `<ul class="doc-list">${docs.map((d) => `<li>
        <div><b>${PB.esc(d.nome)}</b><br><span class="muted" style="font-size:13px">${pastas[d.pasta] || d.pasta} · ${(d.tamanho / 1024).toFixed(0)} KB · ${new Date(d.modificado).toLocaleDateString("pt-BR")}</span></div>
        ${d.url ? `<a class="btn btn-outline btn-sm" href="${d.url}" target="_blank" rel="noopener">Abrir</a>` : `<span class="badge badge-info">SharePoint</span>`}
      </li>`).join("")}</ul>`;
    } catch (e) { el.innerHTML = `<div class="alert alert-error">Não foi possível carregar os documentos: ${PB.esc(e.message)}</div>`; }
  };

  /* Botão "Resumo do período" com observações automáticas + aprofundamento pela IA */
  UI.resumo = function (alvo, { gerar, perguntaIA, clienteId }) {
    alvo.innerHTML = `<div class="resumo-bar"><button type="button" class="btn btn-outline btn-sm">Resumo do período</button></div><div class="resumo hidden"></div>`;
    const btn = alvo.querySelector("button"), box = alvo.querySelector(".resumo");
    let aberto = false;
    function desenhar() {
      const r = gerar();
      box.innerHTML = `<div class="resumo-head"><b>${PB.esc(r.titulo)}</b><button type="button" class="link-btn" data-x>Fechar</button></div>
        <ul>${r.obs.map((o) => `<li>${PB.esc(o)}</li>`).join("")}</ul>
        <div class="resumo-ia"></div>
        <button type="button" class="btn btn-dark btn-sm so-ia" data-ia>Aprofundar a análise com o Claude</button>`;
      box.querySelector("[data-x]").onclick = () => { aberto = false; box.classList.add("hidden"); };
      box.querySelector("[data-ia]").onclick = async (e) => {
        const alvoIA = box.querySelector(".resumo-ia"); e.target.disabled = true;
        alvoIA.innerHTML = `<p class="muted">O Claude está analisando o período…</p>`;
        try {
          const resp = await PB.api.post("/claude", { clienteId: clienteId(), pergunta: perguntaIA(r) });
          alvoIA.innerHTML = `<div class="resumo-texto">${PB.esc(resp.resposta)}</div>`;
        } catch (err) { alvoIA.innerHTML = `<div class="alert alert-error">${PB.esc(err.message)}</div>`; }
        e.target.disabled = false;
      };
    }
    btn.onclick = () => { aberto = !aberto; box.classList.toggle("hidden", !aberto); if (aberto) desenhar(); };
    return { atualizar: () => aberto && desenhar() };
  };

  /* Card de KPI com valor, % sobre faturamento e variação */
  UI.kpiFin = (titulo, valor, pctFat, variacao, legendaVar) => `<div class="kpi-card"><span>${titulo}</span><b class="${valor < 0 ? "down" : ""}">${f.moeda(valor)}</b>
    ${pctFat != null ? `<div class="kpi-pct">${f.pct(pctFat)} <em>do faturamento</em></div>` : ""}
    ${variacao != null ? `<small class="${variacao >= 0 ? "up" : "down"}">${variacao >= 0 ? "▲" : "▼"} ${f.pct(Math.abs(variacao))} ${legendaVar || ""}</small>` : ""}</div>`;

  /* Chat com o Claude */
  UI.chat = function (raiz, obterClienteId, sugestoes) {
    raiz.innerHTML = `
      <div class="chat">
        <div class="suggestions">${sugestoes.map((s) => `<button type="button">${PB.esc(s)}</button>`).join("")}</div>
        <div class="chat-log" aria-live="polite"><div class="msg bot">Olá! Sou o assistente da Patagonia Business, com acesso aos relatórios financeiros e comerciais publicados. Como posso ajudar?</div></div>
        <form class="chat-form"><textarea placeholder="Escreva sua pergunta…" required></textarea><button class="btn btn-primary" type="submit">Enviar</button></form>
      </div>`;
    const log = raiz.querySelector(".chat-log"), form = raiz.querySelector("form"), ta = form.querySelector("textarea");
    const historico = [];
    const add = (txt, quem, extra = "") => { const d = document.createElement("div"); d.className = `msg ${quem} ${extra}`; d.textContent = txt; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; };
    async function enviar(pergunta) {
      add(pergunta, "user"); const carregando = add("Analisando os dados…", "bot", "loading");
      form.querySelector("button").disabled = true;
      try {
        const r = await PB.api.post("/claude", { clienteId: obterClienteId(), pergunta, historico: historico.slice(-10) });
        carregando.classList.remove("loading"); carregando.textContent = r.resposta;
        historico.push({ role: "user", content: pergunta }, { role: "assistant", content: r.resposta });
      } catch (e) { carregando.classList.remove("loading"); carregando.textContent = "Não foi possível obter resposta: " + e.message; }
      form.querySelector("button").disabled = false; log.scrollTop = log.scrollHeight;
    }
    form.addEventListener("submit", (e) => { e.preventDefault(); const p = ta.value.trim(); if (!p) return; ta.value = ""; enviar(p); });
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    raiz.querySelectorAll(".suggestions button").forEach((b) => b.addEventListener("click", () => enviar(b.textContent)));
    return { limpar: () => { historico.length = 0; log.innerHTML = ""; add("Contexto alterado. Como posso ajudar?", "bot"); } };
  };

  UI.usuarioRodape = (u) => {
    const el = document.querySelector(".side-foot");
    if (el) el.innerHTML = `<b>${PB.esc(u.nome || u.email)}</b><span>${u.papel === "consultor" ? "Consultor / BPO" : "Cliente"}</span><br><button class="side-link" style="padding:8px 0;margin-top:6px" id="btn-sair">↩ Sair</button>`;
    document.getElementById("btn-sair")?.addEventListener("click", PB.auth.sair);
    // Sem chave do Claude no servidor: esconde os recursos de IA (classe .so-ia)
    if (u.iaAtiva === false) {
      document.body.classList.add("sem-ia");
      const c = document.getElementById("ex-ia"); if (c) c.checked = false;
      if (location.hash === "#assistente") history.replaceState(null, "", location.pathname);
    }
    if (PB.isDemo()) document.querySelector(".main").insertAdjacentHTML("afterbegin", `<div class="demo-banner"><b>Modo demonstração</b> — dados fictícios, sem servidor. Publicado no Azure, o portal usa os dados reais do SharePoint.</div>`);
  };
})();
