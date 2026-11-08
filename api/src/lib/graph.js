// Acesso ao SharePoint via Microsoft Graph (permissão de aplicativo, client credentials).
// Toda a leitura/gravação passa pela API: o navegador nunca recebe tokens do SharePoint.

const GRAPH = "https://graph.microsoft.com/v1.0";
let tokenCache = { valor: null, expira: 0 };
let siteIdCache = null;

async function token() {
  if (tokenCache.valor && Date.now() < tokenCache.expira - 60_000) return tokenCache.valor;
  const { GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET } = process.env;
  const r = await fetch(`https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GRAPH_CLIENT_ID,
      client_secret: GRAPH_CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials"
    })
  });
  if (!r.ok) throw new Error(`Falha ao autenticar no Microsoft Graph: ${r.status} ${await r.text()}`);
  const j = await r.json();
  tokenCache = { valor: j.access_token, expira: Date.now() + j.expires_in * 1000 };
  return tokenCache.valor;
}

async function graph(caminho, opcoes = {}) {
  const r = await fetch(caminho.startsWith("http") ? caminho : GRAPH + caminho, {
    ...opcoes,
    headers: { Authorization: `Bearer ${await token()}`, ...(opcoes.headers || {}) }
  });
  return r;
}

async function siteId() {
  if (siteIdCache) return siteIdCache;
  const r = await graph(`/sites/${process.env.SHAREPOINT_HOST}:${process.env.SHAREPOINT_SITE_PATH}`);
  if (!r.ok) throw new Error(`Site do SharePoint não encontrado: ${r.status}`);
  siteIdCache = (await r.json()).id;
  return siteIdCache;
}

const raiz = () => process.env.SHAREPOINT_PASTA_RAIZ || "Portal";
const enc = (p) => p.split("/").map(encodeURIComponent).join("/");
const urlItem = async (caminho) => `/sites/${await siteId()}/drive/root:/${enc(raiz() + "/" + caminho)}`;

/** Lê um arquivo JSON. Retorna null se não existir. */
async function lerJson(caminho) {
  const r = await graph(`${await urlItem(caminho)}:/content`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Erro ao ler ${caminho}: ${r.status}`);
  return JSON.parse(await r.text());
}

/** Baixa um arquivo como Buffer. Retorna null se não existir. */
async function baixar(caminho) {
  const r = await graph(`${await urlItem(caminho)}:/content`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Erro ao baixar ${caminho}: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/** Grava conteúdo (Buffer ou string). Usa upload simples até 4 MB e sessão de upload acima disso. */
async function gravar(caminho, conteudo, tipo = "application/octet-stream") {
  const corpo = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, "utf8");
  if (corpo.length <= 4 * 1024 * 1024) {
    const r = await graph(`${await urlItem(caminho)}:/content`, { method: "PUT", headers: { "Content-Type": tipo }, body: corpo });
    if (!r.ok) throw new Error(`Erro ao gravar ${caminho}: ${r.status} ${await r.text()}`);
    return r.json();
  }
  const s = await graph(`${await urlItem(caminho)}:/createUploadSession`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } })
  });
  if (!s.ok) throw new Error(`Erro ao iniciar upload de ${caminho}: ${s.status}`);
  const { uploadUrl } = await s.json();
  const BLOCO = 5 * 320 * 1024; // múltiplo de 320 KB
  let resp;
  for (let ini = 0; ini < corpo.length; ini += BLOCO) {
    const fim = Math.min(ini + BLOCO, corpo.length);
    resp = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes ${ini}-${fim - 1}/${corpo.length}` }, body: corpo.subarray(ini, fim) });
    if (!resp.ok && resp.status !== 202) throw new Error(`Erro no upload de ${caminho}: ${resp.status}`);
  }
  return resp.json();
}

const gravarJson = (caminho, obj) => gravar(caminho, JSON.stringify(obj), "application/json");

/** Lista arquivos de uma pasta (retorna [] se a pasta não existir). */
async function listar(caminho) {
  const r = await graph(`${await urlItem(caminho)}:/children?$select=name,size,lastModifiedDateTime,webUrl,file,folder&$top=200`);
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`Erro ao listar ${caminho}: ${r.status}`);
  return (await r.json()).value;
}

/** Envia e-mail pela caixa definida em MAIL_REMETENTE (permissão de aplicativo Mail.Send). */
async function enviarEmail({ para, assunto, html }) {
  const remetente = process.env.MAIL_REMETENTE;
  if (!remetente) throw Object.assign(new Error("MAIL_REMETENTE não configurado no servidor"), { status: 501 });
  const r = await graph(`/users/${encodeURIComponent(remetente)}/sendMail`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: { subject: assunto, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: para } }] }, saveToSentItems: true })
  });
  if (!r.ok) throw new Error(`Falha ao enviar e-mail: ${r.status} ${await r.text()}`);
}

module.exports = { lerJson, baixar, gravar, gravarJson, listar, enviarEmail };
