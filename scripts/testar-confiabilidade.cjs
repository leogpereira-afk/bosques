// Regressões da fila offline com dados fictícios; nenhuma chamada de rede real.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '..', 'store.js'), 'utf8');

function sessao(memoria = new Map()) {
  const controle = { cheia: false, avisos: [], eventos: [], caches: [], timers: [] };
  const c = vm.createContext({
    console: { warn() {} }, navigator: { onLine: false }, API: 'https://teste.invalid',
    structuredClone, setInterval() {}, setTimeout: (f, ms) => controle.timers.push({ f, ms }),
    clearTimeout() {}, window: { addEventListener() {} },
    document: { addEventListener() {}, dispatchEvent: e => controle.eventos.push(e) },
    CustomEvent: class { constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; } },
    localStorage: {
      getItem: k => memoria.get(k) || null,
      setItem: (k, v) => { if (controle.cheia) throw Error('QuotaExceededError'); memoria.set(k, String(v)); },
      removeItem: k => memoria.delete(k)
    },
    toast: (...a) => controle.avisos.push(a),
    guardarCache: async dados => { controle.caches.push(structuredClone(dados)); }
  });
  vm.runInContext(source, c, { filename: 'store.js' });
  const run = s => vm.runInContext(s, c);
  run("S.senhaHash='sessao-ficticia'; S.quem='Demonstração'; cacheLocal=async(op,dados)=>op==='gravar'?guardarCache(dados):null;");
  return { c, run, controle, memoria };
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const testes = [];
const teste = (nome, f) => testes.push({ nome, f });

teste('memória cheia impede confirmação e preserva registro, fila e cache anteriores', async () => {
  const { run, controle, memoria } = sessao();
  run("salvar('lote',{id:'l1',obs:'antes'},{semSubir:true})");
  await run('_gravacaoCache');
  const filaAntes = memoria.get('bsq_fila_v1');
  controle.caches.length = 0; controle.cheia = true;
  assert.throws(() => run("salvar('lote',{id:'l1',obs:'depois'},{semSubir:true})"), /memória|salvar|guardar/i);
  assert.equal(run("achar('lote','l1').obs"), 'antes');
  assert.equal(memoria.get('bsq_fila_v1'), filaAntes);
  assert.equal(run('S.fila[0].registro.obs'), 'antes');
  await run('_gravacaoCache'); assert.equal(controle.caches.length, 0);
});

