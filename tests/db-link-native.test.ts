import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { connect, Socket } from 'node:net';
import { Client } from 'pg';
import Cursor from 'pg-cursor';
import mysql from 'mysql2';
import type { DbLinkEngine, DbLinkRuntimeConnection } from '../src/host/db-link-types.ts';
import { createDbLinkDriver } from '../src/host/db-link-driver.ts';
// @ts-expect-error -- Static test-only Node .mjs fixture; importing it starts no engine.
import { startNativeFixtures } from '../scripts/db-link-native-fixtures.mjs';

type Fixtures = {
  configs: Record<DbLinkEngine, DbLinkRuntimeConnection>; directory: string; receipt: Record<string, unknown>;
  untrustedCa: string; restartCertificate(engine: DbLinkEngine, wrong: boolean): Promise<void>;
  stop(): Promise<{ stopped: boolean; ownedPids: unknown[]; stops: unknown[] }>;
};
const exact = '9007199254740993.123456789012', big = '9007199254740993';

/** Official SDK reference transport only. This is not a Host admission bypass. */
async function sdkReference(config: DbLinkRuntimeConnection, sql: string, parameters: unknown[] = []): Promise<unknown[][]> {
  const rows: unknown[][] = [];
  if (config.engine === 'postgresql') {
    const client = new Client({ host: config.host,port: config.port,database: config.database,user: config.username,password: config.password,
      ssl: {ca:config.tls.ca,rejectUnauthorized:true},statement_timeout:1000,lock_timeout:1000 });
    let cursor: Cursor<unknown[]> | undefined;
    try {
      await client.connect();
      cursor=client.query(new Cursor(sql,parameters,{rowMode:'array',types:{getTypeParser:()=>(value:string)=>value}}));
      for (;;) {
        const batch: unknown[][] = await new Promise((resolve,reject)=>cursor!.read(128,(error,values)=>error?reject(error):resolve(values)));
        if(!batch.length) break; rows.push(...batch);
      }
    } finally { if(cursor) await cursor.close(); await client.end(); }
    return rows;
  }
  const socket=new Socket(), closed=new Promise<void>(resolve=>socket.once('close',()=>resolve()));
  const connection=mysql.createConnection({host:config.host,port:config.port,database:config.database,user:config.username,password:config.password,
    ssl:{ca:config.tls.ca,rejectUnauthorized:true,verifyIdentity:true},stream:()=>socket.connect({host:config.host,port:config.port}),
    supportBigNumbers:true,bigNumberStrings:true,decimalNumbers:false,dateStrings:true,jsonStrings:true,rowsAsArray:true,multipleStatements:false});
  connection.on('error',()=>{});
  try {
    await new Promise<void>((resolve,reject)=>connection.connect(error=>error?reject(error):resolve()));
    await new Promise<void>((resolve,reject)=>connection.query("SET SESSION max_execution_time=1000,lock_wait_timeout=1,time_zone='+00:00'",error=>error?reject(error):resolve()));
    for await(const row of connection.execute(sql,parameters as never).stream({highWaterMark:1})) rows.push(row as unknown[]);
  } finally { connection.end(()=>{}); await closed; }
  return rows;
}

