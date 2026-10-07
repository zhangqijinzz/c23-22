import { detectIssues } from "../analyzers/issueDetector";
import { formatSubtitles } from "../formatters/subtitleFormatter";
import {
  defaultUiState,
  emptyState,
  type EditorTab,
  type Format,
  type MeterState,
  type ProjectSummary,
  type ProjectUiState,
  type SubtitleCue,
  type SubtitleProject,
  type TrashedProject,
  type WorkspaceFilter,
  type WorkspaceMeta,
} from "../models";
import { detectFormat, parseSubtitles } from "../parsers/subtitleParser";
import { projectRepository } from "../repositories/projectRepository";
import { downloadSubtitles } from "../services/exportService";
import { readTextFile } from "../services/fileService";
import { summarize } from "../services/indexedDbService";

const TRASH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UI_PERSIST_DELAY_MS = 250;

export class SubtitleMeterViewModel {
  state: MeterState = emptyState();
  private listeners = new Set<() => void>();
  /** 完整项目缓存（含 cues/versions），列表切换时无需重新读取。 */
  private projectsById = new Map<string, SubtitleProject>();
  private summariesById = new Map<string, ProjectSummary>();
  private meta: WorkspaceMeta = {
    order: [],
    activeProjectId: null,
    uiState: {},
  };
  private uiPersistTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.state;

