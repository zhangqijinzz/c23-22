import type {
  ProjectUiState,
  SubtitleProject,
  TrashEntry,
  WorkspaceMeta,
} from "../models";

const DB_NAME = "subtitle-meter-db",
  DB_VERSION = 2,
  STORE = "projects",
  META_KEY = "subtitle-meter.workspace.v1",
  LEGACY_KEY = "subtitle-meter.current.v1";

/** 软删除后保留撤销机会的时长，过期后在下次加载时彻底清除 */
export const TRASH_TTL_MS = 8000;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("本地存储不可用"));
  });
}

function isProject(value: unknown): value is SubtitleProject {
  const candidate = value as SubtitleProject | null;
  return (
    !!candidate &&
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    Array.isArray(candidate.cues) &&
    Array.isArray(candidate.versions)
  );
}

function isMeta(value: unknown): value is WorkspaceMeta {
  const candidate = value as WorkspaceMeta | null;
  return (
    !!candidate &&
    candidate.version === 1 &&
    Array.isArray(candidate.projectIds) &&
    typeof candidate.uiById === "object" &&
    candidate.uiById !== null
  );
}

type StoredMeta = WorkspaceMeta & { id: string };
const toStoredMeta = (meta: WorkspaceMeta): StoredMeta => ({
  ...meta,
  id: META_KEY,
});
function parseMeta(value: unknown): WorkspaceMeta | null {
  if (!isMeta(value)) return null;
  const candidate = value as StoredMeta;
  return {
    version: 1,
    projectIds: candidate.projectIds,
    activeId: candidate.activeId,
    uiById: candidate.uiById,
    lastDeleted: candidate.lastDeleted,
  };
}

function emptyMeta(): WorkspaceMeta {
  return {
    version: 1,
    projectIds: [],
    activeId: null,
    uiById: {},
    lastDeleted: null,
  };
}

export function createProjectId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return `p-${crypto.randomUUID()}`;
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function saveProject(project: SubtitleProject): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(project);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("本地保存失败"));
    };
  });
}

export async function deleteProjectRecord(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(id);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("本地删除失败"));
    };
  });
}

export interface WorkspaceSnapshot {
  meta: WorkspaceMeta;
  projects: SubtitleProject[];
}

/**
 * 读取工作区：
 * - 首次升级时把旧版单项目数据原样迁移为工作区中的第一个项目；
 * - 清理撤销窗口已过期、或项目本体已不存在的回收记录；
 * - 丢弃 meta 中找不到实体的悬空 id。
 */
export async function loadWorkspace(): Promise<WorkspaceSnapshot> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const [rawMeta, legacy] = await Promise.all([
    new Promise<WorkspaceMeta | null>((resolve, reject) => {
      const request = store.get(META_KEY);
      request.onsuccess = () => resolve(parseMeta(request.result));
      request.onerror = () => reject(request.error);
    }),
    new Promise<SubtitleProject | null>((resolve, reject) => {
      const request = store.get(LEGACY_KEY);
      request.onsuccess = () =>
        resolve(isProject(request.result) ? request.result : null);
      request.onerror = () => reject(request.error);
    }),
  ]);

  let meta: WorkspaceMeta;
  if (rawMeta) {
    meta = structuredClone(rawMeta);
  } else if (legacy) {
    // 旧的单项目数据自动成为工作区里的第一个项目，绝不丢弃
    const migrated: SubtitleProject = {
      ...structuredClone(legacy),
      id: createProjectId(),
    };
    const firstCue = migrated.cues[0]?.id ?? null;
    store.put(migrated);
    meta = {
      version: 1,
      projectIds: [migrated.id],
      activeId: migrated.id,
      uiById: { [migrated.id]: { selectedId: firstCue, zoom: 1 } },
      lastDeleted: null,
    };
  } else {
    meta = emptyMeta();
  }

  // 回收区过期清理；未过期但项目本体丢失也一并清除
  if (meta.lastDeleted) {
    const entry = meta.lastDeleted;
    const body = await new Promise<unknown>((resolve, reject) => {
      const request = store.get(entry.project.id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (Date.now() - entry.deletedAt > TRASH_TTL_MS || !isProject(body)) {
      if (isProject(body)) store.delete(entry.project.id);
      meta.lastDeleted = null;
    }
  }

  // 补齐 meta 中缺失的项目实体
  const projects: SubtitleProject[] = [];
  const existingIds = new Set<string>();
  for (const id of meta.projectIds) {
    const project = await new Promise<SubtitleProject | null>(
      (resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = () =>
          resolve(isProject(request.result) ? request.result : null);
        request.onerror = () => reject(request.error);
      },
    );
    if (project) {
      projects.push(project);
      existingIds.add(id);
    }
  }
  meta.projectIds = meta.projectIds.filter((id) => existingIds.has(id));
  for (const id of Object.keys(meta.uiById))
    if (!existingIds.has(id)) delete meta.uiById[id];
  if (meta.activeId && !existingIds.has(meta.activeId)) meta.activeId = null;

  store.put(toStoredMeta(meta));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return { meta, projects };
}

export async function saveWorkspaceMeta(meta: WorkspaceMeta): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(toStoredMeta(meta));
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("工作区保存失败"));
    };
  });
}

/** 将项目移入回收区：项目本体保留到撤销窗口结束，顺序信息记入 index */
export async function stashProject(
  meta: WorkspaceMeta,
  project: SubtitleProject,
  ui: ProjectUiState,
  index: number,
): Promise<void> {
  const entry: TrashEntry = {
    project,
    ui,
    index,
    deletedAt: Date.now(),
  };
  await saveWorkspaceMeta({ ...meta, lastDeleted: entry });
}

/** 撤销删除：返回更新后的 meta（项目记录本身从未被移除） */
export function restoreStashedProject(meta: WorkspaceMeta): WorkspaceMeta {
  const entry = meta.lastDeleted;
  if (!entry) return meta;
  const projectIds = meta.projectIds.filter((id) => id !== entry.project.id);
  const index = Math.max(0, Math.min(entry.index, projectIds.length));
  projectIds.splice(index, 0, entry.project.id);
  return {
    ...meta,
    projectIds,
    lastDeleted: null,
    activeId: entry.project.id,
    uiById: { ...meta.uiById, [entry.project.id]: entry.ui },
  };
}

/** 撤销窗口结束，真正删除项目本体 */
export async function purgeStashedProject(
  meta: WorkspaceMeta,
): Promise<WorkspaceMeta> {
  const entry = meta.lastDeleted;
  if (!entry) return meta;
  await deleteProjectRecord(entry.project.id);
  const cleared: WorkspaceMeta = { ...meta, lastDeleted: null };
  await saveWorkspaceMeta(cleared);
  return cleared;
}

/** 只删除回收项目本体，不改动 meta（调用方随后会写入新的回收记录） */
export async function purgeTrashBody(meta: WorkspaceMeta): Promise<void> {
  const entry = meta.lastDeleted;
  if (!entry) return;
  await deleteProjectRecord(entry.project.id);
}
