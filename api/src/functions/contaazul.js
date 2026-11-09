// Integração com a API do Conta Azul (OAuth 2.0 — authorization code).
//   GET  /api/contaazul/conectar?cliente=ID   → redireciona para o login do Conta Azul
//   GET  /api/contaazul/callback              → recebe o código e guarda os tokens no SharePoint
//   GET  /api/contaazul/status?cliente=ID
//   POST /api/contaazul/sincronizar { clienteId, de: "AAAA-MM", ate: "AAAA-MM" } → lançamentos e vendas no modelo padrão
//   POST /api/contaazul/desconectar { clienteId }
//
// IMPORTANTE: confirme os endereços e nomes de campos no portal developers.contaazul.com
// ao criar o aplicativo. Todos podem ser ajustados pelas variáveis CONTAAZUL_* sem mudar o código.
const crypto = require("crypto");
const { app } = require("@azure/functions");
const sp = require("../lib/graph");
const { exigirConsultor, exigirAcessoCliente, httpErro, rota } = require("../lib/acesso");

const CFG = () => ({
  clientId: process.env.CONTAAZUL_CLIENT_ID,
  clientSecret: process.env.CONTAAZUL_CLIENT_SECRET,
  redirect: process.env.CONTAAZUL_REDIRECT_URI, // ex.: https://www.patagoniabusiness.com.br/api/contaazul/callback
  authUrl: process.env.CONTAAZUL_AUTH_URL || "https://auth.contaazul.com/login",
  tokenUrl: process.env.CONTAAZUL_TOKEN_URL || "https://auth.contaazul.com/oauth2/token",
  scope: process.env.CONTAAZUL_SCOPE || "openid profile aws.cognito.signin.user.admin",
  api: process.env.CONTAAZUL_API_URL || "https://api-v2.contaazul.com",
  pathReceber: process.env.CONTAAZUL_PATH_RECEBER || "/v1/financeiro/eventos-financeiros/contas-a-receber/buscar",
  pathPagar: process.env.CONTAAZUL_PATH_PAGAR || "/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar",
  pathVendas: process.env.CONTAAZUL_PATH_VENDAS || "/v1/venda/busca"
});
const arqTokens = (id) => `Clientes/${id}/config/contaazul.json`;
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

