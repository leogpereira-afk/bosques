// Teste do DOM em memória; nenhuma interação com navegador ou servidor real.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
(async()=>{
const {parseHTML}=await import((process.env.BSQ_TEST_DEPS||'/tmp/bosques-test-deps')+'/node_modules/linkedom/esm/index.js');
const {document}=parseHTML('<html><body><nav id="menu"></nav><div id="topo"></div><div id="lateral"></div><div id="app"></div><div id="badge-sync"></div></body></html>');
const mem=new Map(),localStorage={getItem:k=>mem.get(k)||null,setItem:(k,v)=>mem.set(k,String(v)),removeItem:k=>mem.delete(k)};
const fakeWindow={addEventListener(){},matchMedia:()=>({matches:false}),FINANCEIRO_EM_VALIDACAO:true};
const ctx=vm.createContext({window:fakeWindow,document,localStorage,navigator:{onLine:false},location:{hash:'#/home'},console,URL,Blob,TextEncoder,TextDecoder,CustomEvent:document.defaultView.CustomEvent,Event:document.defaultView.Event,setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},fetch:async()=>({ok:true,json:async()=>({ok:true,sync:{status:'completa',quando:new Date().toISOString()},registros:[]})}),crypto:require('node:crypto').webcrypto,Intl});
for(const f of ['config.js','ui.js','store.js','carne.js','financeiro-core.js','pdf.js','espelho.js','vendas.js','caixa.js','cadastros.js','cronograma.js','omie.js','financeiro.js','contratos.js','apresentacao.js','app.js']) {
 let s=fs.readFileSync(f,'utf8');if(f==='app.js')s=s.slice(0,s.indexOf('(async function iniciar()'));vm.runInContext(s,ctx,{filename:f});
}
const snap=process.env.BSQ_TEST_SNAPSHOT?JSON.parse(fs.readFileSync(process.env.BSQ_TEST_SNAPSHOT,'utf8')):{cfg:{formasPg:['PIX'],centrosCusto:[],categoriasDespesa:['Obra'],categoriasReceita:[]},registros:[
 {_col:'lote',id:'l1',quadra:1,lote:1,status:'Vendido',area:250},
 {_col:'cliente',id:'c1',nome:'Cliente teste'},
 {_col:'venda',id:'v1',codigo:'VD-TESTE',loteId:'l1',quadra:1,lote:1,clienteId:'c1',clienteNome:'Cliente teste',situacao:'ativa',parcelas:[{tid:1,venc:'2026-08-20',valor:100,origem:'omie'}]},
 {_col:'titulo',id:'t1',titulo:1,grupo:'CONTA_A_RECEBER',valor:100,venc:'2026-08-20',original:{resumo:{nValAberto:100}}},
 {_col:'rec',id:'r1',vendaId:'v1',data:'2026-09-01',valor:50,forma:'PIX'},
 {_col:'cx',id:'cx1',data:'2026-08-01',valor:20,tipo:'saida',categoria:'Obra'}]};
Object.assign(ctx,fakeWindow);ctx.snapshot=snap;
vm.runInContext(`S.cfg=snapshot.cfg;S.senhaHash='teste';S.quem='Auditoria';S.perfil='direcao';S.cacheCompleto=true;S.reg=regVazio();for(const r of snapshot.registros||[])if(S.reg[r._col])S.reg[r._col].push(r);api=async()=>({ok:true,sync:{status:'completa',quando:new Date().toISOString(),contagens:{}},automacao:{ativa:true,intervaloMinutos:15}});`,ctx);
for(const tela of ['home','espelho','vendas','simulador','contratos','propostas','financeiro','cronograma','clientes','corretores','apresentacao','config','caixa','lancamentos','relatorios']) {
 vm.runInContext(`TELAS.${tela}()`,ctx);
 const text=document.querySelector('#app').textContent;assert.ok(text.length>50,tela+' vazia');assert.ok(!/undefined|NaN/.test(text),tela+' inválida');console.log('OK tela '+tela);
}
for(const aba of ['visao','recebimentos','despesas','receber','pagar','diferencas','centros','contas','pendencias']){
 vm.runInContext(`TELAS._fin={aba:'${aba}',ano:'',mes:'',q:''};TELAS.financeiro()`,ctx);
 assert.ok(!/undefined|NaN/.test(document.querySelector('#app').textContent),aba);console.log('OK financeiro '+aba);
}
vm.runInContext("TELAS._relMes='2025-01';TELAS.relatorios()",ctx);
assert.ok(document.querySelector('#app').textContent.includes('Nenhum lançamento importado para 2025'));
vm.runInContext("TELAS._relMes=hojeISO().slice(0,7);TELAS.relatorios()",ctx);
assert.equal(document.querySelectorAll('.rel-grafico-mes').length,12);
assert.ok(document.querySelector('#app').textContent.includes('Previsão parcial'));
assert.ok(document.querySelector('#app').textContent.includes('Parcial até'));
vm.runInContext("S.cacheCompleto=false;location.hash='#/financeiro';render()",ctx);
assert.ok(document.querySelector('#app').textContent.includes('Preparando os dados'));assert.equal(document.querySelectorAll('.painel').length,0);
console.log('PASSOU telas e abas; gráfico, período sem dados, mês parcial e bloqueio de indicadores com base incompleta.');
})().catch(e=>{console.error(e);process.exit(1)});
