import {createHash} from 'node:crypto';
import {boardState} from './naga-board-runtime.mjs';
import {validateStoredHand} from '../cloudflare/question-validation-v237.mjs';

export const screenshotFields = Object.freeze(['image','images','imageOff','imageOpen','_imageData','_captureError','_captureState','imageSource','imageSourceRuleVersion','handMaskMode']);
const changedFields = new Set([...screenshotFields,'boardScene','needsScreenshot','sourceReportId','tw','ts','tv','nagaUrl']);
export const payloadHash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

// The caller supplies an independently audited effective payload only for an
// existing browser correction or a correction proven by the original source.
// Fresh generator candidates must never replace comments, IDs or scoring data.
export function prepareJsonQuestion(row, scene, effectivePayload = JSON.parse(row.payload)) {
  const original = JSON.parse(row.payload);
  for (const field of ['id','number','title','comments']) {
    if (JSON.stringify(effectivePayload[field]) !== JSON.stringify(original[field])) throw Error('Protected effective field: '+field);
  }
  if (!scene?.source?.reportId || !boardState.validate(scene,effectivePayload).valid) throw Error('Audited source/hand mismatch');
  const {reportId,tw,ts,tv} = scene.source;
  const nagaUrl = 'https://naga.dmv.nico/htmls/report_viewer.html?'+new URLSearchParams({report_id:reportId,tw,ts,tv});
  const payload = {...effectivePayload,sourceReportId:reportId,tw,ts,tv,nagaUrl,boardScene:scene,needsScreenshot:false};
  for (const key of screenshotFields) if (key in payload) delete payload[key];
  payload.image=null; payload.images=null; payload.imageOff=null; payload.imageOpen=null;
  for (const key of Object.keys(effectivePayload)) {
    if (!changedFields.has(key) && JSON.stringify(payload[key])!==JSON.stringify(effectivePayload[key])) throw Error('Protected payload field: '+key);
  }
  const decisionType=payload.decisionType || row.decision_type;
  validateStoredHand(payload,decisionType);
  const afterPayload=JSON.stringify(payload);
  return {id:row.id,collectionId:row.collection_id,number:original.number,beforeHash:payloadHash(row.payload),afterHash:payloadHash(afterPayload),beforeUpdatedAt:row.updated_at,payload:afterPayload,sourceReportId:reportId,sourceUrl:nagaUrl,tw,ts,tv,decisionType,
    changedFields:[...new Set([...Object.keys(original),...Object.keys(payload)])].filter(key=>JSON.stringify(original[key])!==JSON.stringify(payload[key]))};
}

export function assertDistinctSources(prepared) {
  const seen=new Map();
  for (const row of prepared) {
    const key=JSON.stringify([row.collectionId,row.sourceReportId,row.tw,row.ts,row.tv]);
    if (seen.has(key)) throw Error('Duplicate canonical source: '+seen.get(key)+' / '+row.id);
    seen.set(key,row.id);
  }
}
