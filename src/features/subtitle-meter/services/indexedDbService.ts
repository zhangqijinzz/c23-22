import type {
  ProjectSummary,
  SubtitleProject,
  TrashedProject,
  WorkspaceMeta,
} from "../models";
import { detectIssues } from "../analyzers/issueDetector";
import { defaultUiState } from "../models";

const DB_NAME = "subtitle-meter-db",
  DB_VERSION = 2,
  PROJECT_STORE = "projects",
  META_STORE = "meta",
  TRASH_STORE = "trash",
  WORKSPACE_KEY = "workspace.v1",
  LEGACY_KEY = "subtitle-meter.current.v1";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE))
        db.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(META_STORE))
        db.createObjectStore(META_STORE);
      if (!db.objectStoreNames.contains(TRASH_STORE))
        db.createObjectStore(TRASH_STORE, { keyPath: "id" });
      migrateLegacyProject(request, event.oldVersion);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("本地存储不可用"));
  });
}

function isValidProject(value: unknown): value is SubtitleProject {
  const candidate = value as SubtitleProject | null;
  return Boolean(
    candidate &&
      typeof candidate.name === "string" &&
      Array.isArray(candidate.cues) &&
      Array.isArray(candidate.versions),
  );
}

/**
 * v1 只在 projects 仓库里保存单一项目（固定 key）。
 * 升级时给它一个稳定的新 id，原样写入工作区，并记录为当前项目。
 */
function migrateLegacyProject(request: IDBOpenDBRequest, oldVersion: number) {
  if (oldVersion >= 2 || request.transaction === null) return;
  const projects = request.transaction.objectStore(PROJECT_STORE);
  const getLegacy = projects.get(LEGACY_KEY);
  getLegacy.onsuccess = () => {
    if (!isValidProject(getLegacy.result)) return;
    const legacy = getLegacy.result,
      id = `project-${legacy.updatedAt || "legacy"}`;
    const migrated: SubtitleProject = { ...legacy, id };
    projects.put(migrated);
    if (legacy.id !== id) projects.delete(LEGACY_KEY);
    const meta: WorkspaceMeta = {
      order: [id],
      activeProjectId: id,
      uiState: {
        [id]: { ...defaultUiState(), selectedId: legacy.cues[0]?.id ?? null },
      },
    };
    request.transaction!.objectStore(META_STORE).put(meta, WORKSPACE_KEY);
  };
}

const defaultMeta = (): WorkspaceMeta => ({
  order: [],
  activeProjectId: null,
  uiState: {},
});

function readMeta(store: IDBObjectStore): Promise<WorkspaceMeta> {
  return new Promise((resolve, reject) => {
    const request = store.get(WORKSPACE_KEY);
    request.onsuccess = () => {
      const meta = request.result;
      if (
        meta &&
        Array.isArray(meta.order) &&
        typeof meta.uiState === "object" &&
        meta.uiState
      )
        resolve(meta as WorkspaceMeta);
      else resolve(defaultMeta());
    };
    request.onerror = () => reject(request.error);
  });
}

export function summarize(project: SubtitleProject): ProjectSummary {
  const issues = detectIssues(project.cues);
  return {
    id: project.id,
    name: project.name,
    cueCount: project.cues.length,
    issueCount: issues.length,
    status:
      issues.length === 0
        ? "clean"
        : issues.some((issue) => issue.severity === "error")
          ? "error"
          : "warning",
    updatedAt: project.updatedAt,
  };
}

export interface WorkspaceSnapshot {
  projects: SubtitleProject[];
  meta: WorkspaceMeta;
  trash: TrashedProject[];
}

