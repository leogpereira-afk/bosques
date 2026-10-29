/* Classificação de vínculo com dados fictícios: dinheiro permanece no caixa. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test'),F=require('../financeiro-core.js'),G=require('../financeiro-gestao.js');
const raiz=path.resolve(__dirname,'..');
const decisao=tipo=>({tipo,motivo:'Boleto fictício de teste',em:'2026-10-29T12:00:00.000Z',por:'Pessoa de teste',operacao:'operacao-ficticia'});
function ambiente(){
  const t={id:'CONTA_A_RECEBER-t1',titulo:'t1',grupo:'CONTA_A_RECEBER',valor:100,venc:'2026-10-01',status:'RECEBIDO',classificacaoVinculo:decisao('sem_venda'),original:{resumo:{nValAberto:0,nValLiquido:100},detalhes:{dDtPagamento:'01/10/2026'}}};
  const reg={titulo:[t],venda:[],cliente:[],rec:[{id:'rbomie-t1',valor:100,data:'2026-10-01',vendaId:'',forma:'Boleto',contaId:'conta-ficticia',omie:{titulo:'t1'}},
    {id:'manual-sem-venda',valor:50,data:'2026-10-02',forma:'PIX',contaId:'conta-ficticia',classificacaoVinculo:decisao('sem_venda')},
    {id:'venda-pendente',valor:200,data:'2026-10-03',forma:'Boleto',contaId:'conta-ficticia'}],
    cx:[{id:'outra-receita',tipo:'entrada',valor:10,data:'2026-10-04',categoria:'Taxa fictícia'}]};
  const c=vm.createContext({TELAS:{},window:{},S:{reg,cfg:{}},FINANCEIRO:F,FIN_GESTAO:G,lista:k=>(reg[k]||[]).filter(x=>!x.apagadoEm),achar:(k,id)=>(reg[k]||[]).find(x=>x.id===id),hojeISO:()=> '2026-10-29'});
  for(const f of ['espelho.js','caixa.js','vendas.js','financeiro.js','conciliacao.js'])vm.runInContext(fs.readFileSync(path.join(raiz,f),'utf8'),c,{filename:f});
  return {reg,c,t};
}
test('helper reconhece somente decisão explícita e respeita o título canônico',()=>{
  assert.equal(typeof F.entradaSemVenda,'function');
  const {reg,t}=ambiente(),r=reg.rec[0],antes=JSON.stringify(reg);
  assert.equal(F.entradaSemVenda(r,reg.titulo),true);assert.equal(F.entradaSemVenda(t),true);
  assert.equal(F.entradaSemVenda(reg.rec[1],[]),true);assert.equal(F.entradaSemVenda(reg.rec[2],[]),false);
  assert.equal(F.entradaSemVenda({vendaId:'',obs:'boleto de teste',conferir:false}),false);
  assert.equal(F.entradaSemVenda(r,new Map([['CONTA_A_RECEBER|t1',t]])),true);
  assert.equal(JSON.stringify(reg),antes);
  r.classificacaoVinculo=decisao('sem_venda');t.classificacaoVinculo=decisao('pendente');
  assert.equal(F.entradaSemVenda(r,reg.titulo),false,'Reabertura canônica prevalece sobre cópia anterior');
});
test('classificação mantém caixa e não presume receita na DRE nem recebimento de venda',()=>{
  const {reg,c}=ambiente(),antes=JSON.stringify(reg),r=c.dreDados('2026-10');
  assert.equal(c.totaisAcumulados().entradas,360);assert.equal(c.totaisDoMes('2026-10').entradas,360);
  assert.equal(r.mes.recVendas,200);assert.equal(r.mes.entradasSemVenda,150);assert.equal(r.mes.receita,210);
  assert.equal(r.total.entradasSemVenda,150);assert.equal(r.mes.receita+r.mes.entradasSemVenda,360);
  assert.deepEqual(Array.from(c.recebimentosVendas(),r=>r.id),['venda-pendente']);
  assert.equal(c.movimentosDoMes('2026-10').find(r=>r.id==='rbomie-t1').categoria,'Entrada sem venda');
  assert.equal(JSON.stringify(reg),antes);
});
test('as duas filas retiram somente pendências de vínculo confirmadas sem venda',()=>{
  const {c,reg}=ambiente(),filas=c.window.BSQ_CONCILIACAO.montarFilas(reg,{});
  assert.deepEqual(Array.from(filas.recebimentos,i=>i.rec.id),['venda-pendente']);assert.equal(filas.parcelas.length,0);
  assert.equal(c.finPendencias().filter(i=>i.tipoConferencia==='vinculos').length,1);
  const r=c.finLinhas('recebimentos').find(r=>r.id==='rbomie-t1');assert.equal(r.pendente,false);assert.match(r.situacao,/sem venda/i);
  assert.equal(c.problemasDoLancamento({...reg.rec[1],col:'rec',entrada:true}).includes('recebimento sem venda'),false);
  assert.equal(c.finDiferencas().filter(x=>x.titulo?.titulo==='t1').length,0);
});
test('conta e forma faltantes continuam visíveis após classificar sem venda',()=>{
  const {reg,c}=ambiente();delete reg.rec[0].contaId;delete reg.rec[0].forma;
  const linha=c.finPendencias().find(i=>i.rec?.id==='rbomie-t1');
  assert.ok(linha);assert.equal(linha.tipoConferencia,'cadastros');assert.match(linha.situacao,/conta.*forma|conta.*Forma/);
  assert.doesNotMatch(linha.situacao,/lote|contrato/i);
});
test('reabrir conferência recupera as filas sem modificar caixa nem criar lançamento',()=>{
  const {reg,c,t}=ambiente();t.classificacaoVinculo=decisao('pendente');
  assert.equal(c.window.BSQ_CONCILIACAO.montarFilas(reg,{}).recebimentos.length,2);
  assert.equal(c.window.BSQ_CONCILIACAO.montarFilas(reg,{}).parcelas.length,1);
  assert.equal(c.totaisAcumulados().entradas,360);assert.equal(reg.rec.length,3);assert.equal(reg.cx.length,1);
  assert.equal(c.dreDados('2026-10').mes.recVendas,300);
});
