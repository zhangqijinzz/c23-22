import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";
import { readTextFile } from "../services/fileService";
import { downloadSubtitles } from "../services/exportService";
import type { SubtitleProject, WorkspaceMeta } from "../models";
import type { WorkspaceSnapshot } from "../services/indexedDbService";
import { restoreStashedProject } from "../services/indexedDbService";

vi.mock("../services/fileService", () => ({
  readTextFile: vi.fn(
    async () => "1\n00:00:01,000 --> 00:00:03,000\nOriginal caption",
  ),
}));

const snapshotStore = vi.hoisted(() => ({
  snapshot: null as WorkspaceSnapshot | null,
}));

vi.mock("../repositories/projectRepository", () => ({
  projectRepository: {
    loadWorkspace: vi.fn(
      async () =>
        snapshotStore.snapshot ?? {
          meta: {
            version: 1,
            projectIds: [],
            activeId: null,
            uiById: {},
            lastDeleted: null,
          },
          projects: [],
        },
    ),
    saveProject: vi.fn(async () => undefined),
    saveMeta: vi.fn(async () => undefined),
    stash: vi.fn(async () => undefined),
    unstash: vi.fn((meta: WorkspaceMeta) => restoreStashedProject(meta)),
    purge: vi.fn(async (meta: WorkspaceMeta) => ({
      ...meta,
      lastDeleted: null,
    })),
    purgeBody: vi.fn(async () => undefined),
  },
}));
vi.mock("../services/exportService", () => ({ downloadSubtitles: vi.fn() }));

const makeProject = (name: string): SubtitleProject => ({
  id: `id-${name}`,
  name,
  format: "srt",
  cues: [
    {
      id: `cue-${name}`,
      index: 1,
      startMs: 1000,
      endMs: 3000,
      text: name,
    },
  ],
  updatedAt: 1000,
  versions: [],
});

const workspaceWith = (
  projects: SubtitleProject[],
  activeId: string | null = null,
): WorkspaceSnapshot => ({
  meta: {
    version: 1,
    projectIds: projects.map((p) => p.id),
    activeId,
    uiById: Object.fromEntries(
      projects.map((p) => [
        p.id,
        { selectedId: p.cues[0]?.id ?? null, zoom: 1 },
      ]),
    ),
    lastDeleted: null,
  },
  projects,
});

describe("SubtitleMeterViewModel", () => {
  let vm: SubtitleMeterViewModel;
  beforeEach(() => {
    vi.clearAllMocks();
    snapshotStore.snapshot = null;
    vm = new SubtitleMeterViewModel();
  });

  it("imports, edits, rechecks, snapshots, and exports", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    expect(vm.state.phase).toBe("ready");
    expect(vm.state.projects).toHaveLength(1);
    const cue = vm.state.project!.cues[0];
    await vm.editCue(cue.id, { text: "Edited" });
    expect(vm.state.project!.cues[0].text).toBe("Edited");
    await vm.saveVersion();
    expect(vm.state.project!.versions).toHaveLength(1);
    await vm.exportFile();
    expect(vm.state.notice).toBe("字幕文件已导出");
  });

  it("imports a second project without overwriting the first", async () => {
    await vm.importFile(new File(["x"], "first.srt"));
    vi.mocked(readTextFile).mockResolvedValueOnce(
      "1\n00:00:01,000 --> 00:00:03,000\nSecond caption",
    );
    await vm.importFile(new File(["x"], "second.srt"));
    expect(vm.state.projects).toHaveLength(2);
    expect(vm.state.project!.name).toBe("second.srt");
    expect(vm.state.projects[0].name).toBe("first.srt");
  });

  it("keeps a recoverable error when an unsupported import is selected", async () => {
    await vm.importFile(new File(["x"], "clip.txt"));
    expect(vm.state.phase).toBe("error");
    expect(vm.state.notice).toContain("仅支持");
  });

  it("shows a parse failure as a recoverable import error", async () => {
    vi.mocked(readTextFile).mockResolvedValueOnce("not a subtitle block");
    await vm.importFile(new File(["x"], "clip.srt"));
    expect(vm.state.phase).toBe("error");
    expect(vm.state.notice).toContain("缺少时间码");
  });

  it("keeps editing visible immediately and reports export failures", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    const cue = vm.state.project!.cues[0];
    const saving = vm.editCue(cue.id, { text: "Immediate edit" });
    expect(vm.state.project!.cues[0].text).toBe("Immediate edit");
    await saving;
    vi.mocked(downloadSubtitles).mockImplementationOnce(() => {
      throw new Error("download unavailable");
    });
    await vm.exportFile();
    expect(vm.state.phase).toBe("error");
    expect(vm.state.notice).toContain("导出失败");
    expect(vm.state.project!.cues[0].text).toBe("Immediate edit");
  });

  it("restores the workspace and opens the previously active project", async () => {
    const a = makeProject("a.srt"),
      b = makeProject("b.srt");
    snapshotStore.snapshot = workspaceWith([a, b], b.id);
    await vm.restore();
    expect(vm.state.projects).toHaveLength(2);
    expect(vm.state.project?.id).toBe(b.id);
    expect(vm.state.selectedId).toBe("cue-b.srt");
  });

  it("switches projects with independent selection and zoom", async () => {
    const a = makeProject("a.srt"),
      b = makeProject("b.srt");
    snapshotStore.snapshot = workspaceWith([a, b]);
    await vm.restore();
    await vm.openProject(a.id);
    vm.selectCue("cue-a.srt");
    vm.setZoom(1.6);
    await vm.openProject(b.id);
    expect(vm.state.selectedId).toBe("cue-b.srt");
    expect(vm.state.zoom).toBe(1);
    // 切回 a 时编辑进度仍然保留
    await vm.openProject(a.id);
    expect(vm.state.selectedId).toBe("cue-a.srt");
    expect(vm.state.zoom).toBe(1.6);
  });

  it("requires confirmation then offers undo, keeping the remaining order", async () => {
    const a = makeProject("a.srt"),
      b = makeProject("b.srt"),
      c = makeProject("c.srt");
    snapshotStore.snapshot = workspaceWith([a, b, c], b.id);
    await vm.restore();
    vm.requestDelete(b.id);
    expect(vm.state.confirmingDeleteId).toBe(b.id);
    await vm.confirmDelete();
    expect(vm.state.projects.map((p) => p.name)).toEqual(["a.srt", "c.srt"]);
    expect(vm.state.trash?.project.name).toBe("b.srt");
    expect(vm.state.activeId).toBeNull();
    await vm.undoDelete();
    expect(vm.state.projects.map((p) => p.name)).toEqual([
      "a.srt",
      "b.srt",
      "c.srt",
    ]);
    expect(vm.state.project?.id).toBe(b.id);
    expect(vm.state.trash).toBeNull();
  });

  it("cancel leaves every project untouched", async () => {
    const a = makeProject("a.srt");
    snapshotStore.snapshot = workspaceWith([a], a.id);
    await vm.restore();
    vm.requestDelete(a.id);
    vm.cancelDelete();
    expect(vm.state.confirmingDeleteId).toBeNull();
    expect(vm.state.projects).toHaveLength(1);
    expect(vm.state.trash).toBeNull();
  });
});
