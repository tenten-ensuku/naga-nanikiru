import {ApiError, requireActor} from './access.mjs';

export const DISPLAY_READ_RPCS = new Set(['get_display_preferences']);
export const DISPLAY_WRITE_RPCS = new Set(['save_display_preferences']);

export async function displayPreferencesRpc(name, args, {db, actor}) {
  requireActor(actor);
  if (name === 'save_display_preferences') {
    if (typeof args.p_dora_sheen !== 'boolean') throw new ApiError('invalid_display_preferences');
    await db.prepare(`INSERT INTO display_preferences(user_id,dora_sheen) VALUES (?,?)
      ON CONFLICT(user_id) DO UPDATE SET dora_sheen=excluded.dora_sheen`)
      .bind(actor.id, Number(args.p_dora_sheen)).run();
  } else if (name !== 'get_display_preferences') throw new ApiError('unknown_rpc',404);
  const row = await db.prepare('SELECT dora_sheen FROM display_preferences WHERE user_id=?').bind(actor.id).first();
  return {dora_sheen: row ? Boolean(row.dora_sheen) : true};
}
