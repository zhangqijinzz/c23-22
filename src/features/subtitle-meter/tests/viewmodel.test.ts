import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";
import { readTextFile } from "../services/fileService";
import { downloadSubtitles } from "../services/exportService";

const parsed = "1\n00:00:01,000 --> 00:00:03,000\nOriginal caption";

vi.mock("../services/fileService", () => ({
  readTextFile: vi.fn(async () => parsed),
}));

const storage = vi.hoisted(() => ({
  workspace: null as null | {
    projects: import("../models").SubtitleProject[];
    meta: import("../models").WorkspaceMeta;
    trash: import("../models").TrashedProject[];
  },
}));

vi.mock("../repositories/projectRepository", () => ({
  projectRepository: {
    loadWorkspace: vi.fn(async () => storage.workspace),
    saveProject: vi.fn(async () => undefined),
    saveMeta: vi.fn(async () => undefined),
    trashProject: vi.fn(async () => undefined),
    restoreTrashed: vi.fn(async () => undefined),
    purgeTrashed: vi.fn(async () => undefined),
  },
}));

vi.mock("../services/exportService", () => ({ downloadSubtitles: vi.fn() }));

describe("SubtitleMeterViewModel", () => {
  let vm: SubtitleMeterViewModel;
  beforeEach(() => {
    storage.workspace = {
      projects: [],
      meta: { order: [], activeProjectId: null, uiState: {} },
      trash: [],
    };
    vm = new SubtitleMeterViewModel();
  });

  it("imports, edits, rechecks, snapshots, and exports", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    expect(vm.state.phase).toBe("ready");
    expect(vm.state.view).toBe("editor");
    const cue = vm.state.project!.cues[0];
    await vm.editCue(cue.id, { text: "Edited" });
    expect(vm.state.project!.cues[0].text).toBe("Edited");
    await vm.saveVersion();
    expect(vm.state.project!.versions).toHaveLength(1);
    await vm.exportFile();
    expect(vm.state.notice).toBe("字幕文件已导出");
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

  it("keeps selection, zoom and tab independent across projects", async () => {
    await vm.importFile(new File(["x"], "a.srt"));
    const a = vm.state.project!;
    await vm.editCue(a.cues[0].id, { text: "A edited" });
    await vm.saveVersion();
    vm.selectCue(a.cues[0].id);
    vm.setZoom(1.6);
    vm.setActiveTab("delivery");
    await vm.backToWorkspace();

    await vm.importFile(new File(["x"], "b.srt"));
    const b = vm.state.project!;
    expect(b.id).not.toBe(a.id);
    // 新项目从默认进度开始
    expect(vm.state.zoom).toBe(1);
    expect(vm.state.activeTab).toBe("timeline");
    expect(vm.state.selectedId).toBe(b.cues[0].id);

    // 切回旧项目，恢复各自进度
    vm.openProject(a.id);
    expect(vm.state.selectedId).toBe(a.cues[0].id);
    expect(vm.state.zoom).toBe(1.6);
    expect(vm.state.activeTab).toBe("delivery");
    // 快照属于各自项目
    expect(vm.state.project!.versions).toHaveLength(1);
    vm.openProject(b.id);
    expect(vm.state.project!.versions).toHaveLength(0);
  });

  it("lists projects with cue and issue counts and filters by status and name", async () => {
    await vm.importFile(new File(["x"], "clean.srt"));
    await vm.backToWorkspace();
    await vm.importFile(new File(["x"], "broken.srt"));
    await vm.backToWorkspace();

    expect(vm.state.summaries).toHaveLength(2);
    expect(vm.state.summaries[0].name).toBe("broken.srt");

    vm.setQuery("clean");
    expect(vm.state.summaries.length).toBe(2); // 源数据不变
    expect(vm.getFiltered().map((s) => s.name)).toEqual(["clean.srt"]);
    vm.setQuery("");
    vm.setFilter("error");
    expect(vm.getFiltered().every((s) => s.status === "error")).toBe(true);
    vm.setFilter("all");
  });

  it("requires confirmation before delete and offers undo that restores order", async () => {
    await vm.importFile(new File(["x"], "a.srt"));
    const a = vm.state.project!;
    await vm.backToWorkspace();
    await vm.importFile(new File(["x"], "b.srt"));
    const b = vm.state.project!;
    await vm.backToWorkspace();

    // 第一步：仅进入确认态，不删除
    vm.requestDelete(a.id);
    expect(vm.state.confirmingDeleteId).toBe(a.id);
    expect(vm.state.summaries).toHaveLength(2);
    vm.cancelDelete();
    expect(vm.state.confirmingDeleteId).toBeNull();

    // 确认后软删除：列表少一项，进入回收站并给出撤销
    await vm.confirmDelete(a.id);
    expect(vm.state.summaries.map((s) => s.id)).toEqual([b.id]);
    expect(vm.state.pendingDelete).not.toBeNull();
    expect(vm.state.trash).toHaveLength(1);
    // b 的快照不受影响
    expect(vm.state.summaries).toHaveLength(1);

    // 撤销：a 连同快照回到列表，顺序与删除前完全一致
    const orderBefore = [b.id, a.id];
    await vm.undoDelete();
    expect(vm.state.summaries.map((s) => s.id)).toEqual(orderBefore);
    expect(vm.state.pendingDelete).toBeNull();
  });
});
