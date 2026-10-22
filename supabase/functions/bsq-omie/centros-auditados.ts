// Vinculação auditada de departamentos. Mantém as mesmas permissões de direção
// e o mecanismo de reserva/retomada do executor de correções existente.
const clone=(x:any)=>JSON.parse(JSON.stringify(x));
const canon=(x:any):string=>JSON.stringify(x===undefined?null:Array.isArray(x)?x.map(v=>JSON.parse(canon(v))):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>[k,JSON.parse(canon(x[k]))])):x);
const same=(a:any,b:any)=>canon(a)===canon(b);
const controles=new Set(['info','baixar_documento','conciliar_documento','aprendizado_rateio']);
const readonly=new Set(['info','status_titulo','id_origem','valor_pag','operacao','pagamento','pagamentos','baixas']);
const partes=(r:any)=>(r?.distribuicao||[]).map((p:any)=>({cCodDep:String(p.cCodDep),nPerDep:Number(p.nPerDep),nValDep:Math.round(Number(p.nValDep)*100)/100})).sort((a:any,b:any)=>a.cCodDep.localeCompare(b.cCodDep));
function resposta(r:any){if(!r||r.faultstring||r.faultcode)throw Error('Omie: '+String(r?.faultstring||r?.faultcode||'resposta ausente'));}
function validar(r:any,id:string){resposta(r);if(String(r.codigo_lancamento_omie)!==id||r.status_titulo==='CANCELADO')throw Error('Título divergente ou cancelado.');for(const k of ['codigo_cliente_fornecedor','id_conta_corrente','valor_documento','data_vencimento','data_previsao','data_emissao','data_entrada'])if(r[k]==null||String(r[k])==='')throw Error('Campo protegido ausente: '+k);if(!(Number(r.valor_documento)>0))throw Error('Valor inválido.');}
function protegido(atual:any,antes:any){for(const k of Object.keys(antes))if(k!=='distribuicao'&&!controles.has(k)&&!same(atual[k],antes[k]))throw Error('Campo protegido divergiu: '+k);}
function validarDestino(distrib:any,valor:number){
  // Esta operação só admite finalidade exclusiva comprovada. Rateios
  // compartilhados exigem um plano próprio; nunca inferidos pela categoria.
  if(!Array.isArray(distrib)||distrib.length!==1)throw Error('Exige um destino exclusivo comprovado.');
  const p=distrib[0];if(Object.keys(p).some(k=>!['cCodDep','cDesDep','nPerDep','nValDep'].includes(k))||!/^\d+$/.test(String(p.cCodDep))||!p.cDesDep||Number(p.nPerDep)!==100||Math.round(Number(p.nValDep)*100)!==Math.round(valor*100))throw Error('Destino, percentual ou valor do rateio inválido.');
}
export async function enviarCentroAuditado(omie:any,snapshot:any,plano:any,guardar:any,signal?:AbortSignal){
  const permitidos=['modo','id','categoriaAnterior','observacaoAnterior','distribuicaoNova','distribuicaoAnterior','evidencia'];
  if(plano?.modo!=='centros'||Object.keys(plano).some(k=>!permitidos.includes(k))||!plano.evidencia)throw Error('Plano de centro inválido.');
  const id=String(plano.id);if(!/^\d+$/.test(id)||!Number.isSafeInteger(Number(id)))throw Error('ID inválido.');
  validar(snapshot,id);validarDestino(plano.distribuicaoNova,Number(snapshot.valor_documento));
  const anterior=plano.distribuicaoAnterior;
  if(anterior!==undefined){validarDestino(anterior,Number(snapshot.valor_documento));if(anterior[0].cDesDep!=='Conferência')throw Error('Só permite retirar rateio provisório de Conferência.');}
  const coincide=(r:any,d:any)=>same(partes(r),partes({distribuicao:d||[]}));
  if((snapshot.distribuicao||[]).length&&!coincide(snapshot,plano.distribuicaoNova)&&!coincide(snapshot,anterior))throw Error('Rateio anterior existente; requer revisão.');
  if(anterior&&!coincide(snapshot,anterior)&&!coincide(snapshot,plano.distribuicaoNova))throw Error('Rateio provisório não corresponde à fonte.');
  if(String(snapshot.codigo_categoria||'')!==plano.categoriaAnterior||String(snapshot.observacao||'')!==plano.observacaoAnterior)throw Error('Fonte do plano mudou.');
  const atual=await omie('financas/contapagar','ConsultarContaPagar',{codigo_lancamento_omie:Number(id)},signal);
  validar(atual,id);protegido(atual,snapshot);
  const esperado=clone(atual);esperado.distribuicao=clone(plano.distribuicaoNova);
  if(same(partes(atual),partes(esperado)))return {situacao:'aguardando_conferencia',idempotente:true,enviada:false,antes:clone(atual),esperado,resposta:null};
  if(!coincide(atual,anterior))throw Error('Rateio concorrente; nenhuma alteração enviada.');
  const payload:any={};for(const[k,v]of Object.entries(esperado))if(!readonly.has(k)&&!controles.has(k))payload[k]=clone(v);
  payload.baixar_documento='N';payload.conciliar_documento='N';payload.aprendizado_rateio='N';
  await guardar({fase:'antes',id,plano:clone(plano),antes:clone(atual),payload:clone(payload)});
  const r=await omie('financas/contapagar','AlterarContaPagar',payload,signal);resposta(r);
  if(String(r.codigo_status)!=='0'||r.codigo_lancamento_omie!=null&&String(r.codigo_lancamento_omie)!==id)throw Error('Envio inconclusivo; conferir antes de repetir.');
  return{situacao:'aguardando_conferencia',idempotente:false,enviada:true,antes:clone(atual),esperado,resposta:clone(r)};
}
export function confirmarCentroAuditado(antes:any,esperado:any,depois:any){
  const id=String(antes?.codigo_lancamento_omie);validar(antes,id);validar(esperado,id);validar(depois,id);
  validarDestino(esperado.distribuicao,Number(antes.valor_documento));protegido(esperado,antes);protegido(depois,antes);
  for(const k of Object.keys(depois))if(k!=='distribuicao'&&!controles.has(k)&&!same(depois[k],esperado[k]))throw Error('Conferência divergente: '+k);
  if(!same(partes(depois),partes(esperado)))throw Error('Distribuição não confirmada.');
  return{situacao:'conferida',conferida:true,antes:clone(antes),esperado:clone(esperado),depois:clone(depois)};
}
