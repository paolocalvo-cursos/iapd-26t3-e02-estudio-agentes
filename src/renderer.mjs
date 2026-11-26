// Tela do Estúdio: desenha o estado e repassa os eventos ao núcleo.
import * as n from './nucleo.mjs';
import { criarPonteFalsa, PEDIDO_DO_ROTEIRO } from './roteiro.mjs';

const $ = (id) => document.getElementById(id);
const ponteReal = window.estudio; // ausente quando a tela é aberta direto no navegador
let ponte = ponteReal; // no roteiro falso (R31), a ponte falsa toma o lugar da real
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hora = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

// ---------- estado persistido ----------
const salvo = (chave, padrao) => { try { return JSON.parse(localStorage.getItem(chave)) ?? padrao; } catch { return padrao; } };
let agentes = salvo('agentes', n.TIME_PADRAO);
let conversas = salvo('conversas', []);
let atual = conversas[0] ?? n.novaConversa();
let pasta = salvo('pasta', null); // null = pasta padrão (~/estudio-projetos)
let roteiro = salvo('roteiro', false);
let arquitetura = salvo('arquitetura', 'supervisor'); // R39
let ligacoes = salvo('ligacoes', { scout: ['pixel', 'chevron'], pixel: ['revisor'], chevron: ['revisor'], revisor: ['pixel', 'chevron'] });
let etapasConstrutor = salvo('construtor', [['scout'], ['pixel', 'chevron'], ['revisor']]);
let pendente = salvo('pendente', null); // R35: { id, conversa } da rodada que espera Manter/Descartar
let pastaPadrao = '';

// ---------- estado da tela ----------
let estados = Object.fromEntries(agentes.map((a) => [a.id, 'disponivel']));
let destino = 'time';
let ocupado = false;
let provedores = { modos: {}, chaves: [] };
const baloes = new Map();
const saidas = new Map(); // comando executado -> saída
let confirmando = null; // id da foto cujo Descartar espera o segundo clique

function persistir() {
  conversas = [atual, ...conversas.filter((c) => c.id !== atual.id)].filter((c) => c.mensagens.length).slice(0, 30);
  localStorage.setItem('conversas', JSON.stringify(conversas));
  localStorage.setItem('agentes', JSON.stringify(agentes));
  localStorage.setItem('pasta', JSON.stringify(pasta));
  localStorage.setItem('roteiro', JSON.stringify(roteiro));
  localStorage.setItem('pendente', JSON.stringify(pendente));
  localStorage.setItem('arquitetura', JSON.stringify(arquitetura));
  localStorage.setItem('ligacoes', JSON.stringify(ligacoes));
  localStorage.setItem('construtor', JSON.stringify(etapasConstrutor));
}

// ---------- mascotes (SVG) ----------
function escurecer(hex, f = 0.72) {
  const v = parseInt(hex.slice(1), 16);
  const c = [v >> 16, (v >> 8) & 255, v & 255].map((x) => Math.round(x * f));
  return `rgb(${c.join(',')})`;
}

