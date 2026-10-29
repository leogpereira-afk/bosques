/* Pagamentos fictícios: prova anterior ao corte só afeta o cálculo da ficha. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const F = require('../financeiro-core.js');
const raiz = path.resolve(__dirname, '..');
const copiar = x => JSON.parse(JSON.stringify(x));
function cenario() {
  const v = { id:'v-ficticia', clienteId:'123', parcelas:[{tid:'t-ficticio', valor:625, venc:'2025-12-20', conferir:false,
    liquidacao:{desconto:125, juros:0, multa:0, saldoOrigem:0}, pago:'2025-12-10', pagoValor:500, pagoOrigem:'omie'}] };
  // Formato efetivamente entregue pelo snapshot: detalhes reduzidos, resumo integral.
  const t = {id:'CONTA_A_RECEBER-t-ficticio', titulo:'t-ficticio', grupo:'CONTA_A_RECEBER', origem:'omie', cpf:'123', status:'RECEBIDO',
    valor:625, venc:'2025-12-20', original:{detalhes:{dDtPagamento:'10/12/2025'},
      resumo:{cLiquidado:'S', nValPago:625, nValLiquido:500, nDesconto:125, nJuros:0, nMulta:0, nValAberto:0}}};
  return {v, t, reg:{venda:[v], titulo:[t], rec:[], cx:[]}, corte:'2026-01-01'};
}
function ambiente(x) {
  const ctx = vm.createContext({FINANCEIRO:F, TELAS:{}, S:{reg:x.reg, cfg:{omie:{corteEntradas:x.corte}}},
    lista:(col,apagados=false)=>(x.reg[col]||[]).filter(r=>apagados||!r.apagadoEm), hojeISO:()=> '2026-10-29',
    fmt:{brl:v=>'R$ '+Number(v).toFixed(2),data:v=>v}, esc:s=>String(s??'')});
  for (const f of ['espelho.js','caixa.js','vendas.js']) vm.runInContext(fs.readFileSync(path.join(raiz,f),'utf8'),ctx,{filename:f});
  return ctx;
}
function conferir(x, motivo) {
  const antes=JSON.stringify(x), r=ambiente(x).resumoVenda(x.v);
  assert.equal(r.emAtraso,0); assert.equal(r.quitada,false);
  assert.equal(r.carne[0].situacao,'conferir'); assert.equal(r.valorPagoAntesCorte,0);
  assert.match(r.conferenciasHistoricas[0].motivo,motivo);
  assert.equal(JSON.stringify(x),antes,'Não alterar origem, contrato ou recibos');
  return r;
}
test('liquidação anterior ao corte reduz dívida da ficha sem entrada no caixa ou DRE',()=>{
  const x=cenario(), ctx=ambiente(x), antes=JSON.stringify(x), caixa=JSON.stringify(ctx.dreDados('2025-12'));
  const r=ctx.resumoVenda(x.v);
  assert.equal(r.pago,500); assert.equal(r.saldo,0); assert.equal(r.emAtraso,0); assert.equal(r.quitada,true);
  assert.equal(r.valorPagoAntesCorte,500); assert.equal(r.pagamentosAntesCorte[0].data,'2025-12-10');
  assert.equal(r.conferenciasHistoricas.length,0); assert.equal(x.reg.rec.length,0);
  assert.equal(ctx.totaisAcumulados().entradas,0); assert.equal(JSON.stringify(ctx.dreDados('2025-12')),caixa);
  assert.equal(JSON.stringify(x),antes);
  const nota=ctx.notaHistoricoPagamentoVenda(r);
  assert.match(nota,/Omie/); assert.match(nota,/500\.00/); assert.match(nota,/2026-01-01/); assert.match(nota,/caixa/i);
});
test('prova é compartilhável com filas sem estado global',()=>{
  const x=cenario(); const resultado=F.historicoAntesCorte(x.v,{titulos:x.reg.titulo,recebimentos:[],corte:x.corte,
    vinculos:new Map([['t-ficticio',F.classificarVinculos([{venda:x.v,parcela:x.v.parcelas[0]}])]])});
  assert.equal(resultado.pagamentos[0].valor,500); assert.equal(resultado.conferencias.length,0);
});
test('pago e pagoValor sozinhos não provam quitação, mas suspendem cobrança para conferência',()=>{
  const x=cenario(); x.reg.titulo=[]; const r=conferir(x,/origem/i); assert.equal(r.pago,0);
});
test('marcação antiga sem pagoOrigem também fica em conferência quando é anterior ao corte',()=>{
  const x=cenario(); x.reg.titulo=[]; delete x.v.parcelas[0].pagoOrigem;
  const r=conferir(x,/origem/i); assert.equal(r.pago,0);
});
test('pagamento parcial anterior ao corte não reaparece como dívida integral confirmada',()=>{
  const x=cenario(); x.t.status='ABERTO'; Object.assign(x.t.original.resumo,{cLiquidado:'N',nValPago:125,nValLiquido:100,nValAberto:500,nDesconto:25});
  Object.assign(x.v.parcelas[0],{pago:null,pagoValor:null,pagoOrigem:null,liquidacao:{desconto:25,juros:0,multa:0,saldoOrigem:500}});
  conferir(x,/parcial|liquidação/i);
});
for (const tipo of ['apagado','manual','sem alocação','outro contrato','mais de um']) test('recibo '+tipo+' impede somar pagamento histórico novamente',()=>{
  const x=cenario(), rec={id:'r-ficticio', vendaId:x.v.id, valor:500, data:'2025-12-10', tipo:'parcela', alocacoes:[{tid:x.t.titulo,valor:500}]};
  if(tipo==='apagado')rec.apagadoEm='2026-01-01';
  if(tipo==='sem alocação')delete rec.alocacoes;
  if(tipo==='outro contrato')rec.vendaId='v-outra';
  x.reg.rec=[rec]; if(tipo==='mais de um')x.reg.rec.push({...rec,id:'r-2'});
  const r=conferir(x,/recebimento|recibo/i); assert.equal(r.pago,tipo==='apagado'||tipo==='outro contrato'?0:tipo==='mais de um'?1000:500);
});
test('recebimento Omie já importado permanece contado uma só vez',()=>{
  const x=cenario(); x.reg.rec=[{id:'rbomie-'+x.t.titulo,origem:'omie',vendaId:x.v.id,valor:500,data:'2025-12-10',omie:{titulo:x.t.titulo}}];
  const r=ambiente(x).resumoVenda(x.v); assert.equal(r.pago,500); assert.equal(r.saldo,0);
  assert.equal(r.valorPagoAntesCorte,0); assert.equal(r.conferenciasHistoricas.length,0);
});
for (const tipo of ['CPF','duplicado','ausente','cancelado','liquidação incompleta','data inválida','corte ausente','valor local','vencimento local','valor líquido incoerente']) test('prova insuficiente: '+tipo,()=>{
  const x=cenario();
  if(tipo==='CPF')x.t.cpf='456';
  if(tipo==='duplicado')x.reg.venda.push({id:'v-outra',clienteId:'123',parcelas:[copiar(x.v.parcelas[0])]});
  if(tipo==='ausente')x.t.ausenteOrigemOmie={em:'2026-10-01'};
  if(tipo==='cancelado')x.t.cancelado=true;
  if(tipo==='liquidação incompleta')delete x.t.original.resumo.nValAberto;
  if(tipo==='data inválida')x.t.original.detalhes.dDtPagamento='31/02/2025';
  if(tipo==='corte ausente')x.corte='';
  if(tipo==='valor local')Object.assign(x.v.parcelas[0],{valor:700,trava:true,conciliacao:{politica:'local'}});
  if(tipo==='vencimento local')Object.assign(x.v.parcelas[0],{venc:'2025-12-25',trava:true,conciliacao:{politica:'local'}});
  if(tipo==='valor líquido incoerente')x.t.original.resumo.nValLiquido=501;
  conferir(x,/./);
});
test('pagamento depois do corte segue o fluxo de recebimento e títulos abertos não recebem abatimento',()=>{
  const x=cenario(); x.t.original.detalhes.dDtPagamento='10/02/2026';
  let r=ambiente(x).resumoVenda(x.v); assert.equal(r.pago,0); assert.equal(r.valorPagoAntesCorte,0); assert.equal(r.conferenciasHistoricas.length,0);
  x.t.status='ABERTO'; x.t.original.resumo={cLiquidado:'N',nValPago:0,nValAberto:625}; x.t.original.detalhes={};
  x.v.parcelas[0]={tid:x.t.titulo,valor:625,venc:'2025-12-20'};
  r=ambiente(x).resumoVenda(x.v); assert.equal(r.emAtraso,625); assert.equal(r.conferenciasHistoricas.length,0);
});
test('campos completos da origem divergentes do envelope não comprovam pagamento',()=>{
  const x=cenario(); x.t.original.detalhes.nCodTitulo='outro-titulo'; conferir(x,/origem|identidade/i);
});
test('envelope sem procedência Omie permanece em conferência',()=>{
  const x=cenario(); delete x.t.origem; conferir(x,/origem/i);
});
for(const valor of [' ',[],{},false]) test('saldo aberto não numérico não comprova liquidação: '+JSON.stringify(valor),()=>{
  const x=cenario(); x.t.original.resumo.nValAberto=valor; conferir(x,/liquidação/i);
});
test('corte futuro não faz um pagamento futuro contar como realizado',()=>{
  const x=cenario(); x.corte='2027-01-01'; x.t.original.detalhes.dDtPagamento='01/12/2026'; conferir(x,/futur|data/i);
});
test('alocação malformada de recebimento não permite novo abatimento nem derruba a ficha',()=>{
  const x=cenario(); x.reg.rec=[{id:'r-malformado',vendaId:x.v.id,valor:500,data:'2025-12-10',alocacoes:{tid:x.t.titulo,valor:500}}];
  conferir(x,/recebimento|recibo/i);
});
test('handler real da sync preserva prova antes do corte e o cálculo não inventa recibo',async()=>{
  const codigo=fs.readFileSync(path.join(raiz,'scripts/testar-omie-v2.cjs'),'utf8').split('(async()=>{movimentos[0]')[0];
  const resultado=await new Function('require','process',codigo+`return (async()=>{
    registros.clear(); registros.set('venda|v1',{id:'v1',clienteId:'123',parcelas:[{tid:1,valor:625,venc:'2025-12-20',conferir:false}]});
    movimentos=[{detalhes:{nCodTitulo:1,cGrupo:'CONTA_A_RECEBER',cStatus:'RECEBIDO',nValorTitulo:625,cCPFCNPJCliente:'123',dDtVenc:'20/12/2025',dDtPagamento:'10/12/2025'},resumo:{cLiquidado:'S',nValPago:625,nValLiquido:500,nDesconto:125,nValAberto:0}}];
    await sync(); return {registros:[...registros],cfg};})();`)(require,process);
  const regs=new Map(resultado.registros), v=regs.get('venda|v1'), t=regs.get('titulo|CONTA_A_RECEBER-1');
  assert.equal([...regs.keys()].filter(k=>k.startsWith('rec|')).length,0); assert.equal(v.parcelas[0].pagoValor,500);
  const x={v,t,reg:{venda:[v],titulo:[t],rec:[],cx:[]},corte:resultado.cfg.omie.corteEntradas};
  const antes=JSON.stringify(x), r=ambiente(x).resumoVenda(v);
  assert.equal(r.saldo,0); assert.equal(r.pago,500); assert.equal(r.emAtraso,0); assert.equal(JSON.stringify(x),antes);
});
