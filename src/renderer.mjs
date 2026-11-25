// Tela do Estúdio: desenha o estado e repassa os eventos ao núcleo.
import * as n from './nucleo.mjs';

const $ = (id) => document.getElementById(id);
const ponte = window.estudio; // ausente quando a tela é aberta direto no navegador
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hora = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

// ---------- estado persistido ----------
const salvo = (chave, padrao) => { try { return JSON.parse(localStorage.getItem(chave)) ?? padrao; } catch { return padrao; } };
let agentes = salvo('agentes', n.TIME_PADRAO);
let conversas = salvo('conversas', []);
let atual = conversas[0] ?? n.novaConversa();
let pasta = salvo('pasta', null); // null = pasta padrão (~/estudio-projetos)
let pastaPadrao = '';

// ---------- estado da tela ----------
let estados = Object.fromEntries(agentes.map((a) => [a.id, 'disponivel']));
let destino = 'time';
let ocupado = false;
let provedores = { modos: {}, chaves: [] };
const baloes = new Map();
const saidas = new Map(); // comando executado -> saída

function persistir() {
  conversas = [atual, ...conversas.filter((c) => c.id !== atual.id)].filter((c) => c.mensagens.length).slice(0, 30);
  localStorage.setItem('conversas', JSON.stringify(conversas));
  localStorage.setItem('agentes', JSON.stringify(agentes));
  localStorage.setItem('pasta', JSON.stringify(pasta));
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
  if (!ponte) {
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
  $('modo').classList.toggle('alerta', !ponte || faltando.length > 0);
  $('modo').classList.toggle('gratis', Boolean(ponte && provedores.gratuito && !faltando.length));
  $('nome-projeto').textContent = pasta ? pasta.split(/[\\/]/).pop() : 'estudio-projetos (padrão)';
  $('btn-projeto').title = `${pasta || pastaPadrao}\nClique para escolher outra pasta`;
}

function desenharChips() {
  const chip = (id, nome, cor, extra = '') =>
    `<button type="button" class="chip ${destino === id ? 'ativo' : ''}" data-destino="${id}" style="--cor:${cor}">${cor ? '<i></i>' : '⁂'} ${esc(nome)}${extra}</button>`;
  $('chips').innerHTML = chip('time', 'Time', '') +
    agentes.map((a) => chip(a.id, a.nome, a.cor, estados[a.id] === 'trabalhando' ? ' •' : '')).join('');
  const alvo = agentes.find((a) => a.id === destino);
  $('destino-dica').textContent = alvo ? `Só ${alvo.nome} responde` : 'O time decide quem responde';
  $('entrada').placeholder = alvo ? `Fale com ${alvo.nome}...` : 'Fale com o time...';
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
      return `<div class="rodada portao ${ok ? 'passou' : 'falhou'}"><h3>Portão de testes · rodada ${m.rodada}</h3>
        <p><b>${ROTULO_PORTAO[m.situacao] ?? esc(m.situacao)}</b>${cmd}${origem}${tempo}</p>${det}</div>`;
    }
    if (m.tipo === 'arquivos') {
      return `<div class="rodada arquivos"><h3>Arquivos criados ou alterados</h3>${m.arquivos.length
        ? m.arquivos.map((f) => `<button data-abrir="${esc(f)}">📄 ${esc(f)}</button>`).join('')
        : '<p>Nenhum arquivo mudou na pasta do projeto.</p>'}<button data-abrir="" class="pasta">📁 Abrir a pasta</button></div>`;
    }
    const a = m.autor === 'sistema' ? { nome: 'Estúdio', cor: '#777' } : ag(m.autor);
    return `<div class="msg ${m.erro ? 'falhou' : ''}" style="--cor:${a.cor}"><span class="avatar"></span><div>
      <div class="cab">${esc(a.nome)}<small>${hora(m.em)}</small>${m.erro ? '<span class="selo">falhou</span>' : ''}${m.gratis && !m.erro ? `<span class="selo gratis" title="${esc(m.modelo ?? '')}">Gemini grátis</span>` : ''}</div>
      <div class="corpo">${formatar(m.texto)}</div>
      ${m.time ? `<div class="etiquetas">${m.time.map((id) => `<span style="--cor:${ag(id).cor}">${esc(ag(id).nome)}</span>`).join('')}</div>` : ''}
      ${desenharComandos(m.texto)}</div></div>`;
  }).join('');
  const caixa = $('mensagens');
  caixa.innerHTML = html || '<p class="vazio">Peça algo ao time.<br>Ex.: “Crie uma página de status com um endpoint /health”.</p>';
  caixa.scrollTop = caixa.scrollHeight;
  $('titulo-conversa').textContent = atual.titulo;
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
async function executar(agente, pedido, anteriores) {
  mudarEstado(agente.id, 'trabalhando');
  const modo = provedores.modos[agente.provedor] ?? 'cli';
  const prompt = n.montarPrompt(agente, pedido, anteriores, { modo });
  const r = await ponte.executarAgente({ provedor: agente.provedor, modelo: agente.modelo, prompt, pasta, escrita: n.podeEscrever(agente) });
  const erro = !r.ok || !r.saida;
  const texto = erro
    ? `${agente.provedor} falhou: ${(r.erro || r.saida || 'sem resposta').trim().split('\n').slice(-3).join('\n')}`
    : r.saida;
  postar({ autor: agente.id, texto, erro, gratis: r.modo === 'gratis', modelo: r.modelo });
  const fala = texto.replace(/```[\s\S]*?```/g, '').split('\n').map((l) => l.trim()).find(Boolean) ?? texto;
  falar(agente.id, fala.slice(0, 90));
  mudarEstado(agente.id, 'concluido');
  return { id: agente.id, nome: agente.nome, papel: agente.papel, texto, gravados: r.gravados ?? [] };
}

