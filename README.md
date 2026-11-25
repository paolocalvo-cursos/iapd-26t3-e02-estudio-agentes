# Estúdio — time visual de agentes de IA

Engenharia reversa (Aula 15, "REA is back") de um post do LinkedIn que mostra o **Estúdio**:
um painel onde você faz o pedido uma vez e um time de agentes decide entre si quem pega cada parte.
Construído só a partir do post e do print (não há código público do original).

## Rodar

Precisa de Node.js 20+.

```bash
npm install
npm start      # abre o app (na primeira vez o Electron baixa o próprio executável, ~100 MB)
npm test       # 38 testes das regras R1–R30
```

Depois, dê a cada IA uma forma de acesso: chave de API ou CLI logada. Sem assinatura nem crédito,
use o **modo gratuito**, que precisa só de uma chave grátis do Gemini.

## Roteiro falso (botão 🎬)

Repete a Demo 1 da Aula 16 sem chamar nenhum modelo e sem gravar nada no disco: serve para apresentar a tela e
conferir a orquestração sem custo. Ligue o 🎬 e aperte Enter com a caixa vazia (o pedido padrão é
"Crie uma página de status com um endpoint /health"). A sequência:

1. **Pedido**: a rodada de propostas.
2. **Plano**: o Maestro chama Chevron e Pixel, com o Revisor no final.
3. **Execução**: os dois trabalham em paralelo.
4. **Testes**: o portão falha (`text/plain` em vez de JSON), o trabalho volta só para o Chevron, o portão passa e o Revisor aprova.
5. **Decisão**: a lista de arquivos para você ler.

As falas ficam em `src/roteiro.mjs` (R31). O painel 🔑 e o "Testar agente" continuam usando os provedores de verdade.

## Manter ou descartar (passo 5)

Antes de cada pedido, o Estúdio tira uma foto da pasta do projeto. No fim, o card **Decisão** mostra cada arquivo
criado (`+`), alterado (`~`) ou removido (`−`), com o diff. A partir daí você escolhe:

- **Manter**: fica tudo como os agentes deixaram.
- **Descartar** (pede confirmação): apaga o que foi criado e devolve os arquivos alterados ou removidos ao estado de antes do pedido.

O descarte não mexe em `node_modules`, `.git`, `dist` e nas outras pastas ignoradas, nem em arquivos com mais de 2 MB,
que o card avisa. Mandar um pedido novo sem decidir mantém a rodada anterior. Regras R32 a R35.

## Chaves e provedores (botão 🔑)

- **Colar a chave pela tela:** o botão 🔑 lista os provedores (Anthropic, Gemini, OpenAI, Groq, OpenRouter e Ollama).
  A chave fica cifrada no cofre do sistema (Keychain, DPAPI ou chaveiro do Linux) e vale mais que a do `.env`.
  A tela só mostra o começo e os 4 últimos caracteres. Sem cofre disponível, o app não guarda: use o `.env`.
- **Testar:** confere a chave e o modelo consultando a lista de modelos, sem gerar texto (não custa tokens).
  Erros aparecem em português: chave inválida, modelo inexistente, cota, sem conexão.
- **Provedor e modelo por agente:** duplo clique no mascote abre o cartão do agente. **Testar agente** faz uma
  chamada de verdade pelo mesmo caminho dos pedidos e mostra falta de crédito, login vencido e modelo errado.

## Portão de testes

Quem roda os testes é o Estúdio, não o agente que escreveu o código.

1. Depois da etapa de execução, se algum arquivo mudou, o Estúdio roda o comando de teste do projeto
   (`npm test`, `node --test` ou `pytest`; troque com `COMANDO_TESTE` no `.env`). Limite: 2 minutos.
2. Reprovou: o Maestro devolve para quem escreveu o arquivo citado na falha (ou para todos que executaram),
   com só as linhas de falha. Até 3 devoluções; depois o time desiste e o Revisor é avisado.
3. Mudou arquivo e não há teste: reprova e pede um teste.
4. Se o `test` do `package.json` parecer perigoso (`rm -rf`, `curl | sh`…), ele não roda sozinho: aparece
   para você aprovar.

### Testes isolados (caixa de areia)

