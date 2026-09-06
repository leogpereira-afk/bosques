const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require((process.env.BSQ_TEST_DEPS||'/tmp/bosques-test-deps')+'/node_modules/@electric-sql/pglite');
(async()=>{
 const db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;create table bsq_registros(colecao text,id text,registro jsonb,atualizado_em timestamptz,apagado boolean default false,primary key(colecao,id));');
 for(const f of ['202609050001_vinculo_financeiro.sql','202609060005_identificar_pagamentos.sql','202609060007_identificar_titulos.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 const put=(c,id,r)=>db.query('insert into bsq_registros(colecao,id,registro) values($1,$2,$3)',[c,id,JSON.stringify({id,...r})]);
 const get=async id=>(await db.query('select registro from bsq_registros where id=$1',[id])).rows[0].registro;
 const run=async a=>(await db.query('select bsq_identificar_titulos_omie($1) r',[a])).rows[0].r;
 await put('venda','v1',{clienteId:'123',quadra:1,lote:2,parcelas:[{valor:70,obs:'Parcela manual preservada'}]});
 await put('venda','v2',{clienteId:'123',quadra:1,lote:3,parcelas:[{tid:'1',valor:1,conferir:true},{tid:'4',valor:100,trava:true},{tid:'5',valor:100,conferir:false}]});
 await put('venda','vd',{clienteId:'123',quadra:1,lote:4,situacao:'distratada',parcelas:[{tid:'6',conferir:true}]});
 for(const [id,doc,cpf,status] of [['1',' Q01L02 ','123'],['2','Q01L02e03','123'],['3','Q01L02','456'],['4','Q01L02','123'],['5','Q01L02','123'],['6','Q01L02','123'],['7','Q01L04','123'],['8','Q01L02','123','CANCELADO'],['9','Q01L02','123'],['10','Q01L02','123'],['11','Q01L02','123']])await put('titulo','t'+id,{titulo:id,cpf,status,grupo:'CONTA_A_RECEBER',valor:100,venc:'2027-08-01',original:{detalhes:{cNumTitulo:doc},resumo:{nValAberto:100}}});
 await put('rec','r9',{valor:90,data:'2026-09-01',omie:{titulo:'9'}});
 await put('rec','r10',{valor:100,vendaId:'v2',omie:{titulo:'10'}});
 await put('rec','r11',{valor:100,alocacoes:[{tid:'1',valor:100}],omie:{titulo:'11'}});
 const original=await get('v2'),origRec=await get('r9');
 const preview=await run(false);assert.equal(preview.titulos,2);assert.equal(preview.pagamentos,1);assert.deepEqual(await get('v2'),original);
 // Uma alteração indevida em outro ponto da operação deve desfazer inclusive vínculos e backup.
 await db.exec(`create function adulterar_teste() returns trigger language plpgsql as $$begin if new.colecao='rec' then new.registro=new.registro||'{"valor":999}';end if;return new;end$$;
 create trigger testar_rollback before update on bsq_registros for each row execute function adulterar_teste();`);
 await assert.rejects(()=>run(true),/valor ou data de pagamento alterados/);
 assert.deepEqual(await get('v2'),original);assert.deepEqual(await get('r9'),origRec);
 assert.equal((await db.query('select count(*)::int n from bsq_auditoria_vinculos')).rows[0].n,0);
 await db.exec('drop trigger testar_rollback on bsq_registros;');
 const result=await run(true);assert.equal(result.titulos,2);assert.equal(result.vendas,1);
 const v=await get('v1');assert.equal(v.parcelas.length,3);assert.equal(v.parcelas[0].obs,'Parcela manual preservada');
 assert.equal(v.parcelas.find(p=>p.tid==='1').valor,100);assert.equal(v.parcelas.find(p=>p.tid==='1').trava,undefined);
 assert.equal((await get('v2')).parcelas.some(p=>p.tid==='1'),false);assert.equal((await get('v2')).parcelas.length,2);
 const r=await get('r9');assert.equal(r.valor,origRec.valor);assert.equal(r.data,origRec.data);assert.equal(r.vendaId,'v1');assert.equal(r.alocacoes[0].valor,90);
 assert.equal((await run(true)).titulos,0);assert.equal((await db.query('select count(*)::int n from bsq_auditoria_vinculos')).rows[0].n,1);
 // Um cliente com duas vendas no mesmo lote não é identificado automaticamente.
 await put('venda','dup',{clienteId:'123',quadra:1,lote:2,parcelas:[]});
 await put('titulo','novo',{titulo:'12',cpf:'123',grupo:'CONTA_A_RECEBER',valor:100,original:{detalhes:{cNumTitulo:'Q01L02'}}});assert.equal((await run(false)).titulos,0);
 console.log('PASSOU: títulos futuros, documento exato, CPF, destino único, conflito confirmado/travado, distrato, cancelamento, rateio manual, migração sem duplicar, parcelas manuais preservadas, backup e repetição segura.');await db.close();
})().catch(e=>{console.error(e);process.exit(1)});
