// Processo principal: janela, pasta do projeto, chaves (cofre e .env) e chamadas às IAs.
// Cada IA usa a sua chave de API (SDK oficial); sem chave, usa a CLI logada na assinatura.
const { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage, shell } = require('electron');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const nucleo = import('./nucleo.mjs');
let janela;
const TEMPO_MAXIMO_MS = 300_000;
const PASTA_PADRAO = path.join(os.homedir(), 'estudio-projetos');
const ARQUIVO_ENV = path.join(app.getAppPath(), '.env');

function criarJanela() {
  janela = new BrowserWindow({
    width: 1440, height: 880, minWidth: 1100, minHeight: 640, backgroundColor: '#121110', title: 'Estúdio',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  janela.setMenuBarVisibility(false);
  janela.loadFile(path.join(__dirname, 'index.html'));
}

Menu.setApplicationMenu(Menu.buildFromTemplate([
  { label: 'Arquivo', submenu: [{ role: 'quit' }] },
  { role: 'editMenu' },
  { label: 'Exibir', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }] },
]));

app.whenReady().then(criarJanela);
app.on('window-all-closed', () => app.quit());

// ---------- cofre de chaves (R21) ----------
// Chaves digitadas na tela ficam cifradas pelo cofre do sistema (safeStorage: Keychain, DPAPI ou
// o chaveiro do Linux). Se o sistema não oferece cofre de verdade, o Estúdio recusa guardar e
// orienta usar o .env: nunca grava a chave em texto puro por conta própria.
const ARQUIVO_COFRE = () => path.join(app.getPath('userData'), 'chaves.json');

function situacaoCofre() {
  if (!safeStorage.isEncryptionAvailable()) {
    return { disponivel: false, motivo: 'O sistema não oferece cofre de chaves. Use o .env.' };
  }
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
    return { disponivel: false, motivo: 'Sem chaveiro do sistema (gnome-keyring ou kwallet) ativo: a chave ficaria quase em texto puro. Use o .env ou ative o chaveiro.' };
  }
  return { disponivel: true, motivo: '' };
}

function lerCofreCifrado() {
  try { return JSON.parse(fs.readFileSync(ARQUIVO_COFRE(), 'utf8')); } catch { return {}; }
}

function lerCofre() {
  if (!situacaoCofre().disponivel) return {};
  const cofre = {};
  for (const [provedor, cifrada] of Object.entries(lerCofreCifrado())) {
    try { cofre[provedor] = safeStorage.decryptString(Buffer.from(cifrada, 'base64')); } catch { /* chave de outro usuário ou corrompida */ }
  }
  return cofre;
}

function gravarCofre(cifrado) {
  fs.mkdirSync(path.dirname(ARQUIVO_COFRE()), { recursive: true });
  fs.writeFileSync(ARQUIVO_COFRE(), JSON.stringify(cifrado, null, 2), { mode: 0o600 });
}

// ---------- .env ----------
// Lido a cada chamada: trocar uma chave não exige reiniciar o app.
async function ambiente() {
  const { lerEnv, CATALOGO } = await nucleo;
  let doArquivo = {};
  try { doArquivo = lerEnv(fs.readFileSync(ARQUIVO_ENV, 'utf8')); } catch { /* sem .env: usa os logins */ }
  const cofre = lerCofre();
  // chave da tela vale mais que a do .env (R21)
  const comCofre = { ...doArquivo };
  for (const [p, valor] of Object.entries(cofre)) if (CATALOGO[p]?.chave) comCofre[CATALOGO[p].chave] = valor;
  // o codex exec aceita a chave como CODEX_API_KEY
  if (comCofre.OPENAI_API_KEY) comCofre.CODEX_API_KEY = comCofre.OPENAI_API_KEY;
  return { env: { ...process.env, ...comCofre }, chaves: Object.keys(comCofre), doArquivo, cofre };
}

// ---------- provedores ----------
function existe(cmd) {
  try { execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }); return true; } catch { return false; }
}

