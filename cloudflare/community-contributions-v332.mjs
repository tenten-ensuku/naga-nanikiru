// The official community book, identified independently of its editable title.
// allow_contributions defaults to true on other books too; that flag alone must
// never grant every user access to their contents or permission to add questions.
export const COMMUNITY_COLLECTION_ID = 'cc8bcfea-67a9-41b9-a03e-90d4a6d1847e';

// Used by both the write authorization and catalog capabilities (collection c).
// When the original book becomes volume 1, follow its parent so new volumes keep
// the same policy. Closing/archiving the community book disables public additions.
export const COMMUNITY_CONTRIBUTION_SQL = `(
  c.allow_contributions = 1 AND c.visibility = 'public' AND c.published_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM collections community
    JOIN collections community_root ON community_root.id = COALESCE(community.series_parent_id, community.id)
    WHERE community.id = '${COMMUNITY_COLLECTION_ID}'
      AND community.archived_at IS NULL AND community_root.archived_at IS NULL
      AND community.allow_contributions = 1 AND community_root.allow_contributions = 1
      AND community.visibility = 'public' AND community.published_at IS NOT NULL
      AND community_root.visibility = 'public' AND community_root.published_at IS NOT NULL
      AND (c.id = community_root.id OR c.series_parent_id = community_root.id)
  )
)`;
