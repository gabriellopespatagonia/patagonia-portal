# Patagonia Business: site e portal de clientes

Site institucional da Patagonia Business com dois portais:

| Área | Quem usa | O que tem |
|---|---|---|
| `index.html` | Público | Site institucional: serviços, método e contato |
| `login.html` | Clientes e consultores | Login com conta Microsoft (produção) ou usuários de demonstração (local) |
| `cliente/` | Cliente | **Visão geral** em dois blocos: KPIs de competência (faturamento, lucros bruto, operacional e líquido com % sobre o faturamento, composição de despesas e custos) e KPIs de caixa (saldo realizado × previsto, geração/queima de caixa livre). **Financeiro**: DRE, DFC, Fluxo de Caixa e Projeções, cada um com o botão *Resumo do período*, e um simulador de premissas por conversa com a IA. **Comercial**: vendas, clientes (curva ABC), produtos e serviços, vendedores e regiões. Também documentos e assistente de IA |
| `consultor/` | Consultor / BPO | Carteira com a **ficha de cada cliente**: situação dos dados e fechamento mensal, e-mails de acesso (adicionar, remover, enviar redefinição de senha), contexto e setor com pesquisa de benchmarks pelo Claude, exportação da planilha completa e da apresentação de resultados (PowerPoint/PDF). Também integração com o Conta Azul, importação, validação, plano de contas, modelos de planilha, SharePoint e assistente de IA |

---

## 1. Ver o site no computador (modo demonstração)

Abra o PowerShell na pasta do projeto e execute:

```bash
powershell -ExecutionPolicy Bypass -File servidor-local.ps1
```

Depois acesse **http://localhost:8080**. Os usuários de demonstração (senha `demo123`) são:

- `cliente@demo.com`: portal do cliente Alfa Distribuidora (origem Conta Azul)
- `cliente2@demo.com`: portal do cliente Beta Serviços (origem planilha)
- `consultor@demo.com`: área do consultor

No modo demonstração os dados são fictícios e tudo roda no navegador. As publicações ficam no `localStorage`. Para zerar, limpe os dados do site no navegador.

---

## 2. Arquitetura de produção

```
Navegador ──► Azure Static Web Apps (HTML/CSS/JS + login Microsoft)
                     │
                     ▼
              /api (Azure Functions, Node 20)
               ├── Microsoft Graph ──► SharePoint (repositório de dados e arquivos)
               └── API do Claude    ──► respostas e textos de relatório
```

- **Login e senha**: feitos pela Microsoft (Entra ID), com MFA e recuperação de senha incluídos. Nenhuma senha passa pelo site.
- **Permissões**: a API confere em `config/usuarios.json` (no SharePoint) quem é consultor e qual empresa cada cliente pode ver. Um cliente nunca acessa dados de outro.
- **Chaves secretas** (Graph e Claude) ficam só nas configurações do Azure, nunca no navegador.

### Estrutura no SharePoint

Crie um site (ex.: `PortalClientes`) e, na biblioteca *Documentos*, a pasta `Portal`:

```
Portal/
├── config/
│   ├── clientes.json      ← cadastro de clientes (modelo em sharepoint-modelo/)
│   └── usuarios.json      ← e-mail → papel e cliente (modelo em sharepoint-modelo/)
└── Clientes/
    └── <id-do-cliente>/
        ├── bruto/          ← arquivos originais importados (Conta Azul, planilhas)
        ├── publicado/
        │   ├── dados.json  ← base padronizada que alimenta o portal
        │   └── historico/  ← cada publicação fica guardada (auditoria)
        ├── relatorios/     ← PDFs e relatórios visíveis ao cliente
        └── contratos/
```

---

## 3. Publicar no Azure, passo a passo

### 3.1 Registrar o aplicativo para acessar o SharePoint
1. Portal Azure → **Microsoft Entra ID → Registros de aplicativo → Novo registro** (ex.: `Patagonia Portal API`).
2. Anote o **ID do aplicativo (cliente)** e o **ID do diretório (tenant)**.
3. **Certificados e segredos → Novo segredo do cliente**. Anote o valor.
4. **Permissões de API → Microsoft Graph → Permissões de aplicativo → `Sites.Selected`** → *Conceder consentimento do administrador*.
5. Dê acesso só ao site do portal (o `Sites.Selected` exige isso). No Graph Explorer, como administrador:
   ```
   POST https://graph.microsoft.com/v1.0/sites/{site-id}/permissions
   { "roles": ["write"], "grantedToIdentities": [{ "application": { "id": "<ID do aplicativo>", "displayName": "Patagonia Portal API" } }] }
   ```
   Se preferir algo mais simples, use `Sites.ReadWrite.All`. Funciona, mas libera todos os sites do tenant.

