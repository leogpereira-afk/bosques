/* Prévia local com dados fictícios. Não contém credenciais nem chama o servidor. */
if(!['127.0.0.1','localhost'].includes(location.hostname))throw new Error('Prévia disponível somente em servidor local.');
window.BOSQUES_PREVIA=true;window.FINANCEIRO_EM_VALIDACAO=true;
window.VERSAO='79 · prévia';
const dataDemo=(meses,dia=10)=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()+meses);d.setDate(dia);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(dia).padStart(2,'0');};
const criadoDemo=new Date().toISOString();
const configDemo={empresa:{nome:'Associação Campestre Portal dos Bosques',cidade:'Montes Claros',uf:'MG'},formasPg:['PIX','Boleto','Transferência','Dinheiro'],categoriasDespesa:['Obra','Administrativo','Comissão','Marketing'],categoriasReceita:['Venda de lotes','Outras receitas'],centrosCusto:['Infraestrutura','Comercial','Administração'],reajuste:{pct:6,aCada:12},tabela:{m2:40},omie:{ativo:true},usuarios:[],espelho:{exibirReservados:true}};
const baseDemo=[];
for(let q=1;q<=3;q++)for(let l=1;l<=8;l++)baseDemo.push({_col:'lote',id:'demo-l'+q+'-'+l,quadra:q,lote:l,areaM2:1000+(l%3)*100,preco:(1000+(l%3)*100)*40,status:l<=3?'Vendido':l===4&&q===2?'Reservado':'Disponível',parcFixa:479.88,parcFixaDesc:383.9,parcReaj:369.87,parcReajDesc:295.9,criadoEm:criadoDemo});
const nomesDemo=['Marina Exemplo','Rafael Demonstração','Camila Modelo','Bruno Exemplo','Helena Demonstração','João Modelo','Paula Exemplo','Miguel Demonstração','Lívia Modelo'];
nomesDemo.forEach((nome,i)=>{
 const id='demo-c'+i,q=1+Math.floor(i/3),l=1+i%3,vid='demo-v'+i;
 baseDemo.push({_col:'cliente',id,nome,whatsapp:'',email:'',cidade:'Montes Claros',uf:'MG',criadoEm:criadoDemo});
 const parcelas=Array.from({length:6},(_,n)=>({tid:1000+i*10+n,venc:dataDemo(n-2,10+i%3),valor:480,valorDia:384,pago:n<2?dataDemo(n-2,9):null,pagoValor:n<2?480:0,origem:'omie'}));
 baseDemo.push({_col:'venda',id:vid,codigo:'VD-DEMO-'+String(i+1).padStart(3,'0'),loteId:'demo-l'+q+'-'+l,quadra:q,lote:l,clienteId:id,clienteNome:nome,corretorId:'demo-cor'+i%2,corretorNome:i%2?'Equipe Horizonte':'Equipe Bosques',dataVenda:dataDemo(-i%4,5),entrada:3000,entradaModo:'total',entradaDetalhe:'Entrada à vista',qtdeParcelas:120,valorParcela:384,tipoParcela:'Fixa',inicioParcelas:dataDemo(-2,10+i%3),situacao:'ativa',parcelas,criadoEm:criadoDemo});
 baseDemo.push({_col:'rec',id:'demo-entrada'+i,vendaId:vid,data:dataDemo(-2,5),valor:3000,tipo:'entrada',forma:'PIX',criadoEm:criadoDemo});
 parcelas.forEach((p,n)=>{baseDemo.push({_col:'titulo',id:'demo-t'+p.tid,titulo:p.tid,grupo:'CONTA_A_RECEBER',valor:p.valor,venc:p.venc,status:n<2?'RECEBIDO':'EMABERTO',clienteId:id,original:{resumo:{nValAberto:n<2?0:480}},criadoEm:criadoDemo});if(n<2)baseDemo.push({_col:'rec',id:'demo-rec'+p.tid,vendaId:vid,valor:480,data:p.pago,tipo:'parcela',forma:'PIX',alocacoes:[{tid:p.tid,valor:480}],criadoEm:criadoDemo});});
});
['Equipe Bosques','Equipe Horizonte'].forEach((nome,i)=>baseDemo.push({_col:'corretor',id:'demo-cor'+i,nome,criadoEm:criadoDemo}));
for(let mes=-4;mes<=0;mes++)for(let n=1;n<=4;n++){
 const entrada=n<3,valor=entrada?6400+(mes+4)*350+n*165:2400+(mes+4)*120+n*85;
 baseDemo.push({_col:'movbanco',id:'demo-mov'+mes+'-'+n,origem:'omie',data:dataDemo(mes,n*3),valor,entrada,titulo:'m'+mes+n,financeiroOmie:{pessoaNome:entrada?'Recebimentos demonstrativos':'Fornecedor Exemplo '+n,categoriaNome:entrada?'Venda de lotes':n===3?'Infraestrutura':'Administrativo',contaNome:'Conta demonstração',centros:[{nome:entrada?'Comercial':n===3?'Infraestrutura':'Administração',percentual:100}]},criadoEm:criadoDemo});
}
baseDemo.push({_col:'conta',id:'demo-conta',nome:'Conta demonstração',saldo:28750,criadoEm:criadoDemo});
baseDemo.push({_col:'prop',id:'demo-prop1',codigo:'PR-DEMO-001',loteId:'demo-l1-5',quadra:1,lote:5,cliente:{nome:'Interessado Exemplo'},donoNome:'Equipe Bosques',situacao:'enviada',entrada:3000,entradaModo:'total',qtdeParcelas:120,valorParcela:384,tipoParcela:'Fixa',dataProposta:hojeISO(),criadoEm:criadoDemo,eventos:[{tipo:'interesse',em:criadoDemo}]});
let registrosDemo=JSON.parse(localStorage.getItem('bosques_demo_registros')||'null')||baseDemo;
let seqDemo=10;
const guardarDemo=()=>localStorage.setItem('bosques_demo_registros',JSON.stringify(registrosDemo));
localStorage.setItem(K.senha,'previa-sem-credencial');localStorage.setItem(K.quem,'Gestão · demonstração');localStorage.setItem(K.perfil,'direcao');
const fetchNativoDemo=window.fetch.bind(window);
window.fetch=(url,opts)=>{const u=new URL(String(url),location.href);if(u.origin!==location.origin)return Promise.reject(new Error('Prévia isolada: conexão externa bloqueada.'));return fetchNativoDemo(url,opts);};
api=async function(action,dados={}){
 if(action==='snapshot')return {ok:true,cfg:configDemo,registros:JSON.parse(JSON.stringify(registrosDemo)),eu:{perfil:S.perfil||'direcao',nome:'Gestão · demonstração'}};
 if(action==='salvarLote'){
  const salvos=(dados.itens||[]).map(({colecao,registro})=>{const r={...registro,_col:colecao,_pendente:false,atualizadoEm:new Date().toISOString()};if(colecao==='venda')r.codigo=r.codigo||'VD-DEMO-'+(++seqDemo);if(colecao==='prop'){r.codigo=r.codigo||'PR-DEMO-'+(++seqDemo);r.tokenPublico=r.tokenPublico||'token-ficticio-da-previa';}const ix=registrosDemo.findIndex(x=>x.id===r.id&&x._col===colecao);if(ix<0)registrosDemo.push(r);else registrosDemo[ix]=r;return r;});for(const r of salvos.filter(x=>x._col==='venda')){const lote=registrosDemo.find(x=>x._col==='lote'&&x.id===r.loteId);if(lote){lote.status=r.situacao==='distratada'?'Disponível':'Vendido';salvos.push({...lote});}}guardarDemo();return {ok:true,salvos,recusados:[]};
 }
 if(action==='saude')return {ok:true,agora:new Date().toISOString(),sync:{status:'completa',quando:new Date().toISOString(),contagens:{}},automacao:{ativa:true,intervaloMinutos:15}};
 if(action==='saldos')return {ok:true,contas:[{nome:'Conta demonstração',saldo:28750}],em:new Date().toISOString()};
 if(action==='sincronizar')return {ok:true,continua:null,contagens:{}};
 if(action==='listarAcessosEspelho')return {ok:true,acessos:[]};
 if(action==='log')return {ok:true,logs:[]};
 if(action==='salvarCfg'){Object.assign(configDemo,dados.cfg);return {ok:true,cfg:configDemo};}
 throw new Error('Esta operação não é enviada ao servidor na prévia.');
};
carregarCacheCompleto=async()=>{};
// A prévia nunca registra o service worker de produção.
window.addEventListener('DOMContentLoaded',()=>{
 const aviso=document.createElement('aside');aviso.className='previa-aviso';aviso.innerHTML='<b>Prévia Bosques</b><span>Dados fictícios · nenhuma alteração na produção</span><button type="button">Reiniciar demonstração</button>';
 aviso.querySelector('button').onclick=()=>{localStorage.removeItem('bosques_demo_registros');location.reload();};document.body.prepend(aviso);
});
