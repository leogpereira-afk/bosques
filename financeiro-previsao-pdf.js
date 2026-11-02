/* Exportação da carteira exibida: somente leitura, sem depender dos anos
 * abertos na interface e sem escrever nos registros do empreendimento. */
const FIN_PREVISAO_PDF = (() => {
  const VERDE=[45,78,54],CLARO=[201,217,128],TEXTO=[37,56,42],CINZA=[95,109,98];
  const nomes=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const txt=s=>String(s??'').replace(/\u00a0/g,' ').replace(/[−–—]/g,'-').replace(/[^\x20-\xff\n]/g,'');
  const brl=n=>n==null?'A conferir':Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/\u00a0/g,' ');
  const mes=k=>nomes[Number(k.slice(5,7))-1]+'/'+k.slice(0,4);
  const curto=n=>n>=1000000?(n/1000000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' mi':n>=1000?(n/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' mil':n.toLocaleString('pt-BR',{maximumFractionDigits:2});
  const data=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')?d.slice(8)+'/'+d.slice(5,7)+'/'+d.slice(0,4):'A conferir';
  function gerar(modelo,cfg={},opcoes={}) {
    const {salvar=true,dadosFicticios=false,detalharPendencias=false}=opcoes;
    const doc=new window.jspdf.jsPDF({unit:'mm',format:'a4',orientation:'landscape'});
    const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight(),M=12,U=W-2*M,LIMITE=H-17;
    const agora=new Date(),em=agora.toLocaleString('pt-BR'),r=modelo.totais,anos=modelo.anos||[];
    let y=36,secao='Resumo da carteira';
    const escrever=(s,x,altura,opts={})=>doc.text(txt(s),x,altura,opts);
    const paragrafo=(s,tamanho=9)=>{
      doc.setFont('helvetica','normal');doc.setFontSize(tamanho);
      const linhas=doc.splitTextToSize(txt(s),U),altura=linhas.length*tamanho*.3528*1.18+3;
      if(y+altura>LIMITE)nova();
      doc.setFont('helvetica','normal');doc.setFontSize(tamanho);doc.setTextColor(...CINZA);
      doc.text(linhas,M,y);y+=altura;
    };
    function cabecalho(titulo) {
      doc.setFillColor(...VERDE);doc.rect(0,0,W,26,'F');
      doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(15);
      escrever('Portal dos Bosques',M,11);doc.setFontSize(10);escrever('Recebíveis dos lotes vendidos',W-M,11,{align:'right'});
      doc.setFont('helvetica','normal');doc.setFontSize(8);escrever(titulo,M,19);
      escrever(dadosFicticios?'PRÉVIA - DADOS FICTÍCIOS':'Posição atual dos contratos',W-M,19,{align:'right'});
      doc.setFillColor(...CLARO);doc.rect(0,26,W,1.2,'F');y=36;
    }
    function nova(titulo=secao){doc.addPage();secao=titulo;cabecalho(secao);}
    function titulo(s){doc.setFont('helvetica','bold');doc.setFontSize(13);doc.setTextColor(...VERDE);escrever(s,M,y);y+=8;}
    function tabela(colunas,linhas,{resumo=false,compacta=false}={}) {
      const alturaLinha=3.2,pad=compacta?1.2:2.2;
      function head(){
        if(y+10>LIMITE)nova();
        doc.setFillColor(236,241,232);doc.rect(M,y,U,8,'F');doc.setTextColor(...VERDE);doc.setFont('helvetica','bold');doc.setFontSize(8);
        let x=M;for(const c of colunas){escrever(c.nome,c.direita?x+c.largura-pad:x+pad,y+5.2,{align:c.direita?'right':'left'});x+=c.largura;}y+=8;
      }
      head();
      for(let ri=0;ri<linhas.length;ri++){
        const valores=linhas[ri];doc.setFont('helvetica',resumo&&ri===linhas.length-1?'bold':'normal');doc.setFontSize(8);
        const celulas=valores.map((v,i)=>doc.splitTextToSize(txt(v),colunas[i].largura-2*pad));
        let restante=Math.max(1,...celulas.map(c=>c.length)),offset=0;
        while(restante>0){
          if(y+8>LIMITE){nova();head();doc.setFont('helvetica',resumo&&ri===linhas.length-1?'bold':'normal');doc.setFontSize(8);}
          const cabem=Math.max(1,Math.floor((LIMITE-y-2*pad)/alturaLinha)),n=Math.min(restante,cabem),altura=Math.max(compacta?6:7,n*alturaLinha+2*pad);
          doc.setFillColor(...(resumo&&ri===linhas.length-1?[229,238,219]:ri%2?[247,249,244]:[255,255,255]));doc.rect(M,y,U,altura,'F');
          doc.setTextColor(...TEXTO);let x=M;
          celulas.forEach((ls,i)=>{ls.slice(offset,offset+n).forEach((l,j)=>escrever(l,colunas[i].direita?x+colunas[i].largura-pad:x+pad,y+pad+2.3+j*alturaLinha,{align:colunas[i].direita?'right':'left'}));x+=colunas[i].largura;});
          y+=altura;restante-=n;offset+=n;
          if(restante){nova();head();doc.setFont('helvetica','normal');doc.setFontSize(8);}
        }
      }
      y+=5;
    }
    cabecalho(secao);titulo('Uma visão de todos os vencimentos');
    paragrafo('Recebido e a receber agrupados pelo vencimento das parcelas, não pela data de entrada no caixa. Inclui contratos quitados. Os filtros e os anos recolhidos na tela não limitam este PDF.',8);
    const cards=[['Recebido nas parcelas',r.recebido],['A receber - vencido e futuro',r.aberto],['Total das parcelas',r.total]];
    cards.forEach(([t,v],i)=>{const x=M+i*(U+4)/3,w=(U-8)/3;doc.setFillColor(239,244,232);doc.roundedRect(x,y,w,20,2,2,'F');doc.setFont('helvetica','normal');doc.setTextColor(...CINZA);doc.setFontSize(8);escrever(t,x+4,y+6);doc.setTextColor(...VERDE);doc.setFont('helvetica','bold');doc.setFontSize(15);escrever(brl(v),x+4,y+15);});y+=27;
    paragrafo(r.contratos+' contratos | '+r.parcelas+' parcelas nas barras | '+(modelo.intervalo.de?mes(modelo.intervalo.de)+' a '+mes(modelo.intervalo.ate):'Sem parcelas confirmadas com vencimento')+'.');
    tabela([{nome:'Ano',largura:35},{nome:'Recebido',largura:64,direita:true},{nome:'A receber',largura:64,direita:true},{nome:'Total',largura:70,direita:true},{nome:'Parcelas',largura:U-233,direita:true}],
      [...anos.map(a=>[a.ano,brl(a.recebido),brl(a.aberto),brl(a.total),a.itens.length]),['Total',brl(r.recebido),brl(r.aberto),brl(r.total),r.parcelas]],{resumo:true,compacta:true});
    const fora=[['Parcelas a conferir',(modelo.pendencias||[]).length,'Referências individuais; não somadas'],['Planos sem espelho',(modelo.planos||[]).length,brl(r.previsto)],['Recebimentos sem parcela',(modelo.naoAlocado||[]).length,brl(r.naoAlocado)],['Créditos excedentes',(modelo.creditos||[]).length,brl(r.credito)]];
    if(y+22>LIMITE)nova('Resumo - registros fora das barras');
    titulo('Registros fora das barras');
    tabela([{nome:'Grupo',largura:120},{nome:'Registros',largura:38,direita:true},{nome:'Referência (não integra o total das parcelas)',largura:U-158,direita:true}],fora,{compacta:true});
    paragrafo('Base: contratos do Bosques, parcelas vinculadas ao Omie e recebimentos conferidos. Planos e pendências ficam separados; consulte os detalhes no painel. Nenhum recebimento ou histórico é alterado.',8);
    for(const a of anos){
      nova('Previsão por mês - '+a.ano);titulo('Vencimentos de '+a.ano);
      doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(...CINZA);
      escrever('Recebido '+brl(a.recebido)+'   |   A receber '+brl(a.aberto)+'   |   '+a.itens.length+' parcelas',M,y);y+=6;
      doc.setFillColor(...VERDE);doc.rect(M,y-2.5,2.8,2.8,'F');escrever('Recebido',M+4,y);
      doc.setFillColor(...CLARO);doc.rect(M+26,y-2.5,2.8,2.8,'F');escrever('A receber',M+30,y);
      escrever('Escala comum: '+brl(modelo.maximo),W-M,y,{align:'right'});y+=7;
      const top=y,altura=33,base=top+altura,n=a.meses.length,cw=U/Math.max(1,n),bw=Math.min(12,cw*.55),max=Math.max(1,modelo.maximo);
      doc.setDrawColor(221,229,214);doc.setLineWidth(.15);
      for(let l=0;l<=3;l++)doc.line(M,base-altura*l/3,W-M,base-altura*l/3);
      a.meses.forEach((m,i)=>{
        const cx=M+(i+.5)*cw,hr=m.recebido/max*altura,ha=m.aberto/max*altura;
        if(hr){doc.setFillColor(...VERDE);doc.rect(cx-bw/2,base-hr,bw,hr,'F');}
        if(ha){doc.setFillColor(...CLARO);doc.rect(cx-bw/2,base-hr-ha,bw,ha,'F');}
        doc.setFont('helvetica','bold');doc.setFontSize(7.5);doc.setTextColor(...TEXTO);escrever(m.itens.length?curto(m.total):'-',cx,top-1,{align:'center'});
        doc.setFont('helvetica','normal');escrever(nomes[Number(m.chave.slice(5))-1],cx,base+4.5,{align:'center'});
      });y=base+9;
      tabela([{nome:'Mês de vencimento',largura:48},{nome:'Recebido',largura:60,direita:true},{nome:'A receber',largura:60,direita:true},{nome:'Total',largura:65,direita:true},{nome:'Parcelas',largura:U-233,direita:true}],
        [...a.meses.map(m=>[mes(m.chave),brl(m.recebido),brl(m.aberto),brl(m.total),m.itens.length]),['Total de '+a.ano,brl(a.recebido),brl(a.aberto),brl(a.total),a.itens.length]],{resumo:true,compacta:true});
    }
    const grupos=[['pendencias','Parcelas a conferir','Valores de referência individuais. Não somar como dívida confirmada: pode haver vínculos duplicados.'],['planos','Planos sem espelho do Omie','Valores do plano contratual, fora das parcelas confirmadas e dos gráficos.'],['naoAlocado','Recebimentos sem parcela','Recebimentos sem distribuição confirmada. Não atribuídos a um mês de vencimento.'],['creditos','Créditos excedentes','Valores separados da carteira. Não são aplicados automaticamente a outra parcela.']];
    for(const [k,nome,nota] of detalharPendencias?grupos:[]){
      const ls=modelo[k]||[];if(!ls.length)continue;nova(nome);titulo(nome+' - '+ls.length+' registros');paragrafo(nota,8);
      tabela([{nome:'Cliente / lote',largura:64},{nome:'Vencimento / referência',largura:55},{nome:'Motivo',largura:U-155},{nome:'Valor de referência',largura:36,direita:true}],ls.map(l=>[
        l.cliente+'\n'+l.lotes,data(l.venc)+'\n'+l.rotulo+(l.tid?'\nTítulo '+l.tid:''),l.motivo,brl(k==='planos'?l.previsto:l.valorReferencia)
      ]));
    }
    for(let p=1;p<=doc.getNumberOfPages();p++){
      doc.setPage(p);doc.setDrawColor(211,221,205);doc.line(M,H-13,W-M,H-13);doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(...CINZA);
      escrever((dadosFicticios?'Dados fictícios | ':'')+'Gerado em '+em,M,H-8);
      escrever('Somente consulta - valores por vencimento',W/2,H-8,{align:'center'});
      escrever(p+' / '+doc.getNumberOfPages(),W-M,H-8,{align:'right'});
    }
    doc.setProperties({title:'Bosques - Recebíveis dos lotes vendidos',subject:'Previsão por vencimento e valores exatos',author:'Portal dos Bosques',creator:'Portal dos Bosques'});
    if(salvar)salvarNoAparelho(doc.output('blob'),'Bosques-Recebiveis-vendidos-'+agora.toISOString().slice(0,10)+'.pdf');
    return doc;
  }
  return {gerar};
})();
if(typeof module!=='undefined')module.exports=FIN_PREVISAO_PDF;
