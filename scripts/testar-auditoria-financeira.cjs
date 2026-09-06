const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const reg={titulo:[
 {id:'t1',titulo:1,grupo:'CONTA_A_RECEBER',venc:'2026-08-20',original:{resumo:{nValAberto:1386.25}}},
 {id:'t2',titulo:2,grupo:'CONTA_A_RECEBER',venc:'2026-07-20',original:{resumo:{nValAberto:500}}},
 {id:'t3',titulo:3,grupo:'CONTA_A_RECEBER',venc:'2026-08-25',original:{resumo:{nValAberto:3000}}},
 {id:'t4',titulo:4,grupo:'CONTA_A_RECEBER',venc:'2026-10-01',original:{resumo:{nValAberto:100}}},
 {id:'t5',titulo:5,grupo:'CONTA_A_RECEBER',venc:'2026-08-01',status:'CANCELADO',original:{resumo:{nValAberto:9999}}},
 {id:'p1',titulo:6,grupo:'CONTA_A_PAGAR',venc:'2026-10-10',original:{resumo:{nValAberto:250.25}}}],
 venda:[{id:'v1',parcelas:[{tid:1}]}],rec:[],cx:[],obrigacao:[{id:'o1',valor:250.25,venc:'2026-10-10',omie:{titulo:6}},{id:'o2',valor:90,venc:'2026-10-11'}],prev:[],etapa:[]};
const ctx=vm.createContext({TELAS:{},S:{cacheCompleto:true,reg},FINANCEIRO:require('../financeiro-core'),lista:c=>reg[c]||[],hojeISO:()=> '2026-09-06',vendasVivas:()=>reg.venda,resumoVenda:()=>({carne:[]}),achar:()=>null});
for(const f of ['espelho.js','caixa.js','financeiro.js'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
const aging=ctx.agingInadimplencia();
assert.equal(aging.reduce((s,f)=>s+Math.round(f.rs*100),0),488625,'Faixas devem incluir os títulos Omie sem lote');
assert.equal(aging.reduce((s,f)=>s+f.parcelas,0),3);
assert.equal(aging.reduce((s,f)=>s+Math.round(f.semVinculo*100),0),350000);
assert.equal(ctx.aReceberPorMes().vencido,4886.25);
assert.equal(ctx.aReceberPorMes().porMes['2026-10'],100);
assert.equal(ctx.previstoNoMes('2026-10'),250.25,'Previsão Omie não deve duplicar obrigação local');
assert.equal(ctx.finLinhas('pagar').reduce((s,x)=>s+x.valor,0),250.25);
reg.titulo.push({...reg.titulo[0],id:'repetido'});
assert.equal(ctx.aReceberPorMes().vencido,4886.25,'Título repetido conta uma vez');
assert.equal(ctx.agingInadimplencia().reduce((s,f)=>s+Math.round(f.rs*100),0),488625);
reg.titulo=[];
assert.equal(ctx.aReceberPorMes().total,0,'Não substituir Omie ausente por plano local');
assert.equal(ctx.agingInadimplencia().reduce((s,f)=>s+f.rs,0),0);
console.log('PASSOU: mesma origem nos atrasos, títulos sem vínculo, cancelamentos, deduplicação e previsão exclusiva Omie.');
