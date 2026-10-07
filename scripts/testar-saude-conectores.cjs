// Regressões em memória: recuperação de rede e consulta de saúde sem gravar dados.
const fs = require('fs'), vm = require('vm'), assert = require('node:assert/strict');
const callbacks = {}, timers = [], eventos = [], ligados = new Set();
const ouvir = (tipo, fn) => (callbacks[tipo] ||= []).push(fn);
const emitir = tipo => (callbacks[tipo] || []).forEach(fn => fn());
const badge = { className: '', textContent: '' };
const document = {
  hidden: false, body: { contains: el => ligados.has(el) },
  addEventListener: ouvir, getElementById: () => badge,
  dispatchEvent(e) { eventos.push(e.type); emitir(e.type); },
};
const ctx = vm.createContext({
  window: { addEventListener: ouvir }, document, navigator: { onLine: false },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  CustomEvent: class { constructor(type) { this.type = type; } },
  setInterval(fn, ms) { timers.push({ fn, ms }); return timers.length; }, clearInterval() {},
  setTimeout, clearTimeout, console, Date, Map, Set,
  API_OMIE: 'https://teste.invalid/omie',
  esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
  fmt: { quando: s => String(s), data: s => String(s), brl: n => 'R$ ' + n },
});
const ler = f => fs.readFileSync(f, 'utf8');
vm.runInContext(ler('store.js'), ctx);
const app = ler('app.js');
vm.runInContext(app.slice(app.indexOf('function atualizarBadge()'), app.indexOf('let _renderPendente')), ctx);
document.addEventListener('bsq:status', () => vm.runInContext('atualizarBadge()', ctx));
vm.runInContext("S.senhaHash='sessao-teste'; S.cacheCompleto=true; S.ultimoPull=Date.now(); atualizarBadge();", ctx);
assert.match(badge.textContent, /offline/);
ctx.navigator.onLine = true; emitir('online');
assert.doesNotMatch(badge.textContent, /offline/, 'Volta da internet precisa atualizar o aviso, mesmo com cache recente e fila vazia');
assert.ok(eventos.includes('bsq:status'));
console.log('OK offline → online com cache recente, sem sincronização ou fila');

vm.runInContext(ler('omie.js'), ctx);
const chamadas = [];
const recente = new Date(Date.now() - 10 * 60e3).toISOString();
let resposta = { ok: true, sync: { status: 'completa', quando: recente, contagens: {} }, automacao: { ativa: true, intervaloMinutos: 15 } };
let erro = null, gravacoes = 0;
ctx.responder = async (action, dados, opts) => {
  chamadas.push({ action, dados, opts });
  if (action !== 'saude') { gravacoes++; throw Error('A saúde não pode disparar escrita ou importação'); }
  if (erro) throw erro;
  return resposta;
};
vm.runInContext('api=(action,dados,opts)=>responder(action,dados,opts)', ctx);
const el = () => ({ innerHTML: '', style: {}, dataset: {}, setAttribute() {}, querySelector() { return null; } });
const home = el(), config = el(); ligados.add(home); ligados.add(config);
ctx.home = home; ctx.config = config;
const flush = async () => { for (let n = 0; n < 6; n++) await new Promise(setImmediate); };

