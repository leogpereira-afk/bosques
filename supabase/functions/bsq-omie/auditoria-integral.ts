// Consulta independente e integral. Nenhuma alteração é enviada ao ERP.
// Contrato oficial: financas/contapagar:ListarContasPagar (exibir_obs=S).
export async function lerPagarIntegral(consultar:any,signal?:AbortSignal) {
  const registros:any[]=[],vistos=new Set<string>();let esperado:number|null=null,paginasEsperadas:number|null=null;
  for(let pagina=1;pagina<=1000;pagina++){
    const r=await consultar('financas/contapagar','ListarContasPagar',{
      pagina,registros_por_pagina:50,apenas_importado_api:'N',exibir_obs:'S',
      ordenar_por:'CODIGO',ordem_descrescente:'N',
    },signal);
    const total=Number(r.total_de_registros),paginas=Number(r.total_de_paginas);
    const lista=r.conta_pagar_cadastro==null&&total===0?[]:r.conta_pagar_cadastro;
    if(r.total_de_registros==null||r.total_de_paginas==null||!Number.isInteger(total)||total<0||
      !Number.isInteger(paginas)||paginas<0||Number(r.pagina)!==pagina||!Array.isArray(lista)||
      esperado!==null&&total!==esperado||paginasEsperadas!==null&&paginas!==paginasEsperadas||
      total>0&&(!lista.length||pagina>paginas)||total===0&&(lista.length||pagina!==1))
      throw new Error('Leitura integral de contas a pagar incompleta ou alterada durante a consulta.');
    esperado=total;paginasEsperadas=paginas;
    for(const item of lista){const id=String(item?.codigo_lancamento_omie||'');
      if(!/^\d+$/.test(id)||id==='0'||vistos.has(id))throw new Error('Conta a pagar sem identificador único na consulta integral.');
      vistos.add(id);registros.push(item);
    }
    if(total===0||pagina>=paginas){
      if(registros.length!==esperado)throw new Error('Total lido não corresponde ao total informado pelo Omie.');
      return {total:registros.length,paginas:pagina,completo:true,registros};
    }
  }
  throw new Error('Consulta integral excedeu o limite de páginas; leitura não confirmada.');
}