// Quem executa escreve na pasta do projeto; pesquisa e revisão só leem.
// `modelo` só é passado quando o agente tem um modelo próprio (R23).
const COMANDOS = {
  claude: (prompt, escrita, modelo) => ['claude', ['-p', prompt, '--output-format', 'text',
    '--allowedTools', escrita ? 'Read,Grep,Glob,Edit,MultiEdit,Write' : 'Read,Grep,Glob',
    ...(escrita ? ['--permission-mode', 'acceptEdits'] : []), ...(modelo ? ['--model', modelo] : [])]],
  // --skip-trust: em modo -p o gemini recusa pasta "não confiável"; a pasta é a que a pessoa escolheu.
  gemini: (prompt, escrita, modelo) => ['gemini', ['--skip-trust', '--approval-mode', escrita ? 'auto_edit' : 'plan', '-o', 'text',
    ...(modelo ? ['-m', modelo] : []), '-p', prompt]],
  // --skip-git-repo-check: sem ele o codex recusa pastas fora de um repositório git confiável.
  codex: (prompt, escrita, modelo) => ['codex', ['exec', '--sandbox', escrita ? 'workspace-write' : 'read-only', '--skip-git-repo-check',
    ...(modelo ? ['-m', modelo] : []), prompt]],
};

const COMO_INSTALAR = {
  claude: 'npm install -g @anthropic-ai/claude-code',
  gemini: 'npm install -g @google/gemini-cli',
  codex: 'npm install -g @openai/codex',
};

// ---------- APIs (SDKs oficiais; os compatíveis usam o SDK da OpenAI com outro endereço) ----------
// Modo gratuito: Flash-Lite tem a maior cota grátis do Gemini (troque com GEMINI_MODELO_GRATUITO).
const MODELO_GRATUITO = 'gemini-3.5-flash-lite';
const TEMPO_TESTE_MS = 20_000;

async function clienteCompativel(provedor, chave, env) {
  const { CATALOGO } = await nucleo;
  const info = CATALOGO[provedor];
  const OpenAI = (await import('openai')).default;
  const baseURL = (info.varUrl && env[info.varUrl]) || info.baseUrl;
  // o SDK exige uma chave; o Ollama ignora o valor
  return new OpenAI({ apiKey: chave || 'sem-chave', baseURL, timeout: TEMPO_MAXIMO_MS, maxRetries: 1 });
}

const API = {
  async claude(prompt, chave, modelo) {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const cliente = new Anthropic({ apiKey: chave });
    // streaming: a resposta pode trazer arquivos inteiros; fallbacks: se o modelo recusar, outro assume
    const msg = await cliente.beta.messages.stream({
      model: modelo, max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      messages: [{ role: 'user', content: prompt }],
    }).finalMessage();
    if (msg.stop_reason === 'refusal') throw new Error('O modelo recusou o pedido.');
    return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  },
  async gemini(prompt, chave, modelo) {
    const { GoogleGenAI } = await import('@google/genai');
    const r = await new GoogleGenAI({ apiKey: chave }).models.generateContent({ model: modelo, contents: prompt });
    return r.text ?? '';
  },
  async codex(prompt, chave, modelo) {
    const OpenAI = (await import('openai')).default;
    const r = await new OpenAI({ apiKey: chave }).responses.create({ model: modelo, input: prompt });
    return r.output_text ?? '';
  },
  async compativel(prompt, chave, modelo, provedor, env) {
    const cliente = await clienteCompativel(provedor, chave, env);
    const r = await cliente.chat.completions.create({ model: modelo, messages: [{ role: 'user', content: prompt }] });
    return r.choices?.[0]?.message?.content ?? '';
  },
};

// Teste barato (R22): só confere se a chave abre a lista de modelos e se o modelo existe.
// Não gera texto, então não custa tokens. Falta de crédito só aparece em "Testar agente".
const CONSULTA = {
  async claude(chave, modelo) {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    await new Anthropic({ apiKey: chave, timeout: TEMPO_TESTE_MS, maxRetries: 0 }).models.retrieve(modelo);
  },
  async gemini(chave, modelo) {
    const { GoogleGenAI } = await import('@google/genai');
    await new GoogleGenAI({ apiKey: chave }).models.get({ model: modelo });
  },
  async codex(chave, modelo) {
    const OpenAI = (await import('openai')).default;
    await new OpenAI({ apiKey: chave, timeout: TEMPO_TESTE_MS, maxRetries: 0 }).models.retrieve(modelo);
  },
  async compativel(chave, modelo, provedor, env) {
    const cliente = await clienteCompativel(provedor, chave, env);
    const ids = [];
    for await (const m of cliente.models.list()) ids.push(m.id);
    if (!ids.includes(modelo)) return `A chave funciona, mas "${modelo}" não aparece na lista de modelos (${ids.length}). Confira o nome ou use "Testar agente".`;
    return '';
  },
};

