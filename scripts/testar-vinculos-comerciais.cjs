/* Regressões de vínculo comercial. Executa a Edge Function real com o banco
 * substituído por memória; os registros abaixo são inteiramente fictícios. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require((process.env.BSQ_TEST_DEPS || '/tmp/bosques-test-deps') + '/node_modules/typescript');
const raiz = path.resolve(__dirname, '..');
const clone = valor => valor == null ? valor : JSON.parse(JSON.stringify(valor));
const chave = (col, id) => col + '|' + id;
let testes = 0, falhas = 0;

function ambiente(registros) {
  const banco = new Map(registros.map(([col, registro]) => [chave(col, registro.id), clone(registro)]));
  let handler, numero = 0;
  const dados = {
    db:{rpc:async(nome,args)=>{assert.equal(nome,'bsq_gravar_registro_cas');assert.equal(args.p_colecao,'venda');assert.deepEqual(clone(banco.get(chave('venda',args.p_id))||null),clone(args.p_antes));banco.set(chave('venda',args.p_id),clone(args.p_novo));return {data:{ok:true}};}},
    agora: () => '2026-10-21T12:00:00.000Z', idNovo: () => 'novo-' + (++numero), tokenCurto: () => 'token-publico-ficticio',
    lerCfgBruta: async () => ({}),
    lerUm: async (col, id) => clone(banco.get(chave(col, id)) || null),
    gravarUm: async (col, id, registro) => banco.set(chave(col, id), clone(registro)),
    lerColecaoBruta: async (col, campos = 'id, registro', apagado) => [...banco]
      .filter(([k, registro]) => k.startsWith(col + '|') && (apagado === undefined || !!registro.apagadoEm === apagado))
      .map(([, registro]) => campos.includes('registro->>')
        ? Object.fromEntries(campos.split(',').map(campo => {
          const [nome, origem] = campo.trim().split(':');
          return [nome, origem ? registro[origem.replace(/registro->>?/, '')] ?? null : registro[nome]];
        })) : { id: registro.id, registro: clone(registro) }),
    proximoNumero: async () => ++numero, guardarIndiceNumero: async () => {},
    marcarMudanca: async () => {}, registrarLog: async () => {},
  };
  const acesso = { identificar: async () => ({ id: 'gestor-ficticio', perfil: 'direcao', nome: 'Pessoa de teste', proprio: true }),
    podeFazer: () => true, motivoRecusa: () => null, perfilDe: quem => quem.perfil };
  const ctx = vm.createContext({ console, Request, Response, URL, Date, JSON, Map, Set,
    exports: {}, Deno: { env: { get: () => 'token-teste' }, serve: fn => { handler = fn; } },
    require: arquivo =>arquivo.includes('classificacao-vinculo')?require('./carregar-helper-ts.cjs')('classificacao-vinculo'): arquivo.includes('dados') ? dados : arquivo.includes('acesso.ts') ? acesso :
      arquivo.includes('cors') ? { json: (corpo, status = 200) => new Response(JSON.stringify(corpo), { status }), preflight: () => null } :
      arquivo.includes('colecoes') ? { COLECOES: { venda: {}, lote: {}, cliente: {}, rec: {} } } : {},
  });
  const fonte = fs.readFileSync(path.join(raiz, 'supabase/functions/bsq-nucleo/index.ts'), 'utf8');
  vm.runInContext(ts.transpileModule(fonte, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
  const chamar = async corpo => {
    const resposta = await handler(new Request('https://teste.invalid', { method: 'POST',
      headers: { 'x-token': 'token-teste', 'x-senha': 'senha-ficticia' }, body: JSON.stringify(corpo) }));
    return { status: resposta.status, corpo: await resposta.json() };
  };
  const salvar = registro => chamar({ action: 'salvarLote', itens: [{ colecao: 'venda', registro }] });
  return { banco, chamar, salvar, ler: (col, id) => clone(banco.get(chave(col, id))) };
}
const loteA = { id: 'lote-a', quadra: 1, lote: 1, status: 'Vendido', vendaId: 'venda-a' };
const loteB = { id: 'lote-b', quadra: 1, lote: 2, status: 'Disponível', vendaId: null };
const vendaA = { id: 'venda-a', loteId: loteA.id, situacao: 'ativa', clienteId: 'cliente-a', codigo: 'VD-DEMO-A' };
const base = () => [['lote', loteA], ['lote', loteB], ['venda', vendaA]];
async function teste(nome, executar) {
  testes++;
  try { await executar(); console.log('OK ' + nome); }
  catch (erro) { falhas++; console.error('FALHOU ' + nome + ': ' + erro.message); }
}

(async () => {
  await teste('Trocar venda de lote libera o lote anterior e mantém o novo vendido', async () => {
    const a = ambiente(base()); const r = await a.salvar({ id: vendaA.id, loteId: loteB.id });
    assert.equal(r.status, 200); assert.equal(r.corpo.recusados.length, 0);
    assert.equal(a.ler('lote', loteA.id).status, 'Disponível');
    assert.equal(a.ler('lote', loteA.id).vendaId, null);
    assert.equal(a.ler('lote', loteB.id).status, 'Vendido');
    assert.equal(a.ler('lote', loteB.id).vendaId, vendaA.id);
  });
  await teste('Trocar venda preserva a reserva existente no lote anterior', async () => {
    const registros = base(); registros[0][1] = { ...loteA, reservadoPor: { nome: 'Pessoa fictícia' } };
    const a = ambiente(registros); await a.salvar({ id: vendaA.id, loteId: loteB.id });
    assert.equal(a.ler('lote', loteA.id).status, 'Reservado');
    assert.equal(a.ler('lote', loteA.id).reservadoPor.nome, 'Pessoa fictícia');
  });
  for (const situacao of ['ativa', 'conferir', 'quitada']) {
    await teste('Restaurar venda ' + situacao + ' recupera o vínculo e o status vendido', async () => {
      const registros = base(); registros[2][1] = { ...vendaA, situacao };
      const a = ambiente(registros);
      await a.chamar({ action: 'apagar', colecao: 'venda', id: vendaA.id });
      assert.equal(a.ler('lote', loteA.id).status, 'Disponível');
      const r = await a.chamar({ action: 'restaurarItem', colecao: 'venda', id: vendaA.id });
      assert.equal(r.status, 200); assert.ok(!a.ler('venda', vendaA.id).apagadoEm);
      assert.equal(a.ler('lote', loteA.id).status, 'Vendido');
      assert.equal(a.ler('lote', loteA.id).vendaId, vendaA.id);
    });
  }
  await teste('Restaurar venda distratada mantém o lote disponível', async () => {
    const registros = base(); registros[2][1] = { ...vendaA, situacao: 'distratada' };
    const a = ambiente(registros); await a.chamar({ action: 'apagar', colecao: 'venda', id: vendaA.id });
    const r = await a.chamar({ action: 'restaurarItem', colecao: 'venda', id: vendaA.id });
    assert.equal(r.status, 200); assert.equal(a.ler('lote', loteA.id).status, 'Disponível');
  });
  for (const situacao of ['ativa', 'conferir', 'quitada']) {
    await teste('Restauração ' + situacao + ' não ocupa lote que já foi revendido', async () => {
      const a = ambiente(base()); await a.chamar({ action: 'apagar', colecao: 'venda', id: vendaA.id });
      a.banco.set(chave('venda', vendaA.id), { ...a.ler('venda', vendaA.id), situacao });
      await a.salvar({ id: 'venda-nova', loteId: loteA.id, situacao: 'ativa' });
      const r = await a.chamar({ action: 'restaurarItem', colecao: 'venda', id: vendaA.id });
      assert.equal(r.status, 409); assert.ok(a.ler('venda', vendaA.id).apagadoEm);
      assert.equal(a.ler('lote', loteA.id).vendaId, 'venda-nova');
    });
  }
  await teste('Venda quitada nova não ocupa lote com venda viva', async () => {
    const a = ambiente(base()); const r = await a.salvar({ id: 'venda-quitada', loteId: loteA.id, situacao: 'quitada' });
    assert.equal(r.corpo.recusados.length, 1); assert.equal(r.corpo.salvos.length, 0);
    assert.equal(a.ler('venda', 'venda-quitada'), undefined);
    assert.equal(a.ler('lote', loteA.id).vendaId, vendaA.id);
  });
  await teste('Atualizar a própria venda quitada continua permitido', async () => {
    const registros = base(); registros[2][1] = { ...vendaA, situacao: 'quitada' };
    const a = ambiente(registros); const r = await a.salvar({ id: vendaA.id, obs: 'Conferência fictícia' });
    assert.equal(r.corpo.recusados.length, 0); assert.equal(a.ler('venda', vendaA.id).obs, 'Conferência fictícia');
  });
  await teste('Venda quitada exige lote existente', async () => {
    const a = ambiente(base()); const r = await a.salvar({ id: 'venda-solta', loteId: 'lote-inexistente', situacao: 'quitada' });
    assert.equal(r.corpo.recusados.length, 1); assert.equal(a.ler('venda', 'venda-solta'), undefined);
  });
  await teste('Restauração recusa colisão mesmo quando o lote perdeu o ponteiro da outra venda', async () => {
    const registros = base(); registros[0][1] = { ...loteA, status: 'Disponível', vendaId: null };
    registros.push(['venda', { id: 'venda-antiga', loteId: loteA.id, situacao: 'quitada', apagadoEm: '2026-10-20' }]);
    const a = ambiente(registros); const r = await a.chamar({ action: 'restaurarItem', colecao: 'venda', id: 'venda-antiga' });
    assert.equal(r.status, 409); assert.ok(a.ler('venda', 'venda-antiga').apagadoEm);
  });
  await teste('Detector de duplicidade inclui quitadas e exclui distratadas e apagadas', () => {
    const ctx = vm.createContext({ TELAS: {}, S: {}, document: {}, console });
    vm.runInContext(fs.readFileSync(path.join(raiz, 'financeiro-core.js'), 'utf8'), ctx);
    vm.runInContext(fs.readFileSync(path.join(raiz, 'vendas.js'), 'utf8'), ctx);
    ctx.registros = [vendaA, { ...vendaA, id: 'quitada', situacao: 'quitada' },
      { id: 'quitada-b1', loteId: loteB.id, situacao: 'quitada' }, { id: 'quitada-b2', loteId: loteB.id, situacao: 'quitada' },
      { ...vendaA, id: 'distratada', situacao: 'distratada' }, { ...vendaA, id: 'apagada', apagadoEm: '2026-10-20' }];
    vm.runInContext('lista=()=>registros.filter(r=>!r.apagadoEm)', ctx);
    const resultado = JSON.parse(vm.runInContext('JSON.stringify(lotesDuplicados())', ctx));
    assert.deepEqual(resultado.map(([id, vendas]) => [id, vendas.map(v => v.id)]),
      [['lote-a', ['venda-a', 'quitada']], ['lote-b', ['quitada-b1', 'quitada-b2']]]);
  });
  console.log(`${testes - falhas}/${testes} testes de vínculos comerciais passaram`);
  if (falhas) process.exitCode = 1;
})().catch(erro => { console.error(erro); process.exitCode = 1; });
