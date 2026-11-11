import React, { useEffect, useState } from 'react';
import type { RollSummary, RollDetail, Frame } from '@catenicus/shared';
import { api } from '../../api/client';
import { formatHalfStops } from '../../utils/exposureMath';
import {
  Upload,
  Download,
  MapPin,
  Star,
  CheckCircle2,
  Wand2
} from 'lucide-react';

interface LabCompareViewProps {
  rolls: RollSummary[];
  selectedRollId: string | null;
  onSelectRollId: (id: string) => void;
  onDataUpdated: () => void;
}

export const LabCompareView: React.FC<LabCompareViewProps> = ({
  rolls,
  selectedRollId,
  onSelectRollId,
  onDataUpdated
}) => {
  const [rollDetail, setRollDetail] = useState<RollDetail | null>(null);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [splitPercent, setSplitPercent] = useState<number>(50);
  const [uploadingFrameId, setUploadingFrameId] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState<string>('');
  const [editRating, setEditRating] = useState<number>(0);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const activeId = selectedRollId || rolls[0]?.id || null;

  const loadDetail = async (id: string) => {
    const detail = await api.getRollDetail(id);
    setRollDetail(detail);
    if (detail.frames.length > 0) {
      const stillValid = detail.frames.find((f) => f.id === selectedFrameId);
      const target = stillValid || detail.frames[detail.frames.length - 1];
      setSelectedFrameId(target.id);
      setEditNotes(target.notes || '');
      setEditRating(target.learningRating || 0);
    } else {
      setSelectedFrameId(null);
    }
  };

  useEffect(() => {
    if (activeId) {
      loadDetail(activeId);
    }
  }, [activeId, rolls]);

  const selectedFrame: Frame | null =
    rollDetail?.frames.find((f) => f.id === selectedFrameId) || null;

  const handleSelectFrame = (f: Frame) => {
    setSelectedFrameId(f.id);
    setEditNotes(f.notes || '');
    setEditRating(f.learningRating || 0);
  };

  const handleFileUpload = async (frame: Frame, file: File) => {
    setUploadingFrameId(frame.id);
    try {
      await api.uploadFrameScan(frame.id, file);
      if (activeId) await loadDetail(activeId);
      onDataUpdated();
      setSaveNotice(`Uploaded scan & baked EXIF metadata into scans_tagged/frame-${String(frame.frameNumber).padStart(2, '0')}_tagged.jpg`);
      setTimeout(() => setSaveNotice(null), 4500);
    } catch (err: any) {
      alert(`Failed to upload scan: ${err.message}`);
    } finally {
      setUploadingFrameId(null);
    }
  };

  const handleSimulateFilmScan = async (frame: Frame) => {
    if (!rollDetail) return;
    setUploadingFrameId(frame.id);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const ctx = canvas.getContext('2d')!;

      const isBw = rollDetail.filmStock.colorType === 'bw';

      if (frame.refImageUrl) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = frame.refImageUrl!;
        });
        ctx.filter = isBw
          ? 'grayscale(100%) contrast(125%) brightness(104%)'
          : 'sepia(22%) saturate(135%) contrast(108%) brightness(103%)';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx.filter = 'none';
      } else {
        const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        grad.addColorStop(0, isBw ? '#d4d4d8' : '#a7f3d0');
        grad.addColorStop(0.5, isBw ? '#52525b' : '#34d399');
        grad.addColorStop(1, '#18181b');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.strokeStyle = '#09090b';
      ctx.lineWidth = 28;
      ctx.strokeRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#34d399';
      ctx.font = 'bold 14px ui-monospace, monospace';
      ctx.fillText(
        `${rollDetail.filmStock.brand.toUpperCase()} ${rollDetail.filmStock.name.toUpperCase()}   ▶ ${frame.frameNumber}A`,
        24,
        19
      );

      const scanDataUrl = canvas.toDataURL('image/jpeg', 0.92);
      await api.uploadFrameScanDataUrl(frame.id, scanDataUrl);
      if (activeId) await loadDetail(activeId);
      onDataUpdated();
      setSaveNotice(
        `Baked EXIF (${rollDetail.camera?.name || 'Camera'}, EI ${rollDetail.ratedIso}, ${frame.shutterSpeed}s f/${frame.aperture}) into NAS scans_tagged/`
      );
      setTimeout(() => setSaveNotice(null), 4500);
    } catch (err: any) {
      alert(`Simulation failed: ${err.message}`);
    } finally {
      setUploadingFrameId(null);
    }
  };

  const handleSaveLearningNotes = async () => {
    if (!selectedFrame || !activeId) return;
    await api.updateFrame(selectedFrame.id, {
      notes: editNotes,
      learningRating: editRating || null
    });
    await loadDetail(activeId);
    setSaveNotice('Saved frame notes to SQLite frames table & updated NAS manifest');
    setTimeout(() => setSaveNotice(null), 3000);
  };

  return (
    <div className="flex flex-col gap-4 pb-8">
      {/* Roll Picker Bar */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-mono uppercase text-emerald-400">Lab & Metadata Mapper</div>
          <select
            value={activeId || ''}
            onChange={(e) => onSelectRollId(e.target.value)}
            className="mt-0.5 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-100 font-semibold max-w-full"
          >
            {rolls.map((r) => (
              <option key={r.id} value={r.id}>
                Roll #{String(r.rollNumber).padStart(3, '0')} — {r.title} ({r.filmName} @ EI {r.ratedIso}) [{r.frameCount} frames]
              </option>
            ))}
          </select>
        </div>

        {rollDetail && (
          <div className="text-right shrink-0 font-mono text-xs">
            <div className="text-zinc-300">{rollDetail.camera?.name || 'Unassigned'}</div>
            <div className="text-[11px] text-emerald-400">
              EI {rollDetail.ratedIso} (Box {rollDetail.boxIso})
            </div>
          </div>
        )}
      </div>

      {saveNotice && (
        <div className="bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 rounded-xl p-3 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{saveNotice}</span>
        </div>
      )}

      {/* Frame Strip Selector */}
      {rollDetail && rollDetail.frames.length > 0 ? (
        <>
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
            {rollDetail.frames.map((f) => {
              const isSelected = f.id === selectedFrame?.id;
              return (
                <button
                  key={f.id}
                  onClick={() => handleSelectFrame(f)}
                  className={`px-3 py-2 rounded-xl border text-left shrink-0 transition flex flex-col gap-0.5 ${
                    isSelected
                      ? 'bg-emerald-400 text-zinc-950 border-emerald-300 font-bold'
                      : 'bg-zinc-900 border-zinc-800 text-zinc-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs font-mono">
                    <span>Frame #{f.frameNumber}</span>
                    {f.scanImageUrl && (
                      <span
                        className={`w-2 h-2 rounded-full ${
                          isSelected ? 'bg-zinc-950' : 'bg-emerald-400'
                        }`}
                        title="Film Scan Attached & EXIF Tagged"
                      />
                    )}
                  </div>
                  <div className={`text-[10px] font-mono ${isSelected ? 'text-zinc-900' : 'text-zinc-400'}`}>
                    {f.shutterSpeed}s • f/{f.aperture}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Selected Frame Comparison & EXIF Inspector */}
          {selectedFrame && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">
                      FRAME #{selectedFrame.frameNumber}
                    </span>
                    <span className="text-xs font-mono text-zinc-200">
                      {selectedFrame.shutterSpeed}s • f/{selectedFrame.aperture} •{' '}
                      {selectedFrame.stopDelta === 0
                        ? 'Matched (0 stops)'
                        : `${formatHalfStops(selectedFrame.stopDelta)} ${
                            selectedFrame.stopDelta > 0 ? 'OVER' : 'UNDER'
                          }`}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-400 mt-1 flex flex-wrap items-center gap-2">
                    <span>{selectedFrame.lensName || 'Standard Lens'}</span>
                    <span>•</span>
                    <span>Mode: {selectedFrame.priorityMode} / {selectedFrame.meteringMode}</span>
                    {selectedFrame.exposureCompEv !== 0 && (
                      <>
                        <span>•</span>
                        <span className="text-emerald-300">
                          Comp {formatHalfStops(selectedFrame.exposureCompEv)}
                        </span>
                      </>
                    )}
                    {selectedFrame.lat !== null && selectedFrame.lng !== null && (
                      <span className="flex items-center gap-0.5 text-emerald-400 font-mono text-[11px]">
                        <MapPin className="w-3 h-3" />
                        {selectedFrame.lat.toFixed(3)}, {selectedFrame.lng.toFixed(3)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Upload Lab Scan / Download EXIF-Baked Scan */}
                <div className="flex items-center gap-2 shrink-0">
                  <label className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-medium cursor-pointer flex items-center gap-1.5 border border-zinc-700">
                    <Upload className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{selectedFrame.scanImageUrl ? 'Replace Scan' : 'Attach Film Scan'}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload(selectedFrame, file);
                      }}
                    />
                  </label>

                  {!selectedFrame.scanImageUrl && (
                    <button
                      onClick={() => handleSimulateFilmScan(selectedFrame)}
                      disabled={uploadingFrameId === selectedFrame.id}
                      className="px-2.5 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-1"
                      title="Generate a sample graded film scan from the digital reference to test EXIF baking"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      <span>Demo Scan</span>
                    </button>
                  )}

                  {selectedFrame.taggedScanUrl && (
                    <a
                      href={selectedFrame.taggedScanUrl}
                      download={`Roll-${rollDetail.rollNumber}_Frame-${selectedFrame.frameNumber}_EXIF.jpg`}
                      className="px-3 py-1.5 rounded-xl bg-emerald-400 text-zinc-950 font-bold text-xs flex items-center gap-1"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>EXIF JPEG</span>
                    </a>
                  )}
                </div>
              </div>

              {/* Interactive Side-by-Side / Split Comparison Viewer */}
              <div className="relative rounded-2xl overflow-hidden bg-zinc-950 border border-zinc-800 aspect-[4/3] select-none">
                {selectedFrame.refImageUrl && selectedFrame.scanImageUrl ? (
                  <>
                    <img
                      src={selectedFrame.scanImageUrl}
                      alt="Film Scan"
                      className="w-full h-full object-cover"
                    />
                    <div
                      className="absolute inset-0 overflow-hidden"
                      style={{ clipPath: `inset(0 ${100 - splitPercent}% 0 0)` }}
                    >
                      <img
                        src={selectedFrame.refImageUrl}
                        alt="Digital Reference"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-emerald-400 shadow-lg pointer-events-none"
                      style={{ left: `${splitPercent}%` }}
                    />
                    <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-zinc-950/80 text-[10px] font-mono text-zinc-200 border border-zinc-800">
                      iPhone Meter Ref
                    </span>
                    <span className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded bg-zinc-950/80 text-[10px] font-mono text-emerald-400 border border-emerald-500/40">
                      Film Scan (EXIF Baked)
                    </span>
                  </>
                ) : selectedFrame.refImageUrl ? (
                  <div className="relative w-full h-full">
                    <img
                      src={selectedFrame.refImageUrl}
                      alt="Digital Reference"
                      className="w-full h-full object-cover"
                    />
                    <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-zinc-950/85 text-[10px] font-mono text-emerald-300 border border-zinc-800">
                      Digital Meter Reference (Attach Lab Scan to Compare Side-by-Side)
                    </span>
                  </div>
                ) : selectedFrame.scanImageUrl ? (
                  <img
                    src={selectedFrame.scanImageUrl}
                    alt="Film Scan"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-zinc-500">
                    No image attached to this frame yet.
                  </div>
                )}
              </div>

              {selectedFrame.refImageUrl && selectedFrame.scanImageUrl && (
                <div className="flex items-center gap-3 px-1">
                  <span className="text-[11px] font-mono text-zinc-400 shrink-0">Digital Ref</span>
                  <input
                    type="range"
                    min={5}
                    max={95}
                    value={splitPercent}
                    onChange={(e) => setSplitPercent(Number(e.target.value))}
                    className="w-full accent-emerald-400"
                  />
                  <span className="text-[11px] font-mono text-emerald-400 shrink-0">Film Scan</span>
                </div>
              )}

              {/* Embedded Light Conditions & Metadata Summary Table */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-zinc-950/80 border border-zinc-800/80 rounded-xl p-3 text-xs font-mono">
                <div>
                  <span className="text-[10px] text-zinc-500 block">SCENE EV₁₀₀ / TARGET</span>
                  <span className="text-zinc-200">
                    EV₁₀₀ {selectedFrame.ev100 ?? '—'} → EV {selectedFrame.meteredEv ?? '—'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 block">SHADOW / HIGHLIGHT</span>
                  <span className="text-zinc-200">
                    {selectedFrame.shadowEv100 ?? '—'} / {selectedFrame.highlightEv100 ?? '—'} EV
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 block">DYNAMIC RANGE & CCT</span>
                  <span className="text-emerald-400">
                    {selectedFrame.sceneContrastStops != null
                      ? formatHalfStops(selectedFrame.sceneContrastStops, false)
                      : '—'}{' '}
                    • {selectedFrame.colorTempK ? `${selectedFrame.colorTempK}K` : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 block">NAS TAGGED FILE</span>
                  <span className="text-emerald-400 truncate block">
                    {selectedFrame.taggedScanUrl ? 'scans_tagged/ Ready' : 'Awaiting Scan'}
                  </span>
                </div>
              </div>

              {/* Learning Takeaways & Exposure Rating */}
              <div className="border-t border-zinc-800 pt-3 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-200">
                    Learning Notes & Exposure Evaluation
                  </span>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setEditRating(star)}
                        className={`p-1 ${
                          editRating >= star ? 'text-emerald-400' : 'text-zinc-600'
                        }`}
                      >
                        <Star className="w-4 h-4 fill-current" />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="What did you learn from this exposure? (e.g. Shadows held well at -1 stop)"
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100"
                  />
                  <button
                    onClick={handleSaveLearningNotes}
                    className="px-3.5 py-2 rounded-xl bg-emerald-400 text-zinc-950 font-bold text-xs shrink-0"
                  >
                    Save to SQLite
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-8 text-center text-xs text-zinc-400">
          No frames logged on this roll yet. Go to the <strong>Meter</strong> tab and tap{' '}
          <strong>Meter & Log Frame</strong> to capture your first exposure!
        </div>
      )}
    </div>
  );
};
