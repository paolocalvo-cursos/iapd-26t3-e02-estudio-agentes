import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as n from '../src/nucleo.mjs';

const arq = (caminho, tamanho = 10) => ({ caminho, tamanho });

test('R32 foto: arquivo grande fica fora e é avisado; os outros entram', () => {
  const r = n.selecionarParaFoto([arq('a.js'), arq('video.mp4', 5_000_000), arq('b/c.css')]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.incluidos, ['a.js', 'b/c.css']);
  assert.deepEqual(r.grandes, ['video.mp4']);
});

test('R32 foto: pasta com arquivos demais ou pesada demais não é fotografada', () => {
  const muitos = Array.from({ length: n.LIMITES_FOTO.arquivos + 1 }, (_, i) => arq(`f${i}.txt`));
  assert.equal(n.selecionarParaFoto(muitos).ok, false);
  assert.match(n.selecionarParaFoto(muitos).motivo, /arquivos/);
  const pesados = Array.from({ length: 30 }, (_, i) => arq(`f${i}.bin`, 1_900_000));
  assert.equal(n.selecionarParaFoto(pesados).ok, false);
  assert.match(n.selecionarParaFoto(pesados).motivo, /MB/);
});

test('R33 comparar fotos: criados, alterados e removidos, em ordem', () => {
  const antes = { 'a.js': 'h1', 'b.js': 'h2', 'c.js': 'h3' };
  const depois = { 'a.js': 'h1', 'b.js': 'h9', 'd.js': 'h4', 'b/z.js': 'h5' };
  assert.deepEqual(n.compararFotos(antes, depois), { criados: ['b/z.js', 'd.js'], alterados: ['b.js'], removidos: ['c.js'] });
  assert.equal(n.totalDeMudancas(n.compararFotos(antes, antes)), 0);
});

test('R34 diff de linhas: só o trecho que mudou, com 3 linhas de contexto e cabeçalho @@', () => {
  const antes = Array.from({ length: 20 }, (_, i) => `linha ${i + 1}`).join('\n');
  const depois = antes.replace('linha 10', 'linha DEZ');
  const d = n.diffLinhas(antes, depois);
  assert.deepEqual(d.split('\n'), [
    '@@ -7,7 +7,7 @@',
    ' linha 7', ' linha 8', ' linha 9', '-linha 10', '+linha DEZ', ' linha 11', ' linha 12', ' linha 13',
  ]);
});

test('R34 diff de linhas: arquivo novo vira tudo "+"; arquivo apagado vira tudo "-"', () => {
  assert.equal(n.diffLinhas('', 'a\nb'), '@@ -0,0 +1,2 @@\n+a\n+b');
  assert.equal(n.diffLinhas('a\nb', ''), '@@ -1,2 +0,0 @@\n-a\n-b');
  assert.equal(n.diffLinhas('igual', 'igual'), '');
});

test('R34 diff de linhas: duas mudanças distantes viram dois trechos', () => {
  const antes = Array.from({ length: 30 }, (_, i) => `l${i + 1}`).join('\n');
  const depois = antes.replace('l2\n', 'l2x\n').replace('l28', 'l28x');
  const trechos = n.diffLinhas(antes, depois).split('\n').filter((l) => l.startsWith('@@'));
  assert.deepEqual(trechos, ['@@ -1,5 +1,5 @@', '@@ -25,6 +25,6 @@']);
});

test('R34 diff de linhas: binário e arquivo enorme não são comparados linha a linha', () => {
  assert.equal(n.diffLinhas('a\0b', 'c'), null);
  const grande = Array.from({ length: 3000 }, (_, i) => `x${i}`).join('\n');
  const outro = Array.from({ length: 3000 }, (_, i) => `y${i}`).join('\n');
  assert.equal(n.diffLinhas(grande, outro), null);
});

test('R35 descartar: apaga o que foi criado e restaura o que mudou ou sumiu', () => {
  const plano = n.planoDeDescarte({ criados: ['novo.js'], alterados: ['a.js'], removidos: ['b.js'] });
  assert.deepEqual(plano, { apagar: ['novo.js'], restaurar: ['a.js', 'b.js'] });
});

test('R35 descartar: caminho inseguro no plano é recusado', () => {
  assert.throws(() => n.planoDeDescarte({ criados: ['../fora.js'], alterados: [], removidos: [] }), /inseguro/);
  assert.throws(() => n.planoDeDescarte({ criados: [], alterados: ['/etc/passwd'], removidos: [] }), /inseguro/);
});

test('R35 id de foto só com letras minúsculas, números e hífen', () => {
  assert.equal(n.idDeFotoValido('f1764100000000-ab12'), true);
  assert.equal(n.idDeFotoValido('../../etc'), false);
  assert.equal(n.idDeFotoValido(''), false);
});

test('R34 diff de linhas: a quebra de linha final não vira linha vazia de contexto', () => {
  assert.equal(n.diffLinhas('um\ndois\n', 'um\nDOIS\n'), '@@ -1,2 +1,2 @@\n um\n-dois\n+DOIS');
});
