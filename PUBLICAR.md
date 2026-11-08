# Roteiro de publicação — Patagonia Business

> **Situação atual**
> - Site criado no Azure: **https://green-wave-0e66b3310.8.azurestaticapps.net** (assinatura "Patagonia Portal", grupo `patagonia-portal`, plano Free).
> - Aplicativo do Entra ID: "Patagonia Portal API".
>   - ID do aplicativo (cliente): `0dfe4a5a-8360-4b3a-9188-54ae016e8e07`
>   - ID do diretório (locatário): `26bc7af6-a1dd-4892-b994-48ccb40c4564`
> - A publicação é feita pelo GitHub Actions (`.github/workflows/azure-static-web-apps.yml`). Ela exige o segredo `AZURE_STATIC_WEB_APPS_API_TOKEN` no repositório.

## Já está pronto
- **Código** em um repositório Git local, com o primeiro commit. O `.gitignore` impede o envio de arquivos de segredo.
- **SharePoint**, no site **PatagoniaBusiness.BPOFinanceiro → Documentos Compartilhados → Portal**:
  - `config/usuarios.json`: Gabriel Lopes como consultor;
  - `config/clientes.json`: lista vazia, os clientes são cadastrados pelo portal;
  - `Clientes/`: onde o portal cria a pasta de cada cliente.

Os passos abaixo dependem do seu login, de cobrança ou de chaves secretas. Por isso precisam ser feitos por você.

---

## 1. GitHub (cerca de 5 min)
1. Entre em **github.com** e crie uma conta, se ainda não tiver.
2. Clique em **New repository**:
   - nome: `patagonia-portal`;
   - visibilidade: **Private**;
   - **não** marque "Add a README".
3. Copie o endereço do repositório, algo como `https://github.com/SEU-USUARIO/patagonia-portal.git`, e me envie. Eu faço o envio do código. Uma janela de login do GitHub vai abrir para você entrar.

## 2. Chave do Claude (cerca de 3 min)
1. Entre em **console.anthropic.com**, crie a conta e cadastre a forma de pagamento em **Billing**.
2. Em **API Keys → Create Key**, crie a chave com o nome "Portal Patagonia".
3. Guarde a chave em um lugar seguro, sem enviar por e-mail ou chat. Você vai colá-la no passo 5.

## 3. Permissão de acesso ao SharePoint e ao e-mail (cerca de 10 min, conta de administrador)
1. Entre em **portal.azure.com** e abra **Microsoft Entra ID → Registros de aplicativo → Novo registro**.
   - Nome: `Patagonia Portal API`. Tipo: *Somente contas deste diretório*. Clique em **Registrar**.
2. Na tela do aplicativo, anote:
   - **ID do aplicativo (cliente)**;
   - **ID do diretório (locatário)**.
3. Abra **Certificados e segredos → Novo segredo do cliente**, com validade de 24 meses, e copie o **Valor** na hora.
4. Abra **Permissões de API → Adicionar → Microsoft Graph → Permissões de aplicativo** e marque:
   - `Sites.ReadWrite.All`;
   - `Mail.Send`.
5. Clique em **Conceder consentimento do administrador para Patagonia Consultoria**.

> Para restringir o aplicativo apenas ao site BPO Financeiro, troque `Sites.ReadWrite.All` por `Sites.Selected` e conceda acesso só a esse site. O passo a passo está no README, seção 3.1.

## 4. Caixa de envio dos e-mails do portal (opcional)
- Para convites e recuperação de senha, o ideal é uma caixa própria, como `portal@patagoniaconsultoria.com.br`.
- Para começar, dá para usar a sua: `gabriel.lopes@patagoniaconsultoria.com.br`.

## 5. Criar o site no Azure (cerca de 10 min)
1. No **portal.azure.com**, pesquise **Static Web Apps → Criar**.
   - **Grupo de recursos:** crie `patagonia-portal`.
   - **Nome:** `patagonia-portal`. **Plano:** Free.
   - **Origem:** GitHub. Faça login e escolha o repositório `patagonia-portal`, branch `main`.
   - **Predefinições de build:** Custom.
   - **Local do aplicativo:** `/`. **Local da API:** `api`. **Local de saída:** deixe vazio.
2. Clique em **Revisar + criar → Criar**. Em poucos minutos o site fica no ar, em um endereço `https://….azurestaticapps.net`.
3. No Static Web App, abra **Configurações → Variáveis de ambiente** e adicione:

| Nome | Valor |
|---|---|
| `GRAPH_TENANT_ID` | ID do diretório (passo 3) |
| `GRAPH_CLIENT_ID` | ID do aplicativo (passo 3) |
| `GRAPH_CLIENT_SECRET` | valor do segredo (passo 3) |
| `SHAREPOINT_HOST` | `patagoniaconsultoriarp.sharepoint.com` |
| `SHAREPOINT_SITE_PATH` | `/sites/PatagoniaBusiness.BPOFinanceiro` |
| `SHAREPOINT_PASTA_RAIZ` | `Portal` |
| `MAIL_REMETENTE` | caixa do passo 4 |
| `PORTAL_URL` | endereço do site (`https://….azurestaticapps.net`) |
| `ANTHROPIC_API_KEY` | chave do passo 2 |
| `CLAUDE_MODEL` | `claude-opus-5-5` |

4. Clique em **Aplicar**.

## 6. Primeiro teste
1. Abra o endereço do site e entre em **Área do cliente → Consultor / BPO → Entrar com conta Microsoft**, com `gabriel.lopes@patagoniaconsultoria.com.br`.
2. Cadastre um cliente de teste, importe uma planilha e clique em **Publicar**.
3. Abra o **Assistente IA** e faça uma pergunta.
4. Se algo der erro, copie a mensagem e o registro em **Static Web App → Funções (APIs) → Logs / Application Insights** e me envie.

## Depois
- **Domínio próprio:** em Static Web App → **Domínios personalizados**, por exemplo `portal.patagoniabusiness.com.br`.
- **Conta Azul:** seção 3.5 do README.
- **Alterações futuras:** cada envio de código ao GitHub (`git push`) publica o site de novo, automaticamente.