function rosto(id) {
  switch (id) {
    case 'chevron':
      return `<path d="M38 46l8 5-8 5M72 46l-8 5 8 5" stroke="#3a1a10" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <rect x="44" y="62" width="22" height="9" rx="2" fill="#3a1a10"/><path d="M47 62v9M52 62v9M57 62v9M62 62v9" stroke="#f3e6dc" stroke-width="2"/>`;
    case 'pixel':
      return `<g class="olho-piscar"><rect x="40" y="44" width="6" height="10" rx="2" fill="#3a2a10"/><rect x="64" y="44" width="6" height="10" rx="2" fill="#3a2a10"/></g>
        <path d="M48 62q7 6 14 0" stroke="#3a2a10" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    default:
      return `<g class="olho-piscar"><rect x="40" y="46" width="7" height="7" rx="1.5" fill="#3a1a10"/><rect x="63" y="46" width="7" height="7" rx="1.5" fill="#3a1a10"/></g>
        <rect x="49" y="62" width="12" height="4" rx="2" fill="#3a1a10"/>`;
  }
}

function mascote(a) {
  const c = a.cor; const s = escurecer(c);
  if (a.forma === 'estrela') {
    return `<svg viewBox="0 0 110 110"><defs><radialGradient id="g-${a.id}" cx="40%" cy="35%"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".45" stop-color="${c}"/><stop offset="1" stop-color="${s}"/></radialGradient></defs>
      <path d="M55 6C59 40 70 51 104 55C70 59 59 70 55 104C51 70 40 59 6 55C40 51 51 40 55 6Z" fill="url(#g-${a.id})"/>
      <g class="olho-piscar"><rect x="47" y="48" width="5" height="13" rx="2" fill="#fff"/><rect x="58" y="48" width="5" height="13" rx="2" fill="#fff"/></g></svg>`;
  }
  if (a.forma === 'nuvem') {
    return `<svg viewBox="0 0 110 110"><g fill="${c}">
      <circle cx="55" cy="30" r="20"/><circle cx="32" cy="40" r="17"/><circle cx="78" cy="40" r="17"/><circle cx="28" cy="62" r="16"/><circle cx="82" cy="62" r="16"/><circle cx="55" cy="66" r="26"/></g>
      <rect x="34" y="38" width="42" height="30" rx="8" fill="#0d1b3a"/><path d="M41 47l7 5-7 5" stroke="#8fd3ff" stroke-width="3" fill="none" stroke-linecap="round"/><rect x="52" y="55" width="13" height="3" rx="1.5" fill="#8fd3ff"/>
      <rect x="44" y="86" width="8" height="14" rx="3" fill="${s}"/><rect x="58" y="86" width="8" height="14" rx="3" fill="${s}"/></svg>`;
  }
  return `<svg viewBox="0 0 110 110">
    <rect x="22" y="18" width="10" height="12" rx="2" fill="${s}"/><rect x="78" y="18" width="10" height="12" rx="2" fill="${s}"/>
    <rect x="8" y="50" width="12" height="10" rx="2" fill="${s}"/><rect x="90" y="50" width="12" height="10" rx="2" fill="${s}"/>
    <rect x="18" y="26" width="74" height="62" rx="10" fill="${c}"/><rect x="18" y="74" width="74" height="14" rx="6" fill="${s}" opacity=".45"/>
    ${rosto(a.id)}
    <rect x="30" y="88" width="9" height="14" rx="2" fill="${s}"/><rect x="45" y="88" width="9" height="14" rx="2" fill="${s}"/>
    <rect x="57" y="88" width="9" height="14" rx="2" fill="${s}"/><rect x="72" y="88" width="9" height="14" rx="2" fill="${s}"/></svg>`;
}

const ROTULO_VEREDITO = { aprovado: '✓ aprovou', devolver: '↩ devolveu', 'sem-veredito': 'sem veredito' };
const ROTULO_ESTADO = { disponivel: 'Disponível', pensando: 'Pensando', trabalhando: 'Trabalhando', concluido: 'Concluído' };

// ---------- desenho ----------
function desenharPalco() {
  $('palco').innerHTML = agentes.map((a) => `
    <button class="agente ${destino === a.id ? 'selecionado' : ''}" data-id="${a.id}" data-estado="${estados[a.id] ?? 'disponivel'}" style="--cor:${a.cor}" title="${esc(a.papel)} · ${a.provedor}${a.modelo ? ' · ' + esc(a.modelo) : ''} · duplo clique: provedor e modelo${a.coordenador ? '' : ' · botão direito remove'}">
      ${baloes.has(a.id) ? `<div class="balao">${esc(baloes.get(a.id))}</div>` : ''}
      ${mascote(a)}
      <span class="nome">${esc(a.nome)}</span><span class="papel">${esc(a.papel)}</span>
      <span class="estado">${ROTULO_ESTADO[estados[a.id] ?? 'disponivel']}</span>
    </button>`).join('');
  $('status').textContent = n.resumoStatus(agentes, estados);
  const usados = [...new Set(agentes.map((a) => a.provedor))];
  const faltando = usados.filter((p) => !provedores.modos[p]);
  const ROTULO = { api: 'API', cli: 'CLI' };
  if (roteiro) {
    $('modo').textContent = '🎬 roteiro falso · nenhum modelo é chamado, nada vai para o disco';
    $('modo').title = 'Repete a Demo 1 com falas prontas. Clique em 🎬 para voltar aos agentes de verdade.';
  } else if (!ponte) {
    $('modo').textContent = 'abra pelo app (npm start)';
  } else if (provedores.gratuito) {
    $('modo').textContent = faltando.length
      ? 'modo gratuito ligado · falta GEMINI_API_KEY no .env'
      : `modo gratuito · todos os agentes no ${provedores.modeloGratuito}`;
    $('modo').title = 'MODO_GRATUITO=true no .env: todos usam o Gemini grátis; chaves pagas e CLIs são ignoradas';
  } else {
    $('modo').textContent = usados.map((p) => `${p}: ${ROTULO[provedores.modos[p]] ?? 'sem acesso'}`).join(' · ');
    $('modo').title = 'API = chave salva em 🔑 ou no .env · CLI = login da assinatura na linha de comando';
  }
  $('modo').classList.toggle('alerta', !roteiro && (!ponte || faltando.length > 0));
  $('modo').classList.toggle('roteiro', roteiro);
  $('btn-roteiro').classList.toggle('ativo', roteiro);
  $('modo').classList.toggle('gratis', Boolean(ponte && provedores.gratuito && !faltando.length));
  $('nome-arquitetura').textContent = n.ARQUITETURAS[arquitetura]?.nome ?? arquitetura;
  $('nome-projeto').textContent = roteiro ? 'roteiro falso' : pasta ? pasta.split(/[\\/]/).pop() : 'estudio-projetos (padrão)';
  $('btn-projeto').title = `${pasta || pastaPadrao}\nClique para escolher outra pasta`;
}

function desenharChips() {
  const chip = (id, nome, cor, extra = '') =>
    `<button type="button" class="chip ${destino === id ? 'ativo' : ''}" data-destino="${id}" style="--cor:${cor}">${cor ? '<i></i>' : '⁂'} ${esc(nome)}${extra}</button>`;
  $('chips').innerHTML = chip('time', 'Time', '') +
    agentes.map((a) => chip(a.id, a.nome, a.cor, estados[a.id] === 'trabalhando' ? ' •' : '')).join('');
  const alvo = agentes.find((a) => a.id === destino);
  $('destino-dica').textContent = alvo ? `Só ${alvo.nome} responde` : 'O time decide quem responde';
  $('entrada').placeholder = alvo ? `Fale com ${alvo.nome}...` : roteiro ? `Enter vazio usa: ${PEDIDO_DO_ROTEIRO}` : 'Fale com o time...';
}

function formatar(texto) {
  return esc(texto)
    .replace(/\n*```arquivo:([^\n`]+)\n([\s\S]*?)\n?```\n*/g,
      (_m, c, conteudo) => `<details class="arquivo"><summary>📄 ${c}</summary><pre>${conteudo}</pre></details>`)
    .replace(/\n*```[a-z]*\n?([\s\S]*?)\n?```\n*/g, (_m, c) => `<pre>${c}</pre>`)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
}

function desenharComandos(texto) {
  const cmds = n.extrairComandos(texto);
  if (!cmds.length) return '';
  return `<div class="comandos">${cmds.map(({ comando, sensivel }) => {
    const s = saidas.get(comando);
    return `<div class="comando ${sensivel ? 'sensivel' : ''}"><code title="${esc(comando)}">$ ${esc(comando)}</code>
      ${s ? '' : sensivel
        ? `<span class="aviso-sensivel">pede aprovação</span><button class="aprovar" data-cmd="${esc(comando)}">Aprovar</button><button class="negar" data-cmd="${esc(comando)}">Negar</button>`
        : `<button class="aprovar" data-cmd="${esc(comando)}">Executar</button>`}
    </div>${s ? `<div class="saida">${esc(s)}</div>` : ''}`;
  }).join('')}</div>`;
}

function desenharMensagens() {
  const porId = new Map(agentes.map((a) => [a.id, a]));
  const ag = (id) => porId.get(id) ?? { nome: id, cor: '#777', papel: '' };
  const html = atual.mensagens.map((m) => {
    if (m.autor === 'voce') return `<div class="msg-voce">${esc(m.texto)}<small>Você · ${hora(m.em)}</small></div>`;
    if (m.tipo === 'rodada') {
      return `<div class="rodada"><h3>Rodada de propostas</h3>${m.propostas.map((p) => {
        const a = ag(p.id);
        return `<div class="proposta ${p.aceita ? '' : 'passou'}" style="--cor:${a.cor}"><i></i><b>${esc(a.nome)}</b><span class="pct">${p.confianca}%</span>
          <div class="barra"><span style="width:${p.confianca}%"></span></div><p>${esc(p.fala)}</p></div>`;
      }).join('')}</div>`;
    }
    if (m.tipo === 'portao') {
      const ok = ['passou', 'pulou', 'desligado'].includes(m.situacao);
      const tempo = m.ms ? ` em ${(m.ms / 1000).toFixed(1)} s` : '';
      const cmd = m.comando ? ` <code>${esc(m.comando)}</code>` : '';
      const origem = m.origem ? `<small> (${esc(m.origem)})</small>` : '';
      const det = m.resumo || m.detalhe
        ? `<details><summary>saída</summary><pre>${esc(m.resumo || '')}</pre>${m.detalhe && m.detalhe !== m.resumo ? `<details><summary>saída completa</summary><pre>${esc(m.detalhe)}</pre></details>` : ''}</details>` : '';
      const caixa = m.isolado === true ? `<p class="isolamento">🔒 isolado: só a pasta do projeto${m.rede ? '' : ', sem rede'}, sem chaves</p>`
        : m.isolado === false ? '<p class="isolamento aberta">⚠ rodou SEM isolamento (PORTAO_ISOLAMENTO=desligado)</p>' : '';
      const motivo = m.motivo ? `<p class="isolamento aberta">${esc(m.motivo)}</p>` : '';
      return `<div class="rodada portao ${ok ? 'passou' : 'falhou'}"><h3>Portão de testes · rodada ${m.rodada}</h3>
        <p><b>${ROTULO_PORTAO[m.situacao] ?? esc(m.situacao)}</b>${cmd}${origem}${tempo}</p>${caixa}${motivo}${det}</div>`;
    }
    if (m.tipo === 'decisao') return desenharDecisao(m);
    if (m.tipo === 'sugestao') {
      const S = n.ARQUITETURAS[m.sugestao]; const A = n.ARQUITETURAS[m.atual];
      return `<div class="rodada sugestao"><h3>Qual usar, e quando</h3><p>O tipo da tarefa sugere <b>${esc(S.nome)}</b>: ${esc(m.motivo.toLowerCase())}. Este pedido roda em <b>${esc(A?.nome ?? m.atual)}</b>, como está escolhido.</p>
        ${arquitetura === m.sugestao ? '' : `<button type="button" data-arquitetura="${esc(m.sugestao)}">Usar ${esc(S.nome)} nos próximos pedidos</button>`}</div>`;
    }
    if (m.tipo === 'arquivos') {
      return `<div class="rodada arquivos"><h3>Arquivos criados ou alterados</h3>${m.arquivos.length
        ? m.arquivos.map((f) => `<button data-abrir="${esc(f)}">📄 ${esc(f)}</button>`).join('')
        : '<p>Nenhum arquivo mudou na pasta do projeto.</p>'}<button data-abrir="" class="pasta">📁 Abrir a pasta</button></div>`;
    }
    const a = m.autor === 'sistema' ? { nome: 'Estúdio', cor: '#777' } : ag(m.autor);
    return `<div class="msg ${m.erro ? 'falhou' : ''}" style="--cor:${a.cor}"><span class="avatar"></span><div>
      <div class="cab">${esc(a.nome)}<small>${hora(m.em)}</small>${m.erro ? '<span class="selo">falhou</span>' : ''}${m.veredito ? `<span class="selo veredito-${m.veredito}">${ROTULO_VEREDITO[m.veredito]}</span>` : ''}${m.gratis && !m.erro ? `<span class="selo gratis" title="${esc(m.modelo ?? '')}">Gemini grátis</span>` : ''}</div>
      <div class="corpo">${formatar(m.texto)}</div>
      ${m.time ? `<div class="etiquetas">${m.time.map((id) => `<span style="--cor:${ag(id).cor}">${esc(ag(id).nome)}</span>`).join('')}</div>` : ''}
      ${desenharComandos(m.texto)}</div></div>`;
  }).join('');
  const caixa = $('mensagens');
  caixa.innerHTML = html || '<p class="vazio">Peça algo ao time.<br>Ex.: “Crie uma página de status com um endpoint /health”.</p>';
  caixa.scrollTop = caixa.scrollHeight;
  $('titulo-conversa').textContent = atual.titulo;
}

// ---------- R35: card da decisão (passo 5) ----------
const SINAL = { criado: '+', alterado: '~', removido: '−' };

function linhasDoDiff(texto) {
  return texto.split('\n').map((l) => {
    const c = l.startsWith('@@') ? 'trecho' : l[0] === '+' ? 'mais' : l[0] === '-' ? 'menos' : '';
    return `<span class="${c}">${esc(l) || ' '}</span>`;
  }).join(''); // cada linha é um bloco: sem \n entre elas
}

function desenharDecisao(m) {
  if (m.estado === 'nada') {
    return '<div class="rodada decisao"><h3>Decisão</h3><p>Nada mudou na pasta do projeto.</p><button data-abrir="" class="pasta">📁 Abrir a pasta</button></div>';
  }
  const conta = (lista, um, varios) => (lista.length ? `${lista.length} ${lista.length > 1 ? varios : um}` : '');
  const placar = [conta(m.criados, 'criado', 'criados'), conta(m.alterados, 'alterado', 'alterados'), conta(m.removidos, 'removido', 'removidos')].filter(Boolean).join(' · ');
  const arquivos = m.diffs.map((d) => `<details class="diff-arquivo ${d.tipo}"><summary><b>${SINAL[d.tipo]}</b> ${esc(d.caminho)} <small>${d.mais ? `+${d.mais}` : ''} ${d.menos ? `−${d.menos}` : ''}</small>${d.tipo !== 'removido' ? `<button type="button" data-abrir="${esc(d.caminho)}" title="Abrir">↗</button>` : ''}</summary>
    ${d.texto ? `<pre class="diff">${linhasDoDiff(d.texto)}</pre>` : '<p class="nota">Binário ou grande demais para mostrar aqui.</p>'}</details>`).join('');
  const grandes = m.grandesNovos?.length ? `<p class="nota">⚠ Fora da foto (mais de 2 MB), o Descartar não mexe: ${m.grandesNovos.map(esc).join(', ')}</p>` : '';
  const ativa = m.estado === 'pendente' && pendente?.id === m.foto;
  let acoes;
  if (m.estado === 'mantido') acoes = `<p class="veredito ok">✓ Mantido${m.automatico ? ' (um novo pedido chegou antes da decisão)' : ''}.</p>`;
  else if (m.estado === 'descartado') acoes = `<p class="veredito">↩ Descartado: a pasta voltou a como estava antes do pedido (${m.resultado.apagados.length} apagado(s), ${m.resultado.restaurados.length} restaurado(s)).</p>`;
  else if (!ativa) acoes = '<p class="nota">Esta decisão não está mais disponível.</p>';
  else if (confirmando === m.foto) {
    acoes = `<p class="aviso-descarte">Descartar apaga ${m.criados.length} arquivo(s) criado(s) e devolve ${m.alterados.length + m.removidos.length} ao estado de antes do pedido. Não dá para desfazer.</p>
      <div class="botoes"><button type="button" class="perigo" data-decidir="descartar">Sim, descartar</button><button type="button" data-decidir="cancelar">Cancelar</button></div>`;
  } else {
    acoes = `<div class="botoes"><button type="button" class="primario" data-decidir="manter" ${ocupado ? 'disabled' : ''}>Manter</button><button type="button" data-decidir="confirmar" ${ocupado ? 'disabled' : ''}>Descartar</button></div>`;
  }
  return `<div class="rodada decisao ${m.estado}"><h3>Decisão · o que mudou na pasta</h3><p class="placar">${placar}</p>${arquivos}${grandes}${acoes}
    <button data-abrir="" class="pasta">📁 Abrir a pasta</button></div>`;
}

function marcarDecisao(id, mudanca) {
  const mexer = (c) => ({ ...c, mensagens: c.mensagens.map((m) => (m.tipo === 'decisao' && m.foto === id ? { ...m, ...mudanca } : m)) });
  atual = mexer(atual);
  conversas = conversas.map(mexer);
}

// Manter apaga a foto; Descartar devolve a pasta ao que era antes do pedido.
async function decidir(acao, { automatico = false } = {}) {
  const p = pendente;
  if (!p || !ponte) return;
  if (acao === 'descartar') {
    const r = await ponte.descartarFoto({ id: p.id, pasta });
    if (r.erro) { postar({ autor: 'sistema', texto: `Não deu para descartar: ${r.erro}`, erro: true }); return; }
    marcarDecisao(p.id, { estado: 'descartado', resultado: r });
  } else {
    await ponte.manterFoto({ id: p.id });
    marcarDecisao(p.id, { estado: 'mantido', automatico });
  }
  pendente = null; confirmando = null;
  persistir(); desenharMensagens();
}

// Fim da rodada: compara a pasta com a foto e abre a decisão. Sem foto, só lista os arquivos (como antes).
async function fecharRodada(foto, inicio) {
  marcarPasso('decisao');
  const d = foto ? await ponte.diffFoto({ id: foto, pasta }) : null;
  if (!d || d.erro) {
    if (d?.erro) postar({ autor: 'sistema', texto: `Sem diff desta rodada: ${d.erro}`, erro: true });
    postar({ autor: 'sistema', tipo: 'arquivos', arquivos: await ponte.arquivosAlterados({ pasta, desde: inicio }) });
    return;
  }
  if (!n.totalDeMudancas(d)) {
    await ponte.manterFoto({ id: foto });
    postar({ autor: 'sistema', tipo: 'decisao', estado: 'nada' });
    return;
  }
  pendente = { id: foto, conversa: atual.id };
  postar({ autor: 'sistema', tipo: 'decisao', foto, estado: 'pendente', ...d });
}

function desenharTrabalhando() {
  const ativos = agentes.filter((a) => estados[a.id] === 'trabalhando');
  const el = $('trabalhando');
  el.hidden = !ativos.length;
  el.textContent = ativos.length ? `${ativos.map((a) => a.nome).join(' e ')} ${ativos.length > 1 ? 'estão' : 'está'} trabalhando` : '';
}

function desenhar() {
  desenharPalco(); desenharChips(); desenharMensagens(); desenharTrabalhando();
  $('compositor').querySelector('.enviar').disabled = ocupado;
}

// Os cinco passos da Demo 1 (Aula 16): Pedido, Plano, Execução, Testes, Decisão.
function marcarPasso(passo) {
  const ordem = [...$('passos').children].map((li) => li.dataset.passo);
  const i = ordem.indexOf(passo);
  [...$('passos').children].forEach((li, j) => {
    li.classList.toggle('atual', j === i);
    li.classList.toggle('feito', i >= 0 && j < i);
  });
}

function mudarEstado(id, novo) {
  estados = n.trocarEstado(estados, id, novo);
  desenharPalco(); desenharChips(); desenharTrabalhando();
}

function falar(id, texto, ms = 6000) {
  baloes.set(id, texto);
  desenharPalco();
  setTimeout(() => { if (baloes.get(id) === texto) { baloes.delete(id); desenharPalco(); } }, ms);
}

function postar(msg) {
  atual = n.adicionarMensagem(atual, msg);
  persistir();
  desenharMensagens();
}

// ---------- execução ----------
async function executar(agente, pedido, anteriores, opcoes = {}) {
  mudarEstado(agente.id, 'trabalhando');
  const modo = provedores.modos[agente.provedor] ?? 'cli';
  const prompt = n.montarPrompt(agente, pedido, anteriores, { modo, proximo: opcoes.proximo });
  const r = await ponte.executarAgente({ agente: agente.id, provedor: agente.provedor, modelo: agente.modelo, prompt, pasta, escrita: n.podeEscrever(agente) });
  const erro = !r.ok || !r.saida;
  const texto = erro
    ? `${agente.provedor} falhou: ${(r.erro || r.saida || 'sem resposta').trim().split('\n').slice(-3).join('\n')}`
    : r.saida;
  postar({ autor: agente.id, texto, erro, gratis: r.modo === 'gratis', modelo: r.modelo });
  const fala = texto.replace(/```[\s\S]*?```/g, '').replace(/[`*]/g, '').split('\n').map((l) => l.trim()).find(Boolean) ?? texto;
  falar(agente.id, fala.slice(0, 90));
  mudarEstado(agente.id, 'concluido');
  return { id: agente.id, nome: agente.nome, papel: agente.papel, texto, gravados: r.gravados ?? [] };
}

// ---------- portão de testes (R24–R28) ----------
const ROTULO_PORTAO = {
  passou: '✓ passou', falhou: '✕ falhou', tempo: '✕ tempo esgotado', 'sem-teste': '✕ sem teste',
  bloqueado: '⚠ precisa da sua aprovação', pulou: 'pulou: nada mudou', desligado: 'desligado no .env',
  'sem-isolamento': '⚠ não rodou: sem caixa de areia',
};

// Roda `ids` e, enquanto o portão reprovar, devolve o trabalho para quem fez.
// `ciclo` vale a rodada inteira: autoria dos arquivos, quem executa e o início (para "o que mudou").
// `extra` é o recado que só esta chamada recebe (ex.: a devolução do Revisor).
// Um portão por vez: na hierárquica, as frentes trabalham em paralelo, mas os testes não rodam juntos na pasta.
let filaPortao = Promise.resolve();
function portaoEmFila(dados) {
  const vez = filaPortao.then(() => ponte.portao(dados));
  filaPortao = vez.catch(() => {});
  return vez;
}

async function executarComPortao(ids, pedido, anteriores, ciclo, extra = null, opcoes = {}) {
  const anotar = (rs) => rs.forEach((r) => r.gravados.forEach((c) => { ciclo.autoria[c] = r.id; }));
  const executores = ids.filter((id) => n.podeEscrever(agentes.find((a) => a.id === id)));
  ciclo.executores = [...new Set([...ciclo.executores, ...executores])];
  let resultados = await Promise.all(ids.map((id) => executar(agentes.find((a) => a.id === id), pedido, extra ? [...anteriores, extra] : anteriores, opcoes)));
  anteriores.push(...resultados); anotar(resultados);
  if (!executores.length) return null;
  for (let rodada = 1; ; rodada++) {
    marcarPasso('testes');
    const alterados = await ponte.arquivosAlterados({ pasta, desde: ciclo.inicio });
    const el = $('trabalhando'); el.hidden = false; el.textContent = 'Portão de testes rodando…';
    const p = await portaoEmFila({ pasta, houveMudanca: alterados.length > 0 });
    el.hidden = true;
    const decisao = n.decidirPortao(p.situacao, rodada);
    ciclo.portoes = (ciclo.portoes ?? 0) + 1; // numeração da rodada inteira (o limite de devoluções é por chamada)
    postar({ autor: 'sistema', tipo: 'portao', ...p, rodada: ciclo.portoes, decisao, saida: undefined, detalhe: p.saida });
    if (p.situacao === 'bloqueado') {
      postar({ autor: 'sistema', texto: `O "test" do package.json parece perigoso e não rodou sozinho:\n\`${p.script}\`\nLeia antes de aprovar:\n\`\`\`bash\n${p.comando}\n\`\`\`` });
    }
    if (decisao === 'seguir') {
      if (p.situacao === 'passou') anteriores.push({ nome: 'Portão de testes', papel: 'testes automáticos', texto: `APROVADO: \`${p.comando}\` passou.\n${p.resumo || ''}` });
      return p;
    }
    if (decisao === 'desistir') {
      postar({ autor: 'sistema', texto: `O portão não aprovou depois de ${n.MAX_DEVOLUCOES} devoluções. O Revisor vai olhar mesmo assim, sabendo disso.`, erro: true });
      anteriores.push({ nome: 'Portão de testes', papel: 'testes automáticos', texto: `NÃO APROVADO depois de ${n.MAX_DEVOLUCOES} devoluções.\n${p.resumo || ''}` });
      return p;
    }
    const falha = n.falhaDoPortao(p, rodada);
    const corretores = n.quemCorrige(p.resumo, ciclo.autoria, executores); // só quem trabalhou nesta chamada (frente)
    avisarDevolucao(corretores, ROTULO_PORTAO[p.situacao]);
    marcarPasso('execucao');
    resultados = await Promise.all(corretores.map((id) => executar(agentes.find((a) => a.id === id), pedido, [...anteriores, falha])));
    anteriores.push(...resultados); anotar(resultados);
  }
}

