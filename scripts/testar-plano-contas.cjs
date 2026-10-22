const {test}=require('node:test'),assert=require('node:assert/strict'),F=require('../financeiro-gestao.js');
const item=(id,valor,codigo,nome,entrada=false,extra={})=>({id,valor,entrada,data:'2026-10-10',categoria:nome,ref:{categoriaCodigo:codigo,categoriaNome:nome},...extra});
const soma=(linhas,campo)=>linhas.reduce((s,l)=>s+F.cent(l[campo]),0);

test('categorias com nomes iguais e códigos diferentes continuam separadas',()=>{
  const p=F.planoContas([item('a',10,'2.1','Administração'),item('b',20,'2.2','Administração')]);
  assert.deepEqual(p.linhas.map(l=>[l.codigo,l.saidas]),[['2.1',10],['2.2',20]]);
  assert.notEqual(p.linhas[0].chave,p.linhas[1].chave);assert.equal(p.semCodigo.length,0);
});
test('mesmo código acompanha renomeação e catálogo prevalece sobre nomes históricos',()=>{
  const xs=[item('a',10,'2.1','Nome antigo'),item('b',20,'2.1','Nome atual')];
  assert.equal(F.planoContas(xs).linhas[0].nome,'Nome atual');
  const l=F.planoContas(xs,{'2.1':'Nome oficial'}).linhas[0];
  assert.equal(l.nome,'Nome oficial');assert.equal(l.quantidade,2);assert.equal(l.saidas,30);
});
test('fatias preservam código de cada categoria e do fallback sem mudar centros',()=>{
  assert.equal(F.fatias(item('a',15,'2.1','Materiais'),'categorias')[0].codigo,'2.1');
  assert.equal(F.fatias({valor:15,categoria:'Materiais',categoriaCodigo:'2.2'},'categorias')[0].codigo,'2.2');
  assert.deepEqual(F.fatias({valor:15,centros:[{nome:'Obra',percentual:100}]},'centros'),[{nome:'Obra',valor:15,percentual:100}]);
  const ps=F.fatias({valor:100,categorias:[{codigo:'a',nome:'A',percentual:40},{codigo:'b',nome:'B',percentual:60}]},'categorias');
  assert.deepEqual(ps.map(p=>p.codigo),['a','b']);
});
test('rateio em centavos fecha total e detalhe não aplica rateio novamente',()=>{
  const xs=[item('a',0.05,'base','Base',false,{categorias:[{codigo:'1',nome:'A',percentual:33.33},{codigo:'2',nome:'B',percentual:33.33},{codigo:'3',nome:'C',percentual:33.34}]})];
  const p=F.planoContas(xs);assert.deepEqual(p.linhas.map(l=>l.saidas),[0.02,0.01,0.02]);assert.equal(soma(p.linhas,'saidas'),5);
  for(const l of p.linhas){const d=l.itens[0];assert.deepEqual(d.categorias,[]);assert.deepEqual(d.ref.categorias,[]);assert.equal(d.categoriaCodigo,l.codigo);assert.equal(d.ref.categoriaCodigo,l.codigo);assert.equal(F.planoContas(l.itens).linhas[0].saidas,l.saidas);assert.equal(d.valorOriginal,0.05);assert.equal(d.parcial,true);}
});
test('fatia parcial não presume cruzamento entre categoria e centro de custo',()=>{
  const centros=[{codigo:'obra',nome:'Obra',percentual:70},{codigo:'adm',nome:'Administração',percentual:30}],x=item('a',100,'base','Base',false,{centros,centroCusto:'Original',categorias:[{codigo:'1',nome:'A',percentual:40},{codigo:'2',nome:'B',percentual:60}]});
  const d=F.planoContas([x]).linhas.find(l=>l.codigo==='2').itens[0];
  assert.equal(d.valor,60);assert.deepEqual(d.centros,[]);assert.equal(d.centroCusto,'Não detalhado por categoria');
  assert.deepEqual(x.centros,centros);assert.equal(x.centroCusto,'Original');
  const inteiro=F.planoContas([item('b',100,'1','A',false,{centros,centroCusto:'Original'})]).linhas[0].itens[0];
  assert.deepEqual(inteiro.centros,centros);assert.equal(inteiro.centroCusto,'Original');
  const parcial=F.planoContas([item('c',60,'1','A',false,{centros,centroCusto:'Original',parcial:true,valorOriginal:100})]).linhas[0].itens[0];
  assert.deepEqual(parcial.centros,[]);assert.equal(parcial.centroCusto,'Não detalhado por categoria');
});
test('parte sem código e residual aparecem sinalizados sem inventar categoria',()=>{
  const xs=[item('a',100,'base','Base',false,{categorias:[{codigo:'a',nome:'Com código',percentual:25},{nome:'Sem código conhecido',percentual:25}]})];
  const p=F.planoContas(xs);assert.equal(soma(p.linhas,'saidas'),10000);assert.equal(p.semCodigo.length,2);
  assert.deepEqual(p.semCodigo.map(x=>x.valor),[25,50]);assert.ok(p.semCodigo.every(x=>!x.categoriaCodigo&&!x.ref.categoriaCodigo));
  assert.equal(p.linhas.find(l=>l.nome==='Sem categoria').saidas,50);
});
test('rateios inválidos ficam integralmente sem categoria e conservam valor',()=>{
  for(const categorias of [[{codigo:'a',nome:'A',percentual:130}],[{codigo:'a',nome:'A',percentual:-1}],[{codigo:'a',nome:'A',valor:120}]]){
    const p=F.planoContas([item('a',100,'base','Base',false,{categorias})]);
    assert.equal(p.linhas.length,1);assert.equal(p.linhas[0].codigo,'');assert.equal(p.linhas[0].nome,'Sem categoria');assert.equal(p.linhas[0].saidas,100);assert.equal(p.semCodigo.length,1);
  }
});
test('sem código agrupa nominalmente sem fundir com código ou outro nome',()=>{
  const p=F.planoContas([item('a',10,'','Administração'),item('b',20,'','Administração'),item('c',5,'2.1','Administração'),item('d',1,'','Portaria')]);
  assert.equal(p.linhas.length,3);assert.equal(p.linhas.find(l=>!l.codigo&&l.nome==='Administração').saidas,30);assert.equal(p.semCodigo.length,3);
});
test('entradas e saídas têm participações próprias e totais verificáveis',()=>{
  const xs=[item('a',100,'1','A',true),item('b',300,'2','B',true),item('c',20,'1','A'),item('d',80,'2','B')],p=F.planoContas(xs);
  assert.deepEqual(p.totais,F.resumo(xs));assert.equal(p.linhas[0].participacaoEntradas,25);assert.equal(p.linhas[0].participacaoSaidas,20);
  for(const campo of ['entradas','saidas','resultado'])assert.equal(soma(p.linhas,campo),F.cent(p.totais[campo]));
  assert.equal(F.planoContas([item('a',10,'1','A')]).linhas[0].participacaoEntradas,0);
});
test('catálogo é plano flat, sem gerar pais e sem linhas extras por padrão',()=>{
  const refs={'2.10':'Dez','2.2':'Dois','2.1.1':'Folha','1':'Receita'},xs=[item('a',10,'2.2','Nome histórico')];
  assert.equal(F.planoContas(xs,refs).linhas.length,1);
  const p=F.planoContas(xs,refs,true);assert.deepEqual(p.linhas.map(l=>l.codigo),['1','2.1.1','2.2','2.10']);
  assert.equal(p.linhas.find(l=>l.codigo==='1').quantidade,0);assert.equal(p.linhas.some(l=>l.codigo==='2'),false);assert.equal(p.totais.saidas,10);
  assert.equal(F.planoContas([],{}).linhas.length,0);
});
test('não muta registros nem catálogo ao preparar detalhes de rateio',()=>{
  const xs=[item('a',10,'base','Base',false,{categorias:[{codigo:'1',nome:'A',percentual:40},{codigo:'2',nome:'B',percentual:60}]})],refs={'1':'A oficial'},antes=JSON.stringify({xs,refs});
  F.planoContas(xs,refs,true);assert.equal(JSON.stringify({xs,refs}),antes);
});
test('realizado e saldo de título parcial são consultas separadas sem duplicação',()=>{
  const ref={categoriaCodigo:'2',categoriaNome:'Serviços'},b=F.montar({movbanco:[{id:'b',origem:'omie',data:'2026-10-10',valor:40,entrada:false,titulo:'t',financeiroOmie:ref}],titulo:[{id:'t',titulo:'t',grupo:'CONTA_A_PAGAR',venc:'2026-10-20',status:'PARCIAL',original:{resumo:{nValAberto:60}},financeiroOmie:ref}]},'2026-10-22');
  assert.equal(F.planoContas(b.movimentos).totais.saidas,40);assert.equal(F.planoContas(b.abertos).totais.saidas,60);
});
test('plano respeita base sem transferências cancelados omitidos e filtros do chamador',()=>{
  const m=(id,data,valor,codigo,extra={})=>({id,origem:'omie',data,valor,entrada:false,contaOmie:'1',financeiroOmie:{categoriaCodigo:codigo,categoriaNome:'Categoria'},...extra});
  const b=F.montar({movbanco:[m('a','2026-09-10',10,'1'),m('b','2026-10-10',20,'2'),m('tr','2026-10-10',30,'3',{transferencia:true}),m('om','2026-10-10',40,'4',{omitidoOmie:{em:'2026-10-22'}}),m('ft','2026-11-10',50,'5'),m('ct','2026-10-10',60,'6',{contaOmie:'2'})],titulo:[{id:'cancel',titulo:'cancel',grupo:'CONTA_A_PAGAR',status:'CANCELADO',venc:'2026-10-10',original:{resumo:{nValAberto:100}}}]},'2026-10-22');
  const p=F.planoContas(F.recorte(b.movimentos,{ano:'2026',mes:'10',escopo:'ano',conta:'1'},b.hoje));assert.equal(p.totais.saidas,20);assert.equal(p.linhas.length,1);assert.equal(p.linhas[0].codigo,'2');assert.equal(F.planoContas(b.abertos).linhas.length,0);
});
