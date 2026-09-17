// Offline preparation only. Applying these payloads requires a separately reviewed
// ID allowlist, a fresh backup and a compare-and-swap against the original row.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {generator} from './naga-generator-runtime.mjs';

export const KAN_REPAIR_FIELDS = Object.freeze([
  'models', 'callOptions', 'callActionOptions', 'callActionProbabilities',
  'callProbabilities', 'callRecommended', 'callRecommendedActions',
  'callPredictionAvailable', 'actualCallProbability', 'actualCallProbabilityRaw',
  'predictionType'
]);
export const KAN_REPAIR_CAS_SQL = 'UPDATE questions SET payload=?,updated_at=? WHERE id=? AND updated_at=? AND payload=? AND deleted_at IS NULL RETURNING id';
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
export const sameJson = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export const payloadHash = payload => createHash('sha256').update(payload).digest('hex');

export function prepareKanRepair(row, report) {
  assert.ok(row?.id && !row.deleted_at && typeof row.payload === 'string', 'Active original row required');
  const before = JSON.parse(row.payload);
  // A saved discard question may share a scene with a kan opportunity. Keep its type.
  if ((before.decisionType || row.decision_type) !== 'call') return {id: row.id, status: 'not-kan'};
  const spec = generator.parseNagaUrl(row.source_url || before.nagaUrl);
  if (before.nagaUrl) {
    const original = generator.parseNagaUrl(before.nagaUrl);
    for (const key of ['reportId', 'tw', 'ts', 'tv']) assert.equal(original[key], spec[key], 'Conflicting payload source: ' + key);
  }
  for (const [column, key] of [['source_report_id', 'reportId'], ['scene_tw', 'tw'], ['scene_ts', 'ts'], ['scene_tv', 'tv']]) {
    assert.equal(row[column], spec[key], 'Conflicting column source: ' + column);
  }
  for (const key of ['tw', 'ts', 'tv']) if (before[key] != null) assert.equal(before[key], spec[key], 'Conflicting payload coordinate: ' + key);
  const action = report.pred?.[spec.ts]?.[spec.tv];
  assert.ok(action?.info?.msg, 'Original source action required');
  const huro = action.huro?.[spec.tw] || [];
  const kan = Number(action.info.msg.actor) === spec.tw && Array.isArray(action.kan) ? action.kan : [];
  const hasKan = kan.length > 0 || huro.some(model => Object.keys(model || {}).some(key => Number(key) >= 5));
  if (!hasKan) {
    assert.notEqual(before.predictionType, 'kan', 'Stored kan has no source prediction');
    return {id: row.id, status: 'not-kan'};
  }
  const candidate = structuredClone(generator.sceneCandidate(report, {...spec, decisionType: 'call'}));
  assert.equal(candidate?.decisionType, 'call', 'Source decision type changed');
  assert.ok(generator.validateDiscardHand(candidate).valid, 'Source hand invalid');
  for (const key of ['handBeforeDraw', 'draw', 'melds', 'doraMarker', 'callTile', 'actualCall', 'actualCallCode', 'actualCallType', 'actualDecision']) {
    assert.ok(sameJson(before[key], candidate[key]), 'Protected scene differs: ' + key);
  }
  if (before.actualCallAction != null) assert.equal(before.actualCallAction, candidate.actualCallAction, 'Historical action differs');
  assert.ok(sameJson(before.models?.map(model => model.name), candidate.models.map(model => model.name)), 'Model order differs');

  // Independent raw-source check: separate kan rows use 1 = ankan, 2 = kakan;
  // daiminkan is code 5 in the ordinary call rows. Never add it to pon/chi.
  for (let i = 0; i < candidate.models.length; i++) {
    const h = huro[i] || {}, k = kan[i] || {};
    const raw = {
      pass: Number(h[0] || 0) + Number(k[0] || 0),
      call: [1, 2, 3, 4].reduce((n, code) => n + Number(h[code] || 0), 0),
      kan: Object.keys(h).filter(code => Number(code) >= 5).reduce((n, code) => n + Number(h[code] || 0), 0) + Number(k[1] || 0) + Number(k[2] || 0)
    };
    for (const [name, value] of Object.entries(raw)) {
      assert.ok(Number.isFinite(value) && value >= 0 && value <= 10000, 'Invalid source probability');
      assert.equal(candidate.callActionProbabilities[name][i] || 0, value / 100, 'Raw source probability differs');
    }
    assert.ok(Object.values(raw).reduce((a, b) => a + b, 0) <= 10002, 'Source probability total invalid');
    const best = candidate.callActionOptions.reduce((a, b) => raw[b.action] > raw[a.action] ? b : a).action;
    assert.equal(candidate.callRecommendedActions[i], best, 'Source recommendation differs');
  }

  const after = structuredClone(before);
  for (const field of KAN_REPAIR_FIELDS) after[field] = structuredClone(candidate[field]);
  // Keep any unrelated per-model annotations from the saved question.
  after.models = before.models.map((model, i) => ({...model, ...candidate.models[i]}));
  after.callOptions = candidate.callOptions.map(option => ({...before.callOptions?.find(old => old.code === option.code), ...option}));
  after.callActionOptions = candidate.callActionOptions.map(option => ({...before.callActionOptions?.find(old => old.action === option.action), ...option}));
  after.callProbabilities = {...before.callProbabilities, ...candidate.callProbabilities};
  if (Array.isArray(before.callProbabilities?.kan)) after.callProbabilities.kan = [...candidate.callActionProbabilities.kan];
  const changedFields = KAN_REPAIR_FIELDS.filter(field => !sameJson(before[field], after[field]));
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!KAN_REPAIR_FIELDS.includes(field)) assert.ok(sameJson(before[field], after[field]), 'Protected field changed: ' + field);
  }
  const payload = JSON.stringify(after);
  return {
    id: row.id, status: changedFields.length ? 'repair' : 'correct', changedFields,
    kind: kan.length ? (kan.some(model => Object.hasOwn(model, '2')) ? 'kakan' : 'ankan') : 'daiminkan',
    source: {reportId: spec.reportId, tw: spec.tw, ts: spec.ts, tv: spec.tv},
    beforeHash: payloadHash(row.payload), afterHash: payloadHash(payload), payload,
    kanRates: candidate.callActionProbabilities.kan, recommendedActions: candidate.callRecommendedActions
  };
}