function avisarDevolucao(corretores, motivo) {
  const nomes = corretores.map((id) => agentes.find((a) => a.id === id)?.nome).join(' e ');
  const maestro = agentes.find((a) => a.coordenador);
  if (maestro) { postar({ autor: maestro.id, texto: `Voltou para ${nomes}: ${motivo}.` }); falar(maestro.id, `Voltou para ${nomes}.`); }
}

// Marca o veredito na última mensagem do agente (selo "aprovou" / "devolveu" no chat).
function anotarUltima(id, extra) {
  const i = atual.mensagens.findLastIndex((m) => m.autor === id);
  if (i < 0) return;
  atual = { ...atual, mensagens: atual.mensagens.map((m, j) => (j === i ? { ...m, ...extra } : m)) };
  persistir(); desenharMensagens();
}

// R36–R38: o Revisor lê tudo e dá o veredito. DEVOLVER manda os achados para quem escreveu os arquivos citados;
// a correção passa de novo pelo portão e volta para o Revisor, até MAX_REVISOES devoluções.
async function revisarComDevolucao(ids, pedido, anteriores, ciclo) {
  for (let rodada = 1; ; rodada++) {
    marcarPasso('testes');
    const rs = await Promise.all(ids.map((id) => executar(agentes.find((a) => a.id === id), pedido, anteriores)));
    anteriores.push(...rs);
    const vereditos = rs.map((r) => ({ id: r.id, texto: r.texto, ...n.lerVeredito(r.texto) }));
    vereditos.forEach((v) => anotarUltima(v.id, { veredito: v.veredito }));
    const devolvidos = vereditos.filter((v) => v.veredito === 'devolver');
    const decisao = n.decidirRevisao(devolvidos.length ? 'devolver' : 'aprovado', rodada);
    if (decisao === 'seguir' || !ciclo.executores.length) return;
    if (decisao === 'desistir') {
      postar({ autor: 'sistema', texto: `O Revisor ainda devolveu depois de ${n.MAX_REVISOES} correções. Fica para você decidir no passo 5.`, erro: true });
      return;
    }
    const v = { achados: devolvidos.flatMap((d) => d.achados), texto: devolvidos.map((d) => d.texto).join('\n\n') };
    const corretores = n.quemCorrige(v.achados.join('\n') || v.texto, ciclo.autoria, ciclo.executores);
    avisarDevolucao(corretores, 'o Revisor devolveu');
    marcarPasso('execucao');
    await executarComPortao(corretores, pedido, anteriores, ciclo, n.falhaDaRevisao(v, rodada));
  }
}

