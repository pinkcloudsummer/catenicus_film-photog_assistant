import React, { useEffect, useState, useCallback } from 'react';
import type { Camera, Lens, FilmStock, RollSummary } from '@catenicus/shared';
import { api, SystemInfo } from './api/client';
import { LightMeterView } from './components/meter/LightMeterView';
import { RollsView } from './components/rolls/RollsView';
import { LabCompareView } from './components/lab/LabCompareView';
import { GearLockerView } from './components/gear/GearLockerView';
import { Gauge, Film, Sparkles, Camera as CameraIcon, Disc } from 'lucide-react';

type ActiveTab = 'meter' | 'rolls' | 'lab' | 'gear';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('meter');
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [lenses, setLenses] = useState<Lens[]>([]);
  const [filmStocks, setFilmStocks] = useState<FilmStock[]>([]);
  const [rolls, setRolls] = useState<RollSummary[]>([]);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);

  const [activeRollId, setActiveRollId] = useState<string | null>(null);
  const [labRollId, setLabRollId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    try {
      const [cams, lns, stocks, rls, sys] = await Promise.all([
        api.getCameras(),
        api.getLenses(),
        api.getFilmStocks(),
        api.getRolls(),
        api.getSystemInfo()
      ]);
      setCameras(cams);
      setLenses(lns);
      setFilmStocks(stocks);
      setRolls(rls);
      setSystemInfo(sys);

      const loaded = rls.filter((r) => r.status === 'loaded');
      setActiveRollId((prev) => {
        if (prev && loaded.some((r) => r.id === prev)) return prev;
        return loaded[0]?.id || rls[0]?.id || null;
      });
      setLabRollId((prev) => prev || rls[0]?.id || null);
    } catch (err) {
      console.error('Error loading Catenicus NAS backend data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const activeRoll = rolls.find((r) => r.id === activeRollId) || null;
  const loadedRolls = rolls.filter((r) => r.status === 'loaded');

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col max-w-lg mx-auto border-x border-zinc-900/80 shadow-2xl">
      {/* Top iPhone Status Header with Instant Multi-Roll Switcher */}
      <header className="sticky top-0 z-30 bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800/80 px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-400 text-zinc-950 flex items-center justify-center font-mono font-black text-sm">
              C
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-zinc-100 leading-none">
                CATENICUS
              </h1>
              <span className="text-[10px] font-mono text-zinc-400">
                FILM METER & NAS EXIF ARCHIVE
              </span>
            </div>
          </div>

          {/* Quick Loaded Roll Pill Switcher */}
          {loadedRolls.length > 0 && (
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-[220px]">
              {loadedRolls.map((r) => {
                const isCurrent = r.id === activeRollId;
                return (
                  <button
                    key={r.id}
                    onClick={() => setActiveRollId(r.id)}
                    className={`px-2 py-1 rounded-lg font-mono text-[10px] shrink-0 border transition ${
                      isCurrent
                        ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 font-bold'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                    title={`${r.cameraName}: ${r.filmBrand} ${r.filmName} @ EI ${r.ratedIso}`}
                  >
                    #{r.rollNumber} EI {r.ratedIso}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 px-3.5 pt-3 pb-20">
        {loading ? (
          <div className="py-20 text-center text-xs font-mono text-zinc-500">
            Connecting to Catenicus NAS Server...
          </div>
        ) : (
          <>
            {activeTab === 'meter' && (
              <LightMeterView
                activeRoll={activeRoll}
                cameras={cameras}
                lenses={lenses}
                onFrameLogged={() => loadAll()}
                onSelectRollRequest={() => setActiveTab('rolls')}
              />
            )}

            {activeTab === 'rolls' && (
              <RollsView
                rolls={rolls}
                cameras={cameras}
                filmStocks={filmStocks}
                activeRollId={activeRollId}
                onSelectActiveRoll={(id) => {
                  setActiveRollId(id);
                  setActiveTab('meter');
                }}
                onOpenRollInLab={(id) => {
                  setLabRollId(id);
                  setActiveTab('lab');
                }}
                onRefresh={loadAll}
              />
            )}

            {activeTab === 'lab' && (
              <LabCompareView
                rolls={rolls}
                selectedRollId={labRollId}
                onSelectRollId={(id) => setLabRollId(id)}
                onDataUpdated={loadAll}
              />
            )}

            {activeTab === 'gear' && (
              <GearLockerView
                cameras={cameras}
                lenses={lenses}
                filmStocks={filmStocks}
                systemInfo={systemInfo}
                onRefresh={loadAll}
              />
            )}
          </>
        )}
      </main>

      {/* iPhone Bottom Tab Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 max-w-lg mx-auto bg-zinc-950/95 backdrop-blur-lg border-t border-zinc-800 px-3 py-1.5">
        <div className="grid grid-cols-4 gap-1">
          <button
            onClick={() => setActiveTab('meter')}
            className={`flex flex-col items-center py-1.5 rounded-xl transition ${
              activeTab === 'meter' ? 'text-emerald-400' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Gauge className="w-5 h-5" />
            <span className="text-[10px] font-mono mt-0.5 font-semibold">Meter</span>
          </button>

          <button
            onClick={() => setActiveTab('rolls')}
            className={`flex flex-col items-center py-1.5 rounded-xl transition relative ${
              activeTab === 'rolls' ? 'text-emerald-400' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Film className="w-5 h-5" />
            <span className="text-[10px] font-mono mt-0.5 font-semibold">
              Rolls ({loadedRolls.length})
            </span>
          </button>

          <button
            onClick={() => setActiveTab('lab')}
            className={`flex flex-col items-center py-1.5 rounded-xl transition ${
              activeTab === 'lab' ? 'text-emerald-400' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Sparkles className="w-5 h-5" />
            <span className="text-[10px] font-mono mt-0.5 font-semibold">Lab & EXIF</span>
          </button>

          <button
            onClick={() => setActiveTab('gear')}
            className={`flex flex-col items-center py-1.5 rounded-xl transition ${
              activeTab === 'gear' ? 'text-emerald-400' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <CameraIcon className="w-5 h-5" />
            <span className="text-[10px] font-mono mt-0.5 font-semibold">Gear & DB</span>
          </button>
        </div>
      </nav>
    </div>
  );
};
