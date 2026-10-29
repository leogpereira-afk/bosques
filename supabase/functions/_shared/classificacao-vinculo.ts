// Decisão humana de vínculo, independente da categoria contábil e do caixa.
// Nenhuma escrita aqui: o comando auditável é aplicado na RPC transacional.
export function classificacaoEntrada(registro:any, titulo:any=null) {
  const c=titulo?.classificacaoVinculo??registro?.classificacaoVinculo;
  return c&&['sem_venda','pendente'].includes(c.tipo)?c:null;
}
export function entradaSemVenda(registro:any, titulo:any=null) {
  return classificacaoEntrada(registro,titulo)?.tipo==='sem_venda';
}
export function vinculoAutomaticoBloqueado(registro:any, titulo:any=null) {
  return !!classificacaoEntrada(registro,titulo);
}
export function preservarVinculoClassificado(registro:any, anterior:any, titulo:any=null) {
  const c=classificacaoEntrada(anterior,titulo);
  if(!c)return registro;
  return {...registro,classificacaoVinculo:{...c},vendaId:'',alocacoes:[],parcelaN:null,
    conferir:c.tipo==='pendente',obsConferir:c.tipo==='pendente'?'Classificação reaberta: aguarda conferência manual.':''};
}
const canonico=(x:any):string=>JSON.stringify(x==null?null:Array.isArray(x)?x.map(v=>JSON.parse(canonico(v))):
  typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canonico(x[k]))])):x);
export function erroEdicaoClassificacaoVinculo(atual:any, registro:any) {
  if(Object.hasOwn(registro||{},'classificacaoVinculo')&&canonico(atual?.classificacaoVinculo)!==canonico(registro.classificacaoVinculo))
    return 'Use a confirmação ou a reabertura auditável para alterar a classificação do vínculo.';
  if(entradaSemVenda(atual))for(const campo of ['vendaId','alocacoes','parcelaN']){
    if(Object.hasOwn(registro||{},campo)&&canonico(registro[campo])!==canonico(atual?.[campo]))
      return 'Entrada confirmada sem venda: reabra a conferência antes de associar contrato ou parcela.';
  }
  return '';
}
