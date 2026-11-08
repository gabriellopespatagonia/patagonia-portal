// Administração dos e-mails com acesso ao portal de cada cliente (consultor).
//   GET    /api/acessos?cliente=ID
//   POST   /api/acessos            { clienteId, email, nome, enviarConvite }
//   DELETE /api/acessos?cliente=ID&email=...
//   POST   /api/acessos/redefinir  { clienteId, email }
// O login é feito pela Microsoft: a senha nunca passa pelo portal. A "redefinição"
// envia ao usuário os links oficiais de recuperação de senha da Microsoft.
const { app } = require("@azure/functions");
const sp = require("../lib/graph");
const { exigirConsultor, exigirAcessoCliente, httpErro, rota, invalidarCache } = require("../lib/acesso");

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const urlPortal = () => process.env.PORTAL_URL || "https://portal.patagoniabusiness.com.br";
const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function modeloEmail(titulo, corpo) {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;color:#13232f">
    <div style="background:#0f2a3d;color:#fff;padding:18px 24px;border-radius:10px 10px 0 0"><b style="font-size:18px">Patagonia Business</b><br><span style="color:#8fd3cf;font-size:13px">Consultoria & BPO Financeiro</span></div>
    <div style="border:1px solid #dbe3e8;border-top:0;padding:24px;border-radius:0 0 10px 10px"><h2 style="margin-top:0;font-size:20px">${titulo}</h2>${corpo}
    <p style="color:#5d6f7c;font-size:12px;margin-top:28px">Mensagem automática do portal de clientes. Em caso de dúvida, responda a este e-mail.</p></div></div>`;
}

async function usuariosDoCliente(clienteId) {
  const u = (await sp.lerJson("config/usuarios.json")) || {};
  return { todos: u, lista: Object.entries(u).filter(([, v]) => v.papel === "cliente" && v.clienteId === clienteId).map(([email, v]) => ({ email, ...v })) };
}

app.http("acessos", {
  methods: ["GET", "POST", "DELETE"], authLevel: "anonymous", route: "acessos",
  handler: rota(async (req) => {
    const quem = await exigirConsultor(req);
    if (req.method === "GET") {
      const id = req.query.get("cliente"); await exigirAcessoCliente(req, id);
      return (await usuariosDoCliente(id)).lista;
    }
    if (req.method === "DELETE") {
      const id = req.query.get("cliente"), email = String(req.query.get("email") || "").toLowerCase();
      await exigirAcessoCliente(req, id);
      const { todos } = await usuariosDoCliente(id);
      const chave = Object.keys(todos).find((k) => k.toLowerCase() === email);
      if (!chave || todos[chave].clienteId !== id || todos[chave].papel !== "cliente") throw httpErro(404, "Acesso não encontrado para este cliente");
      delete todos[chave];
      await sp.gravarJson("config/usuarios.json", todos); invalidarCache();
      return { ok: true };
    }
    const { clienteId, email, nome, enviarConvite } = await req.json();
    await exigirAcessoCliente(req, clienteId);
    const e = String(email || "").trim().toLowerCase();
    if (!EMAIL_OK.test(e)) throw httpErro(400, "E-mail inválido");
    const { todos } = await usuariosDoCliente(clienteId);
    if (todos[e] && todos[e].papel === "consultor") throw httpErro(409, "Este e-mail pertence a um consultor");
    todos[e] = { nome: nome || e, papel: "cliente", clienteId, criadoEm: new Date().toISOString(), criadoPor: quem.email };
    await sp.gravarJson("config/usuarios.json", todos); invalidarCache();
    if (enviarConvite) {
      await sp.enviarEmail({ para: e, assunto: "Seu acesso ao portal Patagonia Business", html: modeloEmail(`Olá, ${esc(nome)}!`, `
        <p>Seu acesso ao portal de relatórios financeiros e comerciais foi liberado.</p>
        <p><a href="${urlPortal()}/login.html" style="background:#2e8b8b;color:#fff;padding:10px 18px;border-radius:20px;text-decoration:none;display:inline-block">Acessar o portal</a></p>
        <p>Clique em <b>Entrar com conta Microsoft</b> e use este e-mail (<b>${esc(e)}</b>). Se ele ainda não for uma conta Microsoft, escolha <b>Criar conta</b> na tela da Microsoft e defina sua senha.</p>`) });
    }
    return { ok: true, convite: !!enviarConvite };
  })
});

app.http("acessosRedefinir", {
  methods: ["POST"], authLevel: "anonymous", route: "acessos/redefinir",
  handler: rota(async (req) => {
    await exigirConsultor(req);
    const { clienteId, email } = await req.json();
    await exigirAcessoCliente(req, clienteId);
    const { lista } = await usuariosDoCliente(clienteId);
    const u = lista.find((x) => x.email.toLowerCase() === String(email).toLowerCase());
    if (!u) throw httpErro(404, "E-mail não cadastrado para este cliente");
    await sp.enviarEmail({ para: u.email, assunto: "Redefinição de senha — portal Patagonia Business", html: modeloEmail("Redefinição de senha", `
      <p>Olá, ${esc(u.nome)}. Recebemos uma solicitação para redefinir a senha do seu acesso ao portal.</p>
      <p>Como o login é feito com a sua conta Microsoft, a troca de senha é feita diretamente na Microsoft:</p>
      <ul>
        <li><b>E-mail pessoal</b> (Gmail, Hotmail, Outlook etc.): <a href="https://account.live.com/password/reset">account.live.com/password/reset</a></li>
        <li><b>E-mail corporativo</b> (Microsoft 365 da sua empresa): <a href="https://passwordreset.microsoftonline.com/">passwordreset.microsoftonline.com</a></li>
      </ul>
      <p>Depois de redefinir, acesse <a href="${urlPortal()}/login.html">${urlPortal()}</a>.</p>
      <p style="color:#5d6f7c">Se você não pediu a redefinição, ignore este e-mail.</p>`) });
    return { ok: true };
  })
});

/* ---------------------------------------------------------
   EQUIPE DE CONSULTORES (acesso à área do consultor)
     GET    /api/consultores
     POST   /api/consultores            { email, nome, enviarConvite }
     DELETE /api/consultores?email=...
     POST   /api/consultores/redefinir  { email }
   --------------------------------------------------------- */
const listaConsultores = (u) => Object.entries(u).filter(([, v]) => v.papel === "consultor");

app.http("consultores", {
  methods: ["GET", "POST", "DELETE"], authLevel: "anonymous", route: "consultores",
  handler: rota(async (req) => {
    const quem = await exigirConsultor(req);
    const todos = (await sp.lerJson("config/usuarios.json")) || {};
    if (req.method === "GET") return listaConsultores(todos).map(([email, v]) => ({ email, nome: v.nome, criadoEm: v.criadoEm, criadoPor: v.criadoPor }));

    if (req.method === "DELETE") {
      const email = String(req.query.get("email") || "").toLowerCase();
      if (email === quem.email) throw httpErro(400, "Você não pode remover o próprio acesso");
      const chave = Object.keys(todos).find((k) => k.toLowerCase() === email);
      if (!chave || todos[chave].papel !== "consultor") throw httpErro(404, "Consultor não encontrado");
      if (listaConsultores(todos).length <= 1) throw httpErro(400, "É preciso manter ao menos um consultor");
      delete todos[chave];
      await sp.gravarJson("config/usuarios.json", todos); invalidarCache();
      return { ok: true };
    }

    const { email, nome, enviarConvite } = await req.json();
    const e = String(email || "").trim().toLowerCase();
    if (!EMAIL_OK.test(e)) throw httpErro(400, "E-mail inválido");
    if (todos[e] && todos[e].papel === "cliente") throw httpErro(409, "Este e-mail já é usuário de um cliente — use outro e-mail para o consultor");
    todos[e] = { nome: nome || e, papel: "consultor", criadoEm: new Date().toISOString(), criadoPor: quem.email };
    await sp.gravarJson("config/usuarios.json", todos); invalidarCache();
    if (enviarConvite) {
      await sp.enviarEmail({ para: e, assunto: "Seu acesso à área do consultor — Patagonia Business", html: modeloEmail(`Olá, ${esc(nome)}!`, `
        <p>Seu acesso à <b>área do consultor</b> da Patagonia Business foi liberado por ${esc(quem.nome || quem.email)}.</p>
        <p><a href="${urlPortal()}/login.html?destino=consultor" style="background:#0070bd;color:#fff;padding:10px 18px;border-radius:20px;text-decoration:none;display:inline-block">Acessar a área do consultor</a></p>
        <p>Escolha <b>Consultor / BPO</b>, clique em <b>Entrar com conta Microsoft</b> e use este e-mail (<b>${esc(e)}</b>).</p>`) });
    }
    return { ok: true, convite: !!enviarConvite };
  })
});

app.http("consultoresRedefinir", {
  methods: ["POST"], authLevel: "anonymous", route: "consultores/redefinir",
  handler: rota(async (req) => {
    await exigirConsultor(req);
    const { email } = await req.json();
    const todos = (await sp.lerJson("config/usuarios.json")) || {};
    const chave = Object.keys(todos).find((k) => k.toLowerCase() === String(email).toLowerCase());
    if (!chave || todos[chave].papel !== "consultor") throw httpErro(404, "Consultor não encontrado");
    await sp.enviarEmail({ para: chave, assunto: "Recuperação de senha — Patagonia Business", html: modeloEmail("Recuperação de senha", `
      <p>Olá, ${esc(todos[chave].nome)}. Foi solicitada a recuperação de senha do seu acesso à área do consultor.</p>
      <p>O login é feito com a sua conta Microsoft, então a troca de senha é feita diretamente na Microsoft:</p>
      <ul>
        <li><b>Conta corporativa</b> (Microsoft 365): <a href="https://passwordreset.microsoftonline.com/">passwordreset.microsoftonline.com</a></li>
        <li><b>Conta pessoal</b>: <a href="https://account.live.com/password/reset">account.live.com/password/reset</a></li>
      </ul>
      <p>Depois de redefinir, acesse <a href="${urlPortal()}/login.html?destino=consultor">${urlPortal()}</a>.</p>
      <p style="color:#5b6b7d">Se você não pediu a recuperação, ignore este e-mail.</p>`) });
    return { ok: true };
  })
});
