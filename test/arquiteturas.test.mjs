import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as n from '../src/nucleo.mjs';

const T = n.TIME_PADRAO;
const PEDIDO = 'Crie uma página de status com um endpoint /health';
const plano = (arq, pedido = PEDIDO, extra = {}) => n.montarPlano(arq, T, n.rodadaDePropostas(T, pedido), extra);
const nomes = (etapas) => etapas.map((e) => (Array.isArray(e) ? e : e.frentes.flat()));

test('R39 os 8 modelos: 5 arquiteturas, 2 variações e o construtor', () => {
  assert.deepEqual(Object.keys(n.ARQUITETURAS), ['unico', 'supervisor', 'hierarquica', 'esteira', 'rede', 'dupla', 'rede-escolhida', 'construtor']);
  assert.ok(Object.values(n.ARQUITETURAS).every((a) => a.nome && a.resumo));
  assert.deepEqual(Object.entries(n.ARQUITETURAS).filter(([, a]) => a.lider).map(([k]) => k), ['supervisor', 'hierarquica']);
});

test('R40 agente único: o de maior confiança faz tudo, sem líder e sem revisor', () => {
  const p = plano('unico');
  assert.deepEqual(p.etapas, [['chevron']]);
  assert.equal(p.lider, null);
});

test('R40 supervisor: o plano de sempre (R5), falado pelo líder', () => {
  const p = plano('supervisor');
  assert.equal(p.lider, 'maestro');
  assert.deepEqual(nomes(p.etapas).at(-1), ['revisor']);
  assert.match(p.mensagem, /Revisor, acompanha no final/);
});

test('R40 hierárquica: uma frente por área, cada uma com sub-líder, e o Revisor no fim', () => {
  const p = plano('hierarquica');
  const frentes = p.etapas.find((e) => e.frentes);
  assert.deepEqual(frentes.frentes.map((f) => f[0]).sort(), ['chevron', 'pixel']);
  assert.deepEqual(p.etapas.at(-1), ['revisor']);
  assert.equal(p.lider, 'maestro');
  assert.match(p.mensagem, /frentes/);
});

test('R40 esteira: todos menos o coordenador, um por vez, em ordem fixa, sem líder', () => {
  const p = plano('esteira', 'qualquer coisa');
  assert.deepEqual(p.etapas, [['scout'], ['pixel'], ['chevron'], ['revisor']]);
  assert.equal(p.lider, null);
});

test('R40 dupla com revisão: um escreve, o Revisor confere', () => {
  assert.deepEqual(plano('dupla').etapas, [['chevron'], ['revisor']]);
});

test('R40 construtor: as etapas que você montou, sem agente que não existe', () => {
  const p = plano('construtor', PEDIDO, { etapasConstrutor: [['pixel', 'chevron'], [], ['fantasma'], ['revisor']] });
  assert.deepEqual(p.etapas, [['pixel', 'chevron'], ['revisor']]);
  assert.match(plano('construtor', PEDIDO, { etapasConstrutor: [] }).erro, /construtor/);
});

test('R41 rede: começa pelo de maior confiança e todos são vizinhos de todos (menos o coordenador)', () => {
  const p = plano('rede');
  assert.equal(p.etapas, null);
  assert.equal(p.rede.inicio, 'chevron');
  assert.deepEqual(p.rede.vizinhos.chevron, ['pixel', 'scout', 'revisor']);
});

test('R41 rede com ligações escolhidas: cada um só passa para quem você ligou', () => {
  const p = plano('rede-escolhida', PEDIDO, { ligacoes: { chevron: ['revisor'], revisor: ['chevron', 'maestro'] } });
  assert.deepEqual(p.rede.vizinhos.chevron, ['revisor']);
  assert.deepEqual(p.rede.vizinhos.revisor, ['chevron']); // coordenador não entra na rede
  assert.deepEqual(p.rede.vizinhos.pixel, []);
});

test('R42 "PRÓXIMO:" escolhe o vizinho pelo nome; ninguém encerra; sem linha, vai o vizinho mais confiante ainda não visitado', () => {
  const props = n.rodadaDePropostas(T, PEDIDO);
  const base = { atual: 'chevron', vizinhos: ['pixel', 'scout', 'revisor'], visitas: { chevron: 1 }, propostas: props, agentes: T };
  assert.equal(n.escolherProximo({ ...base, texto: 'feito.\nPRÓXIMO: Revisor' }), 'revisor');
  assert.equal(n.escolherProximo({ ...base, texto: '**Próximo:** pixel.' }), 'pixel');
  assert.equal(n.escolherProximo({ ...base, texto: 'PROXIMO: ninguém, está pronto' }), null);
  assert.equal(n.escolherProximo({ ...base, texto: 'sem linha' }), 'pixel');
  assert.equal(n.escolherProximo({ ...base, texto: 'PRÓXIMO: Maestro' }), 'pixel'); // fora dos vizinhos: ignora a escolha
});

test('R42 rede sem pingue-pongue: quem já rodou 2 vezes não volta; sem vizinho livre, para', () => {
  const props = n.rodadaDePropostas(T, PEDIDO);
  const base = { atual: 'revisor', vizinhos: ['chevron'], propostas: props, agentes: T };
  assert.equal(n.escolherProximo({ ...base, visitas: { chevron: 2 }, texto: 'PRÓXIMO: Chevron' }), null);
  assert.equal(n.escolherProximo({ ...base, visitas: { chevron: 1 }, texto: 'sem linha' }), null); // já visitado e sem escolha
});

test('R42 a instrução do PRÓXIMO vai no prompt só quando há vizinhos', () => {
  const chevron = T.find((a) => a.id === 'chevron');
  assert.match(n.montarPrompt(chevron, 'x', [], { proximo: ['Pixel', 'Revisor'] }), /PRÓXIMO: <nome>.*Pixel, Revisor/s);
  assert.doesNotMatch(n.montarPrompt(chevron, 'x'), /PRÓXIMO/);
});

test('R43 qual usar: o tipo da tarefa decide, não o número de agentes', () => {
  const sug = (p) => n.sugerirArquitetura(p, T).id;
  assert.equal(sug('Corrija o erro de digitação no endpoint /health'), 'unico');
  assert.equal(sug(PEDIDO), 'supervisor');
  assert.equal(sug('Monte o sistema completo: tela de login, API de autenticação com banco de dados e um dashboard'), 'hierarquica');
  assert.equal(sug('Siga o processo de sempre: gerar o relatório, revisar e publicar, nessa ordem'), 'esteira');
  assert.equal(sug('Explore alternativas para cache, não sei qual caminho é melhor'), 'rede');
  assert.match(n.sugerirArquitetura(PEDIDO, T).motivo, /partes separáveis/);
});

test('R40 hierárquica: falha que só cita arquivo de outra frente não volta para esta', () => {
  const autoria = { 'server.js': 'chevron', 'public/index.html': 'pixel' };
  const resumo = '✖ /health\n      at server.js:5';
  assert.equal(n.falhaEDeOutros(resumo, autoria, ['pixel']), true);
  assert.equal(n.falhaEDeOutros(resumo, autoria, ['chevron']), false);
  assert.equal(n.falhaEDeOutros('falhou sem citar arquivo', autoria, ['pixel']), false);
});
