/* Grupos fictícios: um contrato financeiro, vários lotes, nenhum acesso à rede. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const F=require('../financeiro-core.js');
function ambiente(){
  const reg={lote:[1,2,3].map(n=>({id:'l'+n,quadra:1,lote:n,status:'Vendido'})),venda:[
    {id:'principal',codigo:'VD-TESTE',situacao:'ativa',loteId:'l1',quadra:1,lote:1,lotes:[1,2,3].map(n=>({loteId:'l'+n,quadra:1,lote:n})),entrada:60,entradaNoEspelho:true,parcelas:[{tid:'entrada',valor:60,venc:'2026-01-01'},{tid:'mensal',valor:90,venc:'2026-12-01'}]},
    {id:'antiga',situacao:'ativa',loteId:'l2',incorporadaEmVendaId:'principal',parcelas:[{tid:'mensal',valor:90,venc:'2026-12-01'}]}],titulo:[],rec:[]};
  const ctx=vm.createContext({FINANCEIRO:F,S:{reg},TELAS:{},lista:col=>reg[col]||[],achar:(col,id)=>(reg[col]||[]).find(x=>x.id===id),hojeISO:()=> '2026-10-29'});
  vm.runInContext(fs.readFileSync('espelho.js','utf8'),ctx);
  return {ctx,reg};
}
test('uma venda agrupada ocupa três lotes e conta um contrato no VGV',()=>{const {ctx,reg}=ambiente(),antes=JSON.stringify(reg),r=ctx.resumoComercial();assert.equal(r.contratos.length,1);assert.equal(r.vendidos,3);assert.equal(r.vgv,150);assert.equal(r.divergencias.length,0);assert.equal(JSON.stringify(reg),antes);});
test('incorporada não torna vínculo da principal ambíguo',()=>{const {reg}=ambiente();const links=reg.venda.map(v=>({venda:v,parcela:v.parcelas.find(p=>p.tid==='mensal')}));assert.equal(F.classificarVinculos(links).situacao,'confirmado');assert.equal(F.vendaAtiva(reg.venda[1]),false);});
test('entrada presente no boleto é contada uma única vez no saldo',()=>{const {reg}=ambiente();const r=F.resumo(reg.venda[0],[{id:'r',vendaId:'principal',valor:60,data:'2026-01-01',omie:{titulo:'entrada'}}],'2026-10-29');assert.equal(r.total,150);assert.equal(r.pago,60);assert.equal(r.saldo,90);});
test('modelo antigo conserva entrada separada dos boletos',()=>{const {reg}=ambiente();delete reg.venda[0].entradaNoEspelho;const r=F.resumo(reg.venda[0],[],'2026-10-29');assert.equal(r.total,210);assert.equal(r.saldo,210);});
test('índice de títulos ignora o histórico incorporado',()=>{const {ctx}=ambiente();assert.equal(ctx.classificacoesVinculosTitulosOmie().get('mensal').situacao,'confirmado');});
test('busca financeira encontra recebimento pelo terceiro lote do contrato',()=>{const {ctx,reg}=ambiente();vm.runInContext(fs.readFileSync('financeiro.js','utf8'),ctx);const x=ctx.finEnriquecer({vendaId:'principal',descricao:'Recebimento fictício'},{porTitulo:new Map(),porCliente:new Map(),porVenda:new Map(reg.venda.map(v=>[v.id,v])),porParcela:new Map()});assert.match(x.busca,/Q1 L3/);});