// R41–R42: rede. Sem líder: quem termina escolhe o vizinho que continua ("PRÓXIMO: nome").
// Quem escreve passa pelo portão; até MAX_PASSOS_REDE passos e MAX_VISITAS_REDE vezes por agente.
async function rodarRede(plano, pedido, anteriores, ciclo, propostas) {
  const visitas = {};
  let id = plano.rede.inicio;
  for (let passo = 1; id; passo++) {
    if (passo > n.MAX_PASSOS_REDE) { postar({ autor: 'sistema', texto: `A rede parou no limite de ${n.MAX_PASSOS_REDE} passos (cuidado com as voltas sem fim).`, erro: true }); return; }
    const ag = agentes.find((a) => a.id === id);
    visitas[id] = (visitas[id] ?? 0) + 1;
    const vizinhos = (plano.rede.vizinhos[id] ?? []).filter((v) => agentes.some((a) => a.id === v));
    const opcoes = { proximo: vizinhos.map((v) => agentes.find((a) => a.id === v).nome) };
    let texto;
    if (n.podeEscrever(ag)) {
      marcarPasso('execucao');
      const antes = anteriores.length;
      await executarComPortao([id], pedido, anteriores, ciclo, null, opcoes);
      const meus = anteriores.slice(antes).filter((r) => r.id === id); // a 1ª resposta traz o PRÓXIMO; as correções do portão, não
      texto = meus.find((r) => /pr[oó]ximo\s*:/i.test(r.texto))?.texto ?? meus[0]?.texto ?? '';
    } else {
      marcarPasso(n.ehRevisor(ag) ? 'testes' : 'execucao');
      const r = await executar(ag, pedido, anteriores, opcoes);
      anteriores.push(r); texto = r.texto;
      if (n.ehRevisor(ag)) anotarUltima(id, { veredito: n.lerVeredito(texto).veredito });
    }
    const prox = n.escolherProximo({ texto, vizinhos, visitas, propostas, agentes });
    postar({ autor: 'sistema', texto: prox ? `${ag.nome} passou para ${agentes.find((a) => a.id === prox).nome}.` : `${ag.nome} encerrou a rede.` });
    id = prox;
  }
}