function comPrazo(promessa, ms) {
  let timer;
  const prazo = new Promise((_, falha) => { timer = setTimeout(() => falha(new Error('timeout: tempo esgotado')), ms); });
  return Promise.race([promessa, prazo]).finally(() => clearTimeout(timer));
}

// Erro de qualquer SDK → campos que a regra R22 entende.
async function traduzirErro(e) {
  const { classificarErro } = await nucleo;
  const corpo = e?.error?.error ?? e?.error ?? {};
  return classificarErro({
    status: e?.status ?? e?.code,
    tipo: e?.type ?? corpo.type ?? '',
    mensagem: e?.message ?? String(e),
    codigo: [e?.code, corpo.code, e?.cause?.code].filter(Boolean).join(' '),
  });
}

async function chamarApi(provedor, prompt, env, modelo) {
  const { CATALOGO, escolherChave } = await nucleo;
  const info = CATALOGO[provedor];
  const chave = info.chave ? escolherChave(provedor, {}, env)?.valor : '';
  try {
    const saida = info.compativel
      ? (await API.compativel(prompt, chave, modelo, provedor, env)).trim()
      : (await API[provedor](prompt, chave, modelo)).trim();
    return { ok: Boolean(saida), saida, erro: saida ? '' : 'resposta vazia', modelo };
  } catch (e) {
    const { tipo, texto } = await traduzirErro(e);
    const extra = tipo === 'cota' && provedor === 'gemini' ? ' No plano grátis do Gemini a cota diária volta à meia-noite do Pacífico.' : '';
    return { ok: false, saida: '', modelo, tipoErro: tipo, erro: `${modelo}: ${texto}${extra}` };
  }
}

// Grava na pasta os blocos ```arquivo:caminho devolvidos pela API.
async function gravarArquivos(texto, raiz) {
  const { extrairArquivos } = await nucleo;
  const gravados = [];
  for (const { caminho, conteudo } of extrairArquivos(texto)) {
    const destino = path.join(raiz, caminho);
    await fs.promises.mkdir(path.dirname(destino), { recursive: true });
    await fs.promises.writeFile(destino, conteudo, 'utf8');
    gravados.push(caminho);
  }
  return gravados;
}

const cliInstalada = new Map();
function temCli(p) {
  if (!cliInstalada.has(p)) cliInstalada.set(p, existe(p));
  return cliInstalada.get(p);
}

async function modos() {
  const { modoDoProvedor, modoGratuitoLigado, PROVEDORES, PROVEDORES_CLI } = await nucleo;
  const { chaves, doArquivo, env } = await ambiente();
  const gratuito = modoGratuitoLigado(doArquivo);
  const clis = gratuito ? {} : Object.fromEntries(PROVEDORES_CLI.map((p) => [p, temCli(p)]));
  return {
    chaves, gratuito,
    modeloGratuito: env.GEMINI_MODELO_GRATUITO || MODELO_GRATUITO,
    modos: Object.fromEntries(PROVEDORES.map((p) => [p, modoDoProvedor(p, chaves, clis, gratuito)])),
  };
}

ipcMain.handle('provedores', () => modos());

function rodar(cmd, args, cwd, env, tempo = TEMPO_MAXIMO_MS) {
  return new Promise((resolve) => {
    const filho = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = ''; let erro = '';
    const timer = setTimeout(() => { filho.kill('SIGTERM'); erro += '\n(tempo esgotado)'; }, tempo);
    filho.stdout.on('data', (d) => { saida += d; });
    filho.stderr.on('data', (d) => { erro += d; });
    filho.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, saida, erro: e.message }); });
    filho.on('close', (codigo) => { clearTimeout(timer); resolve({ ok: codigo === 0, codigo, saida: saida.trim(), erro: erro.trim() }); });
  });
}

