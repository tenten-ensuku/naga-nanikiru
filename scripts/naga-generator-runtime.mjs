// Node/Bot adapter: execute the exact browser generator, never a second replay.
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const context={URL,URLSearchParams};
vm.runInNewContext(await readFile(new URL('../public/naga-generator-v44.js',import.meta.url),'utf8'),context);
export const generator=context.NagaGeneratorV44;
export const GENERATION_RULE_VERSION='meld-replay-v237';
export function verifiedSceneCandidate(report,rawUrl,options={}){
  const spec=generator.parseNagaUrl(rawUrl);
  const candidate=generator.sceneCandidate(report,{...spec,...options});
  if(!candidate)throw Error('NAGA scene has no supported decision');
  const validation=generator.validateDiscardHand(candidate);
  if(!validation.valid)throw Error('NAGA hand needs review: '+validation.errors.join(','));
  return structuredClone(candidate);
}
