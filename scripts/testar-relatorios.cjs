const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const registros = {
  rec:[{id:'r1',data:'2025-12-31',valor:90},{id:'r2',data:'2026-01-01',valor:100.10},{id:'r3',data:'2026-09-05',valor:200.20},{id:'r4',valor:50}],
  cx:[{id:'c1',tipo:'entrada',data:'2026-01-02',valor:20.20,categoria:'Taxas'},
      {id:'c2',tipo:'saida',data:'2026-01-04',valor:150.50,categoria:'Obra'},
      {id:'c3',tipo:'saida',data:'2026-09-04',valor:30.30,categoria:'Comissão'},
      {id:'c4',tipo:'saida',valor:10,categoria:'Obra'},
      {id:'anotacao',tipo:'saida',data:'2026-01-04',valor:9999,anotacao:true}],
  prev:[{valor:9999,data:'2026-01-01'}], venda:[]
};
const ctx=vm.createContext({TELAS:{},FINANCEIRO:require('../financeiro-core.js'),lista:c=>registros[c]||[],achar:()=>null,hojeISO:()=> '2026-09-06'});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../caixa.js'),'utf8'),ctx);
const janeiro=vm.runInContext("relHistoricoDados('2026-01')",ctx);
assert.equal(janeiro.meses.length,12);
assert.equal(janeiro.meses[1].quantidade,0);
assert.equal(janeiro.meses[1].entradas,0);
assert.equal(janeiro.selecionado.entradas,120.30);
assert.equal(janeiro.selecionado.saidas,150.50);
assert.equal(janeiro.selecionado.resultado,-30.20);
assert.equal(janeiro.total.entradas,320.50);
assert.equal(janeiro.total.saidas,180.80);
assert.equal(janeiro.total.resultado,139.70);
assert.equal(janeiro.semData,2);
assert.equal(Math.round(janeiro.dre.total.receita*100),46050);
assert.equal(Math.round(janeiro.dre.mes.receita*100),12030);
const anterior=vm.runInContext("relHistoricoDados('2025-12')",ctx);
assert.equal(anterior.total.entradas,90);
assert.equal(anterior.total.saidas,0);
const setembro=vm.runInContext("relHistoricoDados('2026-09')",ctx);
assert.equal(setembro.selecionado.quantidade,2);
assert.equal(setembro.selecionado.entradas,200.20);
assert.equal(setembro.dre.mes.desp['Comissão'],30.30);
console.log('PASSOU: 18 verificações do histórico — 12 meses, centavos, ano anterior, mês selecionado, sem data e exclusão de previsões/anotações.');

assert.ok(vm.runInContext("relAnosHistorico('2026')",ctx).includes('2025'));
registros.rec=registros.rec.filter(r=>!String(r.data||'').startsWith('2025'));
assert.ok(vm.runInContext("relAnosHistorico('2026')",ctx).includes('2025'));
console.log('PASSOU: 2025 disponível com e sem lançamentos importados.');
