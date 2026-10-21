// Fluxos reais com store/UI reais, quota e rede controladas; só dados fictícios.
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const assert = require('node:assert/strict');
const { parseHTML } = require((process.env.BSQ_TEST_DEPS || '/tmp/bosques-test-deps') + '/node_modules/linkedom');
const raiz = path.resolve(__dirname, '..');
const lote = { id: 'lote-demo', quadra: 1, lote: 2, areaM2: 1000, status: 'Disponível' };
function ambiente(recusar) {
  const { document } = parseHTML('<html><body><main id="app"></main></body></html>');
  const memoria = new Map();
  const controle = { quota: true, envios: 0, caches: 0, avisos: [], arquivos: [], escritas: 0 };
  const ctx = vm.createContext({ document, console: { warn() {} }, Blob, File, structuredClone,
    navigator: { onLine: true }, API: 'https://teste.invalid',
    location: { hash: '' }, window: { innerWidth: 390, addEventListener() {} },
    CustomEvent: document.defaultView.CustomEvent, setInterval() {}, setTimeout() {}, clearTimeout() {},
    localStorage: {
      getItem: k => memoria.get(k) || null, removeItem: k => memoria.delete(k),
      setItem: (k, v) => {
        if (k === 'bsq_fila_v1') {
          const fila = JSON.parse(v);
          if (controle.quota && recusar(fila)) throw Error('QuotaExceededError');
          controle.escritas++;
        }
        memoria.set(k, String(v));
      }
    },
    campos: {}, lote,
    registrarAviso: msg => controle.avisos.push(msg),
    cacheFake: async () => { controle.caches++; },
    enviarFake: async (_acao, dados) => {
      controle.envios++;
      if (controle.quota) return new Promise(() => {});
      return { ok: true, salvos: dados.itens.map(i => ({ ...i.registro, _col: i.colecao })), recusados: [] };
    }
  });
  for (const f of ['ui.js', 'store.js', 'carne.js', 'financeiro-core.js', 'espelho.js', 'vendas.js'])
    vm.runInContext(fs.readFileSync(path.join(raiz, f), 'utf8'), ctx, { filename: f });
  const run = s => vm.runInContext(s, ctx);
  run("S.cfg={formasPg:['PIX'],reajuste:{pct:6,aCada:12}};S.quem='Demonstração';S.senhaHash='ficticia';S.reg.lote=[lote];cacheLocal=cacheFake;api=enviarFake;toast=registrarAviso;lerCampos=()=>campos;confirmar=async()=>true;TELAS.venda=TELAS.lote=()=>{};");
  ctx.salvarNoAparelho = (_blob, nome) => controle.arquivos.push(nome);
  ctx.PDF = { proposta: () => new Blob(['PDF fictício']) };
  ctx.finCentrosDisponiveis = () => [];
  return { ctx, run, document, controle, memoria,
    clicar: async texto => {
      const b = [...document.querySelectorAll('.fundo-modal footer button')].find(x => x.textContent === texto);
      assert.ok(b, 'Botão ausente: ' + texto); b.click(); await new Promise(setImmediate);
    }
  };
}
let testes = 0, falhas = 0;
async function teste(nome, fn) {
  testes++;
  try { await fn(); console.log('OK ' + nome); }
  catch (e) { falhas++; console.error('FALHOU ' + nome + '\n' + e.stack); }
}
const camposVenda = { clienteId: '', nomeNovo: 'Pessoa de demonstração', cpfNovo: '', telNovo: '',
  entrada: '1000', dataEntrada: '2026-10-21', formaEntrada: 'PIX', qtde: '2', valorParcela: '500', tipoParcela: 'Fixa' };

