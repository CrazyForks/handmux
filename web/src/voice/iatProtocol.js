// iFlytek IAT v2 protocol: outgoing frame builders + incoming wpgs result accumulator. Pure — no WS,
// no audio. The transcript is a Map<sn, sentenceText>; rpl deletes an sn range before setting, apd
// just sets. textOf() joins sentences in sn order. See https://www.xfyun.cn/doc/asr/voicedictation/API.html

const BUSINESS = { language: 'zh_cn', domain: 'iat', accent: 'mandarin', vad_eos: 10000, dwa: 'wpgs', ptt: 1, nunum: 1 };
const FORMAT = 'audio/L16;rate=16000';

export function buildFirstFrame(appId, audioB64) {
  return { common: { app_id: appId }, business: { ...BUSINESS }, data: { status: 0, format: FORMAT, encoding: 'raw', audio: audioB64 } };
}
export function buildAudioFrame(audioB64) {
  return { data: { status: 1, format: FORMAT, encoding: 'raw', audio: audioB64 } };
}
export function buildEndFrame() {
  return { data: { status: 2, format: FORMAT, encoding: 'raw', audio: '' } };
}

export function emptyTranscript() {
  return { sentences: new Map() };
}
export function accumulate(state, msg) {
  const r = msg?.data?.result;
  if (!r || !Array.isArray(r.ws)) return state;
  const text = r.ws.map((w) => (w.cw || []).map((c) => c.w).join('')).join('');
  const next = new Map(state.sentences);
  if (r.pgs === 'rpl' && Array.isArray(r.rg)) {
    for (let i = r.rg[0]; i <= r.rg[1]; i++) next.delete(i);
  }
  next.set(r.sn, text);
  return { sentences: next };
}
export function textOf(state) {
  return [...state.sentences.keys()].sort((a, b) => a - b).map((k) => state.sentences.get(k)).join('');
}