/** 一次性载入整个工作区：项目（按 order 排序）、元数据、回收站。 */
export async function readWorkspace(): Promise<WorkspaceSnapshot> {
  const db = await openDb();
  try {
    return await new Promise<WorkspaceSnapshot>((resolve, reject) => {
      const transaction = db.transaction([
        PROJECT_STORE,
        META_STORE,
        TRASH_STORE,
      ]);
      transaction.onerror = () => reject(transaction.error);
      const projectsRequest = transaction.objectStore(PROJECT_STORE).getAll();
      projectsRequest.onsuccess = () => {};
      const metaRequest = readMeta(transaction.objectStore(META_STORE));
      const trashRequest = new Promise<TrashedProject[]>((resolveTrash) => {
        const request = transaction.objectStore(TRASH_STORE).getAll();
        request.onsuccess = () =>
          resolveTrash(
            (request.result as TrashedProject[]).sort(
              (a, b) => a.deletedAt - b.deletedAt,
            ),
          );
        request.onerror = () => resolveTrash([]);
      });
      transaction.oncomplete = async () => {
        const all = (projectsRequest.result as SubtitleProject[]).filter(
          isValidProject,
        );
        const meta = await metaRequest;
        const byId = new Map(all.map((project) => [project.id, project]));
        const ordered = [
          ...meta.order.filter((id) => byId.has(id)),
          // 元数据里缺失的项目（极端情况）追加在末尾，保证不丢数据。
          ...all
            .map((project) => project.id)
            .filter((id) => !meta.order.includes(id)),
        ].map((id) => byId.get(id)!);
        const trash = await trashRequest;
        resolve({ projects: ordered, meta, trash });
      };
    });
  } finally {
    db.close();
  }
}

export async function writeProject(project: SubtitleProject): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(PROJECT_STORE, "readwrite");
      transaction.objectStore(PROJECT_STORE).put(project);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("本地保存失败"));
    });
  } finally {
    db.close();
  }
}

export async function writeMeta(meta: WorkspaceMeta): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(META_STORE, "readwrite");
      transaction.objectStore(META_STORE).put(meta, WORKSPACE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("工作区保存失败"));
    });
  } finally {
    db.close();
  }
}

/**
 * 软删除：项目移入回收站并从工作区顺序移除，整个过程在一个事务里，
 * 其余项目的存储顺序与快照都不触碰。
 */
export async function moveProjectToTrash(entry: TrashedProject): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(
        [PROJECT_STORE, META_STORE, TRASH_STORE],
        "readwrite",
      );
      transaction.objectStore(PROJECT_STORE).delete(entry.project.id);
      transaction.objectStore(TRASH_STORE).put(entry);
      const metaStore = transaction.objectStore(META_STORE);
      const getMeta = metaStore.get(WORKSPACE_KEY);
      getMeta.onsuccess = () => {
        const meta: WorkspaceMeta = getMeta.result ?? defaultMeta();
        metaStore.put(
          {
            ...meta,
            order: meta.order.filter((id) => id !== entry.project.id),
            activeProjectId:
              meta.activeProjectId === entry.project.id
                ? null
                : meta.activeProjectId,
          },
          WORKSPACE_KEY,
        );
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("删除失败"));
    });
  } finally {
    db.close();
  }
}

/** 撤销删除：项目按记录的位置插回原顺序，快照原样恢复。 */
export async function restoreFromTrash(entry: TrashedProject): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(
        [PROJECT_STORE, META_STORE, TRASH_STORE],
        "readwrite",
      );
      transaction.objectStore(PROJECT_STORE).put(entry.project);
      transaction.objectStore(TRASH_STORE).delete(entry.id);
      const metaStore = transaction.objectStore(META_STORE);
      const getMeta = metaStore.get(WORKSPACE_KEY);
      getMeta.onsuccess = () => {
        const meta: WorkspaceMeta = getMeta.result ?? defaultMeta();
        const order = meta.order.filter((id) => id !== entry.project.id);
        order.splice(Math.min(entry.index, order.length), 0, entry.project.id);
        metaStore.put({ ...meta, order }, WORKSPACE_KEY);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("恢复失败"));
    });
  } finally {
    db.close();
  }
}

/** 彻底删除回收站条目（超过保留期或手动清空）。 */
export async function purgeTrashEntry(id: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(TRASH_STORE, "readwrite");
      transaction.objectStore(TRASH_STORE).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
