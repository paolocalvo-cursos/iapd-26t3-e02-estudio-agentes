// Núcleo do Estúdio: todas as regras. Funções puras, sem DOM, Electron nem rede.

// ---------- R1: o time padrão ----------
// Cada agente tem papel, provedor (qual IA está por trás) e as palavras que o fazem
// querer pegar uma tarefa na rodada de propostas.
export const TIME_PADRAO = Object.freeze([
  {
    id: 'maestro', nome: 'Maestro', papel: 'Coordenador', provedor: 'claude', forma: 'bloco', cor: '#e2795b',
    coordenador: true, palavras: [],
    personalidade: 'Calmo e direto. Divide o trabalho e não executa tarefas sozinho.',
  },
  {
    id: 'pixel', nome: 'Pixel', papel: 'Front-end', provedor: 'claude', forma: 'bloco', cor: '#e7b866',
    palavras: ['tela', 'pagina', 'visual', 'css', 'html', 'botao', 'layout', 'interface', 'front', 'bonit',
      'componente', 'design', 'cor', 'formulario', 'acessivel', 'responsiv', 'dashboard'],
    personalidade: 'Detalhista com o visual e com acessibilidade. Fala com entusiasmo.',
  },
  {
    id: 'chevron', nome: 'Chevron', papel: 'Back-end', provedor: 'claude', forma: 'bloco', cor: '#e88a5c',
    palavras: ['endpoint', 'api', 'rota', 'servidor', 'banco', 'health', 'back', 'backend', 'status', 'dados', 'sql',
      'autentica', 'json', 'login', 'cache', 'fila', 'webhook'],
    personalidade: 'Pragmático, um pouco ranzinza, obcecado por código que aguenta produção.',
  },
  {
    id: 'scout', nome: 'Scout', papel: 'Pesquisa', provedor: 'gemini', forma: 'estrela', cor: '#9a7cf0',
    palavras: ['pesquis', 'documentacao', 'referencia', 'compar', 'qual', 'quais', 'melhor', 'biblioteca', 'oficial',
      'como funciona', 'pesquisar', 'alternativa', 'padrao'],
    personalidade: 'Curioso. Sempre cita a fonte oficial.',
  },
  {
    id: 'revisor', nome: 'Revisor', papel: 'Revisão de código', provedor: 'codex', forma: 'nuvem', cor: '#3f7bf2',
    palavras: ['revis', 'bug', 'teste', 'testa', 'review', 'erro', 'seguranca', 'corrig', 'corrij', 'falha', 'vulnerab'],
    personalidade: 'Cético e cuidadoso. Procura o bug que ninguém viu.',
  },
]);

// ---------- R19: catálogo de provedores ----------
// claude, gemini e codex têm API oficial e CLI. Os demais falam a API compatível com a da OpenAI
// (endereço próprio, sem CLI). O Ollama roda no computador e não precisa de chave.
export const CATALOGO = Object.freeze({
  claude: { rotulo: 'Anthropic (Claude)', chave: 'ANTHROPIC_API_KEY', varModelo: 'ANTHROPIC_MODEL', modelo: 'claude-opus-5-5', cli: 'claude', prefixo: 'sk-ant-', site: 'https://platform.claude.com/settings/keys' },
  gemini: { rotulo: 'Google (Gemini)', chave: 'GEMINI_API_KEY', varModelo: 'GEMINI_MODEL', modelo: 'gemini-3.8-flash', cli: 'gemini', prefixo: 'AIza', site: 'https://aistudio.google.com/app/apikey' },
  codex: { rotulo: 'OpenAI (GPT)', chave: 'OPENAI_API_KEY', varModelo: 'OPENAI_MODEL', modelo: 'gpt-5.5', cli: 'codex', prefixo: 'sk-', site: 'https://platform.openai.com/api-keys' },
  groq: { rotulo: 'Groq (tem plano grátis)', chave: 'GROQ_API_KEY', varModelo: 'GROQ_MODEL', modelo: 'openai/gpt-oss-120b', compativel: true, baseUrl: 'https://api.groq.com/openai/v1', prefixo: 'gsk_', site: 'https://console.groq.com/keys' },
  openrouter: { rotulo: 'OpenRouter', chave: 'OPENROUTER_API_KEY', varModelo: 'OPENROUTER_MODEL', modelo: 'openrouter/auto', compativel: true, baseUrl: 'https://openrouter.ai/api/v1', prefixo: 'sk-or-', site: 'https://openrouter.ai/keys' },
  ollama: { rotulo: 'Ollama (local, sem chave)', chave: null, varModelo: 'OLLAMA_MODEL', varUrl: 'OLLAMA_BASE_URL', modelo: 'llama3.2', compativel: true, baseUrl: 'http://localhost:11434/v1', site: 'https://ollama.com/download' },
});

