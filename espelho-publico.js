/* Acesso ao espelho: cadastro simples e senha comum verificados no servidor. */
(function () {
  'use strict';
  const el = id => document.getElementById(id);
  const token = location.hash.slice(1).trim();
  window.addEventListener('hashchange', () => location.reload());
  const API = 'https://reoghclxripktzpdwhiy.supabase.co/functions/v1/bsq-p/espelho/';
  let nome = '', dados = null, status = '', carregando = false, sessao = '';
  const chaveSessao='bsq_espelho_sessao_'+token;
  try { sessao=sessionStorage.getItem(chaveSessao)||''; } catch (_) {}
  function guardarSessao(valor) {sessao=valor;try {if(valor)sessionStorage.setItem(chaveSessao,valor);else sessionStorage.removeItem(chaveSessao);}catch(_) {}}
  function mostrarEntrada(msg='') {
    guardarSessao('');dados=null;nome='';el('conteudo').hidden=true;el('aviso').hidden=true;el('entrada').hidden=false;
    el('quadras').replaceChildren();el('mapa-publico').replaceChildren();el('nome-erro').textContent=msg;
  }
  async function hashSenha(senha) {
    const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(senha));
    return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('');
  }
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
    const msg='Olá! '+(nome?'Meu nome é '+nome+'. ':'')+(lote?'Gostaria de saber mais sobre o lote '+lote.lote+' da quadra '+lote.quadra:'Gostaria de saber mais sobre os lotes')+' no Portal dos Bosques.';
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
    nome=dados.visitante?.nome||nome;el('saudacao').textContent=nome?'Olá, '+nome:'Explore o empreendimento';
    el('cap-nome').textContent=dados.empresa?.nome||'Portal dos Bosques';
    const data=new Date(dados.geradoEm);
    el('cap-sub').textContent=Number.isNaN(+data)?'Disponibilidade consultada agora.':'Consulta atualizada em '+data.toLocaleString('pt-BR')+'.';
    const href=contato();el('rod-zap').textContent='com a equipe';
    if(href){const a=node('a','','pelo WhatsApp');a.href=href;a.target='_blank';a.rel='noopener noreferrer';el('rod-zap').replaceChildren(a);}
    el('quadra').replaceChildren(new Option('Todas as quadras',''));
    [...new Set(dados.lotes.map(l=>String(l.quadra)))].sort((a,b)=>Number(a)-Number(b)).forEach(q=>el('quadra').add(new Option('Quadra '+q,q)));
    el('q').value='';status='';document.querySelectorAll('[data-status]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.status==='')));
    el('entrada').hidden=true;el('aviso').hidden=true;el('conteudo').hidden=false;
    el('resumo-reservados').hidden=dados.exibirReservados===false;
    document.querySelector('[data-status="Reservado"]').hidden=dados.exibirReservados===false;
    el('lista-nota').textContent=dados.exibirReservados===false?'Lotes disponíveis, conforme a consulta ao sistema.':'Disponíveis e reservados, conforme a consulta ao sistema.';
    MAPA_ESPELHO.montar(el('mapa-publico'),dados.mapaUrl);el('ver-mapa').hidden=el('mapa-publico').hidden;aplicar();
  }
  function aplicar() {
    const termo=el('q').value.trim(),q=el('quadra').value;
    const ls=dados.lotes.filter(l=>(!termo||String(l.lote).includes(termo))&&(!q||String(l.quadra)===q)&&(!status||l.status===status));
    el('n-total').textContent=ls.length;el('n-disp').textContent=ls.filter(l=>l.status==='Disponível').length;
    el('n-res').textContent=ls.filter(l=>l.status==='Reservado').length;
    el('resultado').textContent=ls.length+' lote(s) neste recorte · '+(q?'Quadra '+q:'Todas as quadras')+' · '+(status||'Todas as situações');
    el('vazio').hidden=!!ls.length;el('quadras').replaceChildren();
    const qs=[...new Set(ls.map(l=>String(l.quadra)))].sort((a,b)=>Number(a)-Number(b));
    qs.forEach(qd=>{
      const grupo=ls.filter(l=>String(l.quadra)===qd).sort((a,b)=>String(a.lote).localeCompare(String(b.lote),'pt-BR',{numeric:true}));
      const sec=node('section','quadra'),h=node('h2','','Quadra '+qd),grade=node('div','grade');
      h.append(node('span','',grupo.length+' lote(s) no recorte'));sec.append(h,grade);
      grupo.forEach(l=>{
        const b=node('button','lote '+(l.status==='Disponível'?'disp':'reservado'));b.type='button';
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
      const r=await fetch(API+encodeURIComponent(token),{cache:'no-store',signal:controlador.signal,headers:{Authorization:'Bearer '+sessao}});
      if(r.status===401){mostrarEntrada('Seu acesso expirou ou foi encerrado. Informe a senha para entrar novamente.');return;}
      if(r.status===403||r.status===404){aviso('Este link não está disponível','Peça um novo link para a equipe.');return;}
      if(!r.ok)throw Error('consulta');
      const d=await r.json();if(!Array.isArray(d?.lotes))throw Error('resposta');
      dados={...d,lotes:d.lotes.filter(l=>l&&(l.status==='Disponível'||(d.exibirReservados!==false&&l.status==='Reservado')))};desenhar();
    } catch(e){aviso('Não foi possível carregar','Confira sua conexão e tente novamente.',true);}
    finally{clearTimeout(limite);carregando=false;el('entrar').disabled=false;}
  }
  el('identificacao').onsubmit=async e=>{
    e.preventDefault();if(carregando)return;
    const cadastro={nome:el('visitante').value.trim().replace(/\s+/g,' '),telefone:el('telefone').value,perfil:el('perfil').value};
    const senha=el('senha').value;
    if(cadastro.nome.length<2||!cadastro.telefone||!cadastro.perfil||!senha){el('nome-erro').textContent='Preencha seu nome, telefone, perfil e senha.';return;}
    carregando=true;el('entrar').disabled=true;el('nome-erro').textContent='';
    const controlador=new AbortController(),limite=setTimeout(()=>controlador.abort(),20000);
    try {
      const r=await fetch(API+encodeURIComponent(token),{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},signal:controlador.signal,body:JSON.stringify({...cadastro,senhaHash:await hashSenha(senha)})});
      const d=await r.json();if(!r.ok)throw Error(d.erro||'Não foi possível entrar.');
      if(!d.sessao)throw Error('Resposta de acesso inválida. Tente novamente.');
      guardarSessao(d.sessao);nome=d.nome||cadastro.nome;el('senha').value='';
    }catch(e){el('nome-erro').textContent=e.name==='AbortError'?'A conexão demorou. Tente novamente.':e.message||'Não foi possível entrar.';}
    finally{clearTimeout(limite);carregando=false;el('entrar').disabled=false;}
    if(sessao)await carregar();
  };
  el('tentar').onclick=()=>sessao?carregar():mostrarEntrada();
  el('sair').onclick=()=>{mostrarEntrada();el('identificacao').reset();};
  el('atualizar-lista').onclick=carregar;
  el('ver-mapa').onclick=()=>{el('mapa-publico').scrollIntoView({behavior:'smooth',block:'start'});el('mapa-publico').focus({preventScroll:true});};
  el('q').oninput=aplicar;el('quadra').onchange=aplicar;
  document.querySelectorAll('[data-status]').forEach(b=>b.onclick=()=>{status=b.dataset.status;document.querySelectorAll('[data-status]').forEach(c=>c.setAttribute('aria-pressed',String(c===b)));aplicar();});
  el('limpar').onclick=()=>{el('q').value='';el('quadra').value='';document.querySelector('[data-status=""]').click();};
  el('pdf').onclick=()=>window.print();el('fechar').onclick=()=>el('detalhe').close();
  if(!token)aviso('Link incompleto','Peça à equipe o link completo do espelho.');
  else if(sessao)carregar();
  else mostrarEntrada();
})();
