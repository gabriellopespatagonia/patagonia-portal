/* =========================================================
   Exportações do consultor
   - Planilha única formatada (ExcelJS)
   - Apresentação de resultados (PptxGenJS) e PDF (impressão)
   ========================================================= */
(function () {
  const PB = window.PB, f = PB.fmt;
  const EX = (PB.exportar = {});
  const tot = (a) => PB.soma(a, (x) => x);
  const COR = { navy: "0C2A4B", navy2: "15395F", teal: "0070BD", tealLt: "E9F3FB", sky: "5AAEE8", cinza: "F1F3F6", amber: "C2A878", red: "B4573A", green: "5F7F5A", txt: "0E1B2B", muted: "5B6B7D" };
  const FMT_R = '"R$" #,##0;[Red]-"R$" #,##0';
  const FMT_P = "0.0%";
  const nomeArq = (s) => s.replace(/[\\/:*?"<>|]/g, "-");
  const SCRIPT = document.currentScript && document.currentScript.src;
  const FOTO_CAPA = "https://images.unsplash.com/photo-1626368185783-7c928d6f0133?w=1920&q=70&auto=format&fit=crop";

  /* Logos da marca em PNG (branco e azul) e foto de capa — usados no Excel, PowerPoint e PDF */
  let cacheImg = null;
  EX.imagens = async function () {
    if (cacheImg) return cacheImg;
    const carregar = (src, cors) => new Promise((ok, erro) => { const i = new Image(); if (cors) i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = erro; i.src = src; });
    const png = (img, cor, w = img.naturalWidth, h = img.naturalHeight, tipo = "image/png") => {
      const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
      g.drawImage(img, 0, 0, w, h);
      if (cor) { g.globalCompositeOperation = "source-in"; g.fillStyle = cor; g.fillRect(0, 0, w, h); }
      return c.toDataURL(tipo, .82);
    };
    const r = { razao: 948 / 2000 };
    try {
      const logo = await carregar(new URL("../img/logo-branco.webp", SCRIPT || location.href).href);
      r.razao = logo.naturalHeight / logo.naturalWidth;
      r.logoBranco = png(logo, null, 800, Math.round(800 * r.razao));
      r.logoAzul = png(logo, "#0070bd", 800, Math.round(800 * r.razao));
    } catch (e) { console.warn("Logo não carregado", e); }
    try { const foto = await carregar(FOTO_CAPA, true); r.foto = png(foto, null, 1600, Math.round(1600 * foto.naturalHeight / foto.naturalWidth), "image/jpeg"); }
    catch (e) { console.warn("Foto de capa não carregada", e); }
    return (cacheImg = r);
  };

  function baixar(blob, nome) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- Conteúdo comum (números do período) ---------- */
  EX.conteudo = function (dados, cliente, meses) {
    const dre = PB.calc.dre(dados, meses), t = dre.totais;
    const fat = tot(t.receitaBruta);
    const horizonte = PB.mesesEntre(meses[0], dados.lancamentos.reduce((m, l) => (l.data.slice(0, 7) > m ? l.data.slice(0, 7) : m), meses.at(-1)));
    const fl = PB.calc.fluxo(dados, horizonte);
    const cl = PB.calc.caixaLivre(dados, meses);
    const com = PB.calc.comercial(dados, meses);
    const desp = PB.calc.composicao(dados, meses, ["DV", "DF"]);
    const cus = PB.calc.composicao(dados, meses, ["CV"]);
    const real = fl.linhas.filter((l) => !l.previsto && meses.includes(l.mes));
    return {
      cliente, meses, periodo: `${f.mes(meses[0])} a ${f.mes(meses.at(-1))}`, dre, fl, cl, com, desp, cus,
      dfc: PB.calc.dfc(dados, meses),
      kpis: {
        faturamento: fat, lucroBruto: tot(t.lucroBruto), lucroOperacional: tot(t.ebitda), lucroLiquido: tot(t.liquido),
        saldoCaixa: real.at(-1)?.saldoFinal || 0, caixaLivre: tot(cl.fcl), pedidos: com.totalPedidos, ticket: com.total / (com.totalPedidos || 1), clientes: com.totalClientes
      },
      analises: [PB.analise.dre(dados, meses), PB.analise.dfc(dados, meses), PB.analise.fluxo(dados, horizonte), PB.analise.comercial(dados, meses)]
    };
  };

  /* =========================================================
     PLANILHA ÚNICA (ExcelJS)
     ========================================================= */
  EX.planilha = async function (dados, cliente, meses) {
    if (!window.ExcelJS) throw new Error("Biblioteca ExcelJS não carregada.");
    const C = EX.conteudo(dados, cliente, meses);
    const wb = new ExcelJS.Workbook();
    wb.creator = "Patagonia Business"; wb.created = new Date();
    const fill = (hex) => ({ type: "pattern", pattern: "solid", fgColor: { argb: "FF" + hex } });
    const borda = { bottom: { style: "thin", color: { argb: "FFDBE3E8" } } };

    function aba(nome, cor = COR.teal) {
      const ws = wb.addWorksheet(nome, { properties: { tabColor: { argb: "FF" + cor } }, views: [{ showGridLines: false }] });
      ws.getColumn(1).width = 2;
      return ws;
    }
    function titulo(ws, texto, sub, nCols) {
      ws.mergeCells(2, 2, 2, nCols + 1); ws.mergeCells(3, 2, 3, nCols + 1);
      const c = ws.getCell(2, 2); c.value = texto; c.font = { name: "Calibri", size: 18, bold: true, color: { argb: "FFFFFFFF" } }; c.fill = fill(COR.navy); c.alignment = { vertical: "middle", indent: 1 };
      ws.getRow(2).height = 34;
      const s = ws.getCell(3, 2); s.value = sub; s.font = { size: 11, color: { argb: "FFFFFFFF" } }; s.fill = fill(COR.navy2); s.alignment = { indent: 1 };
      ws.getRow(3).height = 20;
      return 5; // próxima linha livre
    }
    function cabecalho(ws, linha, cols) {
      cols.forEach((t, j) => {
        const c = ws.getCell(linha, j + 2); c.value = t;
        c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = fill(COR.teal);
        c.alignment = { horizontal: j === 0 ? "left" : "center", vertical: "middle", wrapText: true };
      });
      ws.getRow(linha).height = 22;
    }
    function secao(ws, linha, texto, nCols) {
      ws.mergeCells(linha, 2, linha, nCols + 1);
      const c = ws.getCell(linha, 2); c.value = texto; c.font = { bold: true, size: 13, color: { argb: "FF" + COR.navy } };
      c.border = { bottom: { style: "medium", color: { argb: "FF" + COR.teal } } };
      return linha + 2;
    }
    function demonstrativo(ws, linha, linhas, comAV) {
      const base = tot(C.dre.totais.receitaBruta);
      linhas.forEach((l) => {
        const t = tot(l.valores);
        const vals = [l.nome, ...l.valores.map(Math.round), Math.round(t)];
        if (comAV) vals.push(base ? t / base : 0);
        vals.forEach((v, j) => {
          const c = ws.getCell(linha, j + 2); c.value = v; c.border = borda;
          if (j > 0) c.numFmt = comAV && j === vals.length - 1 ? FMT_P : FMT_R;
          if (j === 0 && l.nivel) c.alignment = { indent: l.nivel * 2 };
          if (l.estilo === "conta") c.font = { color: { argb: "FF" + COR.muted }, size: 10 };
          if (l.estilo === "sgrp") c.font = { bold: true, italic: true };
          if (l.estilo === "grp" || l.estilo === "sub") { c.font = { bold: true, color: { argb: "FF" + COR.navy } }; c.fill = fill("D9EBF8"); }
          if (l.estilo === "res" || l.estilo === "total") { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = fill(COR.navy); }
        });
        linha++;
      });
      return linha;
    }
    function larguras(ws, primeira, demais, n) { ws.getColumn(2).width = primeira; for (let j = 3; j < 3 + n; j++) ws.getColumn(j).width = demais; }
    function tabela(ws, linha, cols, linhas, formatos) {
      cabecalho(ws, linha, cols); linha++;
      linhas.forEach((r, i) => {
        r.forEach((v, j) => {
          const c = ws.getCell(linha, j + 2); c.value = v; c.border = borda;
          if (formatos && formatos[j]) c.numFmt = formatos[j];
          if (i % 2) c.fill = fill("F7F9FA");
        });
        linha++;
      });
      return linha;
    }
    const sub = `${cliente.nome} · ${C.periodo}`;
    const M = meses.map(f.mes);

    // 1. Capa
    const capa = aba("Capa", COR.navy);
    capa.getColumn(2).width = 28; capa.getColumn(3).width = 70;
    capa.mergeCells("B2:C3"); const ct = capa.getCell("B2");
    ct.value = "Relatório Gerencial"; ct.font = { size: 26, bold: true, color: { argb: "FFFFFFFF" } }; ct.fill = fill(COR.navy); ct.alignment = { vertical: "middle", indent: 1 };
    capa.getRow(2).height = 34; capa.getRow(3).height = 34;
    const imgs = await EX.imagens();
    if (imgs.logoBranco) capa.addImage(wb.addImage({ base64: imgs.logoBranco, extension: "png" }), { tl: { col: 2.62, row: 1.12 }, ext: { width: 150, height: Math.round(150 * imgs.razao) } });
    capa.mergeCells("B4:C4"); const cs = capa.getCell("B4"); cs.value = "Patagonia Business · Consultoria & BPO Financeiro"; cs.font = { color: { argb: "FFFFFFFF" } }; cs.fill = fill(COR.teal); cs.alignment = { indent: 1 };
    [["Empresa", cliente.nome], ["CNPJ", cliente.cnpj || "—"], ["Setor", cliente.setor || "—"], ["Período", C.periodo], ["Gerado em", new Date().toLocaleString("pt-BR")], ["Última publicação dos dados", dados.atualizadoEm ? new Date(dados.atualizadoEm).toLocaleString("pt-BR") : "—"]]
      .forEach(([k, v], i) => { const r = 6 + i; capa.getCell(r, 2).value = k; capa.getCell(r, 2).font = { bold: true, color: { argb: "FF" + COR.muted } }; capa.getCell(r, 3).value = v; capa.getCell(r, 3).border = borda; });
    capa.getCell("B13").value = "Conteúdo"; capa.getCell("B13").font = { bold: true, size: 13, color: { argb: "FF" + COR.navy } };
    const indice = [["KPIs", "Indicadores e observações do período"], ["DRE", "Demonstração do Resultado (competência)"], ["DFC", "Demonstração dos Fluxos de Caixa"], ["Fluxo de Caixa", "Saldo realizado e previsto"],
      ["Projecoes", "Projeções publicadas por cenário"], ["Comercial", "Vendas, clientes e produtos"], ["Fechamentos", "Situação do fechamento mensal"],
      ["Base Lancamentos", "Base de dados — lançamentos do período"], ["Base Vendas", "Base de dados — vendas do período"], ["Base Plano Contas", "Plano de contas gerencial"]];
    indice.forEach(([a, d], i) => {
      const r = 14 + i; const c = capa.getCell(r, 2);
      c.value = { text: a.replace("Projecoes", "Projeções").replace("Lancamentos", "Lançamentos").replace("Plano Contas", "Plano de Contas"), hyperlink: `#'${a}'!A1` };
      c.font = { color: { argb: "FF" + COR.teal }, underline: true }; capa.getCell(r, 3).value = d; capa.getCell(r, 3).font = { color: { argb: "FF" + COR.muted } };
    });

    // 2. KPIs
    const k = aba("KPIs"); let r = titulo(k, "Indicadores do período", sub, 4);
    larguras(k, 34, 20, 3);
    const K = C.kpis;
    r = tabela(k, r, ["Indicador", "Valor", "% do faturamento"], [
      ["Faturamento (Receita Bruta)", K.faturamento, null], ["Resultado Operacional Bruto (Margem de Contribuição)", K.lucroBruto, K.lucroBruto / K.faturamento],
      ["Resultado Operacional Líquido (EBITDA)", K.lucroOperacional, K.lucroOperacional / K.faturamento],
      ["Resultado Líquido", K.lucroLiquido, K.lucroLiquido / K.faturamento], ["Saldo de caixa (fim do período)", K.saldoCaixa, null], ["Fluxo de caixa livre no período", K.caixaLivre, null],
      ["Pedidos", K.pedidos, null], ["Ticket médio", K.ticket, null], ["Clientes atendidos", K.clientes, null]
    ], [null, FMT_R, FMT_P]);
    k.getCell(r - 3, 3).numFmt = "#,##0"; k.getCell(r - 1, 3).numFmt = "#,##0";
    r = secao(k, r + 1, "Observações do período", 4);
    C.analises.forEach((a) => {
      k.getCell(r, 2).value = a.titulo; k.getCell(r, 2).font = { bold: true, color: { argb: "FF" + COR.teal } }; r++;
      a.obs.forEach((o) => { k.mergeCells(r, 2, r, 5); const c = k.getCell(r, 2); c.value = "• " + o; c.alignment = { wrapText: true, vertical: "top" }; k.getRow(r).height = Math.max(18, Math.ceil(o.length / 95) * 15); r++; });
      r++;
    });

    // 3. DRE
    const d = aba("DRE"); r = titulo(d, "Demonstrativo de Resultado do Exercício (DRE) — competência", sub, meses.length + 3);
    larguras(d, 40, 14, meses.length + 2);
    cabecalho(d, r, ["Conta", ...M, "Total", "% Fat."]); d.views = [{ state: "frozen", xSplit: 2, ySplit: r, showGridLines: false }];
    demonstrativo(d, r + 1, C.dre.linhas, true);

    // 4. DFC
    const dfc = aba("DFC"); r = titulo(dfc, "Demonstrativo de Fluxo de Caixa (DFC) — método direto", sub, meses.length + 2);
    larguras(dfc, 40, 14, meses.length + 1);
    cabecalho(dfc, r, ["Atividade / categoria", ...M, "Total"]); dfc.views = [{ state: "frozen", xSplit: 2, ySplit: r, showGridLines: false }];
    r = demonstrativo(dfc, r + 1, C.dfc.linhas, false);
    demonstrativo(dfc, r, [{ nome: "Fluxo de caixa livre (operacional + investimentos)", valores: C.cl.fcl, estilo: "sub" }], false);

    // 5. Fluxo
    const fx = aba("Fluxo de Caixa"); r = titulo(fx, "Fluxo de caixa mensal", sub, 7);
    larguras(fx, 14, 18, 6);
    tabela(fx, r, ["Mês", "Situação", "Saldo inicial", "Entradas", "Saídas", "Resultado", "Saldo final"],
      C.fl.linhas.map((l) => [f.mes(l.mes), l.previsto ? "Previsto" : "Realizado", Math.round(l.saldoInicial), Math.round(l.entradas), Math.round(l.saidas), Math.round(l.liquido), Math.round(l.saldoFinal)]),
      [null, null, FMT_R, FMT_R, FMT_R, FMT_R, FMT_R]);

    // 6. Projeções
    const pj = aba("Projecoes", COR.amber); r = titulo(pj, "Projeções publicadas", sub, 8);
    larguras(pj, 12, 16, 7); pj.getColumn(9).width = 40;
    tabela(pj, r, ["Mês", "Cenário", "Receita", "Custos", "Despesas", "Resultado", "Investimentos", "Observação"],
      dados.projecoes.map((p) => [f.mes(p.mes), p.cenario, p.receita, p.custos || 0, p.despesas || 0, p.receita - (p.custos || 0) - (p.despesas || 0), p.investimentos || 0, p.observacao || ""]),
      [null, null, FMT_R, FMT_R, FMT_R, FMT_R, FMT_R, null]);

    // 7. Comercial
    const cm = aba("Comercial", COR.green); r = titulo(cm, "Comercial", sub, meses.length + 1);
    larguras(cm, 36, 14, Math.max(meses.length, 4));
    r = secao(cm, r, "Indicadores mensais", meses.length + 1);
    r = tabela(cm, r, ["Indicador", ...M], [
      ["Faturamento", ...C.com.faturamento.map(Math.round)], ["Pedidos", ...C.com.pedidos], ["Ticket médio", ...C.com.ticket.map(Math.round)],
      ["Clientes ativos", ...C.com.clientesAtivos], ["Novos clientes", ...C.com.novosClientes]
    ]);
    for (let j = 3; j < 3 + meses.length; j++) { cm.getCell(r - 5, j).numFmt = FMT_R; cm.getCell(r - 3, j).numFmt = FMT_R; }
    r = secao(cm, r + 1, "Curva ABC de clientes", 5);
    let ac = 0;
    r = tabela(cm, r, ["Cliente", "Faturamento", "Pedidos", "Part.", "Acum.", "Classe"],
      C.com.porCliente.map((c) => { ac += c.valor; const p = ac / C.com.total; return [c.nome, Math.round(c.valor), c.vendas, c.valor / C.com.total, p, p <= 0.8 ? "A" : p <= 0.95 ? "B" : "C"]; }),
      [null, FMT_R, "#,##0", FMT_P, FMT_P, null]);
    r = secao(cm, r + 1, "Produtos e serviços", 4);
    tabela(cm, r, ["Produto / serviço", "Faturamento", "Quantidade", "Part."], C.com.porItem.map((x) => [x.nome, Math.round(x.valor), x.qtd, x.valor / C.com.total]), [null, FMT_R, "#,##0", FMT_P]);

    // 8. Fechamentos
    const fe = aba("Fechamentos", COR.navy2); r = titulo(fe, "Situação do fechamento mensal", sub, 5);
    larguras(fe, 12, 18, 4); fe.getColumn(6).width = 50;
    r = tabela(fe, r, ["Mês", "Status", "Responsável", "Data", "Observação"], meses.map((m) => {
      const x = (dados.fechamentos || {})[m] || {};
      return [f.mes(m), x.status || "Aberto", x.por || "", x.em ? new Date(x.em).toLocaleDateString("pt-BR") : "", x.obs || ""];
    }));
    for (let i = r - meses.length; i < r; i++) { const c = fe.getCell(i, 3); c.font = { bold: true, color: { argb: "FF" + (c.value === "Fechado" ? COR.green : COR.amber) } }; }

    // 9. Bases de dados
    function base(nome, colunas, registros) {
      const ws = aba(nome, COR.muted); let lin = titulo(ws, nome.replace("Base ", "Base de dados — ").replace("Lancamentos", "Lançamentos").replace("Plano Contas", "Plano de Contas"), sub + ` · ${registros.length} registros`, colunas.length);
      cabecalho(ws, lin, colunas.map((c) => c.titulo));
      registros.forEach((reg, i) => colunas.forEach((c, j) => {
        let v = reg[c.campo];
        if (c.tipo === "data" && v) { const [y, m, dd] = v.split("-"); v = new Date(Date.UTC(+y, +m - 1, +dd)); }
        const cel = ws.getCell(lin + 1 + i, j + 2); cel.value = v ?? "";
        if (c.tipo === "numero") cel.numFmt = c.campo === "quantidade" ? "#,##0" : '#,##0.00';
        if (c.tipo === "data") cel.numFmt = "dd/mm/yyyy";
      }));
      colunas.forEach((c, j) => (ws.getColumn(j + 2).width = Math.max(12, c.titulo.length + 4, ["descricao", "categoria", "cliente", "item", "contraparte"].includes(c.campo) ? 30 : 0)));
      ws.autoFilter = { from: { row: lin, column: 2 }, to: { row: lin + registros.length, column: colunas.length + 1 } };
      ws.views = [{ state: "frozen", ySplit: lin, showGridLines: true }];
    }
    const Mo = PB.MODELO.abas;
    base("Base Lancamentos", Mo.Lancamentos.colunas, dados.lancamentos.filter((l) => meses.includes(l.competencia)));
    base("Base Vendas", Mo.Vendas.colunas, dados.vendas.filter((v) => meses.includes(v.data.slice(0, 7))));
    base("Base Plano Contas", Mo.PlanoContas.colunas, dados.planoContas);

    const buf = await wb.xlsx.writeBuffer();
    const nome = nomeArq(`Relatório ${cliente.nome} - ${C.periodo}.xlsx`);
    baixar(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), nome);
    return nome;
  };

  /* =========================================================
     APRESENTAÇÃO (PowerPoint e PDF)
     ========================================================= */
  const PAL = ["0070BD", "0C2A4B", "5AAEE8", "C2A878", "5F7F5A", "8A99AA", "9CC9EA", "B4573A"];
  const topN = (comp, n) => { const t = comp.slice(0, n), r = comp.slice(n); return r.length ? [...t, { nome: "Outros", total: PB.soma(r, (x) => x.total) }] : t; };

  EX.apresentacao = async function (dados, cliente, meses, conc, formato) {
    const C = EX.conteudo(dados, cliente, meses);
    const img = await EX.imagens();
    return formato === "pdf" ? pdf(C, conc, dados, img) : pptx(C, conc, img);
  };

  function pptx(C, conc, img) {
    if (!window.PptxGenJS) throw new Error("Biblioteca PptxGenJS não carregada.");
    const p = new PptxGenJS(); p.layout = "LAYOUT_WIDE"; p.author = "Patagonia Business"; p.company = "Patagonia Business"; p.title = `Resultados ${C.cliente.nome}`;
    // Georgia (serifada) nos títulos e Calibri nos textos: fontes presentes em qualquer PowerPoint
    const W = 13.33, fonte = "Calibri", serif = "Georgia";
    const logoH = (w) => w * (img.razao || 0.474);
    p.defineSlideMaster({ title: "PB", background: { color: "FFFFFF" }, objects: [
      ...(img.logoAzul ? [{ image: { data: img.logoAzul, x: 11.55, y: 0.32, w: 1.25, h: logoH(1.25) } }] : []),
      { line: { x: 0.5, y: 6.95, w: 12.33, h: 0, line: { color: "DFE4EA", width: 0.75 } } },
      { text: { text: `Patagonia Business  ·  ${C.cliente.nome}  ·  ${C.periodo}`, options: { x: 0.5, y: 7.0, w: 9, h: 0.3, fontSize: 9, color: COR.muted, fontFace: fonte } } }
    ], slideNumber: { x: 12.35, y: 7.0, fontSize: 9, color: COR.muted, fontFace: fonte } });
    const slide = (titulo, subtitulo, rotulo = "Resultados") => {
      const s = p.addSlide({ masterName: "PB" });
      s.addText(rotulo.toUpperCase(), { x: 0.5, y: 0.32, w: 9, h: 0.25, fontSize: 9, color: COR.teal, fontFace: fonte, charSpacing: 4 });
      s.addText(titulo, { x: 0.5, y: 0.55, w: 10.8, h: 0.6, fontSize: 26, color: COR.navy, fontFace: serif });
      if (subtitulo) s.addText(subtitulo, { x: 0.5, y: 1.1, w: 10.8, h: 0.3, fontSize: 12, color: COR.muted, fontFace: fonte });
      return s;
    };
    const bullets = (s, itens, o) => s.addText(itens.map((t) => ({ text: t, options: { bullet: { indent: 18 }, paraSpaceAfter: 8 } })), { fontSize: 15, color: COR.txt, fontFace: fonte, valign: "top", ...o });
    const kpiBox = (s, x, y, w, rotulo, valor, sub2) => {
      s.addShape(p.ShapeType.rect, { x, y, w, h: 1.35, fill: { color: "FFFFFF" }, line: { color: "DFE4EA", width: 0.75 } });
      s.addShape(p.ShapeType.rect, { x, y, w, h: 0.05, fill: { color: COR.teal }, line: { color: COR.teal, width: 0 } });
      s.addText(rotulo, { x: x + 0.15, y: y + 0.12, w: w - 0.3, h: 0.3, fontSize: 10, color: COR.muted, fontFace: fonte });
      s.addText(valor, { x: x + 0.15, y: y + 0.42, w: w - 0.3, h: 0.5, fontSize: 22, color: COR.navy, fontFace: serif });
      if (sub2) s.addText(sub2, { x: x + 0.15, y: y + 0.92, w: w - 0.3, h: 0.3, fontSize: 11, bold: true, color: COR.teal, fontFace: fonte });
    };
    const M = C.meses.map(f.mes), K = C.kpis, r0 = (a) => a.map(Math.round);
    const eixo = { valAxisLabelFormatCode: '#,##0', catAxisLabelFontSize: 10, valAxisLabelFontSize: 10, legendFontSize: 11, showLegend: true, legendPos: "b" };

    // Capa
    const capa = p.addSlide(); capa.background = { color: COR.navy };
    if (img.foto) {
      capa.addImage({ data: img.foto, x: 0, y: 0, w: W, h: 7.5, sizing: { type: "cover", w: W, h: 7.5 } });
      capa.addShape(p.ShapeType.rect, { x: 0, y: 0, w: W, h: 7.5, fill: { color: "061A30", transparency: 35 }, line: { color: "061A30", transparency: 100 } });
    }
    if (img.logoBranco) capa.addImage({ data: img.logoBranco, x: 0.8, y: 0.6, w: 1.9, h: logoH(1.9) });
    capa.addText("APRESENTAÇÃO DE RESULTADOS", { x: 0.8, y: 3.55, w: 11, h: 0.35, fontSize: 12, color: "5AAEE8", fontFace: fonte, charSpacing: 6 });
    capa.addText(C.cliente.nome, { x: 0.8, y: 3.95, w: 11.5, h: 1.0, fontSize: 42, color: "FFFFFF", fontFace: serif });
    capa.addText(`Período: ${C.periodo}`, { x: 0.8, y: 4.95, w: 11, h: 0.45, fontSize: 18, color: "E9F3FB", fontFace: fonte });
    capa.addText("Patagonia Business  ·  Consultoria e BPO Financeiro", { x: 0.8, y: 6.7, w: 11, h: 0.35, fontSize: 11, color: "CFE0EE", fontFace: fonte });

    // Contexto
    if (C.cliente.contexto || C.cliente.setor) {
      const s = slide("Sobre a empresa", C.cliente.setor || "", "Contexto");
      s.addText(C.cliente.contexto || "", { x: 0.5, y: 1.65, w: 12.3, h: 5, fontSize: 17, color: COR.txt, fontFace: fonte, valign: "top", paraSpaceAfter: 10 });
    }

    // Resumo executivo
    const re = slide("Resumo executivo", C.periodo, "Visão geral");
    re.addText(conc.resumoExecutivo || "", { x: 0.5, y: 1.65, w: 12.3, h: 1.4, fontSize: 17, color: COR.txt, fontFace: fonte, valign: "top" });
    re.addText("Destaques", { x: 0.5, y: 3.2, w: 12, h: 0.4, fontSize: 18, color: COR.teal, fontFace: serif });
    bullets(re, conc.destaques || [], { x: 0.5, y: 3.65, w: 12.3, h: 3.2 });

    // KPIs
    const kp = slide("Principais indicadores — competência", C.periodo, "Indicadores");
    [["Faturamento (Receita Bruta)", K.faturamento, null], ["Margem de Contribuição", K.lucroBruto, K.lucroBruto / K.faturamento], ["Resultado Operacional Líquido (EBITDA)", K.lucroOperacional, K.lucroOperacional / K.faturamento], ["Resultado Líquido", K.lucroLiquido, K.lucroLiquido / K.faturamento]]
      .forEach(([t, v, pc], i) => kpiBox(kp, 0.5 + i * 3.1, 1.6, 2.9, t, f.moeda(v), pc != null ? f.pct(pc) + " do faturamento" : ""));
    kp.addChart(p.ChartType.bar, [
      { name: "Faturamento (Receita Bruta)", labels: M, values: r0(C.dre.totais.receitaBruta) },
      { name: "Resultado Operacional Líquido (EBITDA)", labels: M, values: r0(C.dre.totais.ebitda) },
      { name: "Resultado Líquido", labels: M, values: r0(C.dre.totais.liquido) }
    ], { x: 0.5, y: 3.1, w: 12.3, h: 3.75, barGrouping: "clustered", chartColors: [COR.teal, COR.navy, COR.amber], ...eixo });

    // DRE resumida
    const dr = slide("Demonstrativo de Resultado do Exercício (DRE)", C.periodo, "Demonstrativos");
    const fat = K.faturamento, n = C.meses.length;
    const linhasDre = C.dre.linhas.filter((l) => !l.nivel);
    const hdr = ["Conta", "Total do período", "% Fat.", "Média mensal", `Último mês (${M.at(-1)})`].map((t) => ({ text: t, options: { bold: true, color: "FFFFFF", fill: { color: COR.teal } } }));
    dr.addTable([hdr, ...linhasDre.map((l) => {
      const t = tot(l.valores), res = l.estilo === "res", est = res ? { bold: true, fill: { color: COR.navy } } : l.estilo === "grp" ? { bold: true, fill: { color: "D9EBF8" } } : {};
      return [l.nome, f.moeda(t), f.pct(fat ? t / fat : 0), f.moeda(t / n), f.moeda(l.valores.at(-1))].map((v, j) => ({ text: v, options: { ...est, align: j ? "right" : "left", color: res ? "FFFFFF" : j && v.startsWith("-") ? COR.red : COR.txt } }));
    })], { x: 0.5, y: 1.5, w: 12.3, colW: [5.3, 2.0, 1.0, 2.0, 2.0], fontSize: 9, fontFace: fonte, border: { type: "solid", color: "DFE4EA", pt: 0.5 }, rowH: 0.205, margin: 0.03 });

    // Composições
    [["Composição das despesas", C.desp.porCategoria, 7], ["Composição dos custos e deduções", C.cus.porCategoria, 6]].forEach(([tit, comp, nn]) => {
      const s = slide(tit, C.periodo, "Custos e despesas"); const serie = topN(comp, nn); const total = PB.soma(serie, (x) => x.total);
      s.addChart(p.ChartType.doughnut, [{ name: tit, labels: serie.map((x) => x.nome), values: serie.map((x) => Math.round(x.total)) }],
        { x: 0.4, y: 1.55, w: 5.6, h: 5.3, holeSize: 62, chartColors: PAL, showLegend: true, legendPos: "b", legendFontSize: 10, dataLabelFormatCode: "0%", showPercent: true, showValue: false });
      s.addTable([[{ text: "Categoria", options: { bold: true, color: "FFFFFF", fill: { color: COR.teal } } }, { text: "Valor", options: { bold: true, color: "FFFFFF", fill: { color: COR.teal }, align: "right" } }, { text: "% do total", options: { bold: true, color: "FFFFFF", fill: { color: COR.teal }, align: "right" } }, { text: "% fat.", options: { bold: true, color: "FFFFFF", fill: { color: COR.teal }, align: "right" } }],
        ...serie.map((x) => [x.nome, { text: f.moeda(x.total), options: { align: "right" } }, { text: f.pct(x.total / total), options: { align: "right" } }, { text: f.pct(x.total / fat), options: { align: "right" } }])],
        { x: 6.3, y: 1.7, w: 6.5, colW: [3.1, 1.4, 1.0, 1.0], fontSize: 11, fontFace: fonte, border: { type: "solid", color: "DBE3E8", pt: 0.5 }, rowH: 0.36 });
    });

    // Caixa
    const cx = slide("Saldo e geração de caixa livre", C.periodo, "Caixa");
    kpiBox(cx, 0.5, 1.6, 3.9, "Saldo de caixa (fim do período)", f.moeda(K.saldoCaixa));
    kpiBox(cx, 4.7, 1.6, 3.9, K.caixaLivre >= 0 ? "Geração de caixa livre" : "Queima de caixa livre", f.moeda(K.caixaLivre));
    const prev = C.fl.linhas.filter((l) => l.previsto).at(-1);
    kpiBox(cx, 8.9, 1.6, 3.9, "Saldo previsto", f.moeda(prev ? prev.saldoFinal : K.saldoCaixa), prev ? "em " + f.mes(prev.mes) : "");
    cx.addChart(p.ChartType.line, [{ name: "Saldo final", labels: C.fl.linhas.map((l) => f.mes(l.mes)), values: r0(C.fl.linhas.map((l) => l.saldoFinal)) }],
      { x: 0.5, y: 3.1, w: 6.1, h: 3.75, chartColors: [COR.teal], lineSize: 3, ...eixo, title: "Saldo de caixa (realizado + previsto)", showTitle: true, titleFontSize: 12 });
    cx.addChart(p.ChartType.bar, [{ name: "Caixa livre", labels: M, values: r0(C.cl.fcl) }],
      { x: 6.8, y: 3.1, w: 6.0, h: 3.75, chartColors: [COR.teal], invertIfNegative: true, ...eixo, showLegend: false, title: "Fluxo de caixa livre mensal", showTitle: true, titleFontSize: 12 });

    // Comercial
    const cm = slide("Vendas e clientes", `${f.num(K.pedidos)} pedidos · ticket médio ${f.moeda(K.ticket)} · ${f.num(K.clientes)} clientes`, "Comercial");
    cm.addChart(p.ChartType.bar, [{ name: "Faturamento", labels: M, values: r0(C.com.faturamento) }], { x: 0.5, y: 1.6, w: 7.2, h: 5.25, chartColors: [COR.teal], ...eixo, showLegend: false });
    cm.addTable([[{ text: "Top 8 clientes", options: { bold: true, color: "FFFFFF", fill: { color: COR.teal } } }, { text: "Faturamento", options: { bold: true, color: "FFFFFF", fill: { color: COR.teal }, align: "right" } }, { text: "Part.", options: { bold: true, color: "FFFFFF", fill: { color: COR.teal }, align: "right" } }],
      ...C.com.porCliente.slice(0, 8).map((c) => [c.nome, { text: f.moeda(c.valor), options: { align: "right" } }, { text: f.pct(c.valor / C.com.total), options: { align: "right" } }])],
      { x: 8.0, y: 1.7, w: 4.8, colW: [2.6, 1.4, 0.8], fontSize: 11, fontFace: fonte, border: { type: "solid", color: "DBE3E8", pt: 0.5 }, rowH: 0.34 });

    // Benchmarks
    const bm = (C.cliente.benchmarks || {});
    if (bm.texto) {
      const s = slide("Referências do setor", C.cliente.setor || "", "Mercado");
      s.addText(bm.texto.slice(0, 1800), { x: 0.5, y: 1.6, w: 12.3, h: 4.7, fontSize: 13, color: COR.txt, fontFace: fonte, valign: "top" });
      if ((bm.fontes || []).length) s.addText("Fontes: " + bm.fontes.slice(0, 6).map((x) => x.titulo || x.url).join(" · "), { x: 0.5, y: 6.35, w: 12.3, h: 0.6, fontSize: 9, color: COR.muted, fontFace: fonte });
    }

    // Atenção e recomendações
    const at = slide("Pontos de atenção e recomendações", "", "Recomendações");
    at.addText("Pontos de atenção", { x: 0.5, y: 1.5, w: 6, h: 0.4, fontSize: 18, color: COR.red, fontFace: serif });
    bullets(at, conc.pontosAtencao || [], { x: 0.5, y: 1.95, w: 6, h: 4.9 });
    at.addText("Recomendações", { x: 6.9, y: 1.5, w: 6, h: 0.4, fontSize: 18, color: COR.teal, fontFace: serif });
    bullets(at, conc.recomendacoes || [], { x: 6.9, y: 1.95, w: 5.9, h: 4.9 });

    // Conclusão
    const cc = p.addSlide(); cc.background = { color: COR.teal };
    cc.addText("CONCLUSÃO", { x: 0.8, y: 0.8, w: 11, h: 0.35, fontSize: 12, color: "E9F3FB", fontFace: fonte, charSpacing: 6 });
    cc.addText(conc.conclusao || "", { x: 0.8, y: 1.3, w: 11.7, h: 4.2, fontSize: 22, color: "FFFFFF", fontFace: serif, valign: "top" });
    if (img.logoBranco) cc.addImage({ data: img.logoBranco, x: 0.8, y: 5.9, w: 1.7, h: logoH(1.7) });
    cc.addText("Vamos subir juntos?", { x: 7.3, y: 6.25, w: 5.2, h: 0.4, fontSize: 14, color: "FFFFFF", fontFace: serif, align: "right" });

    const nome = nomeArq(`Apresentação ${C.cliente.nome} - ${C.periodo}`);
    return p.writeFile({ fileName: nome + ".pptx" }).then(() => nome + ".pptx");
  }

  /* ---------- PDF: slides em HTML + impressão do navegador ---------- */
  function imagemGrafico(config, w = 1100, h = 520) {
    const box = document.createElement("div"); box.style.cssText = `position:fixed;left:-9999px;top:0;width:${w}px;height:${h}px`;
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h; box.appendChild(cv); document.body.appendChild(box);
    config.options = Object.assign({ responsive: false, animation: false, devicePixelRatio: 2, plugins: { legend: { position: "bottom", labels: { font: { size: 16 } } } } }, config.options || {});
    const ch = new Chart(cv, config); const url = ch.toBase64Image(); ch.destroy(); box.remove(); return url;
  }
  function pdf(C, conc, dados, img) {
    if (window.Chart) Chart.defaults.font.family = "Poppins";
    const M = C.meses.map(f.mes), K = C.kpis, e = PB.esc;
    const hex = (h) => "#" + h;
    const gRes = imagemGrafico({ type: "bar", data: { labels: M, datasets: [
      { label: "Faturamento (Receita Bruta)", data: C.dre.totais.receitaBruta, backgroundColor: hex(COR.teal) },
      { label: "Resultado Operacional Líquido (EBITDA)", data: C.dre.totais.ebitda, backgroundColor: hex(COR.navy) },
      { label: "Resultado Líquido", data: C.dre.totais.liquido, backgroundColor: hex(COR.amber) }] } }, 1600, 500);
    const pizza = (comp, nn) => { const s = topN(comp, nn); return imagemGrafico({ type: "doughnut", data: { labels: s.map((x) => x.nome), datasets: [{ data: s.map((x) => x.total), backgroundColor: PAL.map(hex) }] }, options: { cutout: "55%", plugins: { legend: { position: "right", labels: { font: { size: 15 } } } } } }, 900, 480); };
    const gSaldo = imagemGrafico({ type: "line", data: { labels: C.fl.linhas.map((l) => f.mes(l.mes)), datasets: [{ label: "Saldo final", data: C.fl.linhas.map((l) => l.saldoFinal), borderColor: hex(COR.teal), borderWidth: 4, tension: .3 }] } }, 800, 460);
    const gFcl = imagemGrafico({ type: "bar", data: { labels: M, datasets: [{ label: "Caixa livre", data: C.cl.fcl, backgroundColor: C.cl.fcl.map((v) => (v >= 0 ? hex(COR.green) : hex(COR.red))) }] } }, 800, 460);
    const gCom = imagemGrafico({ type: "bar", data: { labels: M, datasets: [{ label: "Faturamento", data: C.com.faturamento, backgroundColor: hex(COR.teal) }] } }, 800, 520);
    const ul = (arr) => `<ul>${(arr || []).map((x) => `<li>${e(x)}</li>`).join("")}</ul>`;
    const kpi = (t, v, s) => `<div class="k"><span>${t}</span><b>${v}</b>${s ? `<em>${s}</em>` : ""}</div>`;
    const tabCat = (comp, nn) => { const s = topN(comp, nn), t = PB.soma(s, (x) => x.total); return `<table><tr><th>Categoria</th><th>Valor</th><th>% total</th><th>% fat.</th></tr>${s.map((x) => `<tr><td>${e(x.nome)}</td><td>${f.moeda(x.total)}</td><td>${f.pct(x.total / t)}</td><td>${f.pct(x.total / K.faturamento)}</td></tr>`).join("")}</table>`; };
    const logoAzul = img.logoAzul ? `<img class="marca" src="${img.logoAzul}" alt="Patagonia Business">` : "";
    const slide = (titulo, corpo, sub2 = C.periodo, rotulo = "Resultados") => `<section class="s"><span class="rot">${rotulo}</span>${logoAzul}<h1>${titulo}</h1>${sub2 ? `<h2>${e(sub2)}</h2>` : ""}<div class="c">${corpo}</div><footer>Patagonia Business · ${e(C.cliente.nome)} · ${C.periodo}</footer></section>`;
    const dreLinhas = C.dre.linhas.filter((l) => !l.nivel);
    const bm = C.cliente.benchmarks || {};
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Apresentação ${e(C.cliente.nome)} - ${C.periodo}</title>
<link href="https://fonts.googleapis.com/css2?family=Lora:wght@400;500;600&family=Poppins:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
@page { size: 13.333in 7.5in; margin: 0; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; } body { margin: 0; font-family: Poppins, "Segoe UI", Arial, sans-serif; color: #0e1b2b; background: #c9ced6; }
.s { width: 13.333in; height: 7.5in; background: #fff; position: relative; padding: .42in .55in .6in; page-break-after: always; overflow: hidden; margin: 0 auto 12px; }
.s .rot { font-size: 11px; letter-spacing: .28em; text-transform: uppercase; color: #0070bd; }
.s .marca { position: absolute; top: .34in; right: .55in; width: 1.2in; }
.s h1 { font-family: Lora, Georgia, serif; font-weight: 500; font-size: 32px; color: #0c2a4b; margin: 4px 0 0; } .s h2 { font-size: 14px; color: #5b6b7d; font-weight: 400; margin: 4px 0 18px; }
.s footer { position: absolute; bottom: .22in; left: .55in; right: .55in; padding-top: 8px; border-top: 1px solid #dfe4ea; font-size: 10px; color: #5b6b7d; }
.capa { background: #0c2a4b ${img.foto ? `url(${img.foto})` : ""} center / cover; color: #fff; padding: .6in .8in; }
.capa::before { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(6,26,48,.55), rgba(6,26,48,.25) 40%, rgba(6,26,48,.85)); }
.capa > * { position: relative; } .capa .logo { width: 1.9in; }
.capa .rot { display: block; margin-top: 2.2in; color: #5aaee8; letter-spacing: .3em; font-size: 13px; }
.capa h1 { font-family: Lora, Georgia, serif; font-weight: 500; font-size: 54px; color: #fff; margin: 10px 0 8px; } .capa p { color: #e9f3fb; font-size: 20px; font-weight: 300; margin: 0; }
.capa footer, .fim footer { border-color: rgba(255,255,255,.25); color: rgba(255,255,255,.8); left: .8in; right: .8in; }
.fim { background: #0070bd; color: #fff; padding: .7in .8in; } .fim .rot { color: #e9f3fb; }
.fim .c { font-family: Lora, Georgia, serif; color: #fff; font-size: 26px; line-height: 1.45; margin-top: 18px; max-width: 11in; }
.fim .logo { position: absolute; bottom: .65in; left: .8in; width: 1.7in; } .fim .frase { position: absolute; bottom: .75in; right: .8in; font-family: Lora, Georgia, serif; font-size: 20px; }
.c { font-size: 16px; line-height: 1.5; } ul { margin: 0; padding-left: 22px; } li { margin-bottom: 8px; }
.ks { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 14px; } .k { background: #fff; border: 1px solid #dfe4ea; border-top: 3px solid #0070bd; padding: 12px 14px; }
.k span { font-size: 12px; color: #5b6b7d; display: block; } .k b { font-family: Lora, Georgia, serif; font-weight: 600; font-size: 26px; color: #0c2a4b; display: block; } .k em { font-style: normal; font-weight: 600; color: #0070bd; font-size: 12px; }
.g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; } img { width: 100%; }
table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; } th { background: #0c2a4b; color: #fff; text-align: left; padding: 6px 8px; font-weight: 500; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; } td { padding: 5px 8px; border-bottom: 1px solid #e9ecf0; }
h3 { font-family: Lora, Georgia, serif; font-weight: 500; }
td + td, th + th { text-align: right; } tr.sub td, tr.grp td { font-weight: 700; background: #d9ebf8; } tr.total td, tr.res td { font-weight: 700; background: #0c2a4b; color: #fff; }
table.dre { font-size: 11.5px; } table.dre td { padding: 2px 8px; }
h3 { font-size: 18px; margin: 0 0 8px; } .red { color: #b4573a; } .grn { color: #5f7f5a; } .muted { color: #5b6b7d; font-size: 12px; }
@media print { body { background: #fff; } .s { margin: 0; } .dica { display: none; } }
.dica { position: fixed; top: 10px; right: 10px; background: #c2a878; color: #0e1b2b; padding: 10px 14px; border-radius: 8px; font-size: 14px; z-index: 9; }
</style></head><body>
<div class="dica">Use <b>Ctrl+P → Salvar como PDF</b> (paisagem, margens: nenhuma, gráficos de fundo ativados)</div>
<section class="s capa">${img.logoBranco ? `<img class="logo" src="${img.logoBranco}" alt="Patagonia Business">` : ""}<span class="rot">Apresentação de Resultados</span><h1>${e(C.cliente.nome)}</h1><p>Período: ${C.periodo}</p><footer>Patagonia Business · Consultoria e BPO Financeiro</footer></section>
${C.cliente.contexto ? slide("Sobre a empresa", `<p>${e(C.cliente.contexto)}</p>`, C.cliente.setor || "") : ""}
${slide("Resumo executivo", `<p>${e(conc.resumoExecutivo || "")}</p><h3 style="color:#0070bd">Destaques</h3>${ul(conc.destaques)}`)}
${slide("Principais indicadores — competência", `<div class="ks">${kpi("Faturamento (Receita Bruta)", f.moeda(K.faturamento))}${kpi("Margem de Contribuição", f.moeda(K.lucroBruto), f.pct(K.lucroBruto / K.faturamento) + " do faturamento")}${kpi("Resultado Operacional Líquido (EBITDA)", f.moeda(K.lucroOperacional), f.pct(K.lucroOperacional / K.faturamento) + " do faturamento")}${kpi("Resultado Líquido", f.moeda(K.lucroLiquido), f.pct(K.lucroLiquido / K.faturamento) + " do faturamento")}</div><img src="${gRes}">`)}
${slide("Demonstrativo de Resultado do Exercício (DRE) — resumo", `<table class="dre"><tr><th>Conta</th><th>Total do período</th><th>% Fat.</th><th>Média mensal</th><th>Último mês (${M.at(-1)})</th></tr>${dreLinhas.map((l) => { const t = tot(l.valores); return `<tr class="${l.estilo || ""}"><td>${e(l.nome)}</td><td>${f.moeda(t)}</td><td>${f.pct(t / K.faturamento)}</td><td>${f.moeda(t / C.meses.length)}</td><td>${f.moeda(l.valores.at(-1))}</td></tr>`; }).join("")}</table>`)}
${slide("Composição das despesas", `<div class="g2"><img src="${pizza(C.desp.porCategoria, 7)}">${tabCat(C.desp.porCategoria, 7)}</div>`)}
${slide("Composição dos custos e deduções", `<div class="g2"><img src="${pizza(C.cus.porCategoria, 6)}">${tabCat(C.cus.porCategoria, 6)}</div>`)}
${slide("Caixa — saldo e geração de caixa livre", `<div class="ks" style="grid-template-columns:repeat(3,1fr)">${kpi("Saldo de caixa (fim do período)", f.moeda(K.saldoCaixa))}${kpi(K.caixaLivre >= 0 ? "Geração de caixa livre" : "Queima de caixa livre", f.moeda(K.caixaLivre))}${kpi("Saldo previsto", f.moeda((C.fl.linhas.filter((l) => l.previsto).at(-1) || { saldoFinal: K.saldoCaixa }).saldoFinal))}</div><div class="g2"><img src="${gSaldo}"><img src="${gFcl}"></div>`)}
${slide("Comercial", `<div class="g2"><img src="${gCom}"><table><tr><th>Top 8 clientes</th><th>Faturamento</th><th>Part.</th></tr>${C.com.porCliente.slice(0, 8).map((c) => `<tr><td>${e(c.nome)}</td><td>${f.moeda(c.valor)}</td><td>${f.pct(c.valor / C.com.total)}</td></tr>`).join("")}</table></div>`, `${f.num(K.pedidos)} pedidos · ticket médio ${f.moeda(K.ticket)} · ${f.num(K.clientes)} clientes`)}
${bm.texto ? slide("Referências do setor", `<div style="white-space:pre-wrap;font-size:15px">${e(bm.texto.slice(0, 2200))}</div>${(bm.fontes || []).length ? `<p class="muted">Fontes: ${bm.fontes.slice(0, 6).map((x) => e(x.titulo || x.url)).join(" · ")}</p>` : ""}`, C.cliente.setor || "") : ""}
${slide("Pontos de atenção e recomendações", `<div class="g2"><div><h3 class="red">Pontos de atenção</h3>${ul(conc.pontosAtencao)}</div><div><h3 class="grn">Recomendações</h3>${ul(conc.recomendacoes)}</div></div>`, "")}
<section class="s fim"><span class="rot">Conclusão</span><div class="c">${e(conc.conclusao || "")}</div>${img.logoBranco ? `<img class="logo" src="${img.logoBranco}" alt="Patagonia Business">` : ""}<span class="frase">Vamos subir juntos?</span></section>
<script>window.onload = () => setTimeout(() => window.print(), 400);<\/script>
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) throw new Error("O navegador bloqueou a nova janela. Permita pop-ups para este site.");
    w.document.open(); w.document.write(html); w.document.close();
    return Promise.resolve("PDF");
  }
})();
