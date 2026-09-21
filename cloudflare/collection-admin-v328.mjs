import {ApiError, requireActor} from './access.mjs';

// Read one selected book. The administrator flag comes only from the session.
export async function collectionAdminInfo(args, {db, actor}) {
  requireActor(actor);
  if (actor.is_admin !== true) throw new ApiError('app_admin_required', 403);
  const slug = args.p_share_slug;
  if (typeof slug !== 'string' || !slug || slug.length > 128) throw new ApiError('invalid_collection_input');
  const book = await db.prepare(`SELECT c.id,c.share_slug,c.title,c.visibility,c.published_at,
    p.display_name AS owner_name,a.disabled AS owner_disabled,w.name AS workspace_name
    FROM collections c LEFT JOIN profiles p ON p.id=c.owner_id
    LEFT JOIN auth_identities a ON a.user_id=c.owner_id
    LEFT JOIN workspaces w ON w.id=c.workspace_id
    WHERE c.share_slug=? AND c.archived_at IS NULL`).bind(slug).first();
  if (!book) throw new ApiError('collection_not_found', 404);
  const people = (await db.prepare(`SELECT m.user_id AS user_id,p.display_name AS display_name,a.disabled AS disabled,'manager' AS role
    FROM collection_managers m JOIN profiles p ON p.id=m.user_id
    LEFT JOIN auth_identities a ON a.user_id=m.user_id
    WHERE m.collection_id=? AND m.status='active'
      AND m.user_id<>(SELECT owner_id FROM collections WHERE id=?)
    UNION ALL
    SELECT m.user_id,p.display_name,a.disabled,'editor' AS role
    FROM collection_members m JOIN profiles p ON p.id=m.user_id
    LEFT JOIN auth_identities a ON a.user_id=m.user_id
    WHERE m.collection_id=? AND m.status='active' AND m.role='editor'
      AND m.user_id<>(SELECT owner_id FROM collections WHERE id=?)
      AND NOT EXISTS(SELECT 1 FROM collection_managers cm WHERE cm.collection_id=m.collection_id AND cm.user_id=m.user_id AND cm.status='active')
    ORDER BY display_name,user_id`).bind(book.id,book.id,book.id,book.id).all()).results || [];
  const names = role => people.filter(person=>person.role===role).map(person=>({display_name:person.display_name || '表示名未登録',disabled:person.disabled===1}));
  return {share_slug:book.share_slug,title:book.title,visibility:book.visibility,published:!!book.published_at,
    workspace_name:book.workspace_name || '',owner:{display_name:book.owner_name || '表示名未登録',disabled:book.owner_disabled===1},
    managers:names('manager'),editors:names('editor')};
}
