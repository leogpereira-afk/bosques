/* Seleção explícita de lotes, títulos e recebimentos. A gravação única e
   auditável acontece no servidor; abrir ou revisar não altera registros. */
(() => {
  'use strict';
  const F=typeof FINANCEIRO!=='undefined'?FINANCEIRO:require('./financeiro-core.js');
  const doc=x=>String(x||'').replace(/\D/g,''),vivos=xs=>(xs||[]).filter(x=>x&&!x.apagadoEm);
  const unicos=xs=>[...new Set((xs||[]).map(String))];
  const fontes=reg=>new Map(vivos(reg.titulo).filter(t=>t.grupo==='CONTA_A_RECEBER').map(t=>[String(t.titulo),t]));
  const lotes=v=>F.lotesVenda(v).map(l=>'Q'+l.quadra+' · L'+l.lote).join(' + ');
  const rotulo=v=>[v.codigo||v.id,lotes(v)].join(' · ');
  function cpfRec(r,reg,ts=fontes(reg)) {
    return doc(ts.get(String(r.omie?.titulo))?.cpf||r.cpf||r.clienteId||r.omie?.cpf||(reg.venda||[]).find(v=>v.id===r.vendaId)?.clienteId);
  }
  function preparar(reg,c,operacao) {
    const ids=unicos(c.vendas),vs=ids.map(id=>(reg.venda||[]).find(v=>v.id===id&&F.vendaAtiva(v)));
    if(!ids.length||vs.some(v=>!v)||!ids.includes(c.principal))throw Error('Selecione os lotes e um contrato principal válido.');
    if(vs.find(v=>v.id===c.principal).situacao==='quitada')throw Error('Escolha como principal um contrato ativo ou a conferir. Contratos quitados podem acompanhar esse principal.');
    const cpf=doc(vs[0].clienteId);if(!cpf||vs.some(v=>doc(v.clienteId)!==cpf))throw Error('Todos os lotes precisam pertencer ao mesmo CPF/CNPJ.');
    const recIds=unicos(c.recebimentos),ts=fontes(reg),rs=recIds.map(id=>vivos(reg.rec).find(r=>r.id===id));
    if(rs.some(r=>!r||cpfRec(r,reg,ts)!==cpf))throw Error('Selecione pagamentos do mesmo CPF/CNPJ do contrato.');
    if(rs.some(r=>F.entradaSemVenda(r,ts)))throw Error('Reabra a conferência da entrada sem venda antes de vinculá-la.');
    const selecionados=new Set(ids),acompanham=vivos(reg.rec).filter(r=>selecionados.has(r.vendaId));
    if(rs.some(r=>r.vendaId&&!selecionados.has(r.vendaId)))throw Error('Inclua o contrato atual do pagamento na seleção de lotes.');
    const extras=unicos(c.titulos),tids=new Set([...vs.flatMap(v=>(v.parcelas||[]).filter(p=>p&&p.origem!=='manual'&&!p.cancelado&&!p.apagadoEm&&!p._remover).map(p=>p.tid).filter(Boolean)),...rs.concat(acompanham).map(r=>r.omie?.titulo).filter(Boolean),...extras].map(String));
    for(const tid of extras){const t=ts.get(tid);if(!F.tituloDisponivel(t)||doc(t.cpf)!==cpf||F.entradaSemVenda(t))throw Error('Título indisponível ou pertencente a outro cliente.');}
    for(const v of vivos(reg.venda).filter(F.vendaAtiva))if(!selecionados.has(v.id)&&(v.parcelas||[]).some(p=>p&&!p.cancelado&&!p.apagadoEm&&!p._remover&&tids.has(String(p.tid))))throw Error('Um título pertence a outro contrato. Inclua esse lote na seleção antes de continuar.');
    if(!['origem','pendente'].includes(c.politica))throw Error('Escolha como conferir os títulos.');
    const motivo=String(c.motivo||'').trim();if(motivo.length<3)throw Error('Informe o documento ou motivo da vinculação.');
    if(c.confirmarPlanoPrincipal!==true)throw Error('Confira e confirme as condições do contrato inteiro.');
    const plano={...c.plano};
    for(const k of ['entrada','qtdeParcelas','valorParcela']){if(plano[k]===''||plano[k]==null||!Number.isFinite(Number(plano[k]))||Number(plano[k])<0)throw Error('Confira o valor de '+k+'.');plano[k]=Number(plano[k]);}
    if(!Number.isInteger(plano.qtdeParcelas))throw Error('A quantidade de parcelas deve ser inteira.');
    plano.entradaNoEspelho=plano.entradaNoEspelho===true;
    if(plano.entradaNoEspelho&&!tids.size&&!vs.some(v=>(v.parcelas||[]).some(p=>p&&p.origem==='manual'&&!p.cancelado&&!p.apagadoEm&&!p._remover)))throw Error('Selecione os títulos ou parcelas que já incluem a entrada.');
    const associadas=vivos(reg.rec).filter(r=>tids.has(String(r.omie?.titulo)));
    if(associadas.some(r=>r.vendaId&&!selecionados.has(r.vendaId)))throw Error('O boleto tem pagamento em outro contrato. Inclua esse lote na seleção.');
    const todasRecs=[...new Map(acompanham.concat(rs,associadas).map(r=>[r.id,r])).values()];
    return {principal:c.principal,vendas:ids,recebimentos:recIds,titulos:extras,politica:c.politica,motivo,operacao,
      plano,confirmarPlanoPrincipal:true,esperado:{vendas:Object.fromEntries(vs.map(v=>[v.id,v.atualizadoEm??null])),
        recebimentos:Object.fromEntries(todasRecs.map(r=>[r.id,r.atualizadoEm??null])),
        titulos:Object.fromEntries([...tids].map(tid=>[tid,ts.get(tid)?.atualizadoEm??null]))}};
  }
  function prepararEntrada(reg,id,tipo,motivo,operacao) {
    const r=vivos(reg.rec).find(r=>r.id===id);if(!r)throw Error('Recebimento não encontrado. Atualize a leitura.');
    if(!['sem_venda','pendente'].includes(tipo))throw Error('Classificação inválida.');
    if(tipo==='sem_venda'&&(reg.venda||[]).some(v=>v.id===r.vendaId&&F.vendaAtiva(v)))throw Error('O recebimento está vinculado a um contrato ativo. Confira esse vínculo primeiro.');
    motivo=String(motivo||'').trim();if(motivo.length<3||motivo.length>300)throw Error('Informe o motivo ou documento conferido (3 a 300 caracteres).');
    const t=fontes(reg).get(String(r.omie?.titulo));
    return {id,tipo,motivo,operacao,esperado:{recebimento:r.atualizadoEm??null,titulo:t?.atualizadoEm??null}};
  }
  const copia=reg=>JSON.parse(JSON.stringify(reg));
  const moeda=n=>fmt.brl(Number(n)||0),data=d=>fmt.data(d)||'Sem data';
  const campo=(texto,html)=>'<label class="campo"><span>'+esc(texto)+'</span>'+html+'</label>';
  const input=(nome,valor,tipo='number')=>'<input data-vg="'+nome+'" type="'+tipo+'" '+(tipo==='number'?'min="0" step="'+(nome==='qtdeParcelas'?'1':'0.01')+'"':'')+' value="'+esc(valor??'')+'">';
  function confirmar({titulo,corpo,action,pedido,aoConcluir,textoConfirmar='Confirmar vínculo'}) {
    let ocupado=false,gravado=false;
    const m=abrirModal({titulo,corpo:corpo+'<div role="alert" data-vg-erro class="cq-erro" hidden></div>',largo:true,semFechar:true,acoes:[
      {texto:'Voltar e revisar',aoClicar:()=>{if(!ocupado&&!gravado)fecharModal();}},
      {texto:textoConfirmar,classe:'primario',aoClicar:async()=>{
        if(ocupado)return;ocupado=true;const erro=m.querySelector('[data-vg-erro]');erro.hidden=true;
        const botoes=m.querySelectorAll('footer button');botoes.forEach(b=>b.disabled=true);
        try{
          if(!gravado){const resposta=await api(action,pedido);if(resposta?.ok!==true)throw Error(resposta?.error||'O servidor não confirmou a gravação.');gravado=true;}
          await window.BSQ_CONCILIACAO.relerConfirmado();fecharModal();aoConcluir?.();toast('Vínculo confirmado e leitura atualizada.');
        }catch(e){erro.hidden=false;erro.textContent=gravado?'Gravado no servidor. A atualização da leitura falhou: '+e.message+'. Clique novamente para atualizar sem repetir a gravação.':e.status===409?'Os registros mudaram. Feche a revisão e atualize as conferências antes de selecionar novamente.':e.message;
        }finally{ocupado=false;botoes.forEach((b,i)=>b.disabled=gravado&&i===0);}
      }}]});
    return m;
  }
  function abrir(contexto={}) {
    if(!['direcao','escritorio'].includes(S.perfil))return;
    const reg=copia(S.reg),ts=fontes(reg),ativas=vivos(reg.venda).filter(F.vendaAtiva);
    const initialRec=vivos(reg.rec).find(r=>r.id===contexto.recId);
    const s={cpf:doc(contexto.cpf||cpfRec(initialRec||{},reg,ts)),vendas:[],recebimentos:contexto.recId?[contexto.recId]:[],titulos:contexto.tid?[String(contexto.tid)]:[],principal:'',politica:'pendente',motivo:'',plano:{},confirmarPlanoPrincipal:false,q:''};
    const m=abrirModal({titulo:'Selecionar lotes e pagamentos',corpo:'<div class="sel-vinculos" data-vg-raiz></div>',largo:true,acoes:[{texto:'Fechar',aoClicar:fecharModal}]});
    const raiz=m.querySelector('[data-vg-raiz]');
    function setPrincipal(id){const v=ativas.find(v=>v.id===id&&v.situacao!=='quitada');s.principal=v?.id||'';s.plano=v?{entrada:v.entrada??0,entradaNoEspelho:v.entradaNoEspelho===true,qtdeParcelas:v.qtdeParcelas??0,valorParcela:v.valorParcela??0,tipoParcela:v.tipoParcela||'Fixa',inicioParcelas:v.inicioParcelas||''}:{};s.confirmarPlanoPrincipal=false;}
    function pintar(){
      const vs=s.cpf?ativas.filter(v=>doc(v.clienteId)===s.cpf):[],ids=new Set(s.vendas),selecionadas=vs.filter(v=>ids.has(v.id));
      const autoRec=new Set(vivos(reg.rec).filter(r=>ids.has(r.vendaId)).map(r=>r.id));
      const autoTitulo=new Set(selecionadas.flatMap(v=>(v.parcelas||[]).filter(p=>p&&p.origem!=='manual'&&!p.apagadoEm&&!p.cancelado&&!p._remover).map(p=>String(p.tid||''))));
      const pessoas=[...new Map(ativas.filter(v=>doc(v.clienteId)).map(v=>[doc(v.clienteId),v.clienteNome||doc(v.clienteId)])).entries()].sort((a,b)=>a[1].localeCompare(b[1]));
      const rs=s.cpf?vivos(reg.rec).filter(r=>cpfRec(r,reg,ts)===s.cpf&&!F.entradaSemVenda(r,ts)):[];
      const titulos=s.cpf?[...ts.values()].filter(t=>doc(t.cpf)===s.cpf&&F.tituloDisponivel(t)&&!F.entradaSemVenda(t)):[];
      const match=x=>!s.q||String(x).toLocaleLowerCase('pt-BR').includes(s.q.toLocaleLowerCase('pt-BR'));
      const escolha=(kind,id,checked,automatico,titulo,detalhe)=>'<label class="vg-item"><input type="checkbox" data-vg-lista="'+kind+'" value="'+esc(id)+'" '+(checked||automatico?'checked ':'')+(automatico?'disabled':'')+'><span><b>'+esc(titulo)+'</b><small>'+esc(detalhe)+(automatico?' · acompanha o contrato':'')+'</small></span></label>';
      raiz.innerHTML='<p>Selecione os lotes que fazem parte de um único contrato e os pagamentos correspondentes. A escolha só será aplicada depois da revisão.</p>'+campo('Cliente', '<select data-vg-cliente><option value="">Selecione o cliente</option>'+pessoas.map(([cpf,nome])=>'<option value="'+esc(cpf)+'" '+(cpf===s.cpf?'selected':'')+'>'+esc(nome)+' · '+esc(fmt.doc(cpf))+'</option>').join('')+'</select>')+
        '<h3>1. Lotes do mesmo contrato</h3><div class="vg-lista">'+(vs.map(v=>escolha('vendas',v.id,ids.has(v.id),false,rotulo(v),(v.clienteNome||'')+' · '+(v.situacao==='quitada'?'Quitado':v.situacao==='conferir'?'A conferir':'Ativo'))).join('')||'<p>'+(s.cpf?'Nenhum contrato disponível para este cliente.':'Selecione um cliente para ver os lotes e pagamentos.')+'</p>')+'</div>'+
        campo('Contrato principal — o código que continuará em uso','<select data-vg-principal><option value="">Selecione após marcar os lotes</option>'+selecionadas.filter(v=>v.situacao!=='quitada').map(v=>'<option value="'+esc(v.id)+'" '+(v.id===s.principal?'selected':'')+'>'+esc(rotulo(v))+'</option>').join('')+'</select>')+
        '<p class="cq-nota">As fichas anteriores permanecem no histórico. Os títulos e pagamentos já vinculados aos contratos selecionados acompanham o contrato principal.</p>'+
        '<h3>2. Pagamentos e títulos</h3>'+campo('Filtrar por código, título ou data',input('q',s.q,'search'))+
        '<details open><summary>Recebimentos · '+rs.length+'</summary><div class="vg-lista">'+(rs.filter(r=>match([r.codigo,r.id,r.omie?.titulo,r.data].join(' '))).map(r=>escolha('recebimentos',r.id,s.recebimentos.includes(r.id),autoRec.has(r.id),(r.codigo||r.id)+' · '+moeda(r.valor),data(r.data)+(r.omie?.titulo?' · Título '+r.omie.titulo:'')+(r.vendaId&&!ids.has(r.vendaId)?' · selecione também o contrato atual':''))).join('')||'<p>Nenhum recebimento neste filtro.</p>')+'</div></details>'+
        '<details><summary>Títulos / boletos · '+titulos.length+'</summary><p class="cq-nota">Marcar um boleto vincula os recebimentos associados. Não registra novo pagamento.</p><div class="vg-lista">'+(titulos.filter(t=>match([t.titulo,t.venc,t.financeiroOmie?.documento].join(' '))).map(t=>escolha('titulos',String(t.titulo),s.titulos.includes(String(t.titulo)),autoTitulo.has(String(t.titulo)),'Título '+t.titulo+' · '+moeda(t.valor),data(t.venc))).join('')||'<p>Nenhum título neste filtro.</p>')+'</div></details>'+
        campo('Conferência dos títulos','<select data-vg="politica"><option value="pendente" '+(s.politica==='pendente'?'selected':'')+'>Vincular e manter valores a conferir</option><option value="origem" '+(s.politica==='origem'?'selected':'')+'>Adotar valor e vencimento atuais do Omie</option></select>')+
        '<h3>3. Condições do contrato inteiro</h3><p class="cq-nota">Os campos começam com as condições do contrato principal. Confira no documento e ajuste para o total de todos os lotes selecionados.</p><div class="vg-plano">'+campo('Entrada total (R$)',input('entrada',s.plano.entrada))+campo('Número de parcelas',input('qtdeParcelas',s.plano.qtdeParcelas))+campo('Valor da parcela (R$)',input('valorParcela',s.plano.valorParcela))+campo('Primeiro vencimento',input('inicioParcelas',s.plano.inicioParcelas,'date'))+campo('Tipo de parcela','<select data-vg="tipoParcela">'+['Fixa','Reajustada','À vista'].map(t=>'<option '+(s.plano.tipoParcela===t?'selected':'')+'>'+t+'</option>').join('')+'</select>')+'</div>'+
        '<label class="vg-item"><input type="checkbox" data-vg="entradaNoEspelho" '+(s.plano.entradaNoEspelho?'checked':'')+'><span>A entrada já está incluída nos títulos / boletos do contrato<small>Marcado: a entrada não será somada novamente ao saldo dos boletos.</small></span></label>'+
        campo('Documento ou motivo da vinculação','<textarea data-vg="motivo" rows="2">'+esc(s.motivo)+'</textarea>')+
        '<label class="vg-item"><input type="checkbox" data-vg="confirmarPlanoPrincipal" '+(s.confirmarPlanoPrincipal?'checked':'')+'><span>Conferi que os lotes pertencem ao mesmo contrato e que as condições acima representam o contrato inteiro.</span></label><div data-vg-erro class="cq-erro" role="alert" hidden></div><button class="btn primario" type="button" data-vg-revisar>Revisar vínculo selecionado</button>';
      raiz.querySelector('[data-vg-cliente]').onchange=e=>{s.cpf=e.target.value;s.vendas=[];s.recebimentos=[];s.titulos=[];setPrincipal('');pintar();};
      raiz.querySelectorAll('[data-vg-lista]').forEach(el=>el.onchange=()=>{const k=el.dataset.vgLista;s[k]=el.checked?unicos([...s[k],el.value]):s[k].filter(id=>id!==el.value);if(k==='vendas'){if(!s.vendas.includes(s.principal))setPrincipal(s.vendas.length===1?s.vendas[0]:'');s.confirmarPlanoPrincipal=false;}pintar();});
      raiz.querySelector('[data-vg-principal]').onchange=e=>{setPrincipal(e.target.value);pintar();};
      raiz.querySelectorAll('[data-vg]').forEach(el=>el.oninput=()=>{const k=el.dataset.vg,value=el.type==='checkbox'?el.checked:el.value;if(k in s.plano){s.plano[k]=value;s.confirmarPlanoPrincipal=false;raiz.querySelector('[data-vg="confirmarPlanoPrincipal"]').checked=false;}else s[k]=value;if(k==='q'){const pos=el.selectionStart;pintar();const n=raiz.querySelector('[data-vg="q"]');n.focus();try{n.setSelectionRange(pos,pos);}catch{}}});
      raiz.querySelector('[data-vg-revisar]').onclick=()=>{const erro=raiz.querySelector('[data-vg-erro]');erro.hidden=true;try{
        const pedido=preparar(reg,s,crypto.randomUUID()),principal=vs.find(v=>v.id===pedido.principal),recs=vivos(reg.rec).filter(r=>Object.hasOwn(pedido.esperado.recebimentos,r.id));
        const resumo='<p><b>'+esc(principal.clienteNome||'Cliente')+'</b></p><p>Contrato principal: <b>'+esc(principal.codigo||principal.id)+'</b></p><ul>'+selecionadas.map(v=>'<li>'+esc(rotulo(v))+'</li>').join('')+'</ul><p><b>'+recs.length+(recs.length===1?' recebimento · ':' recebimentos · ')+moeda(recs.reduce((n,r)=>n+Number(r.valor||0),0))+'</b><br>'+Object.keys(pedido.esperado.titulos).length+' títulos / boletos envolvidos.</p><details><summary>Conferir pagamentos</summary><ul>'+recs.map(r=>'<li>'+esc(r.codigo||r.id)+' · '+moeda(r.valor)+' · '+esc(data(r.data))+'</li>').join('')+'</ul></details><p>Entrada '+moeda(pedido.plano.entrada)+(pedido.plano.entradaNoEspelho?' já incluída nos boletos':' separada dos boletos')+'. '+pedido.plano.qtdeParcelas+' parcelas de '+moeda(pedido.plano.valorParcela)+'.</p><p>'+esc(pedido.politica==='origem'?'Títulos: adotar valor nominal e vencimento do Omie.':'Títulos: vínculo confirmado; valores continuam a conferir.')+'</p><p>Motivo: '+esc(pedido.motivo)+'</p><p class="cq-nota">Os valores e as datas dos recebimentos são preservados. O histórico dos contratos incorporados permanece disponível.</p>';
        confirmar({titulo:'Revisar contrato e pagamentos',corpo:resumo,action:'agruparContratos',pedido,aoConcluir:()=>{fecharModal();location.hash='#/venda/'+pedido.principal;if(typeof render==='function')render();}});
      }catch(e){erro.hidden=false;erro.textContent=e.message;}};
    }
    pintar();return m;
  }
  function entrada(id,aoConcluir) {
    const reg=copia(S.reg),r=vivos(reg.rec).find(r=>r.id===id);if(!r)return;
    const reabrir=F.entradaSemVenda(r,reg.titulo),tipo=reabrir?'pendente':'sem_venda';
    const associados=r.omie?.titulo?vivos(reg.rec).filter(x=>String(x.omie?.titulo)===String(r.omie.titulo)):[r];
    const m=abrirModal({titulo:reabrir?'Reabrir conferência de vínculo':'Entrada sem vínculo com venda',largo:true,corpo:'<p><b>'+esc(r.codigo||r.id)+'</b> · '+moeda(r.valor)+' · '+esc(data(r.data))+'</p><p>'+ (reabrir?'O recebimento volta à fila para você selecionar o contrato.':'O valor permanece no caixa, identificado separadamente dos recebimentos de vendas.')+'</p>'+(associados.length>1?'<p>A classificação vale para o título e seus '+associados.length+' recebimentos associados, total '+moeda(associados.reduce((s,x)=>s+Number(x.valor||0),0))+'.</p>':'')+campo('Motivo / documento conferido','<textarea data-vg-motivo rows="3"></textarea>')+'<div data-vg-erro role="alert" class="cq-erro" hidden></div>',acoes:[{texto:'Cancelar',aoClicar:fecharModal},{texto:'Revisar classificação',classe:'primario',aoClicar:()=>{
      try{const pedido=prepararEntrada(reg,id,tipo,m.querySelector('[data-vg-motivo]').value,crypto.randomUUID());confirmar({titulo:reabrir?'Confirmar reabertura':'Confirmar entrada sem venda',corpo:'<p>'+esc(r.codigo||r.id)+' · '+moeda(r.valor)+'</p><p>'+esc(pedido.motivo)+'</p><p>'+ (reabrir?'Retornar à conferência de contrato.':'Classificar como entrada sem vínculo com venda. O valor recebido e sua data permanecem iguais.')+'</p>',action:'classificarEntrada',textoConfirmar:reabrir?'Reabrir conferência':'Confirmar classificação',pedido,aoConcluir:()=>{fecharModal();aoConcluir?.();}});}catch(e){const erro=m.querySelector('[data-vg-erro]');erro.hidden=false;erro.textContent=e.message;}
    }}]});return m;
  }
  function semVenda() {
    const rs=vivos(S.reg.rec).filter(r=>F.entradaSemVenda(r,S.reg.titulo));
    const m=abrirModal({titulo:'Entradas sem vínculo com venda',largo:true,corpo:'<p>'+rs.length+' recebimentos · '+moeda(rs.reduce((s,r)=>s+Number(r.valor||0),0))+'</p><p>Esses valores permanecem no caixa. Você pode reabrir a conferência de um vínculo.</p><div class="vg-lista">'+rs.map(r=>'<button type="button" class="btn" data-vg-entrada="'+esc(r.id)+'">'+esc(r.codigo||r.id)+' · '+moeda(r.valor)+' · '+esc(data(r.data))+'</button>').join('')+'</div>',acoes:[{texto:'Fechar',aoClicar:fecharModal}]});
    m.querySelectorAll('[data-vg-entrada]').forEach(b=>b.onclick=()=>entrada(b.dataset.vgEntrada,()=>{fecharModal();semVenda();}));
    return m;
  }
  const publico={preparar,prepararEntrada,abrir,entrada,semVenda};
  if(typeof window!=='undefined')window.BSQ_VINCULACAO=publico;
  if(typeof module!=='undefined')module.exports=publico;
})();
