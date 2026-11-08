/* =========================================================
   MODO DEMONSTRAÇÃO
   Gera dados fictícios e simula a API localmente para que o
   site possa ser visualizado sem servidor. Em produção este
   arquivo é ignorado (as chamadas vão para /api).
   ========================================================= */
(function () {
  const PB = window.PB;
  const LS = "pb_demo_store_v3";

  function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

  // Plano de contas de exemplo: [número, nome, tipo, referência DRE, referência DFC]
  const E = window.PB_ESTRUTURA;
  const PLANO = [
    ["1", "Receitas", "S"], ["1.1", "Receitas Operacionais", "S"],
    ["1.1.01", "Venda de Produtos", "A", "Receita Bruta", "Receita Bruta"],
    ["1.1.02", "Prestação de Serviços", "A", "Receita Bruta", "Receita Bruta"],
    ["1.2", "Receitas Financeiras e Não Operacionais", "S"],
    ["1.2.01", "Rendimentos de Aplicações Financeiras", "A", "Receitas Financeiras", "Outras Entradas"],
    ["2", "Deduções da Receita", "S"],
    ["2.1.01", "Simples Nacional e Impostos sobre Vendas", "A", "Impostos sobre Vendas", "Impostos sobre Vendas"],
    ["2.1.02", "Devoluções e Descontos Concedidos", "A", "Descontos Concedidos", "Descontos Concedidos"],
    ["3", "Custos", "S"],
    ["3.1.01", "Compra de Mercadorias para Revenda", "A", E.CMV, E.CMV],
    ["3.1.02", "Serviços Terceirizados Aplicados aos Serviços Prestados", "A", E.CMV, E.CMV],
    ["4", "Despesas Variáveis", "S"],
    ["4.1.01", "Comissões sobre Vendas", "A", "Despesas com Vendas", "Despesas com Vendas"],
    ["4.1.02", "Fretes sobre Vendas", "A", "Despesas com Operação e Logística", "Despesas com Operação e Logística"],
    ["5", "Despesas Fixas", "S"], ["5.1", "Despesas com Pessoal", "S"],
    ["5.1.01", "Salários e Encargos Sociais", "A", "Despesa com Pessoal", "Despesa com Pessoal"],
    ["5.1.02", "Benefícios a Empregados", "A", "Despesa com Pessoal", "Despesa com Pessoal"],
    ["5.1.03", "Pró-labore dos Sócios", "A", "Despesas de Diretoria", "Despesas de Diretoria"],
    ["5.2", "Despesas com Ocupação", "S"],
    ["5.2.01", "Aluguel e Condomínio", "A", "Despesas com Ocupação", "Despesas com Ocupação"],
    ["5.2.02", "Energia Elétrica, Água e Telefone", "A", "Despesas com Ocupação", "Despesas com Ocupação"],
    ["5.3", "Despesas Administrativas e Comerciais", "S"],
    ["5.3.01", "Contabilidade e Consultoria", "A", "Despesas Administrativas", "Despesas Administrativas"],
    ["5.3.02", "Sistemas e Programas de Computador", "A", "Despesas Administrativas", "Despesas Administrativas"],
    ["5.3.03", "Despesas Gerais", "A", "Despesas Administrativas", "Despesas Administrativas"],
    ["5.3.04", "Marketing e Publicidade", "A", "Despesas com Marketing", "Despesas com Marketing"],
    ["6", "Depreciação e Amortização", "S"],
    ["6.1.01", "Depreciação de Máquinas e Equipamentos", "A", "Depreciação e Amortização", E.NAO_DFC],
    ["7", "Despesas Financeiras", "S"],
    ["7.1.01", "Juros e Tarifas Bancárias", "A", "Despesas Financeiras", "Saídas do Fluxo de Caixa de Financiamentos"],
    ["8", "Impostos sobre o Lucro", "S"],
    ["8.1.01", "Imposto de Renda Pessoa Jurídica", "A", "Provisão para Imposto de Renda Pessoa Jurídica (IRPJ) / Pessoa Física (IRPF)", "Outras Despesas não Operacionais"],
    ["8.1.02", "Contribuição Social sobre o Lucro Líquido", "A", "Provisão para Contribuição Social sobre o Lucro Líquido (CSLL)", "Outras Despesas não Operacionais"],
    ["9", "Investimentos e Financiamentos", "S"],
    ["9.1.01", "Compra de Máquinas e Equipamentos", "A", E.NAO_DRE, "Saídas do Fluxo de Caixa de Investimentos"],
    ["9.2.01", "Empréstimos e Financiamentos Recebidos", "A", E.NAO_DRE, "Entradas do Fluxo de Caixa de Financiamentos"],
    ["9.2.02", "Amortização de Empréstimos e Financiamentos", "A", E.NAO_DRE, "Saídas do Fluxo de Caixa de Financiamentos"],
    ["10", "Distribuições aos Sócios", "S"],
    ["10.1.01", "Distribuição de Lucros aos Sócios", "A", "Distribuição de Lucros", "Saídas do Fluxo de Caixa de Financiamentos"]
  ].map(([numero, nome, t, refDRE = "", refDFC = ""]) => ({ numero, nome, tipo: t === "S" ? "Sintética" : "Analítica", refDRE, refDFC }));
  // nomes usados pelo gerador de lançamentos → conta analítica do plano
  const C = {
    vp: "Venda de Produtos", ps: "Prestação de Serviços", imp: "Simples Nacional e Impostos sobre Vendas", dev: "Devoluções e Descontos Concedidos",
    merc: "Compra de Mercadorias para Revenda", terc: "Serviços Terceirizados Aplicados aos Serviços Prestados", sal: "Salários e Encargos Sociais",
    prol: "Pró-labore dos Sócios", ben: "Benefícios a Empregados", alug: "Aluguel e Condomínio", cont: "Contabilidade e Consultoria",
    sis: "Sistemas e Programas de Computador", ener: "Energia Elétrica, Água e Telefone", mkt: "Marketing e Publicidade", com: "Comissões sobre Vendas",
    fre: "Fretes sobre Vendas", rend: "Rendimentos de Aplicações Financeiras", juros: "Juros e Tarifas Bancárias", irpj: "Imposto de Renda Pessoa Jurídica",
    csll: "Contribuição Social sobre o Lucro Líquido", equip: "Compra de Máquinas e Equipamentos", emp: "Empréstimos e Financiamentos Recebidos",
    amort: "Amortização de Empréstimos e Financiamentos", dist: "Distribuição de Lucros aos Sócios", ger: "Despesas Gerais", dep: "Depreciação de Máquinas e Equipamentos"
  };

  function gerar(id, nome, cnpj, origem, escala, seed, mixServico) {
    const r = rng(seed);
    const realizados = PB.mesesEntre("2025-11", "2026-10");
    const futuros = PB.mesesEntre("2026-11", "2027-04");
    const clientes = Array.from({ length: 38 }, (_, i) => ["Mercado", "Comercial", "Grupo", "Loja", "Indústria", "Clínica", "Construtora"][i % 7] + " " + ["Aurora", "Horizonte", "Andes", "Fiorde", "Lago Azul", "Torres", "Glaciar", "Cerro", "Vale Sul", "Pampa", "Austral", "Ushuaia", "Monte Fitz", "Bariloche", "Calafate"][i % 15] + (i > 14 ? " " + (i + 1) : ""));
    const itens = [
      ["Kit Linha Premium", "Produto", "Linha Premium", 890], ["Kit Linha Essencial", "Produto", "Linha Essencial", 340],
      ["Peça Reposição A", "Produto", "Reposição", 120], ["Peça Reposição B", "Produto", "Reposição", 75],
      ["Instalação", "Serviço", "Serviços Técnicos", 450], ["Manutenção Mensal", "Serviço", "Contratos", 1200],
      ["Consultoria Técnica", "Serviço", "Serviços Técnicos", 2200]
    ];
    const vendedores = ["Carla", "Diego", "Fernanda", "Rafael"];
    const regioes = ["Porto Alegre", "Caxias do Sul", "Florianópolis", "Curitiba", "São Paulo"];
    const vendas = [], lanc = [];
    let nf = 1000;
    realizados.forEach((m, mi) => {
      const saz = 1 + 0.18 * Math.sin((mi / 12) * Math.PI * 2 + 1) + mi * 0.012;
      const nVendas = Math.round((92 + r() * 30) * escala * saz);
      for (let k = 0; k < nVendas; k++) {
        const dia = String(1 + Math.floor(r() * 27)).padStart(2, "0");
        const cli = clientes[Math.floor(Math.pow(r(), 1.6) * clientes.length * Math.min(1, 0.55 + mi * 0.04))];
        const nItens = 1 + Math.floor(r() * 2); nf++;
        for (let j = 0; j < nItens; j++) {
          const pool = r() < mixServico ? itens.filter((x) => x[1] === "Serviço") : itens.filter((x) => x[1] === "Produto");
          const it = pool[Math.floor(r() * pool.length)];
          const q = it[1] === "Serviço" ? 1 : 1 + Math.floor(r() * 6);
          const desc = r() < 0.2 ? Math.round(it[3] * q * 0.05) : 0;
          vendas.push({ data: `${m}-${dia}`, numero: "NF" + nf, cliente: cli, item: it[0], tipoItem: it[1], categoriaItem: it[2], quantidade: q, valorUnitario: it[3], desconto: desc, valorTotal: it[3] * q - desc, vendedor: vendedores[Math.floor(r() * 4)], regiao: regioes[Math.floor(r() * 5)] });
        }
      }
      const vm = vendas.filter((v) => v.data.startsWith(m));
      const recProd = PB.soma(vm.filter((v) => v.tipoItem === "Produto"), (v) => v.valorTotal);
      const recServ = PB.soma(vm.filter((v) => v.tipoItem === "Serviço"), (v) => v.valorTotal);
      const add = (tipo, categoria, valor, dia = "10", status = "Realizado", ym = m, contraparte = "") =>
        valor > 0 && lanc.push({ data: `${ym}-${dia}`, competencia: ym, tipo, categoria, descricao: categoria, valor: Math.round(valor), status, conta: "Banco Principal", centroCusto: "Geral", contraparte });
      add("Receita", C.vp, recProd, "20"); add("Receita", C.ps, recServ, "22");
      const rb = recProd + recServ;
      add("Despesa", C.imp, rb * 0.082, "20");
      add("Despesa", C.dev, rb * 0.012 * r(), "25");
      add("Despesa", C.merc, recProd * (0.4 + r() * 0.06), "12");
      add("Despesa", C.terc, recServ * (0.22 + r() * 0.05), "15");
      add("Despesa", C.sal, 21000 * escala * (mi > 6 ? 1.06 : 1), "05");
      add("Despesa", C.prol, 9000 * escala, "05"); add("Despesa", C.ben, 3200 * escala, "07");
      add("Despesa", C.alug, 6500 * escala, "10"); add("Despesa", C.cont, 2800, "10");
      add("Despesa", C.sis, 950 + r() * 200, "12"); add("Despesa", C.ener, 1400 * escala + r() * 400, "15");
      add("Despesa", C.mkt, rb * (0.02 + r() * 0.015), "18");
      add("Despesa", C.com, rb * 0.03, "28"); add("Despesa", C.fre, recProd * 0.025, "26");
      add("Receita", C.rend, 300 + r() * 500, "28"); add("Despesa", C.juros, 450 + r() * 300, "28");
      if (["2026-01", "2026-04", "2026-07", "2026-10"].includes(m)) { add("Despesa", C.irpj, rb * 0.06 * 3 * 0.35 * 0.6, "29"); add("Despesa", C.csll, rb * 0.06 * 3 * 0.35 * 0.4, "29"); }
      if (m === "2026-03") { add("Despesa", C.equip, 48000 * escala, "14"); add("Receita", C.emp, 60000 * escala, "08"); }
      if (m >= "2026-03") add("Despesa", C.dep, 800 * escala, "28");
      if (m >= "2026-04") add("Despesa", C.amort, 3100 * escala, "15");
      if (m === "2026-06" || m === "2025-12") add("Despesa", C.dist, 15000 * escala, "20");
    });
    // previstos (contas a pagar/receber futuras) e projeções
    const mediaRec = PB.soma(vendas, (v) => v.valorTotal) / realizados.length;
    const projecoes = [];
    futuros.forEach((m, i) => {
      const rec = mediaRec * (1.04 + i * 0.012);
      const add = (tipo, categoria, valor, dia) => lanc.push({ data: `${m}-${dia}`, competencia: m, tipo, categoria, descricao: categoria + " (previsto)", valor: Math.round(valor), status: "Previsto", conta: "Banco Principal", centroCusto: "Geral", contraparte: "" });
      if (i < 3) {
        add("Receita", C.vp, rec * (1 - mixServico) * 0.92, "20"); add("Receita", C.ps, rec * mixServico * 0.92, "22");
        add("Despesa", C.imp, rec * 0.082, "20"); add("Despesa", C.merc, rec * (1 - mixServico) * 0.42, "12");
        add("Despesa", C.sal, 22300 * escala, "05"); add("Despesa", C.prol, 9000 * escala, "05"); add("Despesa", C.alug, 6500 * escala, "10");
        add("Despesa", C.ger, 9000 * escala, "15"); add("Despesa", C.amort, 3100 * escala, "15");
        if (m === "2026-12") add("Despesa", C.sal, 22300 * escala, "18"); // 13º salário
      }
      ["Base", "Otimista", "Conservador"].forEach((c, ci) => {
        const f = [1, 1.12, 0.88][ci];
        projecoes.push({ mes: m, cenario: c, receita: Math.round(rec * f), custos: Math.round(rec * f * 0.37), despesas: Math.round((60000 * escala) + rec * f * 0.07), investimentos: m === "2027-02" ? Math.round(30000 * escala) : 0, observacao: "" });
      });
    });
    return {
      versaoModelo: PB.MODELO.versao,
      cliente: { id, nome, cnpj, origem },
      atualizadoEm: "2026-11-05T14:30:00",
      planoContas: PLANO.map((c) => ({ ...c })),
      contas: [{ conta: "Banco Principal", banco: "Banco do Brasil", saldoInicial: Math.round(85000 * escala), dataSaldo: "2025-11-01" }],
      lancamentos: lanc.sort((a, b) => a.data.localeCompare(b.data)),
      vendas, projecoes,
      fechamentos: Object.fromEntries(realizados.map((m, i) => [m, i < realizados.length - 1
        ? { status: "Fechado", em: m + "-28T18:00:00", por: "consultor@demo.com", obs: "" }
        : { status: "Em revisão", em: "2026-11-05T14:30:00", por: "consultor@demo.com", obs: "Aguardando extrato do cartão" }]))
    };
  }

  function store() {
    let s; try { s = JSON.parse(localStorage.getItem(LS)); } catch { }
    if (!s) {
      s = {
        clientes: [
          { id: "alfa-distribuidora", nome: "Alfa Distribuidora Ltda", cnpj: "12.345.678/0001-90", origem: "contaazul", responsavel: "Consultor Patagonia",
            setor: "Distribuição de equipamentos e peças de reposição", contexto: "Distribuidora regional (RS/SC/PR) de kits de equipamentos e peças de reposição, com serviços de instalação. Venda B2B para varejo e pequenas indústrias. Sazonalidade com pico no segundo semestre. Optante do Simples Nacional, 14 colaboradores." },
          { id: "beta-servicos", nome: "Beta Serviços Técnicos ME", cnpj: "98.765.432/0001-10", origem: "planilha", responsavel: "Consultor Patagonia",
            setor: "Serviços técnicos de manutenção", contexto: "Empresa de manutenção e consultoria técnica com contratos mensais recorrentes. Principal custo é mão de obra terceirizada." }
        ],
        usuarios: Object.fromEntries(window.PB_CONFIG.usuariosDemo.map((u) => [u.email, { nome: u.nome, papel: u.papel, clienteId: u.clienteId }])),
        contaazul: {},
        dados: {}, arquivos: {
          "alfa-distribuidora": [
            { nome: "Relatório Mensal - Outubro 2026.pdf", pasta: "relatorios", tamanho: 482000, modificado: "2026-11-05T10:12:00" },
            { nome: "Extrato Conta Azul - Out-2026.xlsx", pasta: "bruto", tamanho: 91000, modificado: "2026-11-03T09:00:00" }
          ],
          "beta-servicos": [{ nome: "Coleta Padrão - Out-2026.xlsx", pasta: "bruto", tamanho: 64000, modificado: "2026-11-04T16:40:00" }]
        }
      };
      try { localStorage.setItem(LS, JSON.stringify({ ...s, dados: {} })); } catch { }
    }
    return s;
  }
  function salvar(s) { try { localStorage.setItem(LS, JSON.stringify(s)); } catch (e) { console.warn("Armazenamento local cheio", e); } }
  const cacheGerado = {};
  function dadosDe(id, s) {
    if (s.dados[id]) return s.dados[id];
    if (!cacheGerado[id]) {
      const c = s.clientes.find((x) => x.id === id);
      if (!c) return null;
      cacheGerado[id] = id === "beta-servicos" ? gerar(c.id, c.nome, c.cnpj, c.origem, 0.55, 7, 0.75)
        : id === "alfa-distribuidora" ? gerar(c.id, c.nome, c.cnpj, c.origem, 1, 42, 0.25)
        : gerar(c.id, c.nome, c.cnpj, c.origem, 0.4, id.length * 13, 0.5);
    }
    return cacheGerado[id];
  }

  PB.demoGerar = gerar;

  PB.demoApi = async function (metodo, rota, corpo) {
    await new Promise((r) => setTimeout(r, 150));
    const s = store();
    const [path, qs] = rota.split("?");
    const q = Object.fromEntries(new URLSearchParams(qs || ""));
    const u = JSON.parse(sessionStorage.getItem("pb_sessao") || "null");
    const podeVer = (id) => u && (u.papel === "consultor" || u.clienteId === id);

    if (path === "/perfil") return u;
    if (path === "/clientes" && metodo === "GET") {
      return s.clientes.map((c) => {
        const d = dadosDe(c.id, s) || {};
        const fech = Object.entries(d.fechamentos || {}).sort();
        return { ...c, atualizadoEm: d.atualizadoEm, ultimoFechado: (fech.filter(([, v]) => v.status === "Fechado").at(-1) || [])[0] || null,
          mesesAbertos: fech.filter(([, v]) => v.status !== "Fechado").map(([m]) => m) };
      });
    }
    if (path === "/clientes" && metodo === "POST") {
      if (u?.papel !== "consultor") throw new Error("403");
      s.clientes.push(corpo); salvar(s); return { ok: true };
    }
    if (path === "/dados" && metodo === "GET") {
      if (!podeVer(q.cliente)) throw new Error("403 Sem permissão");
      return dadosDe(q.cliente, s);
    }
    if (path === "/dados" && metodo === "POST") {
      if (u?.papel !== "consultor") throw new Error("403");
      s.dados[corpo.clienteId] = corpo.dados; salvar(s); return { ok: true, publicadoEm: corpo.dados.atualizadoEm };
    }
    if (path === "/arquivos" && metodo === "GET") {
      if (!podeVer(q.cliente)) throw new Error("403");
      return (s.arquivos[q.cliente] || []).filter((a) => !q.pasta || a.pasta === q.pasta);
    }
    if (path === "/arquivos" && metodo === "POST") {
      if (u?.papel !== "consultor") throw new Error("403");
      (s.arquivos[corpo.clienteId] = s.arquivos[corpo.clienteId] || []).unshift({ nome: corpo.nome, pasta: corpo.pasta, tamanho: Math.round((corpo.conteudoBase64 || "").length * 0.75), modificado: new Date().toISOString() });
      salvar(s); return { ok: true };
    }
    if (path === "/claude") {
      if (!podeVer(corpo.clienteId)) throw new Error("403");
      const d = dadosDe(corpo.clienteId, s); const res = PB.resumoParaIA(d);
      const ll = res.dre.find((l) => l.linha === "(=) Resultado Líquido").valores; const rb = res.dre[0].valores;
      return {
        resposta: "Modo demonstração — esta resposta é simulada localmente. Após publicar no Azure com a chave da API do Claude configurada, as respostas serão geradas pelo Claude com base nos dados reais do cliente.\n\n" +
          `Resumo de ${res.cliente.nome} (${PB.fmt.mes(res.meses[0])} a ${PB.fmt.mes(res.meses.at(-1))}):\n` +
          `• Receita bruta acumulada: ${PB.fmt.moeda(rb.reduce((a, b) => a + b, 0))}\n` +
          `• Lucro líquido acumulado: ${PB.fmt.moeda(ll.reduce((a, b) => a + b, 0))}\n` +
          `• Último mês: receita ${PB.fmt.moeda(rb.at(-1))}, lucro ${PB.fmt.moeda(ll.at(-1))}\n\n` +
          `Sua pergunta: "${corpo.pergunta}"`
      };
    }
    const consultor = u?.papel === "consultor";
    const negar = () => { throw new Error("403 Acesso restrito aos consultores"); };

    if (path === "/clientes" && metodo === "PATCH") {
      if (!consultor) negar();
      const c = s.clientes.find((x) => x.id === corpo.id); Object.assign(c, corpo); salvar(s); return { ok: true };
    }
    /* Acessos */
    if (path === "/acessos") {
      if (!consultor) negar();
      s.usuarios = s.usuarios || {};
      if (metodo === "GET") return Object.entries(s.usuarios).filter(([, v]) => v.clienteId === q.cliente).map(([email, v]) => ({ email, ...v }));
      if (metodo === "POST") { s.usuarios[corpo.email.toLowerCase()] = { nome: corpo.nome, papel: "cliente", clienteId: corpo.clienteId, criadoEm: new Date().toISOString() }; salvar(s); return { ok: true, convite: !!corpo.enviarConvite }; }
      if (metodo === "DELETE") { delete s.usuarios[q.email]; salvar(s); return { ok: true }; }
    }
    if (path === "/acessos/redefinir") { if (!consultor) negar(); return { ok: true, simulado: true }; }

    /* Equipe de consultores */
    if (path === "/consultores") {
      if (!consultor) negar();
      s.usuarios = s.usuarios || {};
      const equipe = () => Object.entries(s.usuarios).filter(([, v]) => v.papel === "consultor");
      if (metodo === "GET") return equipe().map(([email, v]) => ({ email, ...v }));
      if (metodo === "POST") {
        const e = String(corpo.email || "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw new Error("400 E-mail inválido");
        if (s.usuarios[e] && s.usuarios[e].papel === "cliente") throw new Error("409 Este e-mail já é usuário de um cliente");
        s.usuarios[e] = { nome: corpo.nome, papel: "consultor", criadoEm: new Date().toISOString() }; salvar(s);
        return { ok: true, convite: !!corpo.enviarConvite, simulado: true };
      }
      if (metodo === "DELETE") {
        const e = String(q.email || "").toLowerCase();
        if (e === String(u.email).toLowerCase()) throw new Error("400 Você não pode remover o próprio acesso");
        if (equipe().length <= 1) throw new Error("400 É preciso manter ao menos um consultor");
        delete s.usuarios[e]; salvar(s); return { ok: true };
      }
    }
    if (path === "/consultores/redefinir") { if (!consultor) negar(); return { ok: true, simulado: true }; }

    /* IA */
    if (path === "/premissas") {
      const d = dadosDe(corpo.clienteId, s);
      const r = PB.projecao.interpretarLocal(corpo.mensagem, corpo.premissas, d);
      return { ...r, resposta: r.resposta + "\n\n(Modo demonstração: interpretação simplificada. Publicado no Azure, o Claude entende pedidos livres.)" };
    }
    if (path === "/benchmarks") {
      if (!consultor) negar();
      const c = s.clientes.find((x) => x.id === corpo.clienteId);
      return { texto: `Modo demonstração — conteúdo ilustrativo, sem pesquisa real.\n\nSetor: ${c.setor || "não informado"}\n\n• Margem bruta típica de distribuidores de equipamentos: verificar em fontes setoriais (ex.: estudos do Sebrae e IBGE — Pesquisa Anual de Comércio).\n• Prazo médio de recebimento no B2B: comparar com indicadores de crédito do Banco Central.\n• Acompanhar inflação de custos (IPCA/IGP-M) para reajustes de preço.\n\nPublicado no Azure com a chave do Claude, este botão pesquisa fontes confiáveis na web e traz os benchmarks com links.`, fontes: [{ titulo: "IBGE — Pesquisa Anual de Comércio", url: "https://www.ibge.gov.br/" }, { titulo: "Sebrae — Estudos setoriais", url: "https://sebrae.com.br/" }], em: new Date().toISOString() };
    }
    if (path === "/apresentacao") {
      if (!consultor) negar();
      return { ...PB.analise.conclusoesLocais(dadosDe(corpo.clienteId, s), corpo.meses), origem: "local" };
    }
    /* Conta Azul (simulado) */
    if (path === "/contaazul/status") return s.contaazul?.[q.cliente] || { conectado: false };
    if (path === "/contaazul/conectar-demo") { if (!consultor) negar(); (s.contaazul = s.contaazul || {})[corpo.clienteId] = { conectado: true, empresa: "Conta Azul (demonstração)", em: new Date().toISOString() }; salvar(s); return { ok: true }; }
    if (path === "/contaazul/desconectar") { if (!consultor) negar(); delete s.contaazul[corpo.clienteId]; salvar(s); return { ok: true }; }
    if (path === "/contaazul/sincronizar") {
      if (!consultor) negar();
      const d = dadosDe(corpo.clienteId, s);
      const lanc = d.lancamentos.filter((l) => l.competencia >= corpo.de && l.competencia <= corpo.ate).map((l, i) => ({ ...l, _linha: i + 1 }));
      const vendas = d.vendas.filter((v) => v.data.slice(0, 7) >= corpo.de && v.data.slice(0, 7) <= corpo.ate).map((v, i) => ({ ...v, _linha: i + 1 }));
      return { parcial: { lancamentos: lanc, vendas }, avisos: ["Modo demonstração: dados simulados a partir da base atual."] };
    }
    throw new Error("404 Rota de demonstração não encontrada: " + rota);
  };
})();
