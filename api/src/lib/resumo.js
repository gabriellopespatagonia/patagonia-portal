// Resumo compacto da base padronizada para enviar ao Claude como contexto.
// Usa a mesma estrutura padrão da DRE e do DFC do site (estrutura.js — cópia de assets/js/estrutura.js).
const E = require("./estrutura");

function indicePlano(plano) {
  const m = new Map();
  (plano || []).filter((c) => c.tipo !== "Sintética").forEach((c) => { m.set(E.norm(c.nome), c); if (c.numero) m.set(E.norm(c.numero), c); });
  return m;
}

/** Calcula DRE ou DFC na estrutura padrão para os meses informados. */
function estrutura(d, meses, tipo) {
  const idx = indicePlano(d.planoContas), ref = tipo === "DRE" ? "refDRE" : "refDFC", NAO = tipo === "DRE" ? E.NAO_DRE : E.NAO_DFC;
  const folhas = {}, contas = {};
  d.lancamentos.forEach((l) => {
    if (l.status !== "Realizado") return;
    const m = tipo === "DRE" ? l.competencia : l.data.slice(0, 7);
    const i = meses.indexOf(m); if (i < 0) return;
    const c = idx.get(E.norm(l.categoria));
    let linha = c && c[ref];
    if (linha === NAO) return;
    if (!linha) linha = tipo === "DRE" ? (l.tipo === "Receita" ? "Receita Bruta" : "Despesas Administrativas") : (l.tipo === "Receita" ? "Outras Entradas" : "Despesas Administrativas");
    const v = l.tipo === "Receita" ? l.valor : -l.valor;
    (folhas[linha] ||= meses.map(() => 0))[i] += v;
    const k = c ? `${c.numero} ${c.nome}` : `${l.categoria} (sem plano de contas)`;
    ((contas[linha] ||= {})[k] ||= meses.map(() => 0))[i] += v;
  });
  const r = E.calcular(tipo, folhas, null, meses.length);
  const linhas = r.linhas.filter((x) => x.valores.some((v) => Math.round(v) !== 0) || x.tipo === "resultado")
    .map((x) => ({ linha: x.nome, valores: Object.fromEntries(meses.map((m, i) => [m, Math.round(x.valores[i])])) }));
  const contasAnaliticas = Object.fromEntries(Object.entries(contas).map(([linha, o]) => [linha,
    Object.fromEntries(Object.entries(o).map(([k, arr]) => [k, Math.round(arr.reduce((a, b) => a + b, 0))]))]));
  return { linhas, contasAnaliticas_totalDoPeriodo: contasAnaliticas };
}

function resumir(d, mesesFiltro) {
  const todos = [...new Set(d.lancamentos.filter((l) => l.status === "Realizado").map((l) => l.competencia))].sort();
  const meses = mesesFiltro && mesesFiltro.length ? todos.filter((m) => mesesFiltro.includes(m)) : todos.slice(-12);
  const vendasMes = {}, clientes = {}, itens = {};
  d.vendas.forEach((v) => {
    const m = v.data.slice(0, 7); if (!meses.includes(m)) return;
    (vendasMes[m] ||= { faturamento: 0, pedidos: new Set(), clientes: new Set() });
    vendasMes[m].faturamento += v.valorTotal; vendasMes[m].pedidos.add(v.numero || v.data + v.cliente); vendasMes[m].clientes.add(v.cliente);
    clientes[v.cliente] = (clientes[v.cliente] || 0) + v.valorTotal; itens[v.item] = (itens[v.item] || 0) + v.valorTotal;
  });
  const top = (o, n = 15) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([nome, v]) => ({ nome, valor: Math.round(v) }));
  const previstos = d.lancamentos.filter((l) => l.status === "Previsto").reduce((o, l) => {
    const m = l.data.slice(0, 7); (o[m] ||= { entradas: 0, saidas: 0 }); o[m][l.tipo === "Receita" ? "entradas" : "saidas"] += Math.round(l.valor); return o;
  }, {});
  return {
    empresa: d.cliente, atualizadoEm: d.atualizadoEm, meses,
    fechamentos: Object.fromEntries(meses.map((m) => [m, ((d.fechamentos || {})[m] || {}).status || "Aberto"])),
    dre_estrutura_padrao: estrutura(d, meses, "DRE"),
    dfc_estrutura_padrao: estrutura(d, meses, "DFC"),
    comercial_mensal: Object.fromEntries(Object.entries(vendasMes).sort().map(([m, x]) => [m, { faturamento: Math.round(x.faturamento), pedidos: x.pedidos.size, clientes_ativos: x.clientes.size }])),
    top_clientes: top(clientes), top_produtos_servicos: top(itens),
    saldos_iniciais: d.contas, fluxo_previsto: previstos, projecoes: d.projecoes
  };
}

/** Texto com contexto do cliente (cadastro + benchmarks salvos). */
function contextoCliente(c) {
  if (!c) return "";
  const partes = [];
  if (c.setor) partes.push(`Setor: ${c.setor}`);
  if (c.contexto) partes.push(`Contexto da empresa (escrito pelo consultor): ${c.contexto}`);
  if (c.benchmarks && c.benchmarks.texto) partes.push(`Benchmarks e conceitos do setor (pesquisados e revisados pelo consultor):\n${c.benchmarks.texto}`);
  return partes.join("\n\n");
}

/** Descrição textual das estruturas padrão (para os prompts). */
const descreverEstrutura = (tipo) => E[tipo].map((n) => `${n.tipo === "linha" ? "    " : n.tipo === "subgrupo" ? "  " : ""}(${n.sinal}) ${n.nome}`).join("\n");

module.exports = { resumir, contextoCliente, descreverEstrutura };
