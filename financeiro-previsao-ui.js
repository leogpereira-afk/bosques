/* Consulta dos contratos vendidos. Somente leitura: não grava recebimentos,
   altera parcelas nem transforma vencimentos em movimentações de caixa. */
const FIN_PREVISAO_UI = (() => {
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const estado = { aberto: true, anos: new Map(), tabela: false };
  let modelo;
  const brl = n => fmt.brl(n);
  const mesNome = chave => meses[Number(chave.slice(5))-1]+' / '+chave.slice(0,4);
  const numeroCurto = n => n >= 1000000 ? (n/1000000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' mi' : n >= 1000 ? (n/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' mil' : n.toLocaleString('pt-BR',{maximumFractionDigits:2});
  const valor = n => n == null ? 'A conferir' : brl(n);
  function barra(m,maximo) {
    const vazio = !m.itens.length, atual = m.chave === hojeISO().slice(0,7);
    const descricao = mesNome(m.chave)+': '+(vazio?'sem parcelas':brl(m.recebido)+' recebido, '+brl(m.aberto)+' a receber');
    return '<button type="button" class="pv-mes'+(atual?' pv-atual':'')+'" data-pv-mes="'+m.chave+'" aria-label="'+esc(descricao)+'" title="'+esc(descricao)+'"'+(vazio?' disabled':'')+'>'+
      '<strong>'+esc(vazio?'—':numeroCurto(m.total))+'</strong><span class="pv-trilho" aria-hidden="true"><span class="pv-coluna" style="height:'+(maximo?m.total/maximo*100:0)+'%"><i class="pv-aberto" style="flex:'+(m.aberto||0)+'"></i><i class="pv-recebido" style="flex:'+(m.recebido||0)+'"></i></span></span>'+
      '<b>'+meses[Number(m.chave.slice(5))-1]+'</b><small>'+m.chave.slice(0,4)+(atual?' · atual':'')+'</small></button>';
  }
  function html(dados) {
    modelo=dados;
    const r=dados.totais, atual=hojeISO().slice(0,4), primeiro=dados.anos.some(a=>String(a.ano)===atual)?atual:String(dados.anos[0]?.ano||'');
    const anos=dados.anos.map(a=>{
      const k=String(a.ano), aberto=estado.anos.has(k)?estado.anos.get(k):k===primeiro;
      return '<details class="pv-ano" data-pv-ano="'+k+'"'+(aberto?' open':'')+'><summary><b>'+k+'</b><span>Recebido <strong>'+brl(a.recebido)+'</strong></span><span>A receber <strong>'+brl(a.aberto)+'</strong></span><small>'+a.itens.length+' parcelas</small></summary><div class="pv-scroll" role="region" tabindex="0" aria-label="Parcelas por mês em '+k+'"><div class="pv-grafico" style="--pv-meses:'+a.meses.length+'">'+a.meses.map(m=>barra(m,dados.maximo)).join('')+'</div></div></details>';
    }).join('');
    const botoesPendentes=[
      dados.pendencias.length?'<button type="button" class="pv-pendencia" data-pv-lista="pendencias">'+dados.pendencias.length+' parcelas a conferir ↗</button>':'',
      dados.planos.length?'<button type="button" class="pv-pendencia" data-pv-lista="planos">Planos sem espelho · '+brl(r.previsto)+' ↗</button>':'',
      dados.naoAlocado.length?'<button type="button" class="pv-pendencia" data-pv-lista="naoAlocado">Recebimentos sem parcela · '+brl(r.naoAlocado)+' ↗</button>':'',
      dados.creditos.length?'<button type="button" class="pv-pendencia" data-pv-lista="creditos">Créditos excedentes · '+brl(r.credito)+' ↗</button>':''
    ].join('');
    return '<details class="pv-painel" id="pv-vendidos"'+(estado.aberto?' open':'')+'><summary><span class="pv-icone" aria-hidden="true">▥</span><span class="pv-cabecalho"><strong>Previsão por mês dos lotes vendidos</strong><small>'+r.contratos+' contratos · todos os vencimentos e contas</small></span><span class="pv-total-cabecalho"><small>A receber nas parcelas</small><b>'+brl(r.aberto)+'</b></span><span class="pv-expandir" aria-hidden="true"></span></summary><div class="pv-corpo">'+
      '<div class="pv-resumo"><span><i class="pv-chave pv-recebido" aria-hidden="true"></i>Recebido <b>'+brl(r.recebido)+'</b></span><span><i class="pv-chave pv-aberto" aria-hidden="true"></i>A receber <b>'+brl(r.aberto)+'</b><small>Vencido e futuro</small></span><span class="pv-periodo">'+(dados.intervalo.de?mesNome(dados.intervalo.de.slice(0,7))+' a '+mesNome(dados.intervalo.ate.slice(0,7)):'Sem parcelas confirmadas com vencimento')+'</span></div>'+
      '<p class="pv-nota">Parcelas agrupadas pelo vencimento. “Recebido” mostra a baixa dessas parcelas, não a entrada de caixa no mês. Esta visão reúne os contratos vendidos, inclusive quitados, independentemente dos filtros abaixo.</p>'+
      '<div class="pv-comandos"><span>Toque no mês para ver as parcelas. No celular, deslize os meses.</span><button type="button" class="btn mini primario" data-pv-pdf title="Salvar todos os anos e valores exatos, inclusive os recolhidos">Salvar PDF</button>'+(anos?'<button type="button" class="btn mini" data-pv-expandir="sim">Expandir anos</button><button type="button" class="btn mini" data-pv-expandir="nao">Recolher anos</button>':'')+'</div>'+
      (anos?'<div class="pv-escala">Mesma escala em todos os anos · até '+brl(dados.maximo)+'</div>'+anos:'<p class="pv-vazio">Ainda não há parcelas confirmadas para montar a previsão mensal. Confira os contratos e os vínculos com o Omie.</p>')+
      (botoesPendentes?'<div class="pv-pendencias"><p>Fora das barras: registros que precisam de conferência ou de vínculo.</p>'+botoesPendentes+'</div>':'')+
      (dados.meses.length?'<details class="pv-exatos"'+(estado.tabela?' open':'')+'><summary>Ver valores exatos dos '+dados.meses.length+' meses</summary><div class="gf-tabela-scroll"><table class="gf-tabela"><caption class="sr-only">Parcelas dos contratos vendidos, por vencimento</caption><thead><tr><th>Mês</th><th class="num">Recebido</th><th class="num">A receber</th><th class="num">Total</th><th class="num">Parcelas</th></tr></thead><tbody>'+dados.meses.map(m=>'<tr><th><button type="button" class="gf-link" data-pv-mes="'+m.chave+'"'+(!m.itens.length?' disabled':'')+'>'+mesNome(m.chave)+'</button></th><td class="num">'+brl(m.recebido)+'</td><td class="num">'+brl(m.aberto)+'</td><td class="num">'+brl(m.total)+'</td><td class="num">'+m.itens.length+'</td></tr>').join('')+'</tbody><tfoot><tr><th>Total</th><td class="num">'+brl(r.recebido)+'</td><td class="num">'+brl(r.aberto)+'</td><td class="num">'+brl(r.total)+'</td><td class="num">'+r.parcelas+'</td></tr></tfoot></table></div></details>':'')+
      '<p class="pv-nota pv-rodape">Valores do cálculo atual de cada contrato. Sem criar recebimentos, reajustes adicionais ou alterações no histórico.</p></div></details>';
  }
  function abrir(titulo,itens,tipo='parcelas',pagina=0) {
    const ordenados=[...itens].sort((a,b)=>(a.venc||'').localeCompare(b.venc||'')||(a.cliente||'').localeCompare(b.cliente||'')),paginas=Math.max(1,Math.ceil(itens.length/30));
    const pg=Math.max(0,Math.min(paginas-1,pagina)),vis=ordenados.slice(pg*30,(pg+1)*30),normal=tipo==='parcelas';
    const corpo='<p class="pv-nota">'+(normal?'Parcelas pelo vencimento. Consulte a venda para acompanhar os recebimentos e as próximas ações.':'Estes registros ficam fora das barras confirmadas. Abra a venda para conferir a origem e o vínculo.')+'</p><div class="gf-tabela-scroll"><table class="gf-tabela pv-detalhes"><thead><tr><th>Cliente / lote</th><th>Vencimento / parcela</th>'+(normal?'<th class="num">Recebido</th><th class="num">A receber</th>':'<th>Conferência</th><th class="num">Valor de referência</th>')+'<th>Ação</th></tr></thead><tbody>'+vis.map(x=>'<tr><td><b>'+esc(x.cliente||'Cliente não informado')+'</b><small>'+esc(x.lotes||'Lote não informado')+'</small></td><td>'+esc(x.venc&&FINANCEIRO.dataValida(x.venc)?fmt.data(x.venc):'Data a conferir')+'<small>'+esc(x.rotulo||'Parcela')+(x.tid?' · '+esc(x.tid):'')+'</small></td>'+(normal?'<td class="num">'+brl(x.recebido)+'</td><td class="num">'+brl(x.aberto)+'</td>':'<td>'+esc(x.motivo||'Conferir contrato')+'</td><td class="num">'+valor(tipo==='planos'?x.previsto:x.valorReferencia)+'</td>')+'<td><a class="btn mini" href="#/venda/'+encodeURIComponent(x.vendaId)+'" data-pv-venda>Abrir venda ↗</a></td></tr>').join('')+'</tbody></table></div><p class="pv-nota">'+itens.length+' registros · página '+(pg+1)+' de '+paginas+'</p>';
    const m=abrirModal({titulo,corpo,largo:true,acoes:[{texto:'Fechar',aoClicar:fecharModal},...(pg?[{texto:'Anterior',aoClicar:()=>{fecharModal();abrir(titulo,itens,tipo,pg-1);}}]:[]),...(pg<paginas-1?[{texto:'Próxima',aoClicar:()=>{fecharModal();abrir(titulo,itens,tipo,pg+1);}}]:[])]});
    m.querySelectorAll('[data-pv-venda]').forEach(a=>a.onclick=()=>fecharModal());
  }
  function ligar(raiz) {
    const painel=raiz.querySelector('#pv-vendidos');if(!painel)return;
    painel.ontoggle=()=>{estado.aberto=painel.open;};
    painel.querySelectorAll('[data-pv-ano]').forEach(el=>el.ontoggle=()=>estado.anos.set(el.dataset.pvAno,el.open));
    const tabela=painel.querySelector('.pv-exatos');if(tabela)tabela.ontoggle=()=>{estado.tabela=tabela.open;};
    painel.querySelectorAll('[data-pv-expandir]').forEach(b=>b.onclick=()=>{const aberto=b.dataset.pvExpandir==='sim';painel.querySelectorAll('[data-pv-ano]').forEach(el=>{el.open=aberto;estado.anos.set(el.dataset.pvAno,aberto);});});
    painel.querySelectorAll('[data-pv-mes]').forEach(b=>b.onclick=()=>{const m=modelo.meses.find(x=>x.chave===b.dataset.pvMes);if(m)abrir('Lotes vendidos · '+mesNome(m.chave),m.itens);});
    const titulos={pendencias:'Parcelas a conferir',planos:'Planos sem espelho do Omie',naoAlocado:'Recebimentos sem parcela',creditos:'Créditos excedentes'};
    painel.querySelectorAll('[data-pv-lista]').forEach(b=>b.onclick=()=>{const k=b.dataset.pvLista;abrir(titulos[k],modelo[k],k);});
    const pdf=painel.querySelector('[data-pv-pdf]');
    if(pdf)pdf.onclick=()=>{
      if(pdf.disabled)return;pdf.disabled=true;pdf.textContent='Gerando PDF…';
      try{FIN_PREVISAO_PDF.gerar(modelo,S.cfg||{},{dadosFicticios:!!window.BOSQUES_PREVIA});}
      catch(e){toast('Não foi possível gerar o PDF. Tente novamente.','ruim');}
      finally{pdf.disabled=false;pdf.textContent='Salvar PDF';}
    };
  }
  return {html,ligar};
})();
