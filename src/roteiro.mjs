// R31: roteiro falso. Uma ponte com a mesma cara da real (preload.js), mas sem modelo, sem disco e sem custo.
// A orquestração de verdade (rodada, plano, execução, portão, revisão) roda por cima dela e repete a Demo 1:
// Pedido → Plano → Execução → Testes (o primeiro falha e volta para quem escreveu) → Decisão.
import { CATALOGO, PROVEDORES } from './nucleo.mjs';

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

const bloco = (caminho, conteudo) => '```arquivo:' + caminho + '\n' + conteudo + '\n```';

// Falas por agente do time padrão; agente criado na tela cai no genérico, pelo papel.
// Cada fala devolve { texto, arquivos: { caminho: conteudo } }. `vez` conta a partir de 1.
const FALAS = {
  maestro: () => ({ texto: 'Coordeno, não executo. Mande o pedido para o Time que eu divido o trabalho.' }),
  scout: () => ({
    texto: 'Referência: health check responde **200** com corpo JSON e `Content-Type: application/json`; '
      + 'o próprio `node:http` resolve, sem biblioteca. Quem consome (balanceador, Kubernetes) só olha o código de status.',
  }),
  chevron: (vez) => (vez === 1
    ? {
      texto: `Endpoint pronto em \`server.js\`, com teste.\n\n${bloco('server.js', SERVIDOR_COM_BUG)}\n\n${bloco('test/health.test.mjs', TESTE)}`,
      arquivos: { 'server.js': SERVIDOR_COM_BUG, 'test/health.test.mjs': TESTE },
    }
    : {
      texto: `O portão tem razão: eu mandava \`text/plain\`. Corrigido para \`application/json\`; o teste ficou como estava.\n\n${bloco('server.js', SERVIDOR_CORRIGIDO)}`,
      arquivos: { 'server.js': SERVIDOR_CORRIGIDO },
    }),
  pixel: () => ({
    texto: `Página em \`public/index.html\`: lê o /health e mostra o estado num \`role="status"\`, que o leitor de tela anuncia.\n\n${bloco('public/index.html', PAGINA)}`,
    arquivos: { 'public/index.html': PAGINA },
  }),
  revisor: () => ({
    texto: 'Li o diff e a saída do portão. A primeira versão mandava JSON com `text/plain`; o portão pegou e o Chevron corrigiu sem mexer no teste. '
      + 'Ainda falta: a página não trata resposta lenta (sem tempo limite no fetch). Não bloqueia. **Aprovo.**',
  }),
};

function falaGenerica(agente, escrita, vez) {
  if (!escrita) return { texto: `${agente.papel}: li o que o time entregou e não tenho nada a acrescentar.` };
  const caminho = `notas/${agente.id}.md`;
  const conteudo = `# ${agente.nome} (${agente.papel})\n\nParte de "${PEDIDO_DO_ROTEIRO}", versão ${vez}.`;
  return { texto: `Minha parte (${agente.papel}) ficou em \`${caminho}\`.\n\n${bloco(caminho, conteudo)}`, arquivos: { [caminho]: conteudo } };
}

// ritmo: 1 = velocidade de apresentação; 0 = sem espera (testes).
export function criarPonteFalsa({ agentes = [], ritmo = 1 } = {}) {
  const esperar = (ms) => (ritmo > 0 ? new Promise((r) => setTimeout(r, ms * ritmo)) : Promise.resolve());
  const vezes = {};
  const gravados = new Map(); // caminho -> id de quem escreveu por último
  let portoes = 0;

  // Arquivo que a falha cita: o server.js se alguém o escreveu; senão, o primeiro gravado.
  const citado = () => (gravados.has('server.js') ? 'server.js' : [...gravados.keys()][0]);

  return {
    roteiro: true,
    provedores: async () => ({ modos: Object.fromEntries(PROVEDORES.map((p) => [p, 'roteiro'])), chaves: [], roteiro: true }),
    pastaPadrao: async () => '(roteiro falso: nada é gravado no disco)',
    escolherPasta: async () => null,

    async executarAgente({ agente: id, escrita = false } = {}) {
      const agente = agentes.find((a) => a.id === id) ?? { id: id ?? 'agente', nome: id ?? 'Agente', papel: 'agente', provedor: 'claude' };
      const vez = (vezes[agente.id] = (vezes[agente.id] ?? 0) + 1);
      await esperar(1400 + 500 * (agentes.indexOf(agente) % 3));
      const fala = FALAS[agente.id]?.(vez) ?? falaGenerica(agente, escrita, vez);
      const caminhos = escrita ? Object.keys(fala.arquivos ?? {}) : [];
      caminhos.forEach((c) => gravados.set(c, agente.id));
      return { ok: true, saida: fala.texto, modo: 'roteiro', modelo: CATALOGO[agente.provedor]?.modelo, gravados: caminhos };
    },

    async arquivosAlterados() {
      return [...gravados.keys()];
    },

    async portao({ houveMudanca } = {}) {
      if (!houveMudanca) return { situacao: 'pulou' };
      portoes += 1;
      await esperar(1200);
      const base = { comando: COMANDO_DO_ROTEIRO, origem: 'roteiro falso', ms: 900 };
      if (portoes === 1) {
        const arquivo = citado();
        const resumo = [
          '✖ /health responde JSON',
          '  AssertionError: The input did not match /application\\/json/',
          "  actual: 'text/plain'",
          `      at ${arquivo}:5`,
          'ℹ tests 1 · pass 0 · fail 1',
        ].join('\n');
        return { ...base, situacao: 'falhou', codigo: 1, resumo, saida: resumo };
      }
      const resumo = '✔ /health responde JSON\nℹ tests 1 · pass 1 · fail 0';
      return { ...base, situacao: 'passou', codigo: 0, resumo, saida: resumo };
    },

    async executarComando({ comando } = {}) {
      return { ok: true, saida: `(roteiro falso: "${comando}" não rodou de verdade)` };
    },

    async abrir() {
      return 'roteiro falso: os arquivos só existem na conversa';
    },
  };
}
