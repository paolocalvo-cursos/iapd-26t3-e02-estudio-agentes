# Regras do Estúdio

Origem: texto do post (Fernando Nogueira, LinkedIn) e o print do slide da atividade.

| # | Regra | Entrada → saída | Origem |
|---|---|---|---|
| R1 | Time padrão: Maestro (coordenador, Claude), Pixel (front-end), Chevron (back-end, Claude), Scout (pesquisa, Gemini), Revisor (revisão, Codex). | — | post |
| R2 | Texto é comparado sem acento e sem caixa. | `"Página"` → `"pagina"` | — |
| R2b | Palavra-chave casa com a palavra inteira (ou plural); chaves de 5+ letras são radicais e casam com o começo da palavra. `cor` casa com "cores", não com "corrija". | pedido, chave → `true/false` | bug achado nos testes |
| R3 | Proposta: 10% + 30% por palavra do papel no pedido (máx. 95%); aceita com ≥ 40%. O coordenador sempre passa ("Coordeno, mas não sou eu quem executa isso"). | pedido → `{confianca, aceita, fala}` | print |
| R4 | Rodada de propostas: todos respondem, da maior para a menor confiança. | pedido → lista ordenada | post + print |
| R5 | Maestro monta o time em etapas: pesquisa → execução (paralela) → revisão. Revisor entra sempre que alguém executou. Se ninguém aceitar, o de maior confiança assume. | propostas → `etapas` | post |
| R6 | Fala do Maestro: "Fica com Chevron e Pixel. Revisor, acompanha no final." | etapas → texto | print |
| R7 | Comandos sensíveis pedem aprovação na tela. | comando → `true/false` | post |
| R8 | Comandos sugeridos são lidos dos blocos ```bash da resposta. | texto → `[{comando, sensivel}]` | — |
| R9 | Cada agente recebe papel, personalidade, pedido, o que as etapas anteriores entregaram e como lidar com arquivos (CLI ou API). | → prompt | post |
| R10 | Estados: disponível, pensando, trabalhando, concluído; topo mostra "N de M trabalhando". | | print |
| R11 | Criar agente pelo painel (nome único, papel obrigatório, provedor/visual/cor); o coordenador não pode ser removido. | | post |
| R12 | Conversas separadas; o título é a primeira pergunta (até 60 caracteres). | | post |
| R13 | Só quem executa (não coordenador, pesquisa ou revisão) escreve na pasta do projeto. | agente → `true/false` | post |
| R14 | No fim da rodada, lista os arquivos alterados desde o início, ignorando `node_modules`, `.git`, `dist`… | arquivos → caminhos | post |
| R15 | Lê o `.env`: ignora comentários e chaves vazias, aceita aspas e `export`. | texto → objeto | — |
| R16 | (modo gratuito desligado) Chave no `.env` → API; sem chave e com CLI → CLI; nenhum → sem acesso. | provedor → `api/cli/null` | pedido do time |
| R17 | Pela API, blocos ```` ```arquivo:caminho ```` viram arquivos; caminho absoluto ou com `..` é recusado. | texto → arquivos | — |
| R18 | `MODO_GRATUITO=true` (ou sim, 1, on) no `.env` manda **todos** os agentes para o Gemini grátis com a `GEMINI_API_KEY`; chaves pagas e CLIs são ignoradas. Sem a chave do Gemini, nenhum agente roda. | `.env` → `gratis/null` | pedido do time |
| R19 | Catálogo: claude, gemini e codex (API oficial e CLI); groq, openrouter e ollama (API compatível com a da OpenAI, sem CLI). Ollama não usa chave. | provedor → como acessar | pedido do time |
| R20 | Chave digitada na tela: recusa vazia, com espaço ou curta; prefixo diferente só avisa. A tela só vê a máscara (`sk-ant-…a3f9`). | chave → `{ok, erro, aviso}` | pedido do time |
| R21 | Origem da chave: cofre do sistema (tela) → `.env` → CLI (R16). Sem cofre de verdade, o app não guarda e orienta usar o `.env`. | provedor → `{valor, fonte}` | pedido do time |
| R22 | Erro do provedor vira texto em português: chave, crédito, permissão, modelo, cota, conexão, tempo, serviço. Crédito vem antes de cota (OpenAI responde 429 `insufficient_quota`). | erro → `{tipo, texto}` | pedido do time |
| R23 | Cada agente tem provedor e modelo próprios (cartão do agente); modelo: cartão → `.env` → padrão do catálogo. | agente → modelo | pedido do time |
| R24 | Portão escolhe o comando de teste: `COMANDO_TESTE` do `.env` → `test` do `package.json` (o padrão do `npm init` não conta) → `*.test.js` ou `test/` (`node --test`) → `test_*.py` (pytest). Script perigoso (R7) não roda sozinho: pede aprovação. | projeto → `{comando, origem, sensivel}` | muvuca |
| R25 | O agente que corrige recebe só as linhas de falha e o placar (até 40 linhas), sem cores. | saída → resumo | caveman |
| R26 | Depois do portão: passou/pulou → segue; falhou, tempo esgotado ou sem teste → devolve até 3 vezes; depois desiste e avisa o Revisor. | situação, rodada → `seguir/devolver/desistir` | muvuca |
| R27 | O trabalho volta para quem escreveu o arquivo citado na falha; sem citação, para todos que executaram. | resumo, autoria → agentes | muvuca |
| R28 | A devolução diz a tentativa, o comando e o resumo, e proíbe apagar ou enfraquecer testes. | resultado → mensagem | muvuca |

