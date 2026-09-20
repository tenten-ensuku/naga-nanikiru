// Build-time canary on the already-approved OAuth origin. Never bypasses authentication.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function recoveryPublication(html, setting='') {
  if (!['','false','true'].includes(setting)) throw new Error('Invalid RECOVERY_PREVIEW_ONLY');
  if (!/const APP_VERSION = (230|231|232|233|234|235|236|237|238|239|240|241|242|243|244|245|246|247|248|249|250|251|252|253|254|255|256|257|258|259|260|261|262|263|264|265|266|267|268|269|270|271|272|273|274|275|276|277|278|279|280|281|282|283|284|285|286|287|288|289|290|291|292|293|294|295|296|297|298|299|300|301|302|303|304|305|306|307|308|309|310);/.test(html) || (html.match(/window\.NAGA_MAINTENANCE_MODE = false;/g)||[]).length!==1) {
    throw new Error('Expected the reviewed V230-V310 source');
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
