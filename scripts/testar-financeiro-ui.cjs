const {chromium}=require('/Users/leonardopereira/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
(async()=>{
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
const erros=[];page.on('pageerror',e=>erros.push(e.message));
await page.route('**/*',r=>r.fulfill({status:404,body:''}));
await page.setContent('<html><body><div id="app"></div></body></html>');await page.addStyleTag({path:path.resolve('styles.css')});await page.addStyleTag({path:path.resolve('design.css')});
for(const f of ['libs/jspdf.umd.min.js','ui.js','store.js','carne.js','financeiro-core.js','pdf.js','espelho.js','vendas.js','caixa.js','cadastros.js','cronograma.js','omie.js','financeiro.js'])await page.addScriptTag({path:path.resolve(f)});
await page.evaluate(()=>{window.API_OMIE='https://teste.invalid';S.cfg={formasPg:['PIX','Dinheiro','Boleto'],centrosCusto:['Portaria']};S.reg.venda=[{id:'v1',codigo:'VD-TESTE',clienteId:'cliente-teste',clienteNome:'Cliente de demonstração',quadra:1,lote:2,entrada:0,parcelas:[{tid:'p1',venc:'2026-10-20',valor:625,valorDia:500,descontoConfirmado:true}]}];S.reg.rec=[{id:'r1',codigo:'RB-TESTE',vendaId:'v1',valor:200,data:'2026-09-05',forma:'PIX',alocacoes:[{tid:'p1',valor:200}]}];S.reg.conta=[{id:'c1',nome:'Conta de demonstração',saldoInicial:0,dataInicial:'2026-01-01'}];S.reg.cx=[];S.reg.corretor=[];S.reg.etapa=[];window.api=async()=>({ok:true,sync:{status:'completa',quando:new Date().toISOString()}});window.salvarNoAparelho=(blob)=>{window.pdfGerado=blob.size;};});
for(const aba of ['visao','recebimentos','despesas','receber','pagar','diferencas','centros','contas','pendencias']){
 await page.evaluate(a=>{TELAS._fin={aba:a,ano:'',mes:'',q:''};TELAS.financeiro();},aba);
 assert.ok((await page.locator('#app').innerText()).length>150);assert.equal(await page.locator('#app').innerText().then(t=>/undefined|NaN/.test(t)),false);console.log('OK aba '+aba);
}
await page.evaluate(()=>{TELAS._fin={aba:'recebimentos',ano:'',mes:'',q:''};TELAS.financeiro();});
await page.locator('#fin-busca').fill('demonstração');assert.equal(await page.locator('[data-fin-row]').count(),1);await page.locator('#fin-pdf').click();assert.ok(await page.evaluate(()=>window.pdfGerado>1000));console.log('OK busca e PDF do recorte');
await page.locator('[data-fin-row]').click();assert.ok(await page.getByText('Distribua o valor recebido nas parcelas abaixo.').count());console.log('OK edição com parcelas por nome');
await page.evaluate(()=>fecharModal());await page.screenshot({path:'seed/financeiro-preview.png',fullPage:true});
await page.evaluate(()=>{
 S.reg.cx=[{id:'com1',tipo:'saida',categoria:'Comissão',descricao:'Comissão a vincular',valor:250,data:'2026-09-01'},{id:'obra1',tipo:'saida',categoria:'Obra / infraestrutura',descricao:'Obra a vincular',valor:800,data:'2026-09-02'}];
 TELAS._fin={aba:'pendencias',grupo:'corretores',ano:'',mes:'',q:''};TELAS.financeiro();
});
assert.equal(await page.locator('[data-fin-row]').count(),1);
assert.equal(await page.locator('[data-fin-row] td').first().innerText(),'1');
await page.locator('[data-fin-row]').click();assert.ok(await page.getByText('Associar comissão',{exact:true}).count());await page.evaluate(()=>fecharModal());
await page.evaluate(()=>{S.reg.cx[0].corretorId='cor1';TELAS.financeiro();});
assert.equal(await page.locator('[data-fin-row]').count(),0);console.log('OK pendência numerada abre vínculo e desaparece após resolução');
const hashAntes=await page.evaluate(()=>location.hash);
await page.evaluate(()=>{delete S.reg.cx[0].corretorId;finAbrirPendenciasGrupo('corretores');});
assert.equal(await page.locator('[data-fila-item]').count(),1);await page.locator('[data-fila-item]').click();assert.ok(await page.getByText('Associar comissão',{exact:true}).count());assert.equal(await page.evaluate(()=>location.hash),hashAntes);await page.evaluate(()=>fecharModal());console.log('OK edição da fila permanece na mesma tela');
await page.evaluate(()=>{S.reg.rec[0].valor=9876543210.99;});
for(const width of [1440,1024,390,320]){
 await page.setViewportSize({width,height:900});
 for(const aba of ['visao','recebimentos','despesas','receber','pagar','diferencas','centros','pendencias']){
  await page.evaluate(a=>{TELAS._fin={aba:a,ano:'',mes:'',q:''};TELAS.financeiro();},aba);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Overflow '+aba+' '+width);
 }
 console.log('OK largura '+width);
}
assert.deepEqual(erros,[]);await browser.close();console.log('PASSOU UI sem erros JavaScript');
})().catch(e=>{console.error(e);process.exit(1)});
