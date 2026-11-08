/* =========================================================
   Núcleo compartilhado: autenticação, API, modelo de dados,
   cálculos financeiros (DRE, DFC, Fluxo) e comerciais.
   Scripts clássicos (sem módulos) para funcionar também
   abrindo os arquivos direto do computador.
   ========================================================= */
(function () {
  const CFG = window.PB_CONFIG;
  const PB = (window.PB = {});

  /* ---------------- Modo ---------------- */
  PB.isDemo = function () {
    if (CFG.modo === "demo") return true;
    if (CFG.modo === "producao") return false;
    const h = location.hostname;
    return location.protocol === "file:" || h === "localhost" || h === "127.0.0.1" || h === "";
  };

  /* ---------------- Formatação ---------------- */
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const brl2 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const num = new Intl.NumberFormat("pt-BR");
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  PB.fmt = {
    moeda: (v) => brl.format(v || 0),
    moeda2: (v) => brl2.format(v || 0),
    num: (v) => num.format(Math.round(v || 0)),
    pct: (v) => (isFinite(v) ? (v * 100).toFixed(1).replace(".", ",") + "%" : "—"),
    mes: (ym) => { const [y, m] = ym.split("-"); return MESES[+m - 1] + "/" + y.slice(2); },
    data: (iso) => iso ? iso.split("-").reverse().join("/") : ""
  };
  PB.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* =========================================================
     MODELO PADRÃO DE DADOS (planilhas de coleta)
     Este é o "contrato" único: todo cliente — com ou sem
     Conta Azul — acaba convertido para estas tabelas.
     ========================================================= */
  PB.MODELO = {
    versao: "1.0",
    abas: {
      Lancamentos: {
        descricao: "Todas as receitas e despesas (realizadas e previstas). Base do DRE, DFC e Fluxo de Caixa.",
        colunas: [
          { campo: "data", titulo: "Data", tipo: "data", obrigatorio: true, ajuda: "Data do pagamento/recebimento (ou vencimento, se previsto)" },
          { campo: "competencia", titulo: "Competência", tipo: "mes", obrigatorio: true, ajuda: "Mês de competência no formato AAAA-MM" },
          { campo: "tipo", titulo: "Tipo", tipo: "lista", opcoes: ["Receita", "Despesa"], obrigatorio: true },
          { campo: "categoria", titulo: "Conta Analítica", tipo: "texto", obrigatorio: true, ajuda: "Nome (ou número) de uma conta analítica da aba PlanoContas" },
          { campo: "descricao", titulo: "Descrição", tipo: "texto" },
          { campo: "valor", titulo: "Valor", tipo: "numero", obrigatorio: true, ajuda: "Sempre positivo" },
          { campo: "status", titulo: "Status", tipo: "lista", opcoes: ["Realizado", "Previsto"], obrigatorio: true },
          { campo: "conta", titulo: "Conta Bancária", tipo: "texto" },
          { campo: "centroCusto", titulo: "Centro de Custo", tipo: "texto" },
          { campo: "contraparte", titulo: "Cliente/Fornecedor", tipo: "texto" }
        ]
      },
      PlanoContas: {
        descricao: "Plano de contas do cliente: contas sintéticas (agrupadoras) e analíticas (que recebem lançamentos). Cada conta analítica é alocada em uma linha da estrutura padrão da DRE e do DFC.",
        colunas: [
          { campo: "numero", titulo: "Número da Conta", tipo: "texto", obrigatorio: true, ajuda: "Código hierárquico, ex.: 5, 5.1, 5.1.01 — a conta superior é deduzida pelo número" },
          { campo: "nome", titulo: "Nome da Conta", tipo: "texto", obrigatorio: true, ajuda: "Nome por extenso, sem abreviações; é o nome usado na coluna Conta Analítica dos lançamentos" },
          { campo: "tipo", titulo: "Tipo da Conta", tipo: "lista", opcoes: ["Sintética", "Analítica"], obrigatorio: true, ajuda: "Sintética agrupa outras contas; Analítica recebe lançamentos" },
          { campo: "refDRE", titulo: "Referência na Estrutura da DRE", tipo: "texto", ajuda: "Obrigatória para contas analíticas: linha da estrutura padrão da DRE (ou “Não compõe a DRE”)" },
          { campo: "refDFC", titulo: "Referência na Estrutura do DFC", tipo: "texto", ajuda: "Obrigatória para contas analíticas: linha da estrutura padrão do DFC (ou “Não compõe o DFC”)" }
        ]
      },
      Contas: {
        descricao: "Contas bancárias e saldo inicial para o Fluxo de Caixa.",
        colunas: [
          { campo: "conta", titulo: "Conta Bancária", tipo: "texto", obrigatorio: true },
          { campo: "banco", titulo: "Banco", tipo: "texto" },
          { campo: "saldoInicial", titulo: "Saldo Inicial", tipo: "numero", obrigatorio: true },
          { campo: "dataSaldo", titulo: "Data do Saldo", tipo: "data", obrigatorio: true }
        ]
      },
      Vendas: {
        descricao: "Uma linha por item vendido. Base do módulo Comercial.",
        colunas: [
          { campo: "data", titulo: "Data", tipo: "data", obrigatorio: true },
          { campo: "numero", titulo: "Nº Venda/NF", tipo: "texto" },
          { campo: "cliente", titulo: "Cliente", tipo: "texto", obrigatorio: true },
          { campo: "item", titulo: "Produto/Serviço", tipo: "texto", obrigatorio: true },
          { campo: "tipoItem", titulo: "Tipo", tipo: "lista", opcoes: ["Produto", "Serviço"], obrigatorio: true },
          { campo: "categoriaItem", titulo: "Linha/Categoria", tipo: "texto" },
          { campo: "quantidade", titulo: "Quantidade", tipo: "numero", obrigatorio: true },
          { campo: "valorUnitario", titulo: "Valor Unitário", tipo: "numero" },
          { campo: "desconto", titulo: "Desconto", tipo: "numero" },
          { campo: "valorTotal", titulo: "Valor Total", tipo: "numero", obrigatorio: true },
          { campo: "vendedor", titulo: "Vendedor", tipo: "texto" },
          { campo: "regiao", titulo: "Região/Cidade", tipo: "texto" }
        ]
      },
      Projecoes: {
        descricao: "Orçamento / projeção mensal por cenário.",
        colunas: [
          { campo: "mes", titulo: "Mês", tipo: "mes", obrigatorio: true },
          { campo: "cenario", titulo: "Cenário", tipo: "lista", opcoes: ["Base", "Otimista", "Conservador"], obrigatorio: true },
          { campo: "receita", titulo: "Receita", tipo: "numero", obrigatorio: true },
          { campo: "custos", titulo: "Custos", tipo: "numero" },
          { campo: "despesas", titulo: "Despesas", tipo: "numero" },
          { campo: "investimentos", titulo: "Investimentos", tipo: "numero" },
          { campo: "observacao", titulo: "Observação", tipo: "texto" }
        ]
      }
    }
  };

  /* Estrutura padrão da DRE e do DFC (assets/js/estrutura.js) */
  PB.E = window.PB_ESTRUTURA;

  /* Índice do plano de contas: localiza a conta analítica pelo nome ou pelo número */
  const idxCache = new WeakMap();
  PB.indicePlano = function (dados) {
    const plano = dados.planoContas || [];
    const c0 = idxCache.get(plano);
    if (c0 && c0.n === plano.length) return c0.m;
    const m = new Map();
    plano.filter((c) => c.tipo !== "Sintética").forEach((c) => { m.set(PB.E.norm(c.nome), c); if (c.numero) m.set(PB.E.norm(c.numero), c); });
    idxCache.set(plano, { n: plano.length, m });
    return m;
  };
  PB.contaDe = (dados, categoria) => PB.indicePlano(dados).get(PB.E.norm(categoria)) || null;

  /* ---------------- Autenticação ---------------- */
  const SESSAO = "pb_sessao";
  PB.auth = {
    async usuario() {
      if (PB.isDemo()) {
        try { return JSON.parse(sessionStorage.getItem(SESSAO)); } catch { return null; }
      }
      try {
        const r = await fetch("/.auth/me");
        const { clientPrincipal } = await r.json();
        if (!clientPrincipal) return null;
        // { nome, papel, clienteId } — vem do cadastro de usuários no SharePoint
        const perfil = await PB.api.get("/perfil").catch(() => null);
        if (!perfil) return { email: clientPrincipal.userDetails, semCadastro: true };
        return { email: clientPrincipal.userDetails, ...perfil };
      } catch { return null; }
    },
    loginDemo(email, senha) {
      const u = CFG.usuariosDemo.find((x) => x.email.toLowerCase() === email.trim().toLowerCase() && x.senha === senha);
      if (!u) return null;
      const { senha: _s, ...sessao } = u;
      sessionStorage.setItem(SESSAO, JSON.stringify(sessao));
      return sessao;
    },
    loginMicrosoft(destino) {
      location.href = `/.auth/login/${CFG.provedorLogin}?post_login_redirect_uri=${encodeURIComponent(destino)}`;
    },
    sair() {
      sessionStorage.removeItem(SESSAO);
      location.href = PB.isDemo() ? PB.raiz() + "login.html" : "/.auth/logout?post_logout_redirect_uri=/";
    },
    async exigir(papel) {
      const u = await PB.auth.usuario();
      if (u && u.semCadastro) { location.replace(PB.raiz() + "login.html?erro=403"); return null; }
      if (!u ||(papel && u.papel !== papel && u.papel !== "consultor")) {
        location.replace(PB.raiz() + "login.html?destino=" + papel);
        return null;
      }
      return u;
    }
  };
  // caminho relativo até a raiz do site (portais ficam em subpastas)
  PB.raiz = () => (/\/(cliente|consultor)\//.test(location.pathname.replace(/\\/g, "/")) ? "../" : "");

  /* ---------------- API (real ou demonstração) ---------------- */
  PB.api = {
    async get(rota) {
      if (PB.isDemo()) return PB.demoApi("GET", rota);
      const r = await fetch(CFG.apiBase + rota, { credentials: "include" });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      return r.json();
    },
    post(rota, corpo) { return PB.api.enviar("POST", rota, corpo); },
    patch(rota, corpo) { return PB.api.enviar("PATCH", rota, corpo); },
    excluir(rota) { return PB.api.enviar("DELETE", rota); },
    async enviar(metodo, rota, corpo) {
      if (PB.isDemo()) return PB.demoApi(metodo, rota, corpo);
      const r = await fetch(CFG.apiBase + rota, {
        method: metodo, credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo)
      });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      return r.json();
    }
  };

  /* =========================================================
     CÁLCULOS
     ========================================================= */
  const soma = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
  PB.soma = soma;
  PB.mesesEntre = function (ini, fim) {
    const out = []; let [y, m] = ini.split("-").map(Number);
    const [yf, mf] = fim.split("-").map(Number);
    while (y < yf || (y === yf && m <= mf)) { out.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } }
    return out;
  };
  PB.mesesDisponiveis = (dados) => {
    const s = new Set(dados.lancamentos.filter((l) => l.status === "Realizado").map((l) => l.competencia));
    dados.vendas.forEach((v) => s.add(v.data.slice(0, 7)));
    return [...s].sort();
  };
  /*
   * Agrupa os lançamentos realizados por linha da estrutura (DRE ou DFC), usando a
   * referência de cada conta analítica do plano. Valores assinados: receita +, despesa −.
   * Contas sem plano de contas vão para uma linha provisória e são devolvidas em "naoClassificadas".
   */
  function agrupar(dados, meses, tipo, mesDe) {
    const ref = tipo === "DRE" ? "refDRE" : "refDFC", NAO = tipo === "DRE" ? PB.E.NAO_DRE : PB.E.NAO_DFC;
    const folhas = {}, contas = {}, naoClass = new Set();
    dados.lancamentos.forEach((l) => {
      if (l.status !== "Realizado") return;
      const i = meses.indexOf(mesDe(l)); if (i < 0) return;
      const c = PB.contaDe(dados, l.categoria);
      let linha = c && c[ref];
      if (linha === NAO) return;
      if (!linha) {
        naoClass.add(l.categoria);
        linha = tipo === "DRE" ? (l.tipo === "Receita" ? "Receita Bruta" : "Despesas Administrativas") : (l.tipo === "Receita" ? "Outras Entradas" : "Despesas Administrativas");
      }
      const v = l.tipo === "Receita" ? l.valor : -l.valor;
      (folhas[linha] = folhas[linha] || meses.map(() => 0))[i] += v;
      const chave = c ? c.numero || c.nome : l.categoria;
      const lista = (contas[linha] = contas[linha] || {});
      (lista[chave] = lista[chave] || { numero: c ? c.numero : "", nome: c ? c.nome : `${l.categoria} (sem plano de contas)`, valores: meses.map(() => 0) }).valores[i] += v;
    });
    const contasArr = Object.fromEntries(Object.entries(contas).map(([k, o]) => [k, Object.values(o)]));
    return { ...PB.E.calcular(tipo, folhas, contasArr, meses.length), naoClassificadas: [...naoClass] };
  }

  /* DRE por competência (somente realizado) — estrutura padrão */
  PB.calc = {};
  PB.calc.dre = function (dados, meses) {
    const r = agrupar(dados, meses, "DRE", (l) => l.competencia);
    const v = r.valor;
    const rb = v("RB");
    return {
      meses, linhas: r.linhas, naoClassificadas: r.naoClassificadas, valor: v,
      totais: {
        receitaBruta: rb, deducoes: v("DED"), receitaLiquida: v("RL"),
        custosVariaveis: v("CV"), despesasVariaveis: v("DV"), despesasFixas: v("DF"),
        margemContribuicao: v("MC"), lucroBruto: v("MC"), ebitda: v("EBITDA"), ebit: v("EBIT"),
        naoOperacional: v("RNO"), financeiro: v("RF"), antesImpostos: v("RAIR"),
        liquido: v("RLIQ"), aposDistribuicoes: v("RLAD")
      },
      // margens sempre sobre o faturamento (receita bruta)
      margem: (arr) => arr.map((x, i) => (rb[i] ? x / rb[i] : 0))
    };
  };
  /* Composição de grupos da DRE por conta analítica (valores positivos = gasto) */
  PB.calc.composicao = function (dados, meses, grupos) {
    const r = agrupar(dados, meses, "DRE", (l) => l.competencia);
    const ids = new Set(PB.E.DRE.filter((n) => grupos.includes(n.pai) || grupos.includes(n.id)).map((n) => n.id));
    const porGrupo = [], porCategoria = [];
    let linhaAtual = null;
    r.linhas.forEach((l) => {
      if (l.tipo === "linha") linhaAtual = ids.has(l.id) ? l : null;
      if (l.tipo === "linha" && linhaAtual) { const val = l.valores.map((x) => -x); const t = soma(val, (x) => x); if (t > 0) porGrupo.push({ nome: l.rotulo, valores: val, total: t }); }
      if (l.tipo === "conta" && linhaAtual) { const val = l.valores.map((x) => -x); const t = soma(val, (x) => x); if (t > 0) porCategoria.push({ nome: l.nome.replace(/^[\d.]+ · /, ""), valores: val, total: t }); }
      if (l.tipo !== "linha" && l.tipo !== "conta") linhaAtual = null;
    });
    const ord = (a) => a.sort((x, y) => y.total - x.total);
    return { porGrupo: ord(porGrupo), porCategoria: ord(porCategoria) };
  };

  /* Fluxo de caixa mensal (realizado + previsto) */
  PB.calc.fluxo = function (dados, meses) {
    const saldoIni0 = soma(dados.contas, (c) => c.saldoInicial);
    const dataIni = dados.contas.reduce((m, c) => (c.dataSaldo < m ? c.dataSaldo : m), "9999");
    const ent = meses.map(() => 0), sai = meses.map(() => 0), entP = meses.map(() => 0), saiP = meses.map(() => 0);
    let antes = 0;
    dados.lancamentos.forEach((l) => {
      const c = PB.contaDe(dados, l.categoria);
      if (c && c.refDFC === PB.E.NAO_DFC) return; // ex.: depreciação — não movimenta caixa
      const ym = l.data.slice(0, 7); const v = l.tipo === "Receita" ? l.valor : -l.valor;
      const i = meses.indexOf(ym);
      if (i < 0) { if (ym < meses[0] && l.data >= dataIni && l.status === "Realizado") antes += v; return; }
      if (l.status === "Realizado") (v > 0 ? ent : sai)[i] += Math.abs(v);
      else (v > 0 ? entP : saiP)[i] += Math.abs(v);
    });
    let saldo = saldoIni0 + antes;
    const linhas = meses.map((m, i) => {
      const ini = saldo; const e = ent[i] + entP[i]; const s = sai[i] + saiP[i];
      saldo = ini + e - s;
      return { mes: m, saldoInicial: ini, entradas: e, saidas: s, liquido: e - s, saldoFinal: saldo, previsto: entP[i] + saiP[i] > 0 && ent[i] + sai[i] === 0 };
    });
    return { linhas };
  };

  /* DFC — método direto por atividade */
  /* DFC — método direto, estrutura padrão (data de pagamento/recebimento) */
  PB.calc.dfc = function (dados, meses) {
    const r = agrupar(dados, meses, "DFC", (l) => l.data.slice(0, 7));
    const v = r.valor;
    const totais = { OPE: v("FCO"), FIN: v("FCF"), INV: v("FCI"), entradasFCO: v("ENT_FCO"), saidasFCO: v("SAI_FCO") };
    return { meses, linhas: r.linhas, naoClassificadas: r.naoClassificadas, valor: v, totais, variacao: v("VAR") };
  };

  /* Comercial */
  PB.calc.comercial = function (dados, meses) {
    const vs = dados.vendas.filter((v) => meses.includes(v.data.slice(0, 7)));
    const porMes = meses.map((m) => vs.filter((v) => v.data.startsWith(m)));
    const primeiraCompra = {};
    [...dados.vendas].sort((a, b) => a.data.localeCompare(b.data)).forEach((v) => { if (!primeiraCompra[v.cliente]) primeiraCompra[v.cliente] = v.data.slice(0, 7); });
    const agrupa = (arr, chave) => {
      const m = {};
      arr.forEach((v) => { const k = v[chave] || "(não informado)"; m[k] = m[k] || { nome: k, valor: 0, qtd: 0, vendas: new Set() }; m[k].valor += v.valorTotal; m[k].qtd += v.quantidade; m[k].vendas.add(v.numero || v.data + v.cliente); });
      return Object.values(m).map((x) => ({ ...x, vendas: x.vendas.size })).sort((a, b) => b.valor - a.valor);
    };
    const pedidos = (arr) => new Set(arr.map((v) => v.numero || v.data + v.cliente)).size;
    return {
      meses,
      faturamento: porMes.map((a) => soma(a, (v) => v.valorTotal)),
      pedidos: porMes.map(pedidos),
      ticket: porMes.map((a) => (pedidos(a) ? soma(a, (v) => v.valorTotal) / pedidos(a) : 0)),
      clientesAtivos: porMes.map((a) => new Set(a.map((v) => v.cliente)).size),
      novosClientes: meses.map((m) => Object.values(primeiraCompra).filter((x) => x === m).length),
      porTipo: agrupa(vs, "tipoItem"),
      porItem: agrupa(vs, "item"),
      porCliente: agrupa(vs, "cliente"),
      porVendedor: agrupa(vs, "vendedor"),
      porCategoria: agrupa(vs, "categoriaItem"),
      total: soma(vs, (v) => v.valorTotal),
      totalPedidos: pedidos(vs),
      totalClientes: new Set(vs.map((v) => v.cliente)).size
    };
  };

  /* Resumo compacto (enviado ao Claude como contexto) */
  PB.resumoParaIA = function (dados) {
    const meses = PB.mesesDisponiveis(dados).slice(-12);
    const dre = PB.calc.dre(dados, meses); const com = PB.calc.comercial(dados, meses);
    const fl = PB.calc.fluxo(dados, PB.mesesEntre(meses[0], (dados.projecoes.at(-1) || {}).mes || meses.at(-1)));
    return {
      cliente: dados.cliente, meses,
      dre: dre.linhas.filter((l) => !l.nivel).map((l) => ({ linha: l.nome, valores: l.valores.map(Math.round) })),
      comercial: { faturamento: com.faturamento.map(Math.round), pedidos: com.pedidos, ticketMedio: com.ticket.map(Math.round), clientesAtivos: com.clientesAtivos,
        topClientes: com.porCliente.slice(0, 10).map((c) => [c.nome, Math.round(c.valor)]), topItens: com.porItem.slice(0, 10).map((c) => [c.nome, Math.round(c.valor)]) },
      fluxoCaixa: fl.linhas.map((l) => ({ mes: l.mes, saldoFinal: Math.round(l.saldoFinal), previsto: l.previsto })),
      projecoes: dados.projecoes
    };
  };
})();
