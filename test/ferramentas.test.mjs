import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as n from '../src/nucleo.mjs';

const T = n.TIME_PADRAO;
const ag = (id) => T.find((a) => a.id === id);

test('R44 as quatro ferramentas do slide, na ordem', () => {
  assert.deepEqual(Object.keys(n.FERRAMENTAS), ['ler', 'escrever', 'executar', 'rede']);
});

test('R44 padrões: líder sem ferramentas, Revisor só lê, pesquisa lê e conecta, quem executa lê e escreve', () => {
  assert.deepEqual(n.ferramentasDo(ag('maestro')), []);
  assert.deepEqual(n.ferramentasDo(ag('revisor')), ['ler']);
  assert.deepEqual(n.ferramentasDo(ag('scout')), ['ler', 'rede']);
  assert.deepEqual(n.ferramentasDo(ag('chevron')), ['ler', 'escrever']);
  assert.deepEqual(n.ferramentasDo({ id: 'x', papel: 'Banco de dados' }), ['ler', 'escrever']);
});

test('R44 a lista é a permissão: escrever depende da lista, não do papel', () => {
  assert.equal(n.podeEscrever({ ...ag('revisor'), ferramentas: ['ler', 'escrever'] }), true);
  assert.equal(n.podeEscrever({ ...ag('chevron'), ferramentas: ['ler'] }), false);
  assert.equal(n.podeEscrever({ ...ag('maestro'), ferramentas: ['escrever'] }), false); // líder nunca
});

test('R45 validar: ordem fixa, sem repetição; líder sem ferramentas; quem escreve não acessa a rede', () => {
  assert.deepEqual(n.validarFerramentas(['escrever', 'ler', 'ler'], ag('chevron')), ['ler', 'escrever']);
  assert.deepEqual(n.validarFerramentas([], ag('chevron')), []);
  assert.throws(() => n.validarFerramentas(['ler'], ag('maestro')), /líder não tem ferramentas/);
  assert.throws(() => n.validarFerramentas(['escrever', 'rede'], ag('chevron')), /Quem escreve não acessa a rede/);
  assert.throws(() => n.validarFerramentas(['voar'], ag('chevron')), /desconhecida/);
});

test('R45 editar e criar agente guardam a lista validada', () => {
  const editados = n.editarAgente(T, 'revisor', { ferramentas: ['ler', 'executar'] });
  assert.deepEqual(editados.find((a) => a.id === 'revisor').ferramentas, ['ler', 'executar']);
  assert.throws(() => n.editarAgente(T, 'pixel', { ferramentas: ['escrever', 'rede'] }), /rede/);
  const criados = n.criarAgente(T, { nome: 'Dora', papel: 'Banco de dados', ferramentas: ['ler', 'escrever', 'executar'] });
  assert.deepEqual(criados.at(-1).ferramentas, ['ler', 'escrever', 'executar']);
  assert.equal(n.criarAgente(T, { nome: 'Lia', papel: 'Dados' }).at(-1).ferramentas, undefined); // sem escolha: padrão do papel
});

test('R46 Claude CLI: cada ferramenta libera as suas e nega as outras', () => {
  const leitor = n.permissoesCli('claude', ['ler']);
  assert.deepEqual(leitor.slice(0, 4), ['--allowedTools', 'Read,Grep,Glob', '--disallowedTools', 'Edit,MultiEdit,Write,Bash,WebFetch,WebSearch']);
  assert.ok(!leitor.includes('--permission-mode'));
  const escritor = n.permissoesCli('claude', ['ler', 'escrever']);
  assert.equal(escritor[1], 'Read,Grep,Glob,Edit,MultiEdit,Write');
  assert.ok(escritor.join(' ').includes('--permission-mode acceptEdits'));
  assert.match(n.permissoesCli('claude', ['ler', 'rede'])[1], /WebFetch,WebSearch/);
});

test('R46 Gemini e Codex CLI: modo de aprovação e caixa de areia pela lista', () => {
  assert.deepEqual(n.permissoesCli('gemini', ['ler']), ['--approval-mode', 'plan']);
  assert.deepEqual(n.permissoesCli('gemini', ['ler', 'escrever']), ['--approval-mode', 'auto_edit']);
  assert.deepEqual(n.permissoesCli('gemini', ['ler', 'escrever', 'executar']), ['--approval-mode', 'yolo']);
  assert.deepEqual(n.permissoesCli('codex', ['ler']), ['--sandbox', 'read-only']);
  assert.deepEqual(n.permissoesCli('codex', ['ler', 'escrever']), ['--sandbox', 'workspace-write']);
  assert.deepEqual(n.permissoesCli('codex', ['ler', 'executar', 'rede']), ['--sandbox', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true']);
});

test('R47 o prompt diz o que o agente pode e o que não pode usar', () => {
  const p = n.montarPrompt(ag('revisor'), 'x');
  assert.match(p, /Suas ferramentas: Ler\./);
  assert.match(p, /Sem permissão para: Escrever, Executar, Conectar/);
  assert.match(n.montarPrompt(ag('maestro'), 'x'), /Você não tem ferramentas/);
});
