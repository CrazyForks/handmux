import { useSyncExternalStore } from 'react';

// A single app-wide upload job. Uploads are exclusive (the ＋ button disables while one runs), so one
// slot suffices. <UploadOverlay/> (mounted once in App) subscribes; BottomDock / FileBrowser drive it
// via start/update/finish. `controller` is the batch AbortController so the overlay's Cancel can abort
// the in-flight request AND let the caller's loop break out.
const IDLE = { active: false, phase: null, pct: 0, label: '' };
let state = IDLE;
let controller = null;
const subs = new Set();
const emit = () => { for (const fn of [...subs]) fn(); };

export function startUpload(ac, label = '') {
  controller = ac;
  state = { active: true, phase: 'sending', pct: 0, label };
  emit();
}
export function updateUpload(patch) { state = { ...state, ...patch }; emit(); }
export function finishUpload() { controller = null; state = IDLE; emit(); }
export function cancelUpload() { controller?.abort(); }   // → xhr.onabort rejects with UploadAbort

const subscribe = (cb) => { subs.add(cb); return () => subs.delete(cb); };
const getSnapshot = () => state;
export function useUploadJob() { return useSyncExternalStore(subscribe, getSnapshot); }
