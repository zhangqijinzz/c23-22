import type { TrashEntry } from "../models";
import type { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";

export function UndoDeleteToast({
  trash,
  vm,
}: {
  trash: TrashEntry | null;
  vm: SubtitleMeterViewModel;
}) {
  if (!trash) return null;
  return (
    <div className="undo-toast" role="status">
      <span>
        已删除「{trash.project.name}」
        <small>其他项目的顺序与快照未受影响</small>
      </span>
      <button onClick={() => void vm.undoDelete()}>撤销删除</button>
    </div>
  );
}
