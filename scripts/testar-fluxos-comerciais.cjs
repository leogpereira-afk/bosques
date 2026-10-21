/* Regressões locais; dependências de gravação/rede substituídas por memória.
 * Executa os módulos reais e inspeciona mensagens, formulários e registros. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { parseHTML } = require((process.env.BSQ_TEST_DEPS || '/tmp/bosques-test-deps') + '/node_modules/linkedom');
const raiz = path.resolve(__dirname, '..');
let falhas = 0, testes = 0;
function ambiente() {
  const { document } = parseHTML('<html><body><main id="app"></main></body></html>');
  const app = document.getElementById('app');
  class DataTeste extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-21T12:00:00-03:00'])); } static now() { return new Date('2026-10-21T12:00:00-03:00').getTime(); } }
  const ctx = vm.createContext({ console, Date: DataTeste, Math, Blob, File, navigator: {}, P_URL: 'https://proposta.invalid',
    S: { cfg: { formasPg: ['PIX'], reajuste: { pct: 6, aCada: 12 } }, perfil: 'direcao', quem: 'Teste', reg: { venda: [], rec: [], lote: [], prop: [], cliente: [], corretor: [] } },
    document, location: { hash: '' },
    registros: [], avisos: [], campos: {}, app,
    window: { open() {} }, finSaida: x => String(x), finEntrada: x => String(x),
    rotaAtual: () => ({ nome: 'propostas' }),
  });
  for (const f of ['ui.js', 'carne.js', 'financeiro-core.js', 'espelho.js', 'vendas.js'])
    vm.runInContext(fs.readFileSync(path.join(raiz, f), 'utf8'), ctx, { filename: f });
  vm.runInContext(`
    lista = col => S.reg[col] || [];
    achar = (col,id) => lista(col).find(r => r.id === id);
    salvar = (col,dados) => { const r={...dados,id:dados.id || col+'-'+(registros.length+1)}; registros.push({col,r}); const i=lista(col).findIndex(x=>x.id===r.id); if(i<0)S.reg[col].push(r);else S.reg[col][i]={...S.reg[col][i],...r}; return r; };
    let seqRegistro=0;
    novoIdRegistro=()=> 'novo-'+(++seqRegistro);
    salvarGrupo=itens=>itens.map(i=>salvar(i.colecao,i.registro));
    abrirModal = opts => { modal=opts; return { querySelector: () => ({ addEventListener() {}, dataset: {} }) }; };
    lerCampos = () => campos;
    toast = (msg,tipo) => avisos.push({msg,tipo});
    fecharModal = fecharSilencioso = () => {};
    confirmar = async () => true;
    historiar = () => [];
  `, ctx);
  return { ctx, run: code => vm.runInContext(code, ctx) };
}
async function test(nome, fn) {
  testes++;
  try { await fn(); console.log('OK ' + nome); }
  catch (e) { falhas++; console.error('FALHOU ' + nome + ': ' + e.message); }
}
const lote = { id: 'lote-demo', quadra: 1, lote: 2, status: 'Disponível', areaM2: 1000 };
const proposta = { id: 'proposta-demo', loteId: lote.id, quadra: 1, lote: 2, entrada: 1000,
  entradaModo: 'cartao', entradaDetalhe: 'cartão: 4x de R$ 275,00 — total R$ 1.100,00 com juros de 10%',
  cliente: { nome: 'Pessoa de demonstração', telefone: '38900000000' },
  qtdeParcelas: 2, valorParcela: 500, tipoParcela: 'Fixa', situacao: 'enviada' };
const venda = { id: 'v-demo', clienteNome: 'Pessoa Teste', quadra: 1, lote: 2, entrada: 1000,
  dataVenda: '2026-09-01', dataEntrada: '2026-09-01', qtdeParcelas: 2, valorParcela: 500,
  parcelas: [{ tid: 'parcela-demo', venc: '2026-10-01', valor: 500, valorDia: 400, descontoConfirmado: true, liquidacao: { juros: 20, multa: 10 } }] };
(async () => {
  for (const [inicio, datas] of [
    ['2026-03-31', ['2026-03-31','2026-04-30','2026-05-31']],
    ['2026-03-30', ['2026-03-30','2026-04-30','2026-05-30']],
    ['2027-03-29', ['2027-03-29','2027-04-29','2027-05-29']],
    ['2028-01-31', ['2028-01-31','2028-02-29','2028-03-31']],
  ]) await test('Data explícita preserva dia: ' + inicio, () => {
    const {ctx,run}=ambiente();ctx.v={entrada:0,qtdeParcelas:3,valorParcela:100,inicioParcelas:inicio};
    assert.deepEqual(JSON.parse(run('JSON.stringify(CARNE.gerarParcelas(v,{}).map(l=>l.venc))')),datas);
  });
  await test('Cobrança usa saldo com juros e multa após pagamento parcial', () => {
    const {ctx,run}=ambiente(); ctx.v=venda;ctx.recs=[{id:'rec-demo',vendaId:venda.id,valor:200,data:'2026-10-05',alocacoes:[{tid:'parcela-demo',valor:200}]}];
    assert.match(run('msgCobranca(v, FINANCEIRO.resumo(v,recs,hojeISO()))'),/330,00/);
  });
  await test('Lembrete usa desconto contratual da próxima parcela', () => {
    const {ctx,run}=ambiente(); ctx.v={...venda,parcelas:[{...venda.parcelas[0],venc:'2026-11-01',liquidacao:{}}]};
    assert.match(run('msgCobranca(v, FINANCEIRO.resumo(v,[],hojeISO()))'),/400,00/);
  });
  await test('Cópia de link só confirma depois da área de transferência', async () => {
    const {ctx,run}=ambiente();ctx.p=proposta;let liberar;
    ctx.navigator.clipboard={writeText:()=>new Promise(resolve=>liberar=resolve)};
    run('mostrarLinkProposta(p)');const tarefa=run('modal.acoes[0].aoClicar()');
    assert.equal(ctx.avisos.length,0);liberar();await tarefa;assert.match(ctx.avisos[0].msg,/copiado/i);
  });
  await test('Cópia rejeitada orienta cópia manual sem falso sucesso', async () => {
    const {ctx,run}=ambiente();ctx.p=proposta;ctx.navigator.clipboard={writeText:async()=>{throw new Error('Permissão recusada');}};
    run('mostrarLinkProposta(p)');await run('modal.acoes[0].aoClicar()');
    assert.ok(ctx.avisos.some(x=>/manualmente/i.test(x.msg)));assert.ok(!ctx.avisos.some(x=>/^Link copiado/.test(x.msg)));
  });
  await test('Sem área de transferência orienta cópia manual', async () => {
    const {ctx,run}=ambiente();ctx.p=proposta;run('mostrarLinkProposta(p)');await run('modal.acoes[0].aoClicar()');
    assert.ok(ctx.avisos.some(x=>/manualmente/i.test(x.msg)));
  });
  await test('Link só abre após confirmação do vínculo do PDF da proposta', async () => {
    const {ctx,run}=ambiente();ctx.l=lote;ctx.sim={nome:'Pessoa Teste',entrada:1000,qtde:2,valorParcela:100};
    ctx.PDF={proposta:()=>new Blob(['PDF sintético'])};ctx.enviarArquivo=async()=>({id:'arquivo-demo'});
    run(`
      const salvarOriginal=salvar;
      salvar=(col,dados)=>{const r=salvarOriginal(col,{...dados,_pendente:true});return r;};
      let envios=0;
      subirFila=async()=>{ if(++envios===1) Object.assign(S.reg.prop[0],{codigo:'PR-DEMO',tokenPublico:'token-demo',_pendente:false}); };
    `);
    await run('enviarLinkProposta(l,sim)');
    assert.equal(ctx.modal,undefined);assert.ok(ctx.avisos.some(x=>/confirm|pendente/i.test(x.msg)));
  });
  await test('Conversão preserva interessado e condição da entrada', () => {
    const {ctx,run}=ambiente();ctx.S.reg.prop=[proposta];ctx.S.reg.lote=[lote];
    run("abrirFichaProposta('proposta-demo'); modal.acoes.find(a=>a.texto==='Virou venda!').aoClicar({})");
    assert.match(ctx.modal.corpo,/value="Pessoa de demonstração"/);assert.match(ctx.modal.corpo,/value="38900000000"/);
    assert.match(ctx.modal.corpo,/4x de R\$ 275,00/);
    ctx.campos={clienteId:'',nomeNovo:proposta.cliente.nome,telNovo:proposta.cliente.telefone,entrada:'1000',entradaDetalhe:proposta.entradaDetalhe,qtde:'2',valorParcela:'500',dataEntrada:'',tipoParcela:'Fixa'};
    run("modal.acoes.find(a=>a.texto==='Registrar').aoClicar({})");
    const v=ctx.S.reg.venda[0];assert.equal(v.entradaModo,'cartao');assert.equal(v.entradaDetalhe,proposta.entradaDetalhe);
    assert.equal(ctx.S.reg.cliente[0].nome,proposta.cliente.nome);assert.equal(ctx.S.reg.cliente[0].whatsapp,proposta.cliente.telefone);
    assert.equal(ctx.S.reg.prop[0].vendaId,v.id);
  });
  await test('Entrada pendente do Omie pode receber baixa própria', () => {
    const {ctx,run}=ambiente();ctx.v=venda;ctx.S.reg.venda=[venda];run('abrirBaixa(v,resumoVenda(v))');
    assert.match(ctx.modal.corpo,/<option value="0" selected/);
    ctx.campos={valor:'500',data:'2026-10-21',forma:'PIX',parcelaN:'0'};run('TELAS.venda=()=>{}; modal.acoes[1].aoClicar({})');
    assert.equal(ctx.S.reg.rec[0].tipo,'entrada');assert.equal(run('resumoVenda(v).entradaSaldo'),500);assert.equal(run('resumoVenda(v).carne[0].saldo'),530);
  });
  await test('Ficha mostra entrada pendente e baixa de juros restantes', () => {
    const {ctx,run}=ambiente();ctx.v=venda;ctx.S.reg.venda=[venda];
    ctx.S.reg.rec=[{id:'r-demo',vendaId:venda.id,valor:500,data:'2026-10-21',alocacoes:[{tid:'parcela-demo',valor:500}]}];
    run('TELAS.venda(v.id)');
    assert.match(ctx.app.innerHTML,/data-n="0" data-falta="1000"/);
    assert.match(ctx.app.innerHTML,/data-n="1" data-falta="30"/);
    assert.ok(!ctx.app.innerHTML.includes('data-i="-1"'));
  });
  await test('Baixa na segunda parcela derivada preserva parcela escolhida', () => {
    const {ctx,run}=ambiente();ctx.v={...venda,entrada:0,parcelas:[]};ctx.S.reg.venda=[ctx.v];
    run('abrirBaixa(v,resumoVenda(v),2)');ctx.campos={valor:'500',data:'2026-10-21',forma:'PIX',parcelaN:'2'};run('TELAS.venda=()=>{}; modal.acoes[1].aoClicar({})');
    assert.equal(run('resumoVenda(v).carne.find(l=>l.n===1).pago'),0);assert.equal(run('resumoVenda(v).carne.find(l=>l.n===2).pago'),500);
  });
  await test('Proposta com entrada negativa não cria cliente nem proposta', () => {
    const {ctx,run}=ambiente();ctx.l=lote;ctx.sim={nome:'Pessoa Teste',entrada:-1,qtde:2,valorParcela:100};
    assert.equal(run('montarPropDoSim(l,sim)'),null);assert.equal(ctx.registros.length,0);
  });
  for (const campo of ['entrada','qtde','valorParcela','comissao','comissao2']) await test('Nova venda rejeita negativo em '+campo+' antes de cadastrar cliente', () => {
    const {ctx,run}=ambiente();ctx.l=lote;run('abrirNovaVenda(l,{entrada:1000,qtde:2,valorParcela:500})');
    ctx.campos={nomeNovo:'Pessoa Teste',entrada:'1000',qtde:'2',valorParcela:'500',[campo]:'-1'};
    run("modal.acoes.find(a=>a.texto==='Registrar').aoClicar({})");assert.equal(ctx.registros.length,0);
  });
  for (const campo of ['entrada','qtdeParcelas','valorParcela','comissao','comissao2']) await test('Edição de venda rejeita negativo em '+campo, () => {
    const {ctx,run}=ambiente();ctx.v=venda;run('abrirEditarVenda(v)');
    ctx.campos={entrada:'1000',qtdeParcelas:'2',valorParcela:'500',[campo]:'-1'};
    run('modal.acoes[1].aoClicar({})');assert.equal(ctx.registros.length,0);
  });
  await test('Distrato rejeita devolução negativa', async () => {
    const {ctx,run}=ambiente();ctx.v=venda;run('abrirDistrato(v,resumoVenda(v))');ctx.campos={valorDevolvido:'-1',motivo:'Demonstração'};
    await run('TELAS.venda=()=>{}; modal.acoes[1].aoClicar({})');assert.equal(ctx.registros.length,0);
  });
  for (const campo of ['areaM2','parcFixa','parcFixaDesc','parcReaj','parcReajDesc']) await test('Cadastro do lote rejeita negativo em '+campo, () => {
    const {ctx,run}=ambiente();run('abrirCadastroLote()');
    ctx.campos={quadra:'1',lote:'2',areaM2:'1000',preco:'40000',parcFixa:'500',parcFixaDesc:'400',parcReaj:'350',parcReajDesc:'280',[campo]:'-1'};
    run('modal.acoes[1].aoClicar({})');assert.equal(ctx.registros.length,0);
  });
  console.log(`${testes-falhas}/${testes} testes passaram`);if(falhas) process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
