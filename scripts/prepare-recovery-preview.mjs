// Build-time canary on the already-approved OAuth origin. Never bypasses authentication.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function recoveryPublication(html, setting='') {
  if (!['','false','true'].includes(setting)) throw new Error('Invalid RECOVERY_PREVIEW_ONLY');
  if (!/const APP_VERSION = (230|231|232|233|234|235);/.test(html) || (html.match(/window\.NAGA_MAINTENANCE_MODE = false;/g)||[]).length!==1) {
    throw new Error('Expected the reviewed V230-V235 source');
  }
  return setting==='true'
    ? {main:html.replace('window.NAGA_MAINTENANCE_MODE = false;','window.NAGA_MAINTENANCE_MODE = true;'),preview:html}
    : {main:html,preview:null};
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const publicDirectory=new URL('../public/',import.meta.url);
  const file=new URL('index.html',publicDirectory);
  const {main,preview}=recoveryPublication(await fs.readFile(file,'utf8'),process.env.RECOVERY_PREVIEW_ONLY||'');
  if (preview) {
    await fs.writeFile(new URL('recovery-check-v230.html',publicDirectory),preview);
    await fs.writeFile(file,main);
  }
  console.log(preview?'V230 canary prepared; ordinary URL retains maintenance':'V230 ordinary publication; no canary generated');
}