### 3.2 Criar o Static Web App
1. Coloque esta pasta em um repositório GitHub ou Azure DevOps.
2. Portal Azure → **Static Web Apps → Criar**. Plano: **Free** serve para começar.
3. Configuração do build: *App location* `/`, *Api location* `api`, *Output location* (vazio).
4. Após criar, vá em **Configurações → Variáveis de ambiente** e adicione as chaves de `api/local.settings.example.json`:
   `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `SHAREPOINT_HOST`, `SHAREPOINT_SITE_PATH`, `SHAREPOINT_PASTA_RAIZ`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`.
5. (Opcional) **Domínios personalizados** → `portal.patagoniabusiness.com.br`.

### 3.3 Chave do Claude
Crie a chave em **console.anthropic.com → API Keys** e coloque em `ANTHROPIC_API_KEY`. O modelo padrão é `claude-opus-5-5`. Para reduzir custo, troque `CLAUDE_MODEL` por `claude-sonnet-5-5`.

> **Tempo limite**: as funções incluídas no Static Web Apps (*managed functions*) respondem em até ~45 segundos. A pesquisa de benchmarks (busca na web) e as conclusões da apresentação podem passar disso. Se ocorrer *timeout*, crie um **Azure Functions** próprio (plano Flex Consumption), publique a pasta `api` nele e vincule-o em *Static Web App → APIs → Vincular*. Isso exige o plano Standard do Static Web Apps.

### 3.4 E-mails (convite e redefinição de senha)
1. No registro de aplicativo do item 3.1, adicione a permissão de aplicativo **Microsoft Graph → `Mail.Send`** e conceda o consentimento.
2. Crie uma caixa para o portal (ex.: `portal@patagoniaconsultoria.com.br`) e preencha `MAIL_REMETENTE` e `PORTAL_URL`.
3. (Recomendado) Restrinja o app a essa caixa com uma *Application Access Policy* no Exchange Online:
   `New-ApplicationAccessPolicy -AppId <ID do app> -PolicyScopeGroupId portal@... -AccessRight RestrictAccess`
4. O botão de redefinição envia ao usuário os links oficiais de troca de senha da Microsoft (conta pessoal e corporativa). O portal nunca recebe nem guarda senhas.

### 3.5 Integração com o Conta Azul
1. Crie um aplicativo em **developers.contaazul.com** (Área do desenvolvedor) e cadastre a URL de retorno `https://<seu-portal>/api/contaazul/callback`.
2. Preencha as variáveis `CONTAAZUL_*` de `api/local.settings.example.json`.
3. **Confira na documentação oficial** os endereços de autorização e token e os caminhos de contas a receber, contas a pagar e vendas. Os valores padrão do código seguem a API v2, mas não pude validá-los sem credenciais. Qualquer diferença se corrige pelas variáveis `CONTAAZUL_AUTH_URL`, `CONTAAZUL_TOKEN_URL`, `CONTAAZUL_API_URL` e `CONTAAZUL_PATH_*`, sem mexer no código.
4. Na área do consultor → *Importar e publicar*, clique em **Conectar ao Conta Azul** e faça login com o usuário do cliente. Depois, em **Buscar lançamentos e vendas**, os dados passam pela mesma validação e prévia antes de publicar.
5. Sem integração, continua valendo a exportação do **Extrato de movimentações** (ou de *Contas a receber* e *Contas a pagar* separadas) do Conta Azul.

Os tokens do Conta Azul ficam em `Clientes/<id>/config/contaazul.json`, uma pasta que o cliente final não acessa.

### 3.6 Equipe de consultores
Em **Área do consultor → Administração → Equipe de consultores** você cria acessos de consultor (com convite por e-mail opcional), envia a recuperação de senha e remove acessos. Ninguém consegue remover o próprio acesso, e o sistema sempre mantém pelo menos um consultor. Os consultores ficam em `config/usuarios.json` com `"papel": "consultor"`.

### 3.7 Cadastrar usuários
- Envie `sharepoint-modelo/config/usuarios.json` e `clientes.json` para `Portal/config/` e ajuste os e-mails.
- O botão **+ Novo cliente** da área do consultor cria a pasta no SharePoint e já cadastra o e-mail do usuário do cliente.
- **Login dos clientes**: o login Microsoft do Static Web Apps aceita contas corporativas e contas Microsoft pessoais. O cliente sem conta Microsoft cria uma gratuitamente com o próprio e-mail (em *Criar conta* na tela da Microsoft) e passa a entrar com e-mail e senha.
  Para uma tela de login com a marca Patagonia e cadastro só por convite, configure o **Microsoft Entra External ID** como provedor personalizado. Isso exige o plano Standard do Static Web Apps.

---

## 4. Estrutura padrão da DRE e do DFC e plano de contas

