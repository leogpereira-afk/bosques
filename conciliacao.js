/* Conciliação orientada: sugestões nunca confirmam um vínculo. A fonte Omie é
   preservada; gravações dependem de confirmação e controle de versão no servidor. */
(() => {
  'use strict';
  const cent=v=>Math.round((Number(v)||0)*100),doc=v=>String(v||'').replace(/\D/g,''),vivo=x=>x&&!x.apagadoEm;
  const ativa=v=>vivo(v)&&(!v.situacao||['ativa','conferir','quitada'].includes(v.situacao));
  const registros=reg=>Object.fromEntries(['venda','rec','titulo','cliente','cx'].map(k=>[k,(reg?.[k]||[]).filter(vivo)]));
  const chaveTitulo=t=>String(t?.titulo??'');
  function montarFilas(reg,saude) {
    const rs=registros(reg),vs=rs.venda.filter(ativa),porVenda=new Map(vs.map(v=>[v.id,v])),porTitulo=new Map(rs.titulo.filter(t=>t.grupo==='CONTA_A_RECEBER').map(t=>[chaveTitulo(t),t])),porTituloPagar=new Map(rs.titulo.filter(t=>t.grupo==='CONTA_A_PAGAR').map(t=>[chaveTitulo(t),t])),porCx=new Map(rs.cx.map(c=>[c.id,c])),porParcela=new Map();
    for(const venda of vs)for(const parcela of venda.parcelas||[])if(parcela&&!parcela.cancelado){const tid=String(parcela.tid),links=porParcela.get(tid)||[];links.push({venda,parcela});porParcela.set(tid,links);}
    const faltaDistribuir=r=>r.conferir&&!r.omie?.titulo&&(r.alocacoes||[]).reduce((s,a)=>s+cent(a.valor),0)<cent(r.valor);
    const recebimentos=rs.rec.filter(r=>!porVenda.has(r.vendaId)||faltaDistribuir(r)).map(r=>({chave:'recebimento-'+r.id,tipo:r.omie?.titulo?'titulo':'recebimento',grupo:'recebimentos',subtipo:porVenda.has(r.vendaId)?'alocacao':'semcontrato',rec:r,titulo:porTitulo.get(String(r.omie?.titulo)),data:r.data,valor:Number(r.valor)||0,motivo:porVenda.has(r.vendaId)?'Contrato confirmado; distribuição nas parcelas ainda pendente':r.vendaId?'Contrato indisponível ou distratado':'Recebimento sem contrato confirmado'}));
    for(const i of recebimentos)if(i.titulo)i.vinculos=porParcela.get(chaveTitulo(i.titulo))||[];
    const parcelas=[];
    for(const t of porTitulo.values()) {
      if(t.status==='CANCELADO'||t.cancelado)continue;
      const vinculos=porParcela.get(chaveTitulo(t))||[];
      const incerto=!vinculos.length||vinculos.some(x=>x.parcela.conferir&&!x.parcela.vinculoConfirmado)||vinculos.length>1;
      const valoresPendentes=vinculos.some(x=>x.parcela.conferir&&x.parcela.vinculoConfirmado);
      const divergente=vinculos.some(x=>{const p=x.parcela,c=p.conciliacao,igualOrigem=cent(p.valor)===cent(t.valor)&&String(p.venc||'')===String(t.venc||'');const localConferido=c?.politica==='local'&&cent(c.valorOrigem)===cent(t.valor)&&String(c.vencOrigem||'')===String(t.venc||'')&&cent(c.valorLocalAntes)===cent(p.valor)&&String(c.vencLocalAntes||'')===String(p.venc||'');return !igualOrigem&&!localConferido;});
      if(!incerto&&!divergente&&!valoresPendentes)continue;
      parcelas.push({chave:'titulo-'+chaveTitulo(t),tipo:'titulo',grupo:'parcelas',subtipo:incerto?'vinculo':valoresPendentes?'valorespendentes':'divergencia',titulo:t,vinculos,data:t.venc,valor:Number(t.valor)||0,motivo:incerto?(vinculos.length>1?'Título aparece em mais de um contrato':vinculos.length?'Vínculo da parcela ainda não confirmado':'Título sem contrato confirmado'):valoresPendentes?'Contrato confirmado; valor e vencimento ainda a conferir':'Valor ou vencimento local diferente da origem Omie',divergente});
    }
    for(const v of vs)for(const [i,p] of (v.parcelas||[]).entries())if(p&&!p.cancelado&&p.conferir&&!porTitulo.has(String(p.tid)))parcelas.push({chave:'semorigem-'+v.id+'-'+(p.tid||i),tipo:'titulo',grupo:'parcelas',subtipo:'semorigem',vinculos:[{venda:v,parcela:p}],data:p.venc,valor:Number(p.valor)||0,motivo:'Parcela sem título na leitura disponível; atualizar a origem antes de vincular'});
    const duplicidades=[],vistos=new Set();
    for(const p of saude?.sync?.pendencias||[]) {
      if(p.tipo!=='possivel_duplicidade'||vistos.has(String(p.titulo)))continue;
      const t=porTituloPagar.get(String(p.titulo));
      if(!t||t.decisaoDuplicidade||t.status==='CANCELADO')continue;
      vistos.add(String(p.titulo));duplicidades.push({chave:'duplicidade-'+p.titulo,tipo:'duplicidade',grupo:'duplicidades',subtipo:'duplicidade',titulo:t,candidatos:[...new Set(p.candidatos||[])].map(id=>porCx.get(id)).filter(c=>c?.tipo==='saida'),data:p.data||t.financeiroOmie?.dataPagamento||t.venc,valor:Number(p.valor??t.original?.resumo?.nValLiquido??t.valor)||0,motivo:'Coincidência de valor e data; conferir se é o mesmo pagamento'});
    }
    return {recebimentos,parcelas,duplicidades};
  }
  function origem(item,reg) {
    const t=item.titulo||{},r=item.rec||{},f=t.financeiroOmie||r.financeiroOmie||{},atual=(reg?.venda||[]).find(v=>v.id===r.vendaId)||item.vinculos?.[0]?.venda;
    const cpf=doc(t.cpf||r.cpf||r.clienteId||r.omie?.cpf||atual?.clienteId),cliente=(reg?.cliente||[]).find(c=>doc(c.cpf||c.id)===cpf);
    return {cpf,nome:f.pessoaNome||cliente?.nome||r.clienteNome||atual?.clienteNome||'',documento:f.documento||t.original?.detalhes?.cNumTitulo||r.codigo||'',conta:f.contaNome||((reg?.conta||[]).find(c=>c.id===r.contaId)?.nome)||'',contaId:String(f.contaCodigo||r.contaId||''),observacao:f.observacao||r.obs||'',titulo:chaveTitulo(t)||String(r.omie?.titulo||''),data:item.data,valor:item.valor};
  }
  function sugestoes(item,reg) {
    const o=origem(item,reg),normal=String(o.documento||'').toUpperCase().replace(/[\s-]/g,''),exato=normal.match(/^Q0*(\d+)L0*(\d+)$/);
    const atuais=new Set((item.vinculos||[]).map(x=>x.venda.id));
    return registros(reg).venda.filter(ativa).filter(v=>!o.cpf||doc(v.clienteId)===o.cpf).map(v=>{
      const motivos=[];let pontos=0;
      if(o.cpf&&doc(v.clienteId)===o.cpf){motivos.push('CPF/CNPJ coincide com a origem');pontos+=2;}
      if(exato&&Number(exato[1])===Number(v.quadra)&&Number(exato[2])===Number(v.lote)){motivos.push('Documento informa esta quadra e este lote');pontos+=4;}
      if(atuais.has(v.id)){motivos.push('Contrato que contém a parcela atualmente');pontos++;}
      if(!motivos.length)motivos.push('Sem identificador suficiente; exige comprovante e conferência');
      return {venda:v,motivos,pontos};
    }).sort((a,b)=>b.pontos-a.pontos||rotuloVenda(a.venda).localeCompare(rotuloVenda(b.venda)));
  }
  function prepararPayload(item,campos,reg,operacao) {
    const motivo=String(campos.motivo||'').trim();if(motivo.length<3)throw Error('Informe o motivo ou documento conferido (mínimo de 3 caracteres).');
    const p={tipo:item.tipo,id:item.tipo==='recebimento'?item.rec?.id:chaveTitulo(item.titulo),motivo,operacao,esperado:{}};
    if(!p.id)throw Error('Título não disponível. Atualize a origem antes de confirmar.');
    if(item.tipo==='duplicidade') {
      if(!['mesmo','distintos'].includes(campos.decisao))throw Error('Escolha se os pagamentos são o mesmo ou distintos.');
      const manual=(reg?.cx||[]).find(c=>c.id===campos.manualId&&vivo(c));
      if(campos.decisao==='mesmo'&&!manual)throw Error('Selecione o lançamento manual conferido.');
      p.decisao=campos.decisao;p.manual=manual?.id||'';p.esperado={titulo:item.titulo?.atualizadoEm??null,manual:manual?.atualizadoEm??null};
    } else {
      const v=(reg?.venda||[]).find(v=>v.id===campos.destino&&ativa(v));if(!v)throw Error('Escolha o contrato de destino.');
      const o=origem(item,reg);if(o.cpf&&doc(v.clienteId)!==o.cpf)throw Error('O contrato pertence a outro CPF/CNPJ. Confira o cadastro antes de vincular.');
      p.destino=v.id;p.esperado.venda=v.atualizadoEm??null;
      if(item.tipo==='titulo'){if(!['origem','local','pendente'].includes(campos.politica))throw Error('Escolha como tratar o valor e o vencimento.');if(campos.politica==='local'){const vinculos=item.vinculos||[],noDestino=vinculos.filter(x=>x.venda.id===v.id);if(!vinculos.length)throw Error('Não há parcela local para manter. Escolha os dados da origem ou mantenha os valores pendentes.');if(noDestino.length!==1&&!(noDestino.length===0&&vinculos.length===1))throw Error('Há mais de uma parcela local possível. Escolha um contrato que contenha uma única parcela deste título, use os dados da origem ou mantenha os valores pendentes.');}p.politica=campos.politica;p.esperado.titulo=item.titulo?.atualizadoEm??null;}
      else p.esperado.recebimento=item.rec?.atualizadoEm??null;
    }
    return p;
  }
  function rotuloVenda(v){return [v.codigo,v.clienteNome||'Cliente não informado','Q'+v.quadra+' · L'+v.lote].filter(Boolean).join(' · ');}
  const grupos={recebimentos:'Recebimentos e distribuição',parcelas:'Parcelas e títulos a conferir',duplicidades:'Possíveis duplicidades'};
  const subtipos={semcontrato:'Sem contrato',alocacao:'Distribuição pendente',vinculo:'Vínculo incerto',valorespendentes:'Valores a conferir',divergencia:'Valor / vencimento',semorigem:'Origem não disponível',duplicidade:'Conferir pagamento'};
  let alvo=null,saude=null,consultadaEm='',erroSaude='',carregando=null;
  const estado=()=>TELAS._conciliacao||(TELAS._conciliacao={grupo:'recebimentos',subtipo:'',q:'',conta:'',de:'',ate:'',pagina:0});
  const data=d=>/^\d{2}\/\d{2}\/\d{4}$/.test(d||'')?d.slice(6)+'-'+d.slice(3,5)+'-'+d.slice(0,2):String(d||'').slice(0,10);
  function filtrar(itens,f,reg) {return itens.filter(i=>{const o=origem(i,reg),texto=[o.nome,o.cpf,o.documento,o.titulo,...(i.vinculos||[]).map(x=>rotuloVenda(x.venda)),i.motivo].join(' ');return (!f.conta||o.contaId===f.conta)&&(!f.subtipo||i.subtipo===f.subtipo)&&(!f.q||correspondeBusca(texto,f.q))&&(!f.de||data(i.data)>=f.de)&&(!f.ate||data(i.data)<=f.ate);}).sort((a,b)=>data(a.data).localeCompare(data(b.data))||a.chave.localeCompare(b.chave));}
  async function relerConfirmado() {
    if(typeof navigator!=='undefined'&&navigator.onLine===false)throw Error('Sem conexão. A leitura precisa ser confirmada pelo servidor.');
    const limite=Date.now()+120000;
    while(typeof _puxando!=='undefined'&&_puxando){if(Date.now()>limite)throw Error('A leitura em andamento ainda não terminou. Aguarde e tente novamente.');await new Promise(r=>setTimeout(r,150));}
    const verificarPull=Object.prototype.hasOwnProperty.call(S,'ultimoPull'),antes=S.ultimoPull;
    await puxar();if(S.erroSync)throw Error(S.erroSync);if(verificarPull&&S.ultimoPull===antes)throw Error('O servidor ainda não confirmou uma leitura nova. Tente novamente.');
  }
  async function carregarSaude(forcar=false) {
    if(carregando)return carregando;if(consultadaEm&&!forcar)return;
    erroSaude='';carregando=(async()=>{try{const r=await apiOmie('saude',{resumida:false});if(!r?.ok)throw Error(r?.error||'A integração não confirmou a consulta.');saude=r;consultadaEm=new Date().toISOString();}catch(e){erroSaude=e.message||'Consulta indisponível.';}finally{carregando=null;if(alvo?.isConnected&&!document.querySelector('.fundo-modal'))pintar();}})();
    return carregando;
  }
  function pintar() {
    if(!alvo)return;const f=estado(),filas=montarFilas(S.reg,saude),todos=filas[f.grupo]||[],itens=filtrar(todos,f,S.reg),pagina=Math.max(0,Math.min(f.pagina,Math.ceil(itens.length/40)-1));f.pagina=pagina;
    const vis=itens.slice(pagina*40,pagina*40+40),tipos=[...new Set(todos.map(i=>i.subtipo))],contas=[...new Map(todos.map(i=>origem(i,S.reg)).filter(o=>o.contaId).map(o=>[o.contaId,o.conta||o.contaId])).entries()];
    alvo.innerHTML='<section class="cq" aria-label="Conciliação financeira"><div class="cq-cabecalho"><div><span class="cq-sobre">CONFERIR · VINCULAR · REGISTRAR</span><h3>Escolha o que conferir</h3><p>Escolha o contrato correto e registre a conferência. Os valores originais são preservados.</p></div><button type="button" class="btn" data-cq-atualizar '+(carregando?'disabled':'')+'>'+(carregando?'Consultando…':'Atualizar conferências')+'</button></div><nav class="cq-filas" aria-label="Filas de conciliação">'+Object.entries(grupos).map(([k,n])=>'<button type="button" data-cq-grupo="'+k+'" aria-pressed="'+(f.grupo===k)+'"><span>'+esc(n)+'</span><b>'+filas[k].length+'</b></button>').join('')+'</nav><p class="cq-nota">Um registro pode aparecer em mais de uma fila. As quantidades não representam dívida adicional.</p><div class="cq-filtros"><label>Buscar cliente, CPF, lote ou documento<input type="search" data-cq-busca value="'+esc(f.q)+'" placeholder="Nome, CPF, título ou Q01 L02"></label><label>Situação<select data-cq-subtipo><option value="">Todas as situações</option>'+tipos.map(t=>'<option value="'+t+'" '+(f.subtipo===t?'selected':'')+'>'+esc(subtipos[t])+'</option>').join('')+'</select></label><label>Conta<select data-cq-conta><option value="">Todas as contas</option>'+contas.map(([id,nome])=>'<option value="'+esc(id)+'" '+(f.conta===id?'selected':'')+'>'+esc(nome)+'</option>').join('')+'</select></label><label>De<input type="date" data-cq-de value="'+esc(f.de)+'"></label><label>Até<input type="date" data-cq-ate value="'+esc(f.ate)+'"></label><button type="button" class="btn" data-cq-limpar>Todo o histórico</button></div><div class="cq-leitura" role="status">'+(erroSaude?'<b>Não foi possível atualizar as duplicidades.</b> '+esc(erroSaude)+(consultadaEm?' Última consulta preservada: '+esc(fmt.dataHora(consultadaEm))+'.':' Nenhuma lista completa confirmada nesta sessão.'):carregando?'Consultando a lista completa de duplicidades…':consultadaEm?'Duplicidades consultadas em '+esc(fmt.dataHora(consultadaEm))+'. Origem Omie: '+esc(fmt.dataHora(saude?.sync?.quando)||'data não informada')+'.':'A lista de duplicidades ainda não foi consultada.')+'</div><div class="cq-lista-titulo"><b>'+itens.length+' '+(itens.length===1?'conferência':'conferências')+' no filtro</b><span>'+(f.de||f.ate?'Período selecionado':'Todo o histórico disponível')+'</span></div><div class="cq-lista">'+(vis.length?vis.map(i=>{const o=origem(i,S.reg);return '<button type="button" class="cq-linha" data-cq-id="'+esc(i.chave)+'"><span><b>'+esc(o.nome||'Pessoa não identificada')+'</b><small>'+esc([o.documento,o.titulo?'Título '+o.titulo:'',data(i.data)?fmt.data(data(i.data)):'Sem data'].filter(Boolean).join(' · '))+'</small></span><span class="cq-situacao">'+esc(subtipos[i.subtipo])+'<small>'+esc(i.motivo)+'</small></span><strong>'+esc(fmt.brl(i.valor))+'</strong><span class="cq-abrir">Conferir →</span></button>';}).join(''):'<div class="cq-vazio">Nenhuma conferência neste filtro.'+(f.grupo==='duplicidades'&&!consultadaEm?' Aguarde ou atualize a consulta completa.':'')+'</div>')+'</div><div class="cq-paginas"><button type="button" class="btn" data-cq-anterior '+(pagina?'':'disabled')+'>Anterior</button><span>Página '+(pagina+1)+' de '+Math.max(1,Math.ceil(itens.length/40))+'</span><button type="button" class="btn" data-cq-proxima '+((pagina+1)*40<itens.length?'':'disabled')+'>Próxima</button></div></section>';
    alvo.querySelectorAll('[data-cq-grupo]').forEach(b=>b.onclick=()=>{f.grupo=b.dataset.cqGrupo;f.subtipo='';f.pagina=0;pintar();});
    alvo.querySelectorAll('[data-cq-id]').forEach(b=>b.onclick=()=>abrir(itens.find(i=>i.chave===b.dataset.cqId)));
    const busca=alvo.querySelector('[data-cq-busca]');busca.oninput=()=>{f.q=busca.value;f.pagina=0;const inicio=busca.selectionStart;pintar();const nova=alvo.querySelector('[data-cq-busca]');nova.focus();try{nova.setSelectionRange(inicio,inicio);}catch{}};
    for(const [attr,k] of [['subtipo','subtipo'],['conta','conta'],['de','de'],['ate','ate']])alvo.querySelector('[data-cq-'+attr+']').onchange=e=>{f[k]=e.target.value;f.pagina=0;pintar();};
    alvo.querySelector('[data-cq-limpar]').onclick=()=>{Object.assign(f,{q:'',conta:'',subtipo:'',de:'',ate:'',pagina:0});pintar();};
    alvo.querySelector('[data-cq-anterior]').onclick=()=>{f.pagina--;pintar();};alvo.querySelector('[data-cq-proxima]').onclick=()=>{f.pagina++;pintar();};
    alvo.querySelector('[data-cq-atualizar]').onclick=async()=>{try{await relerConfirmado();await carregarSaude(true);pintar();}catch(e){erroSaude=e.message;pintar();}};
  }
  const ficha=(titulo,linhas)=>'<section class="cq-ficha"><h4>'+esc(titulo)+'</h4><dl>'+linhas.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v==null||v===''?'Não informado':v)+'</dd></div>').join('')+'</dl></section>';
  function comparacao(item) {
    const o=origem(item,S.reg),t=item.titulo||{},r=t.original?.resumo||{};
    const fonte=item.titulo?ficha('Origem Omie', [['Pessoa',o.nome],['CPF / CNPJ',o.cpf?fmt.doc(o.cpf):''],['Título / documento',[o.titulo,o.documento].filter(Boolean).join(' · ')],['Valor do título',fmt.brl(t.valor)],['Vencimento',fmt.data(t.venc)],['Liquidado',r.nValLiquido==null?'Não informado':fmt.brl(r.nValLiquido)],['Conta',o.conta],['Observação',o.observacao]]):item.rec?ficha('Recebimento local', [['Pessoa',o.nome],['CPF / CNPJ',o.cpf?fmt.doc(o.cpf):''],['Código / documento',o.documento||item.rec.id],['Valor recebido',fmt.brl(item.rec.valor)],['Data do recebimento',fmt.data(item.rec.data)],['Conta',o.conta],['Observação',o.observacao]]):ficha('Origem não disponível', [['Orientação','Atualize a origem antes de confirmar o vínculo.']]);
    let local=(item.vinculos||[]).map(x=>ficha(rotuloVenda(x.venda),[['Valor local',fmt.brl(x.parcela.valor)],['Vencimento local',fmt.data(x.parcela.venc)],['Conferência',x.parcela.conferir?'Ainda não confirmada':'Vínculo confirmado'],['Alteração manual',x.parcela.trava?'Sim, protegida na sincronização':'Não protegida']])).join('');
    if(item.rec)local+=ficha('Recebimento preservado', [['Código',item.rec.codigo||item.rec.id],['Valor recebido',fmt.brl(item.rec.valor)],['Data do recebimento',fmt.data(item.rec.data)],['Contrato atual',(S.reg.venda||[]).find(v=>v.id===item.rec.vendaId)?.codigo||'Sem contrato confirmado']]);
    if(item.tipo==='duplicidade')local=item.candidatos.map(c=>ficha('Lançamento manual · '+(c.codigo||c.id),[['Descrição',c.descricao],['Favorecido',c.financeiroOmie?.pessoaNome||c.favorecido],['Valor',fmt.brl(c.valor)],['Data',fmt.data(c.data)],['Conta',c.financeiroOmie?.contaNome||c.contaId],['Documento',c.financeiroOmie?.documento||c.documento]])).join('');
    return '<div class="cq-comparacao">'+fonte+'<div>'+(local||'<p class="cq-vazio">Nenhum vínculo local confirmado.</p>')+'</div></div>';
  }
  function abrir(item) {
    if(!item)return;const regConferido={...S.reg,venda:(S.reg.venda||[]).map(v=>({...v})),cx:(S.reg.cx||[]).map(c=>({...c}))},candidatos=sugestoes(item,regConferido),bloqueado=item.tipo==='titulo'&&(!item.titulo||!doc(item.titulo.cpf)||item.titulo.status==='CANCELADO');
    const relacionados=item.tipo==='titulo'?(S.reg.rec||[]).filter(r=>vivo(r)&&String(r.omie?.titulo)===chaveTitulo(item.titulo)):[];
    let corpo='<p class="cq-modal-nota">'+esc(item.motivo)+'. Confira os documentos antes de confirmar.</p>'+comparacao(item)+(relacionados.length?'<p class="cq-nota">A confirmação deste título vincula '+relacionados.length+' recebimento(s) associado(s), preservando o valor recebido e a data de cada um.</p>':'');
    if(item.subtipo==='alocacao'){const v=(S.reg.venda||[]).find(v=>v.id===item.rec.vendaId),espelho=v?.parcelas?.some(p=>p&&!p.cancelado);corpo+='<p class="cq-aviso">O contrato já está vinculado. Falta destinar o valor às parcelas'+(!espelho?'; confira primeiro o plano na ficha da venda. O editor legado permite consultar os metadados, sem comprovar distribuição':'')+'. O valor recebido permanece preservado.</p><button type="button" class="btn primario" data-cq-distribuir>'+ (espelho?'Distribuir nas parcelas':'Conferir recebimento legado')+'</button> <button type="button" class="btn" data-cq-venda>Abrir contrato</button>';}
    if(bloqueado)corpo+='<p class="cq-aviso">O título está ausente, cancelado ou sem CPF/CNPJ verificável. Atualize a origem e confira o cadastro antes de associar. Esta tela não criará um título nem alterará o recebimento.</p>';
    else if(item.tipo==='duplicidade')corpo+=campo('Conclusão da conferência',seletor('decisao','',[{v:'mesmo',t:'É o mesmo pagamento'},{v:'distintos',t:'São pagamentos diferentes'}],'Selecione'))+campo('Lançamento manual conferido',seletor('manualId','',item.candidatos.map(c=>({v:c.id,t:(c.descricao||c.codigo||c.id)+' · '+fmt.brl(c.valor)+' · '+fmt.data(c.data)})),'Selecione se for o mesmo pagamento'))+'<p class="cq-nota">Mesmo valor e data não comprovam duplicidade. A decisão registra o vínculo ou mantém os pagamentos distintos; não exclui o histórico.</p>';
    else {
      corpo+='<details class="cq-sugestoes" open><summary>Contratos compatíveis · '+candidatos.length+'</summary>'+candidatos.slice(0,5).map(s=>'<div><b>'+esc(rotuloVenda(s.venda))+'</b><small>'+esc(s.motivos.join(' · '))+'</small></div>').join('')+(candidatos.length>5?'<p class="cq-nota">Mostrando 5 sugestões. Todos os contratos compatíveis estão no seletor abaixo.</p>':'')+(!candidatos.length?'<p>Nenhum contrato compatível encontrado. Confira o cadastro e retome esta fila.</p>':'')+'</details>'+campo('Contrato de destino',seletor('destino','',candidatos.map(s=>({v:s.venda.id,t:rotuloVenda(s.venda)})),'Selecione o contrato após conferir'))+'<div data-cq-destino></div>';
      if(item.tipo==='titulo')corpo+=campo('Valor e vencimento da parcela',seletor('politica','',[{v:'origem',t:'Usar os dados atuais da origem Omie'},{v:'local',t:'Manter os dados locais conferidos'},{v:'pendente',t:'Vincular ao contrato e manter valores a conferir'}],'Selecione como tratar a parcela'))+'<p class="cq-nota">Usar a origem adota o valor nominal e vencimento do título. Manter local preserva os dados já conferidos no contrato. Descontos cadastrados não são alterados por esta decisão. Manter pendente confirma o contrato, sem concluir a conferência dos valores.</p>';
    }
    corpo+=campo('Motivo / documento conferido',areaTexto('motivo',''))+'<div class="cq-erro" data-cq-erro role="alert" hidden></div><button type="button" class="btn" data-cq-reler hidden>Recarregar as conferências</button>'+(bloqueado?'':'<div class="cq-modal-acoes"><button type="button" class="btn primario" data-cq-salvar>Confirmar e salvar</button><button type="button" class="btn" data-cq-proximo>Salvar e próximo</button></div>');
    const m=abrirModal({titulo:'Conferir e vincular',corpo,largo:true,acoes:[{texto:'Voltar à fila',aoClicar:fecharModal}]});
    m.querySelector('.modal').classList.add('cq-modal');
    const acoesFixas=m.querySelector('.cq-modal-acoes');if(acoesFixas)m.querySelector('footer').appendChild(acoesFixas);
    const politica=m.querySelector('[data-campo="politica"]'),opcaoLocal=politica?.querySelector('[value="local"]');if(opcaoLocal&&item.vinculos?.length!==1){opcaoLocal.disabled=true;opcaoLocal.textContent+=item.vinculos?.length?' · escolha um contrato com parcela única':' · nenhuma parcela local disponível';}
    const sel=m.querySelector('[data-campo="destino"]');if(sel)sel.onchange=()=>{const v=(regConferido.venda||[]).find(v=>v.id===sel.value),vinculos=item.vinculos||[],noDestino=vinculos.filter(x=>x.venda.id===v?.id);if(opcaoLocal){opcaoLocal.disabled=!(noDestino.length===1||(noDestino.length===0&&vinculos.length===1));opcaoLocal.textContent='Manter os dados locais conferidos'+(opcaoLocal.disabled?' · parcela local não inequívoca':'');}m.querySelector('[data-cq-destino]').innerHTML=v?ficha('Contrato selecionado', [['Cliente',v.clienteNome],['Quadra / lote','Q'+v.quadra+' · L'+v.lote],['Identificação',v.codigo||v.id],['CPF / CNPJ',fmt.doc(v.clienteId)]])+(!origem(item,S.reg).cpf?'<p class="cq-aviso">A origem não informa CPF/CNPJ. Confirme a identidade no comprovante.</p>':''):'';};
    const distribuir=m.querySelector('[data-cq-distribuir]');if(distribuir)distribuir.onclick=()=>{const v=(S.reg.venda||[]).find(v=>v.id===item.rec.vendaId);fecharModal();if(v?.parcelas?.some(p=>p&&!p.cancelado))finEditarRecebimento(item.rec,pintar);else if(v)abrirEditarRec(v,item.rec.id,pintar);};
    const vendaBtn=m.querySelector('[data-cq-venda]');if(vendaBtn)vendaBtn.onclick=()=>{fecharModal();location.hash='#/venda/'+item.rec.vendaId;};
    const recarregar=m.querySelector('[data-cq-reler]');recarregar.onclick=async()=>{try{await relerConfirmado();fecharModal();await carregarSaude(true);pintar();}catch(e){m.querySelector('[data-cq-erro]').textContent=e.message;}};
    let ocupado=false,confirmado=false,operacao=crypto.randomUUID(),assinatura='';
    async function enviar(proximo) {
      if(ocupado)return;const erro=m.querySelector('[data-cq-erro]');erro.hidden=true;
      try {
        const fAntes=estado(),filaAntes=filtrar(montarFilas(S.reg,saude)[fAntes.grupo]||[],fAntes,S.reg),posAntes=filaAntes.findIndex(x=>x.chave===item.chave);
        const c=lerCampos(m),p=prepararPayload(item,c,regConferido,operacao),novaAssinatura=JSON.stringify({...p,operacao:''});
        if(assinatura&&novaAssinatura!==assinatura){operacao=crypto.randomUUID();p.operacao=operacao;}assinatura=novaAssinatura;
        ocupado=true;m.querySelectorAll('[data-cq-salvar],[data-cq-proximo]').forEach(b=>b.disabled=true);
        if(!confirmado){const r=await api('conciliarFinanceiro',p);if(r?.ok!==true)throw Error(r?.error||'O servidor não confirmou a gravação.');confirmado=true;m.querySelectorAll('[data-campo]').forEach(el=>el.disabled=true);}
        await relerConfirmado();
        const f=estado(),pos=posAntes;
        fecharModal();pintar();toast('Conferência confirmada e dados atualizados.');
        if(proximo){const fila=filtrar(montarFilas(S.reg,saude)[f.grupo]||[],f,S.reg),seguinte=fila.find((x,i)=>x.chave!==item.chave&&i>=Math.max(0,pos))||fila.find(x=>x.chave!==item.chave);if(seguinte)abrir(seguinte);else toast('Nenhuma outra conferência neste filtro.');}
      } catch(e) {
        erro.hidden=false;erro.textContent=e.status===409?'Este registro mudou depois da leitura. Recarregue as conferências e compare novamente antes de confirmar. Seu formulário foi mantido.':confirmado?'Vínculo confirmado no servidor. Não foi possível atualizar a leitura: '+e.message+'. Tente novamente para apenas recarregar, sem repetir a gravação.':e.message||'Não foi possível confirmar. O formulário foi mantido.';
        if(e.status===409)recarregar.hidden=false;
      } finally {ocupado=false;m.querySelectorAll('[data-cq-salvar],[data-cq-proximo]').forEach(b=>b.disabled=false);}
    }
    const salvar=m.querySelector('[data-cq-salvar]'),proximo=m.querySelector('[data-cq-proximo]');if(salvar)salvar.onclick=()=>enviar(false);if(proximo)proximo.onclick=()=>enviar(true);
  }
  function renderizar(elemento) {alvo=elemento||document.getElementById('bsq-conciliacao')||document.getElementById('app');if(!alvo)return; if(!['direcao','escritorio'].includes(S.perfil)){alvo.innerHTML='<p class="cq-aviso">A conciliação está disponível apenas para gestão e escritório.</p>';return;}pintar();carregarSaude();}
  window.BSQ_CONCILIACAO={renderizar,montarFilas,sugestoes,prepararPayload,filtrar};
})();
