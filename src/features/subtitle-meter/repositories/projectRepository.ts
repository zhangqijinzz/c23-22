import {
  loadWorkspace,
  purgeStashedProject,
  purgeTrashBody,
  restoreStashedProject,
  saveProject,
  saveWorkspaceMeta,
  stashProject,
  type WorkspaceSnapshot,
} from "../services/indexedDbService";
import type { ProjectUiState, SubtitleProject, WorkspaceMeta } from "../models";

export const projectRepository = {
  loadWorkspace,
  saveProject,
  saveMeta: saveWorkspaceMeta,
  stash(
    meta: WorkspaceMeta,
    project: SubtitleProject,
    ui: ProjectUiState,
    index: number,
  ) {
    return stashProject(meta, project, ui, index);
  },
  unstash: restoreStashedProject,
  purge: purgeStashedProject,
  purgeBody: purgeTrashBody,
};

export type { WorkspaceSnapshot };
