// Auto-repeat for held keys: fire once immediately, then (after a short delay so a quick
// tap stays a single press) repeat at a fixed interval until stop(). DOM-free for testing.
export function createRepeater(fn, { delay = 400, interval = 120 } = {}) {
  let to = null;
  let iv = null;
  const stop = () => {
    if (to) clearTimeout(to);
    if (iv) clearInterval(iv);
    to = null;
    iv = null;
  };
  const start = () => {
    stop();
    fn();
    to = setTimeout(() => { iv = setInterval(fn, interval); }, delay);
  };
  return { start, stop };
}
