// Owner-operated migration preparation. Never queries or modifies the source DB.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';

export const PROJECT_ID='akabzpfknwsdmabavcqz';
export const TARGET_DB='c8b5cb1a-2bdf-4545-abef-12e4ffcc9a79';
const root=fileURLToPath(new URL('../',import.meta.url));
const digest=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest('hex');
const quote=name=>'"'+name.replaceAll('"','""')+'"';
const order=['profiles','workspaces','workspace_members','classes','class_members','collections','questions',
  'answer_attempts','user_question_state','comments','collection_access_requests','collection_members',
  'collection_access_notifications','custom_reactions','question_reactions','comment_reactions',
  'question_deletion_requests','generation_jobs','generation_candidates','media_assets',
  'private.media_budget','private.ops_capacity_control','question_audit_events'];

export function assertPrivateDirectory(input,ownerRoot=path.resolve(process.env.USERPROFILE||'','Documents/Codex/private-backups/minkiru')) {
  if(!input)throw Error('A private backup directory is required');
  const directory=path.resolve(input),relative=path.relative(ownerRoot,directory);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Use a dated directory inside private-backups/minkiru');
  return directory;
}

export function encodeValue(value,type) {
  if(value===null||value===undefined)return null;
  if(type==='boolean') {
    if(typeof value!=='boolean')throw Error('Expected boolean');
    return value?1:0;
  }
  if(type==='jsonb')return JSON.stringify(value);
  if(['integer','bigint','smallint'].includes(type)&&!Number.isSafeInteger(value))throw Error('Unsafe integer');
  return value;
}