export const PROVEDORES = Object.freeze(Object.keys(CATALOGO));
export const PROVEDORES_CLI = Object.freeze(PROVEDORES.filter((p) => CATALOGO[p].cli));
export const FORMAS = Object.freeze(['bloco', 'estrela', 'nuvem']);
export const ESTADOS = Object.freeze(['disponivel', 'pensando', 'trabalhando', 'concluido']);

// ---------- R2: texto normalizado ----------
export function normalizar(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// ---------- R2b: palavra-chave casa com palavra inteira, não com pedaço ----------
// Chave com 5+ letras é radical e casa com o começo da palavra ("revis" → "revise", "revisão").
// Chave curta precisa da palavra inteira ou do plural ("cor" → "cor", "cores"; nunca "corrija").
// Chave com várias palavras ("como funciona") precisa delas em sequência.
export function palavrasDo(texto) {
  return normalizar(texto).split(/[^a-z0-9]+/).filter(Boolean);
}

function casaPalavra(palavra, chave, ultima) {
  if (palavra === chave || palavra === chave + 's' || palavra === chave + 'es') return true;
  return ultima && chave.length >= 5 && palavra.startsWith(chave);
}

export function casaChave(palavras, chave) {
  const partes = palavrasDo(chave);
  if (!partes.length) return false;
  for (let i = 0; i + partes.length <= palavras.length; i++) {
    if (partes.every((c, j) => casaPalavra(palavras[i + j], c, j === partes.length - 1))) return true;
  }
  return false;
}

// ---------- R3: proposta de um agente ----------
// Confiança: 10% de base + 30% por palavra do papel encontrada no pedido (máx. 95%).
// Aceita a partir de 40%. O coordenador nunca executa: só monta o time.
export const LIMIAR_ACEITE = 40;

export function proporAgente(agente, pedido) {
  const texto = normalizar(pedido);
  if (agente.coordenador) {
    return { id: agente.id, confianca: 15, aceita: false, fala: 'Coordeno, mas não sou eu quem executa isso.' };
  }
  const palavras = palavrasDo(texto);
  const acertos = agente.palavras.filter((p) => casaChave(palavras, p));
  const confianca = Math.min(95, 10 + acertos.length * 30);
  const aceita = confianca >= LIMIAR_ACEITE;
  return { id: agente.id, confianca, aceita, acertos, fala: falaDaProposta(agente, aceita) };
}

const FALAS = {
  pixel: ['Tela é comigo. Deixa bonito e acessível.', 'Nada de tela aqui, passo.'],
  chevron: ['Hmm. Isso aqui precisa de um endpoint decente.', 'Sem back-end nisso. Passo.'],
  scout: ['Vou atrás da referência oficial.', 'Se precisar de referência, estou aqui.'],
  revisor: ['Quero revisar isso de perto.', 'Nada para revisar ainda.'],
};

function falaDaProposta(agente, aceita) {
  const f = FALAS[agente.id];
  if (f) return aceita ? f[0] : f[1];
  return aceita ? `${agente.papel} é comigo.` : `Não é a minha área (${agente.papel}). Passo.`;
}

// ---------- R4: rodada de propostas ----------
// Todos os agentes respondem; a lista sai da maior confiança para a menor.
export function rodadaDePropostas(agentes, pedido) {
  return agentes.map((a) => proporAgente(a, pedido)).sort((x, y) => y.confianca - x.confianca);
}

// ---------- R5: o coordenador monta o time ----------
// Etapas em sequência; agentes na mesma etapa trabalham em paralelo.
//   1. pesquisa (Scout), se aceitou
//   2. quem executa (todos os que aceitaram, exceto pesquisa e revisão)
//   3. revisão (Revisor) sempre no final quando alguém mexeu em código
// Se ninguém aceitou, o de maior confiança que não é coordenador assume.
export function montarTime(agentes, propostas) {
  const porId = new Map(agentes.map((a) => [a.id, a]));
  const aceitos = propostas.filter((p) => p.aceita).map((p) => porId.get(p.id)).filter(Boolean);
  if (!aceitos.length) {
    const melhor = propostas.map((p) => porId.get(p.id)).find((a) => a && !a.coordenador);
    if (melhor) aceitos.push(melhor);
  }
  const ehPesquisa = (a) => a.papel === 'Pesquisa';
  const ehRevisao = (a) => a.papel === 'Revisão de código';
  const pesquisa = aceitos.filter(ehPesquisa);
  const execucao = aceitos.filter((a) => !ehPesquisa(a) && !ehRevisao(a));
  let revisao = aceitos.filter(ehRevisao);
  if (execucao.length && !revisao.length) revisao = agentes.filter(ehRevisao).slice(0, 1);
  const etapas = [pesquisa, execucao, revisao].filter((e) => e.length).map((e) => e.map((a) => a.id));
  return { etapas, mensagem: mensagemDoMaestro(etapas, porId) };
}

// ---------- R6: a fala do coordenador ----------
export function mensagemDoMaestro(etapas, porId) {
  const nome = (id) => porId.get(id)?.nome ?? id;
  const lista = (ids) => ids.map(nome).join(ids.length > 2 ? ', ' : ' e ').replace(/, ([^,]+)$/, ' e $1');
  if (!etapas.length) return 'Ninguém do time cobre isso. Reformula o pedido?';
  const partes = [];
  const revisor = etapas.length > 1 ? etapas[etapas.length - 1] : null;
  const ehRevisao = revisor && revisor.every((id) => porId.get(id)?.papel === 'Revisão de código');
  const meio = ehRevisao ? etapas.slice(0, -1) : etapas;
  meio.forEach((ids, i) => partes.push(i === 0 ? `Fica com ${lista(ids)}.` : `Depois, ${lista(ids)}.`));
  if (ehRevisao) partes.push(`${lista(revisor)}, acompanha no final.`);
  return partes.join(' ');
}

// ---------- R7: comando sensível pede aprovação ----------
const PADROES_SENSIVEIS = [
  /\brm\s+-[a-z]*[rf]/i, /\bsudo\b/i, /\bgit\s+push\b/i, /\bgit\s+reset\s+--hard\b/i, /\bnpm\s+publish\b/i,
  /\bchmod\s+(-R\s+)?777\b/i, /\b(curl|wget)\b[^|]*\|\s*(sh|bash)\b/i, /\bdrop\s+(table|database)\b/i,
  /\bmkfs\b/i, /\bdd\s+if=/i, /\bshutdown\b|\breboot\b/i, /:\(\)\s*\{/, /\bdocker\s+system\s+prune\b/i,
];

export function comandoSensivel(comando) {
  return PADROES_SENSIVEIS.some((r) => r.test(String(comando)));
}

// ---------- R8: comandos sugeridos numa resposta ----------
// Pega as linhas dos blocos ```bash / ```sh / ```shell e marca as sensíveis.
export function extrairComandos(texto) {
  const comandos = [];
  const bloco = /```(?:bash|sh|shell|console)\n([\s\S]*?)```/g;
  let m;
  while ((m = bloco.exec(String(texto)))) {
    for (const linha of m[1].split('\n')) {
      const cmd = linha.replace(/^\$\s*/, '').trim();
      if (cmd && !cmd.startsWith('#')) comandos.push({ comando: cmd, sensivel: comandoSensivel(cmd) });
    }
  }
  return comandos;
}

// ---------- R9: prompt de cada agente ----------
// O agente recebe o papel, a personalidade, o pedido e o que as etapas anteriores entregaram.
export function montarPrompt(agente, pedido, anteriores = [], { modo = 'cli' } = {}) {
  const contexto = anteriores.length
    ? '\n\nO que o time já entregou:\n' + anteriores.map((r) => `--- ${r.nome} (${r.papel}) ---\n${r.texto}`).join('\n\n')
    : '';
  const escreve = podeEscrever(agente);
  const pasta = modo === 'api' || modo === 'gratis'
    ? (escreve
      ? 'Para criar ou editar arquivos, devolva cada arquivo COMPLETO num bloco que começa com ```arquivo:caminho/relativo '
        + '(ex.: ```arquivo:index.html) e termina com ```. O Estúdio grava esses blocos na pasta do projeto.'
      : 'Você não acessa a pasta do projeto: trabalhe com o que o time entregou abaixo.')
    : (escreve
      ? 'Você trabalha direto na pasta do projeto (o diretório atual). Crie ou edite os arquivos que a sua parte precisa '
        + 'usando caminhos relativos ao diretório atual, sem pedir confirmação. No fim, liste os arquivos que criou ou alterou.'
      : 'Você só pode ler a pasta do projeto (o diretório atual). Abra e leia os arquivos que o time criou antes de responder.');
  return [
    `Você é ${agente.nome}, agente de ${agente.papel} num time de IAs chamado Estúdio.`,
    `Personalidade: ${agente.personalidade || 'objetiva.'}`,
    pasta,
    'Responda em português do Brasil. Fora dos arquivos, seja curto (até 15 linhas) e fale só da sua parte.',
    'Se sugerir comandos de terminal, coloque-os num bloco ```bash.',
    `\nPedido do usuário: ${pedido}${contexto}`,
  ].join('\n');
}

// ---------- R10: estados e barra de status ----------
export function trocarEstado(estados, id, novo) {
  if (!ESTADOS.includes(novo)) throw new Error(`Estado inválido: ${novo}`);
  return { ...estados, [id]: novo };
}

export function resumoStatus(agentes, estados) {
  const n = agentes.filter((a) => ['pensando', 'trabalhando'].includes(estados[a.id])).length;
  return `${n} de ${agentes.length} trabalhando`;
}

// ---------- R11: criar agente pelo painel ----------
export function criarAgente(agentes, dados) {
  const nome = String(dados.nome ?? '').trim();
  const papel = String(dados.papel ?? '').trim();
  if (!nome) throw new Error('O agente precisa de um nome.');
  if (!papel) throw new Error('O agente precisa de um papel.');
  const id = normalizar(nome).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!id || agentes.some((a) => a.id === id)) throw new Error(`Já existe um agente chamado ${nome}.`);
  const provedor = PROVEDORES.includes(dados.provedor) ? dados.provedor : 'claude';
  const forma = FORMAS.includes(dados.forma) ? dados.forma : 'bloco';
  const cor = /^#[0-9a-f]{6}$/i.test(dados.cor ?? '') ? dados.cor : '#7aa2f7';
  const palavras = String(dados.palavras ?? '').split(',').map((p) => normalizar(p).trim()).filter(Boolean);
  const modelo = validarModelo(dados.modelo);
  const novo = { id, nome, papel, provedor, forma, cor, palavras, personalidade: String(dados.personalidade ?? '').trim() };
  if (modelo) novo.modelo = modelo;
  return [...agentes, novo];
}

export function removerAgente(agentes, id) {
  const alvo = agentes.find((a) => a.id === id);
  if (!alvo || alvo.coordenador) return agentes;
  return agentes.filter((a) => a.id !== id);
}

// ---------- R12: conversas separadas, com histórico ----------
export function novaConversa(agora = Date.now()) {
  return { id: `c${agora}`, titulo: 'Nova conversa', criadaEm: agora, mensagens: [] };
}

export function adicionarMensagem(conversa, msg) {
  const titulo = conversa.mensagens.length === 0 && msg.autor === 'voce'
    ? encurtar(String(msg.texto), 60) : conversa.titulo;
  return { ...conversa, titulo, mensagens: [...conversa.mensagens, { ...msg, em: msg.em ?? Date.now() }] };
}

function encurtar(texto, max) {
  return texto.length > max ? texto.slice(0, max - 1) + '…' : texto;
}

// ---------- R13: quem pode escrever na pasta do projeto ----------
// Quem executa (front, back, agentes criados) edita os arquivos direto na pasta.
// Coordenador, pesquisa e revisão só leem.
export function podeEscrever(agente) {
  return !agente.coordenador && agente.papel !== 'Pesquisa' && agente.papel !== 'Revisão de código';
}

// ---------- R14: arquivos que a rodada criou ou alterou ----------
const IGNORAR = new Set(['node_modules', '.git', 'dist', 'build', '.cache', '.next', '__pycache__', '.venv']);

export function ignorarCaminho(nome) {
  return IGNORAR.has(nome);
}

export function arquivosAlterados(arquivos, desde) {
  return arquivos.filter((a) => a.mtimeMs >= desde).map((a) => a.caminho).sort();
}

// ---------- R15: chaves do arquivo .env ----------
// Só as chaves com valor entram; vazio = a CLI usa o login da assinatura.
export function lerEnv(texto) {
  const env = {};
  for (const linha of String(texto ?? '').split(/\r?\n/)) {
    const m = linha.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || linha.trim().startsWith('#')) continue;
    const valor = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (valor) env[m[1]] = valor;
  }
  return env;
}

