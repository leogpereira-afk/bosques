/* Guardas de classificação com objetos fictícios e nenhum acesso à rede. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const ts=require(require.resolve('typescript',{paths:[process.env.BSQ_TEST_DEPS||'/tmp/bosques-test-deps']}));
const arquivo=path.resolve(__dirname,'../supabase/functions/_shared/classificacao-vinculo.ts');
const fonte=fs.existsSync(arquivo)?fs.readFileSync(arquivo,'utf8'):'';
const c={exports:{}};vm.runInNewContext(ts.transpileModule(fonte,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,c);const H=c.exports;
const d=tipo=>({tipo,motivo:'Teste fictício conferido',em:'2026-10-29T00:00:00Z',por:'Pessoa de teste',operacao:'op-ficticia'});
test('classificação explícita bloqueia autovínculo também após reabertura',()=>{
  assert.equal(typeof H.vinculoAutomaticoBloqueado,'function');
  for(const tipo of ['sem_venda','pendente'])assert.equal(H.vinculoAutomaticoBloqueado({classificacaoVinculo:d(tipo)}),true);
  assert.equal(H.vinculoAutomaticoBloqueado({obs:'boleto de teste',conferir:false}),false);
});
test('sync conserva decisão, mas atualiza fato bancário sem reassociar a venda',()=>{
  const atual={id:'r-ficticio',valor:100,data:'2026-10-01',classificacaoVinculo:d('sem_venda')};
  const recebido={...atual,valor:120,data:'2026-10-02',vendaId:'v-incorreta',parcelaN:1,alocacoes:[{tid:'t1',valor:120}],conferir:true,obsConferir:'procurar lote'};
  const antes=JSON.stringify({atual,recebido}),r=H.preservarVinculoClassificado(recebido,atual);
  assert.equal(r.valor,120);assert.equal(r.data,'2026-10-02');assert.equal(r.vendaId,'');assert.equal(r.alocacoes.length,0);
  assert.equal(r.parcelaN,null);assert.equal(r.conferir,false);assert.equal(r.obsConferir,'');
  assert.equal(JSON.stringify({atual,recebido}),antes);
});
test('título reaberto prevalece sobre cópia sem venda no recibo e continua pendente manual',()=>{
  const r=H.preservarVinculoClassificado({id:'r-ficticio',valor:100,vendaId:'v-indevida'},
    {classificacaoVinculo:d('sem_venda')},{classificacaoVinculo:d('pendente')});
  assert.equal(r.classificacaoVinculo.tipo,'pendente');assert.equal(r.vendaId,'');assert.equal(r.conferir,true);
  assert.match(r.obsConferir,/manual|conferência/i);
});
test('editor genérico não pode criar, apagar ou falsificar decisão nem reassociar sem venda',()=>{
  assert.ok(H.erroEdicaoClassificacaoVinculo({}, {classificacaoVinculo:d('sem_venda')}));
  const atual={id:'r-ficticio',vendaId:'',alocacoes:[],classificacaoVinculo:d('sem_venda')};
  assert.ok(H.erroEdicaoClassificacaoVinculo(atual,{...atual,classificacaoVinculo:null}));
  assert.ok(H.erroEdicaoClassificacaoVinculo(atual,{...atual,vendaId:'v-indevida'}));
  assert.ok(H.erroEdicaoClassificacaoVinculo(atual,{...atual,alocacoes:[{tid:'t1',valor:100}]}));
  assert.equal(H.erroEdicaoClassificacaoVinculo(atual,{...atual,forma:'PIX',obs:'Comprovante fictício'}),'');
});