  private publish(patch: Partial<MeterState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private summaryList(): ProjectSummary[] {
    return this.meta.order
      .map((id) => this.summariesById.get(id))
      .filter((item): item is ProjectSummary => Boolean(item));
  }

  /** 选中条目 / 缩放 / 标签页等编辑进度，防抖写入当前项目槽位。 */
  private scheduleUiPersist() {
    if (this.uiPersistTimer) clearTimeout(this.uiPersistTimer);
    this.uiPersistTimer = setTimeout(() => {
      void projectRepository.saveMeta(this.meta).catch(() => {});
    }, UI_PERSIST_DELAY_MS);
  }

  private async commit(
    project: SubtitleProject,
    phase: MeterState["phase"] = "editing",
  ) {
    project.updatedAt = Date.now();
    const issues = detectIssues(project.cues);
    this.projectsById.set(project.id, project);
    this.summariesById.set(project.id, summarize(project));
    this.publish({
      project,
      issues,
      phase,
      notice: "",
      summaries: this.summaryList(),
    });
    try {
      await projectRepository.saveProject(project);
    } catch {
      if (this.state.project?.id === project.id)
        this.publish({
          phase: "error",
          notice: "本地保存失败；当前修改仍保留在页面中，请导出备份",
        });
    }
  }

  /** 载入工作区：迁移旧项目、恢复列表，并按需回到上次打开的项目。 */
  async restore() {
    try {
      const { projects, meta, trash } = await projectRepository.loadWorkspace();
      this.meta = meta;
      this.projectsById = new Map(projects.map((item) => [item.id, item]));
      projects.forEach((item) =>
        this.summariesById.set(item.id, summarize(item)),
      );
      const liveTrash = trash.filter(
        (entry) => Date.now() - entry.deletedAt < TRASH_TTL_MS,
      );
      for (const expired of trash.filter(
        (entry) => Date.now() - entry.deletedAt >= TRASH_TTL_MS,
      ))
        await projectRepository.purgeTrashed(expired.id).catch(() => {});

      const active = meta.activeProjectId
        ? this.projectsById.get(meta.activeProjectId)
        : undefined;
      if (active) {
        this.enterProject(active, meta.uiState[active.id]);
      } else {
        this.publish({
          view: "workspace",
          project: null,
          issues: [],
          summaries: this.summaryList(),
          trash: liveTrash,
          phase: "empty",
        });
      }
    } catch {
      this.publish({ notice: "本地工作区暂时无法读取，可继续导入字幕文件" });
    }
  }

  private enterProject(project: SubtitleProject, savedUi?: ProjectUiState) {
    const ui = savedUi ?? this.meta.uiState[project.id] ?? defaultUiState();
    // 选中条目可能因编辑失效，回退到第一条。
    const selectedId =
      ui.selectedId && project.cues.some((cue) => cue.id === ui.selectedId)
        ? ui.selectedId
        : (project.cues[0]?.id ?? null);
    const normalized: ProjectUiState = {
      ...defaultUiState(),
      ...ui,
      selectedId,
    };
    this.meta.uiState[project.id] = normalized;
    this.meta.activeProjectId = project.id;
    this.publish({
      view: "editor",
      project,
      issues: detectIssues(project.cues),
      selectedId: normalized.selectedId,
      zoom: normalized.zoom,
      activeTab: normalized.activeTab,
      phase: "ready",
      confirmingDeleteId: null,
      notice: "",
    });
    void projectRepository.saveMeta(this.meta).catch(() => {});
  }

  /** 打开列表中的项目，恢复它各自的编辑进度与快照。 */
  openProject(id: string) {
    const project = this.projectsById.get(id);
    if (project) this.enterProject(project);
  }

  /** 返回工作区列表，离开前把当前编辑进度留在对应项目槽位。 */
  async backToWorkspace() {
    if (this.state.project) {
      const id = this.state.project.id;
      this.meta.uiState[id] = {
        selectedId: this.state.selectedId,
        zoom: this.state.zoom,
        activeTab: this.state.activeTab,
      };
      await projectRepository.saveMeta(this.meta).catch(() => {});
    }
    this.publish({
      view: "workspace",
      project: null,
      issues: [],
      notice: "",
      confirmingDeleteId: null,
      summaries: this.summaryList(),
      trash: this.state.trash,
    });
  }

  async importFile(file: File) {
    this.publish({ phase: "importing", notice: "正在读取并解析字幕文件…" });
    try {
      const format = detectFormat(file.name),
        text = await readTextFile(file),
        cues = parseSubtitles(text, format);
      const now = Date.now();
      const project: SubtitleProject = {
        id: `project-${now}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        format,
        cues,
        updatedAt: now,
        versions: [],
      };
      this.projectsById.set(project.id, project);
      this.summariesById.set(project.id, summarize(project));
      this.meta.order = [project.id, ...this.meta.order];
      await projectRepository.saveProject(project);
      await projectRepository.saveMeta(this.meta).catch(() => {});
      this.enterProject(project, {
        selectedId: cues[0].id,
        zoom: 1,
        activeTab: "timeline",
      });
    } catch (error) {
      this.publish({
        phase: "error",
        notice:
          error instanceof Error ? error.message : "导入失败，请检查文件后重试",
      });
    }
  }

  setFilter(filter: WorkspaceFilter) {
    this.publish({ filter });
  }
  setQuery(query: string) {
    this.publish({ query });
  }
  /** 按状态与名称关键字过滤后的列表（UI 与测试共用同一份逻辑）。 */
  getFiltered(): ProjectSummary[] {
    const query = this.state.query.trim().toLowerCase();
    return this.state.summaries.filter((item) => {
      const matchesStatus =
        this.state.filter === "all" || item.status === this.state.filter;
      const matchesName =
        query === "" || item.name.toLowerCase().includes(query);
      return matchesStatus && matchesName;
    });
  }
  setActiveTab(activeTab: EditorTab) {
    this.publish({ activeTab });
    if (this.state.project)
      this.meta.uiState[this.state.project.id] = {
        ...this.meta.uiState[this.state.project.id],
        activeTab,
      };
    this.scheduleUiPersist();
  }

  selectCue(id: string) {
    this.publish({ selectedId: id });
    if (this.state.project)
      this.meta.uiState[this.state.project.id] = {
        ...this.meta.uiState[this.state.project.id],
        selectedId: id,
      };
    this.scheduleUiPersist();
  }

  setZoom(zoom: number) {
    this.publish({ zoom });
    if (this.state.project)
      this.meta.uiState[this.state.project.id] = {
        ...this.meta.uiState[this.state.project.id],
        zoom,
      };
    this.scheduleUiPersist();
  }

  async editCue(
    id: string,
    patch: Partial<Pick<SubtitleCue, "text" | "startMs" | "endMs">>,
  ) {
    if (!this.state.project) return;
    const cues = this.state.project.cues.map((cue) =>
      cue.id === id ? { ...cue, ...patch } : cue,
    );
    await this.commit({ ...this.state.project, cues });
  }

  async saveVersion() {
    const project = this.state.project;
    if (!project) return;
    const versions = [
      ...project.versions,
      {
        id: `v-${Date.now()}`,
        label: `快照 ${project.versions.length + 1}`,
        savedAt: Date.now(),
        cues: structuredClone(project.cues),
      },
    ];
    await this.commit({ ...project, versions });
    this.publish({ notice: "已保存版本快照" });
  }

  async restoreVersion(id: string) {
    const project = this.state.project,
      version = project?.versions.find((item) => item.id === id);
    if (!project || !version) return;
    await this.commit({ ...project, cues: structuredClone(version.cues) });
    this.publish({ notice: `已恢复${version.label}` });
  }

  async exportFile() {
    const project = this.state.project;
    if (!project) return;
    this.publish({ phase: "exporting" });
    try {
      formatSubtitles(project.cues, project.format);
      downloadSubtitles(project.name, project.cues, project.format);
      this.publish({ phase: "ready", notice: "字幕文件已导出" });
    } catch {
      this.publish({
        phase: "error",
        notice: "导出失败，编辑内容已保留，请重试",
      });
    }
  }

  setFormat(format: Format) {
    const project = this.state.project;
    if (project) void this.commit({ ...project, format });
  }

  // ---- 删除：先二次确认，确认后软删除并提供撤销 ----

  requestDelete(id: string) {
    this.publish({ confirmingDeleteId: id });
  }
  cancelDelete() {
    this.publish({ confirmingDeleteId: null });
  }

  /**
   * 二次确认后执行软删除：记录在回收站（保留 7 天），
   * 只移除目标项目，其他项目顺序与快照原样保留。
   */
  async confirmDelete(id: string) {
    const project = this.projectsById.get(id);
    if (!project) return;
    // 在编辑器里删除当前项目时，先记下离开列表，避免把已删项目的 UI 状态写回。
    const leavingEditor =
      this.state.view === "editor" && this.state.project?.id === id;
    const index = this.meta.order.indexOf(id);
    const entry: TrashedProject = {
      id: `trash-${project.updatedAt}-${id}`,
      project,
      index: index < 0 ? this.meta.order.length : index,
      deletedAt: Date.now(),
    };
    this.projectsById.delete(id);
    this.summariesById.delete(id);
    delete this.meta.uiState[id];
    this.meta.order = this.meta.order.filter((item) => item !== id);
    if (this.meta.activeProjectId === id) this.meta.activeProjectId = null;
    this.publish({
      confirmingDeleteId: null,
      pendingDelete: entry,
      project: leavingEditor ? null : this.state.project,
      issues: leavingEditor ? [] : this.state.issues,
      view: leavingEditor ? "workspace" : this.state.view,
      summaries: this.summaryList(),
      trash: [...this.state.trash, entry],
    });
    try {
      await projectRepository.trashProject(entry);
    } catch {
      // 落盘失败时回滚内存，避免列表与本地不一致。
      this.projectsById.set(project.id, project);
      this.summariesById.set(project.id, summarize(project));
      this.meta.order.splice(entry.index, 0, project.id);
      this.publish({
        summaries: this.summaryList(),
        trash: this.state.trash.filter((item) => item.id !== entry.id),
        pendingDelete: null,
        notice: "删除未能写入本地，请重试",
        phase: "error",
      });
    }
  }

  /** 撤销最近一次删除：项目连同快照回到原位置。 */
  async undoDelete(entryId?: string) {
    const entry =
      this.state.trash.find((item) => item.id === entryId) ??
      this.state.pendingDelete;
    if (!entry) return;
    const { project, index } = entry;
    this.projectsById.set(project.id, project);
    this.summariesById.set(project.id, summarize(project));
    this.meta.order = this.meta.order.filter((id) => id !== project.id);
    this.meta.order.splice(
      Math.min(index, this.meta.order.length),
      0,
      project.id,
    );
    this.publish({
      pendingDelete:
        this.state.pendingDelete?.id === entry.id
          ? null
          : this.state.pendingDelete,
      trash: this.state.trash.filter((item) => item.id !== entry.id),
      summaries: this.summaryList(),
      notice: `已恢复项目「${project.name}」`,
    });
    try {
      await projectRepository.restoreTrashed(entry);
    } catch {
      this.publish({
        phase: "error",
        notice: "撤销未能写入本地，请重试",
      });
    }
  }

  dismissUndo() {
    this.publish({ pendingDelete: null });
  }

  /** 从回收站手动彻底删除。 */
  async purgeTrash(entryId: string) {
    const entry = this.state.trash.find((item) => item.id === entryId);
    if (!entry) return;
    this.publish({
      trash: this.state.trash.filter((item) => item.id !== entryId),
      pendingDelete:
        this.state.pendingDelete?.id === entryId
          ? null
          : this.state.pendingDelete,
    });
    await projectRepository.purgeTrashed(entry.id).catch(() => {});
  }
}

export const createViewModel = () => new SubtitleMeterViewModel();
