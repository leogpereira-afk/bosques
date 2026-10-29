/* Concorrência da conciliação com o importador real. PostgreSQL/PGlite em
 * memória e respostas Omie fictícias; nenhuma conexão produtiva é utilizada. */
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const roots = [process.env.BSQ_TEST_DEPS, process.env.BSQ_TEST_PGLITE_DEPS, path.resolve('seed/devtools'), process.cwd()].filter(Boolean);
const { PGlite } = require(require.resolve('@electric-sql/pglite', { paths: roots }));
const ts = require(require.resolve('typescript', { paths: roots }));
const stamp = '2026-10-01T00:00:00.000Z';
const clone = x => JSON.parse(JSON.stringify(x));
let passaram = 0, falhas = 0;

(async () => {
  const banco = new PGlite();
  await banco.exec('create role anon;create role authenticated;create role service_role bypassrls;create table bsq_registros(colecao text,id text,registro jsonb,atualizado_em timestamptz,apagado boolean not null default false,primary key(colecao,id));');
  for (const sufixo of ['_conciliacao_financeira_auditavel.sql', '_conciliacao_sync_cas.sql']) {
    const arquivo = fs.readdirSync('supabase/migrations').find(n => n.endsWith(sufixo));
    await banco.exec(fs.readFileSync(path.join('supabase/migrations', arquivo), 'utf8'));
  }
  const put = (col, id, r) => banco.query('insert into bsq_registros values($1,$2,$3,now(),$4) on conflict(colecao,id) do update set registro=excluded.registro,apagado=excluded.apagado',
    [col, id, JSON.stringify({ id, atualizadoEm: stamp, ...r }), !!r.apagadoEm]);
  const get = async (col, id) => (await banco.query('select registro from bsq_registros where colecao=$1 and id=$2', [col, id])).rows[0]?.registro;
  const snapshot = async () => JSON.stringify((await banco.query('select colecao,id,registro,apagado from bsq_registros order by colecao,id')).rows);
  const revisao = async () => (await banco.query('select public.bsq_financeiro_revisao() r')).rows[0].r;
  const aplicar = (r, itens) => banco.query('select public.bsq_omie_aplicar_pagina($1,$2::jsonb) r', [r, JSON.stringify(itens)]);
  async function base() {
    await banco.exec('truncate bsq_registros,bsq_conciliacoes;update bsq_conciliacao_estado set revisao=0;');
    await put('venda', 'venda-a', { clienteId: '111', situacao: 'ativa', parcelas: [{ tid: '1', valor: 100, venc: '2026-10-10' }] });
    await put('venda', 'venda-b', { clienteId: '111', situacao: 'ativa', parcelas: [] });
    await put('titulo', 'CONTA_A_RECEBER-1', { titulo: '1', grupo: 'CONTA_A_RECEBER', cpf: '111', valor: 100, venc: '2026-10-10', status: 'RECEBIDO', original: { resumo: { nValPago: 100, nValLiquido: 100, nValAberto: 0 } } });
    await put('rec', 'rbomie-1', { numero: 1, vendaId: 'venda-a', valor: 100, data: '2026-10-10', alocacoes: [{ tid: '1', valor: 100 }], omie: { titulo: '1', cpf: '111' } });
    await put('titulo', 'CONTA_A_PAGAR-2', { titulo: '2', grupo: 'CONTA_A_PAGAR', valor: 100, venc: '2026-10-10', status: 'PAGO', original: { resumo: { nValPago: 100, nValLiquido: 100 } } });
    await put('cx', 'manual-1', { tipo: 'saida', valor: 100, data: '2026-10-10', origem: 'manual' });
    await put('cx', 'cxomie-2', { tipo: 'saida', valor: 100, data: '2026-10-10', origem: 'omie', omie: { titulo: '2' } });
  }
  const conciliar = async tipo => {
    const titulo = tipo === 'duplicidade' ? '2' : '1';
    return banco.query('select public.bsq_conciliar_financeiro($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) r',
      [tipo, titulo, tipo === 'titulo' ? 'venda-b' : '', tipo === 'titulo' ? 'origem' : '', tipo === 'duplicidade' ? 'mesmo' : '', tipo === 'duplicidade' ? 'manual-1' : '',
        'Documento fictício conferido', 'Pessoa de teste', 'operacao-teste-' + tipo,
        JSON.stringify(tipo === 'titulo' ? { titulo: stamp, venda: stamp } : { titulo: stamp, manual: stamp })]);
  };
  function ambiente(antesDeAplicar, revisaoInvalida) {
    const metas = new Map(), finais = []; let handler, numero = 5;
    const linhas = async col => (await banco.query('select id,registro from bsq_registros where colecao=$1 order by id', [col])).rows;
    const rpc = async (nome, p = {}) => {
      try {
        if (nome === 'bsq_financeiro_revisao') return { data: revisaoInvalida === undefined ? await revisao() : revisaoInvalida, error: null };
        if (nome === 'bsq_omie_aplicar_pagina') {
          if (antesDeAplicar) { const executar = antesDeAplicar; antesDeAplicar = null; await executar(); }
          return { data: (await aplicar(p.p_revisao, p.p_itens)).rows[0].r, error: null };
        }
        if (nome === 'bsq_omie_reservar') return { data: { adquirido: true, lease: 'lease-ficticia', inicio: '2026-10-21T12:00:00Z', pagina: 1, parcial: {}, completa: true } };
        if (nome === 'bsq_omie_finalizar') { finais.push(clone(p)); return { data: true }; }
        if (['bsq_importar_vendas_omie', 'bsq_identificar_pagamentos_omie', 'bsq_identificar_titulos_omie'].includes(nome)) return { data: { vendasNovas: 0, pagamentosVinculados: 0, titulos: 0, pagamentos: 0 } };
        throw new Error('RPC inesperada no teste: ' + nome);
      } catch (e) { return { error: { code: e.code, message: e.message }, data: null }; }
    };
    const dados = {
      agora: () => new Date().toISOString(), lerCfgBruta: async () => ({ omie: { corteEntradas: '2026-01-01' } }),
      lerColecaoBruta: linhas,
      lerCampos: async (col, campos) => (await linhas(col)).map(({ id, registro }) => ({ id, ...Object.fromEntries(campos.map(c => [c, registro[c] == null ? null : String(registro[c])])) })),
      lerPorIds: async (col, ids) => new Map((await linhas(col)).filter(l => ids.includes(l.id)).map(l => [l.id, l.registro])),
      lerUm: get, gravarUm: async () => { throw new Error('Sync não pode substituir registros fora da RPC transacional'); },
      gravarVarios: async () => { throw new Error('Sync não pode substituir um lote fora da RPC transacional'); },
      marcarMudanca: async () => {}, registrarLog: async () => {}, guardarIndiceNumero: async () => {}, proximoNumero: async () => ++numero,
      db: { rpc, from: () => ({ select() { return this; }, eq(k, v) { this.chave = v; return this; },
        maybeSingle: async function () { return { data: metas.has(this.chave) ? { valor: clone(metas.get(this.chave)) } : null }; },
        upsert: async x => { metas.set(x.chave, clone(x.valor)); return { error: null }; }, delete() { return this; },
      }) },
    };
    const movimentos = [
      { detalhes: { nCodTitulo: 1, cGrupo: 'CONTA_A_RECEBER', cStatus: 'RECEBIDO', nValorTitulo: 100, cCPFCNPJCliente: '111', dDtVenc: '10/10/2026', dDtPagamento: '10/10/2026' }, resumo: { cLiquidado: 'S', nValPago: 100, nValLiquido: 100, nValAberto: 0 } },
      { detalhes: { nCodTitulo: 2, cGrupo: 'CONTA_A_PAGAR', cStatus: 'PAGO', nValorTitulo: 100, dDtVenc: '10/10/2026', dDtPagamento: '10/10/2026' }, resumo: { cLiquidado: 'S', nValPago: 100, nValLiquido: 100 } },
    ];
    const ctx = vm.createContext({ Request, Response, AbortSignal, Date, Map, Set, JSON, Number, String, Object, Math, Promise,
      console: { log() {}, warn() {}, error() {} }, exports: {},
      Deno: { env: { get: () => 'segredo-ficticio' }, serve: f => { handler = f; } },
      fetch: async (_url, opcoes) => {
        const b = JSON.parse(opcoes.body); let resposta;
        if (b.call === 'ListarMovimentos') resposta = { nPagina: 1, nTotPaginas: 1, nTotRegistros: 2, movimentos };
        else if (b.call === 'ListarContasCorrentes') resposta = { ListarContasCorrentes: [], total_de_registros: 0, total_de_paginas: 0 };
        else if (b.call === 'ListarCategorias') resposta = { categoria_cadastro: [], total_de_registros: 0 };
        else if (b.call === 'ListarDepartamentos') resposta = { departamentos: [], total_de_registros: 0 };
        else resposta = { clientes_cadastro: [], total_de_registros: 0, total_de_paginas: 0 };
        return new Response(JSON.stringify(resposta), { status: 200 });
      },
      require: arquivo => arquivo.includes('classificacao-vinculo') ? require('./carregar-helper-ts.cjs')('classificacao-vinculo') : arquivo.includes('dados') ? dados : arquivo.includes('cors') ? { json: (b, s = 200) => new Response(JSON.stringify(b), { status: s }), preflight: () => null } :
        { identificar: async () => ({ perfil: 'direcao', proprio: true, nome: 'Pessoa de teste' }), perfilDe: q => q.perfil },
    });
    const src = fs.readFileSync('supabase/functions/bsq-omie/index.ts', 'utf8');
    vm.runInContext(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
    return { metas, finais, async executar() {
      const r = await handler(new Request('https://teste.invalid', { method: 'POST', headers: { 'x-token': 'segredo-ficticio' }, body: JSON.stringify({ action: 'sincronizar', completa: true }) }));
      return { status: r.status, corpo: await r.json() };
    } };
  }
  async function teste(nome, executar) {
    try { await base(); await executar(); passaram++; console.log('OK ' + nome); }
    catch (e) { falhas++; console.error('FALHOU ' + nome + ': ' + e.message); }
  }
  await teste('Página antiga não desfaz vínculo, distribuição ou histórico confirmados em voo', async () => {
    const sync = ambiente(() => conciliar('titulo')); const r = await sync.executar();
    assert.equal(r.status, 500); assert.match(r.corpo.error, /concilia|dados mudaram|releitura/i);
    assert.equal((await get('venda', 'venda-a')).parcelas.length, 0);
    const p = (await get('venda', 'venda-b')).parcelas[0]; assert.equal(p.tid, '1'); assert.ok(p.conciliacao);
    const rec = await get('rec', 'rbomie-1'); assert.equal(rec.vendaId, 'venda-b'); assert.deepEqual(rec.alocacoes, [{ tid: '1', valor: 100 }]); assert.ok(rec.historico.length);
    assert.equal(sync.metas.get('omie_sync').status, 'falhou'); assert.ok(sync.finais.at(-1).p_erro);
  });
  await teste('Página antiga não ressuscita cópia enviada à lixeira pela conciliação', async () => {
    const sync = ambiente(() => conciliar('duplicidade')); const r = await sync.executar();
    assert.equal(r.status, 500);
    const copia = await get('cx', 'cxomie-2'); assert.ok(copia.apagadoEm); assert.equal(copia.substituidoPor, 'manual-1');
    assert.equal((await get('titulo', 'CONTA_A_PAGAR-2')).decisaoDuplicidade, 'mesmo');
    assert.ok((await get('cx', 'manual-1')).vinculoOmieConfirmado);
    assert.equal(sync.metas.get('omie_sync').status, 'falhou');
    const nova = await sync.executar(); assert.equal(nova.status, 200, nova.corpo.error);
    assert.equal(sync.metas.get('omie_sync').status, 'completa');
    assert.ok((await get('cx', 'cxomie-2')).apagadoEm);
    assert.equal((await get('titulo', 'CONTA_A_PAGAR-2')).decisaoDuplicidade, 'mesmo');
    assert.ok((await get('titulo', 'CONTA_A_PAGAR-2')).historico.some(h => h.decisao === 'mesmo'));
  });
  await teste('Conciliação após uma página salva permanece soberana na próxima releitura', async () => {
    const sync = ambiente(); assert.equal((await sync.executar()).status, 200);
    const t = await get('titulo', 'CONTA_A_RECEBER-1'), v = await get('venda', 'venda-b');
    await banco.query('select public.bsq_conciliar_financeiro($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)',
      ['titulo', '1', 'venda-b', 'origem', '', '', 'Documento fictício confirmado', 'Pessoa de teste', 'operacao-pos-sync', JSON.stringify({ titulo: t.atualizadoEm, venda: v.atualizadoEm })]);
    assert.equal((await sync.executar()).status, 200);
    assert.equal((await get('rec', 'rbomie-1')).vendaId, 'venda-b');
    assert.ok((await get('venda', 'venda-b')).parcelas.some(p => p.conciliacao?.operacao === 'operacao-pos-sync'));
  });
  await teste('Lote com revisão antiga é revertido inteiro, inclusive registros novos', async () => {
    const antiga = await revisao(); await conciliar('titulo'); const antes = await snapshot();
    await assert.rejects(aplicar(antiga, [{ colecao: 'cliente', id: 'novo', registro: { id: 'novo', nome: 'Cliente fictício' } },
      { colecao: 'rec', id: 'rbomie-1', registro: { id: 'rbomie-1', valor: 100, vendaId: 'venda-a', apagadoEm: null } }]), e => e.code === '40001');
    assert.equal(await snapshot(), antes);
  });
  await teste('Falha intermediária do upsert reverte a página inteira', async () => {
    const antes = await snapshot();
    await assert.rejects(aplicar(await revisao(), [{ colecao: 'cliente', id: 'novo', registro: { id: 'novo' } },
      { colecao: 'titulo', id: 'invalido', registro: { id: 'invalido', atualizadoEm: 'não-é-data' } }]));
    assert.equal(await snapshot(), antes);
  });
  await teste('Revisão ausente ou inválida falha fechada antes de gravar dados', async () => {
    const antes = await snapshot();
    for (const valor of [null, {}, '', -1, 0.1]) {
      const r = await ambiente(null, valor).executar(); assert.equal(r.status, 500); assert.match(r.corpo.error,/revisão financeira/i); assert.equal(await snapshot(), antes);
    }
    await assert.rejects(aplicar(null, []));
  });
  await teste('RPC não permite escrever outras coleções ou IDs divergentes', async () => {
    const antes = await snapshot();
    await assert.rejects(aplicar(await revisao(), [{ colecao: 'espelho_acesso', id: 'proibido', registro: { id: 'proibido' } }]));
    await assert.rejects(aplicar(await revisao(), [{ colecao: 'rec', id: 'um', registro: { id: 'outro' } }]));
    assert.equal(await snapshot(), antes);
  });
  await teste('RPCs de revisão e escrita não são públicas', async () => {
    for (const role of ['anon', 'authenticated']) {
      const r = (await banco.query("select has_function_privilege($1,'public.bsq_financeiro_revisao()','execute') as ler,has_function_privilege($1,'public.bsq_omie_aplicar_pagina(bigint,jsonb)','execute') as gravar", [role])).rows[0];
      assert.equal(r.ler, false); assert.equal(r.gravar, false);
    }
  });
  await banco.close(); console.log(`${passaram}/${passaram + falhas} testes de concorrência da conciliação passaram`);
  if (falhas) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
