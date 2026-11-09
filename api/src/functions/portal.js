// Rotas do portal: perfil, clientes, dados publicados e arquivos (SharePoint).
const { app } = require("@azure/functions");
const sp = require("../lib/graph");
const { perfil, exigirConsultor, exigirAcessoCliente, httpErro, rota, invalidarCache } = require("../lib/acesso");
const { iaAtiva } = require("../lib/claude");

const PASTAS = ["relatorios", "bruto", "publicado", "contratos"];
const PASTAS_CLIENTE = ["relatorios"]; // o que o cliente final pode ver/baixar
const nomeSeguro = (n) => String(n || "").replace(/[\\/:*?"<>|#%]/g, "_").slice(0, 150);

// GET /api/perfil → dados do usuário logado
app.http("perfil", {
  methods: ["GET"], authLevel: "anonymous", route: "perfil",
  handler: async (req, context) => {
    try { const u = await perfil(req); return { status: 200, jsonBody: { email: u.email, nome: u.nome, papel: u.papel, clienteId: u.clienteId, iaAtiva: iaAtiva() } }; }
    catch (e) {
      if (!e.status) { context.error(e); return { status: 500, body: "Erro interno" }; }
      // 403: informa qual e-mail chegou do login, para o usuário saber o que cadastrar
      return { status: e.status, jsonBody: { erro: e.message, email: e.email || null } };
    }
  }
});

// GET/POST/PATCH /api/clientes
const CAMPOS_EDITAVEIS = ["nome", "cnpj", "origem", "setor", "contexto", "benchmarks", "responsavel"];
app.http("clientes", {
  methods: ["GET", "POST", "PATCH"], authLevel: "anonymous", route: "clientes",
  handler: rota(async (req) => {
    const u = await exigirConsultor(req);
    const lista = (await sp.lerJson("config/clientes.json")) || [];
    if (req.method === "GET") {
      return Promise.all(lista.map(async (c) => {
        const d = await sp.lerJson(`Clientes/${c.id}/publicado/dados.json`).catch(() => null);
        const fech = Object.entries((d && d.fechamentos) || {}).sort(([a], [b]) => a.localeCompare(b));
        return { ...c, atualizadoEm: d ? d.atualizadoEm : null,
          ultimoFechado: (fech.filter(([, v]) => v.status === "Fechado").at(-1) || [])[0] || null,
          mesesAbertos: fech.filter(([, v]) => v.status !== "Fechado").map(([m]) => m) };
      }));
    }
    if (req.method === "PATCH") {
      const corpo = await req.json();
      const c = lista.find((x) => x.id === corpo.id);
      if (!c) throw httpErro(404, "Cliente não encontrado");
      CAMPOS_EDITAVEIS.forEach((k) => { if (k in corpo) c[k] = corpo[k]; });
      c.alteradoEm = new Date().toISOString(); c.alteradoPor = u.email;
      await sp.gravarJson("config/clientes.json", lista);
      return { ok: true };
    }
    const novo = await req.json();
    if (!/^[a-z0-9-]{2,60}$/.test(novo.id || "")) throw httpErro(400, "Identificador inválido");
    if (lista.some((c) => c.id === novo.id)) throw httpErro(409, "Cliente já cadastrado");
    lista.push({ id: novo.id, nome: novo.nome, cnpj: novo.cnpj, origem: novo.origem, setor: novo.setor || "", contexto: novo.contexto || "", responsavel: u.nome, criadoEm: new Date().toISOString() });
    await sp.gravarJson("config/clientes.json", lista);
    await sp.gravar(`Clientes/${novo.id}/LEIA-ME.txt`, `Pasta do cliente ${novo.nome}. Subpastas: bruto, publicado, relatorios, contratos.`, "text/plain");
    if (novo.emailUsuario) {
      const usuarios = (await sp.lerJson("config/usuarios.json")) || {};
      usuarios[novo.emailUsuario.toLowerCase()] = { nome: novo.nome, papel: "cliente", clienteId: novo.id };
      await sp.gravarJson("config/usuarios.json", usuarios);
      invalidarCache();
    }
    return { ok: true };
  })
});

// GET /api/dados?cliente=ID   |   POST /api/dados { clienteId, dados }
app.http("dados", {
  methods: ["GET", "POST"], authLevel: "anonymous", route: "dados",
  handler: rota(async (req) => {
    if (req.method === "GET") {
      const id = req.query.get("cliente");
      await exigirAcessoCliente(req, id);
      return sp.lerJson(`Clientes/${id}/publicado/dados.json`);
    }
    const u = await exigirConsultor(req);
    const { clienteId, dados } = await req.json();
    await exigirAcessoCliente(req, clienteId);
    if (!dados || !Array.isArray(dados.lancamentos) || !Array.isArray(dados.vendas)) throw httpErro(400, "Base fora do modelo padrão");
    dados.publicadoPor = u.email;
    const carimbo = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    await sp.gravarJson(`Clientes/${clienteId}/publicado/historico/dados-${carimbo}.json`, dados); // versão para auditoria
    await sp.gravarJson(`Clientes/${clienteId}/publicado/dados.json`, dados);
    return { ok: true, publicadoEm: dados.atualizadoEm };
  })
});

// GET /api/arquivos?cliente=ID   |   POST /api/arquivos { clienteId, pasta, nome, conteudoBase64 }
app.http("arquivos", {
  methods: ["GET", "POST"], authLevel: "anonymous", route: "arquivos",
  handler: rota(async (req) => {
    if (req.method === "GET") {
      const id = req.query.get("cliente");
      const u = await exigirAcessoCliente(req, id);
      const pastas = u.papel === "consultor" ? PASTAS : PASTAS_CLIENTE;
      const tudo = await Promise.all(pastas.map(async (p) => (await sp.listar(`Clientes/${id}/${p}`))
        .filter((i) => i.file)
        .map((i) => ({ nome: i.name, pasta: p, tamanho: i.size, modificado: i.lastModifiedDateTime,
          url: `/api/download?cliente=${encodeURIComponent(id)}&pasta=${p}&nome=${encodeURIComponent(i.name)}` }))));
      return tudo.flat().sort((a, b) => b.modificado.localeCompare(a.modificado));
    }
    await exigirConsultor(req);
    const { clienteId, pasta, nome, conteudoBase64 } = await req.json();
    await exigirAcessoCliente(req, clienteId);
    if (!PASTAS.includes(pasta)) throw httpErro(400, "Pasta inválida");
    await sp.gravar(`Clientes/${clienteId}/${pasta}/${nomeSeguro(nome)}`, Buffer.from(conteudoBase64, "base64"));
    return { ok: true };
  })
});

// GET /api/download?cliente=ID&pasta=relatorios&nome=arquivo.pdf
app.http("download", {
  methods: ["GET"], authLevel: "anonymous", route: "download",
  handler: async (req, context) => {
    try {
      const id = req.query.get("cliente"), pasta = req.query.get("pasta"), nome = nomeSeguro(req.query.get("nome"));
      const u = await exigirAcessoCliente(req, id);
      if (!(u.papel === "consultor" ? PASTAS : PASTAS_CLIENTE).includes(pasta)) throw httpErro(403, "Sem permissão");
      const buf = await sp.baixar(`Clientes/${id}/${pasta}/${nome}`);
      if (!buf) throw httpErro(404, "Arquivo não encontrado");
      return { status: 200, body: buf, headers: { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(nome)}` } };
    } catch (e) {
      if (!e.status) context.error(e);
      return { status: e.status || 500, body: e.status ? e.message : "Erro interno" };
    }
  }
});