// Roda as etapas do plano em sequência. Etapa com quem escreve passa pelo portão; a do Revisor, pela revisão;
// { frentes } (hierárquica) roda cada frente em paralelo, cada uma com o próprio portão.
async function rodarEtapas(etapas, pedido, anteriores, ciclo) {
  for (const etapa of etapas) {
    if (etapa.frentes) {
      marcarPasso('execucao');
      const daFrente = await Promise.all(etapa.frentes.map(async (f) => {
        const local = [...anteriores]; // cada frente só vê o que veio antes dela (o recado de uma não chega à outra)
        await executarComPortao(f, pedido, local, ciclo);
        return local.slice(anteriores.length);
      }));
      anteriores.push(...daFrente.flat());
      continue;
    }
    const executa = etapa.some((id) => n.podeEscrever(agentes.find((a) => a.id === id)));
    const revisa = etapa.every((id) => n.ehRevisor(agentes.find((a) => a.id === id)));
    marcarPasso(revisa ? 'testes' : 'execucao'); // o revisor confere: é verificação, não execução
    if (executa) { await executarComPortao(etapa, pedido, anteriores, ciclo); continue; }
    if (revisa) { await revisarComDevolucao(etapa, pedido, anteriores, ciclo); continue; }
    const resultados = await Promise.all(etapa.map((id) => executar(agentes.find((a) => a.id === id), pedido, anteriores)));
    anteriores.push(...resultados);
  }
}