// ---------- R16: cada IA usa a sua chave de API; sem chave, a CLI logada ----------
export const CHAVE_DO_PROVEDOR = Object.freeze(Object.fromEntries(PROVEDORES.map((p) => [p, CATALOGO[p].chave])));

// No modo gratuito (R18) todos os agentes vão para o Gemini grátis e nada pago é usado.
// `chaves` = nomes das variáveis com valor, venham do cofre (R21) ou do .env.
export function modoDoProvedor(provedor, chaves, clis, gratuito = false) {
  if (gratuito) return chaves.includes(CHAVE_DO_PROVEDOR.gemini) ? 'gratis' : null;
  const info = CATALOGO[provedor];
  if (!info) return null;
  if (!info.chave || chaves.includes(info.chave)) return 'api';
  if (info.cli && clis[provedor]) return 'cli';
  return null;
}

// ---------- R20: chave digitada na tela ----------
// Erro: vazia, com espaço no meio ou curta demais. Prefixo diferente do esperado é só aviso,
// porque os formatos mudam e a pessoa pode estar usando um gateway.
export function validarChave(provedor, chave) {
  const info = CATALOGO[provedor];
  if (!info) return { ok: false, erro: `Provedor desconhecido: ${provedor}` };
  if (!info.chave) return { ok: false, erro: `${info.rotulo} não usa chave.` };
  const c = String(chave ?? '').trim();
  if (!c) return { ok: false, erro: 'Cole a chave antes de salvar.' };
  if (/\s/.test(c)) return { ok: false, erro: 'A chave não pode ter espaço ou quebra de linha.' };
  if (c.length < 20) return { ok: false, erro: 'Chave curta demais: confira se colou inteira.' };
  const aviso = info.prefixo && !c.startsWith(info.prefixo)
    ? `Chaves de ${info.rotulo} costumam começar com "${info.prefixo}". Salvei mesmo assim: use "Testar" para conferir.`
    : '';
  return { ok: true, chave: c, aviso };
}