// ---------- portão de testes (R24–R28) ----------
const ROTULO_PORTAO = {
  passou: '✓ passou', falhou: '✕ falhou', tempo: '✕ tempo esgotado', 'sem-teste': '✕ sem teste',
  bloqueado: '⚠ precisa da sua aprovação', pulou: 'pulou: nada mudou', desligado: 'desligado no .env',
};

// Roda a etapa de execução e, enquanto o portão reprovar, devolve o trabalho para quem fez.
async function executarComPortao(etapa, pedido, anteriores) {
  const inicio = Date.now() - 1000;
  const autoria = {};
  const anotar = (rs) => rs.forEach((r) => r.gravados.forEach((c) => { autoria[c] = r.id; }));
  const executores = etapa.filter((id) => n.podeEscrever(agentes.find((a) => a.id === id)));
  let resultados = await Promise.all(etapa.map((id) => executar(agentes.find((a) => a.id === id), pedido, anteriores)));
  anteriores.push(...resultados); anotar(resultados);
  if (!executores.length) return null;
  for (let rodada = 1; ; rodada++) {
    const alterados = await ponte.arquivosAlterados({ pasta, desde: inicio });
    const el = $('trabalhando'); el.hidden = false; el.textContent = 'Portão de testes rodando…';
    const p = await ponte.portao({ pasta, houveMudanca: alterados.length > 0 });
    el.hidden = true;
    const decisao = n.decidirPortao(p.situacao, rodada);
    postar({ autor: 'sistema', tipo: 'portao', ...p, rodada, decisao, saida: undefined, detalhe: p.saida });
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
    const corretores = n.quemCorrige(p.resumo, autoria, executores);
    const nomes = corretores.map((id) => agentes.find((a) => a.id === id)?.nome).join(' e ');
    const maestro = agentes.find((a) => a.coordenador);
    if (maestro) { postar({ autor: maestro.id, texto: `Voltou para ${nomes}: ${ROTULO_PORTAO[p.situacao]}.` }); falar(maestro.id, `Voltou para ${nomes}.`); }
    resultados = await Promise.all(corretores.map((id) => executar(agentes.find((a) => a.id === id), pedido, [...anteriores, falha])));
    anteriores.push(...resultados); anotar(resultados);
  }
}

