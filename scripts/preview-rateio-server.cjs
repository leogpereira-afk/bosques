/* Servidor de prévia isolado, com banco PostgreSQL local e dados fictícios. */
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.BSQ_PGLITE_DEPS||'/tmp/bsq-safe-deps']}));
(async()=>{
const root=path.resolve(__dirname,'..'),db=new PGlite(),stamp='2026-01-01T00:00:00.000Z';
await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create table bsq_registros(colecao text,id text,registro jsonb,atualizado_em timestamptz,apagado boolean default false,primary key(colecao,id));');
for(const f of ['202610070001_historico_vinculo_unico.sql','20261021155644_conciliacao_financeira_auditavel.sql','20261021160030_conciliacao_sync_cas.sql','20261029150737_contratos_multilotes_selecao.sql','20261103210000_cobranca_conjunta_preservada.sql','20261103220000_conjunto_divergencias_pendentes.sql','20261104150000_rateio_contratos_independentes.sql'])await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',f),'utf8'));
const put=async(c,id,r)=>db.query('insert into bsq_registros values($1,$2,$3,now(),false)',[c,id,JSON.stringify({id,atualizadoEm:stamp,...r})]);
await put('cliente','11111111111',{nome:'Cliente de exemplo',cpf:'11111111111'});
for(let i=1;i<=3;i++){
 await put('lote','demo-l'+i,{quadra:1,lote:i,areaM2:300,status:'Vendido',vendaId:'demo-v'+i});
 const parcela={tid:'futuro-'+i,valor:400,venc:'2027-01-10',origem:'omie'};
 await put('venda','demo-v'+i,{codigo:'VD-EXEMPLO-0'+i,clienteId:'11111111111',clienteNome:'Cliente de exemplo',quadra:1,lote:i,loteId:'demo-l'+i,situacao:'ativa',entrada:i<3?3000:0,entradaNoEspelho:i===3,comissao:600,corretorNome:'Corretor de exemplo',parcelas:[...(i===1?[{tid:'demo-entrada',valor:6000,venc:'2026-10-10',origem:'omie',conferir:true}]:[]),parcela],anexos:[{id:'anexo-exemplo-'+i,nome:'Referência fictícia de contrato'}],historico:[{id:'criou-'+i,em:stamp,acao:'Ficha fictícia da prévia'}]});
 await put('titulo','CONTA_A_RECEBER-futuro-'+i,{titulo:'futuro-'+i,grupo:'CONTA_A_RECEBER',cpf:'11111111111',valor:400,venc:'2027-01-10',origem:'omie',status:'ABERTO',original:{resumo:{nValAberto:400}},financeiroOmie:{pessoaNome:'Cliente de exemplo',documento:'Q1L'+i}});
}
await put('titulo','CONTA_A_RECEBER-demo-entrada',{titulo:'demo-entrada',grupo:'CONTA_A_RECEBER',cpf:'11111111111',valor:6000,venc:'2026-10-10',origem:'omie',status:'RECEBIDO',financeiroOmie:{pessoaNome:'Cliente de exemplo',documento:'Entrada compartilhada · exemplo',observacao:'Exemplo fictício: uma entrada paga para dois contratos separados. As prestações futuras continuam em cada ficha.'},original:{resumo:{nValPago:6000,nValLiquido:6000,nValAberto:0,cLiquidado:'S'},detalhes:{dDtPagamento:'10/10/2026'}}});
await put('rec','demo-rec',{codigo:'RB-EXEMPLO',vendaId:'',valor:6000,data:'2026-10-10',tipo:'parcela',origem:'omie',conferir:true,omie:{titulo:'demo-entrada',cpf:'11111111111'},contaId:'demo-conta',forma:'PIX',historico:[]});
http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/__rateio_snapshot'){const r=await db.query("select registro||jsonb_build_object('_col',colecao) r from bsq_registros order by colecao,id");res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,registros:r.rows.map(x=>x.r)}));return;}
 if(url.pathname==='/__rateio'&&req.method==='POST'){let body='';for await(const c of req){body+=c;if(body.length>100000)throw Error('Pedido grande demais');}try{const r=await db.query('select bsq_ratear_contratos($1::jsonb,$2) r',[body,'Gestão · prévia fictícia']);res.setHeader('content-type','application/json');res.end(JSON.stringify(r.rows[0].r));}catch(e){res.statusCode=e.code==='40001'?409:400;res.end(JSON.stringify({error:e.message}));}return;}
 const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/preview-rateio.html':url.pathname));if(!file.startsWith(root+path.sep))throw Error('Arquivo inválido');
 const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.json':'application/json'};res.setHeader('content-type',types[path.extname(file)]||'application/octet-stream');res.setHeader('cache-control','no-store');fs.createReadStream(file).on('error',()=>{res.statusCode=404;res.end('Não encontrado');}).pipe(res);
}catch(e){res.statusCode=500;res.end(e.message);}}).listen(5612,'127.0.0.1',()=>console.log('Prévia isolada: http://127.0.0.1:5612/preview-rateio.html?conciliacao=1#/financeiro'));
})();
