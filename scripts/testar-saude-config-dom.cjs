// Saúde recupera sem recriar o formulário nem enviar as alterações em digitação.
const fs = require('fs'), vm = require('vm'), assert = require('node:assert/strict');
(async () => {
  const deps = process.env.BSQ_TEST_DEPS || '/tmp/bosques-test-deps';
  const { parseHTML } = await import(deps + '/node_modules/linkedom/esm/index.js');
  const { document } = parseHTML('<html><body><div id="topo"></div><div id="lateral"></div><div id="app"></div></body></html>');
  const timers = [], pedidos = [], resposta = { ok: true, sync: {
    status: 'completa', quando: new Date().toISOString(), contagens: {},
    pendencias: [{ tipo: 'vinculo', titulo: 123, valor: 150 }],
  }, automacao: { ativa: true, intervaloMinutos: 15 } };
  let falhar = true;
  const ctx = vm.createContext({ document, window: { addEventListener() {}, FINANCEIRO_EM_VALIDACAO: true },
    navigator: { onLine: true }, location: { hash: '#/config' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setInterval(fn, ms) { timers.push({ fn, ms }); return timers.length; }, clearInterval() {},
    setTimeout: () => 0, clearTimeout() {}, console, URL, Blob, TextEncoder, TextDecoder,
    fetch: async () => ({ ok: false }),
    CustomEvent: document.defaultView.CustomEvent,
    responder: async (acao, dados, opts) => {
      pedidos.push({ acao, dados, opts });
      assert.equal(acao, 'saude', 'Consulta visual não deve salvar, sincronizar ou baixar snapshot');
      if (opts?.url?.endsWith('/bsq-omie')) {
        if (falhar) throw Error('Falha temporária simulada');
        return resposta;
      }
      return { ok: true, backups: [{ dia: new Date().toISOString().slice(0, 10) }] };
    },
  });
  for (const f of ['config.js', 'ui.js', 'mapa-espelho.js', 'store.js', 'carne.js', 'financeiro-core.js', 'pdf.js', 'espelho.js',
    'vendas.js', 'caixa.js', 'cadastros.js', 'cronograma.js', 'omie.js', 'financeiro.js', 'financeiro-gestao.js',
    'financeiro-painel.js', 'contratos.js', 'apresentacao.js', 'app.js']) {
    let fonte = fs.readFileSync(f, 'utf8');
    if (f === 'app.js') fonte = fonte.slice(0, fonte.indexOf('(async function iniciar()'));
    vm.runInContext(fonte, ctx, { filename: f });
  }
  Object.assign(ctx, ctx.window);
  vm.runInContext("S.senhaHash='teste'; S.cacheCompleto=true; S.quem='Teste'; S.cfg={empresa:{nome:'Empresa inicial'},centrosCusto:[],usuarios:[]}; api=(acao,dados,opts)=>responder(acao,dados,opts); TELAS.config();", ctx);
  const esperar = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };
  await esperar();
  const saude = document.querySelector('#cf-omie-saude'), campo = document.querySelector('[data-campo="empresa.nome"]');
  assert.match(saude.textContent, /consultar a situação/);
  campo.value = 'Alteração ainda não salva';
  const timer = timers.find(t => t.ms === 60000); assert.ok(timer);
  falhar = false; timer.fn(); await esperar();
  assert.equal(document.querySelector('#cf-omie-saude'), saude);
  assert.equal(document.querySelector('[data-campo="empresa.nome"]'), campo);
  assert.equal(campo.value, 'Alteração ainda não salva');
  assert.match(saude.textContent, /🟢/);
  assert.equal(vm.runInContext('S.cfg.empresa.nome', ctx), 'Empresa inicial');
  const detalhes = saude.querySelector('details'); detalhes.open = true;
  timer.fn(); await esperar(); assert.equal(saude.querySelector('details').open, true);
  assert.ok(pedidos.every(p => p.acao === 'saude'));
  console.log('PASSOU DOM: Configurações recupera sozinha, preserva campo em edição e detalhes abertos, sem gravação, snapshot ou importação.');
})().catch(e => { console.error(e); process.exit(1); });