function pastaDoProjeto(pasta) {
  const p = pasta || PASTA_PADRAO;
  fs.mkdirSync(p, { recursive: true });
  return p;
}

ipcMain.handle('executar-agente', async (_ev, { provedor, modelo: modeloDoAgente, prompt, pasta, escrita }) => {
  const { CATALOGO, validarModelo } = await nucleo;
  const info = CATALOGO[provedor];
  if (!info) return { ok: false, erro: `Provedor desconhecido: ${provedor}` };
  let proprio;
  try { proprio = validarModelo(modeloDoAgente); } catch (e) { return { ok: false, erro: e.message }; }
  const estado = await modos();
  const modo = estado.modos[provedor];
  const raiz = pastaDoProjeto(pasta);
  const { env } = await ambiente();
  if (modo === 'gratis') {
    // todo agente vira Gemini grátis, com a chave GEMINI_API_KEY (o modelo do agente é ignorado)
    const r = await chamarApi('gemini', String(prompt), env, estado.modeloGratuito);
    if (r.ok && escrita) r.gravados = await gravarArquivos(r.saida, raiz);
    return { ...r, modo };
  }
  if (modo === 'api') {
    const modelo = proprio || env[info.varModelo] || info.modelo;
    const r = await chamarApi(provedor, String(prompt), env, modelo);
    if (r.ok && escrita) r.gravados = await gravarArquivos(r.saida, raiz);
    return { ...r, modo };
  }
  if (modo === 'cli') {
    const [cmd, args] = COMANDOS[provedor](String(prompt), Boolean(escrita), proprio);
    return { ...(await rodar(cmd, args, raiz, env)), modo, modelo: proprio || 'padrão da CLI' };
  }
  if (estado.gratuito) {
    return { ok: false, erro: 'O modo gratuito está ligado (MODO_GRATUITO=true), mas falta a chave do Gemini. '
      + 'Salve uma em 🔑 Chaves ou no .env. Crie grátis em https://aistudio.google.com/app/apikey (sem ativar faturamento).' };
  }
  return { ok: false, erro: `Sem acesso a ${info.rotulo}: salve a chave em 🔑 Chaves (ou ${info.chave} no .env)`
    + (info.cli ? ` ou instale e faça login na CLI (${COMO_INSTALAR[provedor]}).` : '.') };
});

// ---------- painel de chaves ----------
// A tela recebe só a máscara e a origem de cada chave, nunca o valor.
ipcMain.handle('chaves', async () => {
  const { CATALOGO, PROVEDORES, escolherChave, mascararChave } = await nucleo;
  const { doArquivo, cofre } = await ambiente();
  const estado = await modos();
  return {
    cofre: situacaoCofre(),
    gratuito: estado.gratuito,
    provedores: PROVEDORES.map((p) => {
      const info = CATALOGO[p];
      const escolhida = escolherChave(p, cofre, doArquivo);
      return {
        id: p, rotulo: info.rotulo, site: info.site, usaChave: Boolean(info.chave), variavel: info.chave,
        modeloPadrao: doArquivo[info.varModelo] || info.modelo,
        mascara: escolhida ? mascararChave(escolhida.valor) : '', fonte: escolhida?.fonte ?? '',
        temNoEnv: Boolean(info.chave && doArquivo[info.chave]), temNaTela: Boolean(cofre[p]),
        cli: Boolean(info.cli && temCli(p)), modo: estado.modos[p],
      };
    }),
  };
});

ipcMain.handle('chave-salvar', async (_ev, { provedor, chave }) => {
  const { validarChave } = await nucleo;
  const cofre = situacaoCofre();
  if (!cofre.disponivel) return { ok: false, erro: cofre.motivo };
  const v = validarChave(provedor, chave);
  if (!v.ok) return v;
  const cifrado = lerCofreCifrado();
  cifrado[provedor] = safeStorage.encryptString(v.chave).toString('base64');
  gravarCofre(cifrado);
  return { ok: true, aviso: v.aviso };
});

