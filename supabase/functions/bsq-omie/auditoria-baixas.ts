// Consulta somente leitura. Contrato oficial consultado em 22/10/2026:
// https://app.omie.com.br/api/v1/financas/mf/
// BXCP = baixas de contas a pagar; identificador da baixa = detalhes.nCodBaixa.
// Um título pode ter várias baixas; nunca usar só nCodTitulo para deduplicar.
const inteiro=(v:any):number|null=>
  !['number','string'].includes(typeof v)||String(v).trim()===''||!/^\d+$/.test(String(v))||!Number.isSafeInteger(Number(v))?null:Number(v);
const idValido=(v:any)=>inteiro(v)!==null&&Number(v)>0;
const numeroInformado=(v:any)=>v!=null&&['number','string'].includes(typeof v)&&String(v).trim()!==''&&Number.isFinite(Number(v));
function dataPagamentoValida(v:any){
  if(typeof v!=='string'||!/^\d{2}\/\d{2}\/\d{4}$/.test(v))return false;
  const iso=v.slice(6)+'-'+v.slice(3,5)+'-'+v.slice(0,2),data=new Date(iso+'T12:00:00Z');
  return !Number.isNaN(data.getTime())&&data.toISOString().slice(0,10)===iso;
}

// Não altera nada no ERP nem no espelho financeiro. O chamador só persiste a
// evidência completa retornada; falhas/leituras parciais não substituem a válida.
export async function lerBaixasIntegral(consultar:any,signal?:AbortSignal){
  const registros:any[]=[],idsBaixas=new Set<string>(),idsTitulos=new Set<string>();
  let totalEsperado:number|null=null,paginasEsperadas:number|null=null;
  const diagnostico={semConta:0,semDataPagamento:0,semCodigoMovimento:0,semValorMovimento:0,camposDaBaixaCompletos:true};
  for(let pagina=1;pagina<=1000;pagina++){
    if(signal?.aborted)throw new Error('Consulta integral de baixas interrompida.');
    const r=await consultar('financas/mf','ListarMovimentos',{
      nPagina:pagina,nRegPorPagina:50,cTpLancamento:'BXCP',
      cExibirDepartamentos:'S',lDadosCad:true,cOrdenarPor:'CODIGO',
    },signal);
    if(!r||typeof r!=='object'||r.faultcode||r.faultstring)throw new Error('Omie ListarMovimentos BXCP: '+String(r?.faultstring||r?.faultcode||'resposta inválida'));
    const total=inteiro(r.nTotRegistros),paginas=inteiro(r.nTotPaginas),paginaRetornada=inteiro(r.nPagina);
    const lista=r.movimentos==null&&total===0?[]:r.movimentos;
    if(total===null||paginas===null||paginaRetornada!==pagina||!Array.isArray(lista)||lista.length>50||
      totalEsperado!==null&&total!==totalEsperado||paginasEsperadas!==null&&paginas!==paginasEsperadas||
      total>0&&(!lista.length||paginas<1||pagina>paginas)||
      total===0&&(lista.length||pagina!==1||paginas>1)||
      r.nRegistros!=null&&inteiro(r.nRegistros)!==lista.length)
      throw new Error('Leitura integral de baixas incompleta ou alterada durante a consulta.');
    totalEsperado=total;paginasEsperadas=paginas;
    for(const item of lista){
      const d=item?.detalhes;
      if(!d||!idValido(d.nCodBaixa)||!idValido(d.nCodTitulo)||d.cNatureza!=='P')
        throw new Error('Baixa de conta a pagar sem identificadores documentados ou fora do filtro BXCP.');
      const id=String(Number(d.nCodBaixa));
      if(idsBaixas.has(id))throw new Error('Código de baixa repetido na leitura integral BXCP.');
      idsBaixas.add(id);idsTitulos.add(String(Number(d.nCodTitulo)));registros.push(item);
      if(!idValido(d.nCodCC))diagnostico.semConta++;
      if(!dataPagamentoValida(d.dDtPagamento))diagnostico.semDataPagamento++;
      if(!idValido(d.nCodMovCC))diagnostico.semCodigoMovimento++;
      // resumo.nValPago é o total do TÍTULO e pode repetir em baixas parciais.
      // Não substitui um nValorMovCC ausente nem gera soma artificial de baixas.
      if(!numeroInformado(d.nValorMovCC))diagnostico.semValorMovimento++;
    }
    if(total===0||pagina>=paginas){
      if(registros.length!==totalEsperado)throw new Error('Quantidade de baixas lidas não corresponde ao total informado pelo Omie.');
      diagnostico.camposDaBaixaCompletos=!(diagnostico.semConta||diagnostico.semDataPagamento||diagnostico.semCodigoMovimento||diagnostico.semValorMovimento);
      return{schema:1,tipo:'BXCP',total:registros.length,totalTitulos:idsTitulos.size,paginas:pagina,completo:true,
        identificadorUnico:'detalhes.nCodBaixa',registros,diagnostico,
        criterio:'Paginação integral e IDs de baixa únicos; campos ausentes permanecem ausentes. Não comprova conciliação bancária externa.'};
    }
  }
  throw new Error('Consulta de baixas excedeu o limite de páginas; nenhuma leitura integral confirmada.');
}