export async function prepareMigration(input,{includeAudits=true}={}) {
  const directory=assertPrivateDirectory(input);
  const schema=JSON.parse(await fs.readFile(path.join(directory,'schema.json'),'utf8'));
  const before=JSON.parse(await fs.readFile(path.join(directory,'source-before.json'),'utf8'));
  if(schema.projectId!==PROJECT_ID)throw Error('Unexpected source project');
  const files=await fs.readdir(directory);
  const tables=[],batches=[],archives=[];
  const selected=includeAudits?order:order.filter(x=>x!=='question_audit_events');
  const localFile=path.join(directory,includeAudits?'verified-minkiru.sqlite':'verified-core.sqlite');
  // An existing verified database is immutable. Reuse it only through its report.
  try {await fs.access(localFile);throw Error('Prepared database exists; choose a new dated preparation directory or use its existing report');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const db=new DatabaseSync(localFile);
  try {
    db.exec(await fs.readFile(path.join(root,'cloudflare/migrations/0001_minkiru.sql'),'utf8'));
    db.exec('BEGIN; PRAGMA defer_foreign_keys=ON;');
    for(const sourceName of selected) {
      const meta=schema.tables.find(t=>(t.table_schema==='public'?t.table_name:'private.'+t.table_name)===sourceName);
      const expected=before.find(t=>t.name===sourceName);
      if(!meta||!expected)throw Error('Missing source metadata');
      const parts=files.filter(f=>f.startsWith(sourceName+'.')&&/^\d{6}\.jsonl$/.test(f.slice(sourceName.length+1))).sort();
      if(!parts.length)throw Error('No export pages for '+sourceName);
      const originalHash=createHash('md5');let rowCount=0;
      const table=sourceName.replace('private.','private_');
      const cols=meta.columns.filter(c=>table!=='question_audit_events'||c.name!=='snapshot');
      const columnNames=cols.map(c=>c.name);
      if(table==='question_audit_events')columnNames.push('archive_key','snapshot_sha256');
      const sql='INSERT INTO '+quote(table)+' ('+columnNames.map(quote).join(',')+') VALUES ('+columnNames.map(()=>'?').join(',')+')';
      const statement=table==='question_audit_events'?null:db.prepare(sql);
      for(const file of parts) {
        const raw=await fs.readFile(path.join(directory,file),'utf8');
        const lines=raw.split(/\r?\n/).filter(x=>x.trim());
        let archive;
        if(table==='question_audit_events') {
          const compressed=gzipSync(Buffer.from(lines.join('\n')+'\n'),{level:6});
          const sha256=digest(compressed),archiveFile='audit-'+sha256+'.jsonl.gz';
          const key='archives/minkiru-migration/2026-09-10/'+archiveFile;
          const destination=path.join(directory,archiveFile);
          try{await fs.writeFile(destination,compressed,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||digest(await fs.readFile(destination))!==sha256)throw e;}
          const parsed=lines.map(JSON.parse),dates=parsed.map(x=>x.created_at).sort();
          archive={file:archiveFile,key,bytes:compressed.length,sha256,rows:lines.length,
            firstId:Math.min(...parsed.map(x=>x.id)),lastId:Math.max(...parsed.map(x=>x.id)),
            firstCreatedAt:dates[0],lastCreatedAt:dates.at(-1),
            questionIds:[...new Set(parsed.map(x=>x.question_id).filter(Boolean))].sort()};
          const insert={sql:'INSERT INTO audit_archives(object_key,sha256,size_bytes,row_count,first_id,last_id,first_created_at,last_created_at,question_ids) VALUES (?,?,?,?,?,?,?,?,?)',
            params:[key,sha256,compressed.length,lines.length,archive.firstId,archive.lastId,archive.firstCreatedAt,archive.lastCreatedAt,JSON.stringify(archive.questionIds)]};
          db.prepare(insert.sql).run(...insert.params);
          batches.push({table:'audit_archives',statements:[insert]});
          archives.push(archive);
        }
        let current=[];
        for(const line of lines) {
          originalHash.update(digest(line,'md5'));
          if(table==='question_audit_events'){rowCount++;continue;}
          const row=JSON.parse(line);
          const params=cols.map(c=>encodeValue(row[c.name],c.type));
          if(table==='question_audit_events')params.push(archive.key,digest(JSON.stringify(row.snapshot)));
          statement.run(...params);rowCount++;
          current.push({sql,params});
          if(current.length>=40){batches.push({table,statements:current});current=[];}
        }
        if(current.length)batches.push({table,statements:current});
      }
      const fingerprint=originalHash.digest('hex');
      if(rowCount!==expected.rows||fingerprint!==expected.content_fingerprint)throw Error('Source byte/count mismatch for '+sourceName);
      tables.push({source:sourceName,target:table==='question_audit_events'?'r2:audit_archives':table,rows:rowCount,sourceFingerprint:fingerprint});
    }
    const identities=(await fs.readFile(path.join(directory,'identities.jsonl'),'utf8')).split(/\r?\n/).filter(x=>x.trim()).map(JSON.parse);
    const seenUsers=new Set(),seenDiscord=new Set();
    for(const id of identities) {
      if(seenUsers.has(id.user_id)||seenDiscord.has(id.discord_user_id)||typeof id.is_admin!=='boolean')throw Error('Identity mapping collision');
      seenUsers.add(id.user_id);seenDiscord.add(id.discord_user_id);
      const statement={sql:'INSERT INTO auth_identities(user_id,discord_user_id,is_admin,disabled) VALUES (?,?,?,?)',params:[id.user_id,id.discord_user_id,id.is_admin?1:0,0]};
      db.prepare(statement.sql).run(...statement.params);batches.push({table:'auth_identities',statements:[statement]});
    }
    const profileCount=db.prepare('SELECT count(*) AS n FROM profiles').get().n;
    if(profileCount!==seenUsers.size)throw Error('Every profile must have exactly one trusted Discord identity');
    const fk=db.prepare('PRAGMA foreign_key_check').all();
    if(fk.length)throw Error('Foreign key verification failed');
    db.exec('COMMIT;');
    const integrity=db.prepare('PRAGMA integrity_check').all();
    if(integrity.length!==1||Object.values(integrity[0])[0]!=='ok')throw Error('SQLite integrity verification failed');
    const remoteDir=path.join(directory,includeAudits?'d1-batches':'core-d1-batches');await fs.mkdir(remoteDir,{recursive:true});
    const manifest=[];
    for(let i=0;i<batches.length;i++) {
      const batch=batches[i],file=String(i).padStart(5,'0')+'.json';
      const body=JSON.stringify(batch.statements),sha256=digest(body);
      await fs.writeFile(path.join(remoteDir,file),body,{flag:'wx'});
      manifest.push({file,table:batch.table,sha256,rows:batch.statements.length,bytes:Buffer.byteLength(body)});
    }
    const report={preparedAt:new Date().toISOString(),sourceProject:PROJECT_ID,targetDatabase:TARGET_DB,
      includeAudits,tables,identityMappings:seenUsers.size,integrity:'ok',foreignKeys:'ok',
      sqliteBytes:(await fs.stat(localFile)).size,batches:manifest,archives,sourceWrites:0,
      containsOldAccessTokens:false,publicCutover:false};
    await fs.writeFile(path.join(directory,includeAudits?'prepared.json':'prepared-core.json'),JSON.stringify(report,null,2),{flag:'wx'});
    return report;
  }finally {db.close();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const report=await prepareMigration(process.argv[2],{includeAudits:!process.argv.includes('--core-only')});
  console.log(JSON.stringify({...report,batches:report.batches.length,archives:report.archives.length,tables:report.tables.map(x=>({table:x.target,rows:x.rows}))}));
}