O código de teste é escrito pelos agentes, então roda isolado no **bubblewrap** (Linux):

| O teste… | |
|---|---|
| lê e escreve na pasta do projeto | sim |
| usa um `/tmp` próprio, apagado no fim | sim |
| lê o sistema (`/usr`, `/etc`) e o Node | só leitura |
| vê a sua pasta pessoal (`~/.ssh`, `~/.config`, cofre de chaves) | não: ela não existe lá dentro |
| acessa a internet | não (`PORTAO_REDE=liberada` libera) |
| recebe chaves de API do ambiente | não: o ambiente é zerado |

Antes do primeiro uso, uma sonda prova que a caixa bloqueia de verdade. Sem bubblewrap (`sudo apt install bubblewrap`),
no Windows ou no macOS, o portão **não roda** e a tela explica; `PORTAO_ISOLAMENTO=desligado` roda sem isolamento,
por sua conta. Os comandos do botão **Executar** continuam fora da caixa: só rodam com o seu clique.

`PORTAO_TESTES=desligado` no `.env` pula o portão.

## Modo gratuito (sem assinatura)

Uma chave no `.env` liga o modo gratuito: **todos os agentes passam a usar o Gemini grátis**
(`gemini-3.5-flash-lite`). As chaves pagas e as CLIs são ignoradas, então nada é cobrado.

1. Crie uma chave em https://aistudio.google.com/app/apikey **sem ativar faturamento** no projeto.
   Com faturamento ativo, o Google cobra mesmo nesse modo.
2. Configure o `.env`:

   ```bash
   cp .env.example .env
   ```

   Preencha `GEMINI_API_KEY=` e troque para `MODO_GRATUITO=true`.

3. O topo do app mostra `modo gratuito · todos os agentes no gemini-3.5-flash-lite`, e cada
   resposta ganha o selo **Gemini grátis**.

Limites e cuidados:
- O Flash-Lite tem a maior cota grátis, na casa de 15 pedidos por minuto e 500 por dia. O Google
  pode mudar esses números; veja a sua cota no AI Studio.
- Cada rodada do time faz de 3 a 4 pedidos.
- Se a cota acabar, o agente avisa. Ela volta à meia-noite do Pacífico.
- No plano grátis, o Google pode usar o texto enviado para melhorar os produtos dele: não mande
  código ou dados sigilosos.
- Por que só o Gemini: as APIs da Anthropic e da OpenAI não têm plano gratuito contínuo, apenas
  créditos de teste.

Para voltar ao normal, use `MODO_GRATUITO=false`.

## Como cada IA é acessada

Com o modo gratuito desligado, o app escolhe sozinho, a cada pedido e para cada provedor:

1. **Chave de API no `.env`** → usa a API oficial pelo SDK (cobrança por uso).
2. **Sem chave** → usa a CLI logada na sua assinatura (sem cobrança por uso).
3. **Nenhum dos dois** → o agente responde dizendo o que falta.

| Agentes | Provedor | Chave no `.env` | Modelo padrão | CLI alternativa |
|---|---|---|---|---|
| Pixel, Chevron (e Maestro, se você falar direto com ele) | claude (Anthropic) | `ANTHROPIC_API_KEY` | `claude-opus-5-5` | `claude` |
| Scout | gemini (Google) | `GEMINI_API_KEY` | `gemini-3.8-flash` | `gemini` |
| Revisor | codex (OpenAI) | `OPENAI_API_KEY` | `gpt-5.5` | `codex` |

O topo do app mostra o modo de cada provedor, por exemplo `claude: CLI · gemini: API · codex: CLI`.

### Por chave de API

```bash
cp .env.example .env   # preencha só as chaves que quiser
```

- Os modelos podem ser trocados no próprio `.env` (`ANTHROPIC_MODEL`, `GEMINI_MODEL`, `OPENAI_MODEL`).
- O `.env` é relido a cada pedido, então não precisa reiniciar o app.
- O `.env` está no `.gitignore`. Nunca faça commit dele nem cole chaves em chats.

### Por CLI (assinatura)

Instale e faça login uma vez. Os logins abrem o navegador.

