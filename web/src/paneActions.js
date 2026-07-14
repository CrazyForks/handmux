// Pure(ish) core logic for the two pane-management structural changes — split and close. Both are
// "call the api, then refetch the window's panes, then decide what the phone should look at next".
// Extracted out of App.jsx so the decision logic (which pane to land on after a split; whether to
// re-target after a close) is unit-testable without rendering the whole App tree. All dependencies
// (the api functions, getPanes, pickId) are injected — nothing here reaches into React state.

// Split `paneId` into two panes (dir 'h' left|right, 'v' top/bottom). Refetches the window's panes
// and returns { panes, selectPaneId } — selectPaneId is the NEW pane's id (the phone follows the
// split into the freshly-created pane, mirroring tmux's own behavior).
export async function runSplitPane({ paneId, dir, windowId, api, getPanes }) {
  const { id } = await api.splitPane(paneId, dir);
  const panes = await getPanes(windowId);
  return { panes, selectPaneId: id };
}

// Close `paneId`. Refetches the window's panes and returns { panes, selectPaneId } — selectPaneId is
// non-null ONLY when the closed pane was the one being viewed (`viewedPaneId`), in which case it's a
// surviving pane chosen via `pickId` (null when the pane list is now empty, or the closed pane wasn't
// the viewed one — caller shouldn't move the view).
export async function runClosePane({ paneId, windowId, viewedPaneId, api, getPanes, pickId }) {
  await api.closePane(paneId);
  const panes = await getPanes(windowId);
  const selectPaneId = (paneId === viewedPaneId && panes.length) ? pickId(panes, null) : null;
  return { panes, selectPaneId };
}
