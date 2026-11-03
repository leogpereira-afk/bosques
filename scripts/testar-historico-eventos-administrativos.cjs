/* PostgreSQL/PGlite isolado; somente fixtures fictícios, sem conexão remota. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.BSQ_TEST_DEPS,process.cwd()].filter(Boolean)}));
const repo=path.resolve(__dirname,'..'),source={valor:100},changedSource={valor:120};
const oldEvent={em:'2026-01-01',por:'omie',original:{valor:90}};
const admin={id:'evento-ficticio',em:'2026-01-02',por:'Pessoa de teste',acao:'confirmou mesmo pagamento',antes:{vinculo:null},depois:{vinculo:'T-1'}};
const duplicate={em:'2026-01-02',por:'omie',original:source};
const baseline=process.argv.includes('--atual');
(async()=>{
 const db=new PGlite();
 await db.exec('create table bsq_registros(id text primary key,colecao text,registro jsonb);');
 const migration=fs.readFileSync(path.join(repo,'supabase/migrations',baseline?'202609300001_historico_sem_copia.sql':'20261103160000_historico_eventos_administrativos.sql'),'utf8');
 const sql=baseline?migration.match(/create or replace function public\.bsq_historico_sem_copia\(\)[\s\S]*?end\s*\$\$;/i)?.[0]:migration;
 assert.ok(sql,'Definição SQL do trigger encontrada');
 await db.exec(sql);
 await db.exec("create trigger bsq_historico_sem_copia before update on bsq_registros for each row when(new.colecao in ('titulo','movbanco')) execute function bsq_historico_sem_copia();");
 const run=async(col,antes,depois)=>{await db.query('delete from bsq_registros');await db.query('insert into bsq_registros values($1,$2,$3)',['teste',col,JSON.stringify(antes)]);await db.query('update bsq_registros set registro=$1 where id=$2',[JSON.stringify(depois),'teste']);return(await db.query('select registro from bsq_registros')).rows[0].registro;};
 const cases=[
  ['append administrativo preservado',{original:source,historico:[oldEvent]},{original:source,historico:[oldEvent,admin]},[oldEvent,admin]],
  ['snapshot Omie repetido suprimido',{original:source,historico:[oldEvent]},{original:source,historico:[oldEvent,duplicate]},[oldEvent]],
  ['evento administrativo Omie com acao preservado',{original:source,historico:[oldEvent]},{original:source,historico:[oldEvent,{...duplicate,acao:'corrigiu classificacao'}]},[oldEvent,{...duplicate,acao:'corrigiu classificacao'}]],
  ['evento com ID proprio preservado',{original:source,historico:[oldEvent]},{original:source,historico:[oldEvent,{...duplicate,id:'evento-auditado'}]},[oldEvent,{...duplicate,id:'evento-auditado'}]],
  ['append misto filtra somente copia',{original:source,historico:[oldEvent]},{original:source,historico:[oldEvent,duplicate,admin]},[oldEvent,admin]],
  ['original alterado segue fluxo normal',{original:source,historico:[oldEvent]},{original:changedSource,historico:[oldEvent,duplicate]},[oldEvent,duplicate]],
  ['primeiro historico administrativo permitido',{original:source},{original:source,historico:[admin]},[admin]],
  ['sem historico nao cria evento',{original:source},{original:source,valor:100},undefined],
  ['remocao do prefixo recusada',{original:source,historico:[oldEvent]},{original:source,historico:[]},[oldEvent]],
  ['substituicao do prefixo recusada',{original:source,historico:[oldEvent]},{original:source,historico:[admin]},[oldEvent]],
  ['remocao da chave preserva anterior',{original:source,historico:[oldEvent]},{original:source},[oldEvent]],
  ['sem original preserva append e prefixo',{historico:[oldEvent]},{historico:[oldEvent,admin]},[oldEvent,admin]],
  ['sem original preserva historico removido',{historico:[oldEvent]},{},[oldEvent]],
  ['evento diferente da fonte nao e copia',{original:source,historico:[oldEvent]},{original:source,historico:[oldEvent,{...duplicate,original:changedSource}]},[oldEvent,{...duplicate,original:changedSource}]],
 ];
 const results=[];
 for(const col of ['titulo','movbanco'])for(const [name,antes,depois,expected] of cases){try{const actual=await run(col,antes,depois);assert.deepEqual(actual.historico,expected);for(const key of Object.keys(depois).filter(k=>k!=='historico'))assert.deepEqual(actual[key],depois[key]);results.push({col,name,pass:true});}catch(e){results.push({col,name,pass:false,error:e.message});}}
 const other=await run('cx',{original:source,historico:[oldEvent]},{original:source,historico:[oldEvent,admin]});assert.deepEqual(other.historico,[oldEvent,admin]);
 const report={mode:baseline?'atual':'proposta',total:results.length,pass:results.filter(x=>x.pass).length,fail:results.filter(x=>!x.pass).length,results};
 if(process.env.BSQ_TEST_REPORT)fs.writeFileSync(process.env.BSQ_TEST_REPORT,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));await db.close();if(report.fail)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