Todos os clientes usam a **mesma estrutura de DRE e de DFC**, definida em `assets/js/estrutura.js`. O servidor usa uma cópia idêntica em `api/src/lib/estrutura.js`: ao alterar uma, copie para a outra.

- **DRE**: Receita Bruta → Deduções → Receita Líquida → Custos Variáveis → Despesas Variáveis → Resultado Operacional Bruto (Margem de Contribuição) → Despesas Fixas → Resultado Operacional Líquido (EBITDA) → Depreciação e Amortização → EBIT → Resultado Não Operacional e Financeiro → Resultado Antes dos Impostos e Participações → Resultado Líquido → Distribuição de Lucros → Resultado Líquido Após Distribuições.
- **DFC**: Fluxo de Caixa Operacional (entradas e saídas por Deduções, Custos Variáveis, Despesas Variáveis e Despesas Fixas), Fluxo de Caixa de Financiamentos e Fluxo de Caixa de Investimentos.

Cada cliente tem o **próprio plano de contas**, com estas colunas:
- **Número da Conta**: código hierárquico, como 5, 5.1 ou 5.1.01.
- **Nome da Conta**.
- **Tipo da Conta**: Sintética ou Analítica.
- **Referência na Estrutura da DRE** e **Referência na Estrutura do DFC**.

Somente as contas **analíticas** são alocadas nas linhas das estruturas. As opções “Não compõe a DRE” e “Não compõe o DFC” servem, por exemplo, para empréstimos, compra de equipamentos e depreciação.

Em **Área do consultor → Plano de contas** você:
- baixa a **planilha padrão em branco**, com listas suspensas das linhas das estruturas e abas de consulta;
- baixa o **plano atual** do cliente;
- **carrega a planilha preenchida**, que é validada. A validação aponta número repetido, nome repetido, analítica sem referência, referência inexistente, conta superior ausente e contas dos lançamentos que ficariam fora do plano. Ela também mostra uma prévia da DRE antes de você substituir e publicar.

Nos lançamentos, a coluna **Conta Analítica** aceita o nome ou o número da conta analítica.

## 5. Padronização de dados (planilhas de coleta)

Todos os clientes, com ou sem Conta Azul, são convertidos para **um único modelo** com 5 tabelas. Ele está definido em `assets/js/core.js` (`PB.MODELO`):

| Aba | Para que serve |
|---|---|
| **Lancamentos** | Receitas e despesas realizadas e previstas. Base de DRE, DFC e Fluxo |
| **PlanoContas** | De-para de cada categoria para o grupo da DRE e a atividade da DFC |
| **Contas** | Contas bancárias e saldo inicial |
| **Vendas** | Uma linha por item vendido. Base do módulo Comercial |
| **Projecoes** | Orçamento mensal por cenário (Base, Otimista, Conservador) |

Na área do consultor, em **Modelos de planilha**, você baixa o modelo em branco, um exemplo preenchido ou a base atual de um cliente para revisar e reimportar.

**Clientes Conta Azul**: exporte o *Extrato de movimentações* (ou Contas a pagar/receber) e o *Relatório de vendas* em Excel e importe direto. As colunas são reconhecidas pelo nome. Categorias novas do Conta Azul aparecem na validação para você classificar (grupo DRE e atividade DFC) antes de publicar.

**Clientes sem Conta Azul**: o cliente (ou a equipe de BPO) preenche a planilha padrão, que é importada no formato *Planilha padrão Patagonia*.

---

## 5. Arquivos

```
index.html, login.html          site e login
cliente/index.html              portal do cliente
consultor/index.html            área do consultor
assets/css/style.css            visual (cores no topo do arquivo)
assets/js/config.js             ← CONFIGURAÇÕES (e-mail, WhatsApp, modo)
assets/js/core.js               modelo de dados, login e cálculos DRE/DFC/Fluxo/Comercial
assets/js/importacao.js         leitura de planilhas, Conta Azul, validação, geração de modelos
assets/js/analise.js            composição de custos/despesas, caixa livre, motor de projeção, resumos automáticos
assets/js/exportar.js           planilha completa (ExcelJS), PowerPoint (PptxGenJS) e PDF
assets/js/cliente.js            telas do cliente
assets/js/consultor.js          telas do consultor
assets/js/ui.js                 tabelas, gráficos, chat, documentos
assets/js/demo.js               dados fictícios do modo demonstração
api/                            Azure Functions (SharePoint + Claude)
staticwebapp.config.json        rotas protegidas e cabeçalhos de segurança
sharepoint-modelo/              arquivos iniciais de configuração do SharePoint
```

## 6. Próximos passos sugeridos
- Validar a integração do Conta Azul com as credenciais reais e ajustar os campos, se necessário.
- Fixar a versão de `@anthropic-ai/sdk` em `api/package.json` após o primeiro `npm install`.
- Relatório mensal em PDF gerado automaticamente e salvo em `relatorios/`.
