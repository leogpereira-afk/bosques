// Exercita o diagnóstico usado pela sincronização, com dados fictícios e sem rede.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const raiz=path.resolve(__dirname,'..');
const fonte=fs.readFileSync(path.join(raiz,'supabase/functions/bsq-omie/index.ts'),'utf8');
const classificacao=fs.readFileSync(path.join(raiz,'supabase/functions/_shared/classificacao-vinculo.ts'),'utf8');
const inicio=fonte.indexOf('function observacaoRecebimentoSemVinculo(');
const helper=inicio<0?'':fonte.slice(inicio,fonte.indexOf('\n}',inicio)+2);
const atribuicao=fonte.match(/if \(!vendaId\) registro\.obsConferir = [^\n]+;/)?.[0];
assert.ok(atribuicao,'O teste precisa executar o diagnóstico real usado na sincronização');
const trecho=classificacao+'\n'+helper+'\n'+`
exports.diagnosticar=function(existente,minhas,vendaId='',titulo=null){
  let registro={...existente,vendaId};
  ${atribuicao}
  return preservarVinculoClassificado(registro,existente,titulo);
};`;
const ctx={exports:{}};
vm.runInNewContext(stripTypeScriptTypes(trecho.replace(/^export /gm,'')),ctx);
const diagnosticar=ctx.exports.diagnosticar;
const recebido=extra=>({id:'rbomie-101',valor:100,data:'2026-01-02',conferir:true,vendaId:'',omie:{titulo:101},historico:[{acao:'Importado'}],...extra});

test('nenhuma ficha informa ausência de venda ativa e orienta conferir cadastro',()=>{
  const r=diagnosticar(recebido(),[]);
  assert.match(r.obsConferir,/nenhuma ficha de venda ativa/i);
  assert.match(r.obsConferir,/cadastro/i);
  assert.equal(r.vendaId,'');
});
test('mais de uma ficha não é apresentada como cliente sem venda',()=>{
  const r=diagnosticar(recebido(),[{id:'v1'},{id:'v2'}]);
  assert.match(r.obsConferir,/mais de uma ficha/i);
  assert.match(r.obsConferir,/lotes|documento/i);
  assert.doesNotMatch(r.obsConferir,/não achei|nenhuma ficha/i);
  assert.equal(r.vendaId,'');
});
test('uma ficha com título ainda sem vínculo pede conferir o documento',()=>{
  const r=diagnosticar(recebido(),[{id:'v1'}]);
  assert.match(r.obsConferir,/uma ficha/i);
  assert.match(r.obsConferir,/título.*vínculo/i);
  assert.match(r.obsConferir,/documento/i);
  assert.equal(r.vendaId,'');
});
test('observação humana permanece literal mesmo com mudança de fichas',()=>{
  const nota='Conferido com a equipe: aguardar documento do lote.';
  for(const minhas of [[],[{id:'v1'}],[{id:'v1'},{id:'v2'}]]){
    assert.equal(diagnosticar(recebido({obsConferir:nota}),minhas).obsConferir,nota);
  }
});
test('diagnóstico legado e diagnóstico automático anterior acompanham a situação atual',()=>{
  const antigo=recebido({obsConferir:'não achei a venda deste CPF — vincular à mão'});
  const dois=diagnosticar(antigo,[{id:'v1'},{id:'v2'}]);
  assert.match(dois.obsConferir,/mais de uma ficha/i);
  const um=diagnosticar(dois,[{id:'v1'}]);
  assert.match(um.obsConferir,/título.*vínculo/i);
  const nenhum=diagnosticar(um,[]);
  assert.match(nenhum.obsConferir,/nenhuma ficha de venda ativa/i);
});
test('classificação sem venda permanece resolvida e não ganha mensagem automática',()=>{
  const classificacaoVinculo={tipo:'sem_venda',motivo:'Caso fictício confirmado'};
  const r=diagnosticar(recebido({classificacaoVinculo,conferir:false}),[{id:'v1'}]);
  assert.equal(r.classificacaoVinculo.motivo,classificacaoVinculo.motivo);
  assert.equal(r.conferir,false);
  assert.equal(r.obsConferir,'');
  assert.equal(r.vendaId,'');
});
test('classificação reaberta no título prevalece e continua exigindo conferência humana',()=>{
  const r=diagnosticar(recebido({classificacaoVinculo:{tipo:'sem_venda'}}),[{id:'v1'}],'',
    {classificacaoVinculo:{tipo:'pendente',motivo:'Revisão fictícia'}});
  assert.equal(r.classificacaoVinculo.tipo,'pendente');
  assert.equal(r.conferir,true);
  assert.match(r.obsConferir,/reaberta.*manual/i);
  assert.equal(r.vendaId,'');
});
test('diagnóstico não muda valores, datas, alocações, histórico ou objetos de entrada',()=>{
  const r=recebido({alocacoes:[],obsConferir:'não achei a venda deste CPF — vincular à mão'});
  const minhas=[{id:'v1',parcelas:[{tid:202,valor:100}]}];
  const antes=JSON.stringify({r,minhas});
  const depois=diagnosticar(r,minhas);
  assert.equal(JSON.stringify({r,minhas}),antes);
  assert.equal(depois.valor,100);
  assert.equal(depois.data,'2026-01-02');
  assert.equal(JSON.stringify(depois.historico),JSON.stringify(r.historico));
  assert.equal(JSON.stringify(depois.alocacoes),'[]');
  assert.equal(depois.conferir,true);
});
