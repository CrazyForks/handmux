import { useRef, useState, useCallback, useEffect } from 'react';
import { signAsr as realSignAsr } from '../api.js';
import { createRecorder } from './recorder.js';
import { buildFirstFrame, buildAudioFrame, buildEndFrame, emptyTranscript, accumulate, textOf } from './iatProtocol.js';

const MAX_MS = 55000; // IAT caps a session at 60s; self-finalize at 55s and prompt to press again.
const FINALIZE_MS = 4000; // after the end frame, wait this long for the server's final; else salvage + reset.

// Push-to-talk orchestration: signAsr → open ws → stream mic frames → accumulate wpgs → on stop send
// the end frame and, when the server returns its final (data.status===2), hand the text to onText().
// Guards read a stateRef (live phase) rather than the captured `state`, so the 55s cap timer and any
// long-lived closure act on the real current phase instead of the phase baked in at press time.
// Deps are injectable for tests; production uses the real signAsr/WebSocket/recorder.
export function usePushToTalk({ onText, deps = {} }) {
  const signAsr = deps.signAsr || realSignAsr;
  const WebSocketCtor = deps.WebSocketCtor || window.WebSocket;
  const makeRecorder = deps.makeRecorder || (() => createRecorder());

  const [state, setState] = useState('idle'); // idle|requesting|recording|finalizing|error
  const [partial, setPartial] = useState('');
  const stateRef = useRef('idle');
  const setPhase = useCallback((s) => { stateRef.current = s; setState(s); }, []);

  const wsRef = useRef(null);
  const recRef = useRef(null);
  const transRef = useRef(emptyTranscript());
  const appIdRef = useRef('');
  const firstSentRef = useRef(false);
  const capTimer = useRef(null);
  const finalizeTimer = useRef(null);
  const stopRef = useRef(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText; // always call the latest onText

  const cleanup = useCallback(() => {
    clearTimeout(capTimer.current);
    clearTimeout(finalizeTimer.current);
    try { wsRef.current && wsRef.current.close(); } catch {}
    wsRef.current = null; recRef.current = null; firstSentRef.current = false;
  }, []);

  // Commit whatever we've accumulated and return to idle. The single exit used by the server's final
  // frame, the finalize watchdog, and an unexpected ws close — so none of those can strand the hook in
  // recording/finalizing (which leaves the input box readOnly + unresponsive). Idempotent: a no-op once
  // already idle, so the ws.close() inside cleanup re-firing onclose can't double-commit.
  const finish = useCallback(() => {
    if (stateRef.current === 'idle') return;
    onTextRef.current?.(textOf(transRef.current));
    setPartial(''); setPhase('idle'); cleanup();
  }, [cleanup, setPhase]);

  const sendAudio = useCallback((b64) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify(firstSentRef.current ? buildAudioFrame(b64) : buildFirstFrame(appIdRef.current, b64)));
    firstSentRef.current = true;
  }, []);

  const stop = useCallback(async () => {
    if (stateRef.current !== 'recording') return;
    setPhase('finalizing');
    clearTimeout(capTimer.current);
    try {
      const tail = recRef.current ? await recRef.current.stop() : null;
      if (tail) sendAudio(tail);
      const ws = wsRef.current;
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(buildEndFrame()));
        // Don't wait forever for the server's final frame — a stalled IAT/ws would pin us in
        // finalizing and lock the input. Salvage the current text and reset if it doesn't arrive.
        finalizeTimer.current = setTimeout(() => finish(), FINALIZE_MS);
      } else finish();
    } catch {
      setPhase('error'); cleanup();
    }
  }, [sendAudio, cleanup, setPhase, finish]);
  stopRef.current = stop;

  const start = useCallback(async () => {
    // Start only from a settled state. 'error' is settled (and recoverable) — gating on 'idle' alone
    // would strand the mic forever after any failure (denied permission, sign error, ws drop).
    if (stateRef.current !== 'idle' && stateRef.current !== 'error') return;
    setPhase('requesting'); setPartial(''); transRef.current = emptyTranscript(); firstSentRef.current = false;
    try {
      const { url, appId } = await signAsr();
      appIdRef.current = appId;
      const ws = new WebSocketCtor(url);
      wsRef.current = ws;
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        transRef.current = accumulate(transRef.current, msg);
        setPartial(textOf(transRef.current));
        if (msg?.data?.status === 2) finish();
      };
      ws.onerror = () => { setPhase('error'); cleanup(); };
      // An unexpected close mid-session must not strand us in recording/finalizing — salvage + reset.
      // (Our own cleanup() also closes the ws, but finish() is idempotent once idle, so that's a no-op.)
      ws.onclose = () => {
        if (stateRef.current === 'recording' || stateRef.current === 'finalizing') finish();
      };
      const rec = makeRecorder();
      recRef.current = rec;
      await rec.start(sendAudio);
      setPhase('recording');
      capTimer.current = setTimeout(() => { stopRef.current?.(); }, MAX_MS);
    } catch {
      setPhase('error'); cleanup();
    }
  }, [signAsr, WebSocketCtor, makeRecorder, sendAudio, cleanup, setPhase, finish]);

  useEffect(() => cleanup, [cleanup]); // close ws + mic on unmount

  return { state, partial, start, stop };
}