async function enviar(pedido) {
  ocupado = true;
  if (roteiro) ponte = criarPonteFalsa({ agentes }); // cada pedido recomeça o roteiro do zero
  marcarPasso('pedido');
  postar({ autor: 'voce', texto: pedido });
  const inicio = Date.now() - 1000;
  let foto = null;
  try {
    if (!ponte) throw new Error('Os agentes só rodam no app desktop (npm start).');
    provedores = await ponte.provedores(); // o .env pode ter mudado
    desenharPalco();
    if (pendente) await decidir('manter', { automatico: true }); // a foto nova já inclui o que ficou
    const f = await ponte.tirarFoto({ pasta });
    if (f.erro) postar({ autor: 'sistema', texto: `Sem foto da pasta (${f.erro}): nesta rodada não vai dar para descartar.`, erro: true });
    else foto = f.id;
    const alvo = agentes.find((a) => a.id === destino);
    if (alvo) {
      marcarPasso('execucao');
      await executar(alvo, pedido, []);
    } else {
      // rodada de propostas: todos pensam, cada um diz se pega ou passa
      const maestro = agentes.find((a) => a.coordenador);
      marcarPasso('plano');
      agentes.forEach((a) => { estados[a.id] = 'pensando'; });
      desenharPalco();
      await esperar(700);
      const propostas = n.rodadaDePropostas(agentes, pedido);
      propostas.forEach((p) => falar(p.id, p.fala));
      agentes.forEach((a) => { estados[a.id] = 'disponivel'; });
      postar({ autor: 'sistema', tipo: 'rodada', propostas });
      await esperar(900);
      const plano = n.montarPlano(arquitetura, agentes, propostas, { ligacoes, etapasConstrutor });
      if (plano.erro) throw new Error(plano.erro);
      const sug = n.sugerirArquitetura(pedido, agentes);
      if (sug.id !== arquitetura && arquitetura !== 'construtor') postar({ autor: 'sistema', tipo: 'sugestao', sugestao: sug.id, motivo: sug.motivo, atual: arquitetura });
      const time = plano.etapas ? plano.etapas.flatMap((e) => (e.frentes ? e.frentes.flat() : e)) : [plano.rede.inicio];
      const lider = plano.lider && agentes.find((a) => a.id === plano.lider);
      if (lider) { postar({ autor: lider.id, texto: plano.mensagem, time }); falar(lider.id, plano.mensagem); }
      else postar({ autor: 'sistema', texto: `🏗 ${plano.mensagem}`, time });
      const anteriores = [];
      const ciclo = { inicio, autoria: {}, executores: [] };
      if (plano.rede) await rodarRede(plano, pedido, anteriores, ciclo, propostas);
      else await rodarEtapas(plano.etapas, pedido, anteriores, ciclo);
    }
    await fecharRodada(foto, inicio);
  } catch (e) {
    marcarPasso(null);
    postar({ autor: 'sistema', texto: `Erro: ${e.message}`, erro: true });
    if (foto && !pendente) await fecharRodada(foto, inicio).catch(() => {}); // o que já mudou também pode ser descartado
  } finally {
    ocupado = false;
    await esperar(2500);
    agentes.forEach((a) => { if (estados[a.id] === 'concluido') estados[a.id] = 'disponivel'; });
    desenhar();
  }
}

// ---------- eventos ----------
$('compositor').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const texto = $('entrada').value.trim() || (roteiro && destino === 'time' ? PEDIDO_DO_ROTEIRO : '');
  if (!texto || ocupado) return;
  $('entrada').value = '';
  $('entrada').style.height = '';
  enviar(texto);
});
$('entrada').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); $('compositor').requestSubmit(); }
});
$('entrada').addEventListener('input', (ev) => { ev.target.style.height = ''; ev.target.style.height = ev.target.scrollHeight + 'px'; });

$('chips').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-destino]');
  if (b) { destino = b.dataset.destino; desenharPalco(); desenharChips(); $('entrada').focus(); }
});
$('palco').addEventListener('click', (ev) => {
  const b = ev.target.closest('.agente');
  if (b) { destino = destino === b.dataset.id ? 'time' : b.dataset.id; desenharPalco(); desenharChips(); $('entrada').focus(); }
});
$('palco').addEventListener('contextmenu', (ev) => {
  const b = ev.target.closest('.agente');
  const a = b && agentes.find((x) => x.id === b.dataset.id);
  if (!a || a.coordenador || ocupado) return;
  ev.preventDefault();
  if (confirm(`Remover ${a.nome} do time?`)) {
    agentes = n.removerAgente(agentes, a.id);
    if (destino === a.id) destino = 'time';
    persistir(); desenhar();
  }
});

$('mensagens').addEventListener('click', async (ev) => {
  const arq = ev.target.closest('[data-arquitetura]');
  if (arq && !ocupado) { arquitetura = arq.dataset.arquitetura; persistir(); desenhar(); return; }
  const dec = ev.target.closest('[data-decidir]');
  if (dec) {
    ev.preventDefault();
    if (ocupado || !pendente) return;
    const acao = dec.dataset.decidir;
    if (acao === 'confirmar') { confirmando = pendente.id; desenharMensagens(); return; }
    if (acao === 'cancelar') { confirmando = null; desenharMensagens(); return; }
    dec.disabled = true;
    await decidir(acao);
    return;
  }
  const abrir = ev.target.closest('[data-abrir]');
  if (abrir) ev.preventDefault(); // o ↗ fica dentro do <summary>: não abre/fecha o diff
  if (abrir && ponte) {
    const falha = await ponte.abrir({ pasta, caminho: abrir.dataset.abrir });
    if (falha) postar({ autor: 'sistema', texto: `Não abriu: ${falha}`, erro: true });
    return;
  }
  const b = ev.target.closest('[data-cmd]');
  if (!b) return;
  const comando = b.dataset.cmd;
  if (b.classList.contains('negar')) { saidas.set(comando, '✕ negado por você'); desenharMensagens(); return; }
  if (!ponte) { saidas.set(comando, '(execução só no app desktop)'); desenharMensagens(); return; }
  b.disabled = true; b.textContent = '…';
  const r = await ponte.executarComando({ comando, pasta });
  saidas.set(comando, `${r.ok ? '✓' : '✕'} ${[r.saida, r.erro].filter(Boolean).join('\n') || '(sem saída)'}`);
  desenharMensagens();
});

$('btn-projeto').addEventListener('click', async () => {
  if (!ponte) return;
  const p = await ponte.escolherPasta();
  if (p) { pasta = p; persistir(); desenharPalco(); }
});

// R31: liga e desliga o roteiro falso. A troca vale a partir do próximo pedido.
$('btn-roteiro').addEventListener('click', async () => {
  if (ocupado) return;
  if (pendente) await decidir('manter', { automatico: true }); // a foto pendente é da ponte que vai sair
  roteiro = !roteiro;
  ponte = roteiro ? criarPonteFalsa({ agentes }) : ponteReal;
  provedores = ponte ? await ponte.provedores() : { modos: {}, chaves: [] };
  marcarPasso(null);
  persistir(); desenhar(); $('entrada').focus();
});

$('btn-nova-conversa').addEventListener('click', () => {
  if (ocupado) return;
  persistir(); atual = n.novaConversa(); saidas.clear(); desenhar();
});
$('btn-conversas').addEventListener('click', () => {
  const lista = $('lista-conversas');
  lista.hidden = !lista.hidden;
  lista.innerHTML = conversas.length
    ? conversas.map((c) => `<button data-conv="${c.id}" class="${c.id === atual.id ? 'atual' : ''}">${esc(c.titulo)}</button>`).join('')
    : '<p class="vazio" style="margin:12px">Nenhuma conversa ainda.</p>';
});
$('lista-conversas').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-conv]');
  if (!b || ocupado) return;
  atual = conversas.find((c) => c.id === b.dataset.conv) ?? atual;
  $('lista-conversas').hidden = true;
  saidas.clear(); desenhar();
});

