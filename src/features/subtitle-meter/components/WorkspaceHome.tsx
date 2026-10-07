import { useMemo } from "react";
import type {
  ProjectStatus,
  ProjectSummary,
  TrashedProject,
  WorkspaceFilter,
} from "../models";
import type { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";
import { formatRelativeTime } from "../utils/time";
import { ImportModule } from "./ImportModule";

const statusMeta: Record<ProjectStatus, { label: string; className: string }> =
  {
    clean: { label: "无问题", className: "status-clean" },
    warning: { label: "有待处理", className: "status-warning" },
    error: { label: "有错误", className: "status-error" },
  };

const filterOptions: Array<{ id: WorkspaceFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "error", label: "有错误" },
  { id: "warning", label: "有待处理" },
  { id: "clean", label: "无问题" },
];

function ProjectCard({
  summary,
  vm,
  confirming,
}: {
  summary: ProjectSummary;
  vm: SubtitleMeterViewModel;
  confirming: boolean;
}) {
  const status = statusMeta[summary.status];
  if (confirming)
    return (
      <li className="project-card project-card-confirm">
        <div className="confirm-copy">
          <strong>删除项目「{summary.name}」？</strong>
          <small>
            {summary.cueCount} 条字幕和 {summary.issueCount}
            项检查结果将移入回收站，可在 7 天内撤销恢复。
          </small>
        </div>
        <div className="confirm-actions">
          <button
            className="confirm-danger"
            onClick={() => void vm.confirmDelete(summary.id)}
          >
            确认删除
          </button>
          <button
            className="secondary-button"
            onClick={() => vm.cancelDelete()}
          >
            取消
          </button>
        </div>
      </li>
    );
  return (
    <li className="project-card">
      <button
        className="project-card-main"
        onClick={() => vm.openProject(summary.id)}
        title={`打开 ${summary.name}`}
      >
        <span className="project-mark">S</span>
        <span className="project-info">
          <strong>{summary.name}</strong>
          <small>
            {summary.cueCount} 条字幕 · {summary.issueCount} 项问题 ·{" "}
            {formatRelativeTime(summary.updatedAt)}
          </small>
        </span>
        <span className={`project-status ${status.className}`}>
          {status.label}
        </span>
        <span className="project-open">打开 →</span>
      </button>
      <button
        className="project-delete"
        aria-label={`删除项目 ${summary.name}`}
        title="删除项目"
        onClick={() => vm.requestDelete(summary.id)}
      >
        删除
      </button>
    </li>
  );
}

function TrashSection({
  trash,
  vm,
}: {
  trash: TrashedProject[];
  vm: SubtitleMeterViewModel;
}) {
  if (trash.length === 0) return null;
  return (
    <section className="module trash-module">
      <div className="module-head">
        <h2>回收站</h2>
        <span className="local-mark">删除后 7 天内可恢复</span>
      </div>
      <ul className="trash-list">
        {trash.map((entry) => (
          <li key={entry.id} className="trash-row">
            <span className="trash-name">{entry.project.name}</span>
            <small>{formatRelativeTime(entry.deletedAt)}删除</small>
            <div className="trash-actions">
              <button
                className="secondary-button"
                onClick={() => void vm.undoDelete(entry.id)}
              >
                撤销删除
              </button>
              <button
                className="trash-purge"
                aria-label={`彻底删除 ${entry.project.name}`}
                onClick={() => void vm.purgeTrash(entry.id)}
              >
                彻底删除
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function WorkspaceHome({
  vm,
  state,
}: {
  vm: SubtitleMeterViewModel;
  state: ReturnType<SubtitleMeterViewModel["getSnapshot"]>;
}) {
  const counts = useMemo(() => {
    const result: Record<WorkspaceFilter, number> = {
      all: state.summaries.length,
      clean: 0,
      warning: 0,
      error: 0,
    };
    state.summaries.forEach((item) => {
      result[item.status] += 1;
    });
    return result;
  }, [state.summaries]);

  const visible = vm.getFiltered();

  return (
    <div className="workspace-home">
      <section className="module workspace-head-module">
        <div className="workspace-head">
          <div>
            <span className="module-kicker">LOCAL WORKSPACE</span>
            <h1>
              字幕工作区<em>。</em>
            </h1>
            <p>
              多个项目同时保存在此浏览器，各自的编辑进度与版本快照相互独立。
            </p>
          </div>
          <div className="workspace-stats">
            <span>本地项目</span>
            <strong>
              {state.summaries.length}
              <small> 个</small>
            </strong>
          </div>
        </div>
      </section>

      <ImportModule
        vm={vm}
        notice={state.notice}
        phase={state.phase}
        fileName={undefined}
      />

      <section className="module workspace-toolbar">
        <div className="filter-tabs" role="group" aria-label="按状态筛选">
          {filterOptions.map((option) => (
            <button
              key={option.id}
              className={state.filter === option.id ? "active" : ""}
              aria-pressed={state.filter === option.id}
              onClick={() => vm.setFilter(option.id)}
            >
              {option.label}
              <span className="filter-count">{counts[option.id]}</span>
            </button>
          ))}
        </div>
        <input
          className="name-filter"
          type="search"
          aria-label="按名称筛选项目"
          placeholder="按名称筛选…"
          value={state.query}
          onChange={(event) => vm.setQuery(event.target.value)}
        />
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

      {state.summaries.length === 0 ? (
        <section className="module empty-workspace">
          <span>S</span>
          <div>
            <strong>还没有项目</strong>
            <p>导入一份 SRT 或 WebVTT 字幕，即可开始校对。</p>
          </div>
        </section>
      ) : visible.length === 0 ? (
        <section className="module empty-workspace">
          <span>⌕</span>
          <div>
            <strong>没有匹配的项目</strong>
            <p>试试更换状态筛选，或清空名称关键字。</p>
          </div>
        </section>
      ) : (
        <ul className="project-list">
          {visible.map((summary) => (
            <ProjectCard
              key={summary.id}
              summary={summary}
              vm={vm}
              confirming={state.confirmingDeleteId === summary.id}
            />
          ))}
        </ul>
      )}

      <TrashSection trash={state.trash} vm={vm} />
    </div>
  );
}
