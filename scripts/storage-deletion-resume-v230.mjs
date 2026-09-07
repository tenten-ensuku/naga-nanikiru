import { createHash } from 'node:crypto';

const REVIEWED_JOURNAL_SHA256 = '0f2b6b67b30de0b82cf45b6edbf497876ed515f9203fdef0d9e2b23881829236';

// This authorizes only the one inspected 402/zero-deletion attempt, never a generic retry.
export function validateReviewed402Resume(journal, { requested, checkedAt, approvalDigest }) {
  if (!journal.trim()) {
    if (requested) throw new Error('The reviewed prior 402 journal is required');
    return null;
  }
  if (!requested) throw new Error('Prior deletion attempt exists. Reconcile remote state and explicitly review before retrying.');
  const digest = createHash('sha256').update(journal).digest('hex');
  if (digest !== REVIEWED_JOURNAL_SHA256) throw new Error('Prior journal differs from the explicitly reviewed 402 attempt');
  const entries = journal.trim().split(/\r?\n/).map(line => JSON.parse(line));
  const [request, failure] = entries;
  if (entries.length !== 2 || request.stage !== 'request' || failure.stage !== 'failed' || failure.status !== 402 ||
      entries.some(entry => entry.approvalDigest !== approvalDigest) || request.names.length !== 1 ||
      JSON.stringify(request.names) !== JSON.stringify(failure.names) ||
      !Number.isFinite(Date.parse(checkedAt)) || Date.parse(checkedAt) <= Date.parse(failure.at)) {
    throw new Error('A fresh unchanged-source reconciliation after the exact failed attempt is required');
  }
  return { previousJournalSha256: digest, previousFailureAt: failure.at, sourceRecheckedAt: checkedAt };
}
