import React, { useState } from 'react';
import type { Camera, Lens, FilmStock, FilmFormat } from '@catenicus/shared';
import { api, SystemInfo } from '../../api/client';
import { Camera as CameraIcon, Aperture, Film, HardDrive, Database } from 'lucide-react';

interface GearLockerViewProps {
  cameras: Camera[];
  lenses: Lens[];
  filmStocks: FilmStock[];
  systemInfo: SystemInfo | null;
  onRefresh: () => void;
}

export const GearLockerView: React.FC<GearLockerViewProps> = ({
  cameras,
  lenses,
  filmStocks,
  systemInfo,
  onRefresh
}) => {
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [format, setFormat] = useState<FilmFormat>('35mm');

  const [lensName, setLensName] = useState('');
  const [focalLength] = useState(50);
  const [maxAperture] = useState(1.8);
  const [lensCameraId, setLensCameraId] = useState<string>(cameras[0]?.id || '');

  const handleAddCamera = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!make.trim() || !model.trim()) return;
    await api.createCamera({
      name: `${make.trim()} ${model.trim()}`,
      make: make.trim(),
      model: model.trim(),
      format
    });
    setMake('');
    setModel('');
    onRefresh();
  };

  const handleAddLens = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lensName.trim()) return;
    await api.createLens({
      name: lensName.trim(),
      focalLengthMm: Number(focalLength),
      maxAperture: Number(maxAperture),
      minAperture: 16,
      cameraId: lensCameraId || null
    });
    setLensName('');
    onRefresh();
  };

  return (
    <div className="flex flex-col gap-5 pb-8">
      {/* SQLite Relational Schema & NAS Storage Card */}
      {systemInfo && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                <Database className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-zinc-100">
                  SQLite Relational Database (<code className="text-emerald-400">catenicus.sqlite</code>)
                </div>
                <div className="text-[11px] font-mono text-zinc-400 truncate">
                  NAS Path: {systemInfo.rollsDir}
                </div>
              </div>
            </div>
            <div className="text-right font-mono text-xs shrink-0">
              <div className="text-emerald-400 font-bold">{systemInfo.rollCount} Rolls</div>
              <div className="text-zinc-400 text-[11px]">{systemInfo.frameCount} Frames</div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-zinc-800/80 text-[11px] font-mono">
            <div className="bg-zinc-950 rounded-xl p-2 border border-zinc-800">
              <span className="text-emerald-400 font-bold block">cameras ({cameras.length})</span>
              <span className="text-zinc-500 text-[10px]">PK: id, format, speeds</span>
            </div>
            <div className="bg-zinc-950 rounded-xl p-2 border border-zinc-800">
              <span className="text-emerald-400 font-bold block">lenses ({lenses.length})</span>
              <span className="text-zinc-500 text-[10px]">FK → cameras.id</span>
            </div>
            <div className="bg-zinc-950 rounded-xl p-2 border border-zinc-800">
              <span className="text-emerald-400 font-bold block">film_stocks ({filmStocks.length})</span>
              <span className="text-zinc-500 text-[10px]">PK: id, box_iso, process</span>
            </div>
            <div className="bg-zinc-950 rounded-xl p-2 border border-zinc-800">
              <span className="text-emerald-400 font-bold block">rolls ({systemInfo.rollCount})</span>
              <span className="text-zinc-500 text-[10px]">FK → cameras.id, film_stocks.id</span>
            </div>
            <div className="bg-zinc-950 rounded-xl p-2 border border-zinc-800">
              <span className="text-emerald-400 font-bold block">frames ({systemInfo.frameCount})</span>
              <span className="text-zinc-500 text-[10px]">FK → rolls.id, lenses.id</span>
            </div>
          </div>
        </div>
      )}

      {/* Camera Bodies List */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-emerald-400">
          <CameraIcon className="w-4 h-4" />
          <span>Camera Bodies ({cameras.length})</span>
        </div>

        <div className="grid gap-2.5">
          {cameras.map((cam) => (
            <div
              key={cam.id}
              className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 flex items-center justify-between gap-2"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-zinc-100">{cam.name}</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                    {cam.format}
                  </span>
                </div>
                <div className="text-[11px] font-mono text-zinc-500 mt-0.5">
                  Shutters: {cam.shutterSpeeds[0]}s … {cam.shutterSpeeds[cam.shutterSpeeds.length - 1]}s
                </div>
              </div>

              {cam.activeRoll ? (
                <div className="text-right bg-emerald-500/15 border border-emerald-500/40 rounded-lg px-2.5 py-1 shrink-0">
                  <div className="text-[10px] font-mono text-emerald-300">
                    LOADED • FRAME {cam.activeRoll.frameCount}/{cam.activeRoll.maxFrames}
                  </div>
                  <div className="text-xs font-semibold text-zinc-100">
                    {cam.activeRoll.filmName} @ EI {cam.activeRoll.ratedIso}
                  </div>
                </div>
              ) : (
                <span className="text-xs font-mono text-zinc-500 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800">
                  Empty Body
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Add Camera Form */}
        <form onSubmit={handleAddCamera} className="pt-2 border-t border-zinc-800 grid grid-cols-3 gap-2">
          <input
            type="text"
            value={make}
            onChange={(e) => setMake(e.target.value)}
            placeholder="Make (e.g. Nikon)"
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-2 text-xs text-zinc-100"
          />
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Model (e.g. FM2)"
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-2 text-xs text-zinc-100"
          />
          <div className="flex gap-1.5">
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as FilmFormat)}
              className="bg-zinc-950 border border-zinc-800 rounded-xl px-2 py-2 text-xs text-zinc-100 flex-1"
            >
              <option value="35mm">35mm</option>
              <option value="120_645">6x4.5</option>
              <option value="120_6x6">6x6</option>
              <option value="120_6x7">6x7</option>
              <option value="4x5">4x5</option>
            </select>
            <button
              type="submit"
              className="px-3 py-2 rounded-xl bg-emerald-400 text-zinc-950 font-bold text-xs shrink-0"
            >
              Add
            </button>
          </div>
        </form>
      </div>

      {/* Lenses List */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-emerald-400">
          <Aperture className="w-4 h-4" />
          <span>Lenses ({lenses.length})</span>
        </div>

        <div className="grid gap-2">
          {lenses.map((lens) => {
            const cam = cameras.find((c) => c.id === lens.cameraId);
            return (
              <div
                key={lens.id}
                className="bg-zinc-950 border border-zinc-800 rounded-xl p-2.5 flex items-center justify-between text-xs"
              >
                <div>
                  <span className="font-semibold text-zinc-100">{lens.name}</span>
                  {cam && <span className="text-zinc-500 ml-2">({cam.name})</span>}
                </div>
                <span className="font-mono text-emerald-400">
                  {lens.focalLengthMm}mm • f/{lens.maxAperture}–f/{lens.minAperture}
                </span>
              </div>
            );
          })}
        </div>

        <form onSubmit={handleAddLens} className="pt-2 border-t border-zinc-800 grid grid-cols-1 sm:grid-cols-4 gap-2">
          <input
            type="text"
            value={lensName}
            onChange={(e) => setLensName(e.target.value)}
            placeholder="Lens name (e.g. Nikkor 50mm f/1.4)"
            className="sm:col-span-2 bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-2 text-xs text-zinc-100"
          />
          <select
            value={lensCameraId}
            onChange={(e) => setLensCameraId(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-2 text-xs text-zinc-100"
          >
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold text-xs"
          >
            + Add Lens
          </button>
        </form>
      </div>

      {/* Film Stock Library */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-2.5">
        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-zinc-400">
          <Film className="w-4 h-4" />
          <span>Pre-Seeded Film Stock Library ({filmStocks.length})</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filmStocks.map((st) => (
            <span
              key={st.id}
              className="px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 font-mono"
            >
              {st.brand} {st.name} • ISO {st.boxIso} ({st.process})
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
