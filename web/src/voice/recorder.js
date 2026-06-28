// web/src/voice/recorder.js
import { toPcm16k, createFramer, bytesToBase64 } from './resample.js';
import workletUrl from './pcm-worklet.js?url'; // Vite resolves this to a hashed asset URL

// Capture the mic and emit base64 1280-byte (40ms) PCM frames via onChunk(base64). Dependencies are
// injectable so this stays testable-by-substitution; defaults use the real browser APIs.
export function createRecorder({
  getUserMedia = (c) => navigator.mediaDevices.getUserMedia(c),
  AudioCtor = window.AudioContext || window.webkitAudioContext,
} = {}) {
  let ctx = null, stream = null, node = null, src = null;
  const framer = createFramer(1280);

  async function start(onChunk) {
    stream = await getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    ctx = new AudioCtor();
    await ctx.resume(); // iOS: must resume inside the user-gesture that called start()
    await ctx.audioWorklet.addModule(workletUrl);
    src = ctx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(ctx, 'pcm-forwarder');
    node.port.onmessage = (e) => {
      const bytes = toPcm16k(e.data, ctx.sampleRate);
      for (const frame of framer.push(bytes)) onChunk(bytesToBase64(frame));
    };
    src.connect(node);
    node.connect(ctx.destination); // required for the graph to pull audio; worklet emits no output
  }

  async function stop() {
    try { node && (node.port.onmessage = null); } catch {}
    try { src && src.disconnect(); node && node.disconnect(); } catch {}
    try { stream && stream.getTracks().forEach((t) => t.stop()); } catch {}
    try { ctx && (await ctx.close()); } catch {}
    const tail = framer.flush();
    ctx = stream = node = src = null;
    return tail ? bytesToBase64(tail) : null; // caller appends to the final frame before status=2
  }

  return { start, stop };
}
