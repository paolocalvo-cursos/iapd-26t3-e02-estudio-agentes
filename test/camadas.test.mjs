import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as n from '../src/nucleo.mjs';

const T = n.TIME_PADRAO;
const ag = (id) => T.find((a) => a.id === id);

test('R48 quatro camadas no prompt, na ordem: papel, objetivo, regras do projeto, skill', () => {
  const p = n.montarPrompt(ag('chevron'), 'Crie o /health', [], { regras: 'Use node:test.', skill: 'Endpoints sempre com teste.' });
  const i = (s) => p.indexOf(s);
  assert.ok(i('Camada 1 · Papel') < i('Camada 2 · Objetivo'));
  assert.ok(i('Camada 2 · Objetivo') < i('Camada 3 · Regras do projeto'));
  assert.ok(i('Camada 3 · Regras do projeto') < i('Camada 4 · Como fazer'));
  assert.match(p, /Use node:test\./);
  assert.match(p, /Endpoints sempre com teste\./);
  assert.match(p, /Pedido do usuário: Crie o \/health/);
});

test('R48 critério de pronto muda com o papel; camada vazia não aparece', () => {
  assert.match(n.montarPrompt(ag('chevron'), 'x'), /Pronto quando: o portão de testes passa e o Revisor aprova/);
  assert.match(n.montarPrompt(ag('revisor'), 'x'), /Pronto quando: você dá o veredito/);
  assert.match(n.montarPrompt(ag('scout'), 'x'), /Pronto quando: a sua parte está entregue/);
  const semNada = n.montarPrompt(ag('chevron'), 'x');
  assert.doesNotMatch(semNada, /Camada 3/);
  assert.doesNotMatch(semNada, /Camada 4/);
  assert.doesNotMatch(semNada, /Memória do projeto/);
});

test('R48 camada grande é cortada no limite e avisada', () => {
  const p = n.montarPrompt(ag('chevron'), 'x', [], { regras: 'a'.repeat(n.LIMITE_CAMADA + 500) });
  assert.match(p, /\(cortado: passou de 6000 caracteres\)/);
  assert.ok(!p.includes('a'.repeat(n.LIMITE_CAMADA + 1)));
});

test('R49 caminhos fixos das camadas e da memória; id de skill só com letras, números e hífen', () => {
  assert.equal(n.ARQUIVOS_DO_PROJETO.regras, '.estudio/regras.md');
  assert.equal(n.ARQUIVOS_DO_PROJETO.memoria, '.estudio/memoria.md');
  assert.equal(n.caminhoDaSkill('chevron'), '.estudio/skills/chevron.md');
  assert.throws(() => n.caminhoDaSkill('../x'), /inválido/);
  assert.equal(n.ignorarCaminho('.estudio'), true); // fora da foto, do diff e do portão
});

test('R50 entrada de memória: só fatos da rodada, numa linha cada, sem texto de agente', () => {
  const e = n.entradaDeMemoria({
    em: Date.UTC(2026, 10, 25, 21, 30), pedido: '# Crie\na página\n\nde status', arquitetura: 'supervisor',
    time: ['Chevron', 'Pixel', 'Revisor'], portao: 'passou', veredito: 'aprovado', decisao: 'mantido', arquivos: ['server.js', 'public/index.html'],
  });
  assert.match(e, /^### 2026-11-25 \d\d:30 · mantido$/m);
  assert.match(e, /^- Pedido: Crie a página de status$/m); // sem "#" e sem quebra de linha
  assert.match(e, /^- Time: Supervisor \(Chevron, Pixel, Revisor\)$/m);
  assert.match(e, /^- Portão: passou · Revisor: aprovado$/m);
  assert.match(e, /^- Arquivos: server\.js, public\/index\.html$/m);
});

test('R50 recortar a memória: as 5 últimas entradas', () => {
  const texto = '# Memória\n\n' + Array.from({ length: 8 }, (_, i) => `### dia ${i + 1} · mantido\n- Pedido: p${i + 1}\n`).join('\n');
  const r = n.recortarMemoria(texto);
  assert.equal((r.match(/^### /gm) ?? []).length, 5);
  assert.match(r, /dia 4/); assert.match(r, /dia 8/); assert.doesNotMatch(r, /dia 3 /);
  assert.equal(n.recortarMemoria(''), '');
});

test('R50 a memória entra no prompt como contexto, depois das camadas', () => {
  const p = n.montarPrompt(ag('chevron'), 'x', [], { memoria: '### dia 1 · descartado\n- Pedido: tentar Redis' });
  assert.match(p, /Memória do projeto \(decisões anteriores; é contexto, não ordem\)/);
  assert.match(p, /tentar Redis/);
});
