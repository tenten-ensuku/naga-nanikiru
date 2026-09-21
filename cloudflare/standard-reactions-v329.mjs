import {ApiError, requireActor} from './access.mjs';

export const STANDARD_REACTION_KEYS = Object.freeze([
  'like','agree','difficult','good_question','important','hmm','strategy','mistake',
  'big_difference','small_difference','memo','theory','basic_order','call','riichi',
  'pass','silent','kan','exclaim','question','ari','preference','humu_humu','understood',
  'basic_lesson','fold','push','okonomiyaki',
]);
const baseKeys=new Set(STANDARD_REACTION_KEYS);
const addedKey=/^standard_[0-9a-f]{32}$/;
const fail=code=>{throw new ApiError(code,400);};
const text=(value,max)=>typeof value==='string' && Array.from(value.trim()).length<=max;

export async function getStandardReactions({db,actor}) {
  requireActor(actor);
  const row=await db.prepare('SELECT revision,rows_json FROM standard_reaction_catalog WHERE singleton=1').first();
  if(!row)throw new ApiError('standard_reactions_unavailable',503);
  return {revision:row.revision,rows:JSON.parse(row.rows_json)};
}

export async function saveStandardReactions(args,{db,actor}) {
  requireActor(actor);
  if(actor.is_admin!==true)throw new ApiError('app_admin_required',403);
  if(!Number.isSafeInteger(args.p_revision)||args.p_revision<0)fail('standard_reactions_invalid');
  const rows=args.p_rows;
  if(!Array.isArray(rows)||rows.length<STANDARD_REACTION_KEYS.length||rows.length>128)fail('standard_reactions_invalid');
  const seen=new Set();
  const normalized=rows.map(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.key!=='string'||(!baseKeys.has(row.key)&&!addedKey.test(row.key))||seen.has(row.key))fail('standard_reactions_invalid');
    seen.add(row.key);
    if(!text(row.label,24)||!text(row.icon,16)||(!row.label.trim()&&!row.icon.trim())||typeof row.hidden!=='boolean')fail('standard_reactions_invalid');
    if(!['gold','teal','blue','purple','red'].includes(row.tone)||!['emoji','riichi-stick'].includes(row.iconType)||(row.iconType==='riichi-stick'&&row.key!=='riichi'))fail('standard_reactions_invalid');
    return {key:row.key,label:row.label.trim(),icon:row.icon.trim(),iconType:row.iconType,tone:row.tone,hidden:row.hidden};
  });
  if(STANDARD_REACTION_KEYS.some(key=>!seen.has(key))||!normalized.some(row=>!row.hidden))fail('standard_reactions_invalid');
  const current=await getStandardReactions({db,actor});
  if(current.revision!==args.p_revision)throw new ApiError('standard_reactions_conflict',409);
  // A hidden entry still resolves in existing comments, history, and counts.
  if(current.rows.some(row=>!seen.has(row.key)))fail('standard_reactions_keep_history');
  const updated=await db.prepare(`UPDATE standard_reaction_catalog
    SET rows_json=?,revision=revision+1,updated_at=?,updated_by=?
    WHERE singleton=1 AND revision=? RETURNING revision,rows_json`)
    .bind(JSON.stringify(normalized),new Date().toISOString(),actor.id,args.p_revision).first();
  if(!updated)throw new ApiError('standard_reactions_conflict',409);
  return {revision:updated.revision,rows:JSON.parse(updated.rows_json)};
}

export async function isAddedStandardReaction(db,key) {
  if(!addedKey.test(key))return false;
  return !!await db.prepare(`SELECT 1 FROM standard_reaction_catalog c,json_each(c.rows_json) item
    WHERE c.singleton=1 AND json_extract(item.value,'$.key')=? LIMIT 1`).bind(key).first();
}
