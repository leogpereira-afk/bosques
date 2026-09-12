// jsPDF real: mapa em página própria, tamanho, filtros e falhas de download.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const {jsPDF}=require('../libs/jspdf.umd.min.js');
const mapaUrl='https://drive.google.com/file/d/arquivo_mapa_teste/view';
let imagem=fs.readFileSync(process.env.BSQ_MAPA_TESTE||'icons/logo-pdf.png'),falha=false,salvos=[],doc,imagens=[],pedidos=[];
function Documento(opts){doc=new jsPDF(opts);imagens=[];const add=doc.addImage.bind(doc);doc.addImage=(...args)=>{imagens.push({pagina:doc.getNumberOfPages(),args});return add(...args);};return doc;}
const ctx=vm.createContext({window:{jspdf:{jsPDF:Documento}},URL,Uint8Array,AbortController,setTimeout,clearTimeout,S:{quem:'Verificação'},salvarNoAparelho:(blob,nome)=>salvos.push({blob,nome}),fetch:async(url,opts)=>{
 if(url==='icons/logo-pdf.png')return {ok:false};pedidos.push({url,opts});return {ok:!falha,arrayBuffer:async()=>imagem.buffer.slice(imagem.byteOffset,imagem.byteOffset+imagem.byteLength)};
}});
for(const f of ['mapa-espelho.js','pdf.js'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
const ls=[{quadra:1,lote:2,status:'Disponível',preco:40000,areaM2:1000},{quadra:1,lote:3,status:'Reservado',preco:null,areaM2:1000}];
Object.assign(ctx,{ls,cfg:{empresa:{nome:'Portal dos Bosques'},espelho:{mapaUrl}}});
(async()=>{
 const resultado=await vm.runInContext("PDF.espelho(ls,null,cfg,'Quadra 1')",ctx);
 assert.equal(resultado.comMapa,true);assert.equal(salvos.length,1);assert.equal(doc.getNumberOfPages(),2);
 const w=doc.internal.pageSize.getWidth(),h=doc.internal.pageSize.getHeight();
 assert.ok(Math.abs(Math.min(w,h)-297)<1&&Math.abs(Math.max(w,h)-420)<1,'Página do mapa deve ser A3');
 const mapa=imagens.at(-1),[, ,x,y,iw,ih]=mapa.args,info=doc.getImageProperties(imagem);
 assert.equal(mapa.pagina,2);assert.ok(x>=7.9&&y>=17.9&&x+iw<=w-7.9&&y+ih<=h-13.9,'Mapa inteiro dentro da página');
 assert.ok(Math.max(iw,ih)>280,'Mapa precisa ocupar a página em tamanho grande');assert.ok(Math.abs(iw/ih-info.width/info.height)<0.0001,'Preservar proporção');
 assert.equal(pedidos[0].opts.credentials,'omit');assert.equal(pedidos[0].opts.cache,'no-store');
 if(process.env.BSQ_PDF_SAIDA)fs.writeFileSync(process.env.BSQ_PDF_SAIDA,Buffer.from(await salvos[0].blob.arrayBuffer()));
 // Página pública não depende do usuário interno nem mostra zero para reservado.
 delete ctx.S;await vm.runInContext("PDF.espelho(ls.slice(1),null,cfg,'Reservados',{publico:true,salvar:salvarNoAparelho})",ctx);
 const texto=doc.output();assert.ok(texto.includes('Consultar equipe'));assert.ok(!texto.includes('vendidos'));assert.ok(!texto.includes('gerado por'));assert.ok(!texto.includes('(2) Tj'));
 falha=true;const antes=salvos.length;await assert.rejects(vm.runInContext("PDF.espelho(ls,null,cfg,'',{publico:true,salvar:salvarNoAparelho})",ctx),/incluir o mapa/);assert.equal(salvos.length,antes,'Não baixar PDF incompleto quando mapa falha');
 falha=false;imagem=Buffer.from('imagem corrompida');await assert.rejects(vm.runInContext("PDF.espelho(ls,null,cfg,'',{publico:true,salvar:salvarNoAparelho})",ctx),/incluir o mapa/);assert.equal(salvos.length,antes);
 const sem=await vm.runInContext("PDF.espelho(ls,null,{},'',{publico:true,salvar:salvarNoAparelho})",ctx);assert.equal(sem.comMapa,false);assert.equal(doc.getNumberOfPages(),1);
 console.log('PASSOU: PDF real com mapa A3 inteiro, proporção preservada, recorte público e bloqueio de arquivo incompleto em falhas.');
})().catch(e=>{console.error(e);process.exit(1)});
