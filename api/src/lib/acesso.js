// Identifica o usuário logado (Azure Static Web Apps) e aplica as regras de acesso.
// O cadastro de usuários fica no SharePoint em  <Portal>/config/usuarios.json :
// {
//   "ana@alfa.com.br":            { "nome": "Ana Souza", "papel": "cliente",   "clienteId": "alfa-distribuidora" },
//   "gabriel.lopes@patagoniaconsultoria.com.br": { "nome": "Gabriel", "papel": "consultor" }
// }
const { lerJson } = require("./graph");

let cache = { usuarios: null, em: 0 };

function principal(request) {
  const h = request.headers.get("x-ms-client-principal");
  if (!h) return null;
  try { return JSON.parse(Buffer.from(h, "base64").toString("utf8")); } catch { return null; }
}

async function usuarios() {
  if (!cache.usuarios || Date.now() - cache.em > 5 * 60_000) {
    cache = { usuarios: (await lerJson("config/usuarios.json")) || {}, em: Date.now() };
  }
  return cache.usuarios;
}

/** Retorna { email, nome, papel, clienteId } ou lança erro 401/403. */
async function perfil(request) {
  const p = principal(request);
  if (!p) throw httpErro(401, "Não autenticado");
  const email = String(p.userDetails || "").toLowerCase();
  const lista = await usuarios();
  const chave = Object.keys(lista).find((k) => k.toLowerCase() === email);
  if (!chave) throw httpErro(403, "Usuário não cadastrado no portal");
  return { email, ...lista[chave] };
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

module.exports = { perfil, exigirConsultor, exigirAcessoCliente, httpErro, rota, invalidarCache: () => (cache.usuarios = null) };
