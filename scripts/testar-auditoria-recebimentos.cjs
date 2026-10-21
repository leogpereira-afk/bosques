// Regressões com dados fictícios: carnê, rateio e origem dos detalhes dos cards.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{
let falhas=0,passaram=0;
async function teste(nome,fn){try{await fn();passaram++;console.log('OK '+nome);}catch(e){falhas++;console.error('FALHOU '+nome+': '+e.message);}}
const motor=vm.createContext({hojeISO:()=> '2026-10-21'});vm.runInContext(fs.readFileSync('carne.js','utf8')+'\nglobalThis.C=CARNE;',motor);
for(const tipo of ['entrada','parcela'])await teste('Excedente de '+tipo+' permanece como crédito sem quitar outra parcela',()=>{
 const venda={entrada:100,dataEntrada:'2026-10-01',qtdeParcelas:2,valorParcela:100};
 const rec={id:'excedente-'+tipo,tipo,valor:150,data:'2026-10-01',...(tipo==='parcela'?{parcelaN:1}:{})};
 const r=motor.C.resumo(venda,{},[rec],'2026-10-21');
 assert.equal(r.sobra,50);assert.equal(r.pago,100);assert.equal(r.saldo,200);
 assert.equal(r.carne.find(l=>l.n===2).pago,0);
});
const F=require('../financeiro-gestao.js');
for(const [valor,percentuais] of [[0.02,[25,25,25,25]],[0.02,[33,33,33]],[0.01,[50,50]],[100.01,[25,25,25,25]]])await teste('Rateio conserva '+valor+' em '+percentuais.join('/')+'%',()=>{
 const fatias=F.fatias({valor,centros:percentuais.map((percentual,i)=>({nome:'Centro '+i,percentual}))},'centros');
 assert.equal(fatias.reduce((s,f)=>s+F.cent(f.valor),0),F.cent(valor));
 assert.ok(fatias.every(f=>f.valor>=0));
});
const {parseHTML}=await import((process.env.BSQ_TEST_DEPS||'/tmp/bosques-test-deps')+'/node_modules/linkedom/esm/index.js');
const {indexedDB}=require((process.env.BSQ_TEST_DEPS||'/tmp/bosques-test-deps')+'/node_modules/fake-indexeddb');
const {document}=parseHTML('<html><body><div id="topo"></div><div id="lateral"></div><div id="app"></div><div id="badge-sync"></div></body></html>');
const mem=new Map(),localStorage={getItem:k=>mem.get(k)||null,setItem:(k,v)=>mem.set(k,String(v)),removeItem:k=>mem.delete(k)};
const window={addEventListener(){},matchMedia:()=>({matches:false}),FINANCEIRO_EM_VALIDACAO:true};
const ctx=vm.createContext({window,document,localStorage,indexedDB,navigator:{onLine:false},location:{hash:'#/vendas'},console,URL,Blob,TextEncoder,TextDecoder,CustomEvent:document.defaultView.CustomEvent,Event:document.defaultView.Event,setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},fetch:async()=>{throw Error('Teste não acessa rede');},crypto:require('node:crypto').webcrypto,Intl});
for(const f of ['config.js','ui.js','mapa-espelho.js','store.js','carne.js','financeiro-core.js','pdf.js','espelho.js','vendas.js','caixa.js','cadastros.js','cronograma.js','omie.js','financeiro.js','financeiro-gestao.js','financeiro-painel.js','contratos.js','apresentacao.js','app.js']){
 let s=fs.readFileSync(f,'utf8');if(f==='app.js')s=s.slice(0,s.indexOf('(async function iniciar()'));vm.runInContext(s,ctx,{filename:f});
}
Object.assign(ctx,window);
vm.runInContext(`S.cfg={formasPg:['PIX']};S.senhaHash='teste';S.quem='Auditoria';S.perfil='direcao';S.cacheCompleto=true;S.reg=regVazio();
 S.reg.lote=[{id:'l1',quadra:1,lote:1,status:'Vendido'}];S.reg.venda=[{id:'v1',loteId:'l1',quadra:1,lote:1,clienteNome:'Cliente fictício',situacao:'ativa',entrada:100,qtdeParcelas:0}];
 S.reg.rec=[{id:'antigo',vendaId:'v1',data:'2000-01-02',valor:100},{id:'atual',vendaId:'v1',data:hojeISO(),valor:200},{id:'solto',data:hojeISO(),valor:30}];
 S.reg.movbanco=[{id:'outro-banco',origem:'omie',data:hojeISO(),valor:900,entrada:true,financeiroOmie:{pessoaNome:'Movimento bancário de outra origem'}}];`,ctx);