teste('segundo await subirFila espera o envio em andamento', async () => {
  const { c, run } = sessao(); const espera = deferred();
  run("salvar('lote',{id:'l1'},{semSubir:true});navigator.onLine=true");
  c.responder = () => espera.promise; run('api=responder');
  const a = run('subirFila()'); let terminou = false;
  const b = run('subirFila()').then(() => { terminou = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(terminou, false, 'o segundo chamador não pode confirmar antes do servidor');
  espera.resolve({ ok: true, salvos: [{ _col: 'lote', id: 'l1' }], recusados: [] });
  await Promise.all([a, b]); assert.equal(run('S.fila.length'), 0);
});

teste('recusa parcial persiste, sobrevive snapshot/reabertura e não entra em retry automático', async () => {
  const { c, run, memoria, controle } = sessao(); let envios = 0;
  run("salvar('lote',{id:'l1',obs:'alteração guardada'},{semSubir:true});salvar('cliente',{id:'c1',nome:'Exemplo'},{semSubir:true});navigator.onLine=true");
  c.responder = async action => {
    if (action === 'snapshot') return { ok: true, registros: [{ _col: 'lote', id: 'l1', obs: 'servidor anterior' }] };
    envios++;
    return { ok: true, salvos: [{ _col: 'cliente', id: 'c1', nome: 'Exemplo' }], recusados: [{ colecao: 'lote', id: 'l1', motivo: 'Revisar a permissão' }] };
  }; run('api=responder');
  await run('subirFila()');
  assert.equal(run('S.fila.length'), 1); assert.equal(run('S.fila[0].recusado'), true);
  assert.match(JSON.parse(memoria.get('bsq_fila_v1'))[0].erro, /permissão/);
  run("S.reg.lote[0].atualizadoEm='2000-01-01T00:00:00.000Z'");
  await run('puxar()'); await run('subirFila()');
  assert.equal(envios, 1); assert.equal(controle.timers.length, 0);
  assert.equal(run("achar('lote','l1').obs"), 'alteração guardada');
  assert.match(run('S.erroSync'), /permissão/);
  const reaberta = sessao(memoria); reaberta.run('lerCache()');
  assert.equal(reaberta.run("achar('lote','l1').obs"), 'alteração guardada');
  assert.match(reaberta.run('S.erroSync'), /permissão/);
});

teste('recusa total fica recuperável e só a retentativa explícita a reenvia', async () => {
  const { c, run } = sessao(); let envios = 0;
  run("salvar('lote',{id:'l1'},{semSubir:true});navigator.onLine=true");
  c.responder = async () => { envios++; throw Object.assign(Error('Perfil sem permissão'), { semPermissao: true }); };
  run('api=responder'); await run('subirFila()');
  assert.equal(run('S.fila.length'), 1); await run('subirFila()'); assert.equal(envios, 1);
  c.responder = async () => { envios++; return { ok: true, salvos: [{ _col: 'lote', id: 'l1' }], recusados: [] }; };
  run('api=responder'); await run('tentarNovamenteFila()');
  assert.equal(envios, 2); assert.equal(run('S.fila.length'), 0); assert.equal(run('S.erroSync'), '');
});

teste('edição durante envio não é apagada e ambos os lotes são aguardados', async () => {
  const { c, run, memoria } = sessao(); const espera = deferred(); let envios = 0;
  run("salvar('lote',{id:'l1',obs:'primeira'},{semSubir:true});navigator.onLine=true");
  c.responder = async () => ++envios === 1 ? espera.promise : ({ ok: true, salvos: [{ _col: 'lote', id: 'l1', obs: 'segunda' }], recusados: [] });
  run('api=responder'); const envio = run('subirFila()');
  run("salvar('lote',{id:'l1',obs:'segunda'},{semSubir:true})");
  espera.resolve({ ok: true, salvos: [{ _col: 'lote', id: 'l1', obs: 'primeira' }], recusados: [] });
  await envio;
  assert.equal(envios, 2); assert.equal(run("achar('lote','l1').obs"), 'segunda');
  assert.equal(run('S.fila.length'), 0); assert.equal(JSON.parse(memoria.get('bsq_fila_v1')).length, 0);
});

teste('resposta sem confirmação conserva item e encerra tentativa sem repetir infinitamente', async () => {
  const { c, run } = sessao(); let envios = 0;
  run("salvar('lote',{id:'l1'},{semSubir:true});navigator.onLine=true");
  c.responder = async () => { envios++; return { ok: true, salvos: [], recusados: [] }; }; run('api=responder');
  await run('subirFila()');
  assert.equal(run('S.fila.length'), 1); assert.match(run('S.fila[0].erro'), /confirm/i);
  await run('subirFila()'); assert.equal(envios, 1);
});

teste('cache agendado guarda o retrato correspondente a cada gravação', async () => {
  const { run, controle } = sessao();
  run("salvar('lote',{id:'l1',obs:'primeira'},{semSubir:true});salvar('lote',{id:'l1',obs:'segunda'},{semSubir:true})");
  await run('_gravacaoCache');
  assert.deepEqual(controle.caches.map(c => c.reg.lote[0].obs), ['primeira', 'segunda']);
});

teste('falha de armazenamento na confirmação não apaga a única cópia da fila', async () => {
  const { c, run, controle, memoria } = sessao(); const espera = deferred();
  run("salvar('lote',{id:'l1'},{semSubir:true});navigator.onLine=true");
  c.responder = () => espera.promise; run('api=responder'); const envio = run('subirFila()');
  controle.cheia = true; espera.resolve({ ok: true, salvos: [{ _col: 'lote', id: 'l1' }], recusados: [] });
  await envio;
  assert.equal(run('S.fila.length'), 1); assert.equal(JSON.parse(memoria.get('bsq_fila_v1')).length, 1);
  assert.match(run('S.erroSync'), /memória|guardar/i);
});

teste('await da fila cobre mais de 25 registros', async () => {
  const { c, run } = sessao(); let envios = 0;
  run("for(let n=0;n<31;n++)salvar('lote',{id:'l'+n},{semSubir:true});navigator.onLine=true");
  c.responder = async (_a, dados) => { envios++; return { ok: true, salvos: dados.itens.map(i => ({ ...i.registro, _col: i.colecao })), recusados: [] }; };
  run('api=responder'); await run('subirFila()');
  assert.equal(envios, 2); assert.equal(run('S.fila.length'), 0);
});

(async () => {
  let falhas = 0;
  for (const { nome, f } of testes) {
    try { await f(); console.log('OK ' + nome); }
    catch (e) { falhas++; console.error('FALHOU ' + nome + '\n' + e.stack); }
  }
  console.log(`${testes.length - falhas}/${testes.length} verificações de confiabilidade passaram`);
  if (falhas) process.exitCode = 1;
})();
