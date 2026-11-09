/* =========================================================
   Importação e padronização de dados
   - Gera os modelos de planilha (padrão Patagonia)
   - Lê planilhas padrão e exportações do Conta Azul
   - Converte tudo para o MODELO único e valida
   ========================================================= */
(function () {
  const PB = window.PB, M = PB.MODELO;
  const IMP = (PB.importacao = {});

  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

  /* ---------- Conversões de tipo ---------- */
  function paraData(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date && !isNaN(v)) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    if (typeof v === "number") { const d = XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}` : null; }
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
    return null;
  }
  function paraMes(v) {
    if (v == null || v === "") return null;
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-\/](\d{1,2})$/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
    m = s.match(/^(\d{1,2})[-\/](\d{4})$/); if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
    const d = paraData(v); return d ? d.slice(0, 7) : null;
  }
  function paraNumero(v) {
    if (typeof v === "number") return v;
    if (v == null || v === "") return null;
    let s = String(v).replace(/[R$\s]/g, "");
    if (/,\d{1,2}$/.test(s) || (s.includes(",") && s.includes("."))) s = s.replace(/\./g, "").replace(",", ".");
    const n = parseFloat(s); return isNaN(n) ? null : n;
  }
  function converter(col, v) {
    if (col.tipo === "raw") return v;
    if (col.tipo === "data") return paraData(v);
    if (col.tipo === "mes") return paraMes(v);
    if (col.tipo === "numero") return paraNumero(v);
    if (col.tipo === "lista") {
      if (v == null || v === "") return null;
      const achado = col.opcoes.find((o) => norm(o) === norm(v)); return achado || String(v).trim();
    }
    return v == null ? "" : String(v).trim();
  }

  /* Lê uma aba procurando a linha de cabeçalho e associando colunas por nome/apelido */
  function lerAba(ws, colunas, apelidos = {}) {
    const linhas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const alvo = colunas.map((c) => [norm(c.titulo), norm(c.campo), ...(apelidos[c.campo] || []).map(norm)]);
    let iCab = -1, mapa = {};
    for (let i = 0; i < Math.min(linhas.length, 25); i++) {
      const m = {};
      (linhas[i] || []).forEach((h, j) => { const n = norm(h); colunas.forEach((c, k) => { if (m[c.campo] == null && alvo[k].includes(n)) m[c.campo] = j; }); });
      const obrig = colunas.filter((c) => c.obrigatorio && !(c.campo in (apelidos._opcionais || {})));
      if (Object.keys(m).length >= Math.max(2, Math.ceil(obrig.length * 0.6))) { iCab = i; mapa = m; break; }
    }
    if (iCab < 0) return { registros: [], mapa: {}, erro: "Cabeçalho não reconhecido" };
    const registros = [];
    for (let i = iCab + 1; i < linhas.length; i++) {
      const L = linhas[i]; if (!L || L.every((x) => x == null || x === "")) continue;
      const r = { _linha: i + 1 };
      colunas.forEach((c) => { r[c.campo] = mapa[c.campo] != null ? converter(c, L[mapa[c.campo]]) : null; });
      registros.push(r);
    }
    return { registros, mapa };
  }
  const acharAba = (wb, nome) => wb.SheetNames.find((n) => norm(n) === norm(nome) || norm(n).startsWith(norm(nome).slice(0, 6)));

  /* ---------- Planilha padrão Patagonia ---------- */
  IMP.lerPadrao = function (wb) {
    const out = {}, avisos = [];
    Object.entries(M.abas).forEach(([nome, def]) => {
      const aba = acharAba(wb, nome);
      if (!aba) { avisos.push(`Aba "${nome}" não encontrada — mantida a base atual.`); return; }
      const r = lerAba(wb.Sheets[aba], def.colunas);
      if (r.erro) avisos.push(`Aba "${nome}": ${r.erro}`); else out[chaveDe(nome)] = r.registros;
    });
    return { parcial: out, avisos };
  };
  const chaveDe = (aba) => ({ Lancamentos: "lancamentos", PlanoContas: "planoContas", Contas: "contas", Vendas: "vendas", Projecoes: "projecoes" }[aba]);

  /* ---------- Conta Azul: extrato / contas a pagar e receber ---------- */
  const CA_FIN = [
    { campo: "competencia", titulo: "Data de competência", tipo: "raw" },
    { campo: "vencimento", titulo: "Data de vencimento", tipo: "raw" },
    { campo: "pagamento", titulo: "Data do pagamento", tipo: "raw" },
    { campo: "data", titulo: "Data", tipo: "raw" },
    { campo: "descricao", titulo: "Descrição", tipo: "texto" },
    { campo: "categoria", titulo: "Categoria", tipo: "texto", obrigatorio: true },
    { campo: "valor", titulo: "Valor", tipo: "numero", obrigatorio: true },
    { campo: "tipo", titulo: "Tipo", tipo: "texto" },
    { campo: "situacao", titulo: "Situação", tipo: "texto" },
    { campo: "conta", titulo: "Conta bancária", tipo: "texto" },
    { campo: "centroCusto", titulo: "Centro de custo", tipo: "texto" },
    { campo: "contraparte", titulo: "Cliente/Fornecedor", tipo: "texto" }
  ];
  const CA_FIN_APELIDOS = {
    competencia: ["competencia", "datacompetencia", "mescompetencia"],
    vencimento: ["vencimento", "datavencimento"],
    pagamento: ["datapagamento", "pagamento", "datadopagamento", "datadebaixa", "datarecebimento", "dataquitacao"],
    data: ["datamovimentacao", "datadamovimentacao", "datalancamento"],
    categoria: ["categoria1", "categoriafinanceira", "planodecontas"],
    valor: ["valorr", "valorrs", "valorliquido", "valortotal", "valororiginal"],
    tipo: ["receitadespesa", "natureza", "tipodelancamento", "tipomovimentacao"],
    situacao: ["status", "situacaodolancamento"],
    conta: ["conta", "contafinanceira", "banco"],
    centroCusto: ["centrodecusto1", "centrodecustos"],
    contraparte: ["nomedoclientefornecedor", "clientefornecedor", "fornecedor", "cliente", "contato", "favorecido"]
  };
  IMP.lerContaAzulFinanceiro = function (wb, tipoForcado) {
    const r = lerAba(wb.Sheets[wb.SheetNames[0]], CA_FIN, CA_FIN_APELIDOS);
    if (r.erro) return { parcial: {}, avisos: [r.erro + " (verifique se é a exportação do extrato do Conta Azul)"] };
    const quitado = /quitad|pag|receb|conciliad|baixad|liquidad/;
    const lanc = r.registros.map((x) => {
      const pg = paraData(x.pagamento), venc = paraData(x.vencimento), dt = paraData(x.data);
      const realizado = !!pg || quitado.test(norm(x.situacao)) || (!!dt && !venc);
      let tipo = norm(x.tipo).startsWith("rec") || norm(x.tipo).startsWith("entr") ? "Receita" : norm(x.tipo).startsWith("desp") || norm(x.tipo).startsWith("sai") ? "Despesa" : null;
      if (tipoForcado) tipo = tipoForcado;
      if (!tipo) tipo = (x.valor || 0) < 0 ? "Despesa" : "Receita";
      const data = pg || dt || venc;
      const competencia = paraMes(x.competencia) || (data ? data.slice(0, 7) : null);
      // não pago com competência já ocorrida = "Em aberto" (entra na DRE por competência; no caixa, previsto no vencimento)
      const status = realizado ? "Realizado" : competencia && competencia <= new Date().toISOString().slice(0, 7) ? "Em aberto" : "Previsto";
      return {
        _linha: x._linha, data, competencia, tipo,
        categoria: x.categoria, descricao: x.descricao, valor: Math.abs(x.valor || 0) || null,
        status, conta: x.conta, centroCusto: x.centroCusto, contraparte: x.contraparte
      };
    });
    return { parcial: { lancamentos: lanc }, avisos: [`Colunas reconhecidas: ${Object.keys(r.mapa).join(", ")}`] };
  };

  /* ---------- Conta Azul: relatório de vendas ---------- */
  const CA_VENDAS_APELIDOS = {
    data: ["datadavenda", "dataemissao", "datadeemissao", "emissao"],
    numero: ["numero", "numerodavenda", "n", "nvenda", "notafiscal", "nf", "pedido"],
    cliente: ["nomedocliente", "razaosocial"],
    item: ["produto", "servico", "produtoservico", "descricaodoitem", "item", "nomedoproduto"],
    tipoItem: ["tipo", "tipodoitem"],
    categoriaItem: ["categoria", "categoriadoproduto", "linha", "grupo"],
    quantidade: ["qtd", "qtde", "quant"],
    valorUnitario: ["precounitario", "valorunit", "preco"],
    desconto: ["descontos", "valordesconto"],
    valorTotal: ["total", "valor", "valorliquido", "subtotal", "valordavenda"],
    vendedor: ["vendedorresponsavel", "responsavel"],
    regiao: ["cidade", "uf", "estado"]
  };
  IMP.lerContaAzulVendas = function (wb, tipoPadrao) {
    const r = lerAba(wb.Sheets[wb.SheetNames[0]], M.abas.Vendas.colunas, CA_VENDAS_APELIDOS);
    if (r.erro) return { parcial: {}, avisos: [r.erro] };
    const vendas = r.registros.map((v) => ({
      ...v, tipoItem: v.tipoItem && /serv/i.test(v.tipoItem) ? "Serviço" : v.tipoItem && /prod/i.test(v.tipoItem) ? "Produto" : tipoPadrao,
      quantidade: v.quantidade ?? 1, valorTotal: v.valorTotal ?? ((v.quantidade || 1) * (v.valorUnitario || 0) - (v.desconto || 0))
    }));
    return { parcial: { vendas }, avisos: [`Colunas reconhecidas: ${Object.keys(r.mapa).join(", ")}`] };
  };

  /* ---------- Conta Azul via API: extrato completo (competência + caixa) ----------
   * Cada parcela vira:
   *  - uma linha "Realizado" por baixa (data de caixa = data do pagamento, conta da baixa), por categoria e centro de custo;
   *  - juros/multa, descontos e taxas de cada baixa em linhas próprias (competência = mês do pagamento);
   *  - o saldo não pago: "Em aberto" (competência já ocorrida, entra na DRE; caixa previsto no vencimento)
   *    ou "Previsto" (competência futura).
   * A competência de cada linha é a do evento financeiro, então a DRE reproduz o regime de competência do Conta Azul
   * e o DFC/Fluxo reproduzem o extrato de caixa.
   */
  IMP.AJUSTES_CA = {
    jurosRec: { tipo: "Receita", categoria: "Juros e Multas Recebidos" },
    jurosPag: { tipo: "Despesa", categoria: "Juros e Tarifas Bancárias" },
    descConc: { tipo: "Despesa", categoria: "Devoluções e Descontos Concedidos" },
    descObt: { tipo: "Receita", categoria: "Descontos Obtidos" },
    taxa: { tipo: "Despesa", categoria: "Juros e Tarifas Bancárias" }
  };
  IMP.montarContaAzulAPI = function (lista, det) {
    const avisos = [], lanc = [], r2 = (v) => Math.round(v * 100) / 100;
    const mesAtual = lista.periodo.hoje.slice(0, 7);
    const detP = new Map((det.parcelas || []).map((d) => [d.id, d]));
    let semDetalhe = 0, perdidas = 0, renegociadas = 0;
    const add = (o) => { if (o.valor >= 0.005) lanc.push({ _linha: lanc.length + 1, fonte: "contaazul", ...o, valor: r2(o.valor) }); };
    lista.parcelas.forEach((p) => {
      const d = detP.get(p.id);
      const comp = String((d && d.competencia) || p.competencia || p.vencimento || lista.periodo.ini).slice(0, 7);
      // partes de rateio (categoria × centro de custo) com a fração do valor de cada uma
      let partes = [];
      const rat = (d && d.rateio || []).filter((r) => r.valor > 0);
      const somaR = rat.reduce((s, r) => s + r.valor, 0);
      if (somaR > 0) rat.forEach((r) => {
        const cc = r.centros.filter((c) => c.valor > 0), somaC = cc.reduce((s, c) => s + c.valor, 0);
        if (somaC > 0) cc.forEach((c) => partes.push({ categoria: r.categoria, centro: c.nome, f: (r.valor / somaR) * (c.valor / somaC) }));
        else partes.push({ categoria: r.categoria, centro: "", f: r.valor / somaR });
      });
      if (!partes.length) {
        const cats = p.categorias.length ? p.categorias : ["Sem categoria"];
        partes = cats.map((c) => ({ categoria: c, centro: p.centros.length === 1 ? p.centros[0] : "", f: 1 / cats.length }));
      }
      const base = { tipo: p.tipo, descricao: p.descricao, contraparte: p.contraparte, idOrigem: p.id };
      // pagamentos (caixa)
      const baixas = (d && d.baixas) || [];
      if (p.pago > 0 && !baixas.length) semDetalhe++;
      baixas.forEach((b) => {
        if (!b.data) return;
        const principal = b.bruto || b.liquido;
        partes.forEach((x) => add({ ...base, data: b.data, competencia: comp, categoria: x.categoria, centroCusto: x.centro, conta: b.conta, status: "Realizado", valor: principal * x.f }));
        const compPg = b.data.slice(0, 7), rec = p.tipo === "Receita";
        const extra = (aj, v, txt) => v > 0 && add({ ...base, ...IMP.AJUSTES_CA[aj], descricao: `${txt} — ${p.descricao}`, data: b.data, competencia: compPg, centroCusto: "", conta: b.conta, status: "Realizado", valor: v });
        extra(rec ? "jurosRec" : "jurosPag", b.juros + b.multa, "Juros/multa");
        extra(rec ? "descConc" : "descObt", b.desconto, "Desconto");
        extra("taxa", b.taxa, "Taxa");
      });
      // saldo não pago
      const st = String((d && d.status) || p.status).toUpperCase();
      if (p.naoPago > 0.005) {
        if (/PERDID|CANCEL/.test(st)) perdidas++;
        else if (/RENEGOCI/.test(st)) renegociadas++;
        else partes.forEach((x) => add({ ...base, data: p.vencimento || `${comp}-01`, competencia: comp, categoria: x.categoria, centroCusto: x.centro, conta: (d && d.conta) || "", status: comp <= mesAtual ? "Em aberto" : "Previsto", valor: p.naoPago * x.f }));
      }
    });
    if (semDetalhe) avisos.push(`${semDetalhe} parcela(s) pagas sem detalhe de baixa (falha na consulta) — refaça a busca para completar o caixa.`);
    if (perdidas) avisos.push(`${perdidas} parcela(s) perdidas/canceladas: o valor não recebido ficou fora dos relatórios.`);
    if (renegociadas) avisos.push(`${renegociadas} parcela(s) renegociadas: o saldo original foi ignorado (as novas parcelas da renegociação entram no lugar).`);

    // Contas bancárias: saldo no início do período = saldo atual − movimentos realizados desde então (inclui transferências)
    const mov = {};
    lanc.forEach((l) => { if (l.status === "Realizado" && l.data >= lista.periodo.ini) mov[l.conta] = (mov[l.conta] || 0) + (l.tipo === "Receita" ? l.valor : -l.valor); });
    (lista.transferencias || []).forEach((t) => { if (t.data >= lista.periodo.ini) { mov[t.origem] = (mov[t.origem] || 0) - t.valor; mov[t.destino] = (mov[t.destino] || 0) + t.valor; } });
    const diaAntes = new Date(Date.parse(lista.periodo.ini) - 864e5).toISOString().slice(0, 10);
    const contas = (lista.contas || []).filter((c) => c.saldoAtual != null && (c.ativo || mov[c.nome])).map((c, i) => ({ _linha: i + 1, conta: c.nome, banco: c.banco, saldoInicial: r2(c.saldoAtual - (mov[c.nome] || 0)), dataSaldo: diaAntes }));
    const semSaldo = (lista.contas || []).filter((c) => c.saldoAtual == null).length;
    if (semSaldo) avisos.push(`${semSaldo} conta(s) financeira(s) sem saldo atual informado pelo Conta Azul — confira os saldos iniciais.`);
    if (contas.length) avisos.push(`Saldo das ${contas.length} conta(s) em ${diaAntes.split("-").reverse().join("/")} reconstruído a partir do saldo atual e das movimentações.`);

    // Vendas: uma linha por item (sem orçamentos nem canceladas)
    const itens = new Map((det.vendas || []).map((v) => [v.id, v.itens]));
    const vendas = [];
    (lista.vendas || []).filter((v) => !/CANCEL|ORCAMENTO|ORÇAMENTO|RECUSAD|ESPERANDO/i.test(v.situacao)).forEach((v) => {
      const its = itens.get(v.id);
      const tipoV = /serv/i.test(v.tipo) ? "Serviço" : "Produto";
      if (its && its.length) {
        const somaItens = its.reduce((s, i) => s + i.quantidade * i.valor, 0) || 1;
        its.forEach((i) => vendas.push({ _linha: vendas.length + 1, data: v.data, numero: v.numero, cliente: v.cliente || "(não informado)", item: i.nome, tipoItem: /serv/i.test(i.tipo) ? "Serviço" : /prod/i.test(i.tipo) ? "Produto" : tipoV, categoriaItem: "", quantidade: i.quantidade, valorUnitario: r2(i.valor), desconto: r2(Math.max(0, i.quantidade * i.valor - (v.total * (i.quantidade * i.valor)) / somaItens)), valorTotal: r2((v.total * (i.quantidade * i.valor)) / somaItens), vendedor: "", regiao: v.cidade }));
      } else vendas.push({ _linha: vendas.length + 1, data: v.data, numero: v.numero, cliente: v.cliente || "(não informado)", item: "Venda", tipoItem: tipoV, categoriaItem: "", quantidade: 1, valorUnitario: v.total, desconto: 0, valorTotal: v.total, vendedor: "", regiao: v.cidade });
    });
    if ((det.totalFalhas || 0) > 0) avisos.push(`${det.totalFalhas} consulta(s) de detalhe falharam. Exemplo: ${det.falhas[0]}`);
    const parcial = { lancamentos: lanc };
    if (contas.length) parcial.contas = contas;
    if (vendas.length) parcial.vendas = vendas;
    avisos.push(`Montados ${lanc.length} lançamentos (${lanc.filter((l) => l.status === "Realizado").length} realizados, ${lanc.filter((l) => l.status === "Em aberto").length} em aberto, ${lanc.filter((l) => l.status === "Previsto").length} previstos) e ${vendas.length} itens de venda.`);
    return { parcial, avisos };
  };

  /* ---------- Validação ---------- */
  IMP.validar = function (parcial, planoAtual) {
    const erros = [], alertas = [];
    Object.entries(parcial).forEach(([chave, regs]) => {
      if (chave === "planoContas") return; // validado por IMP.validarPlano
      const aba = Object.keys(M.abas).find((a) => chaveDe(a) === chave);
      const cols = M.abas[aba].colunas;
      regs.forEach((r) => cols.forEach((c) => {
        const v = r[c.campo];
        if (c.obrigatorio && (v == null || v === "")) erros.push({ aba, linha: r._linha, msg: `${c.titulo} vazio ou inválido` });
        else if (c.tipo === "lista" && v && !c.opcoes.includes(v)) erros.push({ aba, linha: r._linha, msg: `${c.titulo} "${v}" não é válido (${c.opcoes.join(", ")})` });
        else if (c.tipo === "numero" && c.campo === "valor" && v < 0) alertas.push({ aba, linha: r._linha, msg: "Valor negativo convertido para positivo" });
      }));
    });
    (parcial.lancamentos || []).forEach((l) => { if (l.valor < 0) l.valor = Math.abs(l.valor); });
    // plano de contas importado junto: validação própria
    if (parcial.planoContas) {
      const vp = IMP.validarPlano(parcial.planoContas);
      vp.erros.forEach((e) => erros.push({ aba: "PlanoContas", ...e })); vp.alertas.forEach((e) => alertas.push({ aba: "PlanoContas", ...e }));
      parcial.planoContas = vp.plano;
    }
    // contas dos lançamentos que não existem como conta analítica no plano
    const ref = { planoContas: parcial.planoContas || planoAtual || [] };
    const semPlano = [...new Set((parcial.lancamentos || []).map((l) => l.categoria).filter((c) => c && !PB.contaDe(ref, c)))];
    // duplicidades simples
    const vistos = new Set(); let dup = 0;
    (parcial.lancamentos || []).forEach((l) => { const k = [l.idOrigem || "", l.data, l.categoria, l.centroCusto || "", l.status, l.valor, l.descricao, l.contraparte].join("|"); if (vistos.has(k)) dup++; vistos.add(k); });
    if (dup) alertas.push({ aba: "Lancamentos", linha: "-", msg: `${dup} lançamento(s) possivelmente duplicado(s) (mesma data, categoria, valor e descrição)` });
    return { erros, alertas, semPlano };
  };

  /* =========================================================
     PLANO DE CONTAS — validação, leitura e planilha padrão
     ========================================================= */
  const ordemNumero = (a, b) => String(a.numero).localeCompare(String(b.numero), "pt-BR", { numeric: true });
  const contaSuperior = (numero, numeros) => {
    const partes = String(numero).split(".");
    for (let k = partes.length - 1; k > 0; k--) { const p = partes.slice(0, k).join("."); if (numeros.has(p)) return p; }
    return null;
  };

  /** Valida e normaliza o plano. Retorna { plano, erros, alertas }. */
  IMP.validarPlano = function (registros) {
    const erros = [], alertas = [], vistosNum = new Set(), vistosNome = new Map();
    const plano = registros.map((r) => {
      const t = norm(r.tipo);
      const tipo = t.startsWith("s") ? "Sintética" : t.startsWith("a") ? "Analítica" : r.tipo;
      return { _linha: r._linha, numero: String(r.numero ?? "").trim(), nome: String(r.nome ?? "").trim(), tipo, refDRE: r.refDRE || "", refDFC: r.refDFC || "" };
    }).filter((c) => c.numero || c.nome);
    const numeros = new Set(plano.map((c) => c.numero));
    plano.forEach((c) => {
      const L = c._linha ?? "-";
      if (!c.numero) erros.push({ linha: L, msg: `Conta "${c.nome}" sem Número da Conta` });
      else if (vistosNum.has(c.numero)) erros.push({ linha: L, msg: `Número da Conta ${c.numero} repetido` });
      vistosNum.add(c.numero);
      if (!c.nome) erros.push({ linha: L, msg: `Conta ${c.numero} sem Nome da Conta` });
      if (!["Sintética", "Analítica"].includes(c.tipo)) erros.push({ linha: L, msg: `Conta ${c.numero}: Tipo da Conta deve ser "Sintética" ou "Analítica"` });
      if (c.tipo === "Analítica") {
        const k = PB.E.norm(c.nome);
        if (vistosNome.has(k)) erros.push({ linha: L, msg: `Nome "${c.nome}" repetido em contas analíticas (${vistosNome.get(k)} e ${c.numero}) — os lançamentos ficariam ambíguos` });
        vistosNome.set(k, c.numero);
        const d = PB.E.acharReferencia("DRE", c.refDRE), f2 = PB.E.acharReferencia("DFC", c.refDFC);
        if (!c.refDRE) erros.push({ linha: L, msg: `Conta analítica ${c.numero} — ${c.nome}: falta a Referência na Estrutura da DRE` });
        else if (!d) erros.push({ linha: L, msg: `Conta ${c.numero}: "${c.refDRE}" não é uma linha da estrutura da DRE` });
        else c.refDRE = d;
        if (!c.refDFC) erros.push({ linha: L, msg: `Conta analítica ${c.numero} — ${c.nome}: falta a Referência na Estrutura do DFC` });
        else if (!f2) erros.push({ linha: L, msg: `Conta ${c.numero}: "${c.refDFC}" não é uma linha da estrutura do DFC` });
        else c.refDFC = f2;
      } else if (c.tipo === "Sintética") {
        if (c.refDRE || c.refDFC) alertas.push({ linha: L, msg: `Conta sintética ${c.numero}: referências ignoradas (só contas analíticas são alocadas na estrutura)` });
        c.refDRE = ""; c.refDFC = "";
      }
      if (c.numero && c.numero.includes(".") && !contaSuperior(c.numero, numeros)) alertas.push({ linha: L, msg: `Conta ${c.numero}: conta superior não encontrada no plano` });
    });
    // sintética precisa ter conta abaixo; analítica não pode ter
    plano.forEach((c) => {
      const filhos = plano.filter((x) => x !== c && contaSuperior(x.numero, numeros) === c.numero).length;
      if (c.tipo === "Analítica" && filhos) erros.push({ linha: c._linha ?? "-", msg: `Conta ${c.numero} é analítica mas tem contas abaixo dela — deveria ser sintética` });
      if (c.tipo === "Sintética" && !filhos) alertas.push({ linha: c._linha ?? "-", msg: `Conta sintética ${c.numero} — ${c.nome} não tem contas abaixo dela` });
    });
    return { plano: plano.sort(ordemNumero).map(({ _linha, ...c }) => c), erros, alertas };
  };

  /** Lê o plano de uma planilha (aba "PlanoContas" ou a primeira aba). */
  IMP.lerPlano = function (wb) {
    const aba = acharAba(wb, "PlanoContas") || wb.SheetNames.find((n) => !/instru|lista|estrutura/i.test(n)) || wb.SheetNames[0];
    const r = lerAba(wb.Sheets[aba], M.abas.PlanoContas.colunas, {
      numero: ["numero", "conta", "codigo", "codigodaconta", "numerodaconta", "classificacao"],
      nome: ["nome", "descricao", "nomedaconta", "descricaodaconta"],
      tipo: ["tipo", "tipodaconta", "sinteticaanalitica", "natureza"],
      refDRE: ["referenciadre", "dre", "estruturadre", "linhadre", "referencianaestruturadadre"],
      refDFC: ["referenciadfc", "dfc", "estruturadfc", "linhadfc", "referencianaestruturadodfc"]
    });
    if (r.erro) return { erro: r.erro + " — use a planilha padrão do plano de contas", registros: [] };
    return { registros: r.registros, aba };
  };

  /** Gera a planilha padrão do plano de contas (ExcelJS, com listas suspensas). */
  IMP.gerarModeloPlano = async function (plano, nomeArquivo, cliente) {
    if (!window.ExcelJS) throw new Error("Biblioteca ExcelJS não carregada.");
    const wb = new ExcelJS.Workbook(); wb.creator = "Patagonia Business";
    const fill = (hex) => ({ type: "pattern", pattern: "solid", fgColor: { argb: "FF" + hex } });
    const branco = { color: { argb: "FFFFFFFF" }, bold: true };
    const rDRE = PB.E.caminhos("DRE"), rDFC = PB.E.caminhos("DFC");

    // Instruções
    const wi = wb.addWorksheet("Instrucoes", { views: [{ showGridLines: false }], properties: { tabColor: { argb: "FF0F2A3D" } } });
    wi.getColumn(1).width = 3; wi.getColumn(2).width = 120;
    const linhasI = [
      ["PATAGONIA BUSINESS — PLANILHA PADRÃO DO PLANO DE CONTAS", "t"], [cliente ? `Cliente: ${cliente}` : "Preencha uma linha por conta do plano de contas do cliente.", "s"], ["", ""],
      ["Como preencher a aba PlanoContas", "h"],
      ["1. Número da Conta: código hierárquico do plano (ex.: 5, 5.1, 5.1.01). A conta superior é identificada pelo número — 5.1.01 pertence a 5.1, que pertence a 5.", ""],
      ["2. Nome da Conta: escreva o nome completo, sem abreviações. É o mesmo nome que deve aparecer na coluna “Conta Analítica” dos lançamentos.", ""],
      ["3. Tipo da Conta: “Sintética” para contas que apenas agrupam outras; “Analítica” para contas que recebem lançamentos.", ""],
      ["4. Referência na Estrutura da DRE: obrigatória para contas analíticas. Escolha na lista a linha da DRE padrão em que a conta será somada, ou “Não compõe a DRE” (ex.: empréstimos, compra de equipamentos).", ""],
      ["5. Referência na Estrutura do DFC: obrigatória para contas analíticas. Escolha na lista a linha do DFC padrão, ou “Não compõe o DFC” (ex.: depreciação, que não movimenta caixa).", ""],
      ["6. Contas sintéticas não recebem referência — os valores sobem pelas contas analíticas.", ""],
      ["7. Não altere os títulos das colunas. As listas completas das estruturas estão nas abas “Estrutura DRE” e “Estrutura DFC”.", ""]
    ];
    linhasI.forEach(([t, s], i) => { const c = wi.getCell(i + 2, 2); c.value = t; c.alignment = { wrapText: true, vertical: "middle" };
      if (s === "t") { c.font = { ...branco, size: 16 }; c.fill = fill("0F2A3D"); wi.getRow(i + 2).height = 30; }
      if (s === "s") { c.font = { color: { argb: "FFFFFFFF" } }; c.fill = fill("16384F"); }
      if (s === "h") c.font = { bold: true, size: 13, color: { argb: "FF0F2A3D" } }; });

    // Plano de contas
    const ws = wb.addWorksheet("PlanoContas", { properties: { tabColor: { argb: "FF2E8B8B" } }, views: [{ state: "frozen", ySplit: 1 }] });
    const cols = M.abas.PlanoContas.colunas;
    ws.columns = cols.map((c) => ({ header: c.titulo, key: c.campo, width: { numero: 18, nome: 50, tipo: 16, refDRE: 62, refDFC: 62 }[c.campo] }));
    ws.getRow(1).eachCell((c) => { c.font = branco; c.fill = fill("2E8B8B"); c.alignment = { vertical: "middle", wrapText: true }; });
    ws.getRow(1).height = 32;
    (plano || []).slice().sort(ordemNumero).forEach((c) => {
      const row = ws.addRow({ numero: c.numero, nome: c.nome, tipo: c.tipo, refDRE: c.refDRE || "", refDFC: c.refDFC || "" });
      if (c.tipo === "Sintética") row.eachCell((cel) => { cel.font = { bold: true }; cel.fill = fill("EEF2F4"); });
      row.getCell(2).alignment = { indent: Math.max(0, String(c.numero).split(".").length - 1) };
    });
    const ultima = Math.max(ws.rowCount + 300, 500);
    for (let i = 2; i <= ultima; i++) {
      ws.getCell(i, 1).numFmt = "@";
      ws.getCell(i, 3).dataValidation = { type: "list", allowBlank: true, formulae: ['"Sintética,Analítica"'], showErrorMessage: true, errorTitle: "Tipo da Conta", error: "Use Sintética ou Analítica." };
      ws.getCell(i, 4).dataValidation = { type: "list", allowBlank: true, formulae: [`'Estrutura DRE'!$A$2:$A$${rDRE.length + 2}`], showErrorMessage: true, errorTitle: "Referência na Estrutura da DRE", error: "Escolha uma linha da lista (aba Estrutura DRE)." };
      ws.getCell(i, 5).dataValidation = { type: "list", allowBlank: true, formulae: [`'Estrutura DFC'!$A$2:$A$${rDFC.length + 2}`], showErrorMessage: true, errorTitle: "Referência na Estrutura do DFC", error: "Escolha uma linha da lista (aba Estrutura DFC)." };
    }
    ws.autoFilter = { from: "A1", to: "E1" };

    // Estruturas (listas das referências + estrutura completa para consulta)
    function abaEstrutura(nome, tipo, refs, nao) {
      const we = wb.addWorksheet(nome, { properties: { tabColor: { argb: "FF16384F" } } });
      we.getColumn(1).width = 70; we.getColumn(2).width = 4; we.getColumn(3).width = 80;
      we.getCell("A1").value = "Referências válidas (use na coluna da aba PlanoContas)"; we.getCell("C1").value = "Estrutura completa — " + (tipo === "DRE" ? "Demonstrativo de Resultado do Exercício (DRE)" : "Demonstrativo de Fluxo de Caixa (DFC)");
      ["A1", "C1"].forEach((k) => { we.getCell(k).font = branco; we.getCell(k).fill = fill("0F2A3D"); });
      [...refs.map((r) => r.nome), nao].forEach((n, i) => (we.getCell(i + 2, 1).value = n));
      PB.E[tipo].forEach((no, i) => {
        const c = we.getCell(i + 2, 3);
        const nivel = no.tipo === "linha" ? (PB.E[tipo].find((x) => x.id === no.pai)?.tipo === "subgrupo" ? 2 : 1) : no.tipo === "subgrupo" ? 1 : 0;
        c.value = `(${no.sinal}) ${no.nome}`; c.alignment = { indent: nivel * 2 };
        if (no.tipo === "resultado") { c.font = branco; c.fill = fill("0F2A3D"); }
        else if (no.tipo === "grupo") { c.font = { bold: true }; c.fill = fill("C8F0F0"); }
        else if (no.tipo === "subgrupo") c.font = { bold: true, italic: true };
      });
    }
    abaEstrutura("Estrutura DRE", "DRE", rDRE, PB.E.NAO_DRE);
    abaEstrutura("Estrutura DFC", "DFC", rDFC, PB.E.NAO_DFC);

    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = nomeArquivo; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return nomeArquivo;
  };

  /* ---------- Mesclagem com a base atual ---------- */
  IMP.mesclar = function (base, parcial, modo, periodo) {
    const limpa = (arr) => arr.map(({ _linha, ...r }) => r);
    const novo = JSON.parse(JSON.stringify(base));
    const mesesDe = (arr, f) => new Set(arr.map(f).filter(Boolean));
    if (parcial.lancamentos) {
      const L = limpa(parcial.lancamentos);
      if (modo === "tudo") novo.lancamentos = L;
      else if (modo === "contaazul" && periodo) {
        // substitui: competências do período, as mesmas parcelas (idOrigem) e os pagamentos do Conta Azul desde o início do período
        const ids = new Set(L.map((l) => l.idOrigem).filter(Boolean));
        novo.lancamentos = [...novo.lancamentos.filter((l) => !((l.competencia >= periodo.de && l.competencia <= periodo.ate) || (l.idOrigem && ids.has(l.idOrigem)) || (l.fonte === "contaazul" && l.data >= periodo.ini))), ...L];
      }
      else { const ms = mesesDe(L, (l) => l.competencia); novo.lancamentos = [...novo.lancamentos.filter((l) => !ms.has(l.competencia)), ...L]; }
      novo.lancamentos.sort((a, b) => a.data.localeCompare(b.data));
    }
    if (parcial.vendas) {
      const V = limpa(parcial.vendas);
      if (modo === "tudo") novo.vendas = V;
      else { const ms = mesesDe(V, (v) => v.data && v.data.slice(0, 7)); novo.vendas = [...novo.vendas.filter((v) => !ms.has(v.data.slice(0, 7))), ...V]; }
    }
    ["planoContas", "contas", "projecoes"].forEach((k) => { if (parcial[k] && parcial[k].length) novo[k] = limpa(parcial[k]); });
    novo.versaoModelo = M.versao;
    novo.atualizadoEm = new Date().toISOString().slice(0, 19);
    return novo;
  };

  /* ---------- Geração dos modelos .xlsx ---------- */
  IMP.gerarModelo = function (dados, nomeArquivo) {
    const wb = XLSX.utils.book_new();
    const instr = [
      ["PATAGONIA BUSINESS — PLANILHA PADRÃO DE COLETA DE DADOS", ""], ["Versão do modelo", M.versao], [""],
      ["Como preencher"], ["1. Não altere os nomes das abas nem os títulos das colunas (linha 1 de cada aba)."],
      ["2. Datas no formato DD/MM/AAAA. Competência no formato AAAA-MM (ex.: 2026-10)."],
      ["3. Valores sempre positivos — o campo Tipo (Receita/Despesa) define o sinal."],
      ["4. Toda Categoria usada em Lançamentos precisa existir na aba PlanoContas."],
      ["5. Use apenas os valores permitidos listados abaixo e na aba Listas."], [""],
      ["Aba", "Conteúdo"], ...Object.entries(M.abas).map(([n, d]) => [n, d.descricao]), [""],
      ["Aba", "Coluna", "Obrigatória", "Tipo", "Orientação"],
      ...Object.entries(M.abas).flatMap(([n, d]) => d.colunas.map((c) => [n, c.titulo, c.obrigatorio ? "Sim" : "Não", c.tipo, c.ajuda || (c.opcoes ? "Valores: " + c.opcoes.join(", ") : "")]))
    ];
    const wsI = XLSX.utils.aoa_to_sheet(instr); wsI["!cols"] = [{ wch: 16 }, { wch: 70 }, { wch: 12 }, { wch: 10 }, { wch: 80 }];
    XLSX.utils.book_append_sheet(wb, wsI, "Instrucoes");
    Object.entries(M.abas).forEach(([nome, def]) => {
      const regs = (dados && dados[chaveDe(nome)]) || [];
      const aoa = [def.colunas.map((c) => c.titulo), ...regs.map((r) => def.colunas.map((c) => {
        const v = r[c.campo];
        // datas gravadas como número serial do Excel (exato, sem problema de fuso horário)
        if (c.tipo === "data" && v) { const [y, m, d] = v.split("-"); return (Date.UTC(+y, +m - 1, +d) - Date.UTC(1899, 11, 30)) / 864e5; }
        return v ?? "";
      }))];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      def.colunas.forEach((c, j) => {
        if (c.tipo !== "data") return;
        for (let i = 1; i < aoa.length; i++) { const cel = ws[XLSX.utils.encode_cell({ r: i, c: j })]; if (cel && cel.t === "n") cel.z = "dd/mm/yyyy"; }
      });
      ws["!cols"] = def.colunas.map((c) => ({ wch: Math.max(12, c.titulo.length + 4, c.campo === "descricao" || c.campo === "categoria" ? 32 : 0) }));
      XLSX.utils.book_append_sheet(wb, ws, nome);
    });
    const rDRE = [...PB.E.caminhos("DRE").map((c) => c.nome), PB.E.NAO_DRE], rDFC = [...PB.E.caminhos("DFC").map((c) => c.nome), PB.E.NAO_DFC];
    const listas = [["Tipo", "Status", "Tipo da Conta", "Referência na Estrutura da DRE", "Referência na Estrutura do DFC", "Tipo do item", "Cenário"]];
    for (let i = 0; i < Math.max(rDRE.length, rDFC.length); i++) listas.push([["Receita", "Despesa"][i] || "", ["Realizado", "Previsto", "Em aberto"][i] || "", ["Sintética", "Analítica"][i] || "", rDRE[i] || "", rDFC[i] || "", ["Produto", "Serviço"][i] || "", ["Base", "Otimista", "Conservador"][i] || ""]);
    const wsL = XLSX.utils.aoa_to_sheet(listas); wsL["!cols"] = [{ wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 70 }, { wch: 70 }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsL, "Listas");
    XLSX.writeFile(wb, nomeArquivo);
  };
})();
