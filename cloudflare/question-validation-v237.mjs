import '../public/naga-generator-v44.js';
import '../public/naga-board-state-v248.js';
import {ApiError} from './access.mjs';
const generator=globalThis.NagaGeneratorV44;
// The same pure hand validator as the browser. No external read per insert.
export function validateStoredHand(payload,decision){
  const result=generator.validateDiscardHand({...payload,decisionType:decision});
  if(!result.valid)throw new ApiError('question_hand_invalid',422);
  if(payload.boardScene && !globalThis.NagaBoardStateV248.validate(payload.boardScene,payload).valid)throw new ApiError('question_board_invalid',422);
  return result;
}
