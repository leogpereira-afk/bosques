// Uma ausência só retira um espelho do total quando duas leituras da origem
// concordam. Não exclui registros nem escreve no ERP.
const cent=(v:any)=>Math.round(Number(v)*100);
const dia=(v:any)=>/^\d{2}\/\d{2}\/\d{4}$/.test(v||'')?v.slice(6)+'-'+v.slice(3,5)+'-'+v.slice(0,2):String(v||'').slice(0,10);
export function planoRevisao(registros:any[],movimentos:any[],e:any){
  if(!e?.completo||e.saldoInicial==null||e.saldoFinalExtrato==null)throw new Error('Extrato incompleto; nenhuma correção aplicada.');
  const locais=registros.filter(r=>r.origem==='omie'&&!r.apagadoEm&&String(r.contaOmie)===e.conta&&r.data>=e.de&&r.data<=e.ate);
  const vistos=new Set<string>();let net=0;
  for(const m of movimentos){const d=m.detalhes||{},id='banco-'+d.nCodMovCC,dt=dia(d.dDtPagamento),valor=Number(d.nValorMovCC);
    if(!String(d.cGrupo||'').startsWith('CONTA_CORRENTE')||!d.nCodMovCC||vistos.has(id)||String(d.nCodCC)!==e.conta||dt<e.de||dt>e.ate||!Number.isFinite(valor)||!['R','P'].includes(d.cNatureza))throw new Error('Movimentos da origem inconsistentes; nenhuma correção aplicada.');
    vistos.add(id);const r=locais.find(x=>x.id===id),ex=e.trilha.find((x:any)=>x.id===String(d.nCodMovCC));
    if(!r||r.omitidoOmie||r.data!==dt||cent(r.valor)!==cent(valor)||r.entrada!==(d.cNatureza==='R')||!ex||(ex.natureza==='P'?Math.abs(cent(ex.valor)):cent(ex.valor))!==cent(valor)||ex.natureza!==d.cNatureza)throw new Error('Sincronize primeiro: movimento atual ausente ou diferente na importação/extrato.');
    net+=(d.cNatureza==='R'?1:-1)*cent(valor);
  }
  // Sem compensação automática de diferença: o total da origem deve fechar.
  const implantacoes=e.trilha.filter((t:any)=>t.origem==='Cadastro da Conta Corrente'&&t.bloqueado&&t.data===e.cadastro?.dataInicial&&['R','P'].includes(t.natureza));
  const implantacao=implantacoes.length===1&&cent(e.cadastro?.saldoInicial)===(implantacoes[0].natureza==='R'?1:-1)*Math.abs(cent(implantacoes[0].valor))?cent(e.cadastro.saldoInicial):0;
  if(cent(e.saldoInicial)+net+implantacao!==cent(e.saldoFinalExtrato))throw new Error('A origem ainda não fecha com o extrato; nenhuma correção aplicada.');
  const retirar=locais.filter(r=>!r.omitidoOmie&&!vistos.has(r.id));
  if(retirar.some(r=>e.trilha.some((t:any)=>t.id===r.id.replace(/^banco-/,''))))throw new Error('Movimento ausente da lista, mas presente no extrato; nenhuma correção aplicada.');
  return {retirar,quantidadeOrigem:vistos.size,liquido:net/100};
}
