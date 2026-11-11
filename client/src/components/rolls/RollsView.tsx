import React, { useState } from 'react';
import type { Camera, FilmStock, RollSummary } from '@catenicus/shared';
import { api } from '../../api/client';
import { formatHalfStops } from '../../utils/exposureMath';
import {
  Film,
  Plus,
  Camera as CameraIcon,
  ArrowRight,
  RotateCcw,
  FolderOpen
} from 'lucide-react';

interface RollsViewProps {
  rolls: RollSummary[];
  cameras: Camera[];
  filmStocks: FilmStock[];
  activeRollId: string | null;
  onSelectActiveRoll: (rollId: string) => void;
  onOpenRollInLab: (rollId: string) => void;
  onRefresh: () => void;
}

const ISO_CHOICES = [25, 50, 100, 125, 160, 200, 400, 800, 1600, 3200, 6400];

export const RollsView: React.FC<RollsViewProps> = ({
  rolls,
  cameras,
  filmStocks,
  activeRollId,
  onSelectActiveRoll,
  onOpenRollInLab,
  onRefresh
}) => {
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [selectedCameraId, setSelectedCameraId] = useState<string>(cameras[0]?.id || '');
  const [selectedStockId, setSelectedStockId] = useState<string>(filmStocks[0]?.id || '');
  const [ratedIso, setRatedIso] = useState<number>(400);
  const [rollTitle, setRollTitle] = useState<string>('');
  const [labNotes, setLabNotes] = useState<string>('');
  const [isCreating, setIsCreating] = useState(false);

  const selectedStock = filmStocks.find((s) => s.id === selectedStockId);

  const handleStockChange = (stockId: string) => {
    setSelectedStockId(stockId);
    const st = filmStocks.find((s) => s.id === stockId);
    if (st) setRatedIso(st.boxIso);
  };

  const handleCreateRoll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStockId) return;
    setIsCreating(true);
    try {
      const created = await api.createRoll({
        title: rollTitle.trim() || undefined,
        cameraId: selectedCameraId || null,
        filmStockId: selectedStockId,
        ratedIso,
        labNotes: labNotes.trim() || undefined,
        autoUnloadExisting: true
      });
      setShowLoadModal(false);
      setRollTitle('');
      setLabNotes('');
      onRefresh();
      onSelectActiveRoll(created.id);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleStatusChange = async (roll: RollSummary, nextStatus: RollSummary['status']) => {
    await api.updateRoll(roll.id, { status: nextStatus });
    onRefresh();
  };

  const loadedRolls = rolls.filter((r) => r.status === 'loaded');
  const finishedRolls = rolls.filter((r) => r.status !== 'loaded');

  const pushPullPreview = selectedStock
    ? Math.round(Math.log2(ratedIso / selectedStock.boxIso) * 2) / 2
    : 0;

  return (
    <div className="flex flex-col gap-4 pb-8">
      {/* Header & Load New Roll CTA */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-zinc-100">Active & Archived Film Rolls</h2>
          <p className="text-xs text-zinc-400">
            Stored in SQLite <code className="text-emerald-400">rolls</code> table with foreign keys to <code className="text-emerald-400">cameras</code> & <code className="text-emerald-400">film_stocks</code>
          </p>
        </div>
        <button
          onClick={() => {
            if (cameras[0] && !selectedCameraId) setSelectedCameraId(cameras[0].id);
            if (filmStocks[0] && !selectedStockId) {
              setSelectedStockId(filmStocks[0].id);
              setRatedIso(filmStocks[0].boxIso);
            }
            setShowLoadModal(true);
          }}
          className="px-3.5 py-2 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-zinc-950 font-bold text-xs flex items-center gap-1.5 shadow shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Load New Roll</span>
        </button>
      </div>

      {/* Currently Loaded Rolls Section */}
      <div className="flex flex-col gap-2.5">
        <div className="text-xs font-mono uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
          <Film className="w-3.5 h-3.5" />
          <span>Currently Loaded in Cameras ({loadedRolls.length})</span>
        </div>

        {loadedRolls.length === 0 ? (
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 text-center text-xs text-zinc-400">
            No rolls currently loaded. Tap <strong>Load New Roll</strong> to assign film to a camera.
          </div>
        ) : (
          loadedRolls.map((roll) => {
            const isSelectedForMeter = roll.id === activeRollId;
            return (
              <div
                key={roll.id}
                className={`rounded-2xl p-4 border transition ${
                  isSelectedForMeter
                    ? 'bg-zinc-900 border-emerald-400/70 shadow-lg shadow-emerald-500/5'
                    : 'bg-zinc-900/70 border-zinc-800'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">
                        ROLL #{String(roll.rollNumber).padStart(3, '0')}
                      </span>
                      <span className="text-sm font-bold text-zinc-100">{roll.title}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-zinc-300 mt-1.5">
                      <CameraIcon className="w-3.5 h-3.5 text-zinc-400" />
                      <span className="font-medium">{roll.cameraName || 'Unassigned Body'}</span>
                      <span className="text-zinc-600">•</span>
                      <span className="text-emerald-400 font-semibold">
                        {roll.filmBrand} {roll.filmName}
                      </span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                        {roll.filmProcess}
                      </span>
                    </div>
                  </div>

                  {/* Shot ISO vs Box ISO Pill */}
                  <div className="text-right shrink-0 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5">
                    <div className="text-[10px] font-mono uppercase text-zinc-400">Rated ISO</div>
                    <div className="text-base font-mono font-bold text-zinc-100">EI {roll.ratedIso}</div>
                    <div className="text-[10px] font-mono text-emerald-400">
                      {roll.pushPullStops === 0
                        ? `Box ${roll.boxIso}`
                        : `${roll.pushPullStops > 0 ? 'Push ' : 'Pull '}${formatHalfStops(roll.pushPullStops)} (Box ${roll.boxIso})`}
                    </div>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="mt-3">
                  <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 mb-1">
                    <span>
                      Frames Logged: <strong className="text-zinc-200">{roll.frameCount}</strong> / {roll.maxFrames}
                    </span>
                    <span className="truncate max-w-[200px] text-zinc-500" title={roll.folderName}>
                      NAS: {roll.folderName}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-zinc-950 rounded-full overflow-hidden border border-zinc-800">
                    <div
                      className="h-full bg-emerald-400 transition-all"
                      style={{
                        width: `${Math.min(100, (roll.frameCount / Math.max(1, roll.maxFrames)) * 100)}%`
                      }}
                    />
                  </div>
                </div>

                {roll.labNotes && (
                  <p className="mt-2 text-xs text-emerald-200/80 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2.5 py-1.5">
                    Note: {roll.labNotes}
                  </p>
                )}

                {/* Roll Actions */}
                <div className="mt-3 pt-3 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onSelectActiveRoll(roll.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
                        isSelectedForMeter
                          ? 'bg-emerald-400 text-zinc-950'
                          : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                      }`}
                    >
                      <span>{isSelectedForMeter ? 'Active in Meter' : 'Meter This Roll'}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => onOpenRollInLab(roll.id)}
                      className="px-3 py-1.5 rounded-xl text-xs bg-zinc-950 border border-zinc-800 text-zinc-300 hover:border-zinc-700"
                    >
                      Inspect Frames ({roll.frameCount})
                    </button>
                  </div>

                  <button
                    onClick={() => handleStatusChange(roll, 'rewound')}
                    className="px-2.5 py-1.5 rounded-xl text-xs font-mono text-zinc-400 hover:text-emerald-300 bg-zinc-950 border border-zinc-800 flex items-center gap-1"
                    title="Rewind roll and free up the camera body"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Rewind / Unload</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Rewound / At Lab / Scanned Rolls */}
      <div className="flex flex-col gap-2.5 mt-2">
        <div className="text-xs font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
          <FolderOpen className="w-3.5 h-3.5" />
          <span>Rewound, At Lab & Scanned Archive ({finishedRolls.length})</span>
        </div>

        {finishedRolls.length === 0 ? (
          <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-2xl p-4 text-xs text-zinc-500">
            Rewound rolls awaiting lab scans or EXIF matching will appear here.
          </div>
        ) : (
          finishedRolls.map((roll) => (
            <div
              key={roll.id}
              className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-3.5 flex flex-col gap-2.5"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-zinc-400">
                      #{String(roll.rollNumber).padStart(3, '0')}
                    </span>
                    <span className="text-sm font-semibold text-zinc-100">{roll.title}</span>
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-zinc-800 text-emerald-300">
                      {roll.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-400 mt-0.5">
                    {roll.cameraName || 'Camera'} • {roll.filmBrand} {roll.filmName} @ EI {roll.ratedIso} (Box {roll.boxIso}) • {roll.frameCount} frames ({roll.scannedCount} scanned)
                  </div>
                </div>

                <button
                  onClick={() => onOpenRollInLab(roll.id)}
                  className="px-3 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold shrink-0"
                >
                  Open Lab & Scans
                </button>
              </div>

              <div className="flex items-center gap-1.5 pt-2 border-t border-zinc-800/60 text-[11px]">
                <span className="text-zinc-500 mr-1">Stage:</span>
                {(['loaded', 'rewound', 'at_lab', 'scanned'] as const).map((st) => (
                  <button
                    key={st}
                    onClick={() => handleStatusChange(roll, st)}
                    className={`px-2 py-0.5 rounded font-mono ${
                      roll.status === st
                        ? 'bg-emerald-400 text-zinc-950 font-bold'
                        : 'bg-zinc-950 text-zinc-400 border border-zinc-800'
                    }`}
                  >
                    {st.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Load New Roll Modal */}
      {showLoadModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3">
          <form
            onSubmit={handleCreateRoll}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5 w-full max-w-md flex flex-col gap-3.5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-zinc-100">Load Film Roll into Camera</h3>
              <button
                type="button"
                onClick={() => setShowLoadModal(false)}
                className="text-xs text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
            </div>

            <div>
              <label className="text-xs text-zinc-400 block mb-1">Camera Body</label>
              <select
                value={selectedCameraId}
                onChange={(e) => setSelectedCameraId(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs text-zinc-100"
              >
                {cameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.format}) {c.activeRoll ? `[Loaded: ${c.activeRoll.filmName}]` : '[Empty]'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-zinc-400 block mb-1">Film Stock</label>
              <select
                value={selectedStockId}
                onChange={(e) => handleStockChange(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs text-zinc-100"
              >
                {filmStocks.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.brand} {s.name} — Box ISO {s.boxIso} ({s.process})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-zinc-400">Shot / Rated ISO (EI)</span>
                {selectedStock && (
                  <span className="font-mono text-emerald-400">
                    {pushPullPreview === 0
                      ? `Box Speed (${selectedStock.boxIso})`
                      : `${pushPullPreview > 0 ? 'Push ' : 'Pull '}${formatHalfStops(pushPullPreview)}`}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
                {ISO_CHOICES.map((iso) => (
                  <button
                    type="button"
                    key={iso}
                    onClick={() => setRatedIso(iso)}
                    className={`px-2.5 py-1.5 rounded-lg font-mono text-xs shrink-0 border ${
                      ratedIso === iso
                        ? 'bg-emerald-400 text-zinc-950 font-bold border-emerald-300'
                        : 'bg-zinc-950 text-zinc-300 border-zinc-800'
                    }`}
                  >
                    {iso}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-zinc-400 block mb-1">Roll Title / Location</label>
              <input
                type="text"
                value={rollTitle}
                onChange={(e) => setRollTitle(e.target.value)}
                placeholder="e.g. Big Sur Coast Weekend"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100"
              />
            </div>

            <div>
              <label className="text-xs text-zinc-400 block mb-1">Development / Shooting Notes</label>
              <input
                type="text"
                value={labNotes}
                onChange={(e) => setLabNotes(e.target.value)}
                placeholder="e.g. Tell lab +1 stop push, metered for shadows"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100"
              />
            </div>

            <button
              type="submit"
              disabled={isCreating}
              className="w-full py-3 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-zinc-950 font-bold text-xs mt-1"
            >
              {isCreating ? 'Inserting SQL Row & Creating NAS Folder...' : 'Load Roll & Save to SQLite'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
