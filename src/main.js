// Processo principal: janela, pasta do projeto, chaves (cofre e .env) e chamadas às IAs.
// Cada IA usa a sua chave de API (SDK oficial); sem chave, usa a CLI logada na assinatura.
const { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage, shell } = require('electron');
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
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
// As permissões vêm da lista de ferramentas do agente (R46, permissoesCli no núcleo).
const COMANDOS = {
  claude: (prompt, perm, modelo) => ['claude', ['-p', prompt, '--output-format', 'text', ...perm, ...(modelo ? ['--model', modelo] : [])]],
  // --skip-trust: em modo -p o gemini recusa pasta "não confiável"; a pasta é a que a pessoa escolheu.
  gemini: (prompt, perm, modelo) => ['gemini', ['--skip-trust', ...perm, '-o', 'text', ...(modelo ? ['-m', modelo] : []), '-p', prompt]],
  // --skip-git-repo-check: sem ele o codex recusa pastas fora de um repositório git confiável.
  codex: (prompt, perm, modelo) => ['codex', ['exec', ...perm, '--skip-git-repo-check', ...(modelo ? ['-m', modelo] : []), prompt]],
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

// Roda um processo com prazo. Fora do Windows, o filho abre um grupo próprio: no prazo esgotado,
// o grupo inteiro é encerrado (um "npm test" travado não sobrevive ao bash que o chamou).
const LIMITE_SAIDA = 200_000;
function rodar(cmd, args, cwd, env, tempo = TEMPO_MAXIMO_MS) {
  return new Promise((resolve) => {
    const grupo = process.platform !== 'win32';
    const filho = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: grupo });
    let saida = ''; let erro = ''; let tempoEsgotado = false;
    const guardar = (atual, d) => (atual.length < LIMITE_SAIDA ? atual + d : atual);
    const encerrar = (sinal) => { try { grupo ? process.kill(-filho.pid, sinal) : filho.kill(sinal); } catch { /* já saiu */ } };
    const timer = setTimeout(() => {
      tempoEsgotado = true; erro += '\n(tempo esgotado)';
      encerrar('SIGTERM'); setTimeout(() => encerrar('SIGKILL'), 3000).unref();
    }, tempo);
    filho.stdout.on('data', (d) => { saida = guardar(saida, d); });
    filho.stderr.on('data', (d) => { erro = guardar(erro, d); });
    filho.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, saida, erro: e.message, tempoEsgotado }); });
    filho.on('close', (codigo) => { clearTimeout(timer); resolve({ ok: codigo === 0 && !tempoEsgotado, codigo, saida: saida.trim(), erro: erro.trim(), tempoEsgotado }); });
  });
}

function pastaDoProjeto(pasta) {
  const p = pasta || PASTA_PADRAO;
  fs.mkdirSync(p, { recursive: true });
  return p;
}

ipcMain.handle('executar-agente', async (_ev, { provedor, modelo: modeloDoAgente, prompt, pasta, escrita, ferramentas }) => {
  const { CATALOGO, validarModelo, FERRAMENTAS, permissoesCli } = await nucleo;
  // Sem lista (chamada antiga ou "Testar agente"), vale a escrita: ler, e escrever se pedida.
  const lista = Array.isArray(ferramentas) ? ferramentas.filter((f) => f in FERRAMENTAS) : ['ler', ...(escrita ? ['escrever'] : [])];
  escrita = lista.includes('escrever');
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
    const [cmd, args] = COMANDOS[provedor](String(prompt), permissoesCli(provedor, lista), proprio);
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
        const { mtimeMs, size } = await fs.promises.stat(completo);
        lista.push({ caminho: path.relative(raiz, completo), mtimeMs, tamanho: size });
      }
    }
  }
  await andar(raiz, 0);
  return lista;
}

// ---------- caixa de areia dos testes (R29–R30) ----------
// O teste roda dentro do bubblewrap: só vê o projeto (com escrita), o sistema e o Node (só leitura).
const RAIZES = ['/bin', '/sbin', '/lib', '/lib32', '/lib64', '/libx32'];

function raizesDoSistema() {
  return RAIZES.flatMap((caminho) => {
    try {
      const st = fs.lstatSync(caminho);
      return [{ caminho, link: st.isSymbolicLink() ? fs.readlinkSync(caminho) : null }];
    } catch { return []; }
  });
}

