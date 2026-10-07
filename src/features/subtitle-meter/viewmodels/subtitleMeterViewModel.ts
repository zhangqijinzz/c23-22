import { detectIssues } from "../analyzers/issueDetector";
import { formatSubtitles } from "../formatters/subtitleFormatter";
import {
  defaultUi,
  emptyState,
  type Format,
  type MeterState,
  type ProjectSummary,
  type ProjectUiState,
  type SubtitleCue,
  type SubtitleProject,
  type WorkspaceMeta,
} from "../models";
import { detectFormat, parseSubtitles } from "../parsers/subtitleParser";
import { projectRepository } from "../repositories/projectRepository";
import { downloadSubtitles } from "../services/exportService";
import { readTextFile } from "../services/fileService";
import { createProjectId, TRASH_TTL_MS } from "../services/indexedDbService";

export class SubtitleMeterViewModel {
  state: MeterState = emptyState();
  private listeners = new Set<() => void>();
  private meta: WorkspaceMeta = {
    version: 1,
    projectIds: [],
    activeId: null,
    uiById: {},
    lastDeleted: null,
  };
  private projectsData: SubtitleProject[] = [];
  private trashTimer: ReturnType<typeof setTimeout> | null = null;
  private metaTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.state;

  private publish(patch: Partial<MeterState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private summaries(): ProjectSummary[] {
    return this.meta.projectIds.flatMap((id) => {
      const project = this.projectsData.find((item) => item.id === id);
      if (!project) return [];
      const ui = this.meta.uiById[id] ?? defaultUi();
      return [
        {
          id,
          name: project.name,
          cueCount: project.cues.length,
          issueCount: detectIssues(project.cues).length,
          updatedAt: project.updatedAt,
          selectedId: ui.selectedId,
          zoom: ui.zoom,
        },
      ];
    });
  }

  private activate(id: string, notice = "") {
    const project = this.projectsData.find((item) => item.id === id);
    if (!project) return;
    const ui = this.meta.uiById[id] ?? defaultUi();
    this.publish({
      project,
      issues: detectIssues(project.cues),
      activeId: id,
      selectedId: ui.selectedId ?? project.cues[0]?.id ?? null,
      zoom: ui.zoom ?? 1,
      phase: "ready",
      notice,
    });
  }

  private scheduleMetaSave() {
    if (this.metaTimer) clearTimeout(this.metaTimer);
    this.metaTimer = setTimeout(() => {
      this.metaTimer = null;
      void projectRepository.saveMeta(this.meta).catch(() => undefined);
    }, 250);
  }

  private async saveMeta(meta: WorkspaceMeta) {
    this.meta = meta;
    await projectRepository.saveMeta(meta);
  }

  /** 更新当前项目的独立编辑进度 */
  private rememberActiveUi(patch: Partial<ProjectUiState>) {
    const activeId = this.meta.activeId;
    if (!activeId) return;
    const current = this.meta.uiById[activeId] ?? defaultUi();
    this.meta = {
      ...this.meta,
      uiById: {
        ...this.meta.uiById,
        [activeId]: { ...current, ...patch },
      },
    };
    this.scheduleMetaSave();
  }

  private scheduleTrashPurge() {
    if (this.trashTimer) clearTimeout(this.trashTimer);
    this.trashTimer = setTimeout(() => {
      this.trashTimer = null;
      void this.flushTrash();
    }, TRASH_TTL_MS);
  }

  private async flushTrash() {
    if (this.trashTimer) {
      clearTimeout(this.trashTimer);
      this.trashTimer = null;
    }
    const entry = this.meta.lastDeleted;
    if (!entry) return;
    try {
      this.meta = await projectRepository.purge(this.meta);
      this.publish({
        trash: null,
        projects: this.summaries(),
        notice: `已彻底删除「${entry.project.name}」`,
      });
    } catch {
      // 下次加载工作区时仍会清理过期的回收记录
    }
  }

  async restore() {
    try {
      const { meta, projects } = await projectRepository.loadWorkspace();
      this.meta = meta;
      this.projectsData = projects;
      const patch: Partial<MeterState> = { projects: this.summaries() };
      if (meta.lastDeleted) {
        patch.trash = meta.lastDeleted;
        this.scheduleTrashPurge();
      }
      if (meta.activeId) this.activate(meta.activeId, "已恢复上次的工作区");
      else {
        patch.project = null;
        patch.issues = [];
        patch.selectedId = null;
        patch.activeId = null;
        patch.phase = "empty";
      }
      this.publish(patch);
    } catch {
      this.publish({ notice: "本地工作区暂时无法读取，可继续导入字幕文件" });
    }
  }

  async openProject(id: string) {
    const project = this.projectsData.find((item) => item.id === id);
    if (!project || this.state.confirmingDeleteId) return;
    // 离开前固化当前项目的编辑进度
    this.rememberActiveUi({
      selectedId: this.state.selectedId,
      zoom: this.state.zoom,
    });
    try {
      const meta: WorkspaceMeta = { ...this.meta, activeId: id };
      await this.saveMeta(meta);
      this.activate(id, `已切换到「${project.name}」`);
    } catch {
      // 元数据未保存也允许切换，内容本身已在本地
      this.meta = { ...this.meta, activeId: id };
      this.activate(id, `已切换到「${project.name}」`);
    }
  }

  backToWorkspace() {
    this.rememberActiveUi({
      selectedId: this.state.selectedId,
      zoom: this.state.zoom,
    });
  }

  async importFile(file: File) {
    this.publish({ phase: "importing", notice: "正在读取并解析字幕文件…" });
    try {
      const format = detectFormat(file.name),
        text = await readTextFile(file),
        cues = parseSubtitles(text, format);
      const project: SubtitleProject = {
        id: createProjectId(),
        name: file.name,
        format,
        cues,
        updatedAt: Date.now(),
        versions: [],
      };
      await projectRepository.saveProject(project);
      this.projectsData = [...this.projectsData, project];
      const ui: ProjectUiState = {
        selectedId: cues[0]?.id ?? null,
        zoom: 1,
      };
      const meta: WorkspaceMeta = {
        ...this.meta,
        projectIds: [...this.meta.projectIds, project.id],
        activeId: project.id,
        uiById: { ...this.meta.uiById, [project.id]: ui },
      };
      await this.saveMeta(meta);
      this.publish({
        projects: this.summaries(),
        confirmingDeleteId: null,
        notice: `已新建项目「${project.name}」，共 ${cues.length} 条字幕`,
      });
      this.activate(project.id);
    } catch (error) {
      this.publish({
        phase: "error",
        notice:
          error instanceof Error ? error.message : "导入失败，请检查文件后重试",
      });
    }
  }

  selectCue(id: string) {
    this.publish({ selectedId: id });
    this.rememberActiveUi({ selectedId: id });
  }

  setZoom(zoom: number) {
    this.publish({ zoom });
    this.rememberActiveUi({ zoom });
  }

  private async commit(
    project: SubtitleProject,
    phase: MeterState["phase"] = "editing",
  ) {
    project.updatedAt = Date.now();
    const issues = detectIssues(project.cues);
    this.projectsData = this.projectsData.map((item) =>
      item.id === project.id ? project : item,
    );
    this.publish({
      project,
      issues,
      phase,
      notice: "",
      projects: this.summaries(),
    });
    try {
      await projectRepository.saveProject(project);
    } catch {
      if (this.state.project?.id === project.id) {
        this.publish({
          phase: "error",
          notice: "本地保存失败；当前修改仍保留在页面中，请导出备份",
        });
      }
    }
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

  // ---- 项目删除：二次确认 + 撤销窗口，其余项目顺序与快照不受影响 ----

  requestDelete(id: string) {
    this.publish({ confirmingDeleteId: id });
  }

  cancelDelete() {
    this.publish({ confirmingDeleteId: null });
  }

  async confirmDelete() {
    const id = this.state.confirmingDeleteId;
    if (!id) return;
    const index = this.meta.projectIds.indexOf(id);
    const project = this.projectsData.find((item) => item.id === id);
    if (!project || index < 0) {
      this.publish({ confirmingDeleteId: null });
      return;
    }
    const ui = this.meta.uiById[id] ?? defaultUi();
    // 回收区只保留最近一次删除；上一个未撤销的项目先行彻底清除
    if (this.meta.lastDeleted)
      await projectRepository.purgeBody(this.meta).catch(() => undefined);
    const nextUiById = { ...this.meta.uiById };
    delete nextUiById[id];
    const nextMeta: WorkspaceMeta = {
      ...this.meta,
      projectIds: this.meta.projectIds.filter((item) => item !== id),
      activeId: this.meta.activeId === id ? null : this.meta.activeId,
      uiById: nextUiById,
      lastDeleted: { project, ui, index, deletedAt: Date.now() },
    };
    try {
      await projectRepository.stash(nextMeta, project, ui, index);
    } catch {
      this.publish({
        confirmingDeleteId: null,
        phase: "error",
        notice: "删除失败，项目未改动，请重试",
      });
      return;
    }
    this.meta = nextMeta;
    this.projectsData = this.projectsData.filter((item) => item.id !== id);
    const wasActive = this.state.activeId === id;
    this.publish({
      confirmingDeleteId: null,
      trash: nextMeta.lastDeleted,
      projects: this.summaries(),
      activeId: nextMeta.activeId,
      ...(wasActive
        ? {
            project: null,
            issues: [],
            selectedId: null,
            phase: "empty" as const,
          }
        : {}),
    });
    this.scheduleTrashPurge();
  }

  async undoDelete() {
    const entry = this.meta.lastDeleted;
    if (!entry) return;
    if (this.trashTimer) {
      clearTimeout(this.trashTimer);
      this.trashTimer = null;
    }
    let restoredMeta: WorkspaceMeta;
    try {
      restoredMeta = projectRepository.unstash(this.meta);
      this.meta = restoredMeta;
      await this.saveMeta(restoredMeta);
    } catch {
      return;
    }
    const remaining = this.projectsData.filter(
      (item) => item.id !== entry.project.id,
    );
    const insertAt = Math.max(0, Math.min(entry.index, remaining.length));
    remaining.splice(insertAt, 0, entry.project);
    this.projectsData = remaining;
    this.publish({
      trash: null,
      projects: this.summaries(),
      notice: `已撤销删除，「${entry.project.name}」恢复到原位置`,
    });
    this.activate(entry.project.id);
  }
}

export const createViewModel = () => new SubtitleMeterViewModel();
