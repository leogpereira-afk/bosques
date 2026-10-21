const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
(async()=>{
const {parseHTML}=await import((process.env.BSQ_TEST_DEPS||'/tmp/bosques-test-deps')+'/node_modules/linkedom/esm/index.js');
const {document}=parseHTML('<html><body><div id="casca"><aside id="lateral"></aside><header id="topo"></header><main id="app"></main></div></body></html>');
const mem=new Map([['outro_sistema','preservar']]);
const localStorage={getItem:k=>mem.get(k)||null,setItem:(k,v)=>mem.set(k,String(v)),removeItem:k=>mem.delete(k),clear:()=>mem.clear(),get length(){return mem.size},key:i=>[...mem.keys()][i]};
let recarregou=0;const window={addEventListener(){},scrollTo(){},matchMedia:()=>({matches:false})};
const ctx=vm.createContext({window,document,localStorage,navigator:{onLine:false},location:{hash:'#/home',reload(){recarregou++}},console,URL,Blob,TextEncoder,TextDecoder,CustomEvent:document.defaultView.CustomEvent,Event:document.defaultView.Event,setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},fetch:async()=>{throw Error('Teste não deve acessar rede')},crypto:require('node:crypto').webcrypto,Intl});
for(const f of ['config.js','ui.js','mapa-espelho.js','store.js','carne.js','financeiro-core.js','pdf.js','espelho.js','vendas.js','caixa.js','cadastros.js','cronograma.js','omie.js','financeiro.js','financeiro-gestao.js','financeiro-painel.js','contratos.js','apresentacao.js','app.js']){let s=fs.readFileSync(f,'utf8');if(f==='app.js')s=s.slice(0,s.indexOf('(async function iniciar()'));vm.runInContext(s,ctx,{filename:f});}
const run=s=>vm.runInContext(s,ctx);
const arquivos=vm.runInNewContext(fs.readFileSync('sw.js','utf8')+';ARQUIVOS',{self:{addEventListener(){}}});assert.ok(arquivos.includes('modernizacao.css'));for(const nome of fs.readdirSync('icons/3d'))assert.ok(arquivos.includes('icons/3d/'+nome),'Ícone deve estar disponível no cache offline');for(const arquivo of arquivos)assert.ok(fs.existsSync(arquivo),'Asset do cache ausente: '+arquivo);
run("S.cfg={formasPg:['PIX'],categoriasDespesa:[],categoriasReceita:[]};S.senhaHash='teste';S.perfil='direcao';S.quem='Equipe teste';S.cacheCompleto=true;S.reg=regVazio();S.reg.lote=[{id:'l1',quadra:1,lote:1,status:'Disponível',areaM2:250}];statusOmieHome=()=>{};vigiarSaudeOmie=()=>{};");
run('render()');
assert.ok(document.querySelector('.home-hero'),'Entrada deve orientar o próximo passo');
assert.equal(document.querySelectorAll('.home-atalho').length,4,'Atalhos principais disponíveis');
assert.ok(document.querySelector('#menu img.icone-3d'),'Ícones 3D no menu');
assert.ok([...document.querySelectorAll('.home-atalho')].every(e=>e.tagName==='A'&&e.getAttribute('href')),'Atalhos navegam semanticamente');
// Um registro clicável deve abrir também por teclado.
document.querySelector('#app').innerHTML='<div class="lin" data-id="registro-exemplo">Abrir registro</div>';
let abriu=0;const linha=document.querySelector('[data-id]');linha.onclick=()=>abriu++;
run('ligarAcessibilidadeTela()');assert.equal(linha.getAttribute('role'),'button');assert.equal(linha.getAttribute('tabindex'),'0');
linha.dispatchEvent(Object.assign(new document.defaultView.Event('keydown',{bubbles:true}),{key:'Enter'}));assert.equal(abriu,1);
// O autocomplete permite escolher um cliente existente sem mouse.
document.querySelector('#app').innerHTML='<label>Cliente</label><input id="cli-busca"><div id="cli-sugestoes" style="display:block"><div class="ac-item" data-id="c1">Cliente Exemplo</div></div>';
let escolheu=0;document.querySelector('.ac-item').addEventListener('mousedown',()=>escolheu++);
run('ligarAcessibilidadeTela()');const busca=document.querySelector('#cli-busca');
busca.dispatchEvent(Object.assign(new document.defaultView.Event('keydown',{bubbles:true,cancelable:true}),{key:'ArrowDown'}));
busca.dispatchEvent(Object.assign(new document.defaultView.Event('keydown',{bubbles:true,cancelable:true}),{key:'Enter'}));
assert.equal(escolheu,1);assert.equal(busca.getAttribute('role'),'combobox');
// Uma atualização em segundo plano não pode apagar um campo em edição.
document.querySelector('#app').innerHTML='<label>Rascunho<input id="editando" value="original"></label>';
const campo=document.querySelector('#editando');campo.value='alteração ainda não salva';campo.dispatchEvent(new document.defaultView.Event('input',{bubbles:true}));
document.dispatchEvent(new document.defaultView.CustomEvent('bsq:dados'));
assert.equal(document.querySelector('#editando')?.value,'alteração ainda não salva');
assert.ok(document.querySelector('#atualizacao-pendente'),'Dados novos precisam de aviso sem apagar o formulário');
// Sair com pendências mantém a sessão e a fila, mesmo havendo confirmação genérica.
run("S.fila=[{colecao:'prop',registro:{id:'pendente'},seq:1}];confirmar=async()=>true;renderLateral()");
await document.querySelector('#bt-sair').onclick();
assert.equal(recarregou,0,'Não sair com registros ainda não enviados');
assert.equal(run('S.fila.length'),1);
// Sem pendências limpa apenas Bosques e não o resto da origem.
run("S.fila=[];limparCacheCompleto=async()=>{};localStorage.setItem(K.senha,'teste');localStorage.setItem(K.cache,'cache');");
await document.querySelector('#bt-sair').onclick();
assert.equal(recarregou,1);assert.equal(mem.get('outro_sistema'),'preservar');assert.equal(mem.get('bsq_senha'),undefined);assert.equal(mem.get('bsq_cache_v1'),undefined);
console.log('PASSOU modernização: atalhos semânticos, ícones, proteção do rascunho, bloqueio de saída com pendências e isolamento do armazenamento.');
})().catch(e=>{console.error(e);process.exit(1)});
