/* Handler real da rotina, com dados inteiramente fictícios e banco em memória.
 * Nenhuma chamada de rede ou exclusão produtiva é permitida neste teste. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require((process.env.BSQ_TEST_DEPS || '/tmp/bosques-test-deps') + '/node_modules/typescript');
const fonte = fs.readFileSync(path.join(__dirname, '../supabase/functions/bsq-rotina/index.ts'), 'utf8');
const compilado = ts.transpileModule(fonte, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
let passaram = 0, falhas = 0;

function ambiente(opcoes = {}) {
  const backups = new Map(), metas = new Map(), logs = [];
  const chamadas = { gravarBackup: 0, lerTudo: 0, lerApagados: 0, exclusoes: 0, pausas: [] };
  const falhasBackup = [...(opcoes.falhasBackup || [])];
  const falhasLeitura = [...(opcoes.falhasLeitura || [])];
  let handler;
  const dados = {
    agora: () => '2026-10-21T12:00:00.000Z',
    lerTudo: async () => {
      chamadas.lerTudo++;
      if (falhasLeitura.length) throw falhasLeitura.shift();
      return [{ id: 'venda-ficticia', _col: 'venda' }];
    },
    lerCfgBruta: async () => ({ empresa: { nome: 'Empresa de teste' }, senhaHash: 'nao-copiar' }),
    lerNumeracao: async () => ({ venda: 1 }),
    lerColecaoBruta: async () => [{ id: 'arquivo-orfao-ficticio', registro: { partes: 1, criadoEm: '2000-01-01' } }],
    gravarBackup: async (dia, conteudo) => {
      chamadas.gravarBackup++;
      if (falhasBackup.length) throw falhasBackup.shift();
      backups.set(dia, JSON.parse(JSON.stringify(conteudo)));
    },
    lerApagados: async () => {
      chamadas.lerApagados++;
      return [{ id: 'registro-apagado-ficticio', colecao: 'rec', registro: { apagadoEm: '2000-01-01' } }];
    },
    lerUm: async () => ({ partes: 1 }),
    apagarArquivo: async () => { chamadas.exclusoes++; },
    apagarDeVez: async () => { chamadas.exclusoes++; },
    gravarUm: async () => {},
    registrarLog: async x => { logs.push(JSON.parse(JSON.stringify(x))); },
    db: { from: tabela => ({
      delete: () => {
        chamadas.exclusoes++;
        return { lt: () => ({ select: async () => ({ data: [], error: opcoes.erroLimpeza || null }) }) };
      },
      upsert: async registro => {
        if (opcoes.erroHeartbeat) return { error: opcoes.erroHeartbeat };
        metas.set(registro.chave, JSON.parse(JSON.stringify(registro.valor)));
        return { error: null };
      },
    }) },
  };
  const ctx = vm.createContext({ Request, Response, URL, Date, JSON, Map, Set, Error,
    exports: {}, console: { log() {} },
    setTimeout: (fn, ms) => { chamadas.pausas.push(ms); fn(); },
    Deno: { env: { get: () => opcoes.semSegredo ? undefined : 'segredo-ficticio' }, serve: fn => { handler = fn; } },
    require: arquivo => arquivo.includes('dados.ts') ? dados :
      arquivo.includes('cors.ts') ? { json: (corpo, status = 200) => new Response(JSON.stringify(corpo), { status }) } :
      arquivo.includes('colecoes.ts') ? { NOMES_COLECOES: ['venda', 'rec'] } :
      arquivo.includes('acesso.ts') ? { cfgSemSegredo: cfg => ({ empresa: cfg.empresa }) } :
      arquivo.includes('arquivos.ts') ? { arquivosDoRegistro: () => [] } :
      arquivo.includes('lixeira.ts') ? { precisaLapide: () => false, lapideDe: x => x } : {},
  });
  vm.runInContext(compilado, ctx);
  async function chamar(corpo = {}, token = 'segredo-ficticio') {
    const resposta = await handler(new Request('https://teste.invalid/bsq-rotina', { method: 'POST',
      headers: { 'x-rotina-token': token }, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) }));
    return { status: resposta.status, corpo: await resposta.json() };
  }
  return { chamar, backups, metas, logs, chamadas };
}
async function teste(nome, fn) {
  try { await fn(); passaram++; console.log('OK ' + nome); }
  catch (e) { falhas++; console.error('FALHOU ' + nome + ': ' + e.message); }
}

(async () => {
  await teste('520 transitório repete o backup e só depois executa as limpezas uma vez', async () => {
    const a = ambiente({ falhasBackup: [new Error('backup: <title>supabase.co | 520: Web server is returning an unknown error</title>')] });
    const r = await a.chamar();
    assert.equal(r.status, 200); assert.equal(r.corpo.ok, true);
    assert.equal(a.chamadas.gravarBackup, 2); assert.equal(r.corpo.backupTentativas, 2);
    assert.equal(a.backups.size, 1); assert.equal(a.chamadas.lerApagados, 1);
    assert.equal(a.chamadas.exclusoes, 5);
  });
  await teste('Falha transitória na leitura também repete a cópia completa', async () => {
    const a = ambiente({ falhasLeitura: [new Error('TypeError: fetch failed')] });
    const r = await a.chamar({ somenteBackup: true });
    assert.equal(r.status, 200); assert.equal(a.chamadas.lerTudo, 2);
    assert.equal(a.chamadas.gravarBackup, 1); assert.equal(r.corpo.backupTentativas, 2);
  });
  await teste('Erro permanente aborta sem limpar ou declarar sucesso', async () => {
    const a = ambiente({ falhasBackup: [new Error('backup: permission denied for table bsq_backup')] });
    const r = await a.chamar();
    assert.equal(r.status, 503); assert.equal(r.corpo.ok, false);
    assert.equal(a.chamadas.gravarBackup, 1); assert.equal(a.chamadas.exclusoes, 0);
    assert.equal(a.chamadas.lerApagados, 0); assert.equal(a.backups.size, 0);
    assert.ok(a.metas.get('manutencao_status').erroBackup);
    assert.equal(a.metas.get('manutencao_status').limpezasIgnoradas, true);
    assert.equal(a.logs[0].ok, false);
  });
  await teste('No máximo três tentativas e nenhuma limpeza quando os 503 persistem', async () => {
    const a = ambiente({ falhasBackup: Array.from({ length: 4 }, () => new Error('HTTP 503 Service Unavailable')) });
    const r = await a.chamar();
    assert.equal(r.status, 503); assert.equal(a.chamadas.gravarBackup, 3);
    assert.equal(a.chamadas.exclusoes, 0); assert.equal(a.chamadas.pausas.length, 2);
  });
  await teste('Somente backup não chama exclusões, lixeira nem varredura de órfãos', async () => {
    const a = ambiente(); const r = await a.chamar({ somenteBackup: true });
    assert.equal(r.status, 200); assert.equal(r.corpo.ok, true);
    assert.equal(r.corpo.somenteBackup, true); assert.equal(r.corpo.backupSalvo, true);
    assert.equal(a.chamadas.exclusoes, 0); assert.equal(a.chamadas.lerApagados, 0);
    assert.equal(a.chamadas.lerTudo, 1);
    assert.ok(a.metas.has('backup_status')); assert.equal(a.metas.has('manutencao_status'), false);
    assert.equal(a.backups.get('2026-10-21').cfg.senhaHash, undefined);
  });
  await teste('Recuperar o mesmo dia novamente mantém apenas uma cópia diária', async () => {
    const a = ambiente(); await a.chamar({ somenteBackup: true }); await a.chamar({ somenteBackup: true });
    assert.equal(a.backups.size, 1); assert.equal(a.chamadas.exclusoes, 0);
  });
  await teste('Heartbeat recusado não devolve sucesso mesmo após salvar o backup', async () => {
    const a = ambiente({ erroHeartbeat: { message: 'Sem conexão para registrar status' } });
    const r = await a.chamar({ somenteBackup: true });
    assert.equal(r.status, 503); assert.equal(r.corpo.ok, false);
    assert.equal(r.corpo.backupSalvo, true); assert.match(r.corpo.erroStatus, /Sem conexão/);
    assert.equal(a.backups.size, 1); assert.equal(a.chamadas.exclusoes, 0);
  });
  await teste('Falha de limpeza não é repetida nem ocultada pelo heartbeat', async () => {
    const a = ambiente({ erroLimpeza: { message: 'HTTP 503 na limpeza fictícia' } });
    const r = await a.chamar();
    assert.equal(r.status, 503); assert.equal(r.corpo.ok, false);
    assert.equal(a.chamadas.gravarBackup, 1); assert.equal(a.chamadas.lerApagados, 1);
    assert.equal(a.chamadas.exclusoes, 5); assert.ok(r.corpo.erroLimpezaBackup); assert.ok(r.corpo.erroLimpezaLog);
  });
  await teste('Autorização continua obrigatória inclusive no modo somente backup', async () => {
    const a = ambiente(); const r = await a.chamar({ somenteBackup: true }, 'errado');
    assert.equal(r.status, 401); assert.equal(a.chamadas.gravarBackup, 0); assert.equal(a.chamadas.exclusoes, 0);
  });
  await teste('Sem segredo configurado não executa a rotina', async () => {
    const a = ambiente({ semSegredo: true }); const r = await a.chamar({ somenteBackup: true });
    assert.equal(r.status, 401); assert.equal(a.backups.size, 0);
  });
  await teste('Corpo inválido é recusado antes de qualquer operação', async () => {
    const a = ambiente(); const r = await a.chamar('{');
    assert.equal(r.status, 400); assert.equal(a.chamadas.gravarBackup, 0); assert.equal(a.chamadas.exclusoes, 0);
  });
  await teste('Modo somente backup com tipo errado não pode executar limpezas por engano', async () => {
    const a = ambiente(); const r = await a.chamar({ somenteBackup: 'true' });
    assert.equal(r.status, 400); assert.equal(a.chamadas.gravarBackup, 0); assert.equal(a.chamadas.exclusoes, 0);
  });
  console.log(`${passaram}/${passaram + falhas} regressões da rotina segura passaram`);
  if (falhas) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
