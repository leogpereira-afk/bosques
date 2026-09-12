// Testes em memória: cadastro, senha, sessão, privacidade, lotes e mapa.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),crypto=require('node:crypto').webcrypto;
const deps=process.env.BSQ_TEST_DEPS||'/tmp/bosques-test-deps',ts=require(deps+'/node_modules/typescript');
const ler=f=>fs.readFileSync(f,'utf8'),base={URL,Response,Request,TextEncoder,crypto,btoa,atob,console};
const transpilar=f=>ts.transpileModule(ler(f),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const modulo=f=>{const exports={};vm.runInNewContext(transpilar(f),{...base,exports});return exports;};
const pub=modulo('supabase/functions/_shared/espelho.ts'),auth=modulo('supabase/functions/_shared/espelho-acesso.ts'),painel=modulo('supabase/functions/_shared/acesso.ts');
const mapa='https://drive.google.com/file/d/arquivo_mapa_teste/view';
const cfg={espelhoToken:'token-do-teste',senhaHash:'segredo',empresa:{nome:'Bosques teste',telefone:'38999999999'},espelho:{mapaUrl:mapa,exibirReservados:true}};
const linhas=['Disponível','Reservado','Vendido','Cancelado','',null].map((status,i)=>({registro:{quadra:1,lote:String(i+1),status,areaM2:1017.11,preco:40684.4,clienteNome:'PRIVADO',reservadoPor:{nome:'PRIVADO'},id:'interno'}}));
(async()=>{
 const hash=await painel.sha256('senha-de-teste');cfg.espelhoAcesso=await auth.novaSenhaEspelho(hash);
 assert.equal(await auth.senhaEspelhoConfere(hash,cfg.espelhoAcesso),true);assert.equal(await auth.senhaEspelhoConfere(await painel.sha256('errada'),cfg.espelhoAcesso),false);
 const limpo=painel.cfgSemSegredo(cfg);assert.equal(limpo.espelhoAcesso,undefined);assert.equal(limpo.senhaHash,undefined);assert.equal(limpo.espelhoSenhaConfigurada,true);
 for(const action of ['listarAcessosEspelho','salvarSenhaEspelho','bloquearAcessoEspelho'])for(const perfil of ['escritorio','corretor'])assert.equal(painel.podeFazer({perfil},action),false);
 const payload=pub.dadosEspelhoPublico(cfg,linhas,'2026-09-12T12:00:00Z');
 assert.deepEqual(Array.from(payload.lotes,l=>l.status),['Disponível','Reservado']);assert.equal(payload.lotes[1].preco,null);
 for(const texto of ['PRIVADO','segredo','token-do-teste',cfg.espelhoAcesso.hash,cfg.espelhoAcesso.chave])assert.equal(JSON.stringify(payload).includes(texto),false);
 assert.equal(pub.dadosEspelhoPublico({...cfg,espelho:{...cfg.espelho,exibirReservados:false}},linhas,'').lotes.length,1);
 for(const u of ['javascript:alert(1)','https://evil.example/mapa','https://drive.google.com.evil.example/file/d/arquivo_mapa_teste/view','https://drive.google.com/drive/folders/pasta_mapa_teste'])assert.equal(pub.mapaPublico(u),'');
 assert.equal(pub.mapaPublico('https://drive.google.com/open?id=arquivo_mapa_teste&resourcekey=chave'),mapa+'?resourcekey=chave');
 let handler,consultas=0,gravacoes=0;const cadastros=new Map();
 const dados={lerCfgBruta:async()=>cfg,lerColecaoBruta:async c=>{assert.equal(c,'lote');consultas++;return linhas;},agora:()=>payload.geradoEm,lerUm:async(c,id)=>{assert.equal(c,'espelho_acesso');return cadastros.get(id)||null;},gravarUm:async(c,id,r)=>{assert.equal(c,'espelho_acesso');gravacoes++;cadastros.set(id,r);}};
 vm.runInNewContext(transpilar('supabase/functions/bsq-p/index.ts'),{...base,exports:{},Deno:{serve:fn=>handler=fn},require:n=>n.endsWith('/espelho.ts')?pub:n.endsWith('/espelho-acesso.ts')?auth:n.endsWith('/acesso.ts')?painel:dados});
 const pedir=(token=cfg.espelhoToken,method='GET',body=null,sessao='')=>handler(new Request('https://example.test/bsq-p/espelho/'+token,{method,headers:{...(sessao?{Authorization:'Bearer '+sessao}:{}),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
 assert.equal((await pedir('incorreto')).status,403);assert.equal((await pedir()).status,401);assert.equal(consultas,0);
 const pre=await pedir(cfg.espelhoToken,'OPTIONS');assert.equal(pre.status,204);assert.ok(pre.headers.get('access-control-allow-headers').includes('authorization'));
 const registro={nome:'Ana Teste',telefone:'(38) 99999-9999',perfil:'corretor',senhaHash:hash};
 assert.equal((await pedir(cfg.espelhoToken,'POST',{...registro,telefone:'123'})).status,400);
 assert.equal((await pedir(cfg.espelhoToken,'POST',{...registro,senhaHash:await painel.sha256('errada')})).status,401);assert.equal(gravacoes,0);
 const login=await pedir(cfg.espelhoToken,'POST',registro);assert.equal(login.status,200);const sessao=(await login.json()).sessao;
 assert.equal(gravacoes,1);assert.equal(cadastros.size,1);const uid=[...cadastros.keys()][0];assert.equal(cadastros.get(uid).telefone,'38999999999');
 let r=await pedir(cfg.espelhoToken,'GET',null,sessao);assert.equal(r.status,200);assert.equal((await r.json()).lotes.length,2);
 assert.equal((await pedir(cfg.espelhoToken,'GET',null,sessao+'a')).status,401);
 const velha=await auth.sessaoEspelho(uid,cfg,0);assert.equal(await auth.validarSessaoEspelho(velha,cfg),null);
 assert.equal(await auth.validarSessaoEspelho(sessao,{...cfg,espelhoToken:'outro'}),null);
 assert.equal(await auth.validarSessaoEspelho(sessao,{...cfg,espelhoAcesso:{...cfg.espelhoAcesso,chave:'outra'}}),null);
 cadastros.get(uid).bloqueado=true;assert.equal((await pedir(cfg.espelhoToken,'GET',null,sessao)).status,401);assert.equal((await pedir(cfg.espelhoToken,'POST',registro)).status,403);cadastros.get(uid).bloqueado=false;
 await pedir(cfg.espelhoToken,'POST',{...registro,nome:'Ana Atualizada'});assert.equal(cadastros.size,1);assert.equal(cadastros.get(uid).nome,'Ana Atualizada');
 for(let i=0;i<10;i++)assert.equal(auth.tentativaEspelho('outro-ip',1000),true);assert.equal(auth.tentativaEspelho('outro-ip',1000),false);assert.equal(auth.tentativaEspelho('outro-ip',601001),true);
 // Ações administrativas usam a autenticação do painel e preservam a senha nas demais configurações.
 let adminHandler,adminCfg=structuredClone(cfg);const cors=modulo('supabase/functions/_shared/cors.ts'),colecoes=modulo('supabase/functions/_shared/colecoes.ts');
 const direcaoHash=await painel.sha256('direcao-teste'),corretorHash=await painel.sha256('corretor-teste');
 adminCfg.senhaHash=await painel.sha256(direcaoHash);adminCfg.usuarios=[{id:'corretor',nome:'Corretor Teste',perfil:'corretor',hash:await painel.sha256(corretorHash)}];
 const dadosAdmin={...dados,lerCfgBruta:async()=>adminCfg,gravarCfg:async c=>adminCfg=c,registrarLog:async()=>{},lerColecaoBruta:async c=>{assert.equal(c,'espelho_acesso');return [...cadastros.values()].map(registro=>({registro}));}};
 vm.runInNewContext(transpilar('supabase/functions/bsq-nucleo/index.ts'),{...base,exports:{},Deno:{serve:fn=>adminHandler=fn,env:{get:()=> 'token-painel'}},require:n=>n.endsWith('/acesso.ts')?painel:n.endsWith('/espelho-acesso.ts')?auth:n.endsWith('/cors.ts')?cors:n.endsWith('/colecoes.ts')?colecoes:dadosAdmin});
 const adm=(action,body={},senha=direcaoHash)=>adminHandler(new Request('https://example.test/bsq-nucleo',{method:'POST',headers:{'x-token':'token-painel','x-senha':senha,'content-type':'application/json'},body:JSON.stringify({action,...body})}));
 assert.equal((await adm('listarAcessosEspelho',{},corretorHash)).status,403);
 let ar=await adm('listarAcessosEspelho');assert.equal(ar.status,200);assert.equal((await ar.json()).acessos.length,1);
 const segredo=adminCfg.espelhoAcesso;ar=await adm('salvarCfg',{cfg:{espelho:{mapaUrl:mapa,exibirReservados:false},espelhoAcesso:{hash:'invasao'}}});assert.equal(ar.status,200);assert.equal(adminCfg.espelhoAcesso,segredo);assert.equal((await ar.json()).cfg.espelhoAcesso,undefined);
 ar=await adm('salvarSenhaEspelho',{novaHash:await painel.sha256('nova-teste')});assert.equal(ar.status,200);assert.notEqual(adminCfg.espelhoAcesso.chave,segredo.chave);assert.equal((await ar.json()).cfg.espelhoAcesso,undefined);
 assert.equal((await adm('bloquearAcessoEspelho',{id:uid,bloqueado:true})).status,200);assert.equal(cadastros.get(uid).bloqueado,true);
 console.log('OK servidor: senha, cadastro por telefone, sessão, expiração, troca de senha, bloqueio, limites e dados restritos.');
 const {parseHTML}=await import(deps+'/node_modules/linkedom/esm/index.js');
 async function pagina({hash='#teste',status=200,data={...payload,lotes:linhas.map(l=>l.registro)},session=''}={}){
  const {document}=parseHTML(ler('espelho-publico.html')),mem=new Map();if(session)mem.set('bsq_espelho_sessao_teste',session);
  for(const d of document.querySelectorAll('dialog')){d.showModal=()=>d.setAttribute('open','');d.close=()=>d.removeAttribute('open');}
  for(const select of document.querySelectorAll('select')){
   select.add=n=>select.append(n);Object.defineProperty(select,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.firstElementChild?.value||'';},set(v){for(const o of this.children)o.toggleAttribute('selected',o.value===v);}});
  }
  document.querySelector('form').reset=()=>{};
  const Option=function(text,value){const o=document.createElement('option');o.textContent=text;o.value=value;return o;};
  const calls=[],pdfs=[];let pdfFalha=false,postStatus=200;
  const ctx=vm.createContext({...base,document,window:{addEventListener(){}},PDF:{espelho:async(...args)=>{pdfs.push(args);if(pdfFalha)throw Error("Não foi possível incluir o mapa no PDF.");return {comMapa:true};}},sessionStorage:{getItem:k=>mem.get(k)||null,setItem:(k,v)=>mem.set(k,v),removeItem:k=>mem.delete(k)},location:{hash},Option,AbortController,setTimeout,clearTimeout,fetch:async(u,opts)=>{calls.push(opts);return opts.method==='POST'?{ok:postStatus===200,status:postStatus,json:async()=>postStatus===200?{sessao:'sessao-teste',nome:'Ana Teste'}:{erro:'Senha incorreta.'}}:{ok:status===200,status,json:async()=>data};}});
  vm.runInContext(ler('mapa-espelho.js'),ctx);vm.runInContext(ler('espelho-publico.js'),ctx);await new Promise(setImmediate);
  return {document,ctx,calls,mem,pdfs,setPdfFalha:v=>pdfFalha=v,setStatus:n=>status=n,setPostStatus:n=>postStatus=n};
 }
 let p=await pagina(),d=p.document;
 assert.equal(p.calls.length,0);assert.equal(d.querySelector('#entrada').hidden,false);assert.equal(d.querySelector('#conteudo').hidden,true);assert.equal(d.querySelector('#mapa-publico img'),null);
 const preencher=()=>{d.querySelector('#visitante').value='Ana Teste';d.querySelector('#telefone').value='38999999999';d.querySelector('#perfil').value='corretor';d.querySelector('#senha').value='senha-de-teste';};
 preencher();p.setPostStatus(401);await d.querySelector('form').onsubmit({preventDefault(){}});assert.match(d.querySelector('#nome-erro').textContent,/Senha incorreta/);assert.equal(d.querySelector('#conteudo').hidden,true);
 p.setPostStatus(200);await d.querySelector('form').onsubmit({preventDefault(){}});
 assert.equal(d.querySelector('#conteudo').hidden,false);assert.equal(d.querySelector('#senha').value,'');assert.equal(d.querySelectorAll('.lote').length,2);assert.equal(p.calls.at(-1).headers.Authorization,'Bearer sessao-teste');
 assert.equal(JSON.parse(p.calls[0].body).senha,undefined);assert.equal(JSON.parse(p.calls[0].body).senhaHash,hash);assert.equal([...p.mem.values()].includes('senha-de-teste'),false);
 const img=d.querySelector('#mapa-publico img');assert.ok(img.src.startsWith('https://lh3.googleusercontent.com/d/arquivo_mapa_teste=w2400?'));
 assert.ok([...d.querySelector('#conteudo').children].indexOf(d.querySelector('#quadras'))<[...d.querySelector('#conteudo').children].indexOf(d.querySelector('#mapa-publico')));
 img.onload();assert.equal(d.querySelector('.mapa-aviso').hidden,true);img.onerror();assert.match(d.querySelector('.mapa-aviso').textContent,/Não foi possível/);
 d.querySelectorAll('.mapa-acoes button')[1].onclick();assert.match(img.src,/atualizacao=/);d.querySelectorAll('.mapa-acoes button')[0].onclick();assert.ok(d.querySelector('.mapa-visor').classList.contains('mapa-zoom'));
 d.querySelector('.lote').onclick();assert.equal(d.querySelector('#detalhe').hasAttribute('open'),true);assert.ok(d.querySelector('#det-preco').textContent.includes('40.684,40'));d.querySelector('#fechar').onclick();
 d.querySelector('[data-status="Reservado"]').onclick();assert.equal(d.querySelectorAll('.lote').length,1);d.querySelector('#q').value='999';d.querySelector('#q').oninput();assert.equal(d.querySelector('#vazio').hidden,false);d.querySelector('#limpar').onclick();assert.equal(d.querySelectorAll('.lote').length,2);
 d.querySelector('[data-status="Reservado"]').onclick();
 await d.querySelector('#pdf').onclick();assert.equal(p.pdfs.length,1);assert.equal(p.pdfs[0][0].length,1);assert.equal(p.pdfs[0][0][0].status,'Reservado');assert.equal(p.pdfs[0][2].espelho.mapaUrl,mapa);assert.equal(p.pdfs[0][4].publico,true);assert.match(d.querySelector('#pdf-status').textContent,/página A3/);assert.equal(d.querySelector('#pdf').disabled,false);
 p.setPdfFalha(true);await d.querySelector('#pdf').onclick();assert.match(d.querySelector('#pdf-status').textContent,/Não foi possível incluir/);assert.equal(d.querySelector('#pdf').disabled,false);await d.querySelector('#atualizar-lista').onclick();
 d.querySelector('#sair').onclick();assert.equal(d.querySelector('#conteudo').hidden,true);assert.equal(d.querySelector('#mapa-publico img'),null);assert.equal(p.mem.size,0);
 p=await pagina({session:'sessao-teste',data:{...payload,exibirReservados:false,visitante:{nome:'<img src=x>'}}});assert.equal(p.document.querySelectorAll('.lote').length,1);assert.equal(p.document.querySelector('#saudacao img'),null);
 p=await pagina({session:'sessao-teste',status:401});assert.equal(p.document.querySelector('#entrada').hidden,false);assert.equal(p.mem.size,0);
 p=await pagina({session:'sessao-teste',status:500});assert.equal(p.document.querySelector('#tentar').hidden,false);p.setStatus(200);await p.document.querySelector('#tentar').onclick();assert.equal(p.document.querySelector('#conteudo').hidden,false);
 p=await pagina({session:'sessao-teste',status:403});assert.equal(p.document.querySelector('#conteudo').hidden,true);
 p=await pagina({hash:''});assert.equal(p.calls.length,0);assert.equal(p.document.querySelector('#aviso-titulo').textContent,'Link incompleto');
 const eventos={},arquivos=[];let instalacao;
 vm.runInNewContext(ler('sw.js'),{URL,Request,caches:{open:async()=>({addAll:async rs=>arquivos.push(...rs)})},self:{location:{href:'https://example.test/bosques/sw.js'},addEventListener:(n,fn)=>eventos[n]=fn,skipWaiting:async()=>{}}});
 eventos.install({waitUntil:p=>instalacao=p});await instalacao;
 assert.ok(arquivos.some(r=>new URL(r.url).pathname.endsWith('mapa-espelho.js')));
 for(const r of arquivos){assert.equal(new URL(r.url).searchParams.get('v'),'bsq-shell-v68');assert.equal(r.cache,'reload');}
 console.log('OK atualização: arquivos do mapa e da tela consultados com a versão nova.');
 console.log('PASSOU página: acesso obrigatório, saída, mapa abaixo dos lotes, zoom, atualização, filtros, segurança de texto e falhas de rede.');
})().catch(e=>{console.error(e);process.exit(1)});
