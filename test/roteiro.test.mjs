import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as n from '../src/nucleo.mjs';
import { criarPonteFalsa, PEDIDO_DO_ROTEIRO, COMANDO_DO_ROTEIRO } from '../src/roteiro.mjs';

const T = n.TIME_PADRAO;
const porId = (id) => T.find((a) => a.id === id);
const chamar = (ponte, id, prompt = '') => ponte.executarAgente({ agente: id, escrita: n.podeEscrever(porId(id)), prompt });
const DEVOLVEU = 'Revisão 1 de 3. O Revisor devolveu o trabalho.';
const PORTAO = 'Tentativa 1 de 4. O portão rodou `npm test` e os testes falharam.';

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

  const correcao = await chamar(p, 'chevron', PORTAO);
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

test('R31 agente criado na tela recebe fala genérica; o portão só reprova o bug do server.js', async () => {
  const dba = { id: 'dba', nome: 'Dora', papel: 'Banco de dados', provedor: 'groq', palavras: [] };
  const p = criarPonteFalsa({ agentes: [...T, dba], ritmo: 0 });
  const r = await p.executarAgente({ agente: 'dba', escrita: true });
  assert.deepEqual(r.gravados, ['notas/dba.md']);
  assert.equal((await p.portao({ houveMudanca: true })).situacao, 'passou');
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
  await chamar(p, 'chevron'); await chamar(p, 'pixel'); await chamar(p, 'chevron', PORTAO);
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
  await chamar(p, 'chevron', PORTAO); // 2ª rodada: a correção
  const d = await p.diffFoto({ id });
  assert.deepEqual(d.alterados, ['server.js']);
  assert.deepEqual(d.diffs[0].texto.split('\n').filter((l) => /^[+-]/.test(l)).length, 2);
  await p.descartarFoto({ id });
  assert.equal(n.totalDeMudancas((await p.diffFoto({ id: (await p.tirarFoto()).id }))), 0);
});

test('R36 no roteiro: o Revisor devolve a página para o Pixel e aprova depois da correção', async () => {
  const p = criarPonteFalsa({ agentes: T, ritmo: 0 });
  const autoria = {};
  for (const id of ['chevron', 'pixel']) (await chamar(p, id)).gravados.forEach((c) => { autoria[c] = id; });
  await chamar(p, 'chevron', PORTAO); // o portão já tinha devolvido o text/plain
  const r1 = n.lerVeredito((await chamar(p, 'revisor')).saida);
  assert.equal(r1.veredito, 'devolver');
  assert.equal(n.decidirRevisao(r1.veredito, 1), 'devolver');
  assert.deepEqual(n.quemCorrige(r1.achados.join('\n'), autoria, ['chevron', 'pixel']), ['pixel']);
  assert.match((await chamar(p, 'pixel', DEVOLVEU)).saida, /AbortSignal\.timeout/);
  assert.equal(n.lerVeredito((await chamar(p, 'revisor')).saida).veredito, 'aprovado');
});

test('R31 roteiro coerente em qualquer arquitetura: esteira (Pixel antes do Chevron) e agente único', async () => {
  const e = criarPonteFalsa({ agentes: T, ritmo: 0 });
  await chamar(e, 'scout'); await chamar(e, 'pixel');
  assert.equal((await e.portao({ houveMudanca: true })).situacao, 'passou'); // ainda não há server.js com bug
  await chamar(e, 'chevron');
  assert.equal((await e.portao({ houveMudanca: true })).situacao, 'falhou');
  await chamar(e, 'chevron', PORTAO);
  assert.equal((await e.portao({ houveMudanca: true })).situacao, 'passou');
  assert.equal(n.lerVeredito((await chamar(e, 'revisor')).saida).veredito, 'devolver'); // a página ainda sem prazo

  const u = criarPonteFalsa({ agentes: T, ritmo: 0 });
  await chamar(u, 'chevron'); await chamar(u, 'chevron', PORTAO);
  const r = (await chamar(u, 'revisor')).saida;
  assert.equal(n.lerVeredito(r).veredito, 'aprovado'); // só o servidor, já corrigido: nada a devolver
  assert.doesNotMatch(r, /página/);
});

test('R42 no roteiro: a rede escolhe o próximo pelo estado da pasta', async () => {
  const p = criarPonteFalsa({ agentes: T, ritmo: 0 });
  const opcoes = (nomes) => n.instrucaoProximo(nomes);
  assert.match((await chamar(p, 'chevron', opcoes(['Pixel', 'Scout', 'Revisor']))).saida, /PRÓXIMO: Pixel$/);
  assert.match((await chamar(p, 'pixel', opcoes(['Chevron', 'Revisor']))).saida, /PRÓXIMO: Revisor$/);
  assert.match((await chamar(p, 'revisor', opcoes(['Pixel', 'Chevron']))).saida, /PRÓXIMO: Pixel$/);
});
