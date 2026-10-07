import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ImportModule } from "../components/ImportModule";
import { InspectionModule } from "../components/InspectionModule";
import { PreviewModule } from "../components/PreviewModule";
import { TimelineModule } from "../components/TimelineModule";
import { UndoDeleteToast } from "../components/UndoDeleteToast";
import { VersionExportModule } from "../components/VersionExportModule";
import { WorkspaceModule } from "../components/WorkspaceModule";
import { createViewModel } from "../viewmodels/subtitleMeterViewModel";

const tabs = [
  { id: "workspace", number: "01", label: "工作区", hint: "管理本地全部项目" },
  { id: "import", number: "02", label: "导入项目", hint: "添加字幕到工作区" },
  { id: "timeline", number: "03", label: "时间轴", hint: "查看并调整时间" },
  { id: "inspection", number: "04", label: "问题检查", hint: "定位并修正问题" },
  { id: "delivery", number: "05", label: "版本导出", hint: "保存快照与导出" },
] as const;
type TabId = (typeof tabs)[number]["id"];

export function SubtitleMeter() {
  const vm = useMemo(createViewModel, []),
    state = useSyncExternalStore(vm.subscribe, vm.getSnapshot);
  const [activeTab, setActiveTab] = useState<TabId>("workspace");
  useEffect(() => {
    void vm.restore();
  }, [vm]);
  // 恢复出上次编辑的项目时直接进入编辑页
  useEffect(() => {
    if (state.activeId && activeTab === "workspace") setActiveTab("import");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeId]);
  const project = state.project;
  const selected =
    project?.cues.find((cue) => cue.id === state.selectedId) ??
    project?.cues[0];

  const goWorkspace = () => {
    vm.backToWorkspace();
    setActiveTab("workspace");
  };

  const openProject = (id: string) => {
    void vm.openProject(id).then(() => setActiveTab("import"));
  };

  const loadDemo = () => {
    const content =
      "1\n00:00:01,000 --> 00:00:03,600\n字幕的节奏，决定了内容的呼吸。\n\n2\n00:00:03,750 --> 00:00:06,200\n让每一行，都有恰好的停留时间。\n\n3\n00:00:06,350 --> 00:00:08,900\n清晰、从容，不错过每一个重点。";
    void vm
      .importFile(
        new File([content], "subtitle-demo.srt", { type: "text/plain" }),
      )
      .then(() => setActiveTab("import"));
  };

  const emptyTab = (title: string, description: string) => (
    <section className="module tab-empty-state">
      <span className="empty-tab-mark">S</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <button onClick={goWorkspace}>
        前往工作区选择项目 <span>→</span>
      </button>
    </section>
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#">
          <span className="brand-mark">S</span>
          <span>
            subtitle<span className="brand-light">meter</span>
          </span>
        </a>
        <div className="topbar-right">
          <span className="local-pill">
            <i /> 所有处理均在本地
          </span>
          <button className="help-button" aria-label="帮助">
            ?
          </button>
        </div>
      </header>
      <section className="hero">
        <div>
          <div className="eyebrow">
            <span /> SUBTITLE RHYTHM WORKSPACE
          </div>
          <h1>
            让每一行字幕，<em>刚好被读完。</em>
          </h1>
          <p>
            {project
              ? `正在编辑「${project.name}」，所有修改自动保存到本机。`
              : "校对时间节奏、阅读压力与画面占用。多个项目同时保存在本地工作区。"}
          </p>
        </div>
        <div className="hero-stats">
          <span>{project ? "当前项目" : "本地项目"}</span>
          <strong>
            {project ? project.cues.length : state.projects.length}
            <small> {project ? "条字幕" : "个项目"}</small>
          </strong>
        </div>
      </section>
      <nav className="module-tabs" role="tablist" aria-label="字幕校对模块">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls="module-panel"
            className={`module-tab ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="tab-number">{tab.number}</span>
            <span className="tab-copy">
              <strong>{tab.label}</strong>
              <small>{tab.hint}</small>
            </span>
            {tab.id === "inspection" && project && state.issues.length > 0 && (
              <span className="tab-count">{state.issues.length}</span>
            )}
          </button>
        ))}
      </nav>
      <section
        id="module-panel"
        className="module-panel"
        role="tabpanel"
        aria-labelledby={`tab-${activeTab}`}
      >
        {activeTab === "workspace" && (
          <WorkspaceModule
            vm={vm}
            projects={state.projects}
            activeId={state.activeId}
            confirmingDeleteId={state.confirmingDeleteId}
            notice={state.notice}
            phase={state.phase}
            onOpen={openProject}
          />
        )}
        {activeTab === "import" && (
          <div className="module-page import-page">
            <ImportModule
              vm={vm}
              notice={state.notice}
              phase={state.phase}
              fileName={project?.name}
            />
            {project ? (
              <section className="module project-overview">
                <div>
                  <span className="module-kicker">CURRENT PROJECT</span>
                  <h2>{project.name}</h2>
                  <p>
                    {project.cues.length} 条字幕 ·{" "}
                    {project.format.toUpperCase()} · 已自动保存到此浏览器
                  </p>
                  <div className="overview-actions">
                    <button onClick={goWorkspace}>← 返回工作区</button>
                    <button
                      className="overview-delete"
                      onClick={() => {
                        vm.requestDelete(project.id);
                        setActiveTab("workspace");
                      }}
                    >
                      删除此项目
                    </button>
                  </div>
                </div>
                <div className="overview-count">
                  <strong>{state.issues.length}</strong>
                  <span>待处理问题</span>
                </div>
              </section>
            ) : (
              <section className="module import-welcome">
                <div className="welcome-icon">S</div>
                <div>
                  <h2>从一份字幕文件开始</h2>
                  <p>
                    导入会在工作区中新建项目，不会覆盖已有项目。SRT 与 WebVTT
                    均在本机解析，不会上传字幕内容。
                  </p>
                  <button onClick={loadDemo}>
                    载入示例字幕 <span>→</span>
                  </button>
                </div>
                <div className="welcome-checks">
                  <span>多项目并存</span>
                  <span>进度与快照独立</span>
                  <span>删除可撤销</span>
                </div>
              </section>
            )}
          </div>
        )}
        {activeTab === "timeline" &&
          (project ? (
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
          ) : (
            emptyTab(
              "导入字幕后查看时间轴",
              "字幕条目会按时间排列在轨道上，支持缩放与拖动调整。",
            )
          ))}
        {activeTab === "inspection" &&
          (project ? (
            <div className="module-page inspection-page">
              <InspectionModule
                cues={project.cues}
                issues={state.issues}
                vm={vm}
                selectedId={state.selectedId}
              />
              <PreviewModule cue={selected} />
            </div>
          ) : (
            emptyTab(
              "导入字幕后开始检查",
              "问题列表可直接定位字幕，修改后阅读压力和检查结果会即时更新。",
            )
          ))}
        {activeTab === "delivery" &&
          (project ? (
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
                <button onClick={() => setActiveTab("inspection")}>
                  查看检查结果 <span>→</span>
                </button>
              </section>
            </div>
          ) : (
            emptyTab(
              "导入字幕后管理版本",
              "在本地保存版本快照，并导出校对完成的 SRT 或 WebVTT。",
            )
          ))}
      </section>
      <UndoDeleteToast trash={state.trash} vm={vm} />
      <footer>
        <span>SUBTITLEMETER · 字幕节奏校对台</span>
        <span>DESIGNED FOR BETTER READING</span>
      </footer>
    </main>
  );
}
