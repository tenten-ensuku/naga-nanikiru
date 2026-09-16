import {ApiError} from './access.mjs';
import {normalizeAssetPath} from '../client/media-assets.mjs';
import {isRetiredLocalImage} from './retired-local-images-v265.mjs';

const uuidPath=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/.+/i;
const buckets=['naga-question-assets','question-assets'];

// The browser can canonicalize encoded legacy-media and private URLs before
// displaying them. The V260 SQL triggers already cover literal references;
// these bounded exact-key probes also cover those readable URL aliases.
// No payload, comment, historical record, or stored URL is rewritten here.
export function readableQuestionImageKeys(value){
  const keys=new Set(),stack=[value];let nodes=0;
  const add=(bucket,rawPath)=>{
    let decoded=rawPath;
    for(let round=0;round<8;round++){
      const next=normalizeAssetPath(decoded);
      if(!next)return;
      if(next===decoded)break;
      decoded=next;
    }
    if(decoded.includes('%')||decoded.length>1024||!uuidPath.test(decoded))return;
    for(const kind of bucket?[bucket]:buckets)keys.add(kind+'/'+decoded);
    if(keys.size>64)throw new ApiError('question_media_invalid',422);
  };
  const paths=(bucket,rawPath)=>{
    for(let round=0;round<8;round++){const next=normalizeAssetPath(rawPath);if(!next)return;if(next===rawPath)break;rawPath=next;}
    add(bucket,rawPath);
    // Text comments can contain a URL followed by Markdown/prose punctuation.
    // Preserve the full path too, because punctuation can be part of a key.
    let trimmed=rawPath;
    while(/[\])},;!.'、。！？」』）】〉》:]$/.test(trimmed)){trimmed=trimmed.slice(0,-1);add(bucket,trimmed);}
  };
  while(stack.length){
    if(++nodes>50000)throw new ApiError('question_media_invalid',422);
    const item=stack.pop();
    if(typeof item==='string'){
      if(/^data:/i.test(item))continue;
      if(isRetiredLocalImage(item))throw new ApiError('question_image_retired',409);
      const linkText=item.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
      for(const match of linkText.matchAll(/https?:\/\/[^\s<>"`]+/g)){
        if(isRetiredLocalImage(match[0])||isRetiredLocalImage(match[0].replace(/[.,!?;:、。！？」』）】〉》)]+$/g,'')))throw new ApiError('question_image_retired',409);
        let url;try{url=new URL(match[0]);}catch{continue;}
        const route=url.pathname.match(/\/(?:v1\/(?:public|private)|storage\/v1\/object\/(?:public|sign))\/(naga-question-assets|question-assets)\/(.+)$/);
        if(route)paths(route[1],route[2]);
      }
      const direct=item.match(/^(?:(naga-question-assets|question-assets)\/)?([^\s?#]+)$/);
      if(direct)paths(direct[1],direct[2]);
    }else if(item&&typeof item==='object')stack.push(...Object.values(item));
  }
  return [...keys].sort();
}

export function retiredImageCondition(value){
  const keys=readableQuestionImageKeys(value);
  if(!keys.length)return {sql:'1',params:[],keys};
  // This condition belongs to the INSERT/UPDATE itself, never a preceding
  // SELECT: a retirement committed after request parsing must still refuse it.
  // json_each expands only the <=64 submitted keys; every ledger lookup is PK.
  return {sql:'NOT EXISTS (SELECT 1 FROM json_each(?) AS submitted JOIN private_retired_question_images AS retired ON retired.object_key=submitted.value)',params:[JSON.stringify(keys)],keys};
}
