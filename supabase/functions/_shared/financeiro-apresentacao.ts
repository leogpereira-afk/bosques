// Campos da origem necessários à leitura financeira; sem projetos e sem segredos.
export function camposFinanceiros(registro:any, referencias:any={}) {
  const o=registro.original||registro.omie?.original||{},d=o.detalhes||{};
  const codigo=String(d.cCodCateg||registro.omie?.categoria||'');
  const pessoa=referencias.pessoas?.[String(d.nCodCliente)]||'';
  return {
    categoriaCodigo:codigo,categoriaNome:referencias.categorias?.[codigo]||'',
    pessoaCodigo:String(d.nCodCliente||''),pessoaNome:pessoa,
    documento:String(d.cNumTitulo||''),observacao:String(d.observacao||''),
    contaCodigo:String(d.nCodCC||registro.contaOmie||''),
    dataPagamento:String(d.dDtPagamento||''),dataCredito:String(d.dDtCredito||''),
    dataVencimento:String(d.dDtVenc||''),dataEmissao:String(d.dDtEmissao||''),
    centros:(o.departamentos||[]).map((c:any)=>({codigo:String(c.cCodDepartamento||''),nome:referencias.centros?.[String(c.cCodDepartamento)]||'',percentual:Number(c.nDistrPercentual)||0,valor:Number(c.nDistrValor)||0})),
    categorias:(o.categorias||[]).map((c:any)=>({codigo:String(c.cCodCateg||''),nome:referencias.categorias?.[String(c.cCodCateg)]||'',percentual:Number(c.nDistrPercentual)||0,valor:Number(c.nDistrValor)||0})),
  };
}
