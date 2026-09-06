/* Consulta pública: nome apenas em memória; nenhuma escrita no ERP/CRM. */
(function () {
  'use strict';
  const el = id => document.getElementById(id);
  const token = location.hash.slice(1).trim();
  window.addEventListener('hashchange', () => location.reload());
  const API = 'https://reoghclxripktzpdwhiy.supabase.co/functions/v1/bsq-p/espelho/';
  let nome = '', dados = null, status = '', carregando = false;
  const brl = n => Number(n).toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
  const area = n => Number(n) > 0 ? Number(n).toLocaleString('pt-BR',{maximumFractionDigits:2}) + ' m²' : 'A confirmar';
  const node = (tag, classe, texto) => {const n=document.createElement(tag);n.className=classe||'';if(texto!=null)n.textContent=texto;return n;};
  function aviso(titulo,texto,repetir=false) {
    el('entrada').hidden=true;el('conteudo').hidden=true;el('aviso').hidden=false;
    el('aviso-titulo').textContent=titulo;el('aviso-texto').textContent=texto;el('tentar').hidden=!repetir;
  }
  function contato(lote) {
    let numero=String(dados?.empresa?.telefone||'').replace(/\D/g,'');
    if(numero.length<10)return '';
    if(numero.length<=11)numero='55'+numero;
    const msg='Olá! Meu nome é '+nome+'. '+(lote?'Gostaria de saber mais sobre o lote '+lote.lote+' da quadra '+lote.quadra:'Gostaria de saber mais sobre os lotes')+' no Portal dos Bosques.';
    return 'https://wa.me/'+numero+'?text='+encodeURIComponent(msg);
  }
  function abrirDetalhe(l) {
    el('det-titulo').textContent='Quadra '+l.quadra+' · Lote '+l.lote;
    el('det-status').textContent=l.status;el('det-area').textContent=area(l.areaM2);
    el('det-preco').textContent=l.status==='Disponível'&&l.preco!=null&&Number(l.preco)>0?brl(l.preco):'Consultar equipe';
    el('det-nota').textContent=l.status==='Disponível'?'Consulte as condições de pagamento e confirme a disponibilidade com a equipe.':'Este lote está '+l.status.toLocaleLowerCase('pt-BR')+'. Consulte a equipe sobre outras opções.';
    const href=contato(l);el('det-contato').hidden=!href;if(href)el('det-contato').href=href;
    el('detalhe').showModal();
  }
  function desenhar() {
    el('saudacao').textContent='Olá, '+nome;
    el('cap-nome').textContent=dados.empresa?.nome||'Portal dos Bosques';
    const data=new Date(dados.geradoEm);
    el('cap-sub').textContent=Number.isNaN(+data)?'Disponibilidade consultada agora.':'Consulta atualizada em '+data.toLocaleString('pt-BR')+'.';
    const href=contato();el('rod-zap').textContent='com a equipe';
    if(href){const a=node('a','','pelo WhatsApp');a.href=href;a.target='_blank';a.rel='noopener noreferrer';el('rod-zap').replaceChildren(a);}
    el('quadra').replaceChildren(new Option('Todas as quadras',''));
    [...new Set(dados.lotes.map(l=>String(l.quadra)))].sort((a,b)=>Number(a)-Number(b)).forEach(q=>el('quadra').add(new Option('Quadra '+q,q)));
    el('q').value='';status='';document.querySelectorAll('[data-status]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.status==='')));
    el('aviso').hidden=true;el('entrada').hidden=true;el('conteudo').hidden=false;aplicar();
    el('titulo-espelho').setAttribute('tabindex','-1');el('titulo-espelho').focus();
  }
  function aplicar() {
    const termo=el('q').value.trim(),q=el('quadra').value;
    const ls=dados.lotes.filter(l=>(!termo||String(l.lote).includes(termo))&&(!q||String(l.quadra)===q)&&(!status||l.status===status));
    el('n-total').textContent=ls.length;el('n-disp').textContent=ls.filter(l=>l.status==='Disponível').length;
    el('n-res').textContent=ls.filter(l=>l.status==='Reservado').length;el('n-vend').textContent=ls.filter(l=>l.status==='Vendido').length;
    el('resultado').textContent=ls.length+' lote(s) neste recorte · '+(q?'Quadra '+q:'Todas as quadras')+' · '+(status||'Todas as situações');
    el('vazio').hidden=!!ls.length;el('quadras').replaceChildren();
    const qs=[...new Set(ls.map(l=>String(l.quadra)))].sort((a,b)=>Number(a)-Number(b));
    qs.forEach(qd=>{
      const grupo=ls.filter(l=>String(l.quadra)===qd).sort((a,b)=>String(a.lote).localeCompare(String(b.lote),'pt-BR',{numeric:true}));
      const sec=node('section','quadra'),h=node('h2','','Quadra '+qd),grade=node('div','grade');
      h.append(node('span','',grupo.length+' lote(s) no recorte'));sec.append(h,grade);
      grupo.forEach(l=>{
        const b=node('button','lote '+(l.status==='Disponível'?'disp':l.status==='Reservado'?'reservado':'vendido'));b.type='button';
        b.setAttribute('aria-label','Quadra '+l.quadra+', lote '+l.lote+', '+l.status+'. Ver detalhes');
        b.append(node('b','','Lote '+l.lote),node('span','m2',area(l.areaM2)),node('span','preco',l.status==='Disponível'&&Number(l.preco)>0?brl(l.preco):'Consultar equipe'),node('span','status',l.status));
        b.onclick=()=>abrirDetalhe(l);grade.append(b);
      });el('quadras').append(sec);
    });
  }
  async function carregar() {
    if(carregando)return;carregando=true;el('entrar').disabled=true;
    aviso('Preparando seu espelho','Estamos consultando a disponibilidade dos lotes.');
    const controlador=new AbortController(),limite=setTimeout(()=>controlador.abort(),20000);
    try {
      const r=await fetch(API+encodeURIComponent(token),{cache:'no-store',signal:controlador.signal});
      if(r.status===403||r.status===404){aviso('Este link não está disponível','Peça um novo link para a equipe.');return;}
      if(!r.ok)throw Error('consulta');
      const d=await r.json();if(!Array.isArray(d?.lotes))throw Error('resposta');dados=d;desenhar();
    } catch(e){aviso('Não foi possível carregar','Confira sua conexão e tente novamente.',true);}
    finally{clearTimeout(limite);carregando=false;el('entrar').disabled=false;}
  }
  el('identificacao').onsubmit=e=>{
    e.preventDefault();const valor=el('visitante').value.trim().replace(/\s+/g,' ');
    if(valor.length<2||valor.length>100||!/[a-zÀ-ÿ]/i.test(valor)){el('nome-erro').textContent='Informe seu nome com pelo menos 2 caracteres.';el('visitante').focus();return;}
    nome=valor;el('nome-erro').textContent='';carregar();
  };
  el('tentar').onclick=carregar;
  el('trocar').onclick=()=>{el('conteudo').hidden=true;el('entrada').hidden=false;el('visitante').focus();};
  el('q').oninput=aplicar;el('quadra').onchange=aplicar;
  document.querySelectorAll('[data-status]').forEach(b=>b.onclick=()=>{status=b.dataset.status;document.querySelectorAll('[data-status]').forEach(c=>c.setAttribute('aria-pressed',String(c===b)));aplicar();});
  el('limpar').onclick=()=>{el('q').value='';el('quadra').value='';document.querySelector('[data-status=""]').click();};
  el('pdf').onclick=()=>window.print();el('fechar').onclick=()=>el('detalhe').close();
  if(!token)aviso('Link incompleto','Peça à equipe o link completo do espelho.');
})();
