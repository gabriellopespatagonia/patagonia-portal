// Integração com a API do Conta Azul (OAuth 2.0 — authorization code).
//   GET  /api/contaazul/conectar?cliente=ID   → redireciona para o login do Conta Azul
//   GET  /api/contaazul/callback              → recebe o código e guarda os tokens no SharePoint
//   GET  /api/contaazul/status?cliente=ID
//   POST /api/contaazul/sincronizar           → em duas etapas (o navegador conduz, respeitando o tempo-limite das funções):
//        { clienteId, de, ate, etapa: "lista" }      → parcelas de contas a receber/pagar (competência no período
//                                                       OU pagamento desde o início do período), contas financeiras,
//                                                       transferências e vendas
//        { clienteId, etapa: "detalhes", parcelas: [ids], vendas: [ids] }
//                                                    → baixas (data de caixa, conta, juros/multa/desconto/taxa),
//                                                       rateio por categoria e centro de custo, itens das vendas.
//                                                       Cada chamada usa no máximo ~25 s; o que faltar volta em
//                                                       pendentes*, e "esperar" indica o limite de chamadas atingido.
//        { clienteId, etapa: "cache", parcelas: [{id, alt, d}], vendas: [{id, alt, itens}] }
//                                                    → memória dos detalhes no SharePoint (só o que mudou é consultado de novo)
//   POST /api/contaazul/desconectar { clienteId }
//
// Endereços e campos conferidos na especificação OpenAPI oficial (developers.contaazul.com, nov/2026):
// financial-apis-openapi.yaml e sales-apis-openapi.yaml. Podem ser ajustados pelas variáveis CONTAAZUL_*.
const crypto = require("crypto");
const { app } = require("@azure/functions");
const sp = require("../lib/graph");
const { exigirConsultor, exigirAcessoCliente, httpErro, rota } = require("../lib/acesso");

const CFG = () => ({
  clientId: process.env.CONTAAZUL_CLIENT_ID,
  clientSecret: process.env.CONTAAZUL_CLIENT_SECRET,
  redirect: process.env.CONTAAZUL_REDIRECT_URI, // ex.: https://www.patagoniabusiness.com.br/api/contaazul/callback
  // a tela de login usa rota com "#"
  authUrl: process.env.CONTAAZUL_AUTH_URL || "https://login.contaazul.com/#/oauth/authorize",
  tokenUrl: process.env.CONTAAZUL_TOKEN_URL || "https://api-v2.contaazul.com/oauth/token",
  scope: process.env.CONTAAZUL_SCOPE || "openid profile aws.cognito.signin.user.admin",
  api: process.env.CONTAAZUL_API_URL || "https://api-v2.contaazul.com"
});
const P = {
  receber: "/v1/financeiro/eventos-financeiros/contas-a-receber/buscar",
  pagar: "/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar",
  parcela: (id) => `/v1/financeiro/eventos-financeiros/parcelas/${encodeURIComponent(id)}`,
  contas: "/v1/conta-financeira",
  saldoAtual: (id) => `/v1/conta-financeira/${encodeURIComponent(id)}/saldo-atual`,
  transferencias: "/v1/financeiro/transferencias",
  vendas: "/v1/venda/busca",
  itensVenda: (id) => `/v1/venda/${encodeURIComponent(id)}/itens`
};
const arqTokens = (id) => `Clientes/${id}/config/contaazul.json`;
const arqCache = (id) => `Clientes/${id}/config/contaazul-detalhes.json`;
const segredoState = () => process.env.CONTAAZUL_STATE_SECRET || process.env.CONTAAZUL_CLIENT_SECRET || "";

function assinar(obj) {
  const p = Buffer.from(JSON.stringify(obj)).toString("base64url");
  return p + "." + crypto.createHmac("sha256", segredoState()).update(p).digest("base64url");
}
function verificar(state) {
  const [p, sig] = String(state || "").split(".");
  const esperado = crypto.createHmac("sha256", segredoState()).update(p || "").digest("base64url");
  if (!sig || sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) throw httpErro(400, "state inválido");
  const obj = JSON.parse(Buffer.from(p, "base64url").toString());
  if (Date.now() - obj.ts > 15 * 60_000) throw httpErro(400, "Autorização expirada, tente novamente");
  return obj;
}

