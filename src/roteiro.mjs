// R31: roteiro falso. Uma ponte com a mesma cara da real (preload.js), mas sem modelo, sem disco e sem custo.
// A orquestração de verdade (rodada, plano, execução, portão, revisão) roda por cima dela e repete a Demo 1:
// Pedido → Plano → Execução → Testes (o primeiro falha e volta para quem escreveu) → Decisão.
import { CATALOGO, PROVEDORES, compararFotos, diffLinhas, planoDeDescarte } from './nucleo.mjs';

export const PEDIDO_DO_ROTEIRO = 'Crie uma página de status com um endpoint /health';
export const COMANDO_DO_ROTEIRO = 'npm test';

const SERVIDOR_COM_BUG = `import http from 'node:http';

export const servidor = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end(JSON.stringify({ status: 'ok', desde: process.uptime() }));
  }
  res.writeHead(404).end();
});`;

const SERVIDOR_CORRIGIDO = SERVIDOR_COM_BUG.replace("'text/plain'", "'application/json'");

const TESTE = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { servidor } from '../server.js';

test('/health responde JSON', async () => {
  servidor.listen(0);
  const r = await fetch(\`http://localhost:\${servidor.address().port}/health\`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\\/json/);
  servidor.close();
});`;

const PAGINA = `<!doctype html>
<html lang="pt-BR">
<meta charset="utf-8"><title>Status</title>
<h1>Status do serviço</h1>
<p id="estado" role="status">consultando…</p>
<script>
  fetch('/health').then((r) => r.json())
    .then((s) => { estado.textContent = s.status === 'ok' ? '🟢 no ar' : '🔴 fora do ar'; })
    .catch(() => { estado.textContent = '🔴 fora do ar'; });
</script>
</html>`;

const PAGINA_CORRIGIDA = PAGINA.replace("fetch('/health')", "fetch('/health', { signal: AbortSignal.timeout(3000) })");

const bloco = (caminho, conteudo) => '```arquivo:' + caminho + '\n' + conteudo + '\n```';

// Falas por agente do time padrão; agente criado na tela cai no genérico, pelo papel.
// Cada fala devolve { texto, arquivos: { caminho: conteudo } }. `vez` conta a partir de 1.
// As falas olham o estado da "pasta" (c) e o recado recebido (prompt), não quantas vezes o agente já falou:
// assim a história fecha em qualquer arquitetura (único, dupla, esteira, hierárquica, rede…).
const pediuCorrecao = (prompt) => /O portão rodou|O Revisor devolveu|VEREDITO: DEVOLVER/.test(prompt); // na rede, a devolução vem no contexto
const servidorComBug = (c) => Boolean(c.get('server.js')?.includes("'text/plain'"));
const paginaSemPrazo = (c) => c.has('public/index.html') && !c.get('public/index.html').includes('AbortSignal');

const FALAS = {
  maestro: () => ({ texto: 'Coordeno, não executo. Mande o pedido para o Time que eu divido o trabalho.' }),
  scout: () => ({
    texto: 'Referência: health check responde **200** com corpo JSON e `Content-Type: application/json`; '
      + 'o próprio `node:http` resolve, sem biblioteca. Quem consome (balanceador, Kubernetes) só olha o código de status.',
  }),
  chevron: ({ c, prompt }) => {
    if (servidorComBug(c) && pediuCorrecao(prompt)) {
      return {
        texto: `O portão tem razão: eu mandava \`text/plain\`. Corrigido para \`application/json\`; o teste ficou como estava.\n\n${bloco('server.js', SERVIDOR_CORRIGIDO)}`,
        arquivos: { 'server.js': SERVIDOR_CORRIGIDO },
      };
    }
    if (c.has('server.js') && !servidorComBug(c)) return { texto: 'O /health já responde JSON e o teste passa. Nada a mudar na minha parte.' };
    return {
      texto: `Endpoint pronto em \`server.js\`, com teste.\n\n${bloco('server.js', SERVIDOR_COM_BUG)}\n\n${bloco('test/health.test.mjs', TESTE)}`,
      arquivos: { 'server.js': SERVIDOR_COM_BUG, 'test/health.test.mjs': TESTE },
    };
  },
  pixel: ({ c, prompt }) => {
    if (paginaSemPrazo(c) && pediuCorrecao(prompt)) {
      return {
        texto: `Justo. O fetch agora desiste em 3 s e a página mostra "fora do ar" em vez de ficar em "consultando…".\n\n${bloco('public/index.html', PAGINA_CORRIGIDA)}`,
        arquivos: { 'public/index.html': PAGINA_CORRIGIDA },
      };
    }
    if (c.has('public/index.html')) return { texto: 'A página já está na pasta. Nada a mudar na minha parte.' };
    return {
      texto: `Página em \`public/index.html\`: lê o /health e mostra o estado num \`role="status"\`, que o leitor de tela anuncia.\n\n${bloco('public/index.html', PAGINA)}`,
      arquivos: { 'public/index.html': PAGINA },
    };
  },
  revisor: ({ c }) => {
    if (paginaSemPrazo(c)) {
      return { texto: 'Li o diff e a saída do portão. A página fica presa em "consultando…" se o servidor travar.\n\nVEREDITO: DEVOLVER\n'
        + '- public/index.html: o fetch do /health não tem tempo limite; servidor travado deixa a tela em "consultando…" para sempre' };
    }
    if (servidorComBug(c)) {
      return { texto: 'O portão não aprovou e o servidor continua mandando `text/plain`.\n\nVEREDITO: DEVOLVER\n- server.js: o /health responde JSON com Content-Type text/plain' };
    }
    if (!c.size) return { texto: 'Não há nada na pasta para revisar.\n\nVEREDITO: APROVADO' };
    return { texto: `Reli ${[...c.keys()].map((k) => `\`${k}\``).join(', ')}. O /health responde JSON${c.has('public/index.html') ? ' e a página desiste em 3 s' : ''}; o teste continua igual.\n\nVEREDITO: APROVADO` };
  },
};

// Na rede, quem cada um escolhe para continuar (só vale se a pessoa estiver entre os vizinhos).
const CORRENTE = {
  scout: () => 'Chevron',
  chevron: (c) => (c.has('public/index.html') ? 'Revisor' : 'Pixel'),
  pixel: () => 'Revisor',
  revisor: (c) => (paginaSemPrazo(c) ? 'Pixel' : servidorComBug(c) ? 'Chevron' : 'ninguém'),
};

function falaGenerica(agente, escrita, vez) {
  if (!escrita) return { texto: `${agente.papel}: li o que o time entregou e não tenho nada a acrescentar.` };
  const caminho = `notas/${agente.id}.md`;
  const conteudo = `# ${agente.nome} (${agente.papel})\n\nParte de "${PEDIDO_DO_ROTEIRO}", versão ${vez}.`;
  return { texto: `Minha parte (${agente.papel}) ficou em \`${caminho}\`.\n\n${bloco(caminho, conteudo)}`, arquivos: { [caminho]: conteudo } };
}

// Camadas e memória do roteiro valem entre pedidos (cada pedido cria uma ponte nova): ficam no módulo.
const camadas = { regras: '', memoria: '', skills: {} };

// ritmo: 1 = velocidade de apresentação; 0 = sem espera (testes).
export function criarPonteFalsa({ agentes = [], ritmo = 1 } = {}) {
  const esperar = (ms) => (ritmo > 0 ? new Promise((r) => setTimeout(r, ms * ritmo)) : Promise.resolve());
  const vezes = {};
  const gravados = new Map(); // caminho -> id de quem escreveu por último
  const conteudos = new Map(); // a "pasta" do roteiro: caminho -> conteúdo
  const fotos = new Map(); // id -> cópia de `conteudos`
  const comoHashes = (m) => Object.fromEntries(m); // no roteiro, o próprio conteúdo serve de hash


  return {
    roteiro: true,
    provedores: async () => ({ modos: Object.fromEntries(PROVEDORES.map((p) => [p, 'roteiro'])), chaves: [], roteiro: true }),
    pastaPadrao: async () => '(roteiro falso: nada é gravado no disco)',
    escolherPasta: async () => null,

    async executarAgente({ agente: id, escrita = false, prompt = '' } = {}) {
      const agente = agentes.find((a) => a.id === id) ?? { id: id ?? 'agente', nome: id ?? 'Agente', papel: 'agente', provedor: 'claude' };
      const vez = (vezes[agente.id] = (vezes[agente.id] ?? 0) + 1);
      await esperar(1400 + 500 * (agentes.indexOf(agente) % 3));
      const fala = { ...(FALAS[agente.id]?.({ c: conteudos, prompt }) ?? falaGenerica(agente, escrita, vez)) };
      const opcoes = /opções: ([^)]*)\)/.exec(prompt ?? '')?.[1]?.split(', ') ?? null; // a rede pediu "PRÓXIMO:"
      if (opcoes) {
        const quer = CORRENTE[agente.id]?.(conteudos);
        if (quer === 'ninguém' || opcoes.includes(quer)) fala.texto += `\n\nPRÓXIMO: ${quer}`;
      }
      const caminhos = escrita ? Object.keys(fala.arquivos ?? {}) : [];
      caminhos.forEach((c) => { gravados.set(c, agente.id); conteudos.set(c, fala.arquivos[c]); });
      return { ok: true, saida: fala.texto, modo: 'roteiro', modelo: CATALOGO[agente.provedor]?.modelo, gravados: caminhos };
    },

    async arquivosAlterados() {
      return [...gravados.keys()];
    },

    async portao({ houveMudanca } = {}) {
      if (!houveMudanca) return { situacao: 'pulou' };
      await esperar(1200);
      const base = { comando: COMANDO_DO_ROTEIRO, origem: 'roteiro falso', ms: 900 };
      if (servidorComBug(conteudos)) { // o portão só reprova enquanto o bug do Content-Type estiver lá
        const resumo = [
          '✖ /health responde JSON',
          '  AssertionError: The input did not match /application\/json/',
          "  actual: 'text/plain'",
          '      at server.js:5',
          'ℹ tests 1 · pass 0 · fail 1',
        ].join('\n');
        return { ...base, situacao: 'falhou', codigo: 1, resumo, saida: resumo };
      }
      const resumo = '✔ /health responde JSON\nℹ tests 1 · pass 1 · fail 0';
      return { ...base, situacao: 'passou', codigo: 0, resumo, saida: resumo };
    },

    // R32–R35 no roteiro: a foto é uma cópia do mapa em memória.
    async tirarFoto() {
      const id = `roteiro-${fotos.size + 1}`;
      fotos.set(id, new Map(conteudos));
      return { id, arquivos: conteudos.size, grandes: [] };
    },

    async diffFoto({ id } = {}) {
      const foto = fotos.get(id);
      if (!foto) return { erro: 'a foto desta rodada não existe mais' };
      const m = compararFotos(comoHashes(foto), comoHashes(conteudos));
      const diffs = [['criado', m.criados], ['alterado', m.alterados], ['removido', m.removidos]].flatMap(([tipo, lista]) => lista.map((c) => {
        const texto = diffLinhas(foto.get(c) ?? '', conteudos.get(c) ?? '');
        const linhas = texto ? texto.split('\n') : [];
        return { caminho: c, tipo, texto, mais: linhas.filter((l) => l.startsWith('+')).length, menos: linhas.filter((l) => l.startsWith('-')).length };
      }));
      return { ...m, diffs, grandesNovos: [] };
    },

    async manterFoto({ id } = {}) {
      fotos.delete(id);
      return true;
    },

    async descartarFoto({ id } = {}) {
      const foto = fotos.get(id);
      if (!foto) return { erro: 'a foto desta rodada não existe mais' };
      const plano = planoDeDescarte(compararFotos(comoHashes(foto), comoHashes(conteudos)));
      plano.apagar.forEach((c) => { conteudos.delete(c); gravados.delete(c); });
      plano.restaurar.forEach((c) => conteudos.set(c, foto.get(c)));
      fotos.delete(id);
      return { apagados: plano.apagar, restaurados: plano.restaurar };
    },

    // R48–R50 no roteiro: camadas e memória em memória, como a "pasta".
    async lerCamadas() { return { ...camadas, skills: { ...camadas.skills } }; },
    async salvarCamadas({ regras, memoria, skills = {} } = {}) {
      if (typeof regras === 'string') camadas.regras = regras;
      if (typeof memoria === 'string') camadas.memoria = memoria;
      Object.assign(camadas.skills, skills);
      return { ok: true };
    },
    async anotarMemoria({ entrada } = {}) { camadas.memoria += `${entrada}\n`; return { ok: true }; },

    async executarComando({ comando } = {}) {
      return { ok: true, saida: `(roteiro falso: "${comando}" não rodou de verdade)` };
    },

    async abrir() {
      return 'roteiro falso: os arquivos só existem na conversa';
    },
  };
}
