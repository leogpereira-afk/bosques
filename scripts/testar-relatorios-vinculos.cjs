// Regressões com registros fictícios; nenhuma rede ou gravação financeira.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const F=require('../financeiro-core.js'),G=require('../financeiro-gestao.js');
function ambiente(){
  const reg={venda:[{id:'v1',codigo:'VD-TESTE',clienteNome:'Cliente fictício',quadra:1,lote:1,situacao:'ativa',entrada:0,parcelas:[{tid:'t1',valor:100,venc:'2026-10-01'}]}],titulo:[{id:'t1',titulo:'t1',grupo:'CONTA_A_RECEBER',valor:100,venc:'2026-10-01',financeiroOmie:{contaCodigo:'c1'},original:{resumo:{nValAberto:100,nValLiquido:0}}}],rec:[],cx:[],cliente:[]};
  const c=vm.createContext({TELAS:{},S:{reg,cfg:{}},FINANCEIRO:F,FIN_GESTAO:G,lista:k=>reg[k]||[],resumoVenda:v=>F.resumo(v,reg.rec,'2026-10-29'),cxVivos:()=>[],hojeISO:()=> '2026-10-29',finMotivoPagamento:()=> 'Sem contrato',correspondeBusca:(a,b)=>String(a).toLowerCase().includes(String(b).toLowerCase())});
  for(const f of ['espelho.js','financeiro.js'])vm.runInContext(fs.readFileSync(f,'utf8'),c,{filename:f});
  return {reg,c};
}
test('identidade confirmada com valores pendentes tem a mesma classificação nos relatórios',()=>{
  const {reg,c}=ambiente();Object.assign(reg.venda[0].parcelas[0],{conferir:true,vinculoConfirmado:true});
  const pend=c.finPendencias().filter(x=>x.titulo);assert.equal(pend.length,1);assert.match(pend[0].situacao,/valor.*vencimento/i);assert.doesNotMatch(pend[0].situacao,/Sem lote/i);
  const linha=c.finLinhas('receber')[0];assert.match(linha.situacao,/Lote confirmado/);assert.match(linha.situacao,/valores a conferir/i);assert.equal(linha.pendente,true);
});
test('duas ocorrências não escolhem silenciosamente o primeiro contrato',()=>{
  const {reg,c}=ambiente();reg.venda.push({...structuredClone(reg.venda[0]),id:'v2',lote:2});
  assert.match(c.finPendencias().find(x=>x.titulo).situacao,/mais de uma parcela/i);
  const linha=c.finLinhas('receber')[0];assert.equal(linha.vendaId,undefined);assert.equal(linha.pendente,true);assert.match(linha.situacao,/múltipl/i);
});
test('duas ocorrências na mesma ficha também permanecem em conferência',()=>{
  const {reg,c}=ambiente();reg.venda[0].parcelas.push({...reg.venda[0].parcelas[0]});
  assert.equal(c.finLinhas('receber')[0].vendaId,undefined);assert.equal(c.finPendencias().filter(x=>x.titulo).length,1);
});
test('título ausente da origem não reaparece como pendência de vínculo',()=>{
  const {reg,c}=ambiente();reg.titulo[0].ausenteOrigemOmie={evidencia:'consulta fictícia'};reg.venda=[];
  assert.equal(c.finPendencias().filter(x=>x.titulo).length,0);assert.equal(c.finLinhas('receber').length,0);assert.equal(reg.titulo.length,1);
});
test('parcela pendente com origem ausente continua visível para conferência da origem',()=>{
  const {reg,c}=ambiente();reg.titulo[0].ausenteOrigemOmie={evidencia:'consulta fictícia'};reg.venda[0].parcelas[0].conferir=true;
  const linhas=c.finPendencias();assert.equal(linhas.filter(x=>x.tipoConferencia==='origem').length,1);assert.equal(linhas.filter(x=>x.titulo).length,0);
});
test('recebimento de contrato distratado continua visível na conferência',()=>{
  const {reg,c}=ambiente();reg.venda[0].situacao='distratada';reg.rec.push({id:'r1',vendaId:'v1',forma:'PIX',contaId:'c1',valor:100,data:'2026-10-01'});
  assert.match(c.finPendencias().find(x=>x.rec)?.situacao||'',/Contrato indisponível/);
});
test('diferença local já conferida só retorna quando a origem muda',()=>{
  const {reg,c}=ambiente();Object.assign(reg.venda[0].parcelas[0],{valor:90,trava:true,conciliacao:{politica:'local',valorOrigem:100,vencOrigem:'2026-10-01',valorLocalAntes:90,vencLocalAntes:'2026-10-01'}});
  assert.equal(c.finDiferencas().filter(x=>x.id.startsWith('ajuste-')).length,0);
  reg.titulo[0].valor=110;assert.equal(c.finDiferencas().filter(x=>x.id.startsWith('ajuste-')).length,1);
});
test('cada motivo recebe categoria própria sem chamar desconto de falta de lote',()=>{
  const {reg,c}=ambiente();Object.assign(reg.venda[0].parcelas[0],{conferir:true,vinculoConfirmado:true,valorDia:80});
  const linhas=c.finPendencias();assert.ok(linhas.some(x=>x.tipoConferencia==='descontos'&&/desconto/.test(x.situacao)));assert.ok(linhas.some(x=>x.tipoConferencia==='valores'));
});
test('recorte das conferências respeita período, conta, busca e mantém opção de histórico completo',()=>{
  const {c}=ambiente();assert.equal(typeof c.finRecorteConferencias,'function');
  const ls=[{id:'a',data:'2026-10-01',conta:'c1',busca:'Cliente alfa'},{id:'b',data:'2026-09-01',conta:'c1',busca:'Cliente alfa'},{id:'c',data:'2026-10-01',conta:'c2',busca:'Cliente alfa'},{id:'d',data:'',conta:'c1',busca:'Cliente alfa'}];
  assert.deepEqual(Array.from(c.finRecorteConferencias(ls,{escopo:'ano',ano:'2026',mes:'10',conta:'c1'},'2026-10-29'),x=>x.id),['a']);
  assert.equal(c.finRecorteConferencias(ls,{escopo:'todos',q:'inexistente'},'2026-10-29').length,0);
  assert.equal(c.finRecorteConferencias(ls,{escopo:'todos'},'2026-10-29').length,4);
});
test('modal explica a composição e aplica filtros próprios, com retorno ao histórico',async()=>{
  const {parseHTML}=require(require.resolve('linkedom',{paths:[process.env.BSQ_TEST_DEPS||process.cwd()]}));
  const {document}=parseHTML('<html><body><main id="app"></main></body></html>');const {reg,c}=ambiente();
  Object.assign(reg.venda[0].parcelas[0],{conferir:true,vinculoConfirmado:true,valorDia:80});
  Object.assign(c,{document,window:{},CustomEvent:document.defaultView.CustomEvent,S:{reg,cfg:{}},setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync('ui.js','utf8'),c);vm.runInContext(fs.readFileSync('financeiro-painel.js','utf8'),c);
  assert.equal(vm.runInContext('typeof GESTAO_UI.abrirConferencia',c),'function');
  vm.runInContext("TELAS._conciliacao={de:'2026-10-01',ate:'2026-10-31',conta:'c1'};GESTAO_UI.abrirConferencia('pendencias')",c);
  let modal=document.querySelector('.fundo-modal');assert.match(modal.textContent,/2 verificações/);assert.match(modal.textContent,/Descontos contratuais: 1/);assert.match(modal.textContent,/Valores e vencimentos: 1/);
  assert.equal(modal.querySelector('#gf-conf-de').value,'2026-10-01');
  modal.querySelector('#gf-conf-de').value='2026-11-01';modal.querySelector('#gf-conf-ate').value='2026-11-30';
  Object.defineProperty(modal.querySelector('#gf-conf-conta'),'value',{value:'c1'});Object.defineProperty(modal.querySelector('#gf-conf-tipo'),'value',{value:''});
  [...modal.querySelectorAll('button')].find(b=>b.textContent==='Aplicar filtros').click();modal=document.querySelector('.fundo-modal');assert.match(modal.textContent,/0 verificações/);
  [...modal.querySelectorAll('button')].find(b=>b.textContent==='Todo o histórico').click();modal=document.querySelector('.fundo-modal');assert.match(modal.textContent,/2 verificações/);assert.equal(modal.querySelector('#gf-conf-de').value,'');
});
test('carteira exclui cancelamento explícito mesmo sem texto de status',()=>{
  const {reg}=ambiente();reg.titulo[0].cancelado=true;assert.equal(G.montar(reg,'2026-10-29').abertos.length,0);
});
test('filtro de conta reúne identificador local e código Omie do mesmo banco',()=>{
  const {reg,c}=ambiente();reg.conta=[{id:'conta-local',omieId:'123',nome:'Banco fictício'}];reg.titulo[0].financeiroOmie.contaCodigo='123';
  reg.rec=[{id:'r1',contaId:'conta-local',omie:{titulo:'t1'},valor:100,data:'2026-10-01'}];
  const ctx=c.finIndices(),linhas=[{rec:reg.rec[0]},{titulo:reg.titulo[0]}].map(x=>c.finEnriquecer(x,ctx));
  assert.equal(c.finRecorteConferencias(linhas,{escopo:'todos',conta:'123'}).length,2);
});
test('busca de conferência encontra o lote de todos os vínculos do título',()=>{
  const {reg,c}=ambiente();reg.venda.push({...structuredClone(reg.venda[0]),id:'v2',lote:2});
  const ctx=c.finIndices(),linhas=c.finPendencias(ctx).map(x=>c.finEnriquecer(x,ctx));
  assert.equal(c.finRecorteConferencias(linhas,{escopo:'todos',q:'Q1 L2'}).filter(x=>x.titulo).length,1);
});
test('diferenças preservam origem ausente sem comparar saldo antigo nem oferecer associação',()=>{
  const {reg,c}=ambiente();reg.titulo[0].ausenteOrigemOmie={evidencia:'consulta fictícia'};reg.titulo[0].original.resumo.nValLiquido=50;
  const linhas=c.finDiferencas();assert.equal(linhas.length,1);assert.equal(linhas[0].valor,0);assert.equal(linhas[0].tipoConferencia,'origem');assert.match(linhas[0].situacao,/indisponível/i);
  let modal;Object.assign(c,{esc:String,fmt:{brl:String},abrirModal:x=>{modal=x;},fecharModal(){},document:{querySelectorAll:()=>[]}});
  c.finDetalheDiferenca(linhas[0]);assert.deepEqual(Array.from(modal.acoes,x=>x.texto),['Fechar']);
  let aviso;Object.assign(c,{achar:()=>reg.titulo[0],toast:t=>{aviso=t;}});modal=null;c.finVincularTitulo({titulo:'t1'});assert.equal(modal,null);assert.match(aviso,/indisponível/i);
});
function historicoFicticio(reg,c){
  reg.venda[0].clienteId='111';Object.assign(reg.venda[0].parcelas[0],{venc:'2025-12-01',liquidacao:{desconto:0,juros:0,multa:0}});
  Object.assign(reg.titulo[0],{origem:'omie',cpf:'111',venc:'2025-12-01',status:'RECEBIDO',original:{resumo:{nValPago:100,nValLiquido:100,nValAberto:0,cLiquidado:'S',nDesconto:0,nJuros:0,nMulta:0},detalhes:{dDtPagamento:'10/12/2025'}}});
  c.S={reg,cfg:{omie:{corteEntradas:'2026-01-01'}}};
}
test('baixa histórica comprovada não é falsa diferença de caixa pela ausência de recibo importado',()=>{
  const {reg,c}=ambiente();historicoFicticio(reg,c);
  assert.equal(c.finDiferencas().length,0);assert.equal(reg.rec.length,0);
});
test('pagamento anterior ao corte com manual não identificado aparece como conferência histórica',()=>{
  const {reg,c}=ambiente();historicoFicticio(reg,c);reg.rec.push({id:'manual-ficticio',vendaId:'v1',valor:100,data:'2025-12-10',forma:'PIX',contaId:'c1'});
  const linha=c.finPendencias().find(x=>x.tipoConferencia==='historico');assert.ok(linha);assert.equal(linha.vendaId,'v1');assert.match(linha.situacao,/histórico|corte/i);
});
test('origem explicitamente indisponível permanece na fila mesmo sem conferir persistido',()=>{
  for(const flag of [{ausenteOrigemOmie:true},{cancelado:true},{apagadoEm:'2026-10-28'}]){
    const {reg,c}=ambiente();Object.assign(reg.titulo[0],flag);
    assert.ok(c.finPendencias().some(x=>x.tipoConferencia==='origem'&&x.vendaId==='v1'));
  }
});
