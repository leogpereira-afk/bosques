/* Somente dados fictícios; o endpoint abaixo é PostgreSQL local, nunca Supabase. */
if(!window.BOSQUES_PREVIA)throw Error('Prévia isolada obrigatória');
(()=>{
 const anterior=api;
 api=async(action,dados={},opts={})=>{
  if(action==='snapshot'){
   const response=await fetch('/__rateio_snapshot'),r=await response.json();if(!response.ok||!r.ok)throw Error('Não foi possível ler a prévia');
   return {...r,cfg:configDemo,em:new Date().toISOString(),eu:{perfil:'direcao',nome:'Gestão · exemplo'}};
  }
  if(action==='ratearContratos'){
   const response=await fetch('/__rateio',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(dados)}),r=await response.json();if(!response.ok){const e=new Error(r.error);e.status=response.status;throw e;}return r;
  }
  return anterior(action,dados,opts);
 };
 TELAS._gestao={ano:hojeISO().slice(0,4),mes:'',conta:'',q:'',secao:'conferencias'};
})();
window.addEventListener('DOMContentLoaded',()=>{
 const botao=document.querySelector('.previa-aviso button');
 if(botao){botao.textContent='Conferir contratos de destino';botao.onclick=()=>{const t=S.reg.titulo?.find(t=>t.titulo==='demo-entrada');if(!t)return toast('Aguarde a leitura da prévia.');BSQ_CONCILIACAO.abrir({tipo:'titulo',subtipo:'vinculo',chave:'titulo:demo-entrada',titulo:t,valor:t.valor,data:t.venc,motivo:'Exemplo fictício de entrada para contratos separados',vinculos:S.reg.venda.flatMap(v=>(v.parcelas||[]).filter(p=>p.tid===t.titulo).map(parcela=>({venda:v,parcela})))});};}
});