// Pasta de instalação do Node que o usuário usa (nvm, por exemplo). O Electron não serve: não é o node do terminal.
function pastaDoNode(env) {
  try {
    const bin = execFileSync('sh', ['-c', 'command -v node'], { env, encoding: 'utf8' }).trim();
    return bin ? path.dirname(path.dirname(fs.realpathSync(bin))) : '';
  } catch { return ''; }
}

async function montarCaixa(projeto, env, doArquivo) {
  const { argumentosIsolamento } = await nucleo;
  const extra = [path.join(os.homedir(), '.local', 'lib')].filter((p) => fs.existsSync(p)); // pytest instalado com --user
  const rede = /^(liberada|sim|true|1|on)$/i.test(String(doArquivo.PORTAO_REDE ?? '').trim());
  return { args: argumentosIsolamento({ projeto, nodeDir: pastaDoNode(env), raizes: raizesDoSistema(), leituraExtra: extra, rede }), rede };
}

// A sonda prova que a caixa bloqueia de verdade, uma vez por execução do app.
const ESPERADO_SONDA = ['DENTRO-OK', 'FORA-BLOQUEADO', 'CASA-OCULTA', 'REDE-CORTADA', 'AMBIENTE-LIMPO', 'NODE-OK'];
let sonda = null;
function sondarCaixa(env) {
  sonda ||= (async () => {
    if (process.platform !== 'linux') return { ok: false, motivo: 'a caixa de areia (bubblewrap) só existe no Linux' };
    if (!existe('bwrap')) return { ok: false, motivo: 'o bubblewrap não está instalado (sudo apt install bubblewrap)' };
    const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'estudio-sonda-'));
    const dentro = path.join(base, 'projeto'); const fora = path.join(base, 'fora');
    await fs.promises.mkdir(dentro); await fs.promises.mkdir(fora);
    try {
      const { args } = await montarCaixa(dentro, env, {});
      const script = [
        'r=""',
        'echo x > dentro.txt && r="$r DENTRO-OK"',
        `( echo x > "${fora}/vazou.txt" ) 2>/dev/null && r="$r FORA-ESCREVEU" || r="$r FORA-BLOQUEADO"`,
        `[ -e "${path.join(os.homedir(), '.config')}" ] && r="$r CASA-VISIVEL" || r="$r CASA-OCULTA"`,
        '( exec 3<>/dev/tcp/1.1.1.1/53 ) 2>/dev/null && r="$r REDE-ABERTA" || r="$r REDE-CORTADA"',
        '[ -z "${SONDA_SEGREDO:-}" ] && r="$r AMBIENTE-LIMPO" || r="$r AMBIENTE-VAZOU"',
        'node -e "process.stdout.write(String(1+1))" 2>/dev/null | grep -q 2 && r="$r NODE-OK" || r="$r NODE-FALTA"',
        'echo "$r"',
      ].join('; ');
      const r = await rodar('bwrap', [...args, 'bash', '-c', script], dentro, { PATH: env.PATH, SONDA_SEGREDO: 'nao-pode-vazar' }, 20_000);
      const visto = r.saida.trim().split(/\s+/);
      const falhas = ESPERADO_SONDA.filter((x) => !visto.includes(x));
      const vazou = fs.existsSync(path.join(fora, 'vazou.txt'));
      if (falhas.length || vazou) return { ok: false, motivo: `a caixa de areia não passou na sonda (${[...falhas, vazou ? 'escreveu fora' : ''].filter(Boolean).join(', ')}). ${r.erro}`.trim() };
      return { ok: true };
    } finally { await fs.promises.rm(base, { recursive: true, force: true }).catch(() => {}); }
  })();
  return sonda;
}

ipcMain.handle('isolamento', async () => {
  const { decidirIsolamento } = await nucleo;
  const { env, doArquivo } = await ambiente();
  const s = await sondarCaixa(env);
  return { ...s, decisao: decidirIsolamento({ plataforma: process.platform, sondaOk: s.ok, configuracao: doArquivo.PORTAO_ISOLAMENTO }) };
});

// ---------- portão de testes (R24–R26) ----------
// Quem roda os testes é o Estúdio, não o agente. O comando é decidido aqui, nunca pela tela.
const TEMPO_PORTAO_MS = 120_000;

