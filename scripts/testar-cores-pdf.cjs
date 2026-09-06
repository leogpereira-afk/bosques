const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {jsPDF}=require('../libs/jspdf.umd.min.js');
let textos=[];
function Documento(opts){const doc=new jsPDF(opts),original=doc.text.bind(doc);doc.text=(t,...args)=>{textos.push({texto:String(t),cor:doc.getTextColor()});return original(t,...args);};return doc;}
const ctx=vm.createContext({TELAS:{},window:{jspdf:{jsPDF:Documento}},fetch:async()=>({ok:false}),S:{quem:'Auditoria'},salvarNoAparelho:()=>{},nomeMes:m=>m});
for(const f of ['financeiro.js','pdf.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),ctx);
const roda=code=>{textos=[];vm.runInContext(code,ctx);};
// jsPDF arredonda canais RGB ao converter para sua representação decimal.
const checa=(valor,cor)=>{const encontrados=textos.filter(x=>x.texto.includes(valor));assert.ok(encontrados.length,'PDF não contém '+valor);for(const x of encontrados)assert.ok([1,3,5].every(i=>Math.abs(parseInt(x.cor.slice(i,i+2),16)-parseInt(cor.slice(i,i+2),16))<=2),JSON.stringify(x));};
roda("PDF.financeiro('Despesas','Todos',[{valor:123.45,descricao:'Obra',data:'2026-09-01'}],{},'despesas')");checa('123,45','#b83232');
roda("PDF.financeiro('Recebimentos','Todos',[{valor:456.78,descricao:'Parcela',data:'2026-09-01'}],{},'recebimentos')");checa('456,78','#1d4ed8');
roda("PDF.financeiro('Pendências','Todos',[{valor:111.22,tipo:'saida',vendaId:'v1',descricao:'Comissão',data:'2026-09-01'},{valor:222.33,rec:{},descricao:'Recebimento',data:'2026-09-01'}],{})");checa('111,22','#b83232');checa('222,33','#1d4ed8');
roda("PDF.cronograma([{e:{nome:'Obra',valorPrevisto:987.65},sit:'andamento',pago:321.12}],{previstoTotal:987.65,pagoTotal:321.12},{})");checa('987,65','#b83232');checa('321,12','#b83232');
roda("PDF.dre({mesSel:'2026-09',anoRotulo:'2026',mes:{recVendas:555.55,receita:555.55,outras:{},desp:{Obra:333.33},somaDesp:333.33,resultado:222.22},ano:{recVendas:555.55,receita:555.55,outras:{},desp:{Obra:333.33},somaDesp:333.33,resultado:222.22},total:{recVendas:555.55,receita:555.55,outras:{},desp:{Obra:333.33},somaDesp:333.33,resultado:222.22},catsOutras:[],catsDesp:['Obra']},{})");checa('333,33','#b83232');checa('555,55','#1d4ed8');
roda("PDF.relatorio({rotuloHz:'em 2026',hz:'ano',vendidos:1,vgv:9000,recebido:876.54,gasto:654.32,aReceber:765.43,vencido:0,previsto:432.10,grupos:[{rotulo:'set/2026',rec:765.43,prev:432.10}],aging:[]},{})");checa('654,32','#b83232');checa('432,10','#b83232');checa('765,43','#1d4ed8');
console.log('PASSOU: cores reais do jsPDF em despesas, recebimentos, listas mistas, cronograma demonstrativo por categoria e relatório de previsões.');
