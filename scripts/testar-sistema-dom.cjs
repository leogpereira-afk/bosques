// Teste do DOM em memória; nenhuma interação com navegador ou servidor real.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
(async()=>{
const {parseHTML}=await import((process.env.BSQ_TEST_DEPS||'/tmp/bosques-test-deps')+'/node_modules/linkedom/esm/index.js');
const {document}=parseHTML('<html><body><nav id="menu"></nav><div id="topo"></div><div id="lateral"></div><div id="app"></div><div id="badge-sync"></div></body></html>');
const mem=new Map(),localStorage={getItem:k=>mem.get(k)||null,setItem:(k,v)=>mem.set(k,String(v)),removeItem:k=>mem.delete(k)};
const fakeWindow={addEventListener(){},matchMedia:()=>({matches:false}),FINANCEIRO_EM_VALIDACAO:true};
const ctx=vm.createContext({window:fakeWindow,document,localStorage,navigator:{onLine:false},location:{hash:'#/home'},console,URL,Blob,TextEncoder,TextDecoder,CustomEvent:document.defaultView.CustomEvent,Event:document.defaultView.Event,setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},fetch:async()=>({ok:true,json:async()=>({ok:true,sync:{status:'completa',quando:new Date().toISOString()},registros:[]})}),crypto:require('node:crypto').webcrypto,Intl});
for(const f of ['config.js','ui.js','mapa-espelho.js','store.js','carne.js','financeiro-core.js','pdf.js','espelho.js','vendas.js','caixa.js','cadastros.js','cronograma.js','omie.js','financeiro.js','contratos.js','apresentacao.js','app.js']) {
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
for(const [tela,id] of [['lote','l1'],['venda','v1'],['comissoes',''],['simulacao','']]) {vm.runInContext(`TELAS.${tela}('${id}')`,ctx);assert.ok(!/undefined|NaN/.test(document.querySelector('#app').textContent),tela);console.log('OK detalhe '+tela);}
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
// Regressões da revisão de navegação: atalhos respeitam período e registros sem lote.
vm.runInContext("TELAS.home()",ctx);
document.querySelector('[data-aba="despesas"]').onclick();
assert.equal(ctx.location.hash,'#/financeiro');assert.equal(vm.runInContext('TELAS._fin.aba',ctx),'despesas');
assert.equal(vm.runInContext('TELAS._fin.ano+\'-\'+TELAS._fin.mes',ctx),vm.runInContext('hojeISO().slice(0,7)',ctx));
vm.runInContext("S.reg.rec.push({id:'solto',data:hojeISO(),valor:120});TELAS.home()",ctx);
assert.ok(document.querySelector('[data-rec="solto"]'));document.querySelector('[data-rec="solto"]').onclick();
assert.ok(document.querySelector('.fundo-modal').textContent.includes('Recebimento solto'));
let fechados=0;document.addEventListener('ui:modais-fechados',()=>fechados++);
vm.runInContext('fecharModal()',ctx);assert.equal(fechados,1);
vm.runInContext("TELAS._fin={aba:'recebimentos',ano:'2025',mes:'02',q:'inexistente',centro:'Obra',fila:'futuros'};TELAS.financeiro()",ctx);
assert.ok(document.querySelector('.fin-filtros-ativos').textContent.includes('Centro: Obra'));
document.querySelector('#fin-limpar').onclick();assert.equal(vm.runInContext('TELAS._fin.ano',ctx),'');
assert.equal(vm.runInContext('TELAS._fin.fila',ctx),undefined);
assert.equal(vm.runInContext("correspondeBusca('João · 12345678901','Joao') && correspondeBusca('12345678901','123.456.789-01')",ctx),true);
vm.runInContext("location.hash='#/venda/v1';render()",ctx);assert.ok(document.querySelector('.voltar-tela').getAttribute('href').includes('vendas'));
assert.ok(document.querySelector('#ir-tela'));
console.log('OK atalhos mensais, recebimento sem lote, atualização após modal, filtros visíveis e limpeza, busca e retorno.');
vm.runInContext("S.cacheCompleto=false;location.hash='#/financeiro';render()",ctx);
assert.ok(document.querySelector('#app').textContent.includes('Preparando os dados'));assert.equal(document.querySelectorAll('.painel').length,0);
// O mapa fica depois das quadras; salvar sua configuração preserva os demais dados.
vm.runInContext("S.cfg.espelho={mapaUrl:'https://drive.google.com/file/d/arquivo_mapa_teste/view',exibirReservados:true};TELAS.espelho()",ctx);
assert.ok(document.querySelector('#esp-mapa img'));
assert.equal(document.querySelector('#app').lastElementChild.id,'esp-mapa');
vm.runInContext("TELAS.config();api=async(acao,body)=>{if(acao==='salvarCfg'){window.ultimaCfg=body.cfg;return {ok:true,cfg:{...S.cfg,...body.cfg}};}return {ok:true};};",ctx);
document.querySelector('[data-campo="espelho.mapaUrl"]').value='https://drive.google.com/drive/folders/pasta_mapa_teste';
await document.querySelector('#cf-espelho-salvar').onclick();
assert.match(document.querySelector('#cf-mapa-erro').textContent,/link do arquivo/);assert.equal(fakeWindow.ultimaCfg,undefined);
document.querySelector('[data-campo="espelho.mapaUrl"]').value='https://drive.google.com/file/d/arquivo_mapa_teste/view';
await document.querySelector('#cf-espelho-salvar').onclick();
assert.deepEqual(Object.keys(fakeWindow.ultimaCfg),['espelho']);assert.equal(fakeWindow.ultimaCfg.espelho.exibirReservados,true);
assert.ok(vm.runInContext("S.cfg.formasPg.includes('PIX')",ctx));
vm.runInContext("S.cacheCompleto=true;location.hash='#/acessos';api=async()=>({ok:true,acessos:[{id:'acesso',nome:'Visitante teste',telefone:'38999999999',perfil:'corretor',criadoEm:'2026-09-12T12:00:00Z',ultimoAcesso:'2026-09-12T12:00:00Z',bloqueado:false}]})",ctx);
await vm.runInContext("TELAS.acessos()",ctx);
await new Promise(setImmediate);
assert.ok(document.querySelector('#app').textContent.includes('Visitante teste'),document.querySelector('#app').textContent);
assert.ok(document.querySelector('[data-acesso="acesso"]'));
vm.runInContext("S.perfil='corretor'",ctx);await vm.runInContext("TELAS.acessos()",ctx);
await new Promise(setImmediate);
assert.ok(document.querySelector('#app').textContent.includes('reservado à direção'));
console.log('OK mapa abaixo dos lotes e configuração isolada com validação de link.');
console.log('PASSOU telas e abas; gráfico, período sem dados, mês parcial e bloqueio de indicadores com base incompleta.');
})().catch(e=>{console.error(e);process.exit(1)});
