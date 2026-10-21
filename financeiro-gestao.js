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
    let usado=0,percentualAcumulado=0;
    const out=partes.map((p,i)=>{
      percentualAcumulado+=Number(p.percentual)||0;
      // Arredonda o acumulado, não cada fatia isolada: o rateio nunca cria
      // centavos nem produz uma última fatia negativa para compensá-los.
      let valor=somaP?Math.max(0,Math.min(v,Math.round(v*percentualAcumulado/100))-usado):somaV?cent(p.valor):partes.length===1?v:0;
      if(i===partes.length-1&&Math.abs(somaP-100)<0.01)valor=Math.max(0,v-usado);
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
      const pessoa=ref.pessoaNome||venda?.clienteNome||(ref.pessoaCodigo?'Favorecido Omie '+ref.pessoaCodigo:'Nome não informado');
      const categoria=ref.categoriaNome|| (ref.categoriaCodigo?'Categoria Omie '+ref.categoriaCodigo:'Sem categoria');
      const valor=pendente?Number(t.original?.resumo?.nValAberto)||0:Number(r.valor)||0;
      const dt=pendente?data(r.venc):data(r.data);
      return {...r,valor,data:dt,entrada,pendente,ref,tituloOriginal:t,locais,vendaId:venda?.id,
        pessoa,pessoaCodigo:ref.pessoaCodigo||pessoa,descricao:ref.observacao||ref.documento||locais.find(l=>l.descricao&&!/^Título Omie/.test(l.descricao))?.descricao||(r.transferencia?'Transferência entre contas':r.titulo?'Título '+r.titulo:'Movimento '+r.id),
        categoria,categorias:ref.categorias||[],centros:ref.centros||[],centroCusto:'',
        conta:String(r.contaOmie||ref.contaCodigo||''),contaNome:ref.contaNome||conta.get(String(r.contaOmie||ref.contaCodigo))||'Conta Omie '+(r.contaOmie||ref.contaCodigo||'não informada'),
        situacao:pendente?(!valida(dt)?'Sem vencimento':dt<hoje?'Vencido':dt===hoje?'Vence hoje':'A vencer'):r.transferencia?'Transferência':!valida(dt)?'Sem data':dt>hoje?'Data futura na origem':'Realizado',
      };
    };
    const vistos=new Set();const bancos=(reg.movbanco||[]).filter(r=>!r.apagadoEm&&!r.omitidoOmie&&r.origem==='omie'&&!vistos.has(r.id)&&vistos.add(r.id)).map(r=>enriquecer(r));
    const movimentos=bancos.filter(x=>!x.transferencia&&valida(x.data)&&x.data<=hoje&&x.valor>0);
    const excluidos=bancos.filter(x=>!x.transferencia&&(!valida(x.data)||x.data>hoje||x.valor<=0));
    const abertos=[...titulos.values()].filter(t=>t.status!=='CANCELADO'&&Number(t.original?.resumo?.nValAberto)>0&&['CONTA_A_RECEBER','CONTA_A_PAGAR'].includes(t.grupo)).map(t=>enriquecer(t,true));
    const retiradas=movimentos.flatMap(x=>fatias(x,'categorias').filter(p=>socio(p.nome)).map(p=>({...x,valor:p.valor,valorOriginal:x.valor,categoria:p.nome,categorias:[],centros:[],centroCusto:'Não detalhado por categoria',parcial:p.percentual<99.999})));
    const possiveis=movimentos.filter(x=>!retiradas.some(r=>r.id===x.id)&&socio(x.descricao));
    const locais=[...(reg.rec||[]),...(reg.cx||[])].filter(x=>!x.apagadoEm&&!x.anotacao&&!x.omie?.titulo);
    return {movimentos,bancos,omitidos:(reg.movbanco||[]).filter(r=>r.omitidoOmie&&!r.apagadoEm),transferencias:bancos.filter(x=>x.transferencia&&valida(x.data)&&x.data<=hoje),excluidos,abertos,retiradas,possiveis,locais,hoje};
  }
  function filtrar(lista,f={}) {return lista.filter(x=>(!f.ano||x.data.startsWith(f.ano))&&(!f.mes||x.data.slice(5,7)===f.mes)&&(!f.de||x.data>=f.de)&&(!f.ate||x.data<=f.ate)&&(!f.tipo||x.entrada===(f.tipo==='entrada'))&&(!f.conta||x.conta===f.conta)&&(!f.pessoa||x.pessoaCodigo===f.pessoa)&&(!f.situacao||x.situacao===f.situacao)&&(!f.q||texto([x.descricao,x.pessoa,x.ref?.documento,x.titulo,x.categoria,x.contaNome].join(' ')).includes(texto(f.q))));}
  function resumo(itens){const e=itens.filter(x=>x.entrada).reduce((s,x)=>s+cent(x.valor),0),s=itens.filter(x=>!x.entrada).reduce((s,x)=>s+cent(x.valor),0);return {entradas:rs(e),saidas:rs(s),resultado:rs(e-s),quantidade:itens.length};}
  function agrupar(itens,campo){const grupos=new Map();for(const x of itens){const partes=['centros','categorias'].includes(campo)?fatias(x,campo):[{nome:campo==='pessoa'?x.pessoa:x[campo]||'Não informado',valor:x.valor}];for(const p of partes){const chave=campo==='pessoa'?x.pessoaCodigo:p.nome;const g=grupos.get(chave)||{chave,nome:p.nome,itens:[]};g.itens.push({...x,valor:p.valor,valorOriginal:x.valorOriginal||x.valor,parcial:x.parcial||Math.abs(cent(p.valor)-cent(x.valor))>0,...(campo==='categorias'?{categoria:p.nome,categorias:[]}:campo==='centros'?{centroCusto:p.nome,centros:[]}:{} )});grupos.set(chave,g);}}
    return [...grupos.values()].map(g=>({...g,...resumo(g.itens)})).sort((a,b)=>b.saidas-a.saidas||b.entradas-a.entradas||a.nome.localeCompare(b.nome));}
  function meses(itens,ano){return Array.from({length:12},(_,i)=>{const mes=String(i+1).padStart(2,'0'),ls=filtrar(itens,{ano,mes});return {mes:ano+'-'+mes,itens:ls,...resumo(ls)};});}
  // Consultas gerenciais. Nulos são ausência de confirmação, nunca zero.
  const numero=v=>v==null||!['number','string'].includes(typeof v)||String(v).trim()===''||typeof v==='boolean'||!Number.isFinite(Number(v))?null:Number(v);
  const soma=xs=>xs.reduce((s,x)=>s+cent(x.valor),0)/100;
  const dia=(d,n=0)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
  const ultimo=mes=>new Date(Number(mes.slice(0,4)),Number(mes.slice(5,7)),0,12).toISOString().slice(0,10);
  const deslocarMes=(d,n)=>{const x=new Date(d+'T12:00:00Z'),dd=x.getUTCDate();x.setUTCDate(1);x.setUTCMonth(x.getUTCMonth()+n);const m=x.toISOString().slice(0,7);return m+'-'+String(Math.min(dd,Number(ultimo(m).slice(8)))).padStart(2,'0');};
  function intervalo(f={},hoje,itens=[]) {
    let de,ate;
    if(f.escopo==='personalizado'){de=f.de;ate=f.ate;}
    else if(['12m','24m'].includes(f.escopo)){de=deslocarMes(hoje,1-Number(f.escopo.slice(0,-1))).slice(0,7)+'-01';ate=hoje;}
    else if(f.escopo==='todos'||!f.ano){const ds=itens.map(x=>x.data).filter(valida).sort();de=ds[0]||hoje;ate=ds.at(-1)||hoje;}
    else {de=f.ano+'-'+(f.mes||'01')+'-01';ate=ultimo(f.ano+'-'+(f.mes||'12'));}
    return {de,ate,valido:valida(de)&&valida(ate)&&de<=ate};
  }
  function recorte(lista,f,hoje){const p=intervalo(f,hoje,lista);return p.valido?filtrar(lista,{conta:f.conta,tipo:f.tipo,q:f.q,...(f.escopo==='todos'||!f.ano&&f.escopo!=='personalizado'&&!['12m','24m'].includes(f.escopo)?{}:{de:p.de,ate:p.ate})}):[];}
  function sequencia(de,ate,gran='mes') {
    if(!valida(de)||!valida(ate)||de>ate)return [];
    const out=[];let d=de;
    while(d<=ate&&out.length<2400){const fim=gran==='dia'?d:gran==='ano'?d.slice(0,4)+'-12-31':ultimo(d.slice(0,7));out.push({chave:gran==='dia'?d:gran==='ano'?d.slice(0,4):d.slice(0,7),de:d,ate:fim<ate?fim:ate});d=dia(fim,1);}
    return out;
  }
  function serie(itens,de,ate,gran='mes'){return sequencia(de,ate,gran).map(p=>{const ls=filtrar(itens,p);return {...p,itens:ls,...resumo(ls)};});}
  function carteira(itens,hoje){
    const validos=itens.filter(x=>valida(x.data)),limite=deslocarMes(hoje,12),faixas=[['1–30 dias',1,30],['31–60 dias',31,60],['61–90 dias',61,90],['Mais de 90 dias',91,Infinity]];
    const dividir=(nome,ls)=>({nome,itens:ls,valor:soma(ls),quantidade:ls.length});
    return {total:soma(itens),vencidos:dividir('Vencidos',validos.filter(x=>x.data<hoje)),hoje:dividir('Vencem hoje',validos.filter(x=>x.data===hoje)),futuros:dividir('A vencer',validos.filter(x=>x.data>hoje)),proximos:dividir('Próximos 12 meses',validos.filter(x=>x.data>hoje&&x.data<=limite)),posteriores:dividir('Após 12 meses',validos.filter(x=>x.data>limite)),semData:dividir('Sem vencimento',itens.filter(x=>!valida(x.data))),
      anos:[...new Set(validos.map(x=>x.data.slice(0,4)))].sort().map(ano=>({...dividir(ano,validos.filter(x=>x.data.startsWith(ano))),ano})),
      atrasos:faixas.map(([n,min,max])=>dividir(n,validos.filter(x=>{const dias=Math.round((Date.parse(hoje+'T12:00Z')-Date.parse(x.data+'T12:00Z'))/864e5);return dias>=min&&dias<=max;})))};
  }
  function contasDisponiveis(b,reg={},saldos){
    const cs=new Map();for(const x of [...b.bancos,...b.abertos])if(x.conta)cs.set(x.conta,{id:x.conta,nome:x.contaNome});
    for(const x of reg.conta||[])if(!x.apagadoEm&&x.omieId)cs.set(String(x.omieId),{...cs.get(String(x.omieId)),id:String(x.omieId),nome:x.nome,abertura:x});
    for(const x of saldos?.contas||[])cs.set(String(x.id),{...cs.get(String(x.id)),...x,id:String(x.id)});
    return [...cs.values()].sort((a,b)=>a.nome.localeCompare(b.nome));
  }
  function saldoResumo(dados,conta='',agora=new Date().toISOString()) {
    const todas=dados?.contas||[],incluidas=todas.filter(c=>conta?String(c.id)===conta:!c.inativa&&c.fluxo!==false&&['CC','CX','CP','CV','PG'].includes(c.tipo));
    const faltam=incluidas.filter(c=>numero(c.saldoRealizado)===null||c.erro),desatualizado=!!dados?.desatualizado||!dados?.quando||!Number.isFinite(Date.parse(dados.quando))||Date.parse(agora)-Date.parse(dados.quando)>30*60e3;
    const parcial=!!dados?.parcial||dados?.schema!==2||!incluidas.length||!!faltam.length;
    const conhecido=incluidas.reduce((s,c)=>s+cent(numero(c.saldoRealizado)),0)/100;
    return {incluidas,excluidas:todas.filter(c=>!incluidas.includes(c)),faltam,parcial,desatualizado,conhecido,valor:parcial?null:conhecido,ancora:!parcial&&!desatualizado?conhecido:null,quando:dados?.quando,dataBase:dados?.dataBase,erro:dados?.erro||'',fonte:'Extrato Omie · realizado'};
  }
  function historico(b,f,contas=[],extratos=[]) {
    const periodo=intervalo(f,b.hoje,b.bancos),ids=f.conta?[f.conta]:contas.map(c=>String(c.id)),xs=[...b.movimentos,...b.transferencias];
    return sequencia(periodo.de,periodo.ate).map(p=>{
      const ate=p.ate>b.hoje?b.hoje:p.ate,ls=filtrar(xs,{conta:f.conta,de:p.de,ate}),ops=ls.filter(x=>!x.transferencia),tr=ls.filter(x=>x.transferencia),r=resumo(ops),rt=resumo(tr);
      const contasMes=ids.map(id=>{
        const candidatos=extratos.filter(e=>String(e.conta)===id&&e.de===p.de&&e.ate===ate&&!e.erro).sort((a,b)=>String(b.quando).localeCompare(String(a.quando))),e=candidatos[0];
        const ms=filtrar(xs,{conta:id,de:p.de,ate}),net=resumo(ms).resultado,inicial=numero(e?.saldoInicial),origem=numero(e?.saldoFinalExtrato);
        const aberturas=(e?.trilha||[]).filter(t=>t.origem==='Cadastro da Conta Corrente'&&t.bloqueado&&t.data===e.cadastro?.dataInicial&&t.data>=p.de&&t.data<=ate&&['R','P'].includes(t.natureza));
        const implantacao=aberturas.length===1&&numero(e?.cadastro?.saldoInicial)!==null&&cent(e.cadastro.saldoInicial)===(aberturas[0].natureza==='R'?1:-1)*Math.abs(cent(aberturas[0].valor))?numero(e.cadastro.saldoInicial):0;
        const diferenca=inicial!==null&&origem!==null?(cent(inicial)+cent(net)+cent(implantacao)-cent(origem))/100:null;
        const confirmado=!!e?.completo&&diferenca===0&&p.de<=b.hoje;
        return {id,nome:contas.find(c=>String(c.id)===id)?.nome||id,inicial,origem,implantacao,diferenca,confirmado,extrato:e,itens:ms};
      });
      const confirmado=ids.length>0&&contasMes.every(c=>c.confirmado)&&!ls.some(x=>!x.conta);
      return {...p,ate,itens:ls,operacionais:ops,transferencias:tr,...r,transferencia:rt.resultado,implantacao:contasMes.reduce((s,c)=>s+cent(c.implantacao),0)/100,variacao:(cent(r.resultado)+cent(rt.resultado)+contasMes.reduce((s,c)=>s+cent(c.implantacao),0))/100,contas:contasMes,
        saldoInicial:confirmado?contasMes.reduce((s,c)=>s+cent(c.inicial),0)/100:null,saldoFinal:confirmado?contasMes.reduce((s,c)=>s+cent(c.origem),0)/100:null,
        estado:p.de>b.hoje?'Período futuro':confirmado?'Conferido com extrato':contasMes.some(c=>c.diferenca!==null&&c.diferenca!==0)?'Diferença a conferir':ls.length?'Saldo não comprovado':'Sem base suficiente'};
    });
  }
  function resumirCaixa(linhas){
    const ls=linhas.filter(l=>l.estado!=='Período futuro'),primeiro=ls[0],ultimo=ls.at(-1),s=k=>ls.reduce((a,l)=>a+cent(l[k]),0)/100;
    const fechado=ls.length>0&&ls.every((l,i)=>l.saldoInicial!==null&&l.saldoFinal!==null&&(!i||cent(ls[i-1].saldoFinal)===cent(l.saldoInicial)));
    return {de:primeiro?.de,ate:ultimo?.ate,entradas:s('entradas'),saidas:s('saidas'),transferencia:s('transferencia'),implantacao:s('implantacao'),variacao:s('variacao'),saldoInicial:fechado?primeiro.saldoInicial:null,saldoFinal:fechado?ultimo.saldoFinal:null,estado:fechado?'Períodos conferidos e saldos contínuos':'Fechamento anual não comprovado · confira meses e continuidade'};
  }
  function comparar(b,f,modo='equivalente') {
    const itens=filtrar(b.movimentos,{conta:f.conta}),p=intervalo(f,b.hoje,itens);
    if(!p.valido||f.escopo==='todos')return null;
    let de=p.de,ate=p.ate;if(modo!=='completos'&&ate>b.hoje)ate=b.hoje;
    if(de>ate)return null;
    const deslocamento=modo==='anoAnterior'||!f.mes&&f.escopo==='ano'?-12:['12m','24m'].includes(f.escopo)?-Number(f.escopo.slice(0,-1)):-1;
    const dias=Math.round((Date.parse(ate)-Date.parse(de))/864e5)+1;
    const anterior=f.escopo==='personalizado'&&modo!=='anoAnterior'?{de:dia(de,-dias),ate:dia(de,-1)}:{de:deslocarMes(de,deslocamento),ate:deslocarMes(ate,deslocamento)},atual={de,ate};
    const a=filtrar(itens,atual),c=filtrar(itens,anterior),ra=resumo(a),rc=resumo(c);
    return {atual:{...atual,itens:a,...ra},anterior:{...anterior,itens:c,...rc},metricas:['entradas','saidas','resultado'].map(k=>({chave:k,delta:a.length&&c.length?(cent(ra[k])-cent(rc[k]))/100:null,percentual:a.length&&c.length&&rc[k]>0?(ra[k]-rc[k])/rc[k]*100:null})),parcial:true};
  }
  function horizonte(b,f={}) {
    const h=f.horizonte||'90',amanha=dia(b.hoje,1),futuros=filtrar(b.abertos,{conta:f.conta}).map(x=>x.data).filter(d=>valida(d)&&d>=amanha).sort();
    let de=amanha,ate;
    if(h==='hoje'){de=b.hoje;ate=b.hoje;}
    else if(/^\d+$/.test(h))ate=dia(b.hoje,Number(h));
    else if(h==='12m')ate=deslocarMes(b.hoje,12);
    else if(h==='ano'){de=f.ano+'-01-01';ate=f.ano+'-12-31';if(de<amanha)de=amanha;}
    else if(h==='personalizado'){de=f.fluxoDe;ate=f.fluxoAte;if(de<amanha)de=amanha;}
    else ate=futuros.at(-1)||amanha;
    return {de,ate,valido:valida(de)&&valida(ate)&&de<=ate};
  }
  function projetar(b,f={},saldos) {
    const p=horizonte(b,f),itens=filtrar(b.abertos,{conta:f.conta}),sr=saldoResumo(saldos,f.conta),corte=sr.dataBase||b.hoje;
    const ids=new Set(sr.incluidas.map(c=>String(c.id))),foraEscopo=itens.filter(x=>valida(x.data)&&x.data>b.hoje&&!ids.has(x.conta));
    const baseValida=sr.ancora!==null&&corte===b.hoje&&!foraEscopo.length;
    // Datas não contêm horário. Títulos de hoje ficam separados para não
    // repetir uma entrada já incorporada à consulta de saldo intradiária.
    const futuros=itens.filter(x=>valida(x.data)&&x.data>b.hoje),alvo=p.valido?filtrar(futuros,p):[];
    let acumulado=0;const gran=f.granularidade==='dia'&&(Date.parse(p.ate)-Date.parse(p.de))/864e5>366?'mes':f.granularidade||((Date.parse(p.ate)-Date.parse(p.de))/864e5<=31?'dia':'mes');
    const anteriores=p.valido?futuros.filter(x=>x.data<p.de):[];acumulado=cent(resumo(anteriores).resultado);
    const linhas=serie(alvo,p.de,p.ate,gran).map(l=>{acumulado+=cent(l.resultado);return {...l,acumulado:acumulado/100,saldo:baseValida?(cent(sr.ancora)+acumulado)/100:null};});
    let minimo=linhas.length&&baseValida?sr.ancora:null,dataMinimo=minimo!==null?corte:null;
    if(minimo!==null){let saldoDia=cent(sr.ancora);const porDia=new Map();for(const x of futuros.filter(x=>x.data<=p.ate))porDia.set(x.data,(porDia.get(x.data)||0)+(x.entrada?1:-1)*cent(x.valor));for(const [d,net] of [...porDia].sort(([a],[b])=>a.localeCompare(b))){saldoDia+=net;if(saldoDia<cent(minimo)){minimo=saldoDia/100;dataMinimo=d;}}}
    return {periodo:p,linhas,itens:alvo,foraEscopo,anteriores,hoje:itens.filter(x=>x.data===b.hoje),vencidos:itens.filter(x=>valida(x.data)&&x.data<b.hoje),semData:itens.filter(x=>!valida(x.data)),resumo:resumo(alvo),saldoBase:baseValida?sr.ancora:null,quando:sr.quando,corte,parcial:true,semPagar:!futuros.some(x=>!x.entrada),minimo,dataMinimo,granularidade:gran};
  }
  return {montar,filtrar,resumo,agrupar,meses,fatias,socio,valida,cent,data,numero,soma,dia,ultimo,deslocarMes,intervalo,recorte,sequencia,serie,carteira,contasDisponiveis,saldoResumo,historico,resumirCaixa,comparar,horizonte,projetar};
})();
if(typeof module!=='undefined')module.exports=FIN_GESTAO;