// A tela nunca recebe a chave de volta: só o começo e os 4 últimos caracteres.
export function mascararChave(chave) {
  const c = String(chave ?? '');
  if (!c) return '';
  if (c.length < 12) return '••••';
  // prefixo público: até dois pedaços curtos de letras minúsculas (sk-ant-, gsk_, sk-or-)
  const prefixo = c.match(/^(?:[a-z]{1,5}[-_]){1,2}/)?.[0] ?? c.slice(0, 3);
  return `${prefixo.slice(0, 8)}…${c.slice(-4)}`;
}

// ---------- R21: de onde vem a chave ----------
// Ordem: chave salva pela tela (cofre) → chave do .env → nenhuma (aí vale a CLI, R16).
export function escolherChave(provedor, cofre = {}, env = {}) {
  const nome = CATALOGO[provedor]?.chave;
  if (!nome) return null;
  if (cofre[provedor]) return { valor: cofre[provedor], fonte: 'tela', variavel: nome };
  if (env[nome]) return { valor: env[nome], fonte: '.env', variavel: nome };
  return null;
}

// ---------- R22: erro do provedor em português ----------
// Recebe o status HTTP, o tipo de erro da API e a mensagem; devolve o tipo e o que fazer.
// Crédito vem antes de cota: a OpenAI responde "sem crédito" com 429 insufficient_quota.
export function classificarErro({ status, tipo = '', mensagem = '', codigo = '' } = {}) {
  const m = `${tipo} ${mensagem} ${codigo}`;
  const s = Number(status) || 0;
  const r = (t, texto) => ({ tipo: t, texto });
  if (s === 401 || /authentication_error|invalid.{0,20}api.?key|api key not valid|incorrect api key|unauthori[sz]ed/i.test(m)) {
    return r('chave', 'Chave inválida ou revogada. Gere outra no site do provedor e salve de novo.');
  }
  if (s === 402 || /billing_error|credit balance|insufficient_quota|insufficient credits|payment required/i.test(m)) {
    return r('credito', 'Sem crédito na conta da API. Coloque crédito, use outra chave ou a CLI da assinatura.');
  }
  if (s === 403 || /permission_error|permission denied|forbidden/i.test(m)) {
    return r('permissao', 'A chave não tem permissão para este modelo ou região.');
  }
  if (s === 404 || /not_found_error|model.{0,40}(not found|does not exist|not exist|não existe)|unknown model/i.test(m)) {
    return r('modelo', 'Modelo não encontrado para esta chave. Confira o nome do modelo.');
  }
  if (s === 429 || /rate_limit|rate limit|RESOURCE_EXHAUSTED|quota/i.test(m)) {
    return r('cota', 'Limite de uso atingido (por minuto ou por dia). Espere um pouco e tente de novo.');
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|fetch failed|connection error|network/i.test(m)) {
    return r('conexao', 'Sem conexão com o provedor. Confira a internet (ou, no Ollama, se ele está aberto).');
  }
  if (/timeout|timed out|ETIMEDOUT|aborted|tempo esgotado/i.test(m)) {
    return r('tempo', 'O provedor demorou demais para responder. Tente de novo.');
  }
  if (s >= 500 || /overloaded/i.test(m)) {
    return r('servico', 'O provedor está instável agora. Tente de novo em instantes.');
  }
  return r('outro', String(mensagem || 'Erro desconhecido.').split('\n')[0].slice(0, 200));
}

