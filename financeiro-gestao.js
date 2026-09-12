/* Base única dos painéis: movimentos bancários Omie. Títulos são compromissos,
   nunca uma segunda soma do mesmo pagamento. Nenhuma escrita neste módulo. */
const FIN_GESTAO = (() => {
  const cent=v=>Math.round((Number(v)||0)*100),rs=v=>v/100;
  const texto=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const data=v=>/^\d{2}\/\d{2}\/\d{4}$/.test(v||'')?v.slice(6)+'-'+v.slice(3,5)+'-'+v.slice(0,2):String(v||'').slice(0,10);
  const valida=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&!Number.isNaN(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
  const socio=nome=>/(?:pro[ -]?labore|distribui.*lucro|dividendo|socio|societari)/.test(texto(nome));
  function fatias(x,campo) {
    const partes=x[campo]||[],v=cent(x.valor),nomeVazio=campo==='centros'?'Sem centro de custo':'Sem categoria';
    if(!partes.length)return [{nome:campo==='centros'?(x.centroCusto||nomeVazio):(x.categoria||nomeVazio),valor:rs(v),percentual:100}];
    const somaP=partes.reduce((s,p)=>s+(Number(p.percentual)||0),0),somaV=partes.reduce((s,p)=>s+cent(p.valor),0);
    if(partes.some(p=>Number(p.percentual)<0||Number(p.valor)<0)||somaP>100.01||(!somaP&&somaV>v))return [{nome:nomeVazio,valor:rs(v),percentual:100}];
    let usado=0;
    const out=partes.map((p,i)=>{
      let valor=somaP?Math.round(v*Number(p.percentual||0)/100):somaV?cent(p.valor):partes.length===1?v:0;
      if(i===partes.length-1&&Math.abs(somaP-100)<0.01)valor=v-usado;
      usado+=valor;return {nome:p.nome||(p.codigo?'Código '+p.codigo:nomeVazio),valor:rs(valor),percentual:v?valor/v*100:0};
    }).filter(p=>p.valor>0);
    if(usado<v)out.push({nome:nomeVazio,valor:rs(v-usado),percentual:(v-usado)/v*100});return out;
  }
  function montar(reg,hoje) {
    const titulos=new Map((reg.titulo||[]).filter(x=>!x.apagadoEm).map(t=>[t.grupo+'|'+t.titulo,t]));
    const vinculados=new Map(),vendas=new Map((reg.venda||[]).map(v=>[v.id,v]));
    for(const [col,lista] of [['rec',reg.rec||[]],['cx',reg.cx||[]]])for(const r of lista)if(!r.apagadoEm&&r.omie?.titulo){const k=(col==='rec'?'CONTA_A_RECEBER':'CONTA_A_PAGAR')+'|'+r.omie.titulo;if(!vinculados.has(k))vinculados.set(k,[]);vinculados.get(k).push({...r,col});}
    const conta=new Map((reg.conta||[]).map(c=>[String(c.omieId),c.nome]));
    const enriquecer=(r,pendente=false)=>{
      const entrada=pendente?r.grupo==='CONTA_A_RECEBER':!!r.entrada,k=(entrada?'CONTA_A_RECEBER':'CONTA_A_PAGAR')+'|'+r.titulo;
      const t=pendente?r:titulos.get(k),refs=t?.financeiroOmie||{},orig=r.financeiroOmie||{};
      const ref={...refs,...Object.fromEntries(Object.entries(orig).filter(([,v])=>v!==''&&v!=null&&(!Array.isArray(v)||v.length)))};
      const locais=vinculados.get(k)||[],venda=locais.map(l=>vendas.get(l.vendaId)).find(Boolean);
      const pessoa=ref.pessoaNome||venda?.clienteNome||'Nome não informado';
      const categoria=ref.categoriaNome|| (ref.categoriaCodigo?'Categoria Omie '+ref.categoriaCodigo:'Sem categoria');
      const valor=pendente?Number(t.original?.resumo?.nValAberto)||0:Number(r.valor)||0;
      const dt=pendente?data(r.venc):data(r.data);
      return {...r,valor,data:dt,entrada,pendente,ref,tituloOriginal:t,locais,vendaId:venda?.id,
        pessoa,pessoaCodigo:ref.pessoaCodigo||pessoa,descricao:ref.observacao||ref.documento||locais.find(l=>l.descricao&&!/^Título Omie/.test(l.descricao))?.descricao||(r.transferencia?'Transferência entre contas':r.titulo?'Título '+r.titulo:'Movimento '+r.id),
        categoria,categorias:ref.categorias||[],centros:ref.centros||[],centroCusto:'',
        conta:String(r.contaOmie||ref.contaCodigo||''),contaNome:conta.get(String(r.contaOmie||ref.contaCodigo))||'Conta Omie '+(r.contaOmie||ref.contaCodigo||'não informada'),
        situacao:pendente?(!valida(dt)?'Sem vencimento':dt<hoje?'Vencido':dt===hoje?'Vence hoje':'A vencer'):r.transferencia?'Transferência':!valida(dt)?'Sem data':dt>hoje?'Data futura na origem':'Realizado',
      };
    };
    const vistos=new Set();const bancos=(reg.movbanco||[]).filter(r=>!r.apagadoEm&&r.origem==='omie'&&!vistos.has(r.id)&&vistos.add(r.id)).map(r=>enriquecer(r));
    const movimentos=bancos.filter(x=>!x.transferencia&&valida(x.data)&&x.data<=hoje&&x.valor>0);
    const excluidos=bancos.filter(x=>!x.transferencia&&(!valida(x.data)||x.data>hoje||x.valor<=0));
    const abertos=[...titulos.values()].filter(t=>t.status!=='CANCELADO'&&Number(t.original?.resumo?.nValAberto)>0&&['CONTA_A_RECEBER','CONTA_A_PAGAR'].includes(t.grupo)).map(t=>enriquecer(t,true));
    const retiradas=movimentos.flatMap(x=>fatias(x,'categorias').filter(p=>socio(p.nome)).map(p=>({...x,valor:p.valor,valorOriginal:x.valor,categoria:p.nome,categorias:[],centros:[],centroCusto:'Não detalhado por categoria',parcial:p.percentual<99.999})));
    const possiveis=movimentos.filter(x=>!retiradas.some(r=>r.id===x.id)&&socio(x.descricao));
    const locais=[...(reg.rec||[]),...(reg.cx||[])].filter(x=>!x.apagadoEm&&!x.anotacao&&!x.omie?.titulo);
    return {movimentos,bancos,transferencias:bancos.filter(x=>x.transferencia&&valida(x.data)&&x.data<=hoje),excluidos,abertos,retiradas,possiveis,locais,hoje};
  }
  function filtrar(lista,f={}) {return lista.filter(x=>(!f.ano||x.data.startsWith(f.ano))&&(!f.mes||x.data.slice(5,7)===f.mes)&&(!f.de||x.data>=f.de)&&(!f.ate||x.data<=f.ate)&&(!f.tipo||x.entrada===(f.tipo==='entrada'))&&(!f.conta||x.conta===f.conta)&&(!f.pessoa||x.pessoaCodigo===f.pessoa)&&(!f.situacao||x.situacao===f.situacao)&&(!f.q||texto([x.descricao,x.pessoa,x.ref?.documento,x.titulo,x.categoria,x.contaNome].join(' ')).includes(texto(f.q))));}
  function resumo(itens){const e=itens.filter(x=>x.entrada).reduce((s,x)=>s+cent(x.valor),0),s=itens.filter(x=>!x.entrada).reduce((s,x)=>s+cent(x.valor),0);return {entradas:rs(e),saidas:rs(s),resultado:rs(e-s),quantidade:itens.length};}
  function agrupar(itens,campo){const grupos=new Map();for(const x of itens){const partes=['centros','categorias'].includes(campo)?fatias(x,campo):[{nome:campo==='pessoa'?x.pessoa:x[campo]||'Não informado',valor:x.valor}];for(const p of partes){const chave=campo==='pessoa'?x.pessoaCodigo:p.nome;const g=grupos.get(chave)||{chave,nome:p.nome,itens:[]};g.itens.push({...x,valor:p.valor,valorOriginal:x.valorOriginal||x.valor,parcial:x.parcial||Math.abs(cent(p.valor)-cent(x.valor))>0,...(campo==='categorias'?{categoria:p.nome,categorias:[]}:campo==='centros'?{centroCusto:p.nome,centros:[]}:{} )});grupos.set(chave,g);}}
    return [...grupos.values()].map(g=>({...g,...resumo(g.itens)})).sort((a,b)=>b.saidas-a.saidas||b.entradas-a.entradas||a.nome.localeCompare(b.nome));}
  function meses(itens,ano){return Array.from({length:12},(_,i)=>{const mes=String(i+1).padStart(2,'0'),ls=filtrar(itens,{ano,mes});return {mes:ano+'-'+mes,itens:ls,...resumo(ls)};});}
  return {montar,filtrar,resumo,agrupar,meses,fatias,socio,valida,cent,data};
})();
if(typeof module!=='undefined')module.exports=FIN_GESTAO;