ipcMain.handle('portao', async (_ev, { pasta, houveMudanca }) => {
  const { ignorarCaminho, detectarComandoTeste, resumirSaidaTeste, decidirIsolamento, pastaIsolavel } = await nucleo;
  const { env, doArquivo } = await ambiente();
  if (/^(desligado|off|false|nao|não|0)$/i.test(String(doArquivo.PORTAO_TESTES ?? '').trim())) return { situacao: 'desligado' };
  if (!houveMudanca) return { situacao: 'pulou' };
  const raiz = path.resolve(pastaDoProjeto(pasta));
  let packageJson = null;
  try { packageJson = await fs.promises.readFile(path.join(raiz, 'package.json'), 'utf8'); } catch { /* sem package.json */ }
  const arquivos = (await listarArquivos(raiz, ignorarCaminho)).map((a) => a.caminho);
  const teste = detectarComandoTeste({ packageJson, arquivos, env: doArquivo });
  if (!teste) return { situacao: 'sem-teste' };
  if (teste.sensivel) return { situacao: 'bloqueado', ...teste };

  const sondaCaixa = await sondarCaixa(env);
  const modo = decidirIsolamento({ plataforma: process.platform, sondaOk: sondaCaixa.ok, configuracao: doArquivo.PORTAO_ISOLAMENTO });
  if (modo === 'bloquear') return { situacao: 'sem-isolamento', ...teste, motivo: sondaCaixa.motivo };
  if (modo === 'bwrap' && !pastaIsolavel(raiz, os.homedir())) {
    return { situacao: 'sem-isolamento', ...teste, motivo: 'a pasta do projeto é a pasta pessoal (ou a contém): escolha uma pasta só do projeto.' };
  }
  const inicio = Date.now();
  let r; let caixa = null;
  if (modo === 'bwrap') {
    caixa = await montarCaixa(raiz, env, doArquivo);
    r = await rodar('bwrap', [...caixa.args, 'bash', '-c', teste.comando], raiz, { PATH: env.PATH }, TEMPO_PORTAO_MS);
  } else {
    // NODE_TEST_CONTEXT herdado faz um node --test aninhado sair com 0 mesmo falhando (lição do muvuca).
    const limpo = { ...env, CI: '1', FORCE_COLOR: '0' };
    delete limpo.NODE_TEST_CONTEXT;
    r = await rodar('bash', ['-lc', teste.comando], raiz, limpo, TEMPO_PORTAO_MS);
  }
  const bruta = [r.saida, r.erro].filter(Boolean).join('\n');
  return {
    situacao: r.tempoEsgotado ? 'tempo' : r.ok ? 'passou' : 'falhou',
    ...teste, codigo: r.codigo, ms: Date.now() - inicio,
    isolado: modo === 'bwrap', rede: caixa?.rede ?? true,
    resumo: resumirSaidaTeste(bruta), saida: bruta.slice(-6000),
  };
});

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

// ---------- Manter/Descartar (R32–R35) ----------
// Antes de cada pedido, a pasta do projeto é copiada para userData/fotos/<id>. No fim, a tela mostra o diff;
// "Descartar" apaga o que foi criado e devolve da foto o que mudou ou sumiu. node_modules, .git etc. ficam de fora.
const PASTA_FOTOS = () => path.join(app.getPath('userData'), 'fotos');
const MAX_FOTOS = 10;
const ORCAMENTO_DIFF = 200_000; // caracteres de diff mandados para a tela, somando todos os arquivos
const hashDe = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const dentro = (raiz, alvo) => alvo === raiz || alvo.startsWith(raiz + path.sep);

