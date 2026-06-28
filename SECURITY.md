# Security Policy

handmux exposes a **real, writable tmux session** — and optionally a public tunnel to it — so its
security matters. Thanks for helping keep it safe.

## Reporting a vulnerability

**Please report security issues privately. Do not open a public issue or PR.**

Use GitHub's private vulnerability reporting:
[**Report a vulnerability**](https://github.com/yuanyuanzijin/handmux/security/advisories/new).

Include a description, reproduction steps, and the impact. We'll acknowledge within a few days and keep
you posted on a fix. Please give us reasonable time to release a fix before any public disclosure.

When you write up a report, **redact your access token, tunnel URL, and any VAPID/iFlytek keys.**

## Supported versions

handmux is pre-1.0; only the latest released version receives security fixes.

## Security model (what to expect)

- **The access token is the only thing protecting your session.** Every request requires it. The QR
  code carries the token (scan it to sign in one-tap); the printed plain link is token-free and safe to
  share. Treat the token — and the token-bearing QR — like a password. If you don't pass `--token`, one
  is generated and printed on start.
- **Secrets stay on the server.** VAPID and iFlytek keys live only in your config file (written `0600`);
  the phone receives only short-lived signed URLs, never the keys.
- **Tunnels expose the URL, not extra trust.** A tunnel makes the URL reachable from anywhere; the token
  still gates everything. Rotate the token (restart with a new `--token`) if the token (or the QR that
  carries it) leaks.
- **The git viewer is read-only** and never writes to your working tree.

## Out of scope

- Attacks that require already knowing the access token (the token *is* the auth boundary).
- Running handmux bound to a public interface **without** a tunnel/proxy and **without** a token — that's
  a misconfiguration, not a vulnerability.
- Third-party tunnel providers (Cloudflare) and their infrastructure.
