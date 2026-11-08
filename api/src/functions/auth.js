// Login por código enviado por e-mail.
//   POST /api/auth/codigo  { email }            → envia o código e devolve { desafio }
//   POST /api/auth/entrar  { desafio, codigo }  → cria a sessão (cookie)
//   POST /api/auth/sair                         → encerra a sessão
const { app } = require("@azure/functions");
const sp = require("../lib/graph");
const { usuarioCadastrado } = require("../lib/acesso");
const { novoCodigo, conferirCodigo, cookieSessao, cookieSair } = require("../lib/sessao");

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const json = (status, corpo, headers = {}) => ({ status, jsonBody: corpo, headers });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

app.http("authCodigo", {
  methods: ["POST"], authLevel: "anonymous", route: "auth/codigo",
  handler: async (req, context) => {
    try {
      const { email } = await req.json();
      const e = String(email || "").trim().toLowerCase();
      if (!EMAIL_OK.test(e)) return json(400, { erro: "Informe um e-mail válido." });
      const u = await usuarioCadastrado(e);
      // mesma resposta para e-mail cadastrado ou não (não revela quem tem acesso)
      const { codigo, desafio } = novoCodigo(e);
      if (u) {
        await sp.enviarEmail({
          para: e, assunto: `${codigo} é o seu código de acesso — Patagonia Business`,
          html: `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;color:#0e1b2b">
            <div style="background:#0c2a4b;color:#fff;padding:18px 24px;border-radius:8px 8px 0 0"><b style="font-size:18px">Patagonia Business</b><br><span style="color:#5aaee8;font-size:13px">Portal do cliente</span></div>
            <div style="border:1px solid #dfe4ea;border-top:0;padding:24px;border-radius:0 0 8px 8px">
              <p>Olá, ${esc(u.nome || "")}. Use o código abaixo para entrar no portal:</p>
              <p style="font-size:34px;letter-spacing:8px;font-weight:700;color:#0070bd;margin:18px 0">${codigo}</p>
              <p style="color:#5b6b7d;font-size:13px">O código vale por 10 minutos e só pode ser usado uma vez. Se você não tentou entrar, ignore este e-mail.</p>
            </div></div>`
        });
      } else {
        await espera(400 + Math.random() * 400);
      }
      return json(200, { desafio, mensagem: "Se este e-mail estiver cadastrado, você receberá um código em instantes." });
    } catch (err) {
      context.error(err);
      return json(err.status || 500, { erro: err.status ? err.message : "Não foi possível enviar o código agora." });
    }
  }
});

app.http("authEntrar", {
  methods: ["POST"], authLevel: "anonymous", route: "auth/entrar",
  handler: async (req, context) => {
    try {
      const { desafio, codigo } = await req.json();
      const r = conferirCodigo(desafio, codigo);
      if (!r.ok) { await espera(700); return json(401, { erro: r.motivo }); }
      const u = await usuarioCadastrado(r.email);
      if (!u) return json(403, { erro: "Este e-mail não tem acesso ao portal." });
      return json(200, { ok: true, papel: u.papel }, { "Set-Cookie": cookieSessao(r.email) });
    } catch (err) {
      context.error(err);
      return json(500, { erro: "Não foi possível entrar agora." });
    }
  }
});

app.http("authSair", {
  methods: ["POST"], authLevel: "anonymous", route: "auth/sair",
  handler: async () => json(200, { ok: true }, { "Set-Cookie": cookieSair() })
});
