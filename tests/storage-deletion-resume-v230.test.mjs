import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReviewed402Resume } from '../scripts/storage-deletion-resume-v230.mjs';

const approvalDigest = '25cfd3fe9b9dfcaffa1f21519c1e7b761fdebddba3ee8aa4c61630479a28ed90';
const name = '53d3ce97-8eb2-47b7-8c58-c43f378ba806/pierre-thread-1462387846152196142/comments/1-1.png';
const journal = [
  {stage:'request',names:[name],at:'2026-09-06T17:31:21.034Z',approvalDigest},
  {stage:'failed',status:402,names:[name],message:'Service for this project is restricted due to the following violations: exceed_egress_quota, exceed_storage_size_quota. The project owner must upgrade their plan or remove spend caps to restore service.',at:'2026-09-06T17:31:21.716Z',approvalDigest},
].map(row => JSON.stringify(row)).join('\n') + '\n';
const options = {requested:true,checkedAt:'2026-09-07T07:00:39.087609Z',approvalDigest};

test('initial run without a journal remains possible', () => assert.equal(validateReviewed402Resume('', {...options,requested:false}), null));
test('only the exact reviewed failed attempt can resume explicitly after reconciliation', () => {
  assert.equal(validateReviewed402Resume(journal, options).previousFailureAt, '2026-09-06T17:31:21.716Z');
});
test('the default rerun guard remains enabled', () => assert.throws(() => validateReviewed402Resume(journal, {...options,requested:false})));
test('resume requires the retained original journal', () => assert.throws(() => validateReviewed402Resume('', options)));
test('modified targets cannot resume', () => assert.throws(() => validateReviewed402Resume(journal.replaceAll(name,'different.png'), options)));
test('a success or uncertain deletion cannot resume', () => {
  for (const stage of ['deleted','uncertain']) assert.throws(() => validateReviewed402Resume(journal.replace('"stage":"failed"', '"stage":"'+stage+'"'), options));
});
test('additional attempts cannot be silently repeated', () => assert.throws(() => validateReviewed402Resume(journal + '{}\n', options)));
test('wrong approval digest is rejected', () => assert.throws(() => validateReviewed402Resume(journal, {...options,approvalDigest:'other'})));
test('stale or invalid reconciliation cannot authorize a resume', () => {
  for (const checkedAt of ['2026-09-06T17:29:00Z','invalid']) assert.throws(() => validateReviewed402Resume(journal, {...options,checkedAt}));
});
