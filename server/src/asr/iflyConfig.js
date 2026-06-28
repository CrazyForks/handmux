// server/src/asr/iflyConfig.js
// Read iFlytek IAT credentials lazily from env (default process.env) so it's injectable in tests.
// app_id is a public identifier (safe to hand the browser); apiKey/apiSecret never leave the server.
export function asrConfig(env = process.env) {
  return { appId: env.XFYUN_APPID || '', apiKey: env.XFYUN_APIKEY || '', apiSecret: env.XFYUN_APISECRET || '' };
}
export function isAsrConfigured(env = process.env) {
  const c = asrConfig(env);
  return !!(c.appId && c.apiKey && c.apiSecret);
}
