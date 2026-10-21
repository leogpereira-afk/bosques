/* Demonstração local da conciliação. Pessoas, documentos e valores são fictícios.
 * A API de produção permanece bloqueada por preview-bosques-data.js.
 */
if(!window.BOSQUES_PREVIA)throw new Error('Demonstração disponível apenas na prévia isolada.');
(()=>{
 const stamp=criadoDemo,cpf='00000000000',copia=x=>JSON.parse(JSON.stringify(x));
 const inserir=r=>{if(!registrosDemo.some(x=>x._col===r._col&&x.id===r.id))registrosDemo.push({...r,atualizadoEm:stamp});};
 inserir({_col:'cliente',id:cpf,nome:'Cliente de Conciliação · exemplo',cpf});
 for(const [id,lote] of [['demo-con-v1',7],['demo-con-v2',8]])inserir({_col:'venda',id,codigo:id==='demo-con-v1'?'VD-DEMO-A':'VD-DEMO-B',clienteId:cpf,clienteNome:'Cliente de Conciliação · exemplo',loteId:'demo-l1-'+lote,quadra:1,lote,situacao:'ativa',dataVenda:dataDemo(-3),parcelas:id==='demo-con-v1'?[{tid:'demo-titulo-1',venc:dataDemo(0,9),valor:600,valorDia:600,conferir:true,origem:'omie'}]:[],historico:[]});
 for(let i=1;i<=45;i++){
  const tid='demo-titulo-'+i,valor=i===1?640:480;
  inserir({_col:'titulo',id:'CONTA_A_RECEBER-'+tid,titulo:tid,grupo:'CONTA_A_RECEBER',cpf,valor,venc:dataDemo(0,10),status:'RECEBIDO',origem:'omie',financeiroOmie:{pessoaNome:'Cliente de Conciliação · exemplo',documento:i===1?'Q01 L07 · parcela exemplo':'Documento demonstrativo '+i,contaNome:'Conta demonstração',observacao:'Documento fictício para testar conferência',dataPagamento:dataDemo(0,10)},original:{resumo:{nValPago:valor,nValLiquido:valor,nValAberto:0},detalhes:{cNumTitulo:i===1?'Q01L07':'DOC-DEMO-'+i,dDtPagamento:'10/10/2026'}}});
  inserir({_col:'rec',id:'rbomie-'+tid,vendaId:'',valor,data:dataDemo(0,10),origem:'omie',conferir:true,omie:{titulo:tid,cpf},financeiroOmie:{pessoaNome:'Cliente de Conciliação · exemplo',contaNome:'Conta demonstração',documento:'DOC-DEMO-'+i},historico:[]});
 }
 inserir({_col:'rec',id:'demo-manual-sem-identidade',vendaId:'',valor:200,data:dataDemo(0,12),tipo:'parcela',origem:'manual',conferir:true,obs:'Recebimento manual demonstrativo; identidade precisa de conferência',historico:[]});
 for(let i=1;i<=6;i++){
  const tid='demo-pagar-'+i,valor=90+i;
  inserir({_col:'titulo',id:'CONTA_A_PAGAR-'+tid,titulo:tid,grupo:'CONTA_A_PAGAR',valor,venc:dataDemo(0,5),status:'PAGO',financeiroOmie:{pessoaNome:'Fornecedor exemplo '+i,contaNome:'Conta demonstração',documento:'NOTA-DEMO-'+i,dataPagamento:dataDemo(0,5)},original:{resumo:{nValLiquido:valor,nValPago:valor},detalhes:{cNumTitulo:'NOTA-DEMO-'+i,dDtPagamento:'05/10/2026'}}});
  inserir({_col:'cx',id:'demo-cx-'+i,tipo:'saida',valor,data:dataDemo(0,5),descricao:'Fornecedor exemplo '+i,obs:'Documento manual demonstrativo '+i,historico:[]});
 }
 guardarDemo();
 const apiAnterior=api,operacoes=new Map();
 api=async function(action,dados={},opts={}){
  if(action==='saude')return {ok:true,agora:new Date().toISOString(),sync:{status:'completa',quando:new Date().toISOString(),contagens:{},pendencias:registrosDemo.filter(x=>x._col==='titulo'&&x.grupo==='CONTA_A_PAGAR'&&!x.decisaoDuplicidade).map(t=>({tipo:'possivel_duplicidade',titulo:t.titulo,valor:t.valor,data:dataDemo(0,5),candidatos:['demo-cx-'+t.titulo.split('-').at(-1)]}))},automacao:{ativa:true,intervaloMinutos:15}};
  if(action!=='conciliarFinanceiro')return apiAnterior(action,dados,opts);
  if(operacoes.has(dados.operacao))return {...operacoes.get(dados.operacao),repetida:true};
  if(!dados.operacao||String(dados.motivo||'').trim().length<3)throw new Error('Informe a decisão e o documento conferido.');
  const reg=copia(registrosDemo),ts=new Date().toISOString(),dest=reg.find(x=>x._col==='venda'&&x.id===dados.destino),r=reg.find(x=>x._col==='rec'&&x.id===dados.id),t=reg.find(x=>x._col==='titulo'&&String(x.titulo)===String(dados.id)),manual=reg.find(x=>x._col==='cx'&&x.id===dados.manual);
  for(const [chave,obj] of [['titulo',t],['recebimento',r],['venda',dest],['manual',manual]])if(Object.hasOwn(dados.esperado||{},chave)&&(obj?.atualizadoEm||null)!==(dados.esperado[chave]||null))throw new Error('Os dados mudaram. Atualize a leitura antes de confirmar novamente.');
  const historico={em:ts,por:'Gestão · demonstração',acao:'Conciliação demonstrativa',motivo:dados.motivo,operacao:dados.operacao};
  const marcar=obj=>{obj.atualizadoEm=ts;obj.historico=[...(obj.historico||[]),historico];};
  if(dados.tipo==='titulo'){
   if(!t||!dest||dest.clienteId!==t.cpf)throw new Error('Escolha um contrato do mesmo cliente.');
   let local;
   for(const v of reg.filter(x=>x._col==='venda')){
    const p=(v.parcelas||[]).find(p=>String(p.tid)===String(t.titulo));if(p){local=local||p;v.parcelas=v.parcelas.filter(p=>String(p.tid)!==String(t.titulo));marcar(v);}
   }
   if(dados.politica==='local'&&!local)throw new Error('Não há parcela local para manter.');
   const p={...(local||{}),tid:t.titulo,origem:'omie',trava:true,vinculoConfirmado:true,conferir:dados.politica==='pendente',conciliacao:{politica:dados.politica,valorOrigem:t.valor,vencOrigem:t.venc,valorLocalAntes:local?.valor,vencLocalAntes:local?.venc,operacao:dados.operacao}};
   if(dados.politica==='origem'||!local){p.valor=t.valor;p.venc=t.venc;p.valorDia=t.valor;}
   dest.parcelas=[...(dest.parcelas||[]),p];marcar(dest);marcar(t);
   for(const rec of reg.filter(x=>x._col==='rec'&&String(x.omie?.titulo)===String(t.titulo))){rec.vendaId=dest.id;rec.alocacoes=[{tid:t.titulo,valor:rec.valor}];rec.conferir=dados.politica==='pendente';marcar(rec);}
  }else if(dados.tipo==='recebimento'){
   if(!r||!dest)throw new Error('Recebimento ou contrato indisponível.');r.vendaId=dest.id;r.conferir=true;r.alocacoes=[];marcar(r);
  }else if(dados.tipo==='duplicidade'){
   if(!t||!['mesmo','distintos'].includes(dados.decisao))throw new Error('Escolha a decisão.');
   if(dados.decisao==='mesmo'){if(!manual||manual.valor!==t.valor)throw new Error('Compare e selecione o lançamento manual.');manual.vinculoOmieConfirmado=true;manual.omie={titulo:t.titulo};marcar(manual);}
   t.decisaoDuplicidade=dados.decisao;t.manualConciliadoId=manual?.id||null;marcar(t);
  }else throw new Error('Tipo de conferência não reconhecido.');
  registrosDemo=reg;guardarDemo();const resultado={ok:true,repetida:false,colecoes:['titulo','venda','rec','cx']};operacoes.set(dados.operacao,resultado);return resultado;
 };
 if(new URLSearchParams(location.search).has('conciliacao'))TELAS._gestao={ano:hojeISO().slice(0,4),mes:'',conta:'',q:'',secao:'conferencias'};
})();
