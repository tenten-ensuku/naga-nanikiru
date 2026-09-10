import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {recoveryPublication} from '../scripts/prepare-recovery-preview.mjs';
const source=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
test('normal V230 publication stays restored and never creates a duplicate page',()=>{
  for(const setting of ['','false']) assert.deepEqual(recoveryPublication(source,setting),{main:source,preview:null});
});
test('canary keeps the ordinary page stopped but uses the identical authenticated application',()=>{
  const result=recoveryPublication(source,'true');
  assert.equal(result.preview,source);
  assert.equal(result.main.replace('window.NAGA_MAINTENANCE_MODE = true;','window.NAGA_MAINTENANCE_MODE = false;'),source);
  assert.match(result.preview,/function requireLoginForPlayV187/);
  assert.match(result.preview,/<main class="page" inert aria-hidden="true">/);
});
test('canary rejects an unexpected flag or source version',()=>{
  assert.throws(()=>recoveryPublication(source,'1'));
  assert.throws(()=>recoveryPublication(source.replace('const APP_VERSION = 233;','const APP_VERSION = 229;'),'true'));
  assert.throws(()=>recoveryPublication(source.replace('window.NAGA_MAINTENANCE_MODE = false;','window.NAGA_MAINTENANCE_MODE = true;'),'true'));
});
