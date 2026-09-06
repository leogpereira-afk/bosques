const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const {indexedDB}=require(process.env.BSQ_TEST_DEPS+'/node_modules/fake-indexeddb');
const storage=new Map();const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
function sessao(){const c=vm.createContext({indexedDB,structuredClone,localStorage,navigator:{onLine:false},window:{addEventListener(){}},document:{addEventListener(){},dispatchEvent(){}},CustomEvent:class{},setInterval(){},console,API:'https://teste.invalid'});vm.runInContext(fs.readFileSync('store.js','utf8'),c);return c;}
const run=(c,s)=>vm.runInContext(s,c);
(async()=>{
localStorage.setItem('bsq_senha','sessao');localStorage.setItem('bsq_perfil','direcao');
const a=sessao();run(a,"lerCache(); S.reg.titulo=Array.from({length:13000},(_,i)=>({id:'t'+i,valor:i}));S.reg.movbanco=[{id:'b1',valor:500}];S.reg.venda=[{id:'v1',valor:100}];S.cacheCompleto=true;S.ultimoPull=Date.now();");await run(a,'gravarCache()');
const b=sessao();run(b,'lerCache()');await run(b,'carregarCacheCompleto()');assert.equal(run(b,'S.reg.titulo.length'),13000);assert.equal(run(b,'S.reg.movbanco[0].valor'),500);assert.equal(run(b,'S.cacheCompleto'),true);
run(b,'var pulls=0;puxar=()=>pulls++;puxarSeNecessario();');assert.equal(run(b,'pulls'),0);run(b,'S.ultimoPull=Date.now()-360001;puxarSeNecessario();');assert.equal(run(b,'pulls'),1);
const c=sessao();run(c,"lerCache();S.fila=[{colecao:'venda',registro:{id:'v1',valor:999}}]");await run(c,'carregarCacheCompleto()');assert.equal(run(c,'S.reg.venda[0].valor'),999);
const outro=sessao();run(outro,"lerCache();S.usuarioId='outro';S.reg=regVazio();");await run(outro,'carregarCacheCompleto()');assert.equal(run(outro,'S.reg.titulo.length'),0);
await run(c,'limparCacheCompleto()');const d=sessao();run(d,'lerCache();S.reg=regVazio();');await run(d,'carregarCacheCompleto()');assert.equal(run(d,'S.reg.titulo.length'),0);
console.log('PASSOU: 13 mil títulos e movimentos persistem ao reabrir; fila prevalece; cache recente evita download; cache antigo atualiza; usuário diferente não reutiliza dados; sair limpa a base.');
})().catch(e=>{console.error(e);process.exit(1)});