(async () => {
  await vm.runInContext('statusOmieHome(home)', ctx);
  await vm.runInContext('statusOmieConfig(config)', ctx);
  assert.match(home.innerHTML, /🟢/); assert.match(config.innerHTML, /🟢/);
  assert.ok(home.innerHTML.includes(recente) || home.innerHTML.includes(new Date(recente).toLocaleString('pt-BR')));

  // A mesma última conclusão recente pode coexistir com uma falha posterior.
  resposta = { ...resposta, sync: { ...resposta.sync, status: 'falhou', erro: 'Falha de teste <privado>' } };
  await vm.runInContext('atualizarSaudeOmie()', ctx);
  for (const alvo of [home, config]) { assert.match(alvo.innerHTML, /🔴/); assert.match(alvo.innerHTML, /falhou/); assert.doesNotMatch(alvo.innerHTML, /<privado>/); }
  resposta = { ...resposta, sync: { ...resposta.sync, status: 'em_andamento', inicio: recente } };
  await vm.runInContext('atualizarSaudeOmie()', ctx);
  assert.match(home.innerHTML, /🟠/); assert.match(config.innerHTML, /🟠/);

  // Uma falha na consulta do navegador não pode se passar por falha do Omie.
  resposta = { ...resposta, sync: { ...resposta.sync, status: 'completa' } };
  await vm.runInContext('atualizarSaudeOmie()', ctx);
  erro = Error('Failed to fetch');
  await vm.runInContext('atualizarSaudeOmie()', ctx);
  assert.match(config.innerHTML, /🟠/); assert.match(config.innerHTML, /consultar.*situação/i);
  assert.match(config.innerHTML, /Última conclusão conhecida/);
  assert.doesNotMatch(config.innerHTML, /integração falhou/i);
  assert.doesNotMatch(config.innerHTML, /Failed to fetch/);
  erro = null;
  const saudeTimer = timers.find(t => t.ms === 60000);
  assert.ok(saudeTimer, 'Consulta da saúde deve ter sua própria atualização periódica');
  saudeTimer.fn(); await flush();
  for (const alvo of [home, config]) { assert.match(alvo.innerHTML, /🟢/); assert.doesNotMatch(alvo.innerHTML, /Failed to fetch/); }
  console.log('OK saúde coerente, falha real, andamento, falha temporária → recuperação por consulta periódica');

  let antes = chamadas.length; document.hidden = true; saudeTimer.fn(); await flush();
  assert.equal(chamadas.length, antes, 'Aba escondida não deve consultar');
  document.hidden = false; emitir('visibilitychange'); await flush();
  assert.ok(chamadas.length > antes, 'Voltar à aba deve consultar novamente');
  assert.ok(chamadas.every(c => c.opts.prazoMs === 20000));
  assert.ok(chamadas.every(c => c.dados.resumida === true));
  assert.equal(gravacoes, 0);

  resposta = { ...resposta, sync: { ...resposta.sync, quando: new Date(Date.now() - 46 * 60e3).toISOString() } };
  await vm.runInContext('atualizarSaudeOmie()', ctx);
  for (const alvo of [home, config]) { assert.match(alvo.innerHTML, /🟠/); assert.match(alvo.innerHTML, /atrasada/); }
  resposta = { ...resposta, sync: { ...resposta.sync, quando: recente } };

  resposta = { ...resposta, sync: { ...resposta.sync, pendencias: [
    ...Array.from({ length: 14 }, (_, i) => ({ tipo: 'vinculo', titulo: i + 1, valor: 30, cpf: 'PRIVADO', pessoa: 'PESSOA_PRIVADA' })),
    { tipo: 'possivel_duplicidade', titulo: 20, valor: 50, data: '2026-10-01' },
    { tipo: 'sem_data', titulo: 21, valor: 60 },
  ] } };
  await vm.runInContext('atualizarSaudeOmie()', ctx);
  assert.match(config.innerHTML, /14.*vínculo/i); assert.match(config.innerHTML, /1.*duplicidade/i);
  assert.match(config.innerHTML, /1.*outr/i);
  assert.ok((config.innerHTML.match(/data-pendencia-omie/g) || []).length <= 12);
  assert.doesNotMatch(config.innerHTML, /PRIVADO|PESSOA_PRIVADA|lance à mão|ficaram de fora/);
  assert.doesNotMatch(home.innerHTML, /data-pendencia-omie/);
  resposta = { ...resposta, sync: { ...resposta.sync,
    pendencias: [...resposta.sync.pendencias.slice(0, 4), ...resposta.sync.pendencias.slice(-2)],
    pendenciasResumo: { total: 3340, vinculo: 3320, possivel_duplicidade: 17, outros: 3 },
  } };
  await vm.runInContext('atualizarSaudeOmie()', ctx);
  assert.match(config.innerHTML, /3340 registro\(s\) para conferir/);
  assert.match(config.innerHTML, /3320 · vínculo/); assert.match(config.innerHTML, /17 · possível duplicidade/);
  assert.match(config.innerHTML, /3 · outras/); assert.match(config.innerHTML, /Mais 3316/);
  assert.equal((config.innerHTML.match(/data-pendencia-omie/g) || []).length, 6);
  console.log('OK pendências agrupadas, detalhes limitados, privacidade e nenhuma recomendação de relançamento');

  ligados.clear(); antes = chamadas.length; saudeTimer.fn(); await flush();
  assert.equal(chamadas.length, antes, 'Fora das telas com saúde não deve consultar');
  console.log('PASSOU saúde dos conectores: somente leitura, recuperação visual e atualização independente dos cadastros');
})().catch(e => { console.error(e); process.exit(1); });
