import { useEffect, useMemo, useSyncExternalStore } from "react";
import { EditorShell } from "../components/EditorShell";
import { WorkspaceHome } from "../components/WorkspaceHome";
import { createViewModel } from "../viewmodels/subtitleMeterViewModel";

export function SubtitleMeter() {
  const vm = useMemo(createViewModel, []),
    state = useSyncExternalStore(vm.subscribe, vm.getSnapshot);
  useEffect(() => {
    void vm.restore();
  }, [vm]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <button
          className="brand"
          onClick={() =>
            state.view === "editor" ? void vm.backToWorkspace() : undefined
          }
        >
          <span className="brand-mark">S</span>
          <span>
            subtitle<span className="brand-light">meter</span>
          </span>
        </button>
        <div className="topbar-right">
          <span className="local-pill">
            <i /> 所有处理均在本地
          </span>
          <button className="help-button" aria-label="帮助">
            ?
          </button>
        </div>
      </header>
      {state.view === "workspace" ? (
        <WorkspaceHome vm={vm} state={state} />
      ) : (
        <EditorShell vm={vm} state={state} />
      )}
      <footer>
        <span>SUBTITLEMETER · 字幕节奏校对台</span>
        <span>DESIGNED FOR BETTER READING</span>
      </footer>
    </main>
  );
}
