// Carrega helpers puros reais nos testes da Edge Function, sem rede nem Deno.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require((process.env.BSQ_TEST_DEPS||'/tmp/bosques-test-deps')+'/node_modules/typescript');
const cache=new Map();
module.exports=nome=>{
  if(!/^[a-z0-9-]+$/.test(nome))throw Error('Nome de helper inválido');
  if(!cache.has(nome)){
    const c={exports:{}};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../supabase/functions/_shared',nome+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,c);
    cache.set(nome,c.exports);
  }
  return cache.get(nome);
};
