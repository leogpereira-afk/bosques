/* Apresentação com contratos, lotes e entradas inteiramente fictícios. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const raiz=path.resolve(__dirname,'..');
const {jsPDF}=require(path.join(raiz,'libs/jspdf.umd.min.js'));
const clone=x=>JSON.parse(JSON.stringify(x));
function dados(){
 const lotes=[{id:'lote-a-ficticio',quadra:9,lote:41,status:'Vendido',areaM2:321.5},{id:'lote-b-ficticio',quadra:9,lote:42,status:'Vendido'}];
 const principal={id:'v-principal-ficticia',codigo:'VD-PRINCIPAL-FICTICIA',clienteId:'111',clienteNome:'Pessoa fictícia',situacao:'ativa',
  loteId:lotes[0].id,quadra:9,lote:41,lotes:lotes.map(l=>({loteId:l.id,quadra:l.quadra,lote:l.lote,areaM2:l.areaM2})),loteIds:lotes.map(l=>l.id),
  entrada:50,entradaNoEspelho:true,qtdeParcelas:1,valorParcela:150,tipoParcela:'Fixa',inicioParcelas:'2026-11-01',dataVenda:'2026-10-01',
  parcelas:[{tid:'entrada-ficticia',valor:50,venc:'2026-10-01'},{tid:'parcela-ficticia',valor:150,venc:'2026-11-01'}]};
 const alias={id:'v-alias-ficticia',codigo:'VD-ALIAS-FICTICIA',clienteId:'111',clienteNome:'Pessoa fictícia',situacao:'ativa',loteId:lotes[1].id,quadra:9,lote:42,
  incorporadaEmVendaId:principal.id,entrada:50,qtdeParcelas:1,valorParcela:150,parcelas:clone(principal.parcelas)};
 return {reg:{venda:[principal,alias],lote:lotes,rec:[],titulo:[],cx:[],cliente:[{id:'111',nome:'Pessoa fictícia',cpf:'111'}],prop:[],corretor:[]},principal,alias,lotes};
}
async function ambiente(){
 const {parseHTML}=await import((process.env.BSQ_TEST_DEPS||'/tmp/bosques-test-deps')+'/node_modules/linkedom/esm/index.js');
 const {document}=parseHTML('<html><body><main id="app"></main></body></html>'),d=dados(),textos=[];
 class DataTeste extends Date{constructor(...args){super(...(args.length?args:['2026-10-29T12:00:00-03:00']));}static now(){return +new Date('2026-10-29T12:00:00-03:00');}}
 // Observa o texto sem substituir a medição, a paginação ou a geração do PDF real.
 function Documento(opts){const doc=new jsPDF(opts),original=doc.text.bind(doc);doc.text=(t,x,y,...args)=>{textos.push({texto:Array.isArray(t)?t.join(' '):String(t),x,y,pagina:doc.getNumberOfPages()});return original(t,x,y,...args);};return doc;}
 const ctx=vm.createContext({document,console,Date:DataTeste,Math,Blob,File,navigator:{},location:{hash:''},setTimeout,clearTimeout,
  window:{innerWidth:1200,addEventListener(){},jspdf:{jsPDF:Documento}},
  S:{reg:d.reg,perfil:'direcao',quem:'Pessoa fictícia',fila:[],cacheCompleto:true,cfg:{formasPg:['PIX'],reajuste:{pct:6,aCada:12}}},
  GESTAO_UI:{base:()=>({movimentos:[]})},statusOmieHome(){},finSaida:v=>String(v),finEntrada:v=>String(v),finAtraso:v=>String(v),
  lista:col=>(d.reg[col]||[]).filter(r=>!r.apagadoEm),achar:(col,id)=>(d.reg[col]||[]).find(r=>r.id===id),
  salvar(){throw Error('Teste de apresentação não autoriza gravação');},salvarGrupo(){throw Error('Teste de apresentação não autoriza gravação');},
 });
 for(const f of ['ui.js','carne.js','financeiro-core.js','financeiro-gestao.js','espelho.js','caixa.js','vendas.js','contratos.js'])vm.runInContext(fs.readFileSync(path.join(raiz,f),'utf8'),ctx,{filename:f});
 // Não inicia cache, rede ou service worker; o módulo e TELAS.home permanecem reais.
 vm.runInContext(fs.readFileSync(path.join(raiz,'app.js'),'utf8').split('(async function iniciar()')[0],ctx,{filename:'app.js'});
 return {...d,ctx,document,textos,run:s=>vm.runInContext(s,ctx)};
}
function carregarPdf(a){
 const salvos=[];a.ctx.fetch=async()=>({ok:false});a.ctx.salvarNoAparelho=(blob,nome)=>salvos.push({blob,nome});
 vm.runInContext(fs.readFileSync(path.join(raiz,'pdf.js'),'utf8'),a.ctx,{filename:'pdf.js'});return salvos;
}
test('helper apresenta ambos os lotes do mesmo contrato sem duplicar identidade',async()=>{
 const {principal,ctx,run}=await ambiente();ctx.v=principal;
 assert.deepEqual(JSON.parse(run('JSON.stringify(FINANCEIRO.lotesVenda(v).map(l=>l.loteId))')),['lote-a-ficticio','lote-b-ficticio']);
 assert.equal(run('nomeLotesVenda(v)'),'Q9 · L41 + Q9 · L42');
});
test('busca real de Vendas encontra contrato principal pelo lote secundário e exclui alias',async()=>{
 const {ctx,run,document,reg}=await ambiente(),antes=JSON.stringify(reg);run('TELAS.vendas()');
 const busca=document.getElementById('vd-q');busca.value='Q09L42';busca.oninput({target:busca});
 assert.deepEqual([...document.querySelectorAll('.lin[data-id]')].map(el=>el.dataset.id),['v-principal-ficticia']);
 assert.match(document.querySelector('.lin[data-id]').textContent,/L41/);assert.match(document.querySelector('.lin[data-id]').textContent,/L42/);
 assert.equal(JSON.stringify(reg),antes);
});
test('ficha incorporada aponta ao contrato principal e não oferece baixa independente',async()=>{
 const {ctx,run,document,reg}=await ambiente(),antes=JSON.stringify(reg);run("TELAS.venda('v-alias-ficticia')");
 assert.ok(document.querySelector('a[href="#/venda/v-principal-ficticia"]'));
 assert.match(document.getElementById('app').textContent,/incorporad|agrupad|principal/i);
 assert.equal(document.getElementById('bt-baixa'),null);assert.equal(document.getElementById('bt-editar-venda'),null);
 assert.equal(document.querySelector('table'),null);assert.equal(JSON.stringify(reg),antes);
});
test('cabeçalho da ficha principal identifica todos os lotes',async()=>{
 const {run,document}=await ambiente();run("TELAS.venda('v-principal-ficticia')");const titulo=document.querySelector('.cartao h2').textContent;
 assert.match(titulo,/L41/);assert.match(titulo,/L42/);
});
test('mover parcela oferece outra venda ativa mas nunca a ficha incorporada',async()=>{
 const {ctx,run,document,reg,principal}=await ambiente();ctx.v=principal;ctx.finCentrosDisponiveis=()=>[];
 reg.venda.push({id:'v-outra-ficticia',codigo:'VD-OUTRA-FICTICIA',clienteId:'111',situacao:'ativa',loteId:'lote-c-ficticio',quadra:9,lote:43,parcelas:[]});
 run('abrirEditarParcela(v,0)');
 assert.deepEqual([...document.querySelectorAll('[data-campo="mover"] option')].map(el=>el.value),['','v-outra-ficticia']);
});
test('entrada já espelhada não vira terceira linha nem segundo acréscimo à dívida',async()=>{
 const {ctx,run,principal,document}=await ambiente();ctx.v=principal;
 const r=run('resumoVenda(v)');assert.equal(r.total,200);assert.equal(r.saldo,200);assert.equal(r.entradaSaldo,0);
 const linhas=run('linhasRecebimentoVenda(v,resumoVenda(v))');assert.equal(linhas.length,2);assert.equal(linhas.reduce((s,p)=>s+p.valor,0),200);
 run("TELAS.venda('v-principal-ficticia')");assert.match(document.querySelector('.cartao').textContent,/entrada[\s\S]{0,90}(?:incluíd|espelh|parcela)|(?:incluíd|espelh)[\s\S]{0,90}entrada/i);
});
test('duplicidade considera lote secundário e ignora somente a ficha incorporada',async()=>{
 const {ctx,run,reg}=await ambiente();assert.equal(run('lotesDuplicados().length'),0);
 reg.venda.push({id:'v-conflito-ficticia',loteId:'lote-b-ficticio',quadra:9,lote:42,situacao:'ativa',parcelas:[]});
 const d=run('lotesDuplicados()');assert.equal(d.length,1);assert.equal(d[0][0],'lote-b-ficticio');
 assert.deepEqual(Array.from(d[0][1],v=>v.id).sort(),['v-conflito-ficticia','v-principal-ficticia']);
});
test('lista de Contratos encontra lote secundário uma vez sem contrato alias',async()=>{
 const {run,document}=await ambiente();run('TELAS.contratos()');const q=document.getElementById('ct-q');q.value='Q09L42';q.oninput({target:q});
 assert.deepEqual([...document.querySelectorAll('.ct-lin[data-id]')].map(el=>el.dataset.id),['v-principal-ficticia']);
});
test('contrato impresso identifica todas as cotas e preserva área individual desconhecida',async()=>{
 const {ctx,run,principal,lotes,textos,reg}=await ambiente(),antes=JSON.stringify(reg);ctx.v=principal;ctx.cliente=reg.cliente[0];ctx.l=lotes[0];
 run('gerarContratoPdf(v,cliente,l,{}, {entrada:0,qtdeParcelas:1,valorParcela:200,parcCheia:200,inicioParcelas:"2026-11-01"})');
 const texto=textos.map(t=>t.texto).join('\n');assert.match(texto,/9041/);assert.match(texto,/9042/);
 const linhas=new Map();for(const t of textos){const k=t.pagina+':'+t.y;linhas.set(k,[...(linhas.get(k)||[]),t.texto]);}
 assert.ok([...linhas.values()].some(l=>l.includes('9')&&l.includes('41')&&l.includes('321,5 m²')));
 assert.ok([...linhas.values()].some(l=>l.includes('9')&&l.includes('42')&&l.includes('—')),'Área do segundo lote deve permanecer desconhecida');
 assert.equal(textos.filter(t=>t.texto==='321,5 m²').length,1,'Não copiar a área do primeiro lote para o segundo');assert.equal(JSON.stringify(reg),antes);
});
test('PDF da ficha mostra todos os lotes e entrada já incluída sem acréscimo ao contrato',async()=>{
 const a=await ambiente(),salvos=carregarPdf(a);a.ctx.v=a.principal;a.run('PDF.venda(v,resumoVenda(v),[],S.cfg)');
 const texto=a.textos.map(t=>t.texto).join('\n');assert.match(texto,/L41/);assert.match(texto,/L42/);
 const plano=a.textos.find(t=>t.texto.startsWith('Plano:'));assert.ok(plano);assert.match(plano.texto,/entrada[\s\S]{0,90}(?:incluíd|espelh)|(?:incluíd|espelh)[\s\S]{0,90}entrada/i);assert.doesNotMatch(plano.texto,/de entrada\s*\+/i);
 const rot=a.textos.find(t=>t.texto==='CONTRATO');assert.ok(a.textos.some(t=>t.x===rot.x&&t.y===rot.y+7&&t.texto.replace(/\u00a0/g,' ')==='R$ 200,00'));
 assert.equal(salvos.length,1);
});
test('PDF do recibo identifica todos os lotes do contrato sem repetir o recebimento',async()=>{
 const a=await ambiente(),salvos=carregarPdf(a);a.ctx.v=a.principal;a.ctx.rc={id:'rec-ficticio',valor:30,data:'2026-10-29',tipo:'parcela',parcelaN:1};a.run('PDF.recibo(rc,v,S.cfg)');
 const descricao=a.textos.find(t=>t.texto.startsWith('Recebemos de'));assert.ok(descricao);assert.match(descricao.texto,/L(?:ote)?\s*41/);assert.match(descricao.texto,/L(?:ote)?\s*42/);
 assert.equal((descricao.texto.match(/R\$\s*30,00/g)||[]).length,1);assert.equal(salvos.length,1);
});
test('PDF da carteira mostra lote secundário em continuação sem repetir valores',async()=>{
 const a=await ambiente(),salvos=carregarPdf(a);a.ctx.v=a.principal;a.run('PDF.vendasDash([{v,r:resumoVenda(v)}],"recorte fictício",S.cfg)');
 const primario=a.textos.find(t=>/L41/.test(t.texto)),secundario=a.textos.find(t=>/L42/.test(t.texto));assert.ok(primario);assert.ok(secundario);
 assert.equal(a.textos.filter(t=>t.x===152&&t.texto.replace(/\u00a0/g,' ')==='R$ 200,00').length,2,'Uma linha do contrato e uma linha de total, sem valor extra por lote');
 if(secundario.y!==primario.y)assert.ok(a.textos.filter(t=>t.pagina===secundario.pagina&&t.y===secundario.y&&t.x>=124).every(t=>!t.texto.trim()),'Continuação do lote não pode repetir valores ou situação');
 assert.equal(salvos.length,1);
});
test('Início distingue entrada sem venda de lote ainda não confirmado',async()=>{
 const {run,document,reg}=await ambiente();reg.rec.push({id:'entrada-sem-venda-ficticia',valor:30,data:'2026-10-29',vendaId:'',classificacaoVinculo:{tipo:'sem_venda',motivo:'Teste fictício'}});
 run('TELAS.home()');const linha=document.querySelector('[data-rec="entrada-sem-venda-ficticia"]');assert.ok(linha);assert.match(linha.textContent,/sem (?:venda|vínculo com venda)/i);assert.doesNotMatch(linha.textContent,/Sem lote confirmado/i);
});
