// Somente distribuição de despesa bancária direta: nunca baixa ou transferência.
const cp=(x:any)=>JSON.parse(JSON.stringify(x));
const canon=(x:any):string=>JSON.stringify(x==null?null:Array.isArray(x)?x.map(v=>JSON.parse(canon(v))):typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canon(x[k]))])):x);
const igual=(a:any,b:any)=>canon(a)===canon(b);
const cent=(v:any)=>Math.round(Number(v)*100);
const partes=(r:any)=>(r.departamentos||[]).map((x:any)=>({cCodDep:String(x.cCodDep),nPerDep:Number(x.nPerDep),nValDep:Number(x.nValDep)})).sort((a:any,b:any)=>a.cCodDep.localeCompare(b.cCodDep));
function resposta(r:any){if(!r||r.faultcode||r.faultstring)throw Error('Omie: '+String(r?.faultstring||r?.faultcode||'resposta ausente'));}
function proteger(a:any,b:any){for(const k of new Set([...Object.keys(a),...Object.keys(b)]))if(!['info','departamentos'].includes(k)&&!igual(a[k],b[k]))throw Error('Campo bancário protegido divergiu: '+k);}
function validar(r:any,id:string){resposta(r);if(String(r.nCodLanc)!==id||r.diversos?.cOrigem!=='EXTP'||r.diversos?.cNatureza!=='P'||r.diversos?.nCodLancCP||r.diversos?.nCodLancCR||r.transferencia?.nCodCCDestino)throw Error('Exige despesa bancária direta, sem título ou transferência.');if(!r.cabecalho?.nCodCC||!r.cabecalho?.dDtLanc||!(Number(r.cabecalho.nValorLanc)>0))throw Error('Identidade financeira incompleta.');}
export async function enviarCentroBancario(omie:any,snapshot:any,plano:any,guardar:any,signal?:AbortSignal){
  const permitidos=['modo','id','distribuicaoNova','evidencia'];
  if(plano?.modo!=='centros_cc'||Object.keys(plano).some(k=>!permitidos.includes(k))||!plano.evidencia||!/^\d+$/.test(plano.id))throw Error('Plano bancário inválido.');
  const id=String(plano.id),d=snapshot?.original?.detalhes,p=plano.distribuicaoNova;
  if(snapshot?.apagadoEm||snapshot?.entrada||snapshot?.transferencia||String(d?.nCodMovCC)!==id||d?.cOrigem!=='EXTP'||d?.cNatureza!=='P'||d?.nCodTitulo)throw Error('Fonte bancária divergente.');
  if(!Array.isArray(p)||p.length!==1||Object.keys(p[0]).some(k=>!['cCodDep','cDesDep','nPerDep','nValDep'].includes(k))||!/^\d+$/.test(String(p[0].cCodDep))||!p[0].cDesDep||p[0].nPerDep!==100||cent(p[0].nValDep)!==cent(snapshot.valor))throw Error('Rateio bancário inválido.');
  const antes=await omie('financas/contacorrentelancamentos','ConsultaLancCC',{nCodLanc:Number(id)},signal);validar(antes,id);
  const c=antes.cabecalho;
  if(String(c.nCodCC)!==String(d.nCodCC)||c.dDtLanc!==d.dDtPagamento||cent(c.nValorLanc)!==cent(d.nValorMovCC)||cent(snapshot.valor)!==cent(c.nValorLanc)||String(antes.detalhes?.cCodCateg||'')!==String(d.cCodCateg||''))throw Error('Conta, data, valor ou categoria mudou.');
  const esperado=cp(antes);esperado.departamentos=p.map(({cCodDep,nPerDep,nValDep}:any)=>({cCodDep,nPerDep,nValDep}));
  if(igual(partes(antes),partes(esperado)))return {situacao:'aguardando_conferencia',idempotente:true,enviada:false,antes,esperado};
  if(partes(antes).length)throw Error('Rateio bancário anterior exige revisão.');
  const payload:any={};for(const k of ['nCodLanc','cCodIntLanc','cabecalho','detalhes','departamentos'])if(esperado[k]!=null)payload[k]=cp(esperado[k]);
  await guardar({fase:'antes',id,plano:cp(plano),antes:cp(antes),payload:cp(payload)});
  const r=await omie('financas/contacorrentelancamentos','AlterarLancCC',payload,signal);resposta(r);
  if(String(r.cCodStatus)!=='0'||String(r.nCodLanc)!==id)throw Error('Envio bancário inconclusivo; consultar antes de repetir.');
  return {situacao:'aguardando_conferencia',idempotente:false,enviada:true,antes,esperado,resposta:cp(r)};
}
export function confirmarCentroBancario(antes:any,esperado:any,depois:any){
  const id=String(antes?.nCodLanc);validar(antes,id);validar(esperado,id);validar(depois,id);proteger(antes,esperado);proteger(antes,depois);
  if(!igual(partes(esperado),partes(depois)))throw Error('Distribuição bancária não confirmada.');
  return {situacao:'conferida',conferida:true,antes:cp(antes),esperado:cp(esperado),depois:cp(depois)};
}
