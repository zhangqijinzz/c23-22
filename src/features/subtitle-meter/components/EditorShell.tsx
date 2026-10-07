import { InspectionModule } from "./InspectionModule";
import { PreviewModule } from "./PreviewModule";
import { TimelineModule } from "./TimelineModule";
import { VersionExportModule } from "./VersionExportModule";
import type { EditorTab } from "../models";
import type { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";

const tabs: Array<{
  id: EditorTab;
  number: string;
  label: string;
  hint: string;
}> = [
  { id: "timeline", number: "01", label: "时间轴", hint: "查看并调整时间" },
  { id: "inspection", number: "02", label: "问题检查", hint: "定位并修正问题" },
  { id: "delivery", number: "03", label: "版本导出", hint: "保存快照与导出" },
];

export function EditorShell({
  vm,
  state,
}: {
  vm: SubtitleMeterViewModel;
  state: ReturnType<SubtitleMeterViewModel["getSnapshot"]>;
}) {
  const project = state.project;
  if (!project) return null;
  const selected =
    project.cues.find((cue) => cue.id === state.selectedId) ?? project.cues[0];

  return (
    <div className="editor-shell">
      <section className="module editor-bar">
        <button
          className="back-button"
          onClick={() => void vm.backToWorkspace()}
        >
          ← 工作区
        </button>
        <div className="editor-project">
          <strong>{project.name}</strong>
          <small>
            {project.cues.length} 条字幕 · {project.format.toUpperCase()} ·{" "}
            {state.issues.length} 项问题
          </small>
        </div>
        <div className="editor-bar-actions">
          <span className="saved-label">● 自动保存</span>
          {state.confirmingDeleteId === project.id ? (
            <span className="inline-confirm">
              <small>确认删除此项目？</small>
              <button
                className="confirm-danger"
                onClick={() => void vm.confirmDelete(project.id)}
              >
                删除
              </button>
              <button
                className="secondary-button"
                onClick={() => vm.cancelDelete()}
              >
                取消
              </button>
            </span>
          ) : (
            <button
              className="secondary-button danger"
              onClick={() => vm.requestDelete(project.id)}
            >
              删除项目
            </button>
          )}
        </div>
      </section>

      {state.pendingDelete && (
        <div className="undo-banner" role="status">
          <span>
            已删除项目「{state.pendingDelete.project.name}」，7
            天内可从回收站恢复。
          </span>
          <div>
            <button
              className="secondary-button"
              onClick={() => void vm.undoDelete()}
            >
              撤销
            </button>
            <button
              className="undo-dismiss"
              aria-label="关闭撤销提示"
              onClick={() => vm.dismissUndo()}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {state.notice && (
        <div
          className={`notice ${state.phase === "error" ? "error" : ""}`}
          role="status"
        >
          {state.notice}
        </div>
      )}

      <nav
        className="module-tabs editor-tabs"
        role="tablist"
        aria-label="字幕校对模块"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            role="tab"
            aria-selected={state.activeTab === tab.id}
            aria-controls="module-panel"
            className={`module-tab ${state.activeTab === tab.id ? "active" : ""}`}
            onClick={() => vm.setActiveTab(tab.id)}
          >
            <span className="tab-number">{tab.number}</span>
            <span className="tab-copy">
              <strong>{tab.label}</strong>
              <small>{tab.hint}</small>
            </span>
            {tab.id === "inspection" && state.issues.length > 0 && (
              <span className="tab-count">{state.issues.length}</span>
            )}
          </button>
        ))}
      </nav>
      <section
        id="module-panel"
        className="module-panel"
        role="tabpanel"
        aria-labelledby={`tab-${state.activeTab}`}
      >
        {state.activeTab === "timeline" && (
          <div className="module-page">
            <TimelineModule
              project={project}
              vm={vm}
              selectedId={state.selectedId}
              zoom={state.zoom}
            />
            <p className="page-tip">
              选中字幕块可在「问题检查」中编辑文本与精确时间；拖动时间块可整体调整时段。
            </p>
          </div>
        )}
        {state.activeTab === "inspection" && (
          <div className="module-page inspection-page">
            <InspectionModule
              cues={project.cues}
              issues={state.issues}
              vm={vm}
              selectedId={state.selectedId}
            />
            <PreviewModule cue={selected} />
          </div>
        )}
        {state.activeTab === "delivery" && (
          <div className="module-page delivery-page">
            <VersionExportModule
              project={project}
              vm={vm}
              phase={state.phase}
            />
            <section className="module delivery-summary">
              <span className="module-kicker">EXPORT CHECK</span>
              <strong>
                {state.issues.length === 0
                  ? "校对完成，可以导出"
                  : `还有 ${state.issues.length} 项问题待查看`}
              </strong>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