async function buscarPaginado(token, caminho, params, avisos) {
  const c = CFG(), itens = [], TAM = 100;
  for (let pagina = 1; pagina <= 50; pagina++) {
    const url = `${c.api}${caminho}?${new URLSearchParams({ ...params, pagina, tamanho_pagina: TAM })}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (r.status === 404) { avisos.push(`Endpoint não encontrado: ${caminho} — confira CONTAAZUL_PATH_* no servidor.`); break; }
    if (!r.ok) throw new Error(`Conta Azul ${caminho}: ${r.status} ${await r.text()}`);
    const j = await r.json();
    const lote = j.itens || j.items || j.data || j.content || (Array.isArray(j) ? j : []);
    itens.push(...lote);
    if (lote.length < TAM) break;
  }
  return itens;
}

/* ---------- Conversão para o modelo padrão ---------- */
const pick = (o, ...ks) => { for (const k of ks) { const v = k.split(".").reduce((x, p) => (x == null ? x : x[p]), o); if (v != null && v !== "") return v; } return null; };
const dia = (v) => (v ? String(v).slice(0, 10) : null);
const QUITADO = /receb|pag|quit|acquit|liquid|baix|settled|paid/i;

function paraLancamento(x, tipo, i) {
  const venc = dia(pick(x, "data_vencimento", "vencimento", "due_date"));
  const pgto = dia(pick(x, "data_pagamento", "data_quitacao", "ultima_baixa.data", "baixas.0.data_pagamento", "payment_date"));
  const comp = dia(pick(x, "data_competencia", "competencia", "evento.data_competencia")) || venc;
  const total = Number(pick(x, "total", "valor", "valor_total", "amount") || 0);
  const naoPago = pick(x, "nao_pago", "saldo", "valor_em_aberto");
  const status = String(pick(x, "status", "situacao") || "");
  const realizado = !!pgto || QUITADO.test(status) || (naoPago != null && Number(naoPago) === 0 && total > 0);
  const cat = pick(x, "categorias.0.nome", "categoria.nome", "categoria", "evento.categorias.0.nome") || "Sem categoria";
  return {
    _linha: i + 1, data: realizado ? pgto || venc : venc, competencia: comp ? comp.slice(0, 7) : null, tipo, categoria: cat,
    descricao: pick(x, "descricao", "evento.descricao", "description") || "", valor: Math.abs(total),
    status: realizado ? "Realizado" : "Previsto",
    conta: pick(x, "conta_financeira.nome", "conta.nome") || "", centroCusto: pick(x, "centros_de_custo.0.nome", "centro_custo.nome") || "",
    contraparte: pick(x, "cliente.nome", "fornecedor.nome", "contato.nome", "pessoa.nome") || ""
  };
}
function paraVenda(v, i) {
  return {
    _linha: i + 1, data: dia(pick(v, "data", "data_venda", "emissao", "created_at")), numero: String(pick(v, "numero", "id") || ""),
    cliente: pick(v, "cliente.nome", "cliente", "customer.name") || "(não informado)",
    item: pick(v, "itens.0.descricao", "itens.0.nome", "descricao") || "Venda", tipoItem: /serv/i.test(String(pick(v, "tipo", "itens.0.tipo") || "")) ? "Serviço" : "Produto",
    categoriaItem: pick(v, "categoria.nome") || "", quantidade: 1, valorUnitario: Number(pick(v, "total", "valor_total") || 0), desconto: Number(pick(v, "desconto", "discount.value") || 0),
    valorTotal: Number(pick(v, "total", "valor_total", "total_amount") || 0), vendedor: pick(v, "vendedor.nome") || "", regiao: pick(v, "cliente.cidade", "endereco.cidade") || ""
  };
}

/* ---------- Rotas ---------- */
app.http("contaazulConectar", {
  methods: ["GET"], authLevel: "anonymous", route: "contaazul/conectar",
  handler: async (req) => {
    try {
      await exigirConsultor(req);
      const id = req.query.get("cliente"); await exigirAcessoCliente(req, id);
      const c = CFG(); if (!c.clientId || !c.redirect) throw httpErro(501, "Integração Conta Azul não configurada no servidor");
      const url = `${c.authUrl}?${new URLSearchParams({ response_type: "code", client_id: c.clientId, redirect_uri: c.redirect, scope: c.scope, state: assinar({ clienteId: id, ts: Date.now(), n: crypto.randomUUID() }) })}`;
      return { status: 302, headers: { Location: url } };
    } catch (e) { return { status: e.status || 500, body: e.message }; }
  }
});

app.http("contaazulCallback", {
  methods: ["GET"], authLevel: "anonymous", route: "contaazul/callback",
  handler: async (req, context) => {
    let destino = "/consultor/index.html?contaazul=";
    try {
      await exigirConsultor(req);
      if (req.query.get("error")) throw httpErro(400, req.query.get("error"));
      const { clienteId } = verificar(req.query.get("state"));
      const tokens = await trocarToken({ grant_type: "authorization_code", code: req.query.get("code"), redirect_uri: CFG().redirect });
      await sp.gravarJson(arqTokens(clienteId), { ...tokens, conectadoEm: new Date().toISOString() });
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

app.http("contaazulSincronizar", {
  methods: ["POST"], authLevel: "anonymous", route: "contaazul/sincronizar",
  handler: rota(async (req) => {
    await exigirConsultor(req);
    const { clienteId, de, ate } = await req.json(); await exigirAcessoCliente(req, clienteId);
    if (!/^\d{4}-\d{2}$/.test(de) || !/^\d{4}-\d{2}$/.test(ate) || de > ate) throw httpErro(400, "Período inválido");
    const token = await tokenValido(clienteId), c = CFG(), avisos = [];
    const [y, m] = ate.split("-").map(Number);
    const ini = `${de}-01`, fim = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    // vencimentos com folga de 2 meses para capturar pagamentos de competências do período
    const fimFolga = new Date(Date.UTC(y, m + 2, 0)).toISOString().slice(0, 10);
    const filtro = { data_vencimento_de: ini, data_vencimento_ate: fimFolga };
    const [rec, pag, vend] = await Promise.all([
      buscarPaginado(token, c.pathReceber, filtro, avisos),
      buscarPaginado(token, c.pathPagar, filtro, avisos),
      buscarPaginado(token, c.pathVendas, { data_inicio: ini, data_fim: fim }, avisos).catch((e) => { avisos.push("Vendas: " + e.message); return []; })
    ]);
    const noPeriodo = (l) => l.competencia && l.competencia >= de && l.competencia <= ate;
    const lancamentos = [...rec.map((x, i) => paraLancamento(x, "Receita", i)), ...pag.map((x, i) => paraLancamento(x, "Despesa", i + rec.length))].filter(noPeriodo);
    const vendas = vend.map(paraVenda).filter((v) => v.data && v.data.slice(0, 7) >= de && v.data.slice(0, 7) <= ate);
    avisos.push(`Conta Azul: ${rec.length} contas a receber, ${pag.length} contas a pagar e ${vend.length} vendas lidas.`);
    if (vendas.length) avisos.push("As vendas vindas da API trazem o total por venda; para o detalhe por produto/serviço, importe também o Relatório de vendas exportado do Conta Azul.");
    return { parcial: { lancamentos, ...(vendas.length ? { vendas } : {}) }, avisos };
  })
});
