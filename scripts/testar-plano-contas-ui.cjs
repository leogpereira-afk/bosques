// Somente prévia local com dados fictícios; nenhuma origem externa é permitida.
const {chromium}=require('/Users/leonardopereira/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const url=process.env.BSQ_PREVIEW_URL||'http://127.0.0.1:5582/preview-financeiro.html#/financeiro';
const destino=process.env.BSQ_PREVIEW_OUTPUT||'/tmp/bosques-plano-contas-verificacao';
const brl=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v);
const normalizar=s=>String(s).replace(/\s+/g,' ').trim();
(async()=>{
 const origem=new URL(url);assert.ok(['127.0.0.1','localhost'].includes(origem.hostname),'O teste não acessa dados reais');
 fs.mkdirSync(destino,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true}),erros=[],externas=[];
  page.setDefaultTimeout(10000);page.on('pageerror',e=>erros.push(e.message));
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(u.hostname)){externas.push(u.origin);return route.abort();}return route.continue();});
  await page.goto(url);await page.locator('.gf-nav').getByRole('button',{name:'Plano de contas',exact:true}).click();
  await page.locator('#gf-plano-contas').waitFor();
  const ano=await page.evaluate(()=>hojeISO().slice(0,4));
  await page.locator('#gf-escopo').selectOption('ano');await page.locator('#gf-ano').selectOption(ano);await page.locator('#gf-mes').selectOption('');await page.locator('#gf-conta').selectOption('501');
  await page.locator('#gf-plano-base').selectOption('realizado');
  const esperado=await page.evaluate(ano=>{
   const hoje=hojeISO();const ls=S.reg.movbanco.filter(x=>!x.apagadoEm&&!x.omitidoOmie&&x.origem==='omie'&&!x.transferencia&&x.contaOmie==='501'&&String(x.data).startsWith(ano+'-')&&x.data<=hoje&&x.valor>0&&x.financeiroOmie?.categoriaCodigo==='2.01.01');
   return {quantidade:ls.length,valor:ls.reduce((s,x)=>s+Math.round(x.valor*100),0)/100,primeira:ls.map(x=>x.data).sort()[0],ultima:ls.map(x=>x.data).sort().at(-1)};
  },ano);
  assert.ok(esperado.quantidade>0,'A prévia precisa conter os códigos fictícios do plano');
  const linha=()=>page.locator('#gf-plano-contas [data-plano-codigo="2.01.01"]');
  assert.equal(await linha().count(),1);assert.ok(normalizar(await linha().innerText()).includes(normalizar(brl(esperado.valor))),'Valor por categoria deve reconciliar com os movimentos da conta e do ano');
  await linha().locator('td button').first().click();
  let modal=page.locator('.modal').last();const texto=normalizar(await modal.innerText());
  assert.ok(texto.includes(esperado.quantidade+' lançamentos'),'O detalhe contém todos e somente os movimentos da categoria');
  assert.ok(texto.includes(normalizar(brl(esperado.valor))),'O detalhe preserva o total da categoria');
  assert.ok(!texto.includes('Caixa interno'),'O detalhe não mistura outra conta');
  assert.ok(texto.includes(ano),'O detalhe identifica o período consultado');await page.keyboard.press('Escape');
  assert.equal(await page.locator('#gf-conta').inputValue(),'501');assert.equal(await page.locator('#gf-ano').inputValue(),ano);assert.equal(await page.locator('#gf-mes').inputValue(),'');
  console.log('OK plano → categoria → lançamentos com conta e período preservados');
  await page.locator('#gf-plano-busca').fill('2.01.01');
  await page.waitForFunction(()=>[...document.querySelectorAll('#gf-plano-contas [data-plano-codigo]')].filter(x=>x.getClientRects().length).every(x=>x.dataset.planoCodigo==='2.01.01'));
  assert.equal(await linha().count(),1);assert.equal(await page.locator('#gf-plano-contas [data-plano-codigo="1.01.01"]').count(),0);
  const download=async(nome,arquivo)=>{const promessa=page.waitForEvent('download');await page.getByRole('button',{name:nome,exact:true}).click();const arq=await promessa;await arq.saveAs(destino+'/'+arquivo);assert.ok(fs.statSync(destino+'/'+arquivo).size>100);return fs.readFileSync(destino+'/'+arquivo,'utf8');};
  const csvFiltrado=await download('CSV do plano de contas','plano-filtrado.csv');assert.ok(csvFiltrado.includes('2.01.01'));assert.ok(!csvFiltrado.includes('1.01.01'));assert.ok(csvFiltrado.includes(ano));
  await page.locator('#gf-plano-busca').fill('Infraestrutura');await page.waitForFunction(()=>[...document.querySelectorAll('#gf-plano-contas [data-plano-codigo]')].filter(x=>x.getClientRects().length).every(x=>x.dataset.planoCodigo==='2.01.01'));assert.equal(await linha().count(),1);
  await page.locator('#gf-plano-busca').fill('');await page.waitForFunction(()=>document.querySelectorAll('#gf-plano-contas [data-plano-codigo]').length>1);
  await page.locator('#gf-plano-sem-movimento').check();const sem=page.locator('#gf-plano-contas [data-plano-codigo="2.04.99"]');await sem.waitFor();
  assert.ok((await sem.innerText()).includes('Formação sem movimento'));assert.ok(!/R\$\s*0,00/.test(await sem.innerText()),'Catálogo sem movimento não deve aparentar dinheiro confirmado');
  const csv=await download('CSV do plano de contas','plano-completo.csv');assert.ok(csv.includes('2.04.99'));assert.ok(csv.includes('1.01.01'));assert.ok(csv.includes('2.01.01'));
  await download('PDF dos lançamentos do plano','plano-lancamentos.pdf');
  console.log('OK pesquisa por nome e código, catálogo sem movimento e exportações do recorte');
  await page.locator('#gf-plano-sem-movimento').uncheck();
  for(const base of ['receber','pagar']){
   await page.locator('#gf-plano-base').selectOption(base);const t=await page.locator('#gf-plano-contas').innerText();assert.ok(/vencimento|em aberto|a receber|a pagar/i.test(t),'Títulos em aberto precisam ser identificados separadamente do realizado');assert.equal(await page.locator('#gf-conta').inputValue(),'501');assert.equal(await page.locator('#gf-ano').inputValue(),ano);assert.ok(!/undefined|NaN/.test(t));
   const previsto=await page.evaluate(({base,ano})=>{
    const grupo=base==='receber'?'CONTA_A_RECEBER':'CONTA_A_PAGAR',codigo=base==='receber'?'1.01.01':'2.01.01';
    const ls=S.reg.titulo.filter(x=>!x.apagadoEm&&!x.ausenteOrigemOmie&&x.status!=='CANCELADO'&&x.grupo===grupo&&Number(x.original?.resumo?.nValAberto)>0&&String(x.venc).startsWith(ano+'-')&&x.financeiroOmie?.contaCodigo==='501'&&x.financeiroOmie.categoriaCodigo===codigo);
    return {codigo,quantidade:ls.length,valor:ls.reduce((s,x)=>s+Math.round(Number(x.original.resumo.nValAberto)*100),0)/100};
   },{base,ano});
   assert.ok(previsto.quantidade>0,'A prévia precisa ter títulos abertos nesse recorte');
   const linhaAberta=page.locator('#gf-plano-contas [data-plano-codigo="'+previsto.codigo+'"]');assert.equal(await linhaAberta.count(),1,'Base em aberto usa sua própria categoria');
   assert.ok(normalizar(await linhaAberta.innerText()).includes(normalizar(brl(previsto.valor))),'O plano em aberto usa saldos dos títulos pelo vencimento, sem somar movimentos realizados');
   await linhaAberta.locator('td button').first().click();modal=page.locator('.modal').last();
   assert.ok((await modal.innerText()).includes(previsto.quantidade+' lançamentos'),'Detalhe em aberto não mistura pagamentos realizados');assert.ok(normalizar(await modal.innerText()).includes(normalizar(brl(previsto.valor))));await page.keyboard.press('Escape');
  }
  console.log('OK a receber e a pagar separados dos movimentos realizados');
  await page.locator('#gf-plano-base').selectOption('realizado');
  for(const width of [1440,1024,390,320]){
   await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Plano excedeu a largura em '+width);
   assert.ok(!/undefined|NaN/.test(await page.locator('#app').innerText()));
   if([1440,390].includes(width))await page.screenshot({path:destino+'/plano-'+width+'.png',fullPage:true});
   console.log('OK plano de contas na largura '+width);
  }
  await page.goto(url.replace('#/financeiro','#/relatorios'));
  await page.locator('summary').filter({hasText:'Plano de contas · categorias do Omie'}).click();
  await page.waitForFunction(()=>document.querySelector('#gf-plano-contas')?.closest('details')?.open);
  const aberto=async acao=>{assert.ok(await page.locator('#gf-plano-contas').evaluate(e=>e.closest('details').open),'Relatórios deve manter o Plano de contas aberto após '+acao);assert.ok(await page.locator('#gf-plano-contas').isVisible(),'O conteúdo do plano permanece visível após '+acao);};
  await page.locator('#gf-plano-base').selectOption('receber');await aberto('mudar a base');
  await page.locator('#gf-plano-busca').fill('1.01.01');await page.waitForFunction(()=>document.querySelector('#gf-plano-contas [data-plano-codigo="1.01.01"]')&&[...document.querySelectorAll('#gf-plano-contas [data-plano-codigo]')].every(x=>x.dataset.planoCodigo==='1.01.01'));await aberto('buscar uma categoria');
  await page.locator('#gf-plano-sem-movimento').check();await aberto('incluir categorias sem movimento');
  console.log('OK plano em Relatórios permanece aberto após base, busca e catálogo');
  assert.deepEqual(erros,[],'Nenhum erro JavaScript');assert.deepEqual(externas,[],'Nenhuma requisição externa');
  console.log('PASSOU Plano de contas: filtros, detalhe, busca, bases, catálogo, exportações e mobile. Arquivos: '+destino);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
