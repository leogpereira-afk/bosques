/* Rateio entre contratos independentes. Sem criação de títulos ou recebimentos. */
(() => {
  'use strict';
  const F=typeof FINANCEIRO!=='undefined'?FINANCEIRO:require('./financeiro-core.js');
  const doc=x=>String(x||'').replace(/\D/g,''),vivos=xs=>(xs||[]).filter(x=>x&&!x.apagadoEm);
  const rotulo=v=>[v.codigo||v.id,F.nomeLotes(v)].join(' · ');
  function contexto(reg,tid){
    const t=vivos(reg.titulo).find(t=>t.grupo==='CONTA_A_RECEBER'&&String(t.titulo)===String(tid));
    const vendas=vivos(reg.venda).filter(F.vendaAtiva).filter(v=>doc(v.clienteId)&&doc(v.clienteId)===doc(t?.cpf));
    const recebimentos=vivos(reg.rec).filter(r=>String(r.omie?.titulo)===String(tid));
    return {t,vendas,recebimentos};
  }
  function preparar(reg,tid,partes,distribuicoes,motivo,operacao,entradasNoEspelho=[]){
    const {t,vendas,recebimentos}=contexto(reg,tid);
    if(!F.tituloDisponivel(t)||!doc(t.cpf)||F.entradaSemVenda(t))throw Error('Confira a identidade e a disponibilidade do título na origem.');
    if(!F.dataValida(t.venc)||!(Number(t.valor)>0))throw Error('Valor e vencimento da origem precisam estar válidos.');
    const validar=(ps,total,zero=false)=>Array.isArray(ps)&&ps.length>=2&&new Set(ps.map(p=>p.vendaId)).size===ps.length&&ps.every(p=>Number.isFinite(p.valor)&&(zero?p.valor>=0:p.valor>0)&&Math.abs(p.valor*100-F.cent(p.valor))<0.000001)&&ps.reduce((s,p)=>s+F.cent(p.valor),0)===F.cent(total);
    if(!validar(partes,t.valor))throw Error('Selecione pelo menos dois contratos e distribua exatamente o total do título, em centavos.');
    if(partes.some(p=>!vendas.some(v=>v.id===p.vendaId)))throw Error('Os contratos devem estar disponíveis e pertencer ao mesmo CPF/CNPJ.');
    const ids=new Set(partes.map(p=>p.vendaId));
    const envolvidos=vivos(reg.venda).filter(F.vendaAtiva).filter(v=>(v.parcelas||[]).some(p=>String(p?.tid)===String(tid)&&!p.cancelado&&!p._remover&&!p.apagadoEm));
    if(envolvidos.some(v=>!ids.has(v.id)))throw Error('Inclua também o contrato que contém este título atualmente.');
    for(const v of envolvidos)for(const p of v.parcelas||[])if(String(p?.tid)===String(tid)){
      if(p.venc!==t.venc)throw Error('Há vencimento local diferente da origem. Confira essa pendência antes de dividir.');
      if(p.valorDia!=null&&F.cent(p.valorDia)!==F.cent(p.valor)||p.descontoConfirmado||['desconto','juros','multa'].some(k=>F.cent(p.liquidacao?.[k])!==0))throw Error('Há desconto ou encargo local. Confira sua distribuição antes de ratear.');
    }
    if(['nDesconto','nJuros','nMulta'].some(k=>F.cent(t.original?.resumo?.[k])!==0))throw Error('Este título possui desconto ou encargo; é necessário conferir sua distribuição primeiro.');
    if(recebimentos.some(r=>r.vendaId&&!ids.has(r.vendaId)||F.entradaSemVenda(r)||!F.dataValida(r.data)))throw Error('Confira o vínculo, a classificação e a data dos recebimentos antes de dividir.');
    if(recebimentos.some(r=>!validar(distribuicoes[r.id],r.valor,true)||distribuicoes[r.id].some(p=>!ids.has(p.vendaId))))throw Error('Distribua o valor integral de cada recebimento entre os contratos selecionados.');
    // Uma parcela pode ter vários recebimentos; nenhum contrato recebe além da sua parte.
    for(const p of partes)if(recebimentos.reduce((s,r)=>s+F.cent(distribuicoes[r.id].find(a=>a.vendaId===p.vendaId)?.valor),0)>F.cent(p.valor))throw Error('O recebido de um contrato supera sua parte no título. Confira os comprovantes.');
    if(recebimentos.some(r=>(r.alocacoes||[]).some(a=>String(a.tid)!==String(tid))))throw Error('Já existe distribuição para outros títulos. Confira antes de substituir.');
    if(String(motivo||'').trim().length<3)throw Error('Informe o motivo ou documento conferido.');
    const selecionadas=vendas.filter(v=>ids.has(v.id));
    for(const v of selecionadas)if(!v.entradaNoEspelho&&Number(v.entrada)>0){
      if(!entradasNoEspelho.includes(v.id)||F.cent(v.entrada)!==F.cent(partes.find(p=>p.vendaId===v.id).valor))throw Error('Confirme que a parte deste título representa exatamente a entrada cadastrada, sem somá-la novamente.');
      if(vivos(reg.rec).some(r=>r.vendaId===v.id&&r.tipo==='entrada'&&String(r.omie?.titulo)!==String(tid)))throw Error('Há outro recebimento de entrada neste contrato. Confira antes de dividir.');
    }
    return {titulo:String(tid),partes,entradasNoEspelho,recebimentos:recebimentos.map(r=>({id:r.id,partes:distribuicoes[r.id]})),motivo:motivo.trim(),operacao,
      esperado:{titulo:t.atualizadoEm??null,vendas:Object.fromEntries(selecionadas.map(v=>[v.id,v.atualizadoEm??null])),recebimentos:Object.fromEntries(recebimentos.map(r=>[r.id,r.atualizadoEm??null]))}};
  }
  function abrir(tid,opcoes={}){
    if(!['direcao','escritorio'].includes(S.perfil))return;
    const reg=JSON.parse(JSON.stringify(S.reg)),{t,vendas,recebimentos}=contexto(reg,tid);if(!t)return;
    const ids=new Set(opcoes.selecionados||((t.rateioContratos?.partes||[]).map(p=>p.vendaId)));
    const valores=Object.fromEntries((t.rateioContratos?.partes||[]).map(p=>[p.vendaId,p.valor]));
    const recValores=Object.fromEntries(recebimentos.map(r=>[r.id,Object.fromEntries((r.rateioContratos?.partes||[]).map(p=>[p.vendaId,p.valor]))]));
    let motivo=opcoes.motivo||'',entradaConfirmada=false,pedido=null,gravado=false,ocupado=false,operacao=crypto.randomUUID(),assinatura='';
    const m=abrirModal({titulo:'Dividir entre contratos separados',largo:true,corpo:'<div data-rt-raiz></div>',acoes:[{texto:opcoes.voltar?'Voltar aos contratos':'Voltar',aoClicar:()=>{if(!ocupado){fecharModal();if(!gravado&&opcoes.voltar)opcoes.voltar();}}}]});
    m.querySelector('.modal').classList.add('cq-modal');const raiz=m.querySelector('[data-rt-raiz]');
    const num=v=>String(v??'').replace('.',',');
    function pintar(){
      raiz.innerHTML='<p class="cq-modal-nota">Selecione dois ou mais contratos. As parcelas futuras, comissões e documentos de cada ficha continuam separados.</p><div class="rt-origem"><div><small>Título '+esc(t.titulo)+'</small><strong>'+fmt.brl(t.valor)+'</strong></div><div><small>Vencimento preservado</small><b>'+esc(fmt.data(t.venc))+'</b></div><div><small>Recebimentos existentes</small><b>'+recebimentos.length+' · '+fmt.brl(recebimentos.reduce((s,r)=>s+Number(r.valor),0))+'</b></div></div><details><summary>Observação completa da origem</summary><p style="white-space:pre-wrap">'+esc(t.financeiroOmie?.observacao||'Sem observação na leitura atual.')+'</p></details><h3>1. Contratos e valores</h3><div class="rt-lista">'+vendas.map(v=>'<div class="rt-item"><label><input type="checkbox" data-rt-id="'+esc(v.id)+'" '+(ids.has(v.id)?'checked':'')+'><span><b>'+esc(rotulo(v))+'</b><small>'+esc(v.clienteNome||'')+'</small></span></label><label class="rt-valor"><span>Parte do título (R$)</span><input aria-label="Valor do contrato '+esc(v.codigo||v.id)+'" inputmode="decimal" data-rt-valor="'+esc(v.id)+'" value="'+esc(num(valores[v.id]))+'" '+(ids.has(v.id)?'':'disabled')+'></label><a href="#/venda/'+encodeURIComponent(v.id)+'" data-rt-ficha>Ver ficha ↗</a></div>').join('')+'</div><div data-rt-total role="status" aria-live="polite"></div><h3>2. Distribuição do que já foi recebido</h3>'+(recebimentos.length?recebimentos.map(r=>'<section class="rt-rec"><b>'+esc(r.codigo||r.id)+' · '+fmt.brl(r.valor)+' · '+esc(fmt.data(r.data))+'</b><div class="rt-rec-partes">'+vendas.filter(v=>ids.has(v.id)).map(v=>'<label>'+esc(rotulo(v))+'<input inputmode="decimal" aria-label="Recebido '+esc(r.codigo||r.id)+' para '+esc(v.codigo||v.id)+'" data-rt-rec="'+esc(r.id)+'" data-rt-venda="'+esc(v.id)+'" value="'+esc(num(recValores[r.id][v.id]))+'"></label>').join('')+'</div><p data-rt-rec-total="'+esc(r.id)+'" role="status" aria-live="polite"></p></section>').join(''):'<p>Nenhum recebimento registrado. Esta divisão não registra pagamento.</p>')+'<label class="vg-item"><input type="checkbox" data-rt-entrada '+(entradaConfirmada?'checked':'')+'><span>Este título representa a entrada cadastrada de cada contrato selecionado. Incluir no espelho sem somar a entrada outra vez.</span></label><label class="campo">3. Motivo / documento conferido<textarea data-rt-motivo maxlength="300" rows="2">'+esc(motivo)+'</textarea></label><p class="cq-nota">Não há divisão automática. O total do título e de cada recebimento deve fechar exatamente. Datas e caixa permanecem iguais.</p><div class="cq-erro" role="alert" data-rt-erro hidden></div><button type="button" class="btn primario" data-rt-revisar>Revisar divisão</button>';
      raiz.querySelectorAll('[data-rt-id]').forEach(el=>el.onchange=()=>{el.checked?ids.add(el.dataset.rtId):ids.delete(el.dataset.rtId);pintar();});
      raiz.querySelectorAll('[data-rt-valor]').forEach(el=>el.oninput=()=>{valores[el.dataset.rtValor]=el.value;totais();});
      raiz.querySelectorAll('[data-rt-rec]').forEach(el=>el.oninput=()=>{recValores[el.dataset.rtRec][el.dataset.rtVenda]=el.value;totais();});
      raiz.querySelector('[data-rt-entrada]').onchange=e=>{entradaConfirmada=e.target.checked;};
      raiz.querySelector('[data-rt-motivo]').oninput=e=>{motivo=e.target.value;};
      raiz.querySelectorAll('[data-rt-ficha]').forEach(el=>el.onclick=()=>fecharModal());
      raiz.querySelector('[data-rt-revisar]').onclick=revisar;totais();
    }
    const valor=x=>typeof x==='number'?x:numeroBR(x);
    const partes=vals=>[...ids].map(vendaId=>({vendaId,valor:valor(vals[vendaId])}));
    function totalTexto(ps,total){const soma=ps.reduce((s,p)=>s+F.cent(p.valor),0),dif=F.cent(total)-soma;return '<span>Distribuído <b>'+fmt.brl(soma/100)+'</b></span><span class="'+(dif?'rt-falta':'rt-fechado')+'">'+(dif?'Diferença '+fmt.brl(dif/100):'✓ Total conferido')+'</span>';}
    function totais(){raiz.querySelector('[data-rt-total]').innerHTML=totalTexto(partes(valores),t.valor);raiz.querySelectorAll('[data-rt-rec-total]').forEach(el=>{const r=recebimentos.find(r=>r.id===el.dataset.rtRecTotal);el.innerHTML=totalTexto(partes(recValores[r.id]),r.valor);});}
    function revisar(){
      try{
        const p=preparar(reg,tid,partes(valores),Object.fromEntries(recebimentos.map(r=>[r.id,partes(recValores[r.id])])),motivo,operacao,entradaConfirmada?[...ids]:[]);
        const sig=JSON.stringify({...p,operacao:''});if(assinatura&&sig!==assinatura)p.operacao=operacao=crypto.randomUUID();assinatura=sig;pedido=p;
        raiz.innerHTML='<h3>Confira antes de salvar</h3><p>Título '+esc(t.titulo)+' · '+fmt.brl(t.valor)+' · '+esc(fmt.data(t.venc))+'</p><div class="rt-lista">'+p.partes.map(p=>'<div class="rt-item"><b>'+esc(rotulo(vendas.find(v=>v.id===p.vendaId)))+'</b><strong>'+fmt.brl(p.valor)+'</strong></div>').join('')+'</div>'+p.recebimentos.map(a=>{const r=recebimentos.find(r=>r.id===a.id);return '<p><b>'+esc(r.codigo||r.id)+' · '+fmt.brl(r.valor)+' · '+esc(fmt.data(r.data))+'</b><br>'+a.partes.map(p=>esc(rotulo(vendas.find(v=>v.id===p.vendaId)))+': '+fmt.brl(p.valor)).join('<br>')+'</p>';}).join('')+'<p>'+esc(p.motivo)+'</p><p class="cq-aviso">Os contratos continuam independentes. Nenhum novo título ou recebimento será criado. O histórico registrará a distribuição anterior e a nova.</p><div class="cq-erro" role="alert" data-rt-erro hidden></div><div class="rt-botoes"><button class="btn" data-rt-voltar>Revisar valores</button><button class="btn primario" data-rt-salvar>Confirmar divisão</button></div>';
        raiz.querySelector('[data-rt-voltar]').onclick=pintar;raiz.querySelector('[data-rt-salvar]').onclick=salvar;
      }catch(e){const el=raiz.querySelector('[data-rt-erro]');el.hidden=false;el.textContent=e.message;}
    }
    async function salvar(){if(ocupado)return;ocupado=true;raiz.querySelectorAll('button').forEach(b=>b.disabled=true);
      try{if(!gravado){const r=await api('ratearContratos',pedido);if(r?.ok!==true)throw Error(r?.error||'Gravação não confirmada.');gravado=true;}
        await window.BSQ_CONCILIACAO.relerConfirmado();fecharModal();window.BSQ_CONCILIACAO.renderizar();toast('Divisão confirmada. Contratos e histórico preservados.');
      }catch(e){const el=raiz.querySelector('[data-rt-erro]');el.hidden=false;el.textContent=gravado?'Salvo no servidor; a leitura falhou. Tente novamente para recarregar sem repetir a gravação.':e.status===409?'Os dados mudaram. Feche e atualize antes de conferir novamente.':e.message;
      }finally{ocupado=false;raiz.querySelector('[data-rt-salvar]').disabled=false;raiz.querySelector('[data-rt-voltar]').disabled=gravado;}
    }
    pintar();return m;
  }
  const publico={contexto,preparar,abrir};if(typeof window!=='undefined')window.BSQ_RATEIO=publico;if(typeof module!=='undefined')module.exports=publico;
})();