```bash
npm install -g @anthropic-ai/claude-code   # depois: claude  (escolha "Claude account with subscription")
npm install -g @google/gemini-cli          # depois: gemini  (/auth → "Login with Google")
npm install -g @openai/codex               # depois: codex login  (conta ChatGPT Plus ou superior)
```

Para conferir:

```bash
claude -p "diga oi"
```

```bash
gemini --skip-trust -p "diga oi"
```

```bash
codex exec --skip-git-repo-check "diga oi"
```

Abra o app pelo terminal (`npm start`). Assim ele herda o `PATH` onde as CLIs foram instaladas.

## Pasta do projeto e arquivos

- O botão **📁** no topo escolhe a pasta onde os agentes trabalham. Sem escolha, usa `~/estudio-projetos`.
- **Quem escreve:** quem executa (Pixel, Chevron e agentes criados por você) grava direto na pasta.
  Scout e Revisor nunca escrevem.
- **Pela CLI:** a própria IA edita os arquivos. Pesquisa e revisão rodam em modo só leitura
  (`claude` só com Read/Grep/Glob, `gemini --approval-mode plan`, `codex --sandbox read-only`).
- **Pela API (e no modo gratuito):** a IA devolve cada arquivo num bloco ```` ```arquivo:caminho ```` e o Estúdio grava.
  Caminhos absolutos ou com `..` são recusados. Nesse modo, Scout e Revisor não leem a pasta:
  trabalham com o que o time entregou na rodada.
- No fim da rodada, o cartão **Arquivos criados ou alterados** abre cada arquivo ou a pasta.

## O que dá para fazer

- **Pedir ao Time:**
  1. Rodada de propostas, em que cada agente diz se pega ou passa, com % de confiança.
  2. O Maestro monta o time: pesquisa → execução em paralelo → revisão.
  3. Cada agente entrega e passa o resultado para o próximo.
  
  A rodada e a montagem do time são **regras do app** (palavras-chave de cada papel, ver
  `REGRAS.md`): não gastam chamada de IA.
- **Falar com um agente só:** clique no mascote ou no chip acima da caixa de texto.
- **Comandos sugeridos** em blocos ```bash viram o botão **Executar**, que roda na pasta do projeto
  com limite de 60 s. Os sensíveis (`rm -rf`, `sudo`, `git push`, `curl | sh`, `DROP TABLE`…)
  pedem **Aprovar / Negar**.
- **＋** cria um agente (nome, papel, personalidade, palavras-chave, provedor, visual e cor).
  Botão direito no mascote remove; o Maestro não pode ser removido.
- **Conversas separadas** com histórico (☰ e ＋ no painel), guardadas no `localStorage`.
- Cada agente tem até 5 minutos por resposta.

## Estrutura

| Arquivo | Papel |
|---|---|
| `REGRAS.md` | As regras R1–R35, com entrada, saída e origem. |
| `.env.example` | Modelo do `.env`: modo gratuito, chaves e modelos de cada IA. |
| `src/nucleo.mjs` | **Todas as regras.** Funções puras, sem DOM, Electron nem rede. |
| `src/renderer.mjs` | Tela: mascotes em SVG, palco, rodada de propostas, chat. |
| `src/main.js` | Janela, pasta do projeto, `.env`, chamadas por API (SDKs oficiais) ou CLI, gravação de arquivos. |
| `src/preload.js` | Ponte segura entre a tela e o processo principal. |
| `src/roteiro.mjs` | Ponte falsa do roteiro (R31): mesma interface do `preload.js`, com falas prontas. |
| `test/nucleo.test.mjs` | Testes das regras do núcleo. |
| `test/roteiro.test.mjs` | Testes do roteiro falso: time da Demo 1, falha, devolução, aprovação e descarte. |
| `test/decisao.test.mjs` | Testes da foto, do diff e do plano de descarte (Manter/Descartar). |

## Fora do escopo (citado no post)

- Voz.
- Deploy automático na VPS.
- Memória de projeto.
- Plano aprovado antes de editar arquivos.
- Isolamento dos testes no Windows e no macOS (lá o portão não roda sem `PORTAO_ISOLAMENTO=desligado`).
- Revisão linha a linha (diff) dos arquivos alterados. Hoje o app lista os arquivos e os abre.
