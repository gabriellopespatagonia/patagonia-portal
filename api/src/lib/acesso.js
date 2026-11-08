// Identifica o usuário logado (Azure Static Web Apps) e aplica as regras de acesso.
// O cadastro de usuários fica no SharePoint em  <Portal>/config/usuarios.json :
// {
//   "ana@alfa.com.br":            { "nome": "Ana Souza", "papel": "cliente",   "clienteId": "alfa-distribuidora" },
//   "gabriel.lopes@patagoniaconsultoria.com.br": { "nome": "Gabriel", "papel": "consultor" }
// }
//
// O usuário pode estar logado de duas formas:
//   1. conta Microsoft (login do Azure Static Web Apps — cabeçalho x-ms-client-principal);
//   2. código por e-mail (cookie de sessão assinado — ver lib/sessao.js).
const { lerJson } = require("./graph");
const { emailDaSessao } = require("./sessao");

let cache = { usuarios: null, em: 0 };

/** E-mail do usuário logado (Microsoft ou código por e-mail), ou null. */
function emailLogado(request) {
  const h = request.headers.get("x-ms-client-principal");
  if (h) {
    try { const p = JSON.parse(Buffer.from(h, "base64").toString("utf8")); if (p && p.userDetails) return String(p.userDetails).toLowerCase(); } catch { }
  }
  const e = emailDaSessao(request);
  return e ? e.toLowerCase() : null;
}

/** Cadastro do e-mail em usuarios.json (ou null). */
async function usuarioCadastrado(email) {
  const lista = await usuarios();
  const chave = Object.keys(lista).find((k) => k.toLowerCase() === String(email).toLowerCase());
  return chave ? { email: chave.toLowerCase(), ...lista[chave] } : null;
}

async function usuarios() {
  if (!cache.usuarios || Date.now() - cache.em > 5 * 60_000) {
    cache = { usuarios: (await lerJson("config/usuarios.json")) || {}, em: Date.now() };
  }
  return cache.usuarios;
}

/** Retorna { email, nome, papel, clienteId } ou lança erro 401/403. */
async function perfil(request) {
  const email = emailLogado(request);
  if (!email) throw httpErro(401, "Não autenticado");
  const u = await usuarioCadastrado(email);
  if (!u) throw httpErro(403, "Usuário não cadastrado no portal");
  return { ...u, email };
}

async function exigirConsultor(request) {
  const u = await perfil(request);
  if (u.papel !== "consultor") throw httpErro(403, "Acesso restrito aos consultores");
  return u;
}

/** Garante que o usuário pode ver os dados do cliente informado. */
async function exigirAcessoCliente(request, clienteId) {
  const u = await perfil(request);
  if (!/^[a-z0-9-]{1,60}$/.test(clienteId || "")) throw httpErro(400, "Cliente inválido");
  if (u.papel !== "consultor" && u.clienteId !== clienteId) throw httpErro(403, "Sem permissão para este cliente");
  return u;
}

function httpErro(status, msg) { const e = new Error(msg); e.status = status; return e; }

/** Envolve um handler tratando erros de forma padronizada. */
const rota = (fn) => async (request, context) => {
  try {
    const corpo = await fn(request, context);
    return { status: 200, jsonBody: corpo };
  } catch (e) {
    if (!e.status) context.error(e);
    return { status: e.status || 500, body: e.status ? e.message : "Erro interno" };
  }
};

module.exports = { perfil, usuarioCadastrado, exigirConsultor, exigirAcessoCliente, httpErro, rota, invalidarCache: () => (cache.usuarios = null) };