$('btn-novo-agente').addEventListener('click', () => { $('erro-agente').textContent = ''; $('form-agente').reset(); $('dlg-agente').showModal(); });
$('form-agente').addEventListener('submit', (ev) => {
  if (ev.submitter?.value !== 'criar') return;
  try {
    agentes = n.criarAgente(agentes, Object.fromEntries(new FormData(ev.target)));
    estados = { ...estados, [agentes.at(-1).id]: 'disponivel' };
    persistir(); desenhar();
  } catch (e) {
    ev.preventDefault();
    $('erro-agente').textContent = e.message;
  }
});

// ---------- provedores nos formulários (R19) ----------
document.querySelectorAll('.sel-provedor').forEach((sel) => {
  sel.innerHTML = n.PROVEDORES.map((p) => `<option value="${p}">${esc(n.CATALOGO[p].rotulo)}</option>`).join('');
});

// ---------- painel de chaves (R20–R22) ----------
const ROTULO_FONTE = { tela: 'chave salva aqui', '.env': 'chave do .env' };

function seloAcesso(p) {
  if (p.modo === 'gratis') return '<span class="selo-acesso ok">modo gratuito</span>';
  if (!p.usaChave) return '<span class="selo-acesso ok">local, sem chave</span>';
  if (p.mascara) return `<span class="selo-acesso ok" title="${esc(p.variavel)}">${esc(ROTULO_FONTE[p.fonte])} · ${esc(p.mascara)}</span>`;
  if (p.cli) return '<span class="selo-acesso cli">CLI da assinatura</span>';
  return '<span class="selo-acesso">sem acesso</span>';
}

async function desenharChaves() {
  const dados = await ponteReal.chaves();
  $('cofre-situacao').textContent = dados.cofre.disponivel
    ? 'As chaves digitadas aqui ficam cifradas no cofre do sistema e valem mais que as do .env. A tela nunca mostra a chave inteira.'
    : `⚠ ${dados.cofre.motivo}`;
  $('lista-chaves').innerHTML = dados.provedores.map((p) => `
    <div class="prov" data-prov="${p.id}">
      <div class="prov-topo"><b>${esc(p.rotulo)}</b>${seloAcesso(p)}<a href="#" data-site="${esc(p.site)}" title="${esc(p.site)}">obter chave ↗</a></div>
      ${p.usaChave ? `<div class="prov-linha">
        <input type="password" class="chave" placeholder="${p.temNaTela ? 'trocar a chave salva' : `colar ${esc(p.variavel)}`}" autocomplete="off" spellcheck="false" ${dados.cofre.disponivel ? '' : 'disabled'}>
        <button type="button" data-acao="salvar" ${dados.cofre.disponivel ? '' : 'disabled'}>Salvar</button>
        ${p.temNaTela ? '<button type="button" data-acao="remover">Remover</button>' : ''}
      </div>` : ''}
      <div class="prov-linha">
        <input class="modelo" placeholder="${esc(p.modeloPadrao)}" title="Modelo para o teste (vazio = ${esc(p.modeloPadrao)})" spellcheck="false">
        <button type="button" data-acao="testar">Testar</button>
      </div>
      <p class="resultado"></p>
    </div>`).join('');
}

function mostrar(alvo, classe, texto) {
  alvo.className = `resultado ${classe}`;
  alvo.textContent = texto;
}

$('btn-chaves').addEventListener('click', async () => {
  if (!ponteReal) return;
  await desenharChaves();
  $('dlg-chaves').showModal();
});

$('dlg-chaves').addEventListener('close', async () => { provedores = await ponte.provedores(); desenharPalco(); });

$('lista-chaves').addEventListener('click', async (ev) => {
  const site = ev.target.closest('[data-site]');
  if (site) { ev.preventDefault(); return; } // a página não abre links externos; o endereço fica no title
  const b = ev.target.closest('[data-acao]');
  const linha = b?.closest('[data-prov]');
  if (!linha) return;
  const provedor = linha.dataset.prov;
  const res = linha.querySelector('.resultado');
  b.disabled = true;
  try {
    if (b.dataset.acao === 'salvar') {
      const entrada = linha.querySelector('.chave');
      const r = await ponteReal.salvarChave({ provedor, chave: entrada.value });
      entrada.value = ''; // a chave não fica na tela
      if (!r.ok) { mostrar(res, 'falhou', r.erro); return; }
      await desenharChaves();
      mostrar($('lista-chaves').querySelector(`[data-prov="${provedor}"] .resultado`), r.aviso ? 'aviso' : 'ok', r.aviso || 'Chave salva. Clique em Testar para conferir.');
      provedores = await ponte.provedores(); desenharPalco();
    } else if (b.dataset.acao === 'remover') {
      await ponteReal.removerChave({ provedor });
      await desenharChaves();
      provedores = await ponte.provedores(); desenharPalco();
    } else if (b.dataset.acao === 'testar') {
      mostrar(res, '', 'Testando…');
      const r = await ponteReal.testarProvedor({ provedor, modelo: linha.querySelector('.modelo').value });
      if (!r.ok) mostrar(res, 'falhou', `✕ ${r.modelo ?? ''}: ${r.erro}`);
      else if (r.aviso) mostrar(res, 'aviso', `✓ ${r.aviso}`);
      else mostrar(res, 'ok', `✓ ${r.modelo} respondeu em ${r.ms} ms (${ROTULO_FONTE[r.fonte] ?? r.fonte})`);
    }
  } finally {
    if (b.isConnected) b.disabled = false;
  }
});

// ---------- R39–R41: escolher a arquitetura, ligar a rede, montar no construtor ----------
let rascunho = null; // { arquitetura, ligacoes, etapas } enquanto o diálogo está aberto
const clonar = (x) => JSON.parse(JSON.stringify(x));
const semCoordenador = () => agentes.filter((a) => !a.coordenador);

function desenharDialogoTime() {
  $('lista-arquiteturas').innerHTML = Object.entries(n.ARQUITETURAS).map(([id, a]) => `
    <label class="arq ${rascunho.arquitetura === id ? 'escolhida' : ''}">
      <input type="radio" name="arq" value="${id}" ${rascunho.arquitetura === id ? 'checked' : ''}>
      <b>${esc(a.nome)}</b>${a.variacao ? ' <small class="tag">variação</small>' : ''}${a.lider ? ' <small class="tag">com líder</small>' : ''}
      <span>${esc(a.resumo)}</span>
      <small>Quando: ${esc(a.quando)} · Cuidado: ${esc(a.cuidado)}</small>
    </label>`).join('');
  $('painel-ligacoes').hidden = rascunho.arquitetura !== 'rede-escolhida';
  $('painel-construtor').hidden = rascunho.arquitetura !== 'construtor';
  const time = semCoordenador();
  $('grade-ligacoes').innerHTML = `<table class="grade"><tr><th>de ↓ para →</th>${time.map((a) => `<th>${esc(a.nome)}</th>`).join('')}</tr>
    ${time.map((de) => `<tr><th>${esc(de.nome)}</th>${time.map((para) => (de.id === para.id ? '<td>—</td>'
      : `<td><input type="checkbox" data-de="${de.id}" data-para="${para.id}" ${(rascunho.ligacoes[de.id] ?? []).includes(para.id) ? 'checked' : ''}></td>`)).join('')}</tr>`).join('')}</table>`;
  const usados = new Set(rascunho.etapas.flat());
  const chip = (a) => `<span class="chip-agente" draggable="true" data-arrastar="${a.id}" style="--cor:${a.cor}">${esc(a.nome)}</span>`;
  const colunas = [...rascunho.etapas, []].slice(0, 5); // sempre sobra uma etapa vazia (até 5)
  $('construtor').innerHTML = `<div class="coluna fora" data-coluna="-1"><h4>Fora</h4>${time.filter((a) => !usados.has(a.id)).map(chip).join('')}</div>`
    + colunas.map((ids, i) => `<div class="coluna" data-coluna="${i}"><h4>Etapa ${i + 1}</h4>${ids.map((id) => time.find((a) => a.id === id)).filter(Boolean).map(chip).join('')}</div>`).join('');
}