ipcMain.handle('chave-remover', async (_ev, { provedor }) => {
  const cifrado = lerCofreCifrado();
  delete cifrado[provedor];
  gravarCofre(cifrado);
  return { ok: true };
});

// Testa chave + modelo sem gerar texto (não custa tokens).
ipcMain.handle('provedor-testar', async (_ev, { provedor, modelo: pedido }) => {
  const { CATALOGO, escolherChave, validarModelo } = await nucleo;
  const info = CATALOGO[provedor];
  if (!info) return { ok: false, erro: `Provedor desconhecido: ${provedor}` };
  const { env, doArquivo, cofre } = await ambiente();
  let modelo;
  try { modelo = validarModelo(pedido) || doArquivo[info.varModelo] || info.modelo; } catch (e) { return { ok: false, erro: e.message }; }
  const escolhida = escolherChave(provedor, cofre, doArquivo);
  if (info.chave && !escolhida) {
    if (info.cli && temCli(provedor)) {
      return { ok: true, modelo, fonte: 'cli', aviso: `Sem chave: os agentes usam a CLI "${info.cli}" logada. Use "Testar agente" para conferir o login.` };
    }
    return { ok: false, modelo, tipoErro: 'chave', erro: 'Nenhuma chave salva nem CLI instalada.' };
  }
  const inicio = Date.now();
  try {
    const aviso = info.compativel
      ? await comPrazo(CONSULTA.compativel(escolhida?.valor, modelo, provedor, env), TEMPO_TESTE_MS)
      : await comPrazo(CONSULTA[provedor](escolhida.valor, modelo), TEMPO_TESTE_MS);
    return { ok: true, modelo, fonte: escolhida?.fonte ?? 'local', ms: Date.now() - inicio, aviso: aviso || '' };
  } catch (e) {
    const { tipo, texto } = await traduzirErro(e);
    return { ok: false, modelo, fonte: escolhida?.fonte ?? 'local', ms: Date.now() - inicio, tipoErro: tipo, erro: texto };
  }
});

// Só roda depois que a pessoa clicou em Executar/Aprovar na tela.
ipcMain.handle('executar-comando', async (_ev, { comando, pasta }) =>
  rodar('bash', ['-lc', String(comando)], pastaDoProjeto(pasta), (await ambiente()).env, 60_000));

ipcMain.handle('pasta-padrao', () => PASTA_PADRAO);

ipcMain.handle('escolher-pasta', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(janela, {
    title: 'Pasta do projeto', properties: ['openDirectory', 'createDirectory'],
  });
  return canceled || !filePaths.length ? null : filePaths[0];
});

// ---------- arquivos alterados na rodada ----------
async function listarArquivos(raiz, ignorar, profundidade = 5) {
  const lista = [];
  async function andar(dir, nivel) {
    if (nivel > profundidade || lista.length > 5000) return;
    let itens = [];
    try { itens = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      if (ignorar(it.name)) continue;
      const completo = path.join(dir, it.name);
      if (it.isDirectory()) await andar(completo, nivel + 1);
      else if (it.isFile()) {
        const { mtimeMs } = await fs.promises.stat(completo);
        lista.push({ caminho: path.relative(raiz, completo), mtimeMs });
      }
    }
  }
  await andar(raiz, 0);
  return lista;
}

ipcMain.handle('arquivos-alterados', async (_ev, { pasta, desde }) => {
  const { ignorarCaminho, arquivosAlterados } = await nucleo;
  const raiz = pastaDoProjeto(pasta);
  return arquivosAlterados(await listarArquivos(raiz, ignorarCaminho), Number(desde)).slice(0, 50);
});

// Abre um arquivo (ou a pasta, com caminho vazio) no programa padrão do sistema.
ipcMain.handle('abrir', async (_ev, { pasta, caminho }) => {
  const raiz = path.resolve(pastaDoProjeto(pasta));
  const alvo = path.resolve(raiz, String(caminho || '.'));
  if (alvo !== raiz && !alvo.startsWith(raiz + path.sep)) return 'Fora da pasta do projeto';
  return shell.openPath(alvo);
});