// ---------- R23: provedor e modelo de cada agente ----------
// Modelo do agente: o escolhido no cartão dele → o do .env → o padrão do catálogo.
export function validarModelo(modelo) {
  const m = String(modelo ?? '').trim();
  if (!m) return '';
  if (m.length > 80 || !/^[A-Za-z0-9._:/@-]+$/.test(m)) throw new Error('Nome de modelo inválido: use letras, números e . _ : / @ -');
  return m;
}

export function modeloDoAgente(agente, env = {}) {
  const info = CATALOGO[agente?.provedor];
  if (!info) return '';
  return agente.modelo || env[info.varModelo] || info.modelo;
}

export function editarAgente(agentes, id, dados) {
  const alvo = agentes.find((a) => a.id === id);
  if (!alvo) throw new Error('Agente não encontrado.');
  const provedor = dados.provedor ?? alvo.provedor;
  if (!PROVEDORES.includes(provedor)) throw new Error(`Provedor desconhecido: ${provedor}`);
  const modelo = validarModelo(dados.modelo ?? alvo.modelo);
  return agentes.map((a) => {
    if (a.id !== id) return a;
    const novo = { ...a, provedor };
    if (modelo) novo.modelo = modelo; else delete novo.modelo;
    return novo;
  });
}

// ---------- R18: chave que liga o modo gratuito ----------
// MODO_GRATUITO=true (ou sim, 1, on) no .env. Qualquer outro valor, ou ausente, deixa desligado.
export function modoGratuitoLigado(env) {
  return ['true', 'sim', '1', 'on', 'yes'].includes(String(env?.MODO_GRATUITO ?? '').trim().toLowerCase());
}

