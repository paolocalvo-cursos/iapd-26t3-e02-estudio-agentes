import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as n from '../src/nucleo.mjs';
import { criarPonteFalsa, PEDIDO_DO_ROTEIRO, COMANDO_DO_ROTEIRO } from '../src/roteiro.mjs';

const T = n.TIME_PADRAO;
const porId = (id) => T.find((a) => a.id === id);
const chamar = (ponte, id) => ponte.executarAgente({ agente: id, escrita: n.podeEscrever(porId(id)), prompt: '' });

test('R31 o pedido do roteiro monta o time da Demo 1: Chevron e Pixel executam, Revisor fecha', () => {
  const { etapas } = n.montarTime(T, n.rodadaDePropostas(T, PEDIDO_DO_ROTEIRO));
  assert.deepEqual(etapas.at(-1), ['revisor']);
  assert.deepEqual([...etapas.at(-2)].sort(), ['chevron', 'pixel']);
});

test('R31 sequência: portão falha citando server.js, volta só para o Chevron e passa na 2ª rodada', async () => {
  const p = criarPonteFalsa({ agentes: T, ritmo: 0 });
  const autoria = {};
  const anotar = (r, id) => r.gravados.forEach((c) => { autoria[c] = id; });
  for (const id of ['chevron', 'pixel']) anotar(await chamar(p, id), id);

  const r1 = await p.portao({ houveMudanca: (await p.arquivosAlterados()).length > 0 });
  assert.equal(r1.situacao, 'falhou');
  assert.equal(r1.comando, COMANDO_DO_ROTEIRO);
  assert.equal(n.decidirPortao(r1.situacao, 1), 'devolver');
  assert.deepEqual(n.quemCorrige(r1.resumo, autoria, ['chevron', 'pixel']), ['chevron']);

  const correcao = await chamar(p, 'chevron');
  assert.match(correcao.saida, /application\/json/);
  assert.deepEqual(correcao.gravados, ['server.js']);

  const r2 = await p.portao({ houveMudanca: true });
  assert.equal(r2.situacao, 'passou');
  assert.equal(n.decidirPortao(r2.situacao, 2), 'seguir');
  assert.deepEqual((await p.arquivosAlterados()).sort(), ['public/index.html', 'server.js', 'test/health.test.mjs']);
});

test('R31 quem não escreve (pesquisa, revisão, coordenador) não grava arquivo', async () => {
  const p = criarPonteFalsa({ agentes: T, ritmo: 0 });
  for (const id of ['scout', 'revisor', 'maestro']) {
    const r = await chamar(p, id);
    assert.ok(r.ok && r.saida);
    assert.deepEqual(r.gravados, []);
  }
  assert.deepEqual(await p.arquivosAlterados(), []);
  assert.equal((await p.portao({ houveMudanca: false })).situacao, 'pulou');
});

test('R31 agente criado na tela recebe fala genérica e a falha cita o arquivo dele', async () => {
  const dba = { id: 'dba', nome: 'Dora', papel: 'Banco de dados', provedor: 'groq', palavras: [] };
  const p = criarPonteFalsa({ agentes: [...T, dba], ritmo: 0 });
  const r = await p.executarAgente({ agente: 'dba', escrita: true });
  assert.deepEqual(r.gravados, ['notas/dba.md']);
  const falha = await p.portao({ houveMudanca: true });
  assert.deepEqual(n.quemCorrige(falha.resumo, { 'notas/dba.md': 'dba' }, ['dba']), ['dba']);
});

test('R31 o roteiro marca todos os provedores como "roteiro" e não abre arquivo', async () => {
  const p = criarPonteFalsa({ agentes: T, ritmo: 0 });
  const { modos, roteiro } = await p.provedores();
  assert.equal(roteiro, true);
  assert.ok(n.PROVEDORES.every((x) => modos[x] === 'roteiro'));
  assert.match(await p.abrir({ caminho: 'server.js' }), /roteiro falso/);
});

test('R35 no roteiro: o diff mostra o que a rodada criou e Descartar esvazia a pasta de novo', async () => {
  const p = criarPonteFalsa({ agentes: T, ritmo: 0 });
  const { id } = await p.tirarFoto();
  await chamar(p, 'chevron'); await chamar(p, 'pixel'); await chamar(p, 'chevron');
  const d = await p.diffFoto({ id });
  assert.deepEqual(d.criados, ['public/index.html', 'server.js', 'test/health.test.mjs']);
  const server = d.diffs.find((x) => x.caminho === 'server.js');
  assert.match(server.texto, /^\+.*application\/json/m); // a versão corrigida, não a do bug
  assert.deepEqual(await p.descartarFoto({ id }), { apagados: d.criados, restaurados: [] });
  assert.deepEqual(await p.arquivosAlterados(), []);
  assert.match((await p.descartarFoto({ id })).erro, /não existe/);
});

test('R35 no roteiro: Descartar da 2ª rodada devolve o arquivo da 1ª', async () => {
  const p = criarPonteFalsa({ agentes: T, ritmo: 0 });
  await chamar(p, 'chevron'); // 1ª rodada, mantida: server.js com o bug
  const { id } = await p.tirarFoto();
  await chamar(p, 'chevron'); // 2ª rodada: a correção
  const d = await p.diffFoto({ id });
  assert.deepEqual(d.alterados, ['server.js']);
  assert.deepEqual(d.diffs[0].texto.split('\n').filter((l) => /^[+-]/.test(l)).length, 2);
  await p.descartarFoto({ id });
  assert.equal(n.totalDeMudancas((await p.diffFoto({ id: (await p.tirarFoto()).id }))), 0);
});
