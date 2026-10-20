// Atualização do Omie parada aparece em VERMELHO, no texto e no selo do topo;
// erros de rede em português; ano do Financeiro nunca fica inválido.
const fs = require('fs'), vm = require('vm'), assert = require('node:assert/strict');
const callbacks = {}, timers = [], ligados = new Set();
const ouvir = (tipo, fn) => (callbacks[tipo] ||= []).push(fn);
const badge = { className: '', textContent: '' };
const document = {
  hidden: false, body: { contains: el => ligados.has(el) },
  addEventListener: ouvir, getElementById: () => badge, dispatchEvent() {},
};
const ctx = vm.createContext({
  window: { addEventListener: ouvir }, document, navigator: { onLine: true },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  CustomEvent: class { constructor(type) { this.type = type; } },
  setInterval(fn, ms) { timers.push({ fn, ms }); return timers.length; }, clearInterval() {},
  setTimeout, clearTimeout, console, Date, Map, Set, AbortController, Response,
  API_OMIE: 'https://teste.invalid/omie', API: 'https://teste.invalid/api', TOKEN: 't',
  esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
  fmt: { quando: s => String(s), data: s => String(s), brl: n => 'R$ ' + n },
});
const ler = f => fs.readFileSync(f, 'utf8');
vm.runInContext(ler('store.js'), ctx);
const app = ler('app.js');
vm.runInContext(app.slice(app.indexOf('function atualizarBadge()'), app.indexOf('let _renderPendente')), ctx);
vm.runInContext(ler('omie.js'), ctx);
const agora = Date.parse('2026-10-20T15:00:00.000Z');
const iso = minAtras => new Date(agora - minAtras * 60e3).toISOString();
const base = { ok: true, agora: new Date(agora).toISOString(), automacao: { ativa: true, intervaloMinutos: 15 } };
const texto = (d, erro = '', servidorFora = false) => vm.runInContext('textoSaudeOmie', ctx)(d, erro, servidorFora);
const sit = (sync, execucao = null) => texto({ ...base, sync: { contagens: {}, ...sync }, execucao });

assert.match(sit({ status: 'completa', quando: iso(10) }), /^🟢/);
assert.match(sit({ status: 'completa', quando: iso(90) }), /^🟠.*atrasada/);
assert.match(sit({ status: 'completa', quando: iso(4 * 60) }), /^🔴.*PARADA há 4 h/);
console.log('OK conclusão recente verde, atrasada laranja, parada há 3 h ou mais vermelha');

assert.match(sit({ status: 'falhou', quando: iso(40), erro: 'x' }, { tentativas: 4, falhando_desde: iso(40), ultimo_erro: 'Omie fora <b>', proxima: iso(-10) }), /^🔴 Omie: a atualização está falhando desde .*4 tentativa\(s\).*Omie fora &lt;b&gt;.*Próxima tentativa/);
assert.match(sit({ status: 'em_andamento', quando: iso(20) }, { tentativas: 1, falhando_desde: iso(8), ultimo_erro: 'oscilou' }), /^🟠 Omie: a atualização está falhando desde/);
// Falha recente numa integração que já está parada há horas continua vermelha.
assert.match(sit({ status: 'em_andamento', quando: iso(5 * 60) }, { tentativas: 1, falhando_desde: iso(8), ultimo_erro: 'oscilou' }), /^🔴 .*Sem concluir há 5 h/);
assert.match(sit({ status: 'falhou', quando: iso(13 * 24 * 60), erro: 'x' }, { tentativas: 1, falhando_desde: iso(5), ultimo_erro: 'x' }), /^🔴/);
console.log('OK falhas seguidas: laranja nos primeiros 30 min, vermelho depois ou com a integração parada há horas');