(async () => {
  await teste('Registrar repetido com quota na entrada não deixa cliente/venda parciais nem envio prematuro', async () => {
    const a = ambiente(f => f.some(x => x.colecao === 'rec'));
    a.ctx.campos = camposVenda;
    a.run('abrirNovaVenda(lote,{entrada:1000,qtde:2,valorParcela:500})');
    for (let n = 0; n < 2; n++) {
      await a.clicar('Registrar');
      assert.equal(a.run('S.reg.cliente.length'), 0);
      assert.equal(a.run('S.reg.venda.length'), 0);
      assert.equal(a.run('S.reg.rec.length'), 0);
      assert.equal(a.run('S.fila.length'), 0);
      assert.equal(a.controle.envios, 0); assert.equal(a.controle.caches, 0);
      assert.ok(a.document.querySelector('.fundo-modal'));
    }
    a.controle.quota = false; await a.clicar('Registrar'); await a.run('subirFila()');
    assert.equal(a.run('S.reg.cliente.length'), 1); assert.equal(a.run('S.reg.venda.length'), 1); assert.equal(a.run('S.reg.rec.length'), 1);
    assert.equal(a.run('S.reg.rec[0].vendaId===S.reg.venda[0].id'), true);
    assert.equal(a.run('S.reg.venda[0].clienteId===S.reg.cliente[0].id'), true);
    assert.equal(a.controle.envios, 1);
  });

  await teste('Conversão não marca proposta aceita se o grupo não couber', async () => {
    const a = ambiente(f => f.some(x => x.colecao === 'rec'));
    a.ctx.campos = camposVenda;
    a.run("S.reg.prop=[{id:'prop-demo',situacao:'enviada'}];abrirNovaVenda(lote,{entrada:1000,qtde:2,valorParcela:500,propostaId:'prop-demo'})");
    await a.clicar('Registrar');
    assert.equal(a.run('S.reg.prop[0].situacao'), 'enviada');
    assert.equal(a.run('S.reg.prop[0].vendaId'), undefined);
    assert.equal(a.run('S.reg.venda.length'), 0);
    a.controle.quota = false; await a.clicar('Registrar'); await a.run('subirFila()');
    assert.equal(a.run('S.reg.prop[0].situacao'), 'aceita');
    assert.equal(a.run('S.reg.prop[0].vendaId===S.reg.venda[0].id'), true);
  });

  await teste('Proposta e novo cliente falham juntos; repetir não duplica interessado', async () => {
    const a = ambiente(f => f.some(x => x.colecao === 'prop'));
    a.run("var sim={nome:'Pessoa de demonstração',telefone:'38900000000',entrada:1000,qtde:2,valorParcela:500,tipo:'Fixa'}");
    for (let n = 0; n < 2; n++) {
      await assert.rejects(a.run('baixarPdfProposta(lote,sim)'), /guardar/i);
      assert.equal(a.run('S.reg.cliente.length'), 0); assert.equal(a.run('S.reg.prop.length'), 0);
      assert.equal(a.run('sim.clienteId'), undefined); assert.equal(a.controle.envios, 0);
    }
    a.controle.quota = false; await a.run('baixarPdfProposta(lote,sim)');
    assert.equal(a.run('S.reg.cliente.length'), 1); assert.equal(a.run('S.reg.prop.length'), 1);
    assert.equal(a.run('S.reg.prop[0].clienteId===S.reg.cliente[0].id'), true);
    assert.equal(a.controle.arquivos.length, 1);
  });

  await teste('Telefone do cliente existente permanece anterior se a proposta falhar', async () => {
    const a = ambiente(f => f.some(x => x.colecao === 'prop'));
    a.run("S.reg.cliente=[{id:'cli-demo',nome:'Pessoa de demonstração',whatsapp:''}];var sim={nome:'Pessoa de demonstração',telefone:'38900000000',entrada:1000,qtde:2,valorParcela:500,tipo:'Fixa'}");
    await assert.rejects(a.run('baixarPdfProposta(lote,sim)'), /guardar/i);
    assert.equal(a.run('S.reg.cliente[0].whatsapp'), ''); assert.equal(a.run('S.fila.length'), 0);
    a.controle.quota = false; await a.run('baixarPdfProposta(lote,sim)');
    assert.equal(a.run('S.reg.cliente.length'), 1); assert.equal(a.run('S.reg.cliente[0].whatsapp'), '38900000000');
  });

  await teste('Distrato e devolução falham juntos e repetição não duplica saída', async () => {
    const a = ambiente(f => f.some(x => x.colecao === 'cx'));
    a.ctx.campos = { valorDevolvido: '700', devolvidoAgora: true, em: '2026-10-21', motivo: 'Exemplo' };
    a.run("S.reg.venda=[{id:'v-demo',situacao:'ativa',quadra:1,lote:2,historico:[]}];abrirDistrato(S.reg.venda[0],{pago:1000})");
    for (let n = 0; n < 2; n++) {
      await a.clicar('Confirmar distrato');
      assert.equal(a.run('S.reg.venda[0].situacao'), 'ativa');
      assert.equal(a.run('S.reg.venda[0].historico.length'), 0); assert.equal(a.run('S.reg.cx.length'), 0);
      assert.equal(a.controle.envios, 0);
    }
    a.controle.quota = false; await a.clicar('Confirmar distrato'); await a.run('subirFila()');
    assert.equal(a.run('S.reg.venda[0].situacao'), 'distratada'); assert.equal(a.run('S.reg.cx.length'), 1);
    assert.equal(a.run('S.reg.cx[0].valor'), 700); assert.equal(a.run('S.reg.cx[0].vendaId'), 'v-demo');
  });

  await teste('Mover parcela preserva origem e destino quando o conjunto não cabe', async () => {
    const a = ambiente(f => f.some(x => x.colecao === 'venda' && x.registro.id === 'destino'));
    a.ctx.campos = { venc: '2026-11-21', valor: '100', valorDia: '100', mover: 'destino', obs: '' };
    a.run("S.reg.venda=[{id:'origem',clienteId:'c-demo',situacao:'ativa',parcelas:[{venc:'2026-11-21',valor:100}]},{id:'destino',clienteId:'c-demo',situacao:'ativa',parcelas:[]}];abrirEditarParcela(S.reg.venda[0],0)");
    await a.clicar('Salvar');
    assert.equal(a.run('S.reg.venda[0].parcelas[0]._remover'), undefined);
    assert.equal(a.run('S.reg.venda[1].parcelas.length'), 0); assert.equal(a.controle.envios, 0);
    a.controle.quota = false; await a.clicar('Salvar'); await a.run('subirFila()');
    assert.equal(a.run('S.reg.venda[0].parcelas[0]._remover'), true);
    assert.equal(a.run('S.reg.venda[1].parcelas.length'), 1);
  });

  await teste('Adicionar parcela após falha de quota não reaproveita a inclusão da tentativa anterior', async () => {
    const a = ambiente(f => f.some(x => x.colecao === 'venda' && x.registro.id === 'v-demo'));
    a.ctx.campos = { venc: '2026-11-21', valor: '100', valorDia: '100', mover: '', obs: '' };
    a.run("S.reg.venda=[{id:'v-demo',clienteId:'c-demo',situacao:'ativa',parcelas:[]}];abrirEditarParcela(S.reg.venda[0],-1)");
    await a.clicar('Adicionar');
    assert.equal(a.run('S.reg.venda[0].parcelas.length'), 0);
    assert.equal(a.controle.envios, 0);
    a.controle.quota = false; await a.clicar('Adicionar'); await a.run('subirFila()');
    assert.equal(a.run('S.reg.venda[0].parcelas.length'), 1);
    assert.equal(a.run('S.reg.venda[0].parcelas.reduce((s,p)=>s+p.valor,0)'), 100);
    assert.equal(a.controle.envios, 1);
  });

  await teste('Editar parcela após quota não troca o índice capturado ao ordenar a tentativa recusada', async () => {
    const a = ambiente(f => f.some(x => x.colecao === 'venda' && x.registro.id === 'v-demo'));
    a.ctx.campos = { venc: '2027-01-21', valor: '100', valorDia: '100', mover: '', obs: '' };
    a.run("S.reg.venda=[{id:'v-demo',clienteId:'c-demo',situacao:'ativa',parcelas:[{tid:'man-a',venc:'2026-12-21',valor:100},{tid:'man-b',venc:'2026-11-21',valor:200}]}];abrirEditarParcela(S.reg.venda[0],0)");
    await a.clicar('Salvar');
    assert.equal(a.run('S.reg.venda[0].parcelas[0].venc'), '2026-12-21');
    assert.equal(a.controle.envios, 0);
    a.controle.quota = false; await a.clicar('Salvar'); await a.run('subirFila()');
    assert.equal(a.run("S.reg.venda[0].parcelas.filter(p=>p.tid==='man-a').length"), 1);
    assert.equal(a.run("S.reg.venda[0].parcelas.filter(p=>p.tid==='man-b').length"), 1);
    assert.equal(a.run("S.reg.venda[0].parcelas.find(p=>p.tid==='man-a').venc"), '2027-01-21');
    assert.equal(a.run('S.reg.venda[0].parcelas.reduce((s,p)=>s+p.valor,0)'), 300);
  });

  console.log(`${testes - falhas}/${testes} verificações de grupos locais passaram`);
  if (falhas) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
