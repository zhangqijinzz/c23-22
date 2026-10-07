import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { SubtitleProject } from "../models";
import {
  moveProjectToTrash,
  readWorkspace,
  restoreFromTrash,
  summarize,
  writeProject,
} from "../services/indexedDbService";

const makeProject = (id: string, name = "sample.srt"): SubtitleProject => ({
  id,
  name,
  format: "srt",
  cues: [
    { id: `${id}-cue-1`, index: 1, startMs: 100, endMs: 2000, text: "Saved" },
  ],
  updatedAt: 1,
  versions: [],
});

describe("IndexedDB workspace storage", () => {
  beforeEach(
    async () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase("subtitle-meter-db");
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      }),
  );

  it("migrates the legacy single project into the first workspace project", async () => {
    // 模拟 v1 结构：projects 仓库里固定 key 的单项目。
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("subtitle-meter-db", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("projects", { keyPath: "id" });
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("projects", "readwrite");
        transaction.objectStore("projects").put({
          ...makeProject("subtitle-meter.current.v1", "legacy.srt"),
        });
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });

    const { projects, meta } = await readWorkspace();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("legacy.srt");
    expect(projects[0].id).not.toBe("subtitle-meter.current.v1");
    expect(meta.order).toEqual([projects[0].id]);
    expect(meta.activeProjectId).toBe(projects[0].id);
    // 内容（条目与快照）完整保留
    expect(projects[0].cues[0].text).toBe("Saved");
  });

  it("keeps project order stable when another project is removed", async () => {
    const a = makeProject("project-a", "a.srt"),
      b = makeProject("project-b", "b.srt"),
      c = makeProject("project-c", "c.srt");
    await Promise.all([writeProject(a), writeProject(b), writeProject(c)]);
    const { meta } = await readWorkspace();
    // 初始顺序由迁移/写入顺序决定，这里显式设置 a,b,c
    meta.order = ["project-a", "project-b", "project-c"];
    const { writeMeta } = await import("../services/indexedDbService");
    await writeMeta(meta);

    await moveProjectToTrash({
      id: "trash-b",
      project: b,
      index: 1,
      deletedAt: Date.now(),
    });

    const after = await readWorkspace();
    expect(after.projects.map((p) => p.id)).toEqual(["project-a", "project-c"]);
    expect(after.trash).toHaveLength(1);

    await restoreFromTrash(after.trash[0]);
    const restored = await readWorkspace();
    expect(restored.projects.map((p) => p.id)).toEqual([
      "project-a",
      "project-b",
      "project-c",
    ]);
  });

  it("summarizes cue count, issue count and status", () => {
    const clean = makeProject("p");
    expect(summarize(clean)).toMatchObject({
      cueCount: 1,
      issueCount: 0,
      status: "clean",
    });
    const broken: SubtitleProject = {
      ...clean,
      cues: [{ ...clean.cues[0], text: "" }],
    };
    expect(summarize(broken).status).toBe("error");
    expect(summarize(broken).issueCount).toBeGreaterThan(0);
  });
});
