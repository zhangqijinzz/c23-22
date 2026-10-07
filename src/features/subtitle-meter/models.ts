export type Format = "srt" | "vtt";
export interface SubtitleCue {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}
export type IssueType =
  | "overlap"
  | "too-short"
  | "too-fast"
  | "too-long"
  | "empty"
  | "invalid-time";
export interface SubtitleIssue {
  id: string;
  cueId: string;
  type: IssueType;
  severity: "info" | "warning" | "error";
  message: string;
}
export interface SubtitleProject {
  id: string;
  name: string;
  format: Format;
  cues: SubtitleCue[];
  updatedAt: number;
  versions: Array<{
    id: string;
    label: string;
    savedAt: number;
    cues: SubtitleCue[];
  }>;
}

/** 校对状态：无问题即校对完成，错误优先于提醒。 */
export type ProjectStatus = "clean" | "warning" | "error";

/** 列表中展示的项目摘要（条目数 / 问题数 / 状态 / 最近修改）。 */
export interface ProjectSummary {
  id: string;
  name: string;
  cueCount: number;
  issueCount: number;
  status: ProjectStatus;
  updatedAt: number;
}

/** 编辑器内的三个模块标签。 */
export type EditorTab = "timeline" | "inspection" | "delivery";

/**
 * 每个项目独立的编辑进度：选中条目、时间轴缩放与停留的标签页。
 * 随项目一起持久化，切换项目互不影响。
 */
export interface ProjectUiState {
  selectedId: string | null;
  zoom: number;
  activeTab: EditorTab;
}

/** 工作区级元数据：项目顺序、当前打开的项目与各项目的编辑进度。 */
export interface WorkspaceMeta {
  order: string[];
  activeProjectId: string | null;
  uiState: Record<string, ProjectUiState>;
}

/** 回收站条目：软删除的完整项目，保留固定天数供撤销。 */
export interface TrashedProject {
  id: string;
  project: SubtitleProject;
  index: number;
  deletedAt: number;
}

export type WorkspaceFilter = "all" | ProjectStatus;

export interface MeterState {
  view: "workspace" | "editor";
  phase: "empty" | "importing" | "ready" | "editing" | "exporting" | "error";
  project: SubtitleProject | null;
  issues: SubtitleIssue[];
  selectedId: string | null;
  notice: string;
  zoom: number;
  activeTab: EditorTab;
  summaries: ProjectSummary[];
  filter: WorkspaceFilter;
  query: string;
  /** 最近一次软删除，用于顶部撤销条；为 null 表示没有待撤销的删除。 */
  pendingDelete: TrashedProject | null;
  trash: TrashedProject[];
  /** 等待二次确认的删除项目 id。 */
  confirmingDeleteId: string | null;
}

export const defaultUiState = (): ProjectUiState => ({
  selectedId: null,
  zoom: 1,
  activeTab: "timeline",
});

export const emptyState = (): MeterState => ({
  view: "workspace",
  phase: "empty",
  project: null,
  issues: [],
  selectedId: null,
  notice: "",
  zoom: 1,
  activeTab: "timeline",
  summaries: [],
  filter: "all",
  query: "",
  pendingDelete: null,
  trash: [],
  confirmingDeleteId: null,
});