assert.match(sit({ status: 'em_andamento', quando: iso(50) }, { tentativas: 0, completa: true, pagina: 40 }), /^🟠 Omie: releitura completa em andamento no servidor \(página 40\)\./);
assert.match(sit({ status: 'em_andamento', quando: iso(5 * 60) }, { tentativas: 0, pagina: 3, proxima: iso(5 * 60) }), /^🔴 .*Sem avançar desde .*Avise/);
// Releitura longa que continua andando (último lote há 1 min) não é parada.
assert.match(sit({ status: 'em_andamento', quando: iso(190) }, { tentativas: 0, completa: true, pagina: 121, proxima: iso(1) }), /^🟠 Omie: releitura completa em andamento no servidor \(página 121\)\.( Última|$)/);
// Chamada rodando agora (reserva válida) também não é parada.
assert.match(sit({ status: 'em_andamento', quando: iso(5 * 60) }, { tentativas: 0, pagina: 9, proxima: iso(90), reservado_ate: iso(-5) }), /^🟠/);
// Sem a hora do último avanço, vale a última conclusão.
assert.match(sit({ status: 'em_andamento', quando: iso(5 * 60) }, { tentativas: 0, pagina: 3 }), /^🔴 .*Sem concluir há 5 h/);
const nunca = sit({ status: 'em_andamento' }, { tentativas: 0 });
assert.match(nunca, /^🟠/); assert.doesNotMatch(nunca, /Infinity|NaN/);
console.log('OK andamento: releitura completa identificada, travada há horas em vermelho, nunca concluída sem números quebrados');

// Servidor antigo (sem execucao/agora): comportamento anterior preservado.
assert.match(texto({ ok: true, sync: { status: 'completa', quando: new Date(Date.now() - 5 * 60e3).toISOString(), contagens: {} }, automacao: { ativa: true } }), /^🟢/);
// Servidor anterior: falha isolada recente fica laranja; depois de 30 min, vermelha.
assert.match(texto({ ...base, sync: { status: 'falhou', quando: iso(40), termino: iso(1), erro: 'tempo', contagens: {} } }), /^🟠 .*falhou/);
assert.match(texto({ ...base, sync: { status: 'falhou', quando: iso(80), termino: iso(40), erro: 'tempo', contagens: {} } }), /^🔴 .*falhou/);
// Consulta de saúde falhando: vermelho só se o SERVIDOR está fora e a última conclusão é antiga.
const antigo = { ...base, sync: { status: 'completa', quando: iso(5 * 60), contagens: {} } };
assert.match(texto(antigo, 'O servidor não conseguiu responder (erro 503)', true), /^🔴 Não foi possível consultar.*Sem concluir há 5 h/);
assert.match(texto(antigo, 'Sem conexão com o servidor', false), /^🟠/);
assert.match(texto({ ...base, sync: { status: 'completa', quando: iso(10), contagens: {} } }, 'erro 503', true), /^🟠/);
console.log('OK resposta do servidor anterior continua verde quando em dia; falha isolada antiga e servidor fora com Omie parado ficam vermelhos');

