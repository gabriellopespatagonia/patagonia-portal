// Login por código enviado por e-mail (sem senha) e sessão em cookie assinado.
//
// - O código de 6 dígitos nunca é guardado: o servidor devolve um "desafio" assinado
//   (HMAC) que contém o e-mail, a validade e o hash do código. Para entrar, o navegador
//   devolve o desafio + o código digitado, e o servidor confere a assinatura.
// - A sessão é um cookie HttpOnly, Secure, SameSite=Lax, assinado e com validade.
// - A chave de assinatura vem de SESSION_SECRET ou, na falta dela, é derivada do
//   GRAPH_CLIENT_SECRET (trocar o segredo encerra todas as sessões).
const crypto = require("crypto");

const COOKIE = "pb_sessao";
const VALIDADE_CODIGO_MS = 10 * 60_000;
const VALIDADE_SESSAO_S = 12 * 60 * 60;
const MAX_TENTATIVAS = 5;

function chave() {
  const base = process.env.SESSION_SECRET || process.env.GRAPH_CLIENT_SECRET;
  if (!base) throw Object.assign(new Error("Chave de sessão não configurada no servidor"), { status: 500 });
  return crypto.createHash("sha256").update("patagonia-portal-sessao:" + base).digest();
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const deb64 = (s) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
const assinar = (texto) => crypto.createHmac("sha256", chave()).update(texto).digest("base64url");
function igual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function token(obj) { const p = b64(obj); return p + "." + assinar(p); }
function lerToken(t) {
  const [p, s] = String(t || "").split(".");
  if (!p || !s || !igual(s, assinar(p))) return null;
  try { return deb64(p); } catch { return null; }
}

/* ---------- Código por e-mail ---------- */
function novoCodigo(email) {
  const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const exp = Date.now() + VALIDADE_CODIGO_MS;
  const n = crypto.randomUUID();
  const h = assinar(`${email}|${codigo}|${exp}|${n}`);
  return { codigo, desafio: token({ e: email, exp, n, h }) };
}

// tentativas erradas por desafio (memória da instância; somado ao atraso, dificulta força bruta)
const tentativas = new Map();
function conferirCodigo(desafio, codigo) {
  const d = lerToken(desafio);
  if (!d || !d.e || !d.n) return { ok: false, motivo: "Código inválido. Peça um novo código." };
  if (Date.now() > d.exp) return { ok: false, motivo: "O código expirou. Peça um novo código." };
  const usadas = tentativas.get(d.n) || 0;
  if (usadas >= MAX_TENTATIVAS) return { ok: false, motivo: "Muitas tentativas. Peça um novo código." };
  const limpo = String(codigo || "").replace(/\D/g, "");
  if (!igual(d.h, assinar(`${d.e}|${limpo}|${d.exp}|${d.n}`))) {
    tentativas.set(d.n, usadas + 1);
    if (tentativas.size > 5000) tentativas.clear();
    return { ok: false, motivo: `Código incorreto. Restam ${MAX_TENTATIVAS - usadas - 1} tentativa(s).` };
  }
  tentativas.set(d.n, MAX_TENTATIVAS); // código de uso único
  return { ok: true, email: d.e };
}

/* ---------- Cookie de sessão ---------- */
function cookieSessao(email) {
  const t = token({ e: email, exp: Date.now() + VALIDADE_SESSAO_S * 1000 });
  return `${COOKIE}=${t}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${VALIDADE_SESSAO_S}`;
}
const cookieSair = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/** E-mail da sessão do cookie (ou null). */
function emailDaSessao(request) {
  const cab = request.headers.get("cookie") || "";
  const m = cab.split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!m) return null;
  const d = lerToken(m.slice(COOKIE.length + 1));
  if (!d || !d.e || Date.now() > d.exp) return null;
  return d.e;
}

module.exports = { novoCodigo, conferirCodigo, cookieSessao, cookieSair, emailDaSessao };
