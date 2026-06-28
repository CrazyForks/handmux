import crypto from 'node:crypto';

export function loadToken(env = process.env) {
  let token = env.HANDMUX_TOKEN;
  if (!token) {
    token = crypto.randomBytes(24).toString('base64url');
    console.log(`[handmux] no HANDMUX_TOKEN set; generated token: ${token}`);
  }
  return token;
}

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

export function tokenEquals(a, b) {
  return crypto.timingSafeEqual(sha(a), sha(b));
}

export function bearerFrom(header) {
  if (!header) return null;
  const m = /^Bearer (.+)$/.exec(header);
  return m ? m[1] : null;
}

export function expressAuth(token) {
  return (req, res, next) => {
    const provided = bearerFrom(req.get('authorization'));
    if (provided && tokenEquals(provided, token)) return next();
    res.status(401).json({ error: 'unauthorized' });
  };
}
