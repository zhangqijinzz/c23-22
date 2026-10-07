import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { SubtitleProject } from "../models";
import {
  createProjectId,
  loadWorkspace,
  purgeStashedProject,
  restoreStashedProject,
  saveProject,
  saveWorkspaceMeta,
  TRASH_TTL_MS,
} from "../services/indexedDbService";
import type { WorkspaceMeta } from "../models";

const legacy: SubtitleProject = {
  id: "subtitle-meter.current.v1",
  name: "legacy.srt",
  format: "srt",
  cues: [{ id: "cue-1", index: 1, startMs: 100, endMs: 2000, text: "Legacy" }],
  updatedAt: 1,
  versions: [],
};

const makeProject = (name: string): SubtitleProject => ({
  id: createProjectId(),
  name,
  format: "srt",
  cues: [
    { id: `${name}-1`, index: 1, startMs: 100, endMs: 2000, text: "Saved" },
  ],
  updatedAt: Date.now(),
  versions: [],
});

const putRaw = async (record: object) => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("subtitle-meter-db", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("projects"))
        request.result.createObjectStore("projects", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("projects", "readwrite");
    transaction.objectStore("projects").put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
};

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("subtitle-meter-db");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
});

describe("IndexedDB workspace storage", () => {
  it("starts from an empty workspace", async () => {
    const { meta, projects } = await loadWorkspace();
    expect(meta.projectIds).toEqual([]);
    expect(projects).toEqual([]);
  });

  it("migrates the legacy single-project record into the first project", async () => {
    await putRaw(legacy);
    const first = await loadWorkspace();
    expect(first.projects).toHaveLength(1);
    expect(first.projects[0].name).toBe("legacy.srt");
    expect(first.projects[0].id).not.toBe("subtitle-meter.current.v1");
    expect(first.meta.projectIds).toEqual([first.projects[0].id]);
    expect(first.meta.activeId).toBe(first.projects[0].id);
    expect(first.meta.uiById[first.projects[0].id].selectedId).toBe("cue-1");
    // 旧数据在迁移后仍然保留，绝不丢失
    const again = await loadWorkspace();
    expect(again.projects).toHaveLength(1);
    expect(again.projects[0].name).toBe("legacy.srt");
  });

  it("keeps several projects in the order stored by the workspace", async () => {
    const a = makeProject("a.srt"),
      b = makeProject("b.srt"),
      c = makeProject("c.srt");
    await Promise.all([saveProject(a), saveProject(b), saveProject(c)]);
    const meta: WorkspaceMeta = {
      version: 1,
      projectIds: [c.id, a.id, b.id],
      activeId: a.id,
      uiById: {
        [a.id]: { selectedId: "a-1", zoom: 1.4 },
        [b.id]: { selectedId: null, zoom: 1 },
        [c.id]: { selectedId: "c-1", zoom: 1 },
      },
      lastDeleted: null,
    };
    await saveWorkspaceMeta(meta);
    const loaded = await loadWorkspace();
    expect(loaded.projects.map((p) => p.name)).toEqual([
      "c.srt",
      "a.srt",
      "b.srt",
    ]);
    expect(loaded.meta.activeId).toBe(a.id);
    expect(loaded.meta.uiById[a.id].zoom).toBe(1.4);
  });

  it("drops dangling ids but keeps the remaining project order", async () => {
    const a = makeProject("a.srt");
    await saveProject(a);
    await saveWorkspaceMeta({
      version: 1,
      projectIds: ["missing", a.id],
      activeId: "missing",
      uiById: { missing: { selectedId: null, zoom: 1 } },
      lastDeleted: null,
    });
    const loaded = await loadWorkspace();
    expect(loaded.meta.projectIds).toEqual([a.id]);
    expect(loaded.meta.activeId).toBeNull();
    expect(loaded.meta.uiById).not.toHaveProperty("missing");
  });

  it("restores a stashed project to its original position", async () => {
    const a = makeProject("a.srt"),
      b = makeProject("b.srt"),
      c = makeProject("c.srt");
    await Promise.all([saveProject(a), saveProject(b), saveProject(c)]);
    const meta: WorkspaceMeta = {
      version: 1,
      projectIds: [b.id],
      activeId: null,
      uiById: {},
      lastDeleted: {
        project: a,
        ui: { selectedId: "a-1", zoom: 1 },
        index: 0,
        deletedAt: Date.now(),
      },
    };
    const restored = restoreStashedProject(meta);
    expect(restored.projectIds).toEqual([a.id, b.id]);
    expect(restored.activeId).toBe(a.id);
    expect(restored.uiById[a.id].selectedId).toBe("a-1");
  });

  it("purges an expired trash entry on load but keeps a fresh one", async () => {
    const a = makeProject("a.srt"),
      b = makeProject("b.srt");
    await Promise.all([saveProject(a), saveProject(b)]);
    await saveWorkspaceMeta({
      version: 1,
      projectIds: [b.id],
      activeId: null,
      uiById: {},
      lastDeleted: {
        project: a,
        ui: { selectedId: null, zoom: 1 },
        index: 0,
        deletedAt: Date.now() - TRASH_TTL_MS - 100,
      },
    });
    const loaded = await loadWorkspace();
    expect(loaded.meta.lastDeleted).toBeNull();
    expect(loaded.projects.map((p) => p.id)).toEqual([b.id]);
    const purged = await purgeStashedProject(loaded.meta);
    expect(purged.lastDeleted).toBeNull();
  });
});
