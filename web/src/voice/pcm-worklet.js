// web/src/voice/pcm-worklet.js
// Minimal AudioWorklet: forward each render quantum's mono samples to the main thread, which does the
// (unit-tested) downsample/frame/encode. Kept trivial on purpose — worklet code can't be unit-tested.
class PcmForwarder extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0)); // copy: the buffer is reused after process()
    return true;
  }
}
registerProcessor('pcm-forwarder', PcmForwarder);