// Caminho do arquivo a gravar ou apagar: tem de ficar na pasta, sem passar por symlink que leve para fora.
async function alvoSeguro(raiz, caminho) {
  const alvo = path.resolve(raiz, caminho);
  if (!dentro(raiz, alvo)) throw new Error(`fora da pasta do projeto: ${caminho}`);
  let dir = path.dirname(alvo);
  while (!fs.existsSync(dir)) dir = path.dirname(dir);
  if (!dentro(await fs.promises.realpath(raiz), await fs.promises.realpath(dir))) throw new Error(`symlink para fora da pasta: ${caminho}`);
  try {
    if ((await fs.promises.lstat(alvo)).isSymbolicLink()) throw new Error(`é um symlink: ${caminho}`);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return alvo;
}

async function estadoDaPasta(raiz) {
  const { ignorarCaminho, selecionarParaFoto } = await nucleo;
  const sel = selecionarParaFoto(await listarArquivos(raiz, ignorarCaminho));
  if (!sel.ok) return sel;
  const hashes = {};
  for (const c of sel.incluidos) hashes[c] = hashDe(await fs.promises.readFile(path.join(raiz, c)));
  return { ...sel, hashes };
}

async function lerFoto(id) {
  const { idDeFotoValido } = await nucleo;
  if (!idDeFotoValido(id)) throw new Error('foto inválida');
  const dir = path.join(PASTA_FOTOS(), id);
  try {
    return { dir, ...JSON.parse(await fs.promises.readFile(path.join(dir, 'foto.json'), 'utf8')) };
  } catch {
    throw new Error('a foto desta rodada não existe mais');
  }
}

async function limparFotos() {
  let nomes = [];
  try { nomes = (await fs.promises.readdir(PASTA_FOTOS())).filter((x) => /^f\d+-/.test(x)).sort(); } catch { return; }
  for (const velha of nomes.slice(0, -MAX_FOTOS)) await fs.promises.rm(path.join(PASTA_FOTOS(), velha), { recursive: true, force: true });
}

ipcMain.handle('foto-tirar', async (_ev, { pasta }) => {
  const { ignorarCaminho, selecionarParaFoto } = await nucleo;
  const raiz = path.resolve(pastaDoProjeto(pasta));
  const sel = selecionarParaFoto(await listarArquivos(raiz, ignorarCaminho));
  if (!sel.ok) return { erro: sel.motivo };
  const id = `f${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const dir = path.join(PASTA_FOTOS(), id);
  const hashes = {};
  try {
    for (const c of sel.incluidos) {
      const conteudo = await fs.promises.readFile(path.join(raiz, c)); // lido uma vez: o hash é do que foi guardado
      const destino = path.join(dir, 'arquivos', c);
      await fs.promises.mkdir(path.dirname(destino), { recursive: true });
      await fs.promises.writeFile(destino, conteudo);
      hashes[c] = hashDe(conteudo);
    }
    await fs.promises.mkdir(dir, { recursive: true }); // pasta vazia também tem foto (sem arquivos)
    await fs.promises.writeFile(path.join(dir, 'foto.json'), JSON.stringify({ raiz, criadaEm: Date.now(), hashes, grandes: sel.grandes }));
  } catch (e) {
    await fs.promises.rm(dir, { recursive: true, force: true });
    return { erro: `não consegui copiar a pasta (${e.message})` };
  }
  await limparFotos();
  return { id, arquivos: sel.incluidos.length, grandes: sel.grandes };
});

ipcMain.handle('foto-diff', async (_ev, { id, pasta }) => {
  const { compararFotos, diffLinhas } = await nucleo;
  try {
    const foto = await lerFoto(id);
    const raiz = path.resolve(pastaDoProjeto(pasta));
    if (raiz !== foto.raiz) return { erro: 'a pasta do projeto mudou depois da foto' };
    const atual = await estadoDaPasta(raiz);
    if (!atual.ok) return { erro: atual.motivo };
    const m = compararFotos(foto.hashes, atual.hashes);
    const ler = async (base, c, existe) => (existe ? fs.promises.readFile(path.join(base, c), 'utf8') : '');
    let orcamento = ORCAMENTO_DIFF;
    const diffs = [];
    for (const [tipo, lista] of [['criado', m.criados], ['alterado', m.alterados], ['removido', m.removidos]]) {
      for (const c of lista) {
        let texto = diffLinhas(await ler(path.join(foto.dir, 'arquivos'), c, c in foto.hashes), await ler(raiz, c, c in atual.hashes));
        const linhas = texto ? texto.split('\n') : [];
        const mais = linhas.filter((l) => l.startsWith('+')).length;
        const menos = linhas.filter((l) => l.startsWith('-')).length;
        if (texto && texto.length > orcamento) texto = null;
        if (texto) orcamento -= texto.length;
        diffs.push({ caminho: c, tipo, texto, mais, menos });
      }
    }
    const grandesNovos = atual.grandes.filter((c) => !foto.grandes.includes(c));
    return { ...m, diffs, grandesNovos };
  } catch (e) {
    return { erro: e.message };
  }
});

ipcMain.handle('foto-manter', async (_ev, { id }) => {
  const { idDeFotoValido } = await nucleo;
  if (idDeFotoValido(id)) await fs.promises.rm(path.join(PASTA_FOTOS(), id), { recursive: true, force: true });
  return true;
});

ipcMain.handle('foto-descartar', async (_ev, { id, pasta }) => {
  const { compararFotos, planoDeDescarte } = await nucleo;
  try {
    const foto = await lerFoto(id);
    const raiz = path.resolve(pastaDoProjeto(pasta));
    if (raiz !== foto.raiz) return { erro: 'a pasta do projeto mudou depois da foto' };
    const atual = await estadoDaPasta(raiz);
    if (!atual.ok) return { erro: atual.motivo };
    const plano = planoDeDescarte(compararFotos(foto.hashes, atual.hashes));
    const alvos = { apagar: [], restaurar: [] }; // confere tudo antes de mexer em qualquer arquivo
    for (const c of plano.apagar) alvos.apagar.push(await alvoSeguro(raiz, c));
    for (const c of plano.restaurar) alvos.restaurar.push([c, await alvoSeguro(raiz, c)]);
    for (const alvo of alvos.apagar) {
      await fs.promises.unlink(alvo);
      for (let d = path.dirname(alvo); d !== raiz && dentro(raiz, d); d = path.dirname(d)) {
        try { await fs.promises.rmdir(d); } catch { break; } // só some pasta que ficou vazia
      }
    }
    for (const [c, alvo] of alvos.restaurar) {
      await fs.promises.mkdir(path.dirname(alvo), { recursive: true });
      await fs.promises.copyFile(path.join(foto.dir, 'arquivos', c), alvo);
    }
    await fs.promises.rm(foto.dir, { recursive: true, force: true });
    return { apagados: plano.apagar, restaurados: plano.restaurar };
  } catch (e) {
    return { erro: e.message };
  }
});

// ---------- camadas do projeto e memória longa (R48–R50) ----------
// Caminhos fixos dentro de .estudio/ na pasta do projeto; a tela nunca escolhe o caminho.
const LIMITE_ARQUIVO_CAMADA = 100_000;

async function lerSeExiste(arquivo) {
  try {
    const st = await fs.promises.lstat(arquivo);
    if (!st.isFile() || st.size > LIMITE_ARQUIVO_CAMADA) return '';
    return await fs.promises.readFile(arquivo, 'utf8');
  } catch { return ''; }
}

ipcMain.handle('camadas-ler', async (_ev, { pasta }) => {
  const { ARQUIVOS_DO_PROJETO } = await nucleo;
  const raiz = path.resolve(pastaDoProjeto(pasta));
  const skills = {};
  try {
    for (const nome of await fs.promises.readdir(path.join(raiz, ARQUIVOS_DO_PROJETO.skills))) {
      const id = nome.replace(/\.md$/, '');
      if (nome.endsWith('.md') && /^[a-z0-9-]{1,40}$/.test(id)) skills[id] = await lerSeExiste(path.join(raiz, ARQUIVOS_DO_PROJETO.skills, nome));
    }
  } catch { /* sem skills */ }
  return {
    regras: await lerSeExiste(path.join(raiz, ARQUIVOS_DO_PROJETO.regras)),
    memoria: await lerSeExiste(path.join(raiz, ARQUIVOS_DO_PROJETO.memoria)),
    skills,
  };
});

async function gravarCamada(raiz, relativo, texto) {
  const alvo = await alvoSeguro(raiz, relativo);
  await fs.promises.mkdir(path.dirname(alvo), { recursive: true });
  await fs.promises.writeFile(alvo, String(texto ?? '').slice(0, LIMITE_ARQUIVO_CAMADA), 'utf8');
}

ipcMain.handle('camadas-salvar', async (_ev, { pasta, regras, memoria, skills = {} }) => {
  const { ARQUIVOS_DO_PROJETO, caminhoDaSkill } = await nucleo;
  try {
    const raiz = path.resolve(pastaDoProjeto(pasta));
    if (typeof regras === 'string') await gravarCamada(raiz, ARQUIVOS_DO_PROJETO.regras, regras);
    if (typeof memoria === 'string') await gravarCamada(raiz, ARQUIVOS_DO_PROJETO.memoria, memoria);
    for (const [id, texto] of Object.entries(skills)) await gravarCamada(raiz, caminhoDaSkill(id), texto);
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
});

ipcMain.handle('memoria-anotar', async (_ev, { pasta, entrada }) => {
  const { ARQUIVOS_DO_PROJETO } = await nucleo;
  try {
    const raiz = path.resolve(pastaDoProjeto(pasta));
    const atual = await lerSeExiste(path.join(raiz, ARQUIVOS_DO_PROJETO.memoria));
    const cabecalho = atual ? '' : '# Memória do projeto\n\nEscrita pelo Estúdio no fim de cada rodada. Só fatos: pedido, time, portão, veredito e decisão.\n\n';
    await gravarCamada(raiz, ARQUIVOS_DO_PROJETO.memoria, `${atual}${cabecalho}${String(entrada).slice(0, 2000)}\n`);
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
});