// Selo do topo: vermelho em qualquer tela, sem esconder a data dos dados.
(async () => {
  let resposta = { ...base, agora: new Date().toISOString(), sync: { status: 'completa', quando: new Date(Date.now() - 5 * 3600e3).toISOString(), contagens: {} } };
  vm.runInContext('api=async(action)=>{if(action!=="saude")throw Error("só saúde");return resposta();}', ctx);
  ctx.resposta = () => resposta;
  vm.runInContext("S.senhaHash='s'; S.perfil='direcao'; S.cacheCompleto=true; S.ultimoPull=Date.now();", ctx);
  await vm.runInContext('vigiarSaudeOmie(); atualizarSaudeOmie()', ctx);
  assert.equal(badge.className, 'erro'); assert.match(badge.textContent, /Dados neste aparelho: .* · 🔴 Omie parado/);
  assert.ok(timers.some(t => t.ms === 60000), 'vigia global tem relógio próprio');
  resposta = { ...resposta, sync: { ...resposta.sync, quando: new Date().toISOString() } };
  await vm.runInContext('atualizarSaudeOmie()', ctx);
  assert.equal(badge.className, ''); assert.doesNotMatch(badge.textContent, /Omie parado/);
  vm.runInContext("S.erroSync='Sem conexão com o servidor'; atualizarBadge()", ctx);
  assert.match(badge.textContent, /^⚠ Sem conexão com o servidor · dados de /);
  vm.runInContext("S.erroSync=''", ctx);
  // Perfil rebaixado para corretor sem recarregar: o selo some.
  resposta = { ...resposta, sync: { ...resposta.sync, quando: new Date(Date.now() - 5 * 3600e3).toISOString() } };
  await vm.runInContext('atualizarSaudeOmie()', ctx); assert.match(badge.textContent, /Omie parado/);
  vm.runInContext("S.perfil='corretor'", ctx); await vm.runInContext('atualizarSaudeOmie()', ctx);
  assert.doesNotMatch(badge.textContent, /Omie parado/); vm.runInContext("S.perfil='direcao'", ctx);
  console.log('OK selo do topo fica vermelho com o Omie parado em qualquer tela e volta ao normal; erro mostra a data dos dados');

  // Erros de rede em português e prazo valendo durante o download da resposta.
  const store = ler('store.js'), apiSrc = store.slice(store.indexOf('async function api('), store.indexOf('const apiArq'));
  const c2 = vm.createContext({ S: { senhaHash: 's', quem: '' }, TOKEN: 't', API: 'x', AbortController, setTimeout, clearTimeout, JSON, Object, Error });
  vm.runInContext(apiSrc, c2);
  c2.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(vm.runInContext('api("snapshot")', c2), e => e.message === 'Sem conexão com o servidor' && e.rede === true);
  c2.fetch = async () => { throw new TypeError('The network connection was lost.'); };
  await assert.rejects(vm.runInContext('api("snapshot")', c2), /Sem conexão com o servidor/);
  c2.fetch = async () => { throw new TypeError('Load failed'); };
  await assert.rejects(vm.runInContext('api("snapshot")', c2), /Sem conexão com o servidor/);
  c2.fetch = async () => ({ ok: false, status: 546, json: async () => { throw new SyntaxError('x'); } });
  await assert.rejects(vm.runInContext('api("snapshot")', c2), /O servidor não conseguiu responder \(erro 546\)/);
  c2.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('truncado'); } });
  await assert.rejects(vm.runInContext('api("snapshot")', c2), /chegou incompleta/);
  c2.fetch = async (_u, o) => ({ ok: true, status: 200, json: () => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))) });
  const t0 = Date.now();
  await assert.rejects(vm.runInContext('api("snapshot",{}, {prazoMs: 80, silencioMs: 80})', c2), e => /demorou demais/.test(e.message) && e.rede === true);
  assert.ok(Date.now() - t0 < 2000, 'download parado é cortado pelo prazo de silêncio');
  // Download lento que continua chegando NÃO é cortado: cada pedaço renova o prazo.
  c2.TextDecoder = TextDecoder;
  c2.fetch = async (_u, o) => { const pedacos = ['{"ok":', 'true,', '"n":', '5}'].map(t => new TextEncoder().encode(t)); let i = 0;
    return { ok: true, status: 200, body: { getReader: () => ({ read: () => new Promise((res, rej) => { if (o.signal.aborted) return rej(Object.assign(new Error('a'), { name: 'AbortError' })); setTimeout(() => res(i < pedacos.length ? { done: false, value: pedacos[i++] } : { done: true }), 60); }) }) } }; };
  assert.deepEqual(await vm.runInContext('api("snapshot",{}, {prazoMs: 100, silencioMs: 100})', c2), { ok: true, n: 5 });
  c2.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
  assert.deepEqual(await vm.runInContext('api("snapshot")', c2), { ok: true });
  console.log('OK erros de rede em português, erro 5xx explicado, resposta truncada recusada e prazo cobrindo o download');

  // Financeiro: atalho antigo com mes "todos" não pode gravar ano inválido.
  const fp = ler('financeiro-painel.js');
  assert.match(fp, /if\(!\/\^\\d\{4\}\$\/\.test\(f\.ano\|\|''\)\)f\.ano=hojeISO\(\)\.slice\(0,4\)/);
  const lanc = fp.slice(fp.indexOf('TELAS.lancamentos='));
  const c3 = vm.createContext({ TELAS: {}, hojeISO: () => '2026-10-20', GESTAO_UI: { financeiro() {} } });
  vm.runInContext(lanc.slice(0, lanc.indexOf('\n')), c3);
  for (const [entrada, ano, mes] of [[{ tipo: 'saida', cat: 'Comissão', mes: 'todos' }, '2026', ''], [{ mes: '2025-03' }, '2025', '03'], [{ ano: '2024' }, '2024', ''], [{ ano: 'todo' }, '2026', '']]) {
    c3.TELAS._fLanc = entrada; vm.runInContext('TELAS.lancamentos()', c3);
    assert.equal(c3.TELAS._fin.ano, ano, JSON.stringify(entrada)); assert.equal(c3.TELAS._fin.mes, mes);
  }
  console.log('OK atalho de Corretores abre o Financeiro no ano corrente, sem zerar as telas');
  console.log('PASSOU: Omie parado em vermelho (texto e selo), falhas seguidas, releitura completa, erros em português e ano do Financeiro.');
})().catch(e => { console.error(e); process.exit(1); });
