/* Saúde do backup: handler real com leituras fictícias, sem rede/gravação. */
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require((process.env.BSQ_TEST_DEPS || '/tmp/bosques-test-deps') + '/node_modules/typescript');
const acessoReal = require('./carregar-helper-ts.cjs')('acesso');
const fonte = ts.transpileModule(fs.readFileSync('supabase/functions/bsq-nucleo/index.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function ambiente(opts = {}) {
  const leituras = [];
  const rotina = { dia: '2020-01-01', registros: 35, em: '2020-01-01T12:00:00Z' };
  const copia = { dia: '2026-01-02', registros: 42, backupSalvo: true, backupEm: '2026-01-02T12:00:00.000Z' };
  let handler;
  const db = { from(tabela) {
    let chave;
    const q = {
      select(campos) { assert.equal(campos, tabela === 'bsq_backup' ? 'dia, em' : 'valor, atualizado_em'); return q; },
      eq(campo, valor) { assert.equal(campo, 'chave'); chave = valor; return q; },
      order(campo, ordem) { assert.equal(campo, 'dia'); assert.equal(ordem.ascending, false); return q; },
      async maybeSingle() {
        leituras.push(chave);
        assert.ok(['backup_status', 'manutencao_status'].includes(chave));
        return { data: chave === 'backup_status' && opts.legado ? null : { valor: chave === 'backup_status' ? copia : rotina },
          error: opts.erro === chave ? { message: 'Falha de leitura fictícia' } : null };
      },
      async limit(n) { assert.equal(n, 5); leituras.push(tabela); return {
        data: opts.vazio ? [] : [{ dia: copia.dia, em: copia.backupEm }],
        error: opts.erro === tabela ? { message: 'Falha de leitura fictícia' } : null };
      },
    };
    assert.ok(['bsq_meta', 'bsq_backup'].includes(tabela)); return q;
  } };
  const ctx = vm.createContext({ Request, Response, URL, Date, JSON, Map, Set,
    console: { error() {} }, exports: {},
    Deno: { env: { get: () => 'token-ficticio' }, serve(fn) { handler = fn; } },
    require: nome => nome.includes('dados.ts') ? { db, lerCfgBruta: async () => ({}), registrarLog: async () => {} } :
      nome.includes('acesso.ts') ? { ...acessoReal, identificar: async () => opts.semSenha ? null : { perfil: opts.perfil || 'direcao', nome: 'Teste', proprio: true } } :
      nome.includes('cors.ts') ? { preflight: () => null, json: (x, status = 200) => new Response(JSON.stringify(x), { status }) } :
      nome.includes('colecoes.ts') ? { COLECOES: {} } : {},
  });
  vm.runInContext(fonte, ctx);
  return { leituras, rotina, copia, async chamar() {
    const r = await handler(new Request('https://teste.invalid', { method: 'POST', headers: {
      'x-token': opts.tokenRuim ? 'errado' : 'token-ficticio', 'x-senha': 'ficticio' }, body: JSON.stringify({ action: 'saude' }) }));
    return { status: r.status, corpo: await r.json() };
  } };
}
(async () => {
  let testes = 0;
  const a = ambiente(), r = await a.chamar();
  assert.equal(r.status, 200); assert.deepEqual(r.corpo.rotina, a.rotina); assert.deepEqual(r.corpo.backupStatus, a.copia);
  assert.equal(r.corpo.backups[0].em, a.copia.backupEm); assert.equal(a.leituras.length, 3); testes++;
  const antigo = await ambiente({ legado: true }).chamar();
  assert.equal(antigo.corpo.backupStatus, null); assert.equal(antigo.corpo.rotina.registros, 35); testes++;
  const vazio = await ambiente({ vazio: true }).chamar(); assert.deepEqual(vazio.corpo.backups, []); testes++;
  for (const erro of ['backup_status', 'manutencao_status', 'bsq_backup']) {
    const falha = await ambiente({ erro }).chamar(); assert.equal(falha.status, 500); assert.equal(falha.corpo.ok, undefined); testes++;
  }
  for (const opts of [{ semSenha: true }, { perfil: 'escritorio' }, { perfil: 'corretor' }, { tokenRuim: true }]) {
    const bloqueado = ambiente(opts), negado = await bloqueado.chamar();
    assert.ok([401, 403].includes(negado.status)); assert.equal(bloqueado.leituras.length, 0); testes++;
  }
  console.log(`${testes}/${testes} testes: metadados separados, leitura mínima, legado, ausência, erros e permissões.`);
})().catch(e => { console.error(e); process.exitCode = 1; });
