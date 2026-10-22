// Correção estrita de texto/categoria; nunca baixa, concilia ou recria títulos.
// Contrato oficial consultado: financas/contapagar:AlterarContaPagar.
// Datas históricas seguem intactas: uma recusa do ERP exige revisão, não uma
// segunda tentativa com datas/valores modificados para contornar a validação.
type PlanoCorrecao = {
  id:string|number;categoriaAnterior:string;observacaoAnterior:string;
  categoriaNova?:string;observacaoNova?:string;evidencia:string|Record<string,unknown>;
};
const copiar=(v:any):any=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
const canonico=(v:any):string=>JSON.stringify(v===undefined?null:Array.isArray(v)?v.map(x=>JSON.parse(canonico(x))):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,JSON.parse(canonico(v[k]))])):v);
const igual=(a:any,b:any)=>canonico(a)===canonico(b);
const obs=(r:any)=>String(r?.observacao??'');
const mutaveis=new Set(['codigo_categoria','observacao','categorias']);
const acoes=new Set(['baixar_documento','conciliar_documento']);
const somenteConsulta=new Set(['info','status_titulo','id_origem','valor_pag','operacao']);
const dadosBaixa=new Set(['pagamento','pagamentos','baixas']);
const chavesPlano=new Set(['id','categoriaAnterior','observacaoAnterior','categoriaNova','observacaoNova','evidencia']);
function erroResposta(r:any,operacao:string){
  if(!r||typeof r!=='object'||Array.isArray(r))throw new Error('Resposta não confirmada do Omie em '+operacao+'.');
  if(r.faultstring||r.faultcode)throw new Error('Omie '+operacao+': '+String(r.faultstring||r.faultcode));
  if(r.codigo_status!=null&&String(r.codigo_status)!=='0')throw new Error('Omie '+operacao+': '+String(r.descricao_status||r.codigo_status));
}
function validarRegistro(r:any,id:string){
  erroResposta(r,'ConsultarContaPagar');
  if(String(r.codigo_lancamento_omie)!==id)throw new Error('Identificador da conta a pagar diverge do snapshot.');
  for(const k of ['codigo_cliente_fornecedor','id_conta_corrente','valor_documento','data_vencimento','data_previsao','data_emissao','data_entrada'])
    if(r[k]==null||String(r[k]).trim()===''||(['codigo_cliente_fornecedor','id_conta_corrente','valor_documento'].includes(k)&&!(Number(r[k])>0)))
      throw new Error('Snapshot financeiro incompleto: '+k+'.');
}
function verificarFinanceiro(atual:any,snapshot:any){
  for(const k of Object.keys(snapshot)){
    if(k==='info'||mutaveis.has(k)||acoes.has(k))continue;
    if(!igual(atual[k],snapshot[k]))throw new Error('Mudança concorrente no snapshot financeiro: '+k+'.');
  }
}
function mesmosMutaveis(a:any,b:any){
  return String(a.codigo_categoria??'')===String(b.codigo_categoria??'')&&obs(a)===obs(b)&&igual(a.categorias,b.categorias);
}
function estadoDesejado(antes:any,plano:PlanoCorrecao){
  const depois=copiar(antes);
  if(plano.observacaoNova!==undefined)depois.observacao=plano.observacaoNova;
  if(plano.categoriaNova!==undefined&&plano.categoriaNova!==String(antes.codigo_categoria??'')){
    const partes=antes.categorias;
    if(partes!=null&&!Array.isArray(partes))throw new Error('Rateio de categorias inválido; revisão necessária.');
    if(partes?.length){
      if(partes.length!==1||Number(partes[0].percentual)!==100||String(partes[0].codigo_categoria)!==String(antes.codigo_categoria))
        throw new Error('Reclassificação exige uma única categoria de 100%; rateio preservado para revisão.');
      depois.categorias=partes.map((p:any)=>({...p,codigo_categoria:plano.categoriaNova}));
    }
    depois.codigo_categoria=plano.categoriaNova;
  }
  return depois;
}
function comparavel(r:any){
  return Object.fromEntries(Object.entries(r).filter(([k])=>k!=='info'&&!acoes.has(k)));
}