// ---------- R17: arquivos devolvidos pela API ----------
// Blocos ```arquivo:caminho viram arquivos na pasta. Caminho absoluto ou com ".." é recusado.
export function caminhoSeguro(caminho) {
  const c = String(caminho).trim().replace(/\\/g, '/');
  if (!c || c.startsWith('/') || /^[a-z]:/i.test(c)) return null;
  const partes = c.split('/').filter((p) => p && p !== '.');
  if (!partes.length || partes.includes('..')) return null;
  return partes.join('/');
}

export function extrairArquivos(texto) {
  const arquivos = [];
  const bloco = /```arquivo:([^\n`]+)\n([\s\S]*?)\n?```/g;
  let m;
  while ((m = bloco.exec(String(texto)))) {
    const caminho = caminhoSeguro(m[1]);
    if (caminho) arquivos.push({ caminho, conteudo: m[2].endsWith('\n') ? m[2] : m[2] + '\n' });
  }
  return arquivos;
}

// ---------- R24: qual comando de teste o portão roda ----------
// Ordem: COMANDO_TESTE do .env → "test" do package.json → arquivos *.test.js / test/ (node --test)
// → test_*.py (pytest). O "test" padrão do npm init ("no test specified") não conta.
// Script do package.json foi escrito pelos agentes: se for perigoso (R7), o portão não roda sozinho.
export function detectarComandoTeste({ packageJson = null, arquivos = [], env = {} } = {}) {
  if (String(env.COMANDO_TESTE ?? '').trim()) return { comando: env.COMANDO_TESTE.trim(), origem: '.env', sensivel: false };
  let scripts = {};
  try { scripts = JSON.parse(packageJson ?? '{}')?.scripts ?? {}; } catch { scripts = {}; }
  const script = typeof scripts.test === 'string' ? scripts.test.trim() : '';
  if (script && !/no test specified/i.test(script)) {
    return { comando: 'npm test', origem: 'package.json', script, sensivel: comandoSensivel(script) };
  }
  const caminhos = arquivos.map((a) => String(a).replace(/\\/g, '/'));
  if (caminhos.some((c) => /(^|\/)[^/]+\.test\.(m?js|cjs)$/.test(c) || /^tests?\/.+\.(m?js|cjs)$/.test(c))) {
    return { comando: 'node --test', origem: 'arquivos de teste', sensivel: false };
  }
  if (caminhos.some((c) => /(^|\/)(test_[^/]+|[^/]+_test)\.py$/.test(c))) {
    return { comando: 'python3 -m pytest -q', origem: 'arquivos de teste', sensivel: false };
  }
  return null;
}

// ---------- R25: só o que importa da saída do teste ----------
// O agente que vai corrigir recebe as linhas de falha e o placar, não o log inteiro (menos tokens).
const LINHA_DE_FALHA = /not ok|fail|error|assert|expected|actual|✖|✗|×|traceback|exception|^\s*at .+:\d+|\.(m?js|cjs|ts|py):\d+|^# (tests|pass|fail)|tests? (passed|failed)|\d+ (passed|failed)/i;

export function resumirSaidaTeste(saida, { maxLinhas = 40, maxColunas = 200 } = {}) {
  const linhas = String(saida ?? '').replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
  const importantes = [...new Set(linhas.filter((l) => LINHA_DE_FALHA.test(l)))];
  const escolhidas = importantes.length ? importantes : linhas.slice(-30);
  const cortadas = escolhidas.slice(0, maxLinhas).map((l) => (l.length > maxColunas ? l.slice(0, maxColunas - 1) + '…' : l));
  if (escolhidas.length > maxLinhas) cortadas.push(`… (+${escolhidas.length - maxLinhas} linhas)`);
  return cortadas.join('\n');
}

// ---------- R26: o que fazer depois do portão ----------
// situacao: passou | falhou | tempo | sem-teste | pulou | desligado | bloqueado.
// O portão roda no máximo 1 + MAX_DEVOLUCOES vezes; depois disso o time desiste e o revisor é avisado.
export const MAX_DEVOLUCOES = 3;

// "sem-isolamento" (não havia caixa de areia) também segue: o portão não roda e a tela explica.
export function decidirPortao(situacao, rodada, max = MAX_DEVOLUCOES) {
  if (!['falhou', 'tempo', 'sem-teste'].includes(situacao)) return 'seguir';
  return rodada <= max ? 'devolver' : 'desistir';
}

// ---------- R27: para quem volta o trabalho ----------
// Quem escreveu um arquivo citado na saída do teste; se ninguém for citado, todos que executaram.
export function quemCorrige(resumo, autoria = {}, executores = []) {
  const texto = String(resumo ?? '');
  const citados = Object.entries(autoria)
    .filter(([caminho]) => texto.includes(caminho) || texto.includes(caminho.split('/').pop()))
    .map(([, id]) => id)
    .filter((id) => executores.includes(id));
  return citados.length ? [...new Set(citados)] : [...executores];
}

// ---------- R28: o que o agente recebe quando o portão devolve ----------
export function falhaDoPortao(resultado, rodada, max = MAX_DEVOLUCOES) {
  const tentativa = `Tentativa ${rodada} de ${max + 1}.`;
  const texto = resultado.situacao === 'sem-teste'
    ? `${tentativa} Vocês mudaram arquivos, mas o projeto não tem teste automatizado. Escreva um teste da sua parte `
      + '(ex.: test/<nome>.test.mjs com node:test e node:assert, ou "test" no package.json) e confira que ele passa.'
    : `${tentativa} O portão rodou \`${resultado.comando}\` e ${resultado.situacao === 'tempo' ? 'o tempo esgotou' : 'os testes falharam'}. `
      + `Corrija a sua parte para os testes passarem; não apague nem enfraqueça testes.\nSaída (resumo):\n${resultado.resumo || '(sem saída)'}`;
  return { nome: 'Portão de testes', papel: 'testes automáticos', texto };
}

