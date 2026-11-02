/* Dados fictícios. A leitura mensal não escreve nem consulta a rede. */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const F = require('../financeiro-core.js');
const P = require('../financeiro-previsao-vendas.js');
const hoje = '2026-11-02';
function contrato(id = 'v1', parcelas = [{tid:'t1', venc:'2026-12-10', valor:100}], op = {}) {
  return {id, situacao:'ativa', entrada:0, clienteNome:'Cliente fictício ' + id, quadra:1, lote:1, parcelas, ...op};
}
const preparar = (v, rec = []) => ({venda:v, resumo:F.resumo(v, rec, hoje)});
const recibo = (v, tid, valor, data = '2026-11-01') => ({id:'r-' + v + '-' + tid, vendaId:v, data, valor, alocacoes:[{tid, valor}]});
const cent = v => Math.round(v * 100);

test('meses, anos, totais e escala usam a mesma carteira e somam centavos exatos', () => {
  const v = contrato('v1', [{tid:'t1', venc:'2026-12-10', valor:0.1}, {tid:'t2', venc:'2026-12-11', valor:0.2}, {tid:'t3', venc:'2027-02-10', valor:12.34}]);
  const r = P.montar([preparar(v)], hoje);
  assert.equal(r.totais.aberto, 12.64); assert.equal(r.maximo, 12.34);
  assert.deepEqual(r.meses.map(m => [m.chave, m.total]), [['2026-12', 0.3], ['2027-01', 0], ['2027-02', 12.34]]);
  assert.equal(r.anos.reduce((n, a) => n + cent(a.total), 0), cent(r.totais.total));
  assert.equal(r.meses.reduce((n, m) => n + cent(m.total), 0), cent(r.totais.total));
  assert.equal(r.meses.flatMap(m => m.itens).length, r.totais.parcelas);
});
test('pagamento parcial ocupa recebido e saldo no vencimento, sem virar fluxo de caixa', () => {
  const v = contrato(); const r = P.montar([preparar(v, [recibo(v.id, 't1', 30, '2026-10-01')])], hoje);
  assert.deepEqual(r.meses.map(m => [m.chave, m.recebido, m.aberto]), [['2026-12', 30, 70]]);
  assert.equal(r.itens[0].rotulo, '1ª'); assert.equal(r.itens[0].vendaId, v.id);
});
test('desconto confirmado e crédito excedente não aumentam o valor da parcela', () => {
  const v = contrato('v1', [{tid:'t1', venc:'2026-12-10', valor:125, valorDia:100, descontoConfirmado:true}]);
  const r = P.montar([preparar(v, [recibo(v.id, 't1', 120)])], hoje);
  assert.equal(r.totais.recebido, 100); assert.equal(r.totais.aberto, 0); assert.equal(r.totais.total, 100); assert.equal(r.totais.credito, 20);
  assert.equal(r.itens[0].credito, 20);
  assert.equal(r.creditos.length, 1); assert.equal(r.creditos[0].vendaId, v.id); assert.equal(r.creditos[0].valorReferencia, 20);
});
test('juros e desconto de liquidação continuam sendo decididos pelo motor existente', () => {
  const v = contrato('v1', [{tid:'t1', venc:'2026-10-10', valor:100, liquidacao:{juros:5, multa:2, desconto:3}}]);
  const r = P.montar([preparar(v, [recibo(v.id, 't1', 100)])], hoje);
  assert.equal(r.totais.recebido, 100); assert.equal(r.totais.aberto, 4);
});
test('quitados permanecem no histórico; distratos, apagados e incorporados ficam fora', () => {
  const entradas = ['quitada', 'distratada', 'ativa', 'ativa'].map((situacao, i) => {
    const v = contrato('v' + i, [{tid:'t' + i, venc:'2026-12-10', valor:100}], {situacao, ...(i === 2 ? {apagadoEm:'2026-10-01'} : {}), ...(i === 3 ? {incorporadaEmVendaId:'v0'} : {})});
    return preparar(v, [recibo(v.id, 't' + i, 100)]);
  });
  const r = P.montar(entradas, hoje); assert.equal(r.totais.recebido, 100); assert.equal(r.totais.contratos, 1);
});
test('entrada separada aparece uma vez; entrada no espelho não é repetida', () => {
  const v = contrato('v1', [{tid:'t1', venc:'2026-12-10', valor:100}], {entrada:40, dataEntrada:'2026-11-01'});
  const rec = {id:'entrada', vendaId:v.id, tipo:'entrada', valor:10, data:'2026-11-01'};
  let r = P.montar([preparar(v, [rec])], hoje);
  assert.equal(r.totais.recebido, 10); assert.equal(r.totais.aberto, 130); assert.equal(r.itens.filter(x => x.rotulo === 'Entrada').length, 1);
  v.entradaNoEspelho = true;
  r = P.montar([preparar(v)], hoje); assert.equal(r.totais.total, 100); assert.equal(r.itens.length, 1);
});
test('entrada não presume recebido quando o saldo está ausente, excede valor ou a data é inválida', () => {
  for (const entradaSaldo of [undefined, 101, 'NaN']) {
    const v = contrato('v1', [], {entrada:100, dataEntrada:'2026-11-01'});
    const r = P.montar([{venda:v, resumo:{espelhoOmie:true, carne:[], entradaSaldo}}], hoje);
    assert.equal(r.totais.recebido, 0); assert.equal(r.pendencias[0].codigoMotivo, 'entrada-inconclusiva');
  }
  const v = contrato('v1', [], {entrada:100, dataEntrada:'2026-02-30'});
  const r = P.montar([preparar(v)], hoje); assert.equal(r.pendencias[0].codigoMotivo, 'sem-data');
});
test('não alocado e excesso da entrada ficam separados dos meses', () => {
  const v = contrato('v1', [{tid:'t1', venc:'2026-12-10', valor:100}], {entrada:40, dataEntrada:'2026-11-01'});
  const r = P.montar([preparar(v, [{id:'e', vendaId:v.id, tipo:'entrada', valor:50, data:'2026-11-01'}, {id:'solto', vendaId:v.id, valor:12, data:'2026-10-01'}])], hoje);
  assert.equal(r.totais.recebido, 40); assert.equal(r.totais.aberto, 100); assert.equal(r.totais.credito, 10); assert.equal(r.totais.naoAlocado, 12);
  assert.equal(r.creditos[0].valorReferencia, 10); assert.equal(r.naoAlocado[0].valorReferencia, 12);
  assert.equal(r.naoAlocado[0].vendaId, v.id);
});
test('plano sem espelho nunca vira recebido nem título confirmado', () => {
  const v = contrato('v1', []);
  const r = P.montar([{venda:v, resumo:{semEspelho:true, carne:[{n:1, valor:100, pago:30, venc:'2030-01-01'}], saldo:70, pago:30}}], hoje);
  assert.equal(r.totais.total, 0); assert.equal(r.totais.previsto, 70); assert.equal(r.planos.length, 1); assert.equal(r.planos[0].recebido, 0);
  assert.equal(r.meses.length, 0); assert.equal(r.maximo, 0);
});
test('sem data, conferência e valores não confirmados ficam fora das barras', () => {
  const v = contrato('v1', [{tid:'t1', venc:'', valor:100}, {tid:'t2', venc:'2026-11-01', valor:100, conferir:true}, {tid:'t3', venc:'2026-02-30', valor:100}]);
  const a = preparar(v); a.resumo.carne.push({tid:'t4', n:4, venc:'2026-12-01', valor:100, pago:0, saldo:undefined});
  const r = P.montar([a], hoje); assert.equal(r.totais.total, 0); assert.equal(r.pendencias.length, 4); assert.equal(r.meses.length, 0);
  assert.ok(r.pendencias.some(x => x.codigoMotivo === 'valores-inconclusivos'));
});
test('mesmo título em duas vendas ou duas parcelas não é confirmado duas vezes', () => {
  for (const registros of [[preparar(contrato('v1')), preparar(contrato('v2'))], [preparar(contrato('v1', [{tid:'t1', venc:'2026-12-10', valor:100}, {tid:'t1', venc:'2026-12-10', valor:100}]))]]) {
    const r = P.montar(registros, hoje); assert.equal(r.totais.total, 0); assert.equal(r.pendencias.length, 2);
    assert.ok(r.pendencias.every(x => x.codigoMotivo === 'titulo-duplicado'));
  }
});
test('mesma venda repetida não duplica; identificadores legados são locais ao contrato', () => {
  const v = contrato('v1', [{venc:'2026-12-10', valor:100}]), a = preparar(v);
  const r = P.montar([a, a, preparar(contrato('v2', [{venc:'2026-12-10', valor:100}]))], hoje);
  assert.equal(r.totais.total, 200); assert.equal(r.pendencias.length, 0); assert.equal(new Set(r.itens.map(x => x.id)).size, 2);
});
test('parcelas canceladas, apagadas e removidas não retornam à previsão', () => {
  const v = contrato('v1', [{tid:'t1', valor:100, venc:'2026-12-10', cancelado:true}, {tid:'t2', valor:100, venc:'2026-12-10', apagadoEm:'2026-10-01'}, {tid:'t3', valor:100, venc:'2026-12-10', _remover:true}]);
  const r = P.montar([preparar(v)], hoje); assert.equal(r.totais.total, 0); assert.equal(r.pendencias.length, 0);
});
test('canceladas entre parcelas preservam o índice original e a identidade dos títulos restantes', () => {
  const v = contrato('v1', [{tid:'cancelada-antes', valor:50, venc:'2026-11-10', cancelado:true}, {tid:'t2', valor:100, venc:'2026-12-10'}, {tid:'cancelada-meio', valor:60, venc:'2027-01-10', cancelado:true}, {tid:'t4', valor:80, venc:'2027-02-10'}]);
  const r = P.montar([preparar(v, [recibo(v.id, 't4', 30)])], hoje);
  assert.deepEqual(r.itens.map(x => [x.tid, x.rotulo, x.recebido, x.aberto]), [['t2', '2ª', 0, 100], ['t4', '4ª', 30, 50]]);
  assert.equal(r.totais.total, 180);
});
test('contrato conjunto mostra todos os lotes mas soma cada parcela uma vez', () => {
  const v = contrato('v1', undefined, {lotes:[{loteId:'l1', quadra:1, lote:1}, {loteId:'l2', quadra:1, lote:2}]});
  const r = P.montar([preparar(v)], hoje); assert.equal(r.totais.total, 100); assert.equal(r.itens[0].lotes, 'Q1 L1 + Q1 L2');
});
test('histórico anterior ao corte entra uma vez e não cria recibo ou altera os originais', () => {
  const v = contrato('v1', [{tid:'t1', valor:100, venc:'2025-12-01', liquidacao:{desconto:0, juros:0, multa:0}}], {clienteId:'111'});
  const t = {id:'t1', titulo:'t1', grupo:'CONTA_A_RECEBER', origem:'omie', cpf:'111', status:'RECEBIDO', valor:100, venc:'2025-12-01', original:{detalhes:{dDtPagamento:'10/12/2025'}, resumo:{cLiquidado:'S', nValPago:100, nValLiquido:100, nValAberto:0}}};
  const reg = {venda:[v], titulo:[t], rec:[]}; const antes = JSON.stringify(reg);
  const c = vm.createContext({FINANCEIRO:F, TELAS:{}, S:{reg, cfg:{omie:{corteEntradas:'2026-01-01'}}}, lista:k => reg[k] || [], hojeISO:() => hoje});
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../espelho.js'), 'utf8'), c);
  const resumo = c.resumoVenda(v); const entrada = [{venda:v, resumo}], foto = JSON.stringify(entrada);
  assert.equal(resumo.valorPagoAntesCorte, 100);
  const r = P.montar(entrada, hoje); assert.equal(r.totais.recebido, 100); assert.equal(r.totais.aberto, 0); assert.equal(r.pendencias.length, 0);
  assert.equal(JSON.stringify(reg), antes); assert.equal(JSON.stringify(entrada), foto); assert.equal(reg.rec.length, 0);
  assert.deepEqual(P.montar(entrada, hoje), r);
});
test('título indisponível permanece em conferência sem reaparecer como dívida confirmada', () => {
  const v = contrato(); const reg = {venda:[v], titulo:[{titulo:'t1', grupo:'CONTA_A_RECEBER', ausenteOrigemOmie:true}], rec:[]};
  const c = vm.createContext({FINANCEIRO:F, TELAS:{}, S:{reg, cfg:{}}, lista:k => reg[k] || [], hojeISO:() => hoje});
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../espelho.js'), 'utf8'), c);
  const r = P.montar([{venda:v, resumo:c.resumoVenda(v)}], hoje);
  assert.equal(r.totais.aberto, 0); assert.equal(r.pendencias.length, 1);
});
