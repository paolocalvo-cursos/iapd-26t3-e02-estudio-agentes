import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as n from '../src/nucleo.mjs';

const REVISOR = n.TIME_PADRAO.find((a) => a.id === 'revisor');
const CHEVRON = n.TIME_PADRAO.find((a) => a.id === 'chevron');

test('R36 veredito APROVADO ou DEVOLVER, sem acento e sem caixa; vale o último', () => {
  assert.equal(n.lerVeredito('Tudo certo.\nVEREDITO: APROVADO').veredito, 'aprovado');
  assert.equal(n.lerVeredito('veredito: devolver\n- a.js: x').veredito, 'devolver');
  assert.equal(n.lerVeredito('Veredito: Devolvido\n- a.js: x').veredito, 'devolver');
  assert.equal(n.lerVeredito('VEREDITO: DEVOLVER\n- a.js: x\n\nDepois de olhar de novo:\nVEREDITO: APROVADO').veredito, 'aprovado');
  assert.equal(n.lerVeredito('**Veredito:** aprovado').veredito, 'aprovado');
  assert.equal(n.lerVeredito('Parece bom.').veredito, 'sem-veredito');
});

test('R36 achados: as linhas com "-" ou "*" depois do veredito DEVOLVER', () => {
  const v = n.lerVeredito('Olhei o diff.\n- isto é antes, não conta\nVEREDITO: DEVOLVER\n- public/index.html: fetch sem tempo limite\n* server.js: 404 sem corpo\n\nObs.: o resto está ok.');
  assert.deepEqual(v.achados, ['public/index.html: fetch sem tempo limite', 'server.js: 404 sem corpo']);
  assert.deepEqual(n.lerVeredito('VEREDITO: APROVADO\n- detalhe').achados, []);
});

test('R37 devolve até 2 vezes; aprovado ou sem veredito segue', () => {
  assert.equal(n.decidirRevisao('aprovado', 1), 'seguir');
  assert.equal(n.decidirRevisao('sem-veredito', 1), 'seguir');
  assert.equal(n.decidirRevisao('devolver', 1), 'devolver');
  assert.equal(n.decidirRevisao('devolver', n.MAX_REVISOES), 'devolver');
  assert.equal(n.decidirRevisao('devolver', n.MAX_REVISOES + 1), 'desistir');
});

test('R37 a devolução vai para quem escreveu o arquivo citado pelo Revisor', () => {
  const v = n.lerVeredito('VEREDITO: DEVOLVER\n- public/index.html: fetch sem tempo limite');
  const autoria = { 'server.js': 'chevron', 'public/index.html': 'pixel' };
  assert.deepEqual(n.quemCorrige(v.achados.join('\n'), autoria, ['chevron', 'pixel']), ['pixel']);
});

test('R38 a mensagem de devolução diz a rodada, os achados e proíbe enfraquecer testes', () => {
  const m = n.falhaDaRevisao({ achados: ['a.js: x'], texto: 'VEREDITO: DEVOLVER\n- a.js: x' }, 1);
  assert.equal(m.nome, 'Revisor');
  assert.match(m.texto, /Revisão 1 de 3/);
  assert.match(m.texto, /- a\.js: x/);
  assert.match(m.texto, /não apague nem enfraqueça testes/);
  const semLista = n.falhaDaRevisao({ achados: [], texto: 'VEREDITO: DEVOLVER, o nome está errado' }, 2);
  assert.match(semLista.texto, /o nome está errado/);
});

test('R38 só o Revisor recebe a instrução do veredito no prompt', () => {
  assert.match(n.montarPrompt(REVISOR, 'pedido'), /VEREDITO: APROVADO/);
  assert.doesNotMatch(n.montarPrompt(CHEVRON, 'pedido'), /VEREDITO/);
});
