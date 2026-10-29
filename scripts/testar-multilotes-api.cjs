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

function ambiente(registros, perfil="direcao") {
  const banco = new Map(registros.map(([col, registro]) => [chave(col, registro.id), clone(registro)]));
  let handler, numero = 0; const chamadas=[];
  const dados = {
    db:{rpc:async(nome,args)=>{chamadas.push({nome,args});if(nome==="bsq_gravar_registro_cas"){const atual=clone(banco.get(chave(args.p_colecao,args.p_id))||null);if(JSON.stringify(atual)!==JSON.stringify(args.p_antes))return {error:{code:"40001",message:"Atualize a ficha"}};banco.set(chave(args.p_colecao,args.p_id),clone(args.p_novo));}return {data:{ok:true,colecoes:["venda","lote","rec","titulo"]}}}},
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
  const acesso = { identificar: async () => ({ id: 'gestor-ficticio', perfil, nome: 'Pessoa de teste', proprio: true }),
    podeFazer: () => true, motivoRecusa: () => null, perfilDe: quem => quem.perfil };
  const ctx = vm.createContext({ console, Request, Response, URL, Date, JSON, Map, Set,
    exports: {}, Deno: { env: { get: () => 'token-teste' }, serve: fn => { handler = fn; } },
    require: arquivo => arquivo.includes('classificacao-vinculo') ? carregarShared('classificacao-vinculo') : arquivo.includes('dados') ? dados : arquivo.includes('acesso.ts') ? acesso :
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
  return { chamadas, banco, chamar, salvar, ler: (col, id) => clone(banco.get(chave(col, id))) };
}

function carregarShared(nome){const c={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(raiz,'supabase/functions/_shared',nome+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,c);return c.exports;}
const base=()=>[['lote',{id:'l1',vendaId:'v1',status:'Vendido'}],['lote',{id:'l2',vendaId:'v1',status:'Vendido'}],['venda',{id:'v1',atualizadoEm:'2026-10-29T10:00:00.000Z',agrupamento:{operacao:'grupo-ficticio'},entrada:500,loteId:'l1',loteIds:['l1','l2'],lotes:[{loteId:'l1'},{loteId:'l2'}],clienteId:'111',situacao:'ativa',parcelas:[{tid:'t1',valor:100}]}],['venda',{id:'v2',loteId:'l2',clienteId:'111',situacao:'ativa',incorporadaEmVendaId:'v1',parcelas:[{tid:'t1',valor:100}]}]];
async function teste(nome,fn){testes++;try{await fn();console.log('OK '+nome);}catch(e){falhas++;console.error('FALHOU '+nome+': '+e.message);}}
(async()=>{
 await teste('agruparContratos chama RPC única com payload e autor autenticado',async()=>{const a=ambiente(base());const p={action:'agruparContratos',principal:'v1',vendas:['v1'],recebimentos:['r1'],titulos:['t1'],motivo:'Documento fictício',politica:'origem',operacao:'ficticia-001',esperado:{},plano:{entrada:0},confirmarPlanoPrincipal:true};const r=await a.chamar(p);assert.equal(r.status,200);assert.equal(a.chamadas.length,1);assert.equal(a.chamadas[0].nome,'bsq_agrupar_contratos');assert.deepEqual(a.chamadas[0].args.p_pedido,p);assert.equal(a.chamadas[0].args.p_por,'Pessoa de teste');});
 await teste('classificarEntrada usa RPC auditável própria',async()=>{const a=ambiente(base());const r=await a.chamar({action:'classificarEntrada',id:'r1',tipo:'sem_venda',motivo:'Documento fictício'});assert.equal(r.status,200);assert.equal(a.chamadas[0].nome,'bsq_classificar_entrada');});
 for(const action of ['agruparContratos','classificarEntrada'])await teste(action+' recusa corretor antes de RPC',async()=>{const a=ambiente(base(),'corretor');assert.equal((await a.chamar({action})).status,403);assert.equal(a.chamadas.length,0);});
 await teste('atualizar principal conserva todos os lotes vendidos e alias intacta',async()=>{const a=ambiente(base());const antes=a.ler('venda','v2');assert.equal((await a.salvar({...a.ler('venda','v1'),atualizadoEm:'2026-10-29T10:15:00.000Z',obs:'Conferido'})).corpo.recusados.length,0);assert.equal(a.ler('lote','l2').vendaId,'v1');assert.deepEqual(a.ler('venda','v2'),antes);});
 await teste('nova venda não apropria lote secundário mesmo sem ponteiro',async()=>{const a=ambiente(base());a.banco.set('lote|l2',{id:'l2',status:'Disponível'});a.banco.delete('venda|v2');const r=await a.salvar({id:'nova',loteId:'l2',clienteId:'222'});assert.equal(r.corpo.recusados.length,1);});
 await teste('distrato do principal libera todos os lotes sem alias ressuscitar estoque',async()=>{const a=ambiente(base());await a.salvar({...a.ler('venda','v1'),situacao:'distratada'});for(const id of ['l1','l2'])assert.equal(a.ler('lote',id).status,'Disponível');});
 await teste('editor genérico não pode fabricar agrupamento',async()=>{const a=ambiente(base());for(const registro of [{id:'v1',loteIds:['l1']},{id:'v1',lotes:[]},{id:'v1',incorporadaEmVendaId:'outro'},{id:'v1',loteId:'l2'}])assert.equal((await a.salvar(registro)).corpo.recusados.length,1);});
 await teste('payload offline anterior ao grupo não regrava plano ou parcela manual antigos',async()=>{const a=ambiente(base());a.banco.get('venda|v1').parcelas.push({id:'manual-nova',valor:50,venc:'2027-01-01'});const antes=a.ler('venda','v1');const velho={id:'v1',loteId:'l1',clienteId:'111',situacao:'ativa',atualizadoEm:'2026-10-01T00:00:00Z',entrada:20,qtdeParcelas:2,valorParcela:10,parcelas:[{tid:'t1',valor:100}]};const r=await a.salvar(velho);assert.equal(r.corpo.recusados.length,1);assert.deepEqual(a.ler('venda','v1'),antes);});
 await teste('edição de outra geração do agrupamento exige releitura',async()=>{const a=ambiente(base());const antes=a.ler('venda','v1');const r=await a.salvar({...antes,agrupamento:{operacao:'grupo-anterior'},entrada:20});assert.equal(r.corpo.recusados.length,1);assert.deepEqual(a.ler('venda','v1'),antes);});
 await teste('editor não muda cadastro incorporado ou o apaga isoladamente',async()=>{const a=ambiente(base());const antes=a.ler('venda','v2');assert.equal((await a.salvar({id:'v2',obs:'alterar'})).corpo.recusados.length,1);assert.equal((await a.chamar({action:'apagar',colecao:'venda',id:'v2'})).status,409);assert.deepEqual(a.ler('venda','v2'),antes);});
 await teste('recebimento novo só aceita contrato principal',async()=>{const a=ambiente(base());const r=await a.chamar({action:'salvarLote',itens:[{colecao:'rec',registro:{id:'novo',vendaId:'v2',valor:100}}]});assert.equal(r.corpo.recusados.length,1);});
 await teste('editor não pode inventar ou apagar classificação humana',async()=>{const a=ambiente(base());a.banco.set('rec|r1',{id:'r1',valor:100,vendaId:'',classificacaoVinculo:{tipo:'sem_venda'}});for(const registro of [{id:'r1',classificacaoVinculo:null},{id:'r1',vendaId:'v1'}]){const r=await a.chamar({action:'salvarLote',itens:[{colecao:'rec',registro}]});assert.equal(r.corpo.recusados.length,1);}});
 await teste('vínculo legado recusa sem venda e destino incorporado',async()=>{const a=ambiente(base());a.banco.set('rec|r1',{id:'r1',valor:100,vendaId:'',classificacaoVinculo:{tipo:'sem_venda'}});assert.equal((await a.chamar({action:'vincularRecebimento',id:'r1',vendaId:'v1',motivo:'Fictício'})).status,400);a.banco.set('rec|r1',{id:'r1',valor:100,vendaId:''});assert.equal((await a.chamar({action:'vincularRecebimento',id:'r1',vendaId:'v2',motivo:'Fictício'})).status,400);});
 await teste('edição comum de rec usa escrita CAS sem alterar valor ou destino',async()=>{const a=ambiente(base());a.banco.set('rec|r1',{id:'r1',valor:100,vendaId:'v1',data:'2026-10-01'});const r=await a.chamar({action:'salvarLote',itens:[{colecao:'rec',registro:{id:'r1',forma:'PIX'}}]});assert.equal(r.corpo.recusados.length,0);assert.ok(a.chamadas.some(c=>c.nome==='bsq_gravar_registro_cas'&&c.args.p_colecao==='rec'));assert.equal(a.ler('rec','r1').vendaId,'v1');assert.equal(a.ler('rec','r1').valor,100);});
 await teste('editarTitulo usa CAS e preserva decisão de classificação',async()=>{const a=ambiente(base());a.banco.set('titulo|t1',{id:'t1',valor:100,venc:'2026-12-01',classificacaoVinculo:{tipo:'sem_venda'}});const r=await a.chamar({action:'editarTitulo',id:'t1',valor:100,venc:'2026-12-02',motivo:'Documento fictício'});assert.equal(r.status,200);assert.ok(a.chamadas.some(c=>c.nome==='bsq_gravar_registro_cas'&&c.args.p_colecao==='titulo'));assert.equal(a.ler('titulo','t1').classificacaoVinculo.tipo,'sem_venda');});
 console.log((testes-falhas)+' passaram; '+falhas+' falharam');if(falhas)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
