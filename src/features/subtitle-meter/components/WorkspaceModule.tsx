import { useMemo, useState } from "react";
import type { ProjectStatusFilter, ProjectSummary } from "../models";
import type { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";
import { ImportModule } from "./ImportModule";

const statusOptions: Array<{
  id: ProjectStatusFilter;
  label: string;
}> = [
  { id: "all", label: "全部状态" },
  { id: "issues", label: "有问题" },
  { id: "clean", label: "无问题" },
];

export function formatUpdatedAt(updatedAt: number): string {
  const delta = Date.now() - updatedAt;
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  if (delta < 7 * 86_400_000) return `${Math.floor(delta / 86_400_000)} 天前`;
  return new Date(updatedAt).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function WorkspaceModule({
  vm,
  projects,
  activeId,
  confirmingDeleteId,
  notice,
  phase,
  onOpen,
}: {
  vm: SubtitleMeterViewModel;
  projects: ProjectSummary[];
  activeId: string | null;
  confirmingDeleteId: string | null;
  notice: string;
  phase: string;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ProjectStatusFilter>("all");

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return projects.filter((project) => {
      if (keyword && !project.name.toLowerCase().includes(keyword))
        return false;
      if (status === "issues" && project.issueCount === 0) return false;
      if (status === "clean" && project.issueCount > 0) return false;
      return true;
    });
  }, [projects, query, status]);

  return (
    <div className="module-page workspace-page">
      <section className="module workspace-list-module">
        <div className="module-head workspace-head">
          <div>
            <span className="module-kicker">01 / WORKSPACE</span>
            <h2>
              本地工作区{" "}
              <span className="workspace-total">{projects.length}</span>
            </h2>
          </div>
          <div className="workspace-filters">
            <input
              aria-label="按名称筛选项目"
              className="workspace-search"
              type="search"
              placeholder="按名称筛选…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="status-filter" role="group" aria-label="按状态筛选">
              {statusOptions.map((option) => (
                <button
                  key={option.id}
                  className={status === option.id ? "active" : ""}
                  aria-pressed={status === option.id}
                  onClick={() => setStatus(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {projects.length === 0 ? (
          <div className="workspace-empty">
            <strong>工作区还是空的</strong>
            <p>从右侧导入第一份字幕，项目会自动保存在本机，之后可随时切换。</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="workspace-empty">
            <strong>没有匹配的项目</strong>
            <p>换个名称或清除状态筛选试试。</p>
            <button
              onClick={() => {
                setQuery("");
                setStatus("all");
              }}
            >
              清除筛选
            </button>
          </div>
        ) : (
          <ul className="project-rows">
            {filtered.map((project) => {
              const confirming = confirmingDeleteId === project.id;
              return (
                <li
                  key={project.id}
                  className={`project-row ${activeId === project.id ? "active" : ""}`}
                >
                  <button
                    className="project-open"
                    onClick={() => onOpen(project.id)}
                  >
                    <span className="project-name" title={project.name}>
                      {project.name}
                      {activeId === project.id && (
                        <em className="project-current">当前</em>
                      )}
                    </span>
                    <span className="project-meta">
                      <span>{project.cueCount} 条字幕</span>
                      <span
                        className={
                          project.issueCount > 0 ? "has-issues" : "is-clean"
                        }
                      >
                        {project.issueCount > 0
                          ? `${project.issueCount} 个问题`
                          : "无问题"}
                      </span>
                      <span className="project-time">
                        {formatUpdatedAt(project.updatedAt)}
                      </span>
                    </span>
                  </button>
                  <div className="project-actions">
                    {confirming ? (
                      <span className="delete-confirm">
                        <span>确认删除？快照将一并移除</span>
                        <button
                          className="confirm-yes"
                          onClick={() => void vm.confirmDelete()}
                        >
                          确认删除
                        </button>
                        <button onClick={() => vm.cancelDelete()}>取消</button>
                      </span>
                    ) : (
                      <button
                        className="delete-button"
                        aria-label={`删除项目 ${project.name}`}
                        disabled={confirmingDeleteId !== null}
                        onClick={() => vm.requestDelete(project.id)}
                      >
                        删除
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="workspace-note">
          所有项目仅保存在当前浏览器；删除后可在撤销窗口内恢复，其余项目的顺序与快照不受影响。
        </p>
      </section>

      <section className="workspace-side">
        <ImportModule vm={vm} notice={notice} phase={phase} />
        <section className="module workspace-tips">
          <span className="module-kicker">SERIES WORKFLOW</span>
          <p>
            做系列内容时，每一集各自一个项目：导入新字幕不会覆盖正在编辑的项目，切换后选中的条目、时间轴缩放和快照都会保留。
          </p>
        </section>
      </section>
    </div>
  );
}