for(const [card,total,ids] of [['recebido',230,['atual','solto']],['recebido-total',330,['antigo','atual','solto']]])await teste('Card '+card+' abre exatamente seus recebimentos e período',()=>{
 vm.runInContext('fecharModal();TELAS.vendas()',ctx);
 const botao=document.querySelector('[data-pv="'+card+'"]'),valorCard=botao.querySelector('.num').textContent;
 botao.onclick();
 // Também percorre o destino de uma versão regressiva que ainda navegue para outra tela.
 if(ctx.location.hash==='#/lancamentos')vm.runInContext('TELAS.lancamentos()',ctx);
 const modal=document.querySelector('.fundo-modal');assert.ok(modal,'O card deve abrir seus próprios registros');
 assert.ok(modal.textContent.includes(valorCard),'O total do detalhe deve coincidir com o card');
 const linhas=[...modal.querySelectorAll('[data-recebimento-venda]')].map(x=>x.dataset.recebimentoVenda).sort();
 assert.deepEqual(linhas,[...ids].sort());assert.ok(!modal.textContent.includes('900,00'));
 assert.ok(modal.textContent.includes(card==='recebido-total'?'Todo o histórico':vm.runInContext('nomeMes(hojeISO().slice(0,7))',ctx)));
 assert.equal(vm.runInContext('lista("rec").filter(r=>'+(card==='recebido'?'String(r.data).startsWith(hojeISO().slice(0,7))':'true')+').reduce((s,r)=>s+FINANCEIRO.cent(r.valor),0)/100',ctx),total);
});
await teste('Recebimento sem espelho edita metadados sem criar alocações incompatíveis',()=>{
 vm.runInContext("fecharModal();S.reg.rec=[{id:'legado',vendaId:'v1',data:hojeISO(),tipo:'parcela',parcelaN:1,valor:50,forma:'PIX'}];S.reg.venda[0].qtdeParcelas=2;S.reg.venda[0].valorParcela=100;TELAS.vendas()",ctx);
 document.querySelector('[data-pv="recebido-total"]').onclick();
 document.querySelector('[data-recebimento-venda="legado"]').click();
 const modal=document.querySelector('.fundo-modal');
 assert.equal(modal.querySelectorAll('[data-campo^="alloc_"]').length,0,'Carnê derivado não recebe tid de parcela espelhada');
 assert.ok(modal.querySelector('[data-campo="obs"]'),'Editor legado deve oferecer os metadados compatíveis');
 modal.querySelector('[data-campo="obs"]').value='Conferido no comprovante';
 const forma=modal.querySelector('[data-campo="forma"]');if(forma)Object.defineProperty(forma,'value',{value:'PIX',configurable:true});
 [...modal.querySelectorAll('button')].find(b=>b.textContent==='Salvar').click();
 const salvo=vm.runInContext('achar("rec","legado")',ctx);
 assert.equal(salvo.obs,'Conferido no comprovante');assert.equal(salvo.tipo,'parcela');assert.equal(salvo.parcelaN,1);assert.equal(salvo.alocacoes,undefined);
 assert.ok(document.querySelector('[data-recebimento-venda="legado"]'),'Após salvar deve retomar a lista de origem');
});
await teste('Crédito específico não é apresentado como pagamento de todo o carnê',()=>{
 vm.runInContext("fecharModal();S.reg.rec=[{id:'credito',vendaId:'v1',data:hojeISO(),tipo:'parcela',parcelaN:1,valor:150,forma:'PIX'}];TELAS.venda('v1')",ctx);
 assert.ok(document.querySelector('#app').textContent.includes('crédito ainda não destinado às parcelas'));
 assert.ok(!document.querySelector('#app').textContent.includes('ALÉM do carnê'));
});
await teste('Detalhe pagina todo o histórico sem perder total ou abrir dados bancários',()=>{
 vm.runInContext("fecharModal();S.reg.rec=Array.from({length:45},(_,i)=>({id:'pag-'+String(i).padStart(2,'0'),vendaId:'v1',data:hojeISO(),valor:1}));TELAS.vendas()",ctx);
 document.querySelector('[data-pv="recebido-total"]').onclick();
 assert.equal(document.querySelectorAll('[data-recebimento-venda]').length,40);
 assert.ok(document.querySelector('.fundo-modal').textContent.includes('45,00'));
 [...document.querySelector('.fundo-modal').querySelectorAll('button')].find(b=>b.textContent==='Próxima').click();
 assert.equal(document.querySelectorAll('[data-recebimento-venda]').length,5);
 assert.ok(document.querySelector('.fundo-modal').textContent.includes('45,00'));
 assert.ok(document.querySelector('.fundo-modal').textContent.includes('Página 2 de 2'));
 document.querySelector('[data-recebimento-venda]').click();
 assert.ok(document.querySelector('.fundo-modal').textContent.includes('Recebimento'));
 assert.ok(document.querySelector('.fundo-modal [data-campo=\"obs\"]'));
});
await teste('Rateios preservam o total em valores pequenos e percentuais parciais',()=>{
 for(let centavos=1;centavos<=200;centavos++)for(const ps of [[25,25,25,25],[33,33,33],[10,10,10,10,10,10,10,10,10,10],[0.5,99.5],[5,35]]){
  const fatias=F.fatias({valor:centavos/100,centros:ps.map((percentual,i)=>({nome:'Centro '+i,percentual}))},'centros');
  assert.equal(fatias.reduce((s,f)=>s+F.cent(f.valor),0),centavos);assert.ok(fatias.every(f=>f.valor>=0));
 }
});
if(falhas)throw Error(falhas+' regressões falharam; '+passaram+' passaram.');
console.log('PASSOU '+passaram+' regressões de recebimentos, crédito e conservação dos rateios.');
})().catch(e=>{console.error(e.message);process.exit(1)});
