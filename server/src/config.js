export function loadConfig(env = process.env) {
  return {
    host: env.HANDMUX_HOST || '0.0.0.0',
    port: Number(env.HANDMUX_PORT) || 4000,
  };
}
