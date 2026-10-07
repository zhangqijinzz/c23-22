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
/** 每个项目各自独立的编辑进度 */
export interface ProjectUiState {
  selectedId: string | null;
  zoom: number;
}
export interface ProjectSummary extends ProjectUiState {
  id: string;
  name: string;
  cueCount: number;
  issueCount: number;
  updatedAt: number;
}
/** 软删除到回收区的项目，撤销窗口内可原位恢复 */
export interface TrashEntry {
  project: SubtitleProject;
  ui: ProjectUiState;
  index: number;
  deletedAt: number;
}
export interface WorkspaceMeta {
  version: 1;
  projectIds: string[];
  activeId: string | null;
  uiById: Record<string, ProjectUiState>;
  lastDeleted: TrashEntry | null;
}
export type ProjectStatusFilter = "all" | "clean" | "issues";
export interface MeterState {
  phase: "empty" | "importing" | "ready" | "editing" | "exporting" | "error";
  project: SubtitleProject | null;
  issues: SubtitleIssue[];
  selectedId: string | null;
  notice: string;
  zoom: number;
  projects: ProjectSummary[];
  activeId: string | null;
  /** 等待二次确认删除的项目 id */
  confirmingDeleteId: string | null;
  /** 处于撤销窗口内的已删除项目 */
  trash: TrashEntry | null;
}
const defaultUi = (): ProjectUiState => ({ selectedId: null, zoom: 1 });
export const emptyState = (): MeterState => ({
  phase: "empty",
  project: null,
  issues: [],
  selectedId: null,
  notice: "",
  zoom: 1,
  projects: [],
  activeId: null,
  confirmingDeleteId: null,
  trash: null,
});
export { defaultUi };
