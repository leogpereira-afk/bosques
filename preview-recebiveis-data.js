/* Somente localhost. Cenários fictícios para revisar a previsão, sem produção. */
if(!window.BOSQUES_PREVIA||!['localhost','127.0.0.1'].includes(location.hostname))throw Error('Prévia disponível apenas localmente.');
(()=>{
  const ano=Number(hojeISO().slice(0,4)),anoMes=(offset)=>{
    const d=new Date(ano,0,15);d.setMonth(d.getMonth()+offset);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-15';
  };
  registrosDemo=baseDemo.filter(x=>!['venda','rec','titulo'].includes(x._col));
  for(let i=0;i<6;i++){
    const vid='demo-previsao-v'+i,ps=[],n=48-i*6;
    const venda={_col:'venda',id:vid,codigo:'VD-EXEMPLO-'+(i+1),clienteNome:nomesDemo[i],clienteId:'demo-c'+i,loteId:'demo-l'+(1+Math.floor(i/3))+'-'+(i%3+1),quadra:1+Math.floor(i/3),lote:i%3+1,situacao:i===5?'quitada':'ativa',entrada:0,entradaNoEspelho:true,dataVenda:anoMes(-4),parcelas:ps};
    for(let p=0;p<n;p++){
      const tid='demo-previsao-t'+i+'-'+p,venc=anoMes(p-4),valor=850+i*170+(p===n-1?6000:0),atual=venc.slice(0,7)===hojeISO().slice(0,7),pago=i===5?valor:atual&&i===0?Math.round(valor/2):venc<hojeISO()?valor:0;
      ps.push({tid,venc,valor,origem:'omie'});
      const dataPagamento=venc>hojeISO()?hojeISO():venc;
      registrosDemo.push({_col:'titulo',id:'registro-'+tid,titulo:tid,grupo:'CONTA_A_RECEBER',origem:'omie',venc,valor,status:pago===valor?'RECEBIDO':'EMABERTO',original:{detalhes:{dDtPagamento:pago?dataPagamento:''},resumo:{nValAberto:valor-pago,nValLiquido:pago,nValPago:pago}},financeiroOmie:{pessoaNome:venda.clienteNome,categoriaNome:'Venda de lotes',contaCodigo:'exemplo',contaNome:'Conta exemplo'}});
      if(pago)registrosDemo.push({_col:'rec',id:'rec-'+tid,vendaId:vid,valor:pago,data:dataPagamento,origem:'omie',omie:{titulo:tid},alocacoes:[{tid,valor:pago}],tipo:'parcela'});
    }
    registrosDemo.push(venda);
  }
  registrosDemo.push({_col:'venda',id:'demo-previsao-pendente',clienteNome:'Cliente Conferência · fictício',quadra:3,lote:1,loteId:'demo-l3-1',situacao:'conferir',entrada:0,parcelas:[{tid:'demo-pendente',valor:1400,venc:anoMes(3),conferir:true,obs:'Conferir vínculo do título'},{tid:'demo-sem-data',valor:600,venc:''}]});
  registrosDemo.push({_col:'venda',id:'demo-previsao-plano',clienteNome:'Cliente Plano · fictício',quadra:3,lote:2,loteId:'demo-l3-2',situacao:'ativa',entrada:2000,qtdeParcelas:12,valorParcela:950,tipoParcela:'Fixa',inicioParcelas:anoMes(2),dataVenda:anoMes(1),parcelas:[]});
  guardarDemo();
  TELAS._gestao={ano:String(ano),mes:'',conta:'',escopo:'todos',secao:'receber',q:''};
  if(!location.hash)location.hash='#/financeiro';
})();