async function trocarToken(params) {
  const c = CFG();
  const r = await fetch(c.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64") },
    body: new URLSearchParams(params)
  });
  if (!r.ok) throw new Error(`Conta Azul recusou o token: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return { access_token: j.access_token, refresh_token: j.refresh_token || params.refresh_token, expira: Date.now() + (j.expires_in || 3600) * 1000 };
}

async function tokenValido(clienteId) {
  const t = await sp.lerJson(arqTokens(clienteId));
  if (!t || !t.refresh_token) throw httpErro(409, "Cliente não conectado ao Conta Azul");
  if (t.access_token && Date.now() < t.expira - 60_000) return t.access_token;
  const novo = await trocarToken({ grant_type: "refresh_token", refresh_token: t.refresh_token });
  await sp.gravarJson(arqTokens(clienteId), { ...t, ...novo });
  return novo.access_token;
}

/* ---------- Chamadas à API (limite: 10 por segundo e 600 por minuto por conta conectada) ---------- */
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
function query(params) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v == null || v === "") return; (Array.isArray(v) ? v : [v]).forEach((x) => q.append(k, x)); });
  return q.toString();
}
async function chamar(token, caminho, params = {}) {
  const url = `${CFG().api}${caminho}${Object.keys(params).length ? "?" + query(params) : ""}`;
  for (let tentativa = 0; ; tentativa++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (r.status === 429) {
      const ra = Number(r.headers.get("retry-after")) || 2 * (tentativa + 1);
      // espera curta aqui; espera longa fica com o navegador (a função tem tempo-limite de 45 s)
      if (ra <= 3 && tentativa < 2) { await espera(ra * 1000); continue; }
      const e = new Error("Limite de chamadas do Conta Azul atingido"); e.status = 429; e.esperar = Math.max(ra, 10); throw e;
    }
    if (!r.ok) { const e = new Error(`Conta Azul ${caminho}: ${r.status} ${(await r.text()).slice(0, 300)}`); e.status = r.status; throw e; }
    return r.status === 204 ? null : r.json();
  }
}
async function paginar(token, caminho, params, tam = 500) {
  const itens = [];
  for (let pagina = 1; pagina <= 200; pagina++) {
    const j = await chamar(token, caminho, { ...params, pagina, tamanho_pagina: tam });
    const lote = (j && (j.itens || j.items)) || (Array.isArray(j) ? j : []);
    itens.push(...lote);
    const total = j && (j.itens_totais ?? j.total_itens);
    if (lote.length < tam || (total != null && itens.length >= total)) break;
  }
  return itens;
}
/** Executa tarefas com no máximo `n` em paralelo, espaçadas para não estourar o limite por segundo.
 *  `parar()` permite interromper (tempo-limite ou limite de chamadas): itens não iniciados ficam `undefined`. */
async function emLotes(itens, n, fn, parar = () => false, pausa = 120) {
  const out = new Array(itens.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => {
    while (i < itens.length && !parar()) { const k = i++; out[k] = await fn(itens[k]); await espera(pausa); }
  }));
  return out;
}

/* ---------- Datas ---------- */
const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const ultimoDia = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const somaAnos = (iso, n) => `${Number(iso.slice(0, 4)) + n}${iso.slice(4)}`;

/* ---------- Conversões (somente os campos usados no portal) ---------- */
const num = (v) => Number(v) || 0;
const resumoParcela = (x, tipo) => ({
  id: x.id, tipo, descricao: x.descricao || "", vencimento: x.data_vencimento || null, competencia: x.data_competencia || null,
  status: x.status_traduzido || x.status || "", total: num(x.total), pago: num(x.pago), naoPago: num(x.nao_pago),
  categorias: (x.categorias || []).map((c) => c.nome).filter(Boolean),
  centros: (x.centros_custo || []).map((c) => c.nome).filter(Boolean),
  contraparte: (x.cliente || x.fornecedor || {}).nome || "",
  alteracao: x.data_alteracao || x.data_criacao || ""
});
const detalheParcela = (d) => ({
  id: d.id, status: d.status || "", competencia: (d.evento && d.evento.data_competencia) || null,
  conta: (d.conta_financeira && d.conta_financeira.nome) || "",
  rateio: ((d.evento && d.evento.rateio) || []).map((r) => ({
    categoria: r.nome_categoria || "", valor: num(r.valor ?? r.valor_bruto),
    centros: (r.rateio_centro_custo || []).map((c) => ({ nome: c.nome_centro_custo || "", valor: num(c.valor ?? c.valor_bruto) }))
  })),
  baixas: (d.baixas || []).map((b) => {
    const v = b.valor_composicao || {};
    return { data: b.data_pagamento, bruto: num(v.valor_bruto), juros: num(v.juros), multa: num(v.multa), desconto: num(v.desconto), taxa: num(v.taxa), liquido: num(v.valor_liquido), conta: (b.conta_financeira && b.conta_financeira.nome) || "" };
  })
});

/* ---------- Rotas ---------- */
app.http("contaazulConectar", {
  methods: ["GET"], authLevel: "anonymous", route: "contaazul/conectar",
  handler: async (req) => {
    try {
      const quem = await exigirConsultor(req);
      const id = req.query.get("cliente"); await exigirAcessoCliente(req, id);
      const c = CFG(); if (!c.clientId || !c.redirect) throw httpErro(501, "Integração Conta Azul não configurada no servidor");
      // O state assinado identifica cliente e consultor: o retorno não depende do cookie de sessão
      // (o login pode ter sido feito em outro endereço do site, ex.: azurestaticapps.net).
      const state = assinar({ clienteId: id, por: quem.email, ts: Date.now(), n: crypto.randomUUID() });
      const url = `${c.authUrl}?${new URLSearchParams({ response_type: "code", client_id: c.clientId, redirect_uri: c.redirect, scope: c.scope, state })}`;
      return { status: 302, headers: { Location: url } };
    } catch (e) { return { status: e.status || 500, body: e.message }; }
  }
});

app.http("contaazulCallback", {
  methods: ["GET"], authLevel: "anonymous", route: "contaazul/callback",
  handler: async (req, context) => {
    let destino = "/consultor/index.html?contaazul=";
    try {
      if (req.query.get("error")) throw httpErro(400, req.query.get("error"));
      const { clienteId, por } = verificar(req.query.get("state"));
      if (!req.query.get("code")) throw httpErro(400, "O Conta Azul não enviou o código de autorização");
      const tokens = await trocarToken({ grant_type: "authorization_code", code: req.query.get("code"), redirect_uri: CFG().redirect });
      await sp.gravarJson(arqTokens(clienteId), { ...tokens, conectadoEm: new Date().toISOString(), conectadoPor: por || null });
      destino += "ok#importar";
    } catch (e) { context.error(e); destino += encodeURIComponent(e.message.slice(0, 120)) + "#importar"; }
    return { status: 302, headers: { Location: destino } };
  }
});

app.http("contaazulStatus", {
  methods: ["GET"], authLevel: "anonymous", route: "contaazul/status",
  handler: rota(async (req) => {
    await exigirConsultor(req);
    const id = req.query.get("cliente"); await exigirAcessoCliente(req, id);
    const t = await sp.lerJson(arqTokens(id));
    return t && t.refresh_token ? { conectado: true, empresa: "Conta Azul", em: t.conectadoEm } : { conectado: false };
  })
});

app.http("contaazulDesconectar", {
  methods: ["POST"], authLevel: "anonymous", route: "contaazul/desconectar",
  handler: rota(async (req) => {
    await exigirConsultor(req);
    const { clienteId } = await req.json(); await exigirAcessoCliente(req, clienteId);
    await sp.gravarJson(arqTokens(clienteId), { desconectadoEm: new Date().toISOString() });
    return { ok: true };
  })
});

async function etapaLista(token, clienteId, de, ate) {
  const avisos = [];
  const ini = `${de}-01`, fim = ultimoDia(ate), hoje = hojeBR();
  // A busca exige uma janela de vencimento: usamos uma janela ampla e filtramos por competência e por pagamento.
  let vde = somaAnos(ini, -3), vate = somaAnos(fim > hoje ? fim : hoje, 3);
  const buscar = async (caminho, filtro) => {
    try { return await paginar(token, caminho, { data_vencimento_de: vde, data_vencimento_ate: vate, ...filtro }); }
    catch (e) {
      if (e.status !== 400) throw e;
      vde = somaAnos(ini, -1); vate = somaAnos(fim > hoje ? fim : hoje, 1);
      avisos.push("O Conta Azul limitou a janela de vencimento a 1 ano antes e depois do período.");
      return paginar(token, caminho, { data_vencimento_de: vde, data_vencimento_ate: vate, ...filtro });
    }
  };
  const porComp = { data_competencia_de: ini, data_competencia_ate: fim };
  const porPgto = { data_pagamento_de: ini, data_pagamento_ate: hoje };
  const recC = await buscar(P.receber, porComp), recP = await buscar(P.receber, porPgto);
  const pagC = await buscar(P.pagar, porComp), pagP = await buscar(P.pagar, porPgto);
  const mapa = new Map();
  recC.concat(recP).forEach((x) => mapa.set(x.id, resumoParcela(x, "Receita")));
  pagC.concat(pagP).forEach((x) => mapa.set(x.id, resumoParcela(x, "Despesa")));

  // contas financeiras e saldo atual (para reconstruir o saldo no início do período)
  let contas = [];
  try {
    const lista = await paginar(token, P.contas, {}, 100);
    contas = await emLotes(lista, 4, async (c) => {
      let saldo = c.saldo_atual;
      if (saldo == null) { try { const s = await chamar(token, P.saldoAtual(c.id)); saldo = s && (s.saldo_atual ?? s.saldo); } catch { saldo = null; } }
      return { id: c.id, nome: c.nome || "", banco: c.banco || "", tipo: c.tipo || "", ativo: c.ativo !== false, saldoAtual: saldo == null ? null : num(saldo) };
    });
  } catch (e) { avisos.push("Contas financeiras: " + e.message); }

  let transferencias = [];
  try {
    transferencias = (await paginar(token, P.transferencias, { data_inicio: ini, data_fim: hoje }, 100)).map((t) => ({
      data: (t.origem && t.origem.data) || t.data, valor: num(t.valor),
      origem: (t.origem && t.origem.conta_financeira && t.origem.conta_financeira.nome) || "",
      destino: (t.destino && t.destino.conta_financeira && t.destino.conta_financeira.nome) || ""
    }));
  } catch (e) { avisos.push("Transferências: " + e.message); }

  let vendas = [];
  try {
    vendas = (await paginar(token, P.vendas, { data_inicio: ini, data_fim: fim }, 100)).map((v) => ({
      id: v.id, data: v.data, numero: String(v.numero ?? ""), total: num(v.total), tipo: v.tipo || v.itens || "",
      situacao: (v.situacao && v.situacao.nome) || "", cliente: (v.cliente && v.cliente.nome) || "", cidade: (v.cliente && (v.cliente.cidade || v.cliente.estado)) || "",
      alteracao: v.data_alteracao || v.criado_em || ""
    }));
  } catch (e) { avisos.push("Vendas: " + e.message); }

  // memória de detalhes já consultados: só o que mudou no Conta Azul (data de alteração) precisa ser consultado de novo
  const cache = { parcelas: [], vendas: [] };
  try {
    const mem = (await sp.lerJson(arqCache(clienteId))) || {};
    mapa.forEach((p) => { const c = mem.parcelas && mem.parcelas[p.id]; if (c && c.alt && c.alt === p.alteracao) cache.parcelas.push(c.d); });
    vendas.forEach((v) => { const c = mem.vendas && mem.vendas[v.id]; if (c && c.alt && c.alt === v.alteracao) cache.vendas.push({ id: v.id, itens: c.itens }); });
  } catch { /* sem memória: consulta tudo */ }

  const qtd = (t) => [...mapa.values()].filter((p) => p.tipo === t).length;
  avisos.unshift(`Conta Azul: ${qtd("Receita")} parcelas a receber e ${qtd("Despesa")} a pagar encontradas (competência no período ou pagamento desde ${ini.split("-").reverse().join("/")}), ${contas.length} contas financeiras, ${transferencias.length} transferências e ${vendas.length} vendas.`);
  if (cache.parcelas.length || cache.vendas.length) avisos.push(`${cache.parcelas.length} parcela(s) e ${cache.vendas.length} venda(s) sem alteração desde a última busca: detalhes reaproveitados.`);
  return { periodo: { de, ate, ini, fim, hoje }, parcelas: [...mapa.values()], contas, transferencias, vendas, cache, avisos };
}

/** Detalha parcelas e itens de vendas dentro de um orçamento de tempo (~25 s); o que não couber volta como pendente. */
async function etapaDetalhes(token, idsParcelas, idsVendas) {
  const inicio = Date.now(), ORCAMENTO = 25_000, falhas = [];
  let esperar = 0;
  const parar = () => esperar > 0 || Date.now() - inicio > ORCAMENTO;
  const tentar = async (rotulo, fn) => {
    try { return await fn(); }
    catch (e) { if (e.status === 429) { esperar = Math.max(esperar, e.esperar || 30); return undefined; } falhas.push(`${rotulo}: ${e.message}`); return null; }
  };
  const rp = await emLotes(idsParcelas, 4, (id) => tentar(`parcela ${id}`, async () => detalheParcela(await chamar(token, P.parcela(id)))), parar, 250);
  const rv = await emLotes(idsVendas, 4, (id) => tentar(`venda ${id}`, async () => {
    const itens = await paginar(token, P.itensVenda(id), {}, 100);
    return { id, itens: itens.map((i) => ({ nome: i.nome || i.descricao || "Item", tipo: i.tipo || "", quantidade: num(i.quantidade) || 1, valor: num(i.valor) })) };
  }), parar, 250);
  // undefined = não processado (tempo ou limite) → pendente; null = falhou de vez
  return {
    parcelas: rp.filter(Boolean), vendas: rv.filter(Boolean),
    pendentesParcelas: idsParcelas.filter((_, k) => rp[k] === undefined),
    pendentesVendas: idsVendas.filter((_, k) => rv[k] === undefined),
    esperar, falhas: falhas.slice(0, 20), totalFalhas: falhas.length
  };
}

/** Grava na memória do cliente os detalhes consultados (chave: id + data de alteração no Conta Azul). */
async function etapaCache(clienteId, parcelas, vendas) {
  const mem = (await sp.lerJson(arqCache(clienteId))) || { parcelas: {}, vendas: {} };
  mem.parcelas = mem.parcelas || {}; mem.vendas = mem.vendas || {};
  (parcelas || []).forEach((x) => { if (x && x.id && x.alt && x.d) mem.parcelas[x.id] = { alt: x.alt, d: x.d }; });
  (vendas || []).forEach((x) => { if (x && x.id && x.alt && x.itens) mem.vendas[x.id] = { alt: x.alt, itens: x.itens }; });
  mem.atualizadoEm = new Date().toISOString();
  await sp.gravarJson(arqCache(clienteId), mem);
  return { ok: true, parcelas: Object.keys(mem.parcelas).length, vendas: Object.keys(mem.vendas).length };
}

app.http("contaazulSincronizar", {
  methods: ["POST"], authLevel: "anonymous", route: "contaazul/sincronizar",
  handler: rota(async (req) => {
    await exigirConsultor(req);
    const corpo = await req.json();
    const { clienteId, etapa } = corpo; await exigirAcessoCliente(req, clienteId);
    if (etapa === "cache") return etapaCache(clienteId, corpo.parcelas, corpo.vendas);
    const token = await tokenValido(clienteId);
    if (etapa === "detalhes") {
      const ids = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === "string").slice(0, 80) : []);
      return etapaDetalhes(token, ids(corpo.parcelas), ids(corpo.vendas));
    }
    const { de, ate } = corpo;
    if (!/^\d{4}-\d{2}$/.test(de) || !/^\d{4}-\d{2}$/.test(ate) || de > ate) throw httpErro(400, "Período inválido");
    return etapaLista(token, clienteId, de, ate);
  })
});
