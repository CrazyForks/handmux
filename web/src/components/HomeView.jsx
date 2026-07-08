// web/src/components/HomeView.jsx
import { useState, useEffect, useRef } from 'react';
import { getRecentDocs, removeRecentDoc } from '../storage.js';
import { t } from '../i18n';

// The 最近 segment of the file viewer: ONLY recently-opened docs. The directory browser lives in the
// sibling 新增 segment (FileBrowser). Recent taps bubble an absolute path up via onOpenDoc.
export default function HomeView({ onOpenDoc, refreshKey = 0 }) {
  const [recents, setRecents] = useState(() => getRecentDocs());
  const dropRecent = (path) => { removeRecentDoc(path); setRecents(getRecentDocs()); };
  // Re-read the (localStorage-backed) recents whenever the sheet reopens (refreshKey bump) — it stays
  // mounted while minimized, so a doc opened in the meantime wouldn't otherwise show up on reopen. Skip
  // the mount run: the useState initializer already read the current list.
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) { firstRef.current = false; return; }
    setRecents(getRecentDocs());
  }, [refreshKey]);

  if (recents.length === 0) {
    return (
      <div className="home-view">
        <div className="home-empty">{t('home.empty')}<span>{t('home.emptyHint')}</span></div>
      </div>
    );
  }
  return (
    <div className="home-view">
      {recents.map((d) => (
        <div key={d.path} className="home-recent-row">
          <button className="home-recent" onClick={() => onOpenDoc(d.path)} title={d.path}>
            <span className="home-name">{d.name}</span>
            <span className="home-path">{d.path}</span>
          </button>
          <button className="home-x" aria-label={t('home.remove')} onClick={() => dropRecent(d.path)}>✕</button>
        </div>
      ))}
    </div>
  );
}