// ---------- R29: caixa de areia dos testes (bubblewrap, Linux) ----------
// O teste enxerga: o sistema só para leitura (/usr, /etc), o Node do usuário só para leitura,
// a pasta do projeto com escrita e um /tmp vazio. A pasta pessoal (~/.ssh, ~/.config, chaves) não existe
// lá dentro, a rede fica cortada e o ambiente é zerado (nenhuma chave de API chega ao teste).
// `raizes`: /bin, /lib… desta máquina, com o alvo quando são atalhos (no Mint e no Ubuntu apontam para /usr).
export function argumentosIsolamento({ projeto, nodeDir = '', raizes = [], leituraExtra = [], rede = false }) {
  const a = ['--die-with-parent', '--new-session', '--unshare-all'];
  if (rede) a.push('--share-net');
  a.push('--ro-bind', '/usr', '/usr', '--ro-bind', '/etc', '/etc');
  for (const r of raizes) {
    if (r.link) a.push('--symlink', r.link, r.caminho); else a.push('--ro-bind', r.caminho, r.caminho);
  }
  if (nodeDir && !nodeDir.startsWith('/usr/')) a.push('--ro-bind', nodeDir, nodeDir);
  for (const p of leituraExtra) a.push('--ro-bind', p, p);
  a.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--dir', '/tmp/casa');
  // raiz só leitura no fim: escrever fora do projeto e do /tmp descartável falha na hora (EROFS)
  a.push('--bind', projeto, projeto, '--remount-ro', '/', '--chdir', projeto, '--clearenv');
  const caminho = [nodeDir && !nodeDir.startsWith('/usr/') ? `${nodeDir}/bin` : '', '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean).join(':');
  const env = { PATH: caminho, HOME: '/tmp/casa', TMPDIR: '/tmp', LANG: 'C.UTF-8', CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' };
  for (const [k, v] of Object.entries(env)) a.push('--setenv', k, v);
  return a;
}

// A pasta do projeto vira gravável dentro da caixa: não pode ser a raiz nem conter a pasta pessoal.
export function pastaIsolavel(projeto, home) {
  const p = String(projeto ?? '').replace(/\/+$/, '');
  const h = String(home ?? '').replace(/\/+$/, '');
  if (!p.startsWith('/') || p === '' || p.split('/').includes('..')) return false;
  return !(h === p || h.startsWith(p + '/'));
}

// ---------- R30: o portão roda isolado, ou não roda ----------
// PORTAO_ISOLAMENTO=desligado no .env é a única forma de rodar sem caixa de areia (escolha consciente).
export function decidirIsolamento({ plataforma, sondaOk, configuracao = '' }) {
  if (/^(desligado|off|false|nao|não|0)$/i.test(String(configuracao).trim())) return 'sem-isolamento';
  if (plataforma === 'linux' && sondaOk) return 'bwrap';
  return 'bloquear';
}
