/* Exclusivamente local: cenário demonstrativo, sem qualquer dado real. */
if(!window.BOSQUES_PREVIA||!['localhost','127.0.0.1'].includes(location.hostname))throw Error('Prévia financeira isolada.');
(()=>{
 const F=FIN_GESTAO,hoje=hojeISO(),ano=Number(hoje.slice(0,4)),prefixo='fluxo-demo-',criado=new Date().toISOString();
 const cs=[{id:'501',nome:'Conta principal · exemplo',tipo:'CC'},{id:'502',nome:'Caixa interno · exemplo',tipo:'CX'},{id:'503',nome:'Aplicação · exemplo',tipo:'CA'}];
 registrosDemo=registrosDemo.filter(x=>!['movbanco','titulo','conta','prev','obrigacao'].includes(x._col));
 // Os valores e as pessoas abaixo foram inventados para demonstração.
 const movimentos=[];
 for(let y=ano-1;y<=ano;y++)for(let m=1;m<=12;m++){
  const mes=y+'-'+String(m).padStart(2,'0'),d=(n)=>mes+'-'+String(n).padStart(2,'0');if(d(1)>hoje)continue;
  const adicionar=(id,conta,data,valor,entrada,categoria,transferencia=false)=>{if(data>hoje)return;movimentos.push({_col:'movbanco',id:prefixo+id+'-'+mes,origem:'omie',contaOmie:conta,data,valor,entrada,transferencia,financeiroOmie:{pessoaNome:entrada?'Cliente demonstrativo':'Fornecedor exemplo',pessoaCodigo:entrada?'cliente-demo':'fornecedor-demo',categoriaNome:categoria,contaNome:cs.find(c=>c.id===conta).nome,contaCodigo:conta,centros:[{nome:categoria==='Infraestrutura'?'Obras':'Administração',percentual:100}]},criadoEm:criado});};
  adicionar('e1','501',d(5),24200+m*730,true,'Recebimento de lotes');adicionar('e2','501',d(12),9800+m*320,true,'Recebimento de lotes');
  adicionar('s1','501',d(8),16400+m*180,false,'Infraestrutura');adicionar('s2','501',d(16),6700+m*110,false,'Administrativo');adicionar('s3','501',d(18),1500,false,'Pró-labore');
  adicionar('te','502',d(10),1200,true,'Transferência',true);adicionar('ts','501',d(10),1200,false,'Transferência',true);adicionar('caixa','502',d(14),820,false,'Materiais');
 }
 registrosDemo.push(...movimentos);
 cs.forEach(c=>registrosDemo.push({_col:'conta',id:prefixo+c.id,nome:c.nome,omieId:c.id,saldoInicial:c.id==='501'?35000:c.id==='502'?3000:22000,dataInicial:(ano-1)+'-01-01',criadoEm:criado}));
 let tid=0;
 const titulo=(data,valor,entrada=true,conta='501')=>{const id=prefixo+'titulo-'+(++tid);registrosDemo.push({_col:'titulo',id,titulo:id,grupo:entrada?'CONTA_A_RECEBER':'CONTA_A_PAGAR',venc:data,status:'EMABERTO',original:{resumo:{nValAberto:valor}},financeiroOmie:{contaCodigo:conta,contaNome:cs.find(c=>c.id===conta).nome,pessoaNome:entrada?'Cliente Exemplo '+tid:'Fornecedor Modelo '+tid,pessoaCodigo:'demo-pessoa-'+tid,categoriaNome:entrada?'Venda de lotes':'Obra / infraestrutura',documento:'Documento fictício '+tid},criadoEm:criado});};
 for(let i=1;i<=4;i++)titulo(F.dia(hoje,-i*26),750+i*100);titulo(hoje,1800);
 for(let i=1;i<=156;i++){
  const mes=F.deslocarMes(hoje,i).slice(0,7);for(let n=1;n<=3;n++)titulo(mes+'-'+String(5+n*5).padStart(2,'0'),3200+((i+n)%5)*120);
  if(i<=12)titulo(mes+'-08',6800+i*450,false);
 }
 titulo(F.dia(hoje,4),2800);titulo(F.dia(hoje,8),3600,false);titulo('',780);
 registrosDemo.push({_col:'prev',id:prefixo+'plano',descricao:'Etapa de pavimentação · exemplo',valor:18000,data:F.deslocarMes(hoje,2).slice(0,7),recorrencia:'unica',categoria:'Obra / infraestrutura',obs:'Planejamento fictício; verificar correspondência com Omie'});
 const categoriasDemo={'1.01.01':'Recebimento de lotes','2.01.01':'Infraestrutura','2.01.02':'Materiais','2.03.01':'Pró-labore','2.04.01':'Administrativo','2.04.99':'Formação sem movimento · exemplo','0.01.01':'Transferência'};
 configDemo.financeiroReferencias={quando:criado,categorias:categoriasDemo,centros:{}};
 const codigoDemo=nome=>({'Recebimento de lotes':'1.01.01','Venda de lotes':'1.01.01','Infraestrutura':'2.01.01','Obra / infraestrutura':'2.01.01','Materiais':'2.01.02','Pró-labore':'2.03.01','Administrativo':'2.04.01','Transferência':'0.01.01'})[nome]||'';
 for(const r of registrosDemo)if(r.financeiroOmie){r.financeiroOmie.categoriaCodigo=codigoDemo(r.financeiroOmie.categoriaNome);}
 guardarDemo();
 const inicio=c=>c==='501'?35000:c==='502'?3000:22000;
 const saldoAte=(c,d)=>inicio(c)+movimentos.filter(x=>x.contaOmie===c&&x.data<=d).reduce((s,x)=>s+(x.entrada?1:-1)*F.cent(x.valor),0)/100;
 const extrato=(c,de,ate)=>({ok:true,schema:2,conta:c,nome:cs.find(x=>x.id===c).nome,de,ate,quando:criado,saldoInicial:saldoAte(c,F.dia(de,-1)),saldoFinalExtrato:saldoAte(c,ate),completo:true,criterio:'Dados fictícios da prévia',movimentos:movimentos.filter(x=>x.contaOmie===c&&x.data>=de&&x.data<=ate).length});
 const anterior=api;
 api=async function(action,dados={},opts={}){
  if(['saldos','historicoSaldos','extratoCaixa'].includes(action)&&new URLSearchParams(location.search).get('falha')==='1')throw Error('Falha simulada de conexão. Últimos dados preservados.');
  if(action==='saldos')return {ok:true,schema:2,quando:criado,dataBase:hoje,parcial:false,contas:cs.map(c=>({...c,saldo:saldoAte(c.id,hoje),saldoRealizado:saldoAte(c.id,hoje),inativa:false,fluxo:true,valores:{nSaldoAnterior:saldoAte(c.id,F.dia(hoje,-1)),nSaldoAtual:saldoAte(c.id,hoje),nSaldoConciliado:saldoAte(c.id,hoje)- (c.id==='501'?1200:0),nSaldoAtualPrevisto:saldoAte(c.id,hoje)+10000,nLimiteCreditoTotal:c.id==='501'?10000:0,nSaldoDisponivel:saldoAte(c.id,hoje)+(c.id==='501'?10000:0)}}))};
  if(action==='referencias')return {ok:true,quando:criado};
  if(action==='historicoSaldos')return {ok:true,extratos:F.sequencia(dados.de,dados.ate).filter(m=>m.de.slice(5,7)!=='02').flatMap(m=>cs.filter(c=>!dados.conta||c.id===dados.conta).map(c=>extrato(c.id,m.de,m.ate)))};
  if(action==='extratoCaixa')return extrato(dados.conta,dados.de,dados.ate);
  return anterior(action,dados,opts);
 };
 localStorage.removeItem('bsq_omie_saldos');
 TELAS._gestao={ano:String(ano),mes:'',conta:'',escopo:'ano',secao:new URLSearchParams(location.search).has('plano')?'plano':'visao',q:''};
})();