// Fase 1: uma única ConsultarContaPagar antes do envio. O Omie bloqueia uma
// consulta idêntica repetida em menos de 60 segundos (REDUNDANT). Por isso não
// se faz segunda consulta nem readback imediato: o lote inteiro será conferido
// por ListarContasPagar integral, usando a função pura abaixo.
// guardarEvidencia deve persistir o snapshot/payload antes da chamada mutável.
// Qualquer erro após envio é inconclusivo; não há retry nem reversão automática.
export async function enviarCorrecaoAuditada(
  consultarOmie:any,antesSnapshot:any,plano:PlanoCorrecao,
  guardarEvidencia:any,signal?:AbortSignal,
){
  if(!plano||typeof plano!=='object'||Object.keys(plano).some(k=>!chavesPlano.has(k)))throw new Error('Plano de correção fora do escopo permitido.');
  const id=String(plano.id??'');
  if(!/^\d+$/.test(id)||!Number.isSafeInteger(Number(id))||Number(id)<=0)throw new Error('Identificador inválido no plano.');
  if(typeof plano.categoriaAnterior!=='string'||typeof plano.observacaoAnterior!=='string'||
    plano.categoriaNova!==undefined&&(typeof plano.categoriaNova!=='string'||!plano.categoriaNova.trim())||
    plano.observacaoNova!==undefined&&typeof plano.observacaoNova!=='string')throw new Error('Texto ou categoria inválidos no plano.');
  const evidencia=plano.evidencia;
  if(!evidencia||typeof evidencia==='string'&&!evidencia.trim()||typeof evidencia!=='string'&&(typeof evidencia!=='object'||Array.isArray(evidencia)||!Object.keys(evidencia).length))throw new Error('Evidência da correção é obrigatória.');
  if(typeof consultarOmie!=='function'||typeof guardarEvidencia!=='function')throw new Error('Consulta e gravação de evidência são obrigatórias.');
  validarRegistro(antesSnapshot,id);
  // Evidência real de 22/10: AlterarContaPagar acrescenta uma observação
  // diferente à anterior, separada por pipe. Não serve para substituir texto.
  // A revisão de grafia exige edição na origem; nunca reenviar para tentar limpar.
  if(String(antesSnapshot.status_titulo||'')==='CANCELADO')throw new Error('Título cancelado preservado; nenhuma alteração será enviada.');
  if(plano.observacaoNova!==undefined&&plano.observacaoNova!==obs(antesSnapshot))
    throw new Error('O Omie acrescenta observações em vez de substituir. Revisão de texto pendente na origem; nenhuma alteração enviada.');
  if(String(antesSnapshot.codigo_categoria??'')!==plano.categoriaAnterior||obs(antesSnapshot)!==plano.observacaoAnterior)throw new Error('Categoria/observação anterior divergem do snapshot.');
  const snapshot=copiar(antesSnapshot),desejadoSnapshot=estadoDesejado(snapshot,plano);
  const atual=await consultarOmie('financas/contapagar','ConsultarContaPagar',{codigo_lancamento_omie:Number(id)},signal);
  validarRegistro(atual,id);verificarFinanceiro(atual,snapshot);
  if(mesmosMutaveis(atual,desejadoSnapshot))return{situacao:'aguardando_conferencia',idempotente:true,enviada:false,antes:copiar(atual),esperado:copiar(atual),resposta:null};
  if(!mesmosMutaveis(atual,snapshot))throw new Error('Mudança concorrente na categoria ou observação; correção não enviada.');
  const esperado=estadoDesejado(atual,plano),payload:any={};
  for(const [k,v]of Object.entries(esperado))if(!somenteConsulta.has(k)&&!dadosBaixa.has(k)&&!acoes.has(k))payload[k]=copiar(v);
  payload.baixar_documento='N';payload.conciliar_documento='N';
  await guardarEvidencia({fase:'antes',id,plano:copiar(plano),antes:copiar(atual),payload:copiar(payload)});
  const resposta=await consultarOmie('financas/contapagar','AlterarContaPagar',payload,signal);
  erroResposta(resposta,'AlterarContaPagar');
  if(String(resposta.codigo_status)!=='0'||resposta.codigo_lancamento_omie!=null&&String(resposta.codigo_lancamento_omie)!==id)throw new Error('Alteração não confirmada pelo Omie; conferir antes de repetir.');
  return{situacao:'aguardando_conferencia',idempotente:false,enviada:true,antes:copiar(atual),esperado:copiar(esperado),resposta:copiar(resposta)};
}

// Fase 2: recebe UM registro da ListarContasPagar integral posterior ao lote.
// O chamador deve confirmar paginação, atualidade e unicidade da lista antes
// de chamá-la. Esta função não recebe adaptador de API e nunca faz escrita.
export function confirmarCorrecaoAuditada(antes:any,esperado:any,depoisListarAP:any){
  const id=String(antes?.codigo_lancamento_omie??'');
  if(!/^\d+$/.test(id)||!Number.isSafeInteger(Number(id))||Number(id)<=0)throw new Error('Identificador inválido no snapshot da conferência.');
  validarRegistro(antes,id);validarRegistro(esperado,id);validarRegistro(depoisListarAP,id);
  // Um estado esperado fornecido pelo chamador também não pode disfarçar
  // alterações de valor, data, impostos, conta, pessoa ou pagamentos.
  verificarFinanceiro(esperado,antes);
  const mudouCategoria=String(esperado.codigo_categoria??'')!==String(antes.codigo_categoria??'');
  const esperadoPermitido=estadoDesejado(antes,{
    id,categoriaAnterior:String(antes.codigo_categoria??''),observacaoAnterior:obs(antes),
    ...(mudouCategoria?{categoriaNova:String(esperado.codigo_categoria)}:{}),
    ...(Object.prototype.hasOwnProperty.call(esperado,'observacao')?{observacaoNova:obs(esperado)}:{}),
    evidencia:'Conferência do estado esperado após envio auditado',
  });
  if(!igual(comparavel(esperado),comparavel(esperadoPermitido)))throw new Error('Estado esperado fora da correção autorizada de categoria/observação.');
  if(!igual(comparavel(depoisListarAP),comparavel(esperado)))throw new Error('Conferência após alteração divergiu: campos não preservados ou correção não confirmada. Não repetir automaticamente.');
  return{situacao:'conferida',conferida:true,antes:copiar(antes),esperado:copiar(esperado),depois:copiar(depoisListarAP)};
}
