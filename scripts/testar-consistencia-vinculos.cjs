/* Dados fictícios: a mesma identidade e disponibilidade deve valer na home,
 * nas faixas de atraso e nas filas de conferência, sem alterar os registros. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const F = require('../financeiro-core.js');
const raiz = path.resolve(__dirname, '..');
const vinculo = (parcela = {}, venda = {}) => ({
  venda: { id: 'venda-ficticia', situacao: 'ativa', ...venda },
  parcela: { tid: 'titulo-ficticio', valor: 100, venc: '2026-09-20', ...parcela },
});
const titulo = (tid, valor, campos = {}) => ({
  id: 'CONTA_A_RECEBER-' + tid, titulo: tid, grupo: 'CONTA_A_RECEBER',
  status: 'ABERTO', venc: '2026-09-20', valor,
  original: { resumo: { nValAberto: valor } }, ...campos,
});
function ambiente(reg) {
  const ctx = vm.createContext({
    FINANCEIRO: F, TELAS: {}, S: { reg, cacheCompleto: true },
    lista: col => (reg[col] || []).filter(r => !r.apagadoEm),
    hojeISO: () => '2026-10-29',
    fmt: { brl: v => 'R$ ' + v.toFixed(2), data: v => v },
    finAtraso: v => 'R$ ' + v.toFixed(2),
  });
  for (const arquivo of ['espelho.js', 'caixa.js', 'vendas.js'])
    vm.runInContext(fs.readFileSync(path.join(raiz, arquivo), 'utf8'), ctx, { filename: arquivo });
  return ctx;
}

test('home e faixas não cobram títulos ausentes ou cancelados, preservando o acervo', () => {
  const reg = { titulo: [titulo('ativo', 100), titulo('ausente', 200, { ausenteOrigemOmie: { evidencia: 'teste' } }),
    titulo('cancelado', 300, { cancelado: true }), titulo('status', 400, { status: 'CANCELADO' }),
    titulo('apagado', 500, { apagadoEm: '2026-10-28' })], venda: [] };
  const antes = JSON.stringify(reg), ctx = ambiente(reg);
  assert.equal(ctx.resumoInadimplenciaOmie().total, 100);
  assert.equal(ctx.agingInadimplencia().reduce((s, f) => s + f.rs, 0), 100);
  assert.equal(ctx.resumoInadimplenciaOmie().titulos.length, 1);
  assert.equal(JSON.stringify(reg), antes);
});

test('contrato confirmado com valores pendentes não volta à fila de contrato desconhecido', () => {
  const p = vinculo({ conferir: true, vinculoConfirmado: true });
  const reg = { titulo: [titulo('titulo-ficticio', 100)], venda: [{ ...p.venda, parcelas: [p.parcela] }] };
  const ctx = ambiente(reg), r = ctx.resumoInadimplenciaOmie();
  assert.equal(r.total, 100);
  assert.equal(r.semVinculo, 0);
  assert.equal(r.valoresPendentes, 100);
  assert.equal(ctx.agingInadimplencia().reduce((s, f) => s + f.semVinculo, 0), 0);
  assert.ok(ctx.painelInadimplenciaOmie().includes('valores a conferir'));
});

for (const [nome, flags] of [
  ['ausente', {ausenteOrigemOmie:{em:'2026-10-29'}}], ['cancelado', {cancelado:true}],
  ['status cancelado', {status:'CANCELADO'}], ['apagado', {apagadoEm:'2026-10-28'}],
]) test('origem '+nome+' suspende cobrança da ficha e preserva saldo para conferência', () => {
  const v={id:'v-ficticia',parcelas:[{tid:'indisponivel',valor:100,venc:'2026-09-20'}]};
  const reg={venda:[v],titulo:[titulo('indisponivel',100,flags)],rec:[]}, antes=JSON.stringify(reg),ctx=ambiente(reg);
  const r=ctx.resumoVenda(v);
  assert.equal(r.emAtraso,0);assert.equal(r.qtdAtraso,0);assert.equal(r.proxima,null);
  assert.equal(r.saldo,100);assert.equal(r.pago,0);assert.equal(r.saldoPendente,100);
  assert.equal(r.carne[0].situacao,'conferir');assert.equal(r.conferenciasOrigem.length,1);
  assert.equal(r.conferenciasOrigem[0].tid,'indisponivel');assert.match(r.conferenciasOrigem[0].motivo,/origem|cancelad|apagad/i);
  assert.doesNotMatch(ctx.msgCobranca(v,r),/constam em aberto|somando R\$/);
  assert.equal(JSON.stringify(reg),antes);
});

test('conferência de origem preserva recebimento real e não bloqueia parcela manual sem título', () => {
  const v={id:'v-ficticia',parcelas:[{tid:'indisponivel',valor:100,venc:'2026-09-20'},
    {tid:'manual-local',valor:30,venc:'2026-09-20'},{valor:20,venc:'2026-09-20'}]};
  const reg={venda:[v],titulo:[titulo('indisponivel',100,{ausenteOrigemOmie:true}),
    titulo('manual-local',30,{grupo:'CONTA_A_PAGAR',cancelado:true})],
    rec:[{id:'rec-ficticio',vendaId:v.id,valor:40,data:'2026-09-20',alocacoes:[{tid:'indisponivel',valor:40}]}]};
  const antes=JSON.stringify(reg),ctx=ambiente(reg),r=ctx.resumoVenda(v);
  assert.equal(r.pago,40);assert.equal(r.carne[0].pago,40);assert.equal(r.carne[0].saldo,60);
  assert.equal(r.saldo,110);assert.equal(r.saldoPendente,60);assert.equal(r.emAtraso,50);
  assert.equal(r.conferenciasOrigem.length,1);assert.equal(r.conferenciasOrigem[0].tid,'indisponivel');
  assert.equal(JSON.stringify(reg),antes);
});

test('origem futura indisponível sai do lembrete e volta após atualização confirmada', async () => {
  const v={id:'v-ficticia',parcelas:[{tid:'futuro',valor:100,venc:'2026-11-01'}]};
  const reg={venda:[v],titulo:[titulo('futuro',100,{ausenteOrigemOmie:true})],rec:[]},ctx=ambiente(reg);
  assert.equal(ctx.resumoVenda(v).proxima,null);
  reg.titulo=[titulo('futuro',100)];
  await Promise.resolve();
  assert.equal(ctx.resumoVenda(v).proxima.tid,'futuro');
  assert.equal(ctx.resumoVenda(v).conferenciasOrigem.length,0);
  assert.equal(v.parcelas[0].conferir,undefined);
});

for (const mesmoContrato of [false, true]) test('vínculo repetido ' + (mesmoContrato ? 'na mesma ficha' : 'em duas fichas') + ' não confirma destino nem duplica saldo', () => {
  const a = vinculo(), b = vinculo({}, { id: mesmoContrato ? a.venda.id : 'outra-venda-ficticia' });
  const vendas = mesmoContrato ? [{ ...a.venda, parcelas: [a.parcela, b.parcela] }] :
    [{ ...a.venda, parcelas: [a.parcela] }, { ...b.venda, parcelas: [b.parcela] }];
  const ctx = ambiente({ titulo: [titulo('titulo-ficticio', 100)], venda: vendas });
  const r = ctx.resumoInadimplenciaOmie();
  assert.equal(r.total, 100);
  assert.equal(r.semVinculo, 100);
  assert.equal(r.vinculosMultiplos, 100);
  assert.equal(ctx.vinculosTitulosOmie().has('titulo-ficticio'), false);
  assert.equal(ctx.agingInadimplencia().reduce((s, f) => s + f.semVinculo, 0), 100);
  const antes = JSON.stringify(vendas), resumos = vendas.map(v => ctx.resumoVenda(v));
  assert.equal(resumos.reduce((s, r) => s + r.emAtraso, 0), 0, 'Vínculo duplicado não pertence ao atraso confirmado');
  for (const r of resumos) {
    assert.equal(r.qtdAtraso, 0);
    assert.equal(r.quitada, false);
    assert.ok(r.carne.every(p => p.conferir && p.situacao === 'conferir'));
  }
  assert.equal(resumos[0].saldo, mesmoContrato ? 200 : 100, 'Valores locais permanecem visíveis, sem escolher o contrato correto');
  assert.doesNotMatch(ctx.msgCobranca(vendas[0], resumos[0]), /constam em aberto|somando R\$/);
  assert.equal(JSON.stringify(vendas), antes, 'A conferência derivada não deve alterar parcelas persistidas');
});

test('título futuro duplicado não é oferecido como próxima parcela para cobrança', () => {
  const p = { tid: 'duplicado-futuro', valor: 100, venc: '2026-11-01' };
  const v = { id: 'v1', parcelas: [p, { tid: 'unico-futuro', valor: 30, venc: '2026-12-01' }] };
  const ctx = ambiente({ venda: [v, { id: 'v2', parcelas: [{ ...p }] }], rec: [] });
  const r = ctx.resumoVenda(v);
  assert.equal(r.proxima.tid, 'unico-futuro');
  assert.equal(r.carne[0].situacao, 'conferir');
  assert.match(ctx.msgCobranca(v, r), /R\$ 30.00/);
  assert.doesNotMatch(ctx.msgCobranca(v, r), /R\$ 100.00/);
});

test('pagamento existente em título duplicado é preservado sem transferir recebimento', () => {
  const p = { tid: 'titulo-pago', valor: 100, venc: '2026-09-01' };
  const a = { id: 'v1', parcelas: [p] }, b = { id: 'v2', parcelas: [{ ...p }] };
  const reg = { titulo: [titulo('titulo-pago', 100, { original: { resumo: { nValAberto: 0 } } })], venda: [a, b],
    rec: [{ id: 'rec-ficticio', vendaId: 'v1', tipo: 'parcela', valor: 100, data: '2026-09-01', omie: { titulo: 'titulo-pago' } }] };
  const antes = JSON.stringify(reg), ctx = ambiente(reg), ra = ctx.resumoVenda(a), rb = ctx.resumoVenda(b);
  assert.equal(ra.pago, 100);
  assert.equal(ra.carne[0].pago, 100);
  assert.equal(ra.saldo, 0);
  assert.equal(rb.pago, 0);
  assert.equal(rb.saldo, 100);
  assert.equal(ra.emAtraso + rb.emAtraso, 0);
  assert.equal(ctx.resumoInadimplenciaOmie().total, 0);
  assert.equal(JSON.stringify(reg), antes);
});

test('resolução do vínculo restaura o atraso único sem guardar a marca derivada', () => {
  const p = { tid: 'titulo-ficticio', valor: 100, venc: '2026-09-01' };
  const a = { id: 'v1', parcelas: [p] }, b = { id: 'v2', parcelas: [{ ...p }] };
  const reg = { venda: [a, b], rec: [] }, ctx = ambiente(reg);
  assert.equal(ctx.resumoVenda(a).emAtraso, 0);
  b.parcelas = [];
  assert.equal(ctx.resumoVenda(a).emAtraso, 100);
  assert.equal(ctx.resumoVenda(a).carne[0].situacao, 'atrasada');
  assert.equal(p.conferir, undefined);
});

test('consulta de venda fora da lista considera o conflito sem presumir que o título é dela', () => {
  const p = { tid: 'titulo-ficticio', valor: 100, venc: '2026-09-01' };
  const reg = { venda: [{ id: 'v1', parcelas: [p] }], rec: [] };
  const consulta = { id: 'outra-venda', parcelas: [{ ...p }] }, antes = JSON.stringify(reg), ctx = ambiente(reg);
  assert.equal(ctx.resumoVenda(consulta).emAtraso, 0);
  assert.equal(ctx.resumoVenda(consulta).carne[0].situacao, 'conferir');
  assert.equal(JSON.stringify(reg), antes);
});

test('índice é atualizado no evento seguinte mesmo quando a origem alterou a identidade no mesmo array', async () => {
  const p = { tid: 'titulo-ficticio', valor: 100, venc: '2026-09-01' };
  const a = { id: 'v1', parcelas: [p] }, b = { id: 'v2', parcelas: [{ ...p, tid: 'outro-titulo' }] };
  const ctx = ambiente({ venda: [a, b], rec: [] });
  assert.equal(ctx.resumoVenda(a).emAtraso, 100);
  b.parcelas[0].tid = p.tid;
  await Promise.resolve();
  assert.equal(ctx.resumoVenda(a).emAtraso, 0);
});

test('vínculos fora de contratos ativos não bloqueiam parcelas únicas, manuais ou valores pendentes', () => {
  const a = { id: 'v1', parcelas: [
    { tid: 'unico', valor: 100, venc: '2026-09-01' },
    { valor: 30, venc: '2026-09-01' },
    { tid: 'pendente', valor: 40, venc: '2026-09-01', conferir: true, vinculoConfirmado: true },
  ] };
  const reg = { venda: [a, { id: 'distratada', situacao: 'distratada', parcelas: [{ ...a.parcelas[0] }] },
    { id: 'removida', parcelas: [{ ...a.parcelas[0], _remover: true }] }], rec: [] };
  const ctx = ambiente(reg), r = ctx.resumoVenda(a);
  assert.equal(r.emAtraso, 130);
  assert.equal(r.qtdAtraso, 2);
  assert.equal(r.saldo, 170);
  assert.equal(r.saldoPendente, 40);
  assert.equal(r.carne[2].situacao, 'conferir');
});

test('parcelas removidas e contratos indisponíveis não confirmam um vínculo', () => {
  const vendas = [vinculo({ _remover: true }), vinculo({ cancelado: true }, { id: 'cancelado' }),
    vinculo({}, { id: 'distratado', situacao: 'distratada' }), vinculo({}, { id: 'apagado', apagadoEm: '2026-10-28' })]
    .map(x => ({ ...x.venda, parcelas: [x.parcela] }));
  const ctx = ambiente({ titulo: [titulo('titulo-ficticio', 100)], venda: vendas });
  assert.equal(ctx.resumoInadimplenciaOmie().semVinculo, 100);
  assert.equal(ctx.resumoInadimplenciaOmie().vinculosMultiplos, 0);
});

test('classificação separa ausência, incerteza, valores pendentes e vínculo confirmado', () => {
  assert.equal(typeof F.classificarVinculos, 'function', 'O classificador financeiro compartilhado deve existir');
  for (const [links, situacao, confirmado, valoresPendentes] of [
    [[], 'semvinculo', false, false],
    [[vinculo({ conferir: true })], 'incerto', false, false],
    [[vinculo({ conferir: true, vinculoConfirmado: true })], 'valorespendentes', true, true],
    [[vinculo()], 'confirmado', true, false],
    [[vinculo({}, { situacao: 'quitada' })], 'confirmado', true, false],
    [[vinculo(), vinculo({ conferir: true })], 'multiplo', false, false],
  ]) {
    const antes = JSON.stringify(links), r = F.classificarVinculos(links);
    assert.equal(r.situacao, situacao);
    assert.equal(r.confirmado, confirmado);
    assert.equal(r.valoresPendentes, valoresPendentes);
    assert.equal(r.vinculo, links.length === 1 ? links[0] : null);
    assert.equal(JSON.stringify(links), antes);
  }
});

test('disponibilidade é compartilhada e ausência de saldo não inventa saldo aberto', () => {
  assert.equal(typeof F.tituloDisponivel, 'function', 'O filtro compartilhado de origem deve existir');
  assert.equal(typeof F.vendaAtiva, 'function', 'O filtro compartilhado de contratos deve existir');
  assert.equal(F.tituloDisponivel(titulo('zero', 0)), true);
  for (const t of [null, { apagadoEm: '2026-10-28' }, { ausenteOrigemOmie: {} }, { cancelado: true }, { status: 'CANCELADO' }])
    assert.equal(F.tituloDisponivel(t), false);
  for (const situacao of ['ativa', 'conferir', 'quitada', undefined]) assert.equal(F.vendaAtiva({ situacao }), true);
  for (const v of [null, { apagadoEm: '2026-10-28' }, { situacao: 'distratada' }, { situacao: 'cancelada' }]) assert.equal(F.vendaAtiva(v), false);
  const ctx = ambiente({ titulo: [titulo('zero', 0), titulo('sem-saldo', 100, { original: { resumo: {} } })], venda: [] });
  assert.equal(ctx.resumoInadimplenciaOmie().total, 0);
});

test('origem ativa sem vínculo continua no total junto aos vínculos confirmados e pendentes', () => {
  const pendente = vinculo({ tid: 'pendente', conferir: true, vinculoConfirmado: true });
  const confirmado = vinculo({ tid: 'confirmado' }, { id: 'confirmada' });
  const ctx = ambiente({ titulo: [titulo('sem-vinculo', 10.01), titulo('pendente', 20.02), titulo('confirmado', 30.03)],
    venda: [pendente, confirmado].map(x => ({ ...x.venda, parcelas: [x.parcela] })) });
  const r = ctx.resumoInadimplenciaOmie();
  assert.equal(r.total, 60.06);
  assert.equal(r.semVinculo, 10.01);
  assert.equal(r.valoresPendentes, 20.02);
  assert.equal(r.vinculosMultiplos, 0);
});
