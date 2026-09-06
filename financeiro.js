/* Uma área financeira; filtros e exportação consultam o mesmo recorte. */
const FIN_ABAS = {visao:'Visão geral',recebimentos:'Recebimentos',despesas:'Despesas',receber:'Contas a receber',pagar:'Contas a pagar',diferencas:'Diferenças com Omie',centros:'Centros de custo',contas:'Contas e conciliação',pendencias:'Pendências e sincronização'};
// A cor acompanha a natureza do lançamento, inclusive nas listas mistas.
function finCor(x={},aba='') {
  if (x.transferencia) return '';
  if (['recebimentos','receber'].includes(aba)) return 'fin-entrada';
  if (['despesas','pagar'].includes(aba)) return 'fin-saida';
  const tipo=x.cx?.tipo || x.tipo;
  if (tipo==='saida' || x.obrigacao || x.comissao || x.titulo?.grupo==='CONTA_A_PAGAR') return 'fin-saida';
  if (tipo==='entrada' || x.rec || x.titulo?.grupo==='CONTA_A_RECEBER') return 'fin-entrada';
  if (typeof x.entrada==='boolean') return x.entrada?'fin-entrada':'fin-saida';
  return x.vendaId?'fin-entrada':'';
}
function finCorTotal(linhas,aba='') {
  const corAba=finCor({},aba);
  if(corAba) return corAba;
  const cores=new Set(linhas.map(x=>finCor(x)));
  return cores.size===1?[...cores][0]:'';
}
function finSaida(valor) { return finValor(valor,'fin-saida'); }
function finEntrada(valor) { return finValor(valor,'fin-entrada'); }
function finAtraso(valor) { return finValor(valor,'fin-atraso'); }
function finResultado(valor) { return finValor(valor,valor<0?'fin-saida':'fin-entrada'); }
function finValor(valor,cor) { return '<span class="'+cor+'">'+fmt.brl(valor)+'</span>'; }
function finIndices(){
  const vendas=lista('venda').filter(v=>v.situacao!=='distratada'), titulos=lista('titulo');
  const porVenda=new Map(vendas.map(v=>[v.id,v])),porTitulo=new Map(),porParcela=new Map();
  for(const t of titulos)porTitulo.set(t.grupo+'|'+t.titulo,t);
  for(const v of vendas)for(const [i,p] of (v.parcelas||[]).entries())if(p&&!p.cancelado){const k=String(p.tid);if(!porParcela.has(k))porParcela.set(k,[]);porParcela.get(k).push({v,p,i});}
  const pagamentos={rec:new Map(),cx:new Map()};
  for(const col of ['rec','cx'])for(const r of lista(col)){const tid=r.omie?.titulo || (String(r.id).startsWith(col==='rec'?'rbomie-':'cxomie-')?String(r.id).split('-').pop():null);if(tid){const k=String(tid);const arr=pagamentos[col].get(k)||[];arr.push(r);pagamentos[col].set(k,arr);}}
  return {vendas,titulos,porVenda,porTitulo,porParcela,pagamentos};
}
const finDataOrigem=d=>/^\d{2}\/\d{2}\/\d{4}$/.test(d||'')?d.slice(6)+'-'+d.slice(3,5)+'-'+d.slice(0,2):d||'';
function finDiferencas(ctx=finIndices()){
  const out=[];
  for(const t of ctx.titulos){
    const col=t.grupo==='CONTA_A_RECEBER'?'rec':'cx', locais=ctx.pagamentos[col].get(String(t.titulo))||[];
    const fonte=t.status==='CANCELADO'?0:FINANCEIRO.cent(t.original?.resumo?.nValLiquido??t.pago),local=locais.reduce((s,r)=>s+FINANCEIRO.cent(r.valor),0);
    const data=finDataOrigem(t.original?.detalhes?.dDtPagamento)||t.venc;
    if(fonte!==local)out.push({id:'valor-'+t.id,data,valor:(fonte-local)/100,valorOmie:fonte/100,valorSistema:local/100,descricao:(col==='rec'?'Recebimento':'Despesa')+' · título '+t.titulo,situacao:!locais.length?'Consta no Omie, sem lançamento correspondente':'Valor diferente do Omie',titulo:t,origemDiferenca:true,pendente:true});
    else if(locais.length&&data&&locais.some(r=>r.data!==data))out.push({id:'data-'+t.id,data,valor:0,valorOmie:fonte/100,valorSistema:local/100,descricao:'Título '+t.titulo,situacao:'Data diferente da origem',titulo:t,origemDiferenca:true,pendente:true});
    if(t.ajustes&&(FINANCEIRO.cent(t.ajustes.valor)!==FINANCEIRO.cent(t.valor)||t.ajustes.venc!==t.venc))out.push({id:'ajuste-'+t.id,data:t.ajustes.venc,valor:Math.abs(FINANCEIRO.cent(t.ajustes.valor)-FINANCEIRO.cent(t.valor))/100,descricao:'Título '+t.titulo,situacao:'Correção local de valor ou vencimento',titulo:t,pendente:true});
    if(t.grupo==='CONTA_A_RECEBER')for(const {v,p,i} of ctx.porParcela.get(String(t.titulo))||[]){
      if(p.trava && (FINANCEIRO.cent(p.valor)!==FINANCEIRO.cent(t.valor)||p.venc!==t.venc))out.push({id:'ajuste-'+v.id+'-'+t.titulo,data:p.venc,valor:Math.abs(FINANCEIRO.cent(p.valor)-FINANCEIRO.cent(t.valor))/100,descricao:(v.codigo||'Venda')+' · '+(v.clienteNome||'')+' · parcela '+(i+1),situacao:'Parcela corrigida localmente difere do Omie',vendaId:v.id,parcela:i,pendente:true});
    }
  }
  for(const col of ['rec','cx'])for(const r of lista(col)){
    const tid=r.omie?.titulo;
    if(!tid)out.push({id:'manual-'+r.id,data:r.data,valor:Number(r.valor)||0,descricao:r.descricao||r.codigo||'Lançamento manual',situacao:'Lançamento local sem correspondência por identificador no Omie',...(col==='rec'?{rec:r}:{cx:r}),pendente:true});
    else if(!ctx.porTitulo.has((col==='rec'?'CONTA_A_RECEBER':'CONTA_A_PAGAR')+'|'+tid))out.push({id:'semorigem-'+r.id,data:r.data,valor:Number(r.valor)||0,descricao:r.descricao||r.codigo||'Lançamento',situacao:'Título não encontrado na última leitura disponível',...(col==='rec'?{rec:r}:{cx:r}),pendente:true});
  }
  return out;
}
function finPendencias(ctx=finIndices()){
  const linhas=[];
  for(const v of ctx.vendas){
    const r=resumoVenda(v);
    for(const p of r.carne)if((p.conferir && !ctx.porTitulo.has('CONTA_A_RECEBER|'+p.tid))||p.descontoPendente)linhas.push({id:v.id+'-'+p.tid,data:p.venc,valor:p.saldo||0,descricao:(v.codigo||v.id)+' · '+(v.clienteNome||'Cliente'),situacao:p.conferir?'Parcela a conferir':'Condição de desconto não confirmada',vendaId:v.id,parcela:p.n-1,pendente:true});
    if(r.naoAlocado>0)linhas.push({id:v.id+'-credito',valor:r.naoAlocado,descricao:v.clienteNome||v.id,situacao:'Recebimento sem alocação em parcela',vendaId:v.id,pendente:true});
    if(r.semEspelho)linhas.push({id:v.id+'-espelho',valor:0,descricao:v.clienteNome||v.id,situacao:'Venda sem títulos; plano é previsão',vendaId:v.id,pendente:true});
  }
  for(const r of lista('rec'))if(!r.vendaId||!r.forma||r.forma==='Não informada'||!r.contaId)linhas.push({id:r.id,data:r.data,valor:r.valor,descricao:r.codigo||'Recebimento',situacao:[!r.vendaId?'Sem lote vinculado':'',!r.contaId?'Sem conta financeira':'',!r.forma||r.forma==='Não informada'?'Forma não confirmada':''].filter(Boolean).join(' · '),rec:r,pendente:true});
  for(const c of cxVivos()){
    const probs=problemasDoLancamento({...c,col:'cx',entrada:c.tipo==='entrada',temRateio:!!c.rateio?.length});
    if(!c.contaId)probs.push('sem conta financeira');if(c.tipo==='saida'&&!c.centroCusto)probs.push('sem centro de custo');
    if(probs.length)linhas.push({id:c.id,data:c.data,valor:c.valor,descricao:c.descricao||'Despesa',situacao:[...new Set(probs)].join(' · '),cx:c,pendente:true});
  }
  for(const t of ctx.titulos)if(t.grupo==='CONTA_A_RECEBER'&&t.status!=='CANCELADO'&&!(ctx.porParcela.get(String(t.titulo))||[]).some(x=>!x.p.conferir))linhas.push({id:t.id,data:t.venc,valor:t.valor,descricao:'Título '+t.titulo,situacao:'Sem lote confirmado',titulo:t,pendente:true});
  return linhas;
}
function finLinhas(aba,ctx=finIndices()){
  if(aba==='diferencas')return finDiferencas(ctx);
  if(aba==='pendencias')return finPendencias(ctx);
  if(aba==='recebimentos')return lista('rec').map(r=>({...r,rec:r,descricao:(ctx.porVenda.get(r.vendaId)?.clienteNome||r.codigo||'Recebimento sem lote'),situacao:r.vendaId?'Q'+(ctx.porVenda.get(r.vendaId)?.quadra||'?')+' · L'+(ctx.porVenda.get(r.vendaId)?.lote||'?'):'Sem lote vinculado',pendente:!r.vendaId,centroCusto:r.centroCusto||''}));
  if(aba==='despesas')return cxVivos().filter(c=>c.tipo==='saida').map(c=>({...c,cx:c,descricao:c.descricao||'Despesa',situacao:c.centroCusto||'Sem centro de custo',pendente:!c.centroCusto}));
  if(aba==='receber')return ctx.titulos.filter(t=>t.grupo==='CONTA_A_RECEBER'&&t.status!=='CANCELADO'&&Number(t.original?.resumo?.nValAberto)>0).map(t=>{
    const vinculos=ctx.porParcela.get(String(t.titulo))||[],vinc=vinculos.find(x=>!x.p.conferir),v=vinc?.v;
    return {id:t.id,data:t.venc,valor:Number(t.original.resumo.nValAberto),descricao:(v?v.clienteNome+' · Q'+v.quadra+' L'+v.lote:'Título Omie '+t.titulo),situacao:v?'Lote confirmado':'Sem lote confirmado',centroCusto:vinc?.p.centroCusto||'',pendente:!v,...(v?{vendaId:v.id,parcela:vinc.i}:{titulo:t})};
  });
  if(aba==='pagar'){
    const manuais=lista('obrigacao').map(o=>{const pago=cxVivos().filter(c=>c.obrigacaoId===o.id).reduce((s,c)=>s+FINANCEIRO.cent(c.valor),0);return {...o,obrigacao:o,data:o.venc,valor:Math.max(0,FINANCEIRO.cent(o.valor)-pago)/100,situacao:o.centroCusto||'Sem centro de custo',pendente:!o.centroCusto};});
    const omie=ctx.titulos.filter(t=>t.grupo==='CONTA_A_PAGAR'&&t.status!=='CANCELADO').map(t=>({...t,data:t.ajustes?.venc||t.venc,valor:Math.max(0,t.ajustes?.valor!=null?Number(t.ajustes.valor)-Number(t.pago||0):Number(t.original?.resumo?.nValAberto??(t.valor-t.pago))),descricao:'Título Omie '+t.titulo,situacao:t.centroCusto||'Sem centro de custo',pendente:!t.centroCusto,titulo:t}));
    return [...manuais,...omie].filter(o=>o.valor>0);
  }
  return [];
}
function finRecorte(linhas,f) {
  return linhas.filter(x=> (!f.grupo||finPertenceGrupo(x,f.grupo)) && (!f.ano||String(x.data||'').startsWith(f.ano)) && (!f.mes||String(x.data||'').slice(5,7)===f.mes) &&
    (!f.centro || (x.centroCusto||'')===f.centro) && (!f.q || ((x.descricao||'')+' '+(x.situacao||'')+' '+(x.forma||'')).toLowerCase().includes(f.q.toLowerCase())));
}
function finAbrirLinha(x) {
  if(x.origemDiferenca)return finDetalheDiferenca(x);
  if(x.titulo && x.titulo.grupo!=='CONTA_A_PAGAR') return finVincularTitulo(x.titulo);
  if(x.rec) return finEditarRecebimento(x.rec);
  if(x.cx && TELAS._fin?.grupo==='corretores')return abrirAssociarComissao(x.cx.id,()=>TELAS.financeiro());
  if(x.cx) return abrirEdicaoLancamento(x.cx.id,()=>TELAS.financeiro());
  if(x.vendaId) {const v=achar('venda',x.vendaId);if(v&&x.parcela!=null)return abrirEditarParcela(v,x.parcela);location.hash='#/venda/'+x.vendaId;return;}
  if(x.obrigacao) return finObrigacao(x.obrigacao);
  if(x.comissao) return abrirPagarComissao(x.comissao.cor.id,x.comissao.cor.nome,x.comissao.saldo);
  if(x.titulo)return finEditarTitulo(x.titulo);
}
TELAS.financeiro=function(){
  const f=TELAS._fin || {aba:'visao',ano:'',mes:'',q:''};TELAS._fin=f;
  const app=document.getElementById('app'),ctx=finIndices(),todas=finLinhas(f.aba,ctx),linhas=finRecorte(todas,f).sort((a,b)=>String(a.data||'9999').localeCompare(String(b.data||'9999'))||String(a.id).localeCompare(String(b.id)));
  const pagina=Math.max(0,Math.min(f.pagina||0,Math.ceil(linhas.length/60)-1));f.pagina=pagina;const visiveis=linhas.slice(pagina*60,pagina*60+60);
  const anos=[...new Set([String(new Date().getFullYear()),...todas.map(x=>String(x.data||'').slice(0,4)).filter(Boolean)])].sort().reverse();
  const total=linhas.reduce((s,x)=>s+FINANCEIRO.cent(x.valor),0)/100;
  let html='<div class="fin-nav">'+Object.entries(FIN_ABAS).map(([id,nome])=>'<button class="btn '+(id===f.aba?'primario':'')+'" data-fin-aba="'+id+'">'+nome+'</button>').join('')+'</div>';
  if(window.FINANCEIRO_EM_VALIDACAO)html+='<div class="cartao" style="border-color:#e8b24a"><b>Versão em validação.</b> Os vínculos pendentes precisam ser conferidos antes da troca do financeiro.</div>';
  html+='<div class="fin-legenda"><span class="fin-entrada">↙ Entradas em azul</span><span class="fin-saida">↗ Saídas em vermelho</span><a class="btn" href="#/relatorios">Ver relatórios →</a></div>';
  html+='<p class="nota">Valores confirmados e pendências ficam identificados. Amarelo: precisa de conferência. Lápis roxo: alteração manual.</p>';
  if(f.aba==='pendencias'&&f.grupo)html+='<h2>'+esc(FIN_GRUPOS[f.grupo])+'</h2><p>Abra cada linha para corrigir o vínculo. A lista é atualizada após salvar.</p>';
  if(f.aba==='pendencias')html+='<p class="nota">A soma das pendências não representa dívida adicional: o mesmo recebimento pode exigir mais de uma conferência.</p>';
  if(f.aba==='centros'){app.innerHTML=html+finTelaCentros();finLigarCentros(app);app.querySelectorAll('[data-fin-aba]').forEach(b=>b.onclick=()=>{f.aba=b.dataset.finAba;f.grupo='';f.centro='';f.pagina=0;TELAS.financeiro();});return;}
  if(f.aba==='visao') {
    html+=painelInadimplenciaOmie();
    const recebido=lista('rec').reduce((s,r)=>s+FINANCEIRO.cent(r.valor),0)/100;
    const aReceber=finLinhas('receber',ctx), pagar=finLinhas('pagar',ctx),diff=finDiferencas(ctx);
    html+='<div class="fin-status">'+(!ctx.titulos.length?'A origem Omie ainda não foi carregada. Sincronize antes de conferir.':diff.length?diff.length+' diferenças identificadas com o Omie. Confira na aba dedicada.':'Valores comparados por título sem diferenças nesta leitura. Confira também os vínculos e a cobertura da sincronização.')+'</div>'; 
    const saldo=totaisAcumulados();
    html+='<div class="paineis">'+[
      ['recebimentos','Recebimentos registrados',recebido],['receber','Parcelas a receber dos lotes',aReceber.reduce((s,x)=>s+x.valor,0)],
      ['pagar','Contas a pagar pendentes',pagar.reduce((s,x)=>s+x.valor,0)],['diferencas','Diferenças com Omie',diff.length],['pendencias','Itens para conferir',finPendencias(ctx).length]
    ].map(([aba,nome,valor])=>'<button class="painel clicavel" data-fin-aba="'+aba+'"><span class="rot">'+nome+'</span><b class="num '+finCor({},aba)+'">'+(['pendencias','diferencas'].includes(aba)?valor:fmt.brl(valor))+'</b>'+(aba==='receber'?'<span class="sub">Vencidas e futuras · não é saldo disponível. Títulos sem lote confirmado precisam de conferência.</span>':'')+'</button>').join('')+'</div>';
    const pend=finPendencias(ctx);
    html+='<div class="cartao"><h2>Resolver vínculos pendentes</h2>'+Object.entries(FIN_GRUPOS).map(([id,nome])=>{const n=pend.filter(x=>finPertenceGrupo(x,id)).length;return n?'<button class="lin vinc-lin" data-fin-grupo="'+id+'"><b>'+n+' · '+esc(nome)+'</b><span>Abrir lista →</span></button>':'';}).join('')+'</div><div id="fin-sync" class="cartao"></div>';
    html+='<div class="cartao"><h2>Resultado dos lançamentos: '+finValor(saldo.resultado,saldo.resultado<0?'fin-saida':'fin-entrada')+'</h2><p>Entradas menos saídas registradas. Para saber o dinheiro disponível, confira o saldo de cada conta.</p><button class="btn" data-fin-aba="contas">Conferir contas</button></div>';
  } else if(f.aba==='contas') {
    html+='<button class="btn primario" id="fin-conta-nova">Cadastrar conta</button><div id="fin-bancos" class="cartao">Saldos do Omie ainda não consultados. <button class="btn" id="fin-consultar">Consultar saldos</button></div>';
    html+=lista('conta').map(c=>{
      const rec=lista('rec').filter(r=>r.contaId===c.id&&r.data>=c.dataInicial),cx=cxVivos().filter(x=>x.contaId===c.id&&x.data>=c.dataInicial);
      const registrado=FINANCEIRO.cent(c.saldoInicial)+rec.reduce((s,r)=>s+FINANCEIRO.cent(r.valor),0)+cx.reduce((s,x)=>s+(x.tipo==='entrada'?1:-1)*FINANCEIRO.cent(x.valor),0);
      const banco=lista('movbanco').filter(m=>String(m.contaOmie)===String(c.omieId)&&m.data>=c.dataInicial);
      const bancario=FINANCEIRO.cent(c.saldoInicial)+banco.reduce((s,m)=>s+(m.entrada?1:-1)*FINANCEIRO.cent(m.valor),0);
      const transferencias=banco.filter(m=>m.transferencia).reduce((s,m)=>s+(m.entrada?1:-1)*FINANCEIRO.cent(m.valor),0);
      return '<button class="cartao fin-conta" data-conta="'+esc(c.id)+'"><b>'+esc(c.nome)+'</b><p>Saldo pelos lançamentos desde '+esc(c.dataInicial)+': '+finResultado(registrado/100)+'</p><p>'+(banco.length?'Saldo pelo extrato importado: '+finResultado(bancario/100)+' · transferências líquidas: '+fmt.brl(transferencias/100)+' · diferença a conferir, após transferências: '+fmt.brl((bancario-registrado-transferencias)/100):'Extrato ainda não vinculado/importado. Conciliação não concluída.')+'</p><span>Conferir conta e saldo inicial</span></button>';
    }).join('');
    html+='<div class="cartao"><h2>Movimentações bancárias</h2><p>Transferências internas não são receita nem despesa. O saldo do extrato depende da data inicial e da cobertura da importação.</p>'+lista('movbanco').map((m,i)=>'<button class="btn" data-fin-banco="'+esc(m.id)+'">'+esc(m.data||'Sem data')+' · '+(m.transferencia?'Transferência':m.titulo?'Movimento de título':'Movimento sem título')+' · '+finValor(m.valor,m.transferencia?'':m.entrada?'fin-entrada':'fin-saida')+'</button>').join('')+'</div>';

  } else {
    html+='<div class="fin-toolbar"><select id="fin-ano" aria-label="Ano"><option value="">Todos os anos</option>'+anos.map(a=>'<option '+(a===f.ano?'selected':'')+'>'+a+'</option>').join('')+'</select><input id="fin-busca" aria-label="Buscar" placeholder="Buscar" value="'+esc(f.q)+'"><button class="btn" id="fin-pdf">Baixar este recorte em PDF</button>'+(f.aba==='despesas'?'<button class="btn primario" id="fin-despesa">Nova despesa</button>':'')+(f.aba==='pagar'?'<button class="btn primario" id="fin-obrigacao">Nova conta a pagar</button>':'')+'</div>';
    html+='<div class="fin-nav">'+['','01','02','03','04','05','06','07','08','09','10','11','12'].map((m,i)=>'<button class="btn mini '+(f.mes===m?'primario':'')+'" data-fin-mes="'+m+'">'+(['Todos','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][i])+'</button>').join('')+'</div>';
    if(['despesas','pagar','recebimentos','receber'].includes(f.aba))html+='<div class="fin-toolbar"><label>Centro de custo <select id="fin-centro"><option value="">Todos</option>'+finCentrosDisponiveis().map(c=>'<option '+(f.centro===c?'selected':'')+'>'+esc(c)+'</option>').join('')+'</select></label><button class="btn" data-fin-aba="centros">Editar centros de custo</button></div>';
    if(f.aba==='diferencas')html+='<p class="fin-status">Origem e sistema são comparados por identificador. Coincidência de valor não é confirmação. Correções locais continuam visíveis como diferença.</p>';
    html+='<p>'+linhas.length+' itens · Soma dos itens exibidos: <b>'+finValor(total,finCorTotal(linhas,f.aba))+'</b> · '+todas.filter(x=>!x.data).length+' sem data (visíveis em Todos os anos / Todos).</p>';
    if(f.aba==='pendencias') html+='<div id="fin-sync" class="cartao"></div><button class="btn" id="fin-sincronizar">Sincronizar Omie</button>';
    html+='<div class="rolagem"><table class="tabela fin-table"><thead><tr><th>Nº</th><th>Data</th><th>Descrição</th><th>Situação / centro de custo</th><th class="num">Valor</th></tr></thead><tbody>'+visiveis.map((x,i)=>'<tr tabindex="0" role="button" data-fin-row="'+i+'" class="ln-row '+(x.pendente?'pendente':'')+'"><td>'+(pagina*60+i+1)+'</td><td>'+esc(x.data||'Sem data')+'</td><td>'+esc(x.descricao||'')+(x.editadoAMao?'<span class="fin-lapis" title="Editado manualmente"> ✎</span>':'')+'</td><td>'+esc(x.situacao||'')+'</td><td class="num '+finCor(x,f.aba)+'">'+fmt.brl(x.valor)+'</td></tr>').join('')+'</tbody></table></div><div class="fin-pager"><button class="btn" id="fin-anterior" '+(!pagina?'disabled':'')+'>Anterior</button><span>Página '+(pagina+1)+' de '+Math.max(1,Math.ceil(linhas.length/60))+' · 60 itens por página</span><button class="btn" id="fin-proxima" '+((pagina+1)*60>=linhas.length?'disabled':'')+'>Próxima</button></div>';
  }
  app.innerHTML=html;
  app.querySelectorAll('[data-fin-grupo]').forEach(b=>b.onclick=()=>finAbrirPendenciasGrupo(b.dataset.finGrupo));
  app.querySelectorAll('[data-fin-aba]').forEach(b=>b.onclick=()=>{f.aba=b.dataset.finAba;f.grupo='';f.centro='';f.q='';f.pagina=0;TELAS.financeiro();});
  app.querySelectorAll('[data-fin-mes]').forEach(b=>b.onclick=()=>{f.mes=b.dataset.finMes;f.pagina=0;TELAS.financeiro();});
  app.querySelectorAll('[data-fin-row]').forEach(b=>{b.onclick=()=>finAbrirLinha(visiveis[Number(b.dataset.finRow)]);b.onkeydown=e=>{if(e.key==='Enter')b.click();};});
  const on=(id,fn)=>{const el=document.getElementById(id);if(el)el.onclick=fn;};
  const ano=document.getElementById('fin-ano');if(ano)ano.onchange=()=>{f.ano=ano.value;f.pagina=0;TELAS.financeiro();};
  const busca=document.getElementById('fin-busca');if(busca)busca.oninput=()=>{const pos=busca.selectionStart;f.q=busca.value;f.pagina=0;TELAS.financeiro();const novo=document.getElementById('fin-busca');novo.focus();novo.setSelectionRange(pos,pos);};
  const centro=document.getElementById('fin-centro');if(centro)centro.onchange=()=>{f.centro=centro.value;f.pagina=0;TELAS.financeiro();};
  on('fin-anterior',()=>{f.pagina--;TELAS.financeiro();});on('fin-proxima',()=>{f.pagina++;TELAS.financeiro();});
  on('fin-despesa',()=>abrirLancamento('saida',()=>TELAS.financeiro()));
  on('fin-pdf',()=>PDF.financeiro(FIN_ABAS[f.aba],(f.ano||'Todos os anos')+' / '+(f.mes||'Todos os meses')+(f.q?' / '+f.q:''),linhas,S.cfg||{},f.aba));
  on('fin-obrigacao',()=>finObrigacao());on('fin-conta-nova',()=>finConta());
  app.querySelectorAll('[data-fin-banco]').forEach(b=>b.onclick=()=>{
    const m=achar('movbanco',b.dataset.finBanco);
    abrirModal({titulo:'Movimento bancário',corpo:'<p>Data: '+esc(m.data||'não informada')+' · '+finValor(m.valor,finCor(m))+'</p><p>'+(m.transferencia?'Transferência entre contas. Não compõe receitas/despesas.':'Confira o título ou lançamento correspondente.')+'</p><p>Título: '+esc(String(m.titulo||'não informado'))+'</p>',acoes:[{texto:'Fechar',aoClicar:fecharModal}]});
  });
  app.querySelectorAll('[data-conta]').forEach(b=>b.onclick=()=>finConta(achar('conta',b.dataset.conta)));
  on('fin-consultar',async()=>{const el=document.getElementById('fin-bancos');try{const d=await saldoBancosOmie();el.textContent=(d.parcial?'Consulta parcial · ':'Consulta · ')+fmt.quando(d.quando)+' · '+(d.contas||[]).map(c=>c.nome+': '+(c.saldo==null?'indisponível':fmt.brl(c.saldo))).join(' | ');}catch(e){el.textContent='Falha: '+e.message;}});
  if(document.getElementById('fin-sync')) {
    statusOmieHome(document.getElementById('fin-sync'));
    apiOmie('saude').then(r=>{
      const el=document.getElementById('fin-sync');if(!el)return;
      const vendasPendentes=r.sync?.pendenciasVendas||[];
      if(vendasPendentes.length){const aviso=document.createElement('div');aviso.innerHTML='<h3>Vendas do Omie para conferir</h3>'+vendasPendentes.map(p=>'<p>'+esc(p.documento)+' · '+esc(p.motivo)+'</p>').join('');el.appendChild(aviso);}
      const pend=(r.sync?.pendencias||[]).filter(p=>p.tipo==='possivel_duplicidade'&&!achar('titulo','CONTA_A_PAGAR-'+p.titulo)?.decisaoDuplicidade);
      if(f.aba!=='pendencias'||f.grupo||!pend.length)return;
      const bloco=document.createElement('div');bloco.innerHTML='<h3>Possíveis duplicidades — conferir comprovantes</h3>'+pend.slice(0,60).map((p,i)=>'<button class="btn" data-origem-pend="'+i+'">'+esc(p.categoria||'Conferir título')+' · '+fmt.brl(p.valor||0)+'</button>').join('');
      bloco.querySelectorAll('[data-origem-pend]').forEach(b=>b.onclick=()=>{
        const p=pend[Number(b.dataset.origemPend)];
        if(p.tipo==='possivel_duplicidade') {
          abrirModal({titulo:'Conferir possível duplicidade',corpo:'<p>Os registros têm mesmo valor e data, mas isso não comprova duplicidade. Confira os comprovantes antes de estornar.</p>'+((p.candidatos||[]).map(id=>'<button class="btn" data-manual="'+esc(id)+'">Ver lançamento manual</button>').join('')),acoes:[{texto:'Fechar',aoClicar:fecharModal},{texto:'Registrar decisão',classe:'primario',aoClicar:()=>finResolverDuplicidade(p)}]});
          document.querySelectorAll('[data-manual]').forEach(x=>x.onclick=()=>{const id=x.dataset.manual;fecharModal();abrirEdicaoLancamento(id,()=>TELAS.financeiro());});
        } else finVincularTitulo({titulo:p.titulo,cpf:p.cpf});
      });el.appendChild(bloco);
    }).catch(()=>{});
  }
  on('fin-sincronizar',async()=>{try{await sincronizarOmie(true);TELAS.financeiro();}catch(e){registrarSyncOmie(false,e.message);toast(e.message,'ruim');}});
};
function finObrigacao(o={}){
  abrirModal({titulo:o.id?'Conta a pagar':'Nova conta a pagar',corpo:campo('Descrição',entrada('descricao',o.descricao||''))+campo('Fornecedor',entrada('fornecedor',o.fornecedor||''))+campo('Valor',entrada('valor',o.valor||'',{inputmode:'decimal',classe:'fin-saida'}))+campo('Vencimento',entrada('venc',o.venc||'',{tipo:'date'}))+campo('Centro de custo',entrada('centroCusto',o.centroCusto||'')),acoes:[{texto:'Voltar',aoClicar:fecharModal},{texto:'Salvar',classe:'primario',aoClicar:f=>{const c=lerCampos(f);if(!c.descricao||!FINANCEIRO.dataValida(c.venc)||numeroBR(c.valor)<=0){toast('Preencha descrição, valor e vencimento','ruim');return;}salvar('obrigacao',{...o,...c,valor:numeroBR(c.valor),editadoAMao:true,historico:historiar(o,'alterou conta a pagar')});fecharModal();TELAS.financeiro();}}]});
}
async function finConta(c={}){
  let bancos=[];try{bancos=(await saldoBancosOmie()).contas||[];}catch(e){toast('Não foi possível consultar as contas Omie agora','aviso');}
  abrirModal({titulo:'Conta financeira',corpo:campo('Nome',entrada('nome',c.nome||''))+campo('Conta correspondente no Omie',seletor('omieId',c.omieId||'',bancos.map(b=>({v:String(b.id),t:b.nome})),'Sem vínculo'))+campo('Saldo de abertura (R$)',entrada('saldoInicial',c.saldoInicial||0,{inputmode:'decimal'}))+campo('Data inicial dos lançamentos (saldo ao início deste dia)',entrada('dataInicial',c.dataInicial||'',{tipo:'date'})),acoes:[{texto:'Voltar',aoClicar:fecharModal},{texto:'Salvar',classe:'primario',aoClicar:f=>{const x=lerCampos(f);if(!x.nome||!FINANCEIRO.dataValida(x.dataInicial)){toast('Nome e data inicial obrigatórios','ruim');return;}salvar('conta',{...c,...x,saldoInicial:numeroBR(x.saldoInicial),historico:historiar(c,'alterou conta e saldo de abertura')});fecharModal();TELAS.financeiro();}}]});
}
function finEditarRecebimento(r,aoTerminar){
  const contas=lista('conta').map(c=>({v:c.id,t:c.nome}));
  const v=achar('venda',r.vendaId); const parcelas=v?resumoVenda(v).carne:[];
  const alocacoesIniciais=Array.isArray(r.alocacoes)?r.alocacoes:(r.omie?.titulo&&parcelas.some(p=>String(p.tid)===String(r.omie.titulo))?[{tid:String(r.omie.titulo),valor:r.valor}]:[]);
  abrirModal({titulo:'Recebimento '+(r.codigo||r.id),corpo:'<button type="button" class="btn" id="fin-vincular-pagamento">Vincular / corrigir lote</button><p>'+finEntrada(r.valor)+' em '+esc(r.data||'sem data')+'. O valor original é preservado.</p>'+campo('Conta financeira',seletor('contaId',r.contaId||'',contas,'Selecione'))+campo('Forma confirmada',seletor('forma',r.forma||'',(S.cfg&&S.cfg.formasPg)||['PIX','Dinheiro','Boleto','Cartão','Permuta'],'Não informada'))+(v?'<p>Distribua o valor recebido nas parcelas abaixo.</p><div style="max-height:320px;overflow:auto">'+parcelas.map((p,i)=>campo(p.rotulo+' · '+(p.venc||'Sem data')+' · saldo '+fmt.brl(p.saldo||0),entrada('alloc_'+i,(alocacoesIniciais.find(a=>String(a.tid)===String(p.tid))||{}).valor||'',{inputmode:'decimal'}))).join('')+'</div>':'<p>Associe a venda pela lista de recebimentos pendentes.</p><button type="button" class="btn" id="fin-vincular-solto">Escolher a venda</button>')+campo('Motivo da correção',entrada('motivo','')),acoes:[{texto:'Voltar',aoClicar:fecharModal},{texto:'Salvar correção',classe:'primario',aoClicar:f=>{const c=lerCampos(f);if(!c.motivo){toast('Informe o motivo','ruim');return;}let alocacoes=r.alocacoes;if(v){alocacoes=parcelas.map((p,i)=>({tid:String(p.tid),valor:numeroBR(c['alloc_'+i])})).filter(a=>a.valor!==0);if(alocacoes.some(a=>a.valor<=0||!resumoVenda(v).carne.some(p=>String(p.tid)===a.tid))||alocacoes.reduce((s,a)=>s+FINANCEIRO.cent(a.valor),0)>FINANCEIRO.cent(r.valor)){toast('Confira parcelas e valores. A soma não pode superar o recebido.','ruim');return;}}salvar('rec',{...r,contaId:c.contaId,forma:c.forma,alocacoes,ajustes:{...(r.ajustes||{}),forma:c.forma},editadoAMao:true,historico:historiar(r,c.motivo)});fecharModal();(aoTerminar||TELAS.financeiro)();}}]});
  const linkLote=document.getElementById('fin-vincular-pagamento');if(linkLote)linkLote.onclick=()=>{fecharModal();finVincularPagamento(r,aoTerminar);};
  const vincular=document.getElementById('fin-vincular-solto');if(vincular)vincular.onclick=()=>{fecharModal();finVincularPagamento(r,aoTerminar);};
}

function finVincularTitulo(t,aoTerminar) {
  const cpf=String(t.cpf||'').replace(/\D/g,'');
  const vendas=lista('venda').filter(v=>v.situacao!=='distratada'&&String(v.clienteId||'').replace(/\D/g,'')===cpf);
  abrirModal({titulo:'Associar título à venda correta',corpo:'<p>Escolha a venda após conferir o documento. O vínculo atual e o novo ficam no histórico.</p>'+campo('Venda',seletor('vendaId','',vendas.map(v=>({v:v.id,t:(v.codigo||'')+' · '+(v.clienteNome||'')+' · Q'+v.quadra+' L'+v.lote})),'Selecione'))+campo('Motivo / documento conferido',entrada('motivo','')),acoes:[{texto:'Voltar',aoClicar:fecharModal},{texto:'Confirmar vínculo',classe:'primario',aoClicar:async f=>{const c=lerCampos(f);if(!c.vendaId||!c.motivo){toast('Escolha a venda e informe a conferência realizada','ruim');return;}try{await api('vincularTitulo',{titulo:String(t.titulo),vendaId:c.vendaId,motivo:c.motivo});await puxar();fecharModal();(aoTerminar||TELAS.financeiro)();}catch(e){toast(e.message,'ruim');}}}]});
}

function finResolverDuplicidade(p){
  const candidatos=(p.candidatos||[]).map(id=>achar('cx',id)).filter(Boolean);
  abrirModal({titulo:'Decisão da conciliação',corpo:campo('Conclusão',seletor('decisao','', [{v:'mesmo',t:'É o mesmo pagamento'},{v:'distintos',t:'São pagamentos diferentes'}],'Selecione'))+campo('Lançamento manual conferido',seletor('manualId','',candidatos.map(c=>({v:c.id,t:c.descricao+' · '+fmt.brl(c.valor)})),'Selecione'))+campo('Comprovante / motivo',entrada('motivo','')),acoes:[{texto:'Voltar',aoClicar:fecharModal},{texto:'Salvar decisão',classe:'primario',aoClicar:async f=>{const c=lerCampos(f);if(!c.decisao||!c.motivo||(c.decisao==='mesmo'&&!c.manualId)){toast('Preencha a conclusão e o comprovante conferido','ruim');return;}try{await api('resolverDuplicidade',{titulo:p.titulo,...c});await puxar();fecharModal();toast('Decisão registrada. A próxima sincronização aplicará o vínculo.');TELAS.financeiro();}catch(e){toast(e.message,'ruim');}}}]});
}

function finCentrosDisponiveis(){return [...new Set([...(S.cfg?.centrosCusto||[]),...lista('cx').map(c=>c.centroCusto),...lista('obrigacao').map(c=>c.centroCusto)])].filter(Boolean).sort((a,b)=>a.localeCompare(b));}
function finTelaCentros(){
  const centros=finCentrosDisponiveis();return '<div class="cartao"><h2>Centros de custo</h2><p>Cadastre ou renomeie. Ao renomear, as despesas e parcelas vinculadas acompanham a mudança e mantêm o histórico.</p><button class="btn primario" id="fin-centro-novo">Novo centro de custo</button></div>'+centros.map((c,i)=>'<div class="cartao"><b>'+esc(c)+'</b><span class="fin-meta">'+lista('cx').filter(x=>x.centroCusto===c).length+' lançamentos vinculados</span><button class="btn" data-editar-centro="'+i+'">Editar nome</button><button class="btn" data-ver-centro="'+i+'">Ver despesas</button></div>').join('');
}
function finLigarCentros(app){
  const cs=finCentrosDisponiveis();document.getElementById('fin-centro-novo').onclick=()=>finEditarCentro('');
  app.querySelectorAll('[data-editar-centro]').forEach(b=>b.onclick=()=>finEditarCentro(cs[Number(b.dataset.editarCentro)]));
  app.querySelectorAll('[data-ver-centro]').forEach(b=>b.onclick=()=>{TELAS._fin={aba:'despesas',centro:cs[Number(b.dataset.verCentro)],ano:'',mes:'',q:''};TELAS.financeiro();});
}
function finEditarCentro(anterior){abrirModal({titulo:anterior?'Editar centro de custo':'Novo centro de custo',corpo:campo('Nome',entrada('nome',anterior)),acoes:[{texto:'Voltar',aoClicar:fecharModal},{texto:'Salvar',classe:'primario',aoClicar:async f=>{const c=lerCampos(f);if(!c.nome||c.nome.trim().length<2){toast('Informe o nome','ruim');return;}try{const r=await api('editarCentroCusto',{anterior,nome:c.nome.trim()});S.cfg.centrosCusto=r.centrosCusto;await puxar();fecharModal();TELAS.financeiro();}catch(e){toast(e.message,'ruim');}}}]});}
function finEditarTitulo(t){
  abrirModal({titulo:'Parcela a pagar · Omie '+t.titulo,corpo:'<p>Original no Omie: '+finSaida(t.valor)+' · '+esc(t.venc||'sem vencimento')+'. Ajustes locais ficam identificados em Diferenças com Omie.</p>'+campo('Valor local',entrada('valor',t.ajustes?.valor??t.valor,{inputmode:'decimal',classe:'fin-saida'}))+campo('Vencimento local',entrada('venc',t.ajustes?.venc||t.venc,{tipo:'date'}))+campo('Centro de custo',seletor('centroCusto',t.centroCusto||'',finCentrosDisponiveis(),'Selecione'))+campo('Motivo',entrada('motivo','')),acoes:[{texto:'Voltar',aoClicar:fecharModal},{texto:'Salvar correção',classe:'primario',aoClicar:async f=>{const c=lerCampos(f);try{await api('editarTitulo',{id:t.id,...c,valor:numeroBR(c.valor)});await puxar();fecharModal();TELAS.financeiro();}catch(e){toast(e.message,'ruim');}}}]});
}
function finDetalheDiferenca(x){
  const ctx=finIndices(),t=x.titulo, col=t.grupo==='CONTA_A_RECEBER'?'rec':'cx';const locais=ctx.pagamentos[col].get(String(t.titulo))||[];
  abrirModal({titulo:'Conferência · título '+t.titulo,corpo:'<p>'+esc(x.situacao)+'</p><div class="paineis"><div class="painel"><span class="rot">Omie</span><b class="num">'+finValor(x.valorOmie||0,finCor(x))+'</b></div><div class="painel"><span class="rot">Sistema</span><b class="num">'+finValor(x.valorSistema||0,finCor(x))+'</b></div></div><p>Identifique o motivo antes de corrigir. O documento original do Omie é preservado.</p>'+locais.map((r,i)=>'<button class="btn" data-diff-local="'+i+'">Abrir '+esc(r.codigo||r.descricao||'lançamento')+'</button>').join(''),acoes:[{texto:'Fechar',aoClicar:fecharModal},...(col==='cx'&&!locais.length?[{texto:'Vincular despesa existente',aoClicar:()=>{fecharModal();const candidatos=cxVivos().filter(c=>c.tipo==='saida'&&!c.omie?.titulo&&FINANCEIRO.cent(c.valor)===FINANCEIRO.cent(x.valorOmie)).map(c=>c.id);finResolverDuplicidade({titulo:t.titulo,candidatos});}}]:[]),{texto:col==='rec'?'Vincular ao lote':'Conferir parcela / centro de custo',classe:'primario',aoClicar:()=>{fecharModal();col==='rec'?finVincularTitulo(t):finEditarTitulo(t);}}]});
  document.querySelectorAll('[data-diff-local]').forEach(b=>b.onclick=()=>{const r=locais[Number(b.dataset.diffLocal)];fecharModal();col==='rec'?finEditarRecebimento(r):abrirEdicaoLancamento(r.id,()=>TELAS.financeiro());});
}
function finVincularPagamento(r,aoTerminar){
  if(r.omie?.titulo)return finVincularTitulo({titulo:r.omie.titulo,cpf:r.omie.cpf||achar('venda',r.vendaId)?.clienteId},aoTerminar);
  const vs=lista('venda').filter(v=>v.situacao!=='distratada');
  abrirModal({titulo:'Vincular pagamento a um lote',corpo:campo('Cliente e lote',seletor('vendaId',r.vendaId||'',vs.map(v=>({v:v.id,t:(v.clienteNome||'Cliente')+' · Q'+v.quadra+' L'+v.lote})),'Selecione'))+'<p>Após escolher o lote, distribua o pagamento pelas parcelas na ficha do recebimento.</p>'+campo('Motivo da associação',entrada('motivo','')),acoes:[{texto:'Voltar',aoClicar:fecharModal},{texto:'Vincular',classe:'primario',aoClicar:async f=>{const c=lerCampos(f);try{await api('vincularRecebimento',{id:r.id,...c});await puxar();fecharModal();finEditarRecebimento(achar('rec',r.id),aoTerminar);}catch(e){toast(e.message,'ruim');}}}]});
}

const FIN_GRUPOS={outros:'Despesas sem categoria',corretores:'Comissões sem corretor',cronograma:'Despesas de obra sem etapa','rec-omie':'Recebimentos sem lote','centro':'Despesas sem centro de custo'};
function finPertenceGrupo(x,grupo){
  const c=x.cx;
  if(grupo==='rec-omie')return !!x.rec&&!x.rec.vendaId;
  if(!c||c.tipo!=='saida')return false;
  if(grupo==='outros')return !c.categoria||c.categoria==='Outros';
  if(grupo==='corretores')return c.categoria==='Comissão'&&!c.corretorId&&!c.rateio?.length;
  if(grupo==='cronograma')return c.categoria==='Obra / infraestrutura'&&!c.etapaId;
  if(grupo==='centro')return !c.centroCusto;
  return false;
}
function finAbrirPendenciasGrupo(grupo,pagina=0){
  const itens=finPendencias().filter(x=>finPertenceGrupo(x,grupo)).sort((a,b)=>String(a.data||'9999').localeCompare(String(b.data||'9999')));
  const pg=Math.max(0,Math.min(pagina,Math.ceil(itens.length/40)-1)),vis=itens.slice(pg*40,pg*40+40);
  abrirModal({titulo:FIN_GRUPOS[grupo]+' · '+itens.length,corpo:'<p>Abra uma linha para editar. Após salvar, você retorna a esta lista.</p><div class="fin-fila">'+vis.map((x,i)=>'<button class="lin fin-fila-item" data-fila-item="'+i+'"><b>'+(pg*40+i+1)+'. '+esc(x.descricao)+'</b><span>'+esc(x.data||'Sem data')+' · '+finValor(x.valor,finCor(x))+'</span><small>'+esc(x.situacao)+'</small></button>').join('')+(itens.length?'':'<p>Todos os vínculos deste grupo foram resolvidos.</p>')+'</div>',acoes:[{texto:'Fechar',aoClicar:fecharModal},...(pg>0?[{texto:'Anterior',aoClicar:()=>{fecharModal();finAbrirPendenciasGrupo(grupo,pg-1);}}]:[]),...((pg+1)*40<itens.length?[{texto:'Próximas',aoClicar:()=>{fecharModal();finAbrirPendenciasGrupo(grupo,pg+1);}}]:[])]});
  document.querySelectorAll('[data-fila-item]').forEach(b=>b.onclick=()=>{const x=vis[Number(b.dataset.filaItem)];fecharModal();const voltar=()=>{if(typeof render==='function')render();finAbrirPendenciasGrupo(grupo,pg);};if(x.rec)finEditarRecebimento(x.rec,voltar);else if(grupo==='corretores')abrirAssociarComissao(x.cx.id,voltar);else abrirEdicaoLancamento(x.cx.id,voltar);});
}

function finAbrirVencidosOmie(){
  const r=resumoInadimplenciaOmie();if(!r)return;
  abrirModal({titulo:'Títulos vencidos no Omie · '+fmt.brl(r.total),corpo:'<p>Valores da origem, inclusive os títulos cujo lote ainda precisa ser confirmado. Ajustes locais ficam na aba Diferenças com Omie.</p>'+r.titulos.map((t,i)=>'<button class="lin fin-fila-item" data-vencido-omie="'+i+'"><b>'+(i+1)+'. Título '+t.titulo+'</b><span>'+esc(t.venc)+' · '+finAtraso(t.original.resumo.nValAberto)+'</span></button>').join(''),acoes:[{texto:'Fechar',aoClicar:fecharModal}]});
  document.querySelectorAll('[data-vencido-omie]').forEach(b=>b.onclick=()=>{const t=r.titulos[Number(b.dataset.vencidoOmie)];fecharModal();finVincularTitulo(t,()=>{if(typeof render==='function')render();finAbrirVencidosOmie();});});
}
