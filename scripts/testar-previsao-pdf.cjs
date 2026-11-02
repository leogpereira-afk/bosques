/* Exportação real com jsPDF, dados inteiramente fictícios. Sem browser/rede. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {jsPDF}=require('../libs/jspdf.umd.min.js');
const F=require('../financeiro-core.js'),P=require('../financeiro-previsao-vendas.js');
const raiz=path.resolve(__dirname,'..');
function dados(anos=13){
  const ps=[];for(let y=2026;y<2026+anos;y++)for(let m=1;m<=12;m++)ps.push({tid:'teste-'+y+'-'+m,venc:y+'-'+String(m).padStart(2,'0')+'-15',valor:1250.37+m*15});
  const v={id:'contrato-ficticio',clienteNome:'Cliente de demonstração',situacao:'ativa',quadra:1,lote:1,entrada:0,parcelas:ps};
  const recs=ps.slice(0,7).map((p,i)=>({id:'rec-ficticio-'+i,vendaId:v.id,valor:p.valor-(i===6?200:0),data:'2026-01-10',alocacoes:[{tid:p.tid,valor:p.valor-(i===6?200:0)}]}));
  const r=P.montar([{venda:v,resumo:F.resumo(v,recs,'2026-11-02')}],'2026-11-02');
  r.pendencias=[{vendaId:v.id,cliente:'Cliente conferência',lotes:'Q1 L1',rotulo:'Parcela pendente',venc:'2026-12-10',valorReferencia:150,motivo:'Conferir vínculo; não somar como dívida confirmada.'}];
  r.planos=Array.from({length:1200},(_,i)=>({vendaId:'plano-'+i,cliente:'Cliente fictício '+i,lotes:'Q2 L2',rotulo:'Plano sem espelho',venc:'2027-01-10',previsto:100,motivo:'Plano sem espelho do Omie.'}));
  r.totais.previsto=120000;r.totais.planos=r.planos.length;r.totais.pendencias=r.pendencias.length;
  return r;
}
function ambiente(){
  const salvos=[];let doc;
  function Documento(op){
    doc=new jsPDF(op);doc.verificacao={textos:[],retangulos:[]};
    const text=doc.text.bind(doc),rect=doc.rect.bind(doc);
    doc.text=(s,x,y,opts)=>{doc.verificacao.textos.push({s:Array.isArray(s)?s.join('\n'):String(s),x,y,pagina:doc.internal.getCurrentPageInfo().pageNumber,tamanho:doc.getFontSize(),opts});return text(s,x,y,opts);};
    doc.rect=(x,y,w,h,estilo)=>{doc.verificacao.retangulos.push({x,y,w,h,pagina:doc.internal.getCurrentPageInfo().pageNumber,estilo});return rect(x,y,w,h,estilo);};return doc;
  }
  const ctx=vm.createContext({window:{jspdf:{jsPDF:Documento}},salvarNoAparelho:(blob,nome)=>salvos.push({blob,nome}),console});
  vm.runInContext(fs.readFileSync(path.join(raiz,'financeiro-previsao-pdf.js'),'utf8'),ctx);
  return {gerar:(modelo,opts={salvar:false})=>{ctx.modelo=modelo;ctx.opts=opts;return vm.runInContext('FIN_PREVISAO_PDF.gerar(modelo,{},opts)',ctx);},salvos};
}
test('PDF padrão exporta os 13 anos e todos os meses, sem listar milhares de pendências',()=>{
  const m=dados(),a=ambiente(),d=a.gerar(m,{salvar:false,dadosFicticios:true}),ss=d.verificacao.textos.map(x=>x.s);
  assert.equal(d.getNumberOfPages(),15,'Dois resumos e uma página por ano');
  for(const x of m.meses)assert.ok(ss.includes(['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][Number(x.chave.slice(5))-1]+'/'+x.chave.slice(0,4)),x.chave);
  for(const y of m.anos)assert.ok(ss.includes('Previsão por mês - '+y.ano));
  assert.ok(ss.includes('1200'));assert.ok(!ss.includes('Cliente fictício 1199\nQ2 L2'));
  assert.ok(ss.some(x=>x.includes('PRÉVIA - DADOS FICTÍCIOS')));assert.ok(ss.some(x=>x.includes('não pela data de entrada no caixa')));
  assert.equal(a.salvos.length,0);assert.ok(d.output().startsWith('%PDF-'));
  if(process.env.BSQ_PREVISAO_PDF_SAIDA)fs.writeFileSync(process.env.BSQ_PREVISAO_PDF_SAIDA,Buffer.from(d.output('arraybuffer')));
});
test('valores exatos e totais saem do mesmo modelo sem modificar fontes',()=>{
  const m=dados(2),antes=JSON.stringify(m),a=ambiente(),d=a.gerar(m),ss=d.verificacao.textos.map(x=>x.s),brl=n=>n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/\u00a0/g,' ');
  assert.equal(JSON.stringify(m),antes);for(const n of [m.totais.recebido,m.totais.aberto,m.totais.total])assert.ok(ss.includes(brl(n)));
  for(const mes of m.meses)for(const n of [mes.recebido,mes.aberto,mes.total])assert.ok(ss.includes(brl(n)));
  assert.ok(!ss.some(x=>/NaN|undefined|Infinity/.test(x)));
});
test('cinco anos mantêm os critérios na página de resumo, sem página órfã',()=>{
  const d=ambiente().gerar(dados(5)),ts=d.verificacao.textos;
  assert.equal(d.getNumberOfPages(),6,'Um resumo e cinco páginas anuais');
  const criterios=ts.find(x=>x.s.startsWith('Base: contratos do Bosques'));
  assert.equal(criterios.pagina,1);assert.ok(criterios.y<d.internal.pageSize.getHeight()-17);
});
test('páginas anuais mantêm gráfico e tabela dentro da área útil',()=>{
  const d=ambiente().gerar(dados()),h=d.internal.pageSize.getHeight(),w=d.internal.pageSize.getWidth();
  const textos=d.verificacao.textos,ys=textos.filter(x=>x.s.startsWith('Previsão por mês - '));
  assert.equal(ys.length,13);for(const ano of ys){
    const p=textos.filter(x=>x.pagina===ano.pagina);assert.ok(p.some(x=>x.s==='Total de '+ano.s.slice(-4)),'Total anual na mesma página');
    assert.equal(p.filter(x=>/^\w{3}\/20\d\d$/.test(x.s)).length,12,'Todos os meses na página do ano');
  }
  for(const t of textos){assert.ok(t.x>=11.9&&t.x<=w-11.9,'Texto fora da largura: '+t.s);assert.ok(t.y>=8&&t.y<=h-7,'Texto fora da altura: '+t.s);}
  for(const q of d.verificacao.retangulos){assert.ok(q.x>=0&&q.y>=0&&q.w>=0&&q.h>=0&&q.x+q.w<=w+.01&&q.y+q.h<=h-16,'Desenho fora da página');}
});
test('carteira vazia continua legível e não inventa vencimentos',()=>{
  const a=ambiente(),d=a.gerar(P.montar([])),ss=d.verificacao.textos.map(x=>x.s);
  assert.equal(d.getNumberOfPages(),1);assert.ok(ss.some(x=>x.includes('Sem parcelas confirmadas com vencimento')));assert.ok(!ss.some(x=>x.startsWith('Previsão por mês -')));
});
test('download usa o salvamento existente uma única vez e retorna o documento',()=>{
  const a=ambiente(),d=a.gerar(dados(1),{salvar:true});assert.equal(a.salvos.length,1);assert.match(a.salvos[0].nome,/^Bosques-Recebiveis-vendidos-\d{4}-\d{2}-\d{2}\.pdf$/);assert.ok(a.salvos[0].blob.size>500);assert.equal(typeof d.output,'function');
});
test('detalhamento opcional quebra observação longa sem descartar seu final',()=>{
  const m=P.montar([]),fim='MARCADOR FINAL DA OBSERVACAO';m.pendencias=[{cliente:'Cliente fictício',lotes:'Q1 L2',venc:'',rotulo:'Parcela',motivo:('Texto de conferência completo. '.repeat(400))+fim,valorReferencia:null}];
  const d=ambiente().gerar(m,{salvar:false,detalharPendencias:true}),ss=d.verificacao.textos.map(x=>x.s);assert.ok(d.getNumberOfPages()>2);assert.ok(ss.join(' ').includes(fim));assert.ok(ss.includes('A conferir'));
});