async function enviar(pedido) {
  ocupado = true;
  postar({ autor: 'voce', texto: pedido });
  const inicio = Date.now() - 1000;
  try {
    if (!ponte) throw new Error('Os agentes só rodam no app desktop (npm start).');
    provedores = await ponte.provedores(); // o .env pode ter mudado
    desenharPalco();
    const alvo = agentes.find((a) => a.id === destino);
    if (alvo) {
      await executar(alvo, pedido, []);
    } else {
      // rodada de propostas: todos pensam, cada um diz se pega ou passa
      const maestro = agentes.find((a) => a.coordenador);
      agentes.forEach((a) => { estados[a.id] = 'pensando'; });
      desenharPalco();
      await esperar(700);
      const propostas = n.rodadaDePropostas(agentes, pedido);
      propostas.forEach((p) => falar(p.id, p.fala));
      agentes.forEach((a) => { estados[a.id] = 'disponivel'; });
      postar({ autor: 'sistema', tipo: 'rodada', propostas });
      await esperar(900);
      const { etapas, mensagem } = n.montarTime(agentes, propostas);
      if (maestro) { postar({ autor: maestro.id, texto: mensagem, time: etapas.flat() }); falar(maestro.id, mensagem); }
      const anteriores = [];
      for (const etapa of etapas) {
        const executa = etapa.some((id) => n.podeEscrever(agentes.find((a) => a.id === id)));
        if (executa) { await executarComPortao(etapa, pedido, anteriores); continue; }
        const resultados = await Promise.all(etapa.map((id) => executar(agentes.find((a) => a.id === id), pedido, anteriores)));
        anteriores.push(...resultados);
      }
    }
    const arquivos = await ponte.arquivosAlterados({ pasta, desde: inicio });
    postar({ autor: 'sistema', tipo: 'arquivos', arquivos });
  } catch (e) {
    postar({ autor: 'sistema', texto: `Erro: ${e.message}`, erro: true });
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
  const texto = $('entrada').value.trim();
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
  const abrir = ev.target.closest('[data-abrir]');
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
  const dados = await ponte.chaves();
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
  if (!ponte) return;
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
      const r = await ponte.salvarChave({ provedor, chave: entrada.value });
      entrada.value = ''; // a chave não fica na tela
      if (!r.ok) { mostrar(res, 'falhou', r.erro); return; }
      await desenharChaves();
      mostrar($('lista-chaves').querySelector(`[data-prov="${provedor}"] .resultado`), r.aviso ? 'aviso' : 'ok', r.aviso || 'Chave salva. Clique em Testar para conferir.');
      provedores = await ponte.provedores(); desenharPalco();
    } else if (b.dataset.acao === 'remover') {
      await ponte.removerChave({ provedor });
      await desenharChaves();
      provedores = await ponte.provedores(); desenharPalco();
    } else if (b.dataset.acao === 'testar') {
      mostrar(res, '', 'Testando…');
      const r = await ponte.testarProvedor({ provedor, modelo: linha.querySelector('.modelo').value });
      if (!r.ok) mostrar(res, 'falhou', `✕ ${r.modelo ?? ''}: ${r.erro}`);
      else if (r.aviso) mostrar(res, 'aviso', `✓ ${r.aviso}`);
      else mostrar(res, 'ok', `✓ ${r.modelo} respondeu em ${r.ms} ms (${ROTULO_FONTE[r.fonte] ?? r.fonte})`);
    }
  } finally {
    if (b.isConnected) b.disabled = false;
  }
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
  if (!a || !ponte) return;
  ev.target.disabled = true;
  mostrar($('editar-resultado'), '', 'Chamando o agente…');
  const inicio = Date.now();
  try {
    provedores = await ponte.provedores();
    const r = await ponte.executarAgente({
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
if (ponte) {
  provedores = await ponte.provedores();
  pastaPadrao = await ponte.pastaPadrao();
}
desenhar();
$('entrada').focus();