$('btn-time').addEventListener('click', () => {
  if (ocupado) return;
  rascunho = { arquitetura, ligacoes: clonar(ligacoes), etapas: clonar(etapasConstrutor) };
  desenharDialogoTime();
  $('dlg-time').showModal();
});
$('lista-arquiteturas').addEventListener('change', (ev) => {
  if (ev.target.name === 'arq') { rascunho.arquitetura = ev.target.value; desenharDialogoTime(); }
});
$('grade-ligacoes').addEventListener('change', (ev) => {
  const { de, para } = ev.target.dataset;
  if (!de) return;
  const lista = new Set(rascunho.ligacoes[de] ?? []);
  if (ev.target.checked) lista.add(para); else lista.delete(para);
  rascunho.ligacoes[de] = [...lista];
});
$('construtor').addEventListener('dragstart', (ev) => {
  const id = ev.target.dataset?.arrastar;
  if (id) ev.dataTransfer.setData('text/plain', id);
});
$('construtor').addEventListener('dragover', (ev) => { if (ev.target.closest('.coluna')) ev.preventDefault(); });
$('construtor').addEventListener('drop', (ev) => {
  const coluna = ev.target.closest('.coluna');
  const id = ev.dataTransfer.getData('text/plain');
  if (!coluna || !id) return;
  ev.preventDefault();
  moverNoConstrutor(id, Number(coluna.dataset.coluna));
});
// Sem arrastar (teclado, toque): clicar no agente o leva para a próxima coluna.
$('construtor').addEventListener('click', (ev) => {
  const id = ev.target.dataset?.arrastar;
  if (!id) return;
  const i = rascunho.etapas.findIndex((e) => e.includes(id));
  moverNoConstrutor(id, i + 1 > Math.min(rascunho.etapas.length, 4) ? -1 : i + 1);
});
function moverNoConstrutor(id, destinoColuna) {
  const etapas = rascunho.etapas.map((e) => e.filter((x) => x !== id));
  if (destinoColuna >= 0) { while (etapas.length <= destinoColuna) etapas.push([]); etapas[destinoColuna].push(id); }
  rascunho.etapas = etapas.filter((e, i) => e.length || i < destinoColuna);
  desenharDialogoTime();
}
$('form-time').addEventListener('submit', (ev) => {
  if (ev.submitter?.value !== 'salvar') return;
  arquitetura = rascunho.arquitetura;
  ligacoes = rascunho.ligacoes;
  etapasConstrutor = rascunho.etapas.filter((e) => e.length);
  persistir(); desenhar();
});

// ---------- cartão do agente: provedor e modelo (R23) ----------
let editando = null;

function acessoDoAgente(provedor) {
  const modo = provedores.modos?.[provedor];
  if (provedores.gratuito) return 'Modo gratuito ligado: este agente roda no Gemini grátis, qualquer que seja o provedor.';
  return { api: 'Acesso: chave de API.', cli: 'Acesso: CLI da assinatura.' }[modo]
    ?? `Sem acesso: salve uma chave em 🔑${n.CATALOGO[provedor]?.cli ? ` ou instale e faça login na CLI "${n.CATALOGO[provedor].cli}"` : ''}.`;
}

$('palco').addEventListener('dblclick', async (ev) => {
  const b = ev.target.closest('.agente');
  const a = b && agentes.find((x) => x.id === b.dataset.id);
  if (!a || ocupado) return;
  editando = a.id;
  if (ponte) { provedores = await ponte.provedores(); desenharPalco(); } // chaves podem ter mudado (.env ou 🔑)
  const f = $('form-editar');
  $('editar-titulo').textContent = a.nome;
  $('editar-papel').textContent = `${a.papel}${a.coordenador ? ' · só responde quando você fala direto com ele' : ''}`;
  f.provedor.value = a.provedor;
  f.modelo.value = a.modelo ?? '';
  f.modelo.placeholder = n.CATALOGO[a.provedor]?.modelo ?? '';
  $('editar-acesso').textContent = acessoDoAgente(a.provedor);
  mostrar($('editar-resultado'), '', '');
  $('dlg-editar').showModal();
});

$('form-editar').provedor.addEventListener('change', (ev) => {
  $('form-editar').modelo.placeholder = n.CATALOGO[ev.target.value]?.modelo ?? '';
  $('editar-acesso').textContent = acessoDoAgente(ev.target.value);
});

$('form-editar').addEventListener('submit', (ev) => {
  if (ev.submitter?.value !== 'salvar') return;
  try {
    agentes = n.editarAgente(agentes, editando, Object.fromEntries(new FormData(ev.target)));
    persistir(); desenhar();
  } catch (e) {
    ev.preventDefault();
    mostrar($('editar-resultado'), 'falhou', e.message);
  }
});

// Chamada de verdade pelo mesmo caminho dos pedidos: confere login, crédito e modelo.
$('btn-testar-agente').addEventListener('click', async (ev) => {
  const f = $('form-editar');
  const a = agentes.find((x) => x.id === editando);
  if (!a || !ponteReal) return;
  ev.target.disabled = true;
  mostrar($('editar-resultado'), '', 'Chamando o agente…');
  const inicio = Date.now();
  try {
    provedores = await ponte.provedores();
    const r = await ponteReal.executarAgente({
      provedor: f.provedor.value, modelo: f.modelo.value, pasta, escrita: false,
      prompt: `Você é ${a.nome}, agente de ${a.papel}. Responda apenas: "oi, estou funcionando".`,
    });
    const s = ((Date.now() - inicio) / 1000).toFixed(1);
    if (r.ok && r.saida) mostrar($('editar-resultado'), 'ok', `✓ ${r.modelo ?? ''} (${r.modo}) em ${s} s: ${r.saida.split('\n')[0].slice(0, 120)}`);
    else mostrar($('editar-resultado'), 'falhou', `✕ ${(r.erro || r.saida || 'sem resposta').trim().split('\n').slice(-3).join('\n')}`);
  } finally {
    ev.target.disabled = false;
  }
});

// ---------- início ----------
if (roteiro) ponte = criarPonteFalsa({ agentes });
if (ponte) {
  provedores = await ponte.provedores();
  pastaPadrao = await ponte.pastaPadrao();
}
desenhar();
$('entrada').focus();
