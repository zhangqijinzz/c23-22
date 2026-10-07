import type { SubtitleProject, TrashedProject, WorkspaceMeta } from "../models";
import {
  moveProjectToTrash,
  purgeTrashEntry,
  readWorkspace,
  restoreFromTrash,
  writeMeta,
  writeProject,
} from "../services/indexedDbService";

export const projectRepository = {
  loadWorkspace: readWorkspace,
  saveProject: (project: SubtitleProject) => writeProject(project),
  saveMeta: (meta: WorkspaceMeta) => writeMeta(meta),
  trashProject: (entry: TrashedProject) => moveProjectToTrash(entry),
  restoreTrashed: (entry: TrashedProject) => restoreFromTrash(entry),
  purgeTrashed: (id: string) => purgeTrashEntry(id),
};