test('native final admission and official SDK reference (explicit local synthetic fixture)', {
  skip: process.env.OPTRACALL_DB_NATIVE==='1' ? false : 'NOT_RUN: set OPTRACALL_DB_NATIVE=1 after provisioning fixed private engines', timeout:180000,
}, async t=>{
  const driver=createDbLinkDriver(), cases:Record<string,unknown>[]=[];
  let fixtures:Fixtures|undefined;
  const evidence=process.env.OPTRACALL_DB_NATIVE_EVIDENCE;
  async function save(extra:Record<string,unknown>={}) {
    if(!evidence)return; await mkdir(evidence,{recursive:true});
    await writeFile(path.join(evidence,'native-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),actualEngines:true,
      phase:'final hard admission rejects live SQL; SDK reference cases are separate transport facts',cases,fixture:fixtures?.receipt,
      limits:['Pre-decode memory budget is NOT_ENFORCED for both SDKs.','MySQL PREPARE total deadline is NOT_ENFORCED.','No production adoption, real-model quality or complete DB05/DB14 acceptance.'],...extra},null,2)+'\n');
  }
  async function run(name:string,body:()=>Promise<unknown>) {
    await t.test(name,{timeout:20000},async()=>{
      const started=performance.now();
      try{const facts=await body();cases.push({name,status:'PASS',elapsedMs:performance.now()-started,facts});await save();}
      catch(error){cases.push({name,status:'FAIL',elapsedMs:performance.now()-started,error:error instanceof Error?error.stack:String(error)});await save();throw error;}
    });
  }
  try {
    try{fixtures=await startNativeFixtures() as Fixtures;await save({setup:'PASS'});}
    catch(error){cases.push({name:'fixture setup',status:'FAIL',classification:'environment failure, not product RED',error:String(error)});await save();throw error;}
    assert.ok(fixtures);
    for(const engine of ['postgresql','mysql'] as const) {
      const config=fixtures.configs[engine],schema=engine==='postgresql'?'synthetic':'oc_native';
      await run(`${engine}: trusted TLS and technical catalog remain available with explicit hard-resource refusal`,async()=>{
        const catalog=await driver.catalog(config),observation=catalog.observation;
        assert.equal(observation.reachable,true);assert.equal(observation.queryQualified,false);assert.equal(observation.cancelCapability,'unverified');
        assert.ok(observation.limitations.includes('db_receive_memory_budget_unenforced'));
        if(engine==='mysql')assert.ok(observation.limitations.includes('db_prepare_total_budget_unenforced'));
        assert.equal(catalog.completeness,'complete');
        assert.deepEqual(catalog.objects.map(object=>object.object).sort(),['numbers','orders','parents'].map(name=>`${schema}.${name}`));
        const orders=await driver.describe(config,`${schema}.orders`);assert.equal(orders.queryable,true);
        assert.deepEqual(orders.foreignKeys[0].columns,['tenant_id','parent_id']);assert.deepEqual(orders.foreignKeys[0].referencedColumns,['tenant_key','parent_key']);
        let published=0;
        const terminal=await driver.openQuery(config,{sql:`SELECT amount FROM ${schema}.orders`,parameters:[],scope:{objects:['*']},
          expectedSourceIdentity:observation.sourceIdentity,expectedPermissionBinding:observation.permissionBinding,onColumns:()=>{published++;},onRows:()=>{published++;}});
        assert.equal(terminal.status,'error');assert.equal(terminal.errorCode,'db_native_not_qualified');assert.equal(published,0);assert.equal(terminal.rowsReceived,0);
        assert.equal(terminal.remoteTerminal,true);assert.equal(terminal.connectionEnded,true);
        return {observation,terminal,columns:orders.columns,foreignKeys:orders.foreignKeys};
      });
      await run(`${engine}: official SDK precision reference, not Host-qualified execution`,async()=>{
        const rows=await sdkReference(config,`SELECT amount,big,day,local_ts,instant,j,b FROM ${schema}.orders`);assert.equal(rows.length,1);
        const row=rows[0];assert.equal(row[0],exact);assert.equal(row[1],big);assert.equal(row[2],'2026-11-14');assert.equal(row[3],'2026-11-14 12:34:56.123456');
        assert.ok(typeof row[4]==='string'&&row[4].includes('2026-11-14 12:34:56.123456'));
        assert.ok(typeof row[5]==='string'&&row[5].includes(big)&&row[5].includes('123456789.123456789012'));
        if(engine==='postgresql')assert.equal(row[6],'\\x0001feff');else assert.ok(Buffer.isBuffer(row[6])&&row[6].equals(Buffer.from([0,1,254,255])));
        const placeholder=engine==='postgresql'?'$1':'?';
        const bound=await sdkReference(config,`SELECT amount FROM ${schema}.orders WHERE big=${placeholder}`,[engine==='mysql'?mysql.TypedParameter.LONGLONG(big):big]);assert.deepEqual(bound,[[exact]]);
        const temporal='2026-11-14 12:34:56.123456';
        assert.deepEqual(await sdkReference(config,`SELECT amount FROM ${schema}.orders WHERE local_ts=CAST(${placeholder} AS ${engine==='postgresql'?'TIMESTAMP':'DATETIME(6)'})`,[engine==='mysql'?mysql.TypedParameter.VARCHAR(temporal):temporal]),[[exact]]);
        if(engine==='postgresql')assert.deepEqual(await sdkReference(config,'SELECT amounts FROM synthetic.orders'),[[`{${exact}}`]]);
        return {rows,scope:'official SDK + synthetic source only; final Host live SQL remains refused'};
      });
      await run(`${engine}: public SDK yields a fully decoded oversize field before a Host cell check can run`,async()=>{
        const rows=await sdkReference(config,"SELECT REPEAT('x',1000000) AS payload");
        assert.equal(rows.length,1);assert.equal(typeof rows[0][0],'string');
        const decodedFieldBytes=Buffer.byteLength(rows[0][0] as string);assert.equal(decodedFieldBytes,1000000);
        return {decodedFieldBytes,comparisonHostMaxCellBytes:1000,claim:'post-decode delivery rejection cannot prove a pre-decode memory ceiling'};
      });
      await run(`${engine}: untrusted CA refuses source qualification`,async()=>{
        const negative=await driver.probe({...config,tls:{...config.tls,ca:fixtures!.untrustedCa}});assert.equal(negative.reachable,false);assert.equal(negative.queryQualified,false);return negative;
      });
      await run(`${engine}: trusted issuer with incorrect DNS refuses source identity`,async()=>{
        await fixtures!.restartCertificate(engine,true);
        try{const negative=await driver.probe(config);assert.equal(negative.reachable,false);assert.equal(negative.queryQualified,false);return negative;}
        finally{await fixtures!.restartCertificate(engine,false);}
      });
    }
  } finally {
    const teardown=await fixtures?.stop();
    if(fixtures){const receipt=JSON.parse(await readFile(path.join(fixtures.directory,'fixture.json'),'utf8')) as {ports:Record<string,number>};
      for(const port of Object.values(receipt.ports)){const open=await new Promise<boolean>(resolve=>{const socket=connect({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));});assert.equal(open,false);}}
    await save({teardown});
  }
});
