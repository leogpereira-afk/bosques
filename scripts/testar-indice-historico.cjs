/* Equivalência e custo com títulos/recibos fictícios, incluindo a lixeira. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const { test } = require('node:test');
const F = require('../financeiro-core.js');
function dados(qtdVendas=2,qtdParcelas=3) {
  const vendas=[],titulos=[],recebimentos=[],vinculos=new Map();
  for(let i=0;i<qtdVendas;i++) {
    const v={id:'v-ficticia-'+i,clienteId:'123',parcelas:[]}; vendas.push(v);
    for(let j=0;j<qtdParcelas;j++) {
      const tid='t-'+i+'-'+j,p={tid,valor:100,venc:'2025-12-20',liquidacao:{desconto:0,juros:0,multa:0,saldoOrigem:0}};
      v.parcelas.push(p); vinculos.set(tid,F.classificarVinculos([{venda:v,parcela:p}]));
      titulos.push({id:'CONTA_A_RECEBER-'+tid,titulo:tid,grupo:'CONTA_A_RECEBER',origem:'omie',cpf:'123',status:'RECEBIDO',valor:100,venc:p.venc,
        original:{detalhes:{dDtPagamento:'10/12/2025'},resumo:{cLiquidado:'S',nValPago:100,nValLiquido:100,nValAberto:0}}});
      if(j%10===0)recebimentos.push({id:'rbomie-'+tid,omie:{titulo:tid},origem:'omie',vendaId:v.id,valor:100,data:'2025-12-10',alocacoes:[{tid,valor:100}]});
    }
  }
  return {vendas,titulos,recebimentos,vinculos,corte:'2026-01-01',hoje:'2026-10-29'};
}
test('índice mantém cada relação, inclusive lixeira, sem duplicar o mesmo objeto',()=>{
  const x=dados(),r=x.recebimentos[0];
  r.apagadoEm='2026-01-01'; r.alocacoes.push({tid:'t-0-1',valor:10},{tid:r.omie.titulo,valor:10});
  const duplicado={...r},manual={id:'r-manual',vendaId:x.vendas[0].id,valor:30,apagadoEm:'2026-01-01'};
  x.recebimentos.push(r,duplicado,manual); x.titulos.push(x.titulos[0],{...x.titulos[0],apagadoEm:'2026-01-01'});
  const antes=JSON.stringify(x),idx=F.indiceHistoricoAntesCorte(x);
  assert.deepEqual(idx.porTitulo.get('t-0-0'),[x.titulos[0],x.titulos.at(-1)]);
  assert.deepEqual(idx.recebimentosPorTitulo.get('t-0-0'),[r,duplicado]);
  assert.deepEqual(idx.recebimentosPorTitulo.get('t-0-1'),[r,duplicado]);
  assert.deepEqual(idx.recebimentosSemAlocacaoPorVenda.get(x.vendas[0].id),[manual]);
  assert.equal(JSON.stringify(x),antes);
});
test('consulta indexada preserva a decisão por venda, com relações cruzadas e recibo sem distribuição',()=>{
  const x=dados();
  x.recebimentos.push({id:'rbomie-t-0-1',vendaId:x.vendas[0].id,valor:20,apagadoEm:'2026-01-01'});
  x.recebimentos.push({id:'r-cruzado',vendaId:x.vendas[1].id,valor:30,alocacoes:[{tid:'t-0-2',valor:10},{tid:'t-1-1',valor:20}]});
  const idx=F.indiceHistoricoAntesCorte(x),antes=JSON.stringify(x);
  for(const v of x.vendas) {
    const esperado=F.historicoAntesCorte(v,x),real=F.historicoAntesCorte(v,{...x,indice:idx});
    assert.deepEqual(real,esperado);
    assert.equal(real.pagamentos.length,v===x.vendas[0]?0:1);
    assert.equal(real.conferencias.length,v===x.vendas[0]?3:1);
  }
  assert.equal(JSON.stringify(x),antes);
});
test('recibo ligado por título e venda sem alocação não é contado duas vezes',()=>{
  const x=dados(1,1),r=x.recebimentos[0];
  delete r.omie; delete r.alocacoes;
  const idx=F.indiceHistoricoAntesCorte(x);
  assert.equal(idx.recebimentosPorTitulo.get('t-0-0')[0],r);
  assert.equal(idx.recebimentosSemAlocacaoPorVenda.get(x.vendas[0].id)[0],r);
  const real=F.historicoAntesCorte(x.vendas[0],{...x,indice:idx});
  assert.equal(real.conferencias.length,1); assert.equal(real.pagamentos.length,0);
});
test('depois de construir índice, consultas não voltam a iterar os acervos completos',()=>{
  const x=dados(),idx=F.indiceHistoricoAntesCorte(x);
  const proibido=new Proxy([], {get(){throw Error('Varredura global indevida');}});
  const resultado=F.historicoAntesCorte(x.vendas[0],{...x,titulos:proibido,recebimentos:proibido,indice:idx});
  assert.equal(resultado.pagamentos.length,2); assert.equal(resultado.conferencias.length,0);
});
test('cache do espelho reutiliza a rodada e invalida no próximo evento ou troca do acervo',async()=>{
  const x=dados(),reg={venda:x.vendas,titulo:x.titulos,rec:x.recebimentos};
  const ctx=vm.createContext({FINANCEIRO:F,TELAS:{},S:{reg}});
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../espelho.js'),'utf8'),ctx);
  const primeiro=ctx.indiceHistoricoPagamentosOmie();
  assert.equal(ctx.indiceHistoricoPagamentosOmie(),primeiro);
  reg.rec=[...reg.rec]; const segundo=ctx.indiceHistoricoPagamentosOmie(); assert.notEqual(segundo,primeiro);
  reg.titulo[0].titulo='titulo-alterado'; await Promise.resolve();
  const terceiro=ctx.indiceHistoricoPagamentosOmie(); assert.notEqual(terceiro,segundo);
  assert.equal(terceiro.porTitulo.has('titulo-alterado'),true);
  reg.rec.push({id:'rec-novo',vendaId:'v-ficticia-0',valor:10});
  assert.notEqual(ctx.indiceHistoricoPagamentosOmie(),terceiro);
});
if(process.env.BSQ_BENCH) test('benchmark: 100 vendas, 14 mil títulos e 1.400 recebimentos',()=>{
  const x=dados(100,140),inicio=performance.now();
  const semIndice=x.vendas.map(v=>F.historicoAntesCorte(v,x)),tempoSem=performance.now()-inicio;
  console.log('Histórico sem índice compartilhado: '+tempoSem.toFixed(1)+' ms');
  const inicioIndice=performance.now(),indice=F.indiceHistoricoAntesCorte(x);
  const comIndice=x.vendas.map(v=>F.historicoAntesCorte(v,{...x,indice})),tempoCom=performance.now()-inicioIndice;
  assert.deepEqual(comIndice,semIndice);
  console.log('Histórico com índice compartilhado (construção incluída): '+tempoCom.toFixed(1)+' ms; '+(tempoSem/tempoCom).toFixed(1)+'x');
});
