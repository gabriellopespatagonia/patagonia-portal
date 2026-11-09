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
    valor: ["valorr", "valorr", "valorliquido", "valortotal", "valororiginal"],
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

  /* =========================================================
     CONTA AZUL — RELATÓRIOS FINANCEIROS (base dos relatórios do portal)
     1) Financeiro → Visão Competência      → visão "Competência" (DRE)
     2) Financeiro → Extrato de movimentações → visão "Caixa" (DFC e Fluxo de Caixa)
     Colunas reconhecidas pelo nome; "Categoria N / Valor na Categoria N" e
     "Centro de Custo N / Valor no Centro de Custo N" em qualquer quantidade.
     Os valores das categorias vêm com sinal (+ entra, − sai) e somam o "Valor (R$)"
     da linha: cada categoria vira um lançamento, com o tipo dado pelo sinal
     (ex.: desconto obtido dentro de uma compra = receita naquela categoria).
     ========================================================= */
  const r2 = (v) => Math.round(v * 100) / 100;
  const brl = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const mesBR = (ym) => { const [y, m] = ym.split("-"); return `${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][+m - 1]}/${y}`; };

  /** Localiza a tabela do relatório: linha de cabeçalho e índice de cada coluna (por nome normalizado). */
  function tabelaContaAzul(wb) {
    for (const nome of wb.SheetNames) {
      const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: null });
      for (let i = 0; i < Math.min(linhas.length, 20); i++) {
        const cab = (linhas[i] || []).map(norm);
        if (!cab.includes("valorr")) continue;
        const tipo = cab.includes("datamovimento") ? "extrato" : cab.includes("datadecompetencia") ? "competencia" : null;
        if (!tipo) continue;
        const col = {}; cab.forEach((h, j) => { if (h && col[h] == null) col[h] = j; });
        const cats = [], ccs = [];
        cab.forEach((h, j) => {
          let m = /^categoria(\d+)$/.exec(h); if (m && col["valornacategoria" + m[1]] != null) cats.push([j, col["valornacategoria" + m[1]]]);
          m = /^centrodecusto(\d+)$/.exec(h); if (m && col["valornocentrodecusto" + m[1]] != null) ccs.push([j, col["valornocentrodecusto" + m[1]]]);
        });
        return { tipo, aba: nome, inicio: i, col, cats, ccs, linhas };
      }
    }
    return null;
  }
  /** Quebra uma linha do relatório em lançamentos por categoria (e por centro de custo, proporcionalmente). */
  function porCategoria(L, t, valorLinha, base) {
    const out = [];
    let cats = t.cats.map(([c, v]) => ({ nome: String(L[c] ?? "").trim(), valor: paraNumero(L[v]) || 0 })).filter((x) => x.nome && Math.abs(x.valor) >= 0.005);
    if (!cats.length && Math.abs(valorLinha) >= 0.005) cats = [{ nome: "Sem categoria", valor: valorLinha }];
    const ccs = t.ccs.map(([c, v]) => ({ nome: String(L[c] ?? "").trim(), valor: Math.abs(paraNumero(L[v]) || 0) })).filter((x) => x.nome && x.valor >= 0.005);
    const somaCC = ccs.reduce((s, x) => s + x.valor, 0);
    cats.forEach((cat) => {
      const partes = somaCC > 0 ? ccs.map((cc) => ({ cc: cc.nome, v: cat.valor * (cc.valor / somaCC) })) : [{ cc: "", v: cat.valor }];
      partes.forEach((p) => { if (Math.abs(p.v) >= 0.005) out.push({ ...base, categoria: cat.nome, centroCusto: p.cc, tipo: p.v >= 0 ? "Receita" : "Despesa", valor: r2(Math.abs(p.v)) }); });
    });
    return out;
  }
  const ehTransferencia = (origem, cat) => /transfer/i.test(origem || "") || /^transfer[eê]ncia/i.test(cat || "");
  const ehSaldoInicial = (origem, cat) => /saldo\s*conta/i.test(origem || "") || /^saldo inicial/i.test(cat || "");
  const val = (L, t, nome) => (t.col[nome] != null ? L[t.col[nome]] : null);
  const txt = (L, t, nome) => String(val(L, t, nome) ?? "").trim();

  /** Visão de Competência → lançamentos da visão "Competência" (DRE). */
  IMP.lerContaAzulCompetencia = function (wb) {
    const t = tabelaContaAzul(wb);
    if (!t) return { parcial: {}, avisos: ["Relatório não reconhecido. Exporte do Conta Azul em Financeiro → Visão Competência (Excel)."] };
    if (t.tipo !== "competencia") return { parcial: {}, avisos: ["Este arquivo é o Extrato de movimentações (visão de caixa). Escolha o formato “Conta Azul — Extrato de movimentações”."], tipoDetectado: t.tipo };
    const lanc = [], meses = {}; let ignorados = 0, rec = 0, desp = 0;
    for (let i = t.inicio + 1; i < t.linhas.length; i++) {
      const L = t.linhas[i]; if (!L || L.every((x) => x == null || x === "")) continue;
      const data = paraData(val(L, t, "datadecompetencia")); const valor = paraNumero(val(L, t, "valorr"));
      if (!data || valor == null) continue; // linhas de total/rodapé
      const origem = txt(L, t, "origemdolancamento"), cat1 = t.cats.length ? String(L[t.cats[0][0]] ?? "") : "";
      if (ehTransferencia(origem, cat1) || ehSaldoInicial(origem, cat1)) { ignorados++; continue; }
      const desc = [txt(L, t, "descricao"), txt(L, t, "notafiscal")].filter(Boolean).join(" · ");
      const base = { _linha: i + 1, data, competencia: data.slice(0, 7), descricao: desc, status: "Realizado", visao: "Competência", conta: "", contraparte: txt(L, t, "nomedofornecedorcliente"), origem };
      porCategoria(L, t, valor, base).forEach((l) => { lanc.push(l); if (l.tipo === "Receita") rec += l.valor; else desp += l.valor; });
      meses[data.slice(0, 7)] = (meses[data.slice(0, 7)] || 0) + 1;
    }
    const lista = Object.keys(meses).sort();
    const avisos = [`Visão de Competência: ${lanc.length} lançamento(s) por categoria em ${lista.map(mesBR).join(", ") || "—"} · entradas ${brl(r2(rec))} · saídas ${brl(r2(desp))} · resultado ${brl(r2(rec - desp))}.`];
    if (ignorados) avisos.push(`${ignorados} linha(s) de transferência/saldo inicial ignoradas (não são receita nem despesa).`);
    avisos.push("Base da DRE e dos relatórios por competência. Substitui apenas a visão de competência dos meses acima.");
    return { parcial: { lancamentos: lanc }, avisos, tipoDetectado: "competencia", meses: lista };
  };

  /** Extrato de movimentações → lançamentos da visão "Caixa" (DFC/Fluxo) + saldo inicial consolidado. */
  IMP.lerContaAzulExtrato = function (wb) {
    const t = tabelaContaAzul(wb);
    if (!t) return { parcial: {}, avisos: ["Relatório não reconhecido. Exporte do Conta Azul em Financeiro → Extrato de movimentações (Excel)."] };
    if (t.tipo !== "extrato") return { parcial: {}, avisos: ["Este arquivo é a Visão de Competência. Escolha o formato “Conta Azul — Visão de Competência”."], tipoDetectado: t.tipo };
    const REALIZADO = /concilia|quitad|transferid|pago|recebid|baixad|liquidad/i;
    const lanc = [], meses = {};
    let abertura = null, primeiraData = null, ajusteSaldo = 0, nTransf = 0, somaTransf = 0, nSaldoIni = 0, previstos = 0, ent = 0, sai = 0, ultimoSaldo = null, somaPrevistos = 0;
    for (let i = t.inicio + 1; i < t.linhas.length; i++) {
      const L = t.linhas[i]; if (!L || L.every((x) => x == null || x === "")) continue;
      const mov = paraData(val(L, t, "datamovimento")); const valor = paraNumero(val(L, t, "valorr"));
      if (!mov || valor == null) continue;
      const saldo = paraNumero(val(L, t, "saldocontar"));
      if (abertura == null && saldo != null) { abertura = saldo - valor; primeiraData = mov; }
      if (saldo != null) ultimoSaldo = saldo;
      const situacao = txt(L, t, "situacao"), realizado = REALIZADO.test(situacao);
      const origem = txt(L, t, "origemdolancamento"), cat1 = t.cats.length ? String(L[t.cats[0][0]] ?? "") : "";
      if (!realizado) somaPrevistos += valor;
      if (ehTransferencia(origem, cat1)) { nTransf++; somaTransf += valor; continue; }
      if (ehSaldoInicial(origem, cat1)) { nSaldoIni++; if (realizado) ajusteSaldo += valor; continue; }
      const data = realizado ? mov : paraData(val(L, t, "dataprevista")) || paraData(val(L, t, "dataoriginaldevencimento")) || mov;
      const comp = paraData(val(L, t, "datadecompetencia")) || data;
      const desc = [txt(L, t, "descricao"), txt(L, t, "notafiscal")].filter(Boolean).join(" · ");
      const base = { _linha: i + 1, data, competencia: comp.slice(0, 7), descricao: desc, status: realizado ? "Realizado" : "Previsto", visao: "Caixa", conta: txt(L, t, "contabancaria"), contraparte: txt(L, t, "nomedofornecedorcliente"), origem, formaPagamento: txt(L, t, "formadepgtorecbto") };
      porCategoria(L, t, valor, base).forEach((l) => { lanc.push(l); if (realizado) { if (l.tipo === "Receita") ent += l.valor; else sai += l.valor; } });
      if (!realizado) previstos++;
      meses[data.slice(0, 7)] = (meses[data.slice(0, 7)] || 0) + 1;
    }
    const lista = Object.keys(meses).sort();
    const avisos = [`Extrato de movimentações: ${lanc.length} lançamento(s) por categoria em ${lista.map(mesBR).join(", ") || "—"} · entradas realizadas ${brl(r2(ent))} · saídas realizadas ${brl(r2(sai))} · geração de caixa ${brl(r2(ent - sai))}.`];
    if (previstos) avisos.push(`${previstos} movimento(s) ainda não quitado(s) (ex.: atrasados) entram como previstos na data prevista — fora do caixa realizado.`);
    if (nTransf) avisos.push(`${nTransf} transferência(s) entre contas ignoradas (saldo líquido ${brl(r2(somaTransf))}: não são entrada nem saída de caixa).`);
    if (nSaldoIni) avisos.push(`${nSaldoIni} lançamento(s) de saldo inicial de conta incorporados ao saldo inicial (${brl(r2(ajusteSaldo))}).`);
    const parcial = { lancamentos: lanc };
    if (abertura != null && primeiraData) {
      const diaAntes = new Date(Date.parse(primeiraData) - 864e5).toISOString().slice(0, 10);
      const saldoIni = r2(abertura + ajusteSaldo);
      parcial.contas = [{ _linha: 1, conta: "Saldo consolidado das contas (Conta Azul)", banco: "Conta Azul", saldoInicial: saldoIni, dataSaldo: diaAntes }];
      const finalRealizado = r2(abertura + ajusteSaldo + ent - sai + somaTransf);
      const dif = ultimoSaldo != null ? r2(ultimoSaldo - finalRealizado) : 0;
      avisos.push(`Saldo em ${diaAntes.split("-").reverse().join("/")}: ${brl(saldoIni)} (coluna “Saldo conta”). Saldo final realizado: ${brl(finalRealizado)}${ultimoSaldo != null && Math.abs(dif) < 0.01 ? " — confere com o saldo final do relatório" : ultimoSaldo != null ? ` — o relatório termina em ${brl(ultimoSaldo)} (diferença de ${brl(dif)}, possivelmente movimentos não quitados ou fora de ordem)` : ""}.`);
    } else avisos.push("Coluna “Saldo conta (R$)” não encontrada: o saldo inicial das contas não foi atualizado.");
    avisos.push("Base do DFC e do Fluxo de Caixa. Substitui apenas a visão de caixa dos meses acima.");
    return { parcial, avisos, tipoDetectado: "extrato", meses: lista };
  };

  /** Lê qualquer um dos dois relatórios, detectando o tipo pelo cabeçalho. */
  IMP.lerContaAzulRelatorio = function (wb) {
    const t = tabelaContaAzul(wb);
    if (!t) return { parcial: {}, avisos: ["Relatório do Conta Azul não reconhecido (esperado: Visão Competência ou Extrato de movimentações)."] };
    return t.tipo === "extrato" ? IMP.lerContaAzulExtrato(wb) : IMP.lerContaAzulCompetencia(wb);
  };

  /* ---------- Modelos manuais no formato dos relatórios do Conta Azul (clientes sem Conta Azul) ---------- */
  IMP.COLUNAS_CA = {
    competencia: ["Data de competência", "Origem do lançamento", "Recorrência", "Quantidade de recorrência", "Descrição", "Identificador do fornecedor/cliente", "Nome do fornecedor/cliente", "Código de referência", "Condição de pagamento", "Tipo", "Nota fiscal", "Valor (R$)", "Número de parcelas", "Observações", "Categoria 1", "Valor na Categoria 1", "Centro de Custo 1", "Valor no Centro de Custo 1", "Categoria 2", "Valor na Categoria 2", "Centro de Custo 2", "Valor no Centro de Custo 2", "Categoria 3", "Valor na Categoria 3"],
    extrato: ["Data movimento", "Identificador do fornecedor/cliente", "Nome do fornecedor/cliente", "Recorrência", "Quantidade de recorrência", "Descrição", "Agendado", "Tipo", "Origem do lançamento", "Conta bancária", "Forma de pgto/recbto", "Valor (R$)", "Saldo conta (R$)", "Situação", "Valor original (R$)", "Juros (R$)", "Multa (R$)", "Desconto (R$)", "Taxas (R$)", "Data de competência", "Data original de vencimento", "Data prevista", "Observações", "Nota fiscal", "Categoria 1", "Valor na Categoria 1", "Centro de Custo 1", "Valor no Centro de Custo 1", "Categoria 2", "Valor na Categoria 2", "Centro de Custo 2", "Valor no Centro de Custo 2", "Categoria 3", "Valor na Categoria 3"]
  };
  IMP.gerarModeloContaAzul = async function (tipo, plano) {
    if (!window.ExcelJS) throw new Error("Biblioteca de planilhas não carregada.");
    const cols = IMP.COLUNAS_CA[tipo], wb = new ExcelJS.Workbook();
    const nomeAba = tipo === "competencia" ? "Visão Competência" : "Extrato Financeiro";
    const ws = wb.addWorksheet(nomeAba, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.addRow(cols);
    ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0070BD" } }; c.alignment = { vertical: "middle", wrapText: true }; });
    ws.getRow(1).height = 32;
    cols.forEach((h, i) => { ws.getColumn(i + 1).width = /Descrição|Nome|Categoria \d$|Observações|Conta bancária/.test(h) ? 34 : /Data|Valor|Saldo|Juros|Multa|Desconto|Taxas/.test(h) ? 15 : 18; });
    const ex = tipo === "competencia"
      ? [
        { "Data de competência": "01/10/2026", "Origem do lançamento": "Venda", "Descrição": "Venda 1290", "Nome do fornecedor/cliente": "Cliente Exemplo Ltda", "Condição de pagamento": "1x", "Tipo": "Receita", "Valor (R$)": 1246, "Número de parcelas": 1, "Categoria 1": "Receitas de Vendas", "Valor na Categoria 1": 1246, "Centro de Custo 1": "Fábrica", "Valor no Centro de Custo 1": 1246 },
        { "Data de competência": "01/10/2026", "Origem do lançamento": "Compra", "Descrição": "Compra 268 (NFe 2640-0)", "Nome do fornecedor/cliente": "Fornecedor Exemplo ME", "Condição de pagamento": "1x", "Tipo": "Despesa", "Valor (R$)": -394.25, "Número de parcelas": 1, "Categoria 1": "Fornecedores de Matérias-Primas", "Valor na Categoria 1": -415, "Categoria 2": "Descontos Obtidos", "Valor na Categoria 2": 20.75 }
      ]
      : [
        { "Data movimento": "01/10/2026", "Nome do fornecedor/cliente": "Cliente Exemplo Ltda", "Descrição": "Venda 1235", "Tipo": "Receita", "Origem do lançamento": "Venda", "Conta bancária": "Conta Corrente - Banco", "Forma de pgto/recbto": "Boleto bancário", "Valor (R$)": 992.77, "Saldo conta (R$)": 50992.77, "Situação": "Conciliado", "Valor original (R$)": 1200, "Taxas (R$)": 207.23, "Data de competência": "23/09/2026", "Data original de vencimento": "29/09/2026", "Data prevista": "29/09/2026", "Categoria 1": "Receitas de Vendas", "Valor na Categoria 1": 992.77, "Centro de Custo 1": "Fábrica", "Valor no Centro de Custo 1": 992.77 },
        { "Data movimento": "02/10/2026", "Descrição": "Aluguel do escritório", "Tipo": "Despesa", "Origem do lançamento": "Lançamento Financeiro", "Conta bancária": "Conta Corrente - Banco", "Forma de pgto/recbto": "Pagamento instantâneo", "Valor (R$)": -2500, "Saldo conta (R$)": 48492.77, "Situação": "Conciliado", "Valor original (R$)": -2500, "Data de competência": "01/10/2026", "Data original de vencimento": "02/10/2026", "Data prevista": "02/10/2026", "Categoria 1": "Aluguel", "Valor na Categoria 1": -2500 }
      ];
    ex.forEach((o) => { const r = ws.addRow(cols.map((h) => o[h] ?? null)); r.font = { color: { argb: "FF5B6B7D" }, italic: true }; });
    cols.forEach((h, i) => { if (/^Valor|Saldo|Juros|Multa|Desconto|Taxas/.test(h)) ws.getColumn(i + 1).numFmt = "#,##0.00;[Red]-#,##0.00"; });
    // listas de valores
    const L = wb.addWorksheet("Listas");
    const categorias = (plano || []).filter((c) => c.tipo === "Analítica").map((c) => (c.numero ? `${c.numero} - ${c.nome}` : c.nome));
    L.addRow(["Tipo", "Situação", "Origem do lançamento", "Categorias do plano de contas do cliente"]);
    const tipos = ["Receita", "Despesa"], sits = ["Conciliado", "Quitado", "Em aberto", "Atrasado"], origens = ["Lançamento Financeiro", "Venda", "Compra", "Transferência", "Saldo Conta Bancária"];
    for (let i = 0; i < Math.max(4, categorias.length, origens.length); i++) L.addRow([tipos[i] || null, sits[i] || null, origens[i] || null, categorias[i] || null]);
    L.getRow(1).font = { bold: true }; [14, 14, 24, 60].forEach((w, i) => (L.getColumn(i + 1).width = w));
    const iTipo = cols.indexOf("Tipo") + 1, iSit = cols.indexOf("Situação") + 1;
    for (let r = 2; r <= 1000; r++) {
      if (iTipo) ws.getCell(r, iTipo).dataValidation = { type: "list", allowBlank: true, formulae: ["Listas!$A$2:$A$3"] };
      if (iSit > 0) ws.getCell(r, iSit).dataValidation = { type: "list", allowBlank: true, formulae: ["Listas!$B$2:$B$5"] };
      if (categorias.length) cols.forEach((h, k) => { if (/^Categoria \d$/.test(h)) ws.getCell(r, k + 1).dataValidation = { type: "list", allowBlank: true, formulae: [`Listas!$D$2:$D$${categorias.length + 1}`] }; });
    }
    // instruções
    const I = wb.addWorksheet("Instruções");
    const textos = tipo === "competencia" ? [
      "Modelo manual no formato do relatório Financeiro → Visão Competência do Conta Azul (base da DRE).",
      "Uma linha por lançamento (venda, compra, despesa, receita), na data de competência — o mês a que o fato pertence, independentemente do pagamento.",
      "Valor (R$): positivo para receitas e negativo para despesas. Use o valor total do lançamento (todas as parcelas).",
      "Categoria N / Valor na Categoria N: rateio do valor nas contas do plano de contas, com sinal. A soma das categorias deve ser igual ao Valor (R$). Ex.: compra de -415,00 com desconto obtido de 20,75 → Categoria 1 = -415,00 e Categoria 2 = 20,75.",
      "Centro de Custo N / Valor no Centro de Custo N: opcional; o valor é rateado proporcionalmente entre as categorias.",
      "Transferências entre contas e saldos iniciais não fazem parte deste relatório.",
      "As linhas de exemplo (em cinza) podem ser apagadas. Os nomes das colunas não devem ser alterados."
    ] : [
      "Modelo manual no formato do relatório Financeiro → Extrato de movimentações do Conta Azul (base do DFC e do Fluxo de Caixa).",
      "Uma linha por movimento de dinheiro, na data em que entrou ou saiu da conta (Data movimento), em ordem cronológica.",
      "Valor (R$): positivo para entradas e negativo para saídas — o valor efetivamente movimentado (já com juros, multas, descontos e taxas).",
      "Saldo conta (R$): saldo acumulado após o movimento, somando todas as contas. É usado para calcular o saldo inicial do período (saldo da 1ª linha − valor da 1ª linha).",
      "Situação: Conciliado ou Quitado = realizado; Em aberto ou Atrasado = previsto (fora do caixa realizado).",
      "Categoria N / Valor na Categoria N: rateio do valor movimentado nas contas do plano de contas, com sinal; a soma deve ser igual ao Valor (R$).",
      "Transferências entre contas: Origem do lançamento = Transferência (são ignoradas no DFC). Saldo inicial de conta: Origem = Saldo Conta Bancária.",
      "As linhas de exemplo (em cinza) podem ser apagadas. Os nomes das colunas não devem ser alterados."
    ];
    I.getColumn(1).width = 130; I.addRow([`Patagonia Business — ${nomeAba}`]).font = { bold: true, size: 14 };
    textos.forEach((x) => { const r = I.addRow([x]); r.alignment = { wrapText: true, vertical: "top" }; });
    const buf = await wb.xlsx.writeBuffer();
    const nome = tipo === "competencia" ? "Modelo manual - Visão de Competência (formato Conta Azul).xlsx" : "Modelo manual - Extrato de movimentações (formato Conta Azul).xlsx";
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = nome; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return nome;
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

  /* ---------- Conta Azul via API: mesmo modelo dos relatórios (somente o período pedido) ----------
   *  - Visão "Competência" (= relatório Visão Competência): cada parcela com competência no período,
   *    pelo valor da parcela, rateado por categoria (com sinal) e centro de custo.
   *  - Visão "Caixa" (= Extrato de movimentações): cada baixa com data no período, pelo valor movimentado
   *    (líquido de juros/multa/desconto/taxas), na conta da baixa; e o saldo em aberto das parcelas que
   *    vencem no período, como previsto.
   */
  IMP.montarContaAzulAPI = function (lista, det) {
    const avisos = [], lanc = [];
    const { ini, fim, hoje } = lista.periodo;
    const detP = new Map((det.parcelas || []).map((d) => [d.id, d]));
    let semDetalhe = 0, ignoradas = 0, rec = 0, desp = 0, ent = 0, sai = 0;
    const add = (o) => { if (o.valor >= 0.005) lanc.push({ _linha: lanc.length + 1, fonte: "contaazul", ...o, valor: r2(o.valor) }); };
    // partes (categoria × centro de custo) com fração com sinal em relação ao valor da parcela
    const partesDe = (p, d) => {
      const out = [], rat = ((d && d.rateio) || []).filter((r) => Math.abs(r.valor) >= 0.005);
      const somaR = rat.reduce((s, r) => s + r.valor, 0);
      if (rat.length && Math.abs(somaR) >= 0.005) rat.forEach((r) => {
        const cc = r.centros.filter((c) => Math.abs(c.valor) >= 0.005), somaC = cc.reduce((s, c) => s + Math.abs(c.valor), 0);
        const f = r.valor / somaR; // ex.: desconto obtido dentro da compra → fração negativa = sentido oposto
        if (somaC > 0) cc.forEach((c) => out.push({ categoria: r.categoria, centro: c.nome, f: f * (Math.abs(c.valor) / somaC) }));
        else out.push({ categoria: r.categoria, centro: "", f });
      });
      if (!out.length) { const cats = p.categorias.length ? p.categorias : ["Sem categoria"]; cats.forEach((c) => out.push({ categoria: c, centro: p.centros.length === 1 ? p.centros[0] : "", f: 1 / cats.length })); }
      return out;
    };
    const oposto = (t) => (t === "Receita" ? "Despesa" : "Receita");
    lista.parcelas.forEach((p) => {
      const d = detP.get(p.id), partes = partesDe(p, d);
      const comp = String((d && d.competencia) || p.competencia || p.vencimento || ini).slice(0, 10);
      const base = { descricao: p.descricao, contraparte: p.contraparte, idOrigem: p.id };
      const linha = (valorBase, extra) => partes.forEach((x) => { const v = valorBase * x.f; add({ ...base, ...extra, categoria: x.categoria, centroCusto: x.centro, tipo: v >= 0 ? p.tipo : oposto(p.tipo), valor: Math.abs(v) }); });
      // Competência
      if (p.porComp && comp >= ini && comp <= fim) {
        linha(p.total, { data: comp, competencia: comp.slice(0, 7), status: "Realizado", visao: "Competência", conta: "" });
        partes.forEach((x) => { const v = p.total * x.f; if ((v >= 0) === (p.tipo === "Receita")) rec += Math.abs(v); else desp += Math.abs(v); });
      }
      // Caixa realizado: baixas no período
      if (p.porPgto) {
        const baixas = (d && d.baixas) || [];
        if (!baixas.length) semDetalhe++;
        baixas.filter((b) => b.data && b.data >= ini && b.data <= fim).forEach((b) => {
          const mov = b.liquido || b.bruto;
          linha(mov, { data: b.data, competencia: comp.slice(0, 7), status: "Realizado", visao: "Caixa", conta: b.conta });
          if (p.tipo === "Receita") ent += mov; else sai += mov;
        });
      }
      // Caixa previsto: saldo em aberto com vencimento no período
      const st = String((d && d.status) || p.status).toUpperCase();
      if (p.porVenc && p.naoPago > 0.005 && p.vencimento >= ini && p.vencimento <= fim) {
        if (/PERDID|CANCEL|RENEGOCI/.test(st)) ignoradas++;
        else linha(p.naoPago, { data: p.vencimento, competencia: comp.slice(0, 7), status: "Previsto", visao: "Caixa", conta: (d && d.conta) || "" });
      }
    });
    avisos.push(`Visão de Competência (API): entradas ${brl(r2(rec))} · saídas ${brl(r2(desp))} · resultado ${brl(r2(rec - desp))}.`);
    avisos.push(`Visão de Caixa (API): entradas realizadas ${brl(r2(ent))} · saídas realizadas ${brl(r2(sai))} · geração de caixa ${brl(r2(ent - sai))}.`);
    if (semDetalhe) avisos.push(`${semDetalhe} parcela(s) com pagamento no período sem detalhe de baixa (falha na consulta) — refaça a busca para completar o caixa.`);
    if (ignoradas) avisos.push(`${ignoradas} parcela(s) perdidas, canceladas ou renegociadas ficaram fora do previsto.`);

    // Saldo inicial consolidado: só é possível reconstruir quando o período vai até o mês atual
    // (saldo atual − movimentos realizados desde o início do período). Para meses passados, importe o Extrato.
    const parcial = { lancamentos: lanc };
    const comSaldo = (lista.contas || []).filter((c) => c.saldoAtual != null);
    if (fim >= hoje && comSaldo.length) {
      const movimento = lanc.filter((l) => l.visao === "Caixa" && l.status === "Realizado" && l.data <= hoje).reduce((s, l) => s + (l.tipo === "Receita" ? l.valor : -l.valor), 0);
      const atual = comSaldo.reduce((s, c) => s + c.saldoAtual, 0);
      const diaAntes = new Date(Date.parse(ini) - 864e5).toISOString().slice(0, 10);
      parcial.contas = [{ _linha: 1, conta: "Saldo consolidado das contas (Conta Azul)", banco: "Conta Azul", saldoInicial: r2(atual - movimento), dataSaldo: diaAntes }];
      avisos.push(`Saldo em ${diaAntes.split("-").reverse().join("/")}: ${brl(r2(atual - movimento))} (saldo atual de ${comSaldo.length} conta(s) − movimentos do período).`);
    } else avisos.push("Saldo inicial das contas não alterado: para períodos passados, importe o Extrato de movimentações do mês (traz o saldo).");
    avisos.push(`Montados ${lanc.length} lançamentos: ${lanc.filter((l) => l.visao === "Competência").length} na visão de competência e ${lanc.filter((l) => l.visao === "Caixa").length} na visão de caixa.`);
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
    // (relatórios do Conta Azul trazem lançamentos legítimos idênticos — ex.: tarifas — por isso o número da linha entra na chave)
    (parcial.lancamentos || []).forEach((l) => { const k = [l.visao ? l._linha : "", l.idOrigem || "", l.data, l.categoria, l.centroCusto || "", l.status, l.valor, l.descricao, l.contraparte].join("|"); if (vistos.has(k)) dup++; vistos.add(k); });
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
      else if (L.some((l) => l.visao)) {
        // relatórios do Conta Azul: cada visão substitui só a própria visão nos meses do arquivo
        //  - Competência: meses de competência; - Caixa: meses do movimento.
        // Lançamentos antigos sem visão nesses meses também saem (evita contar duas vezes).
        const mComp = mesesDe(L.filter((l) => l.visao === "Competência"), (l) => l.competencia);
        const mCaixa = mesesDe(L.filter((l) => l.visao === "Caixa"), (l) => l.data && l.data.slice(0, 7));
        const sai = (l) => ((l.visao === "Competência" || !l.visao) && mComp.has(l.competencia)) || ((l.visao === "Caixa" || !l.visao) && mCaixa.has(l.data.slice(0, 7)));
        novo.lancamentos = [...novo.lancamentos.filter((l) => !sai(l)), ...L];
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
