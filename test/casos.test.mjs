import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as n from '../src/nucleo.mjs';

const plano = (caso) => {
  const c = n.montarCaso(caso);
  return { c, p: n.montarPlano(c.arquitetura, c.agentes, n.rodadaDePropostas(c.agentes, c.pedido), c) };
};
const nome = (c, id) => c.agentes.find((a) => a.id === id).nome;

test('R51 cinco casos da Aula 17, cada um com arquitetura, time, pedido e juiz', () => {
  assert.deepEqual(Object.keys(n.CASOS_AULA17), ['caso2', 'caso3', 'caso4', 'caso5', 'caso6']);
  for (const id of Object.keys(n.CASOS_AULA17)) {
    const c = n.montarCaso(id);
    assert.ok(n.ARQUITETURAS[c.arquitetura], id);
    assert.equal(c.agentes.filter((a) => a.coordenador).length, 1, id);
    assert.ok(c.pedido && c.juiz && c.porque, id);
    c.agentes.forEach((a) => assert.deepEqual(n.validarFerramentas(n.ferramentasDo(a), a), n.ferramentasDo(a)));
  }
});

test('R51 o juiz de cada caso é um verificador (só lê) ou o portão; quem lê de fora não escreve', () => {
  const c2 = n.montarCaso('caso2');
  c2.agentes.filter((a) => a.papel === 'Auditoria de segurança').forEach((a) => assert.deepEqual(n.ferramentasDo(a), ['ler']));
  for (const id of ['caso2', 'caso4', 'caso5']) {
    const juiz = n.montarCaso(id).agentes.filter(n.ehRevisor);
    assert.ok(juiz.length === 1 && n.ferramentasDo(juiz[0]).every((f) => f === 'ler'), id);
  }
});

test('R51 caso 2 (supervisor): auditores leem em paralelo, o relator escreve, o revisor confere', () => {
  const { c, p } = plano('caso2');
  assert.equal(p.lider, 'maestro');
  assert.deepEqual([...p.etapas[0]].sort(), ['auditor-a', 'auditor-b', 'auditor-c']);
  assert.deepEqual(p.etapas[1], ['relator']);
  assert.equal(nome(c, p.etapas[2][0]), 'Revisor');
});

test('R51 caso 3 (hierárquica): três frentes com dono (back, front, dados)', () => {
  const { p } = plano('caso3');
  const frentes = p.etapas.find((e) => e.frentes).frentes.map((f) => f[0]).sort();
  assert.deepEqual(frentes, ['chevron', 'dora', 'pixel']);
});

test('R51 caso 4 (esteira): objetivos → conteúdo → atividades → avaliação → conferente', () => {
  const { p } = plano('caso4');
  assert.deepEqual(p.etapas, [['objetivos'], ['conteudo'], ['atividades'], ['avaliacao'], ['conferente']]);
  assert.equal(p.lider, null);
});

test('R51 caso 5 (rede escolhida): começa por uma defesa; cada defesa passa à próxima ou ao avaliador', () => {
  const { p } = plano('caso5');
  assert.equal(p.rede.inicio, 'relacional');
  assert.deepEqual(p.rede.vizinhos.relacional, ['documentos', 'avaliador']);
  assert.deepEqual(p.rede.vizinhos.planilha, ['avaliador']);
  assert.deepEqual([...p.rede.vizinhos.avaliador].sort(), ['documentos', 'planilha', 'relacional']);
});

test('R51 caso 6 (agente único): um agente só, sem líder e sem revisor', () => {
  const { p } = plano('caso6');
  assert.deepEqual(p.etapas, [['chevron']]);
  assert.equal(p.lider, null);
});

test('R52 quem só lê roda antes de quem escreve; verificador marcado conta como revisor', () => {
  assert.equal(n.ehRevisor({ papel: 'Conferência', verifica: true }), true);
  assert.equal(n.ehRevisor({ papel: 'Conferência' }), false);
  const T = n.TIME_PADRAO;
  const { etapas } = n.montarTime(T, n.rodadaDePropostas(T, 'Pesquise a documentação oficial e crie a página de status com endpoint /health'));
  assert.deepEqual(etapas[0], ['scout']); // pesquisa (só lê) primeiro, como antes
});
