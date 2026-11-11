import React, { useEffect, useRef, useState, useMemo } from 'react';
import type { Camera, Lens, RollSummary, Frame, PriorityMode } from '@catenicus/shared';
import { FORMAT_ASPECT_RATIOS, STANDARD_APERTURES, STANDARD_SHUTTER_SPEEDS } from '@catenicus/shared';
import {
  findBestShutterSpeed,
  findBestAperture,
  calculateStopDelta,
  computeTargetEv,
  formatHalfStops,
  luminanceToEv100,
  estimateColorTempKelvin,
  describeLightLevel,
  getZoneLabel
} from '../../utils/exposureMath';
import { api } from '../../api/client';
import {
  Crosshair,
  Sun,
  MapPin,
  CheckCircle2,
  Sliders,
  Focus,
  AlertTriangle,
  Lock,
  Sparkles,
  Thermometer
} from 'lucide-react';

interface LightMeterViewProps {
  activeRoll: RollSummary | null;
  cameras: Camera[];
  lenses: Lens[];
  onFrameLogged: (frame: Frame) => void;
  onSelectRollRequest: () => void;
}

const LIGHTING_PRESET_TAGS = [
  'Daylight Sun',
  'Overcast',
  'Golden Hour',
  'Backlit (+1 Stop)',
  'Metered Shadows',
  'Indoor Tungsten',
  'Night / Neon',
  'Tripod'
];

export const LightMeterView: React.FC<LightMeterViewProps> = ({
  activeRoll,
  cameras,
  lenses,
  onFrameLogged,
  onSelectRollRequest
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [simulatedSceneBrightness, setSimulatedSceneBrightness] = useState<number>(145);

  const [meteringMode, setMeteringMode] = useState<'center' | 'spot'>('center');
  const [spotPoint, setSpotPoint] = useState<{ x: number; y: number }>({ x: 0.5, y: 0.5 });

  // Comprehensive Scene Light Telemetry
  const [centerEv100, setCenterEv100] = useState<number>(13.0);
  const [spotEv100, setSpotEv100] = useState<number>(13.0);
  const [shadowEv100, setShadowEv100] = useState<number>(10.5);
  const [highlightEv100, setHighlightEv100] = useState<number>(15.0);
  const [colorTempK, setColorTempK] = useState<number>(5500);

  const [calibrationEv, setCalibrationEv] = useState<number>(0);
  const [exposureCompEv, setExposureCompEv] = useState<number>(0);

  // Selected Camera & Lens
  const activeCamera = useMemo(
    () => cameras.find((c) => c.id === activeRoll?.cameraId) || null,
    [cameras, activeRoll]
  );

  const compatibleLenses = useMemo(() => {
    if (!activeCamera) return lenses;
    const matched = lenses.filter((l) => l.cameraId === activeCamera.id);
    return matched.length > 0 ? matched : lenses;
  }, [lenses, activeCamera]);

  const [selectedLensId, setSelectedLensId] = useState<string | null>(null);
  useEffect(() => {
    if (compatibleLenses.length > 0 && !compatibleLenses.some((l) => l.id === selectedLensId)) {
      setSelectedLensId(compatibleLenses[0].id);
    }
  }, [compatibleLenses, selectedLensId]);

  const selectedLens = useMemo(
    () => compatibleLenses.find((l) => l.id === selectedLensId) || null,
    [compatibleLenses, selectedLensId]
  );

  const availableApertures = useMemo(
    () => (selectedLens && selectedLens.apertures.length > 0 ? selectedLens.apertures : STANDARD_APERTURES),
    [selectedLens]
  );

  const availableShutters = useMemo(
    () => (activeCamera && activeCamera.shutterSpeeds.length > 0 ? activeCamera.shutterSpeeds : STANDARD_SHUTTER_SPEEDS),
    [activeCamera]
  );

  // Interactive Priority Mode: 'aperture' (lock f-stop, auto shutter), 'shutter' (lock shutter, auto f-stop), or 'manual'
  const [priorityMode, setPriorityMode] = useState<PriorityMode>('aperture');
  const [lockedAperture, setLockedAperture] = useState<number>(8);
  const [lockedShutter, setLockedShutter] = useState<string>('1/250');

  useEffect(() => {
    if (!availableApertures.includes(lockedAperture)) {
      setLockedAperture(availableApertures[Math.min(3, availableApertures.length - 1)] || 5.6);
    }
  }, [availableApertures, lockedAperture]);

  useEffect(() => {
    if (!availableShutters.includes(lockedShutter)) {
      setLockedShutter(availableShutters[Math.min(2, availableShutters.length - 1)] || '1/250');
    }
  }, [availableShutters, lockedShutter]);

  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [frameNotes, setFrameNotes] = useState('');
  const [includeGps, setIncludeGps] = useState(true);
  const [isLogging, setIsLogging] = useState(false);
  const [lastLoggedBanner, setLastLoggedBanner] = useState<string | null>(null);
  const [showCalibrator, setShowCalibrator] = useState(false);

  // Start WebRTC Camera Stream
  const startCamera = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Live camera requires HTTPS on iOS Safari (or localhost). Using interactive simulated viewfinder.');
      setCameraActive(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 960 }
        },
        audio: false
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);
      }
    } catch {
      setCameraError('Camera permission denied or unavailable. Using interactive simulated light meter scene.');
      setCameraActive(false);
    }
  };

  useEffect(() => {
    startCamera();
    return () => {
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach((t) => t.stop());
      }
    };
  }, []);

  // Real-time Luminance, Dynamic Range (Shadow/Highlight), and Color Temp Loop (5 Hz)
  useEffect(() => {
    const interval = setInterval(() => {
      const canvas = sampleCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      const W = 160;
      const H = 120;
      canvas.width = W;
      canvas.height = H;

      if (cameraActive && videoRef.current && videoRef.current.readyState >= 2) {
        ctx.drawImage(videoRef.current, 0, 0, W, H);
      } else {
        const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
        const b = simulatedSceneBrightness;
        skyGrad.addColorStop(0, `rgb(${Math.min(255, b + 55)}, ${Math.min(255, b + 42)}, ${Math.min(255, b + 28)})`);
        skyGrad.addColorStop(0.55, `rgb(${b}, ${Math.max(20, b - 8)}, ${Math.max(20, b - 20)})`);
        skyGrad.addColorStop(1, `rgb(${Math.max(12, b - 95)}, ${Math.max(12, b - 90)}, ${Math.max(15, b - 85)})`);
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, W, H);

        ctx.fillStyle = `rgb(${Math.min(255, b + 75)}, ${Math.min(255, b + 65)}, ${Math.min(255, b + 45)})`;
        ctx.beginPath();
        ctx.arc(W * 0.65, H * 0.42, 24, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgb(${Math.max(10, b - 110)}, ${Math.max(10, b - 105)}, ${Math.max(12, b - 98)})`;
        ctx.fillRect(14, H * 0.58, 52, 42);
      }

      const img = ctx.getImageData(0, 0, W, H).data;

      let weightedSum = 0;
      let weightTotal = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sampleCount = 0;
      const lumaSamples: number[] = [];

      for (let y = 0; y < H; y += 2) {
        for (let x = 0; x < W; x += 2) {
          const idx = (y * W + x) * 4;
          const r = img[idx];
          const g = img[idx + 1];
          const b = img[idx + 2];
          const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const inCenter = x > W * 0.25 && x < W * 0.75 && y > H * 0.25 && y < H * 0.75;
          const w = inCenter ? 3 : 1;
          weightedSum += luma * w;
          weightTotal += w;

          sumR += r;
          sumG += g;
          sumB += b;
          sampleCount++;
          lumaSamples.push(luma);
        }
      }
      const centerAvg = weightedSum / Math.max(1, weightTotal);

      // Compute 10th percentile (shadow) and 90th percentile (highlight) luminance
      lumaSamples.sort((a, b) => a - b);
      const p10 = lumaSamples[Math.floor(lumaSamples.length * 0.1)] ?? centerAvg;
      const p90 = lumaSamples[Math.floor(lumaSamples.length * 0.9)] ?? centerAvg;

      // Spot ROI (12x12 patch around spotPoint)
      const sx = Math.floor(spotPoint.x * (W - 1));
      const sy = Math.floor(spotPoint.y * (H - 1));
      let spotSum = 0;
      let spotCount = 0;
      for (let dy = -6; dy <= 6; dy++) {
        for (let dx = -6; dx <= 6; dx++) {
          const px = Math.min(W - 1, Math.max(0, sx + dx));
          const py = Math.min(H - 1, Math.max(0, sy + dy));
          const idx = (py * W + px) * 4;
          spotSum += 0.2126 * img[idx] + 0.7152 * img[idx + 1] + 0.0722 * img[idx + 2];
          spotCount++;
        }
      }
      const spotAvg = spotSum / Math.max(1, spotCount);

      setCenterEv100(luminanceToEv100(centerAvg, calibrationEv));
      setSpotEv100(luminanceToEv100(spotAvg, calibrationEv));
      setShadowEv100(luminanceToEv100(p10, calibrationEv));
      setHighlightEv100(luminanceToEv100(p90, calibrationEv));
      setColorTempK(
        estimateColorTempKelvin(
          sumR / Math.max(1, sampleCount),
          sumG / Math.max(1, sampleCount),
          sumB / Math.max(1, sampleCount)
        )
      );
    }, 200);

    return () => clearInterval(interval);
  }, [cameraActive, simulatedSceneBrightness, spotPoint, calibrationEv]);

  const activeEv100 = meteringMode === 'spot' ? spotEv100 : centerEv100;
  const ratedIso = activeRoll?.ratedIso || 400;

  // Auto-matched shutter for Aperture Priority
  const autoShutterForAperture = useMemo(
    () =>
      findBestShutterSpeed({
        ev100: activeEv100,
        ratedIso,
        exposureCompEv,
        aperture: lockedAperture,
        availableShutters
      }),
    [activeEv100, ratedIso, exposureCompEv, lockedAperture, availableShutters]
  );

  // Auto-matched aperture for Shutter Priority
  const autoApertureForShutter = useMemo(
    () =>
      findBestAperture({
        ev100: activeEv100,
        ratedIso,
        exposureCompEv,
        shutterSpeed: lockedShutter,
        availableApertures
      }),
    [activeEv100, ratedIso, exposureCompEv, lockedShutter, availableApertures]
  );

  // Active shutter & aperture based on current priority mode
  const finalShutterSpeed =
    priorityMode === 'aperture' ? autoShutterForAperture.shutterSpeed : lockedShutter;
  const finalAperture =
    priorityMode === 'shutter' ? autoApertureForShutter.aperture : lockedAperture;

  const targetEv = useMemo(
    () => computeTargetEv(activeEv100, ratedIso, exposureCompEv),
    [activeEv100, ratedIso, exposureCompEv]
  );

  const deltaInfo = useMemo(
    () => calculateStopDelta(finalShutterSpeed, finalAperture, targetEv),
    [finalShutterSpeed, finalAperture, targetEv]
  );

  // Is exposure matched within ±1/3 stop?
  const isMatched = Math.abs(deltaInfo.exactDelta) <= 0.35;
  const isSlightlyOff = !isMatched && Math.abs(deltaInfo.exactDelta) <= 1.0;

  const spotDiffFromCenter = Math.round((spotEv100 - centerEv100) * 2) / 2;
  const sceneContrastStops = Math.max(0, Math.round((highlightEv100 - shadowEv100) * 2) / 2);
  const zoneInfo = getZoneLabel(spotDiffFromCenter);
  const lightConditionSummary = describeLightLevel(activeEv100);

  // Clicking on the Shutter Box makes Shutter Auto (switches to Aperture Priority)
  // Clicking on the Aperture Box makes Aperture Auto (switches to Shutter Priority)
  const handleSelectShutterCard = () => {
    setLockedAperture(finalAperture);
    setPriorityMode('aperture');
  };

  const handleSelectApertureCard = () => {
    setLockedShutter(finalShutterSpeed);
    setPriorityMode('shutter');
  };

  const handlePickApertureDial = (ap: number) => {
    setLockedAperture(ap);
    if (priorityMode === 'shutter') {
      // User was locking shutter and now tapped a specific f-stop -> enter manual or switch to aperture priority
      setPriorityMode('aperture');
    }
  };

  const handlePickShutterDial = (spd: string) => {
    setLockedShutter(spd);
    if (priorityMode === 'aperture') {
      setPriorityMode('shutter');
    }
  };

  const handleViewfinderTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0.08, Math.min(0.92, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0.08, Math.min(0.92, (e.clientY - rect.top) / rect.height));
    setSpotPoint({ x, y });
    setMeteringMode('spot');
  };

  const captureReferenceSnapshot = (): string | null => {
    const outCanvas = document.createElement('canvas');
    outCanvas.width = 640;
    outCanvas.height = 480;
    const ctx = outCanvas.getContext('2d');
    if (!ctx) return null;

    if (cameraActive && videoRef.current && videoRef.current.readyState >= 2) {
      ctx.drawImage(videoRef.current, 0, 0, outCanvas.width, outCanvas.height);
    } else if (sampleCanvasRef.current) {
      ctx.drawImage(sampleCanvasRef.current, 0, 0, outCanvas.width, outCanvas.height);
    }

    ctx.fillStyle = 'rgba(9, 9, 11, 0.82)';
    ctx.fillRect(0, outCanvas.height - 44, outCanvas.width, 44);
    ctx.fillStyle = '#34D399';
    ctx.font = 'bold 15px ui-monospace, monospace';
    const deltaLabel = isMatched ? '0 stops (Matched)' : formatHalfStops(deltaInfo.halfStopDelta);
    const stampText = `${activeCamera?.name || 'Camera'} | ${activeRoll?.filmBrand || ''} ${activeRoll?.filmName || ''} @ EI ${ratedIso} | ${finalShutterSpeed}s f/${finalAperture} (${deltaLabel})`;
    ctx.fillText(stampText, 14, outCanvas.height - 16);

    return outCanvas.toDataURL('image/jpeg', 0.85);
  };

  const handleLogFrame = async () => {
    if (!activeRoll) {
      onSelectRollRequest();
      return;
    }

    setIsLogging(true);
    try {
      const refImageDataUrl = captureReferenceSnapshot();

      let lat: number | null = null;
      let lng: number | null = null;

      if (includeGps && 'geolocation' in navigator) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 2200 })
          );
          lat = Math.round(pos.coords.latitude * 100000) / 100000;
          lng = Math.round(pos.coords.longitude * 100000) / 100000;
        } catch {
          // Proceed without GPS if denied or timed out
        }
      }

      const autoLightingTags = Array.from(
        new Set([lightConditionSummary, `${colorTempK}K`, ...selectedTags])
      );

      const logged = await api.logFrame(activeRoll.id, {
        lensId: selectedLens?.id || null,
        shutterSpeed: finalShutterSpeed,
        aperture: finalAperture,
        priorityMode,
        meteredEv: Math.round(targetEv * 10) / 10,
        ev100: activeEv100,
        centerEv100,
        spotEv100,
        shadowEv100,
        highlightEv100,
        sceneContrastStops,
        colorTempK,
        stopDelta: deltaInfo.halfStopDelta,
        exposureCompEv,
        calibrationEv,
        meteringMode,
        spotCoords: meteringMode === 'spot' ? spotPoint : null,
        lightingTags: autoLightingTags,
        lat,
        lng,
        notes: frameNotes.trim() || undefined,
        refImageDataUrl
      });

      setFrameNotes('');
      setLastLoggedBanner(
        `Saved Frame #${logged.frameNumber} (${finalShutterSpeed}s @ f/${finalAperture} • ${
          isMatched ? 'Matched 0 stops' : formatHalfStops(deltaInfo.halfStopDelta)
        }) to SQLite & NAS`
      );
      setTimeout(() => setLastLoggedBanner(null), 4000);
      onFrameLogged(logged);
    } catch (err: any) {
      alert(`Failed to save frame to NAS: ${err.message}`);
    } finally {
      setIsLogging(false);
    }
  };

  const formatInfo = activeCamera ? FORMAT_ASPECT_RATIOS[activeCamera.format] : FORMAT_ASPECT_RATIOS['35mm'];

  return (
    <div className="flex flex-col gap-3 pb-6">
      {/* Top Active Camera + Film Roll Status Bar */}
      {activeRoll ? (
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-3 flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex flex-col items-center justify-center shrink-0">
              <span className="text-[10px] font-mono uppercase text-emerald-300 leading-none">FRAME</span>
              <span className="text-sm font-mono font-bold text-emerald-400 leading-tight">
                {activeRoll.frameCount + 1}/{activeRoll.maxFrames}
              </span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-zinc-100 truncate">
                  {activeCamera?.name || 'Unassigned Body'}
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                  {formatInfo.label}
                </span>
              </div>
              <div className="text-xs text-zinc-400 flex items-center gap-1.5 mt-0.5">
                <span className="text-emerald-400 font-medium">
                  {activeRoll.filmBrand} {activeRoll.filmName}
                </span>
                <span>•</span>
                <span className="font-mono text-zinc-200 font-semibold">
                  EI {activeRoll.ratedIso}
                </span>
                {activeRoll.pushPullStops !== 0 && (
                  <span className="text-[10px] font-mono px-1.5 py-0.2 bg-emerald-500/20 text-emerald-300 rounded">
                    {formatHalfStops(activeRoll.pushPullStops)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onSelectRollRequest}
            className="text-xs font-mono text-emerald-400 hover:text-emerald-300 px-2.5 py-1.5 rounded-lg bg-zinc-800/80 border border-zinc-700 shrink-0"
          >
            Switch Roll
          </button>
        </div>
      ) : (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-3 flex items-center justify-between">
          <div className="text-xs text-emerald-200">
            No active film roll selected. Load or pick a roll to lock ISO & log frames to NAS.
          </div>
          <button
            onClick={onSelectRollRequest}
            className="text-xs font-semibold bg-emerald-400 text-zinc-950 px-3 py-1.5 rounded-xl shrink-0"
          >
            Select Roll
          </button>
        </div>
      )}

      {/* Live Viewfinder with Tap-to-Spot & Frame Lines */}
      <div className="relative rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 aspect-[4/3] select-none shadow-inner">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`w-full h-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
        />
        <canvas
          ref={sampleCanvasRef}
          className={`w-full h-full object-cover ${cameraActive ? 'hidden' : 'block'}`}
        />

        {/* Interactive Click Surface for Spot Metering */}
        <div
          onClick={handleViewfinderTap}
          className="absolute inset-0 cursor-crosshair flex items-center justify-center"
        >
          {/* Format Framelines Guide */}
          <div
            className="border border-white/40 rounded pointer-events-none relative"
            style={{
              width: '82%',
              height: formatInfo.ratio === 1 ? '62%' : '76%'
            }}
          >
            <div className="absolute -top-0.5 -left-0.5 w-3 h-3 border-t-2 border-l-2 border-emerald-400" />
            <div className="absolute -top-0.5 -right-0.5 w-3 h-3 border-t-2 border-r-2 border-emerald-400" />
            <div className="absolute -bottom-0.5 -left-0.5 w-3 h-3 border-b-2 border-l-2 border-emerald-400" />
            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 border-b-2 border-r-2 border-emerald-400" />
          </div>

          {/* Center-Weighted Reticle */}
          <div
            className={`w-16 h-16 rounded-full border pointer-events-none flex items-center justify-center transition-opacity ${
              meteringMode === 'center' ? 'border-emerald-400/80 opacity-100' : 'border-white/25 opacity-50'
            }`}
          >
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" />
          </div>

          {/* Spot Meter Target Reticle */}
          {meteringMode === 'spot' && (
            <div
              className="absolute w-12 h-12 -ml-6 -mt-6 rounded-full border-2 border-emerald-400 bg-emerald-400/10 pointer-events-none flex items-center justify-center shadow-lg"
              style={{
                left: `${spotPoint.x * 100}%`,
                top: `${spotPoint.y * 100}%`
              }}
            >
              <Crosshair className="w-4 h-4 text-emerald-400" />
              <span className="absolute -bottom-5 whitespace-nowrap px-1.5 py-0.5 rounded bg-zinc-950/90 text-[10px] font-mono text-emerald-300 border border-emerald-500/40">
                {formatHalfStops(spotDiffFromCenter)} ({zoneInfo.zone})
              </span>
            </div>
          )}
        </div>

        {/* Top-left HUD overlay */}
        <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-1.5 pointer-events-none">
          <div className="flex items-center gap-1.5">
            <span className="px-2 py-0.5 rounded-md bg-zinc-950/85 backdrop-blur text-[11px] font-mono text-emerald-400 border border-zinc-800">
              {lightConditionSummary} • EV {targetEv.toFixed(1)}
            </span>
          </div>
          <span className="px-2 py-0.5 rounded-md bg-zinc-950/85 backdrop-blur text-[10px] font-mono text-zinc-300 border border-zinc-800 flex items-center gap-1">
            <Thermometer className="w-3 h-3 text-emerald-400" />
            {colorTempK}K • DR {formatHalfStops(sceneContrastStops, false)}
          </span>
        </div>

        {/* Bottom Viewfinder Mode Controls */}
        <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between">
          <div className="flex items-center gap-1 bg-zinc-950/85 backdrop-blur p-1 rounded-xl border border-zinc-800">
            <button
              onClick={() => setMeteringMode('center')}
              className={`px-2.5 py-1 rounded-lg text-xs font-mono transition ${
                meteringMode === 'center'
                  ? 'bg-emerald-400 text-zinc-950 font-bold'
                  : 'text-zinc-300 hover:text-white'
              }`}
            >
              Center-Weighted
            </button>
            <button
              onClick={() => setMeteringMode('spot')}
              className={`px-2.5 py-1 rounded-lg text-xs font-mono transition ${
                meteringMode === 'spot'
                  ? 'bg-emerald-400 text-zinc-950 font-bold'
                  : 'text-zinc-300 hover:text-white'
              }`}
            >
              Tap Spot
            </button>
          </div>

          <button
            onClick={() => setShowCalibrator((v) => !v)}
            className="p-2 rounded-xl bg-zinc-950/85 backdrop-blur border border-zinc-800 text-zinc-300 hover:text-emerald-400"
            title="Scene Luminance & Calibration"
          >
            <Sliders className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Simulated Lighting / Meter Calibration Drawer */}
      {(!cameraActive || showCalibrator) && (
        <div className="bg-zinc-900/70 border border-zinc-800/90 rounded-xl p-3 flex flex-col gap-2 text-xs">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="flex items-center gap-1.5 font-medium text-zinc-300">
              <Sun className="w-3.5 h-3.5 text-emerald-400" />
              {cameraActive ? 'Sensor Calibration Offset' : 'Interactive Scene Light Simulator + Calibration'}
            </span>
            <span className="font-mono text-emerald-400">
              Cal: {formatHalfStops(calibrationEv)}
            </span>
          </div>
          {!cameraActive && (
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-zinc-400 w-24 shrink-0">Scene Light:</span>
              <input
                type="range"
                min={25}
                max={230}
                value={simulatedSceneBrightness}
                onChange={(e) => setSimulatedSceneBrightness(Number(e.target.value))}
                className="w-full accent-emerald-400"
              />
            </div>
          )}
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-zinc-400 w-24 shrink-0">Meter Offset:</span>
            <input
              type="range"
              min={-3}
              max={3}
              step={0.5}
              value={calibrationEv}
              onChange={(e) => setCalibrationEv(Number(e.target.value))}
              className="w-full accent-emerald-400"
            />
          </div>
          {cameraError && <p className="text-[11px] text-zinc-500">{cameraError}</p>}
        </div>
      )}

      {/* Primary Exposure Readout Card + Match-Needle Stop Indicator */}
      <div
        className={`bg-zinc-900 rounded-2xl p-3.5 shadow-lg border transition-colors ${
          isMatched
            ? 'border-emerald-500/70 shadow-emerald-500/10'
            : isSlightlyOff
            ? 'border-yellow-500/60'
            : 'border-rose-500/70'
        }`}
      >
        {/* Match Status Banner (Green when matched, Over/Under in half-stops when off) */}
        <div
          className={`mb-3 px-3 py-2 rounded-xl border flex items-center justify-between text-xs font-mono ${
            isMatched
              ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
              : isSlightlyOff
              ? 'bg-yellow-500/15 border-yellow-500/50 text-yellow-200'
              : 'bg-rose-500/15 border-rose-500/50 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-1.5 font-bold">
            {isMatched ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>METER MATCHED (0 stops)</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  {deltaInfo.halfStopDelta > 0 ? 'OVEREXPOSED' : 'UNDEREXPOSED'} BY{' '}
                  {formatHalfStops(deltaInfo.halfStopDelta)}
                </span>
              </>
            )}
          </div>
          <span className="text-[10px] opacity-80">
            {priorityMode === 'aperture'
              ? 'Aperture Priority (Auto Shutter)'
              : priorityMode === 'shutter'
              ? 'Shutter Priority (Auto f-stop)'
              : 'Manual Override'}
          </span>
        </div>

        {/* Clickable Shutter & Aperture Boxes to Switch Which Parameter is Auto vs Locked */}
        <div className="grid grid-cols-3 gap-2 text-center pb-3 border-b border-zinc-800">
          {/* Shutter Speed Box — Click to make Shutter AUTO */}
          <button
            type="button"
            onClick={handleSelectShutterCard}
            className={`rounded-xl p-2.5 border text-center transition relative ${
              priorityMode === 'aperture'
                ? 'bg-emerald-500/15 border-emerald-400/70 shadow-sm'
                : 'bg-zinc-950/90 border-zinc-800 hover:border-zinc-700'
            }`}
            title="Tap to set Shutter Speed to AUTO (Aperture Priority)"
          >
            <div className="flex items-center justify-center gap-1 text-[10px] font-mono uppercase text-zinc-400">
              <span>Shutter</span>
              {priorityMode === 'aperture' ? (
                <span className="px-1 py-0.2 rounded bg-emerald-400 text-zinc-950 font-bold text-[9px]">
                  AUTO
                </span>
              ) : (
                <Lock className="w-2.5 h-2.5 text-zinc-400" />
              )}
            </div>
            <div
              className={`text-2xl font-mono font-bold mt-0.5 ${
                isMatched ? 'text-emerald-400' : 'text-zinc-100'
              }`}
            >
              {finalShutterSpeed}
              <span className="text-xs font-normal text-zinc-400">s</span>
            </div>
            <div className="text-[10px] font-mono text-zinc-400 mt-0.5">
              {priorityMode === 'aperture' ? 'Auto Matched' : 'Tap for Auto'}
            </div>
          </button>

          {/* Aperture Box — Click to make Aperture AUTO */}
          <button
            type="button"
            onClick={handleSelectApertureCard}
            className={`rounded-xl p-2.5 border text-center transition relative ${
              priorityMode === 'shutter'
                ? 'bg-emerald-500/15 border-emerald-400/70 shadow-sm'
                : 'bg-zinc-950/90 border-zinc-800 hover:border-zinc-700'
            }`}
            title="Tap to set Aperture to AUTO (Shutter Priority)"
          >
            <div className="flex items-center justify-center gap-1 text-[10px] font-mono uppercase text-zinc-400">
              <span>Aperture</span>
              {priorityMode === 'shutter' ? (
                <span className="px-1 py-0.2 rounded bg-emerald-400 text-zinc-950 font-bold text-[9px]">
                  AUTO
                </span>
              ) : (
                <Lock className="w-2.5 h-2.5 text-zinc-400" />
              )}
            </div>
            <div
              className={`text-2xl font-mono font-bold mt-0.5 ${
                isMatched ? 'text-emerald-400' : 'text-zinc-100'
              }`}
            >
              <span className="text-sm font-normal text-zinc-400">f/</span>
              {finalAperture}
            </div>
            <div className="text-[10px] font-mono text-zinc-400 mt-0.5 truncate">
              {priorityMode === 'shutter' ? 'Auto Matched' : 'Tap for Auto'}
            </div>
          </button>

          {/* Locked Roll ISO + Comp */}
          <div className="bg-zinc-950/80 rounded-xl p-2.5 border border-zinc-800/80">
            <div className="text-[10px] font-mono uppercase text-zinc-400">Rated ISO (EI)</div>
            <div className="text-2xl font-mono font-bold text-zinc-100 mt-0.5">{ratedIso}</div>
            <div className="text-[10px] font-mono text-emerald-400 mt-0.5">
              Comp: {formatHalfStops(exposureCompEv)}
            </div>
          </div>
        </div>

        {/* Tactile Aperture Wheel Scrubber */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-zinc-400 mb-1.5">
            <span className="font-mono uppercase text-[10px] tracking-wider flex items-center gap-1.5">
              <span>Aperture Ring</span>
              {priorityMode === 'aperture' && (
                <span className="text-emerald-400 font-semibold">(Driving Auto Shutter)</span>
              )}
            </span>
            {compatibleLenses.length > 0 && (
              <select
                value={selectedLensId || ''}
                onChange={(e) => setSelectedLensId(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-0.5 text-xs text-zinc-200"
              >
                {compatibleLenses.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
            {availableApertures.map((ap) => {
              const isSelected = finalAperture === ap;
              return (
                <button
                  key={ap}
                  onClick={() => handlePickApertureDial(ap)}
                  className={`px-3 py-1.5 rounded-xl font-mono text-xs shrink-0 transition border ${
                    isSelected
                      ? isMatched
                        ? 'bg-emerald-400 text-zinc-950 font-bold border-emerald-300 shadow'
                        : 'bg-zinc-100 text-zinc-950 font-bold border-white'
                      : 'bg-zinc-950 text-zinc-300 border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  f/{ap}
                </button>
              );
            })}
          </div>
        </div>

        {/* Camera Mechanical Shutter Speed Strip */}
        <div className="mt-2.5">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">
            <span className="flex items-center gap-1.5">
              <span>Shutter Dial ({activeCamera?.model || 'Standard'})</span>
              {priorityMode === 'shutter' && (
                <span className="text-emerald-400 font-semibold">(Driving Auto f-stop)</span>
              )}
            </span>
            <button
              type="button"
              onClick={() =>
                setPriorityMode((m) => (m === 'manual' ? 'aperture' : 'manual'))
              }
              className={`px-2 py-0.5 rounded border ${
                priorityMode === 'manual'
                  ? 'bg-rose-500/20 border-rose-400 text-rose-300 font-bold'
                  : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {priorityMode === 'manual' ? 'Manual Lock Active (Tap for Auto)' : 'Lock Both (Manual)'}
            </button>
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
            {availableShutters.map((spd) => {
              const isSelected = finalShutterSpeed === spd;
              return (
                <button
                  key={spd}
                  onClick={() => handlePickShutterDial(spd)}
                  className={`px-2.5 py-1 rounded-lg font-mono text-xs shrink-0 transition border ${
                    isSelected
                      ? isMatched
                        ? 'bg-emerald-400 text-zinc-950 font-bold border-emerald-300 shadow'
                        : 'bg-zinc-100 text-zinc-950 font-bold border-white'
                      : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  {spd}
                </button>
              );
            })}
          </div>
        </div>

        {/* Exposure Compensation Stepper in Half-Stops */}
        <div className="mt-2.5 pt-2.5 border-t border-zinc-800/80 flex items-center justify-between gap-2">
          <span className="text-[11px] font-mono text-zinc-400 shrink-0">Comp (Stops)</span>
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            {[-1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2].map((stops) => (
              <button
                key={stops}
                onClick={() => setExposureCompEv(stops)}
                className={`px-2 py-1 rounded-md font-mono text-[11px] border shrink-0 ${
                  exposureCompEv === stops
                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 font-bold'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                }`}
              >
                {stops === 0
                  ? '0'
                  : stops > 0
                  ? `+${stops === 0.5 ? '½' : stops === 1.5 ? '1½' : stops}`
                  : `${stops === -0.5 ? '-½' : stops === -1.5 ? '-1½' : stops}`}
              </button>
            ))}
          </div>
        </div>

        {/* Rich Scene Light Telemetry Bar (Captured Automatically into SQLite on Log) */}
        <div className="mt-2.5 pt-2.5 border-t border-zinc-800/80 grid grid-cols-4 gap-1.5 text-center font-mono text-[10px]">
          <div className="bg-zinc-950/70 rounded-lg py-1.5 px-1 border border-zinc-800/60">
            <span className="text-zinc-500 block">SCENE EV₁₀₀</span>
            <span className="text-zinc-200 font-bold">
              {centerEv100.toFixed(1)} {meteringMode === 'spot' ? `(Spot ${spotEv100.toFixed(1)})` : ''}
            </span>
          </div>
          <div className="bg-zinc-950/70 rounded-lg py-1.5 px-1 border border-zinc-800/60">
            <span className="text-zinc-500 block">SHADOW / HI</span>
            <span className="text-zinc-200 font-bold">
              {shadowEv100.toFixed(1)} / {highlightEv100.toFixed(1)}
            </span>
          </div>
          <div className="bg-zinc-950/70 rounded-lg py-1.5 px-1 border border-zinc-800/60">
            <span className="text-zinc-500 block">DYNAMIC RANGE</span>
            <span className="text-emerald-400 font-bold">{formatHalfStops(sceneContrastStops, false)}</span>
          </div>
          <div className="bg-zinc-950/70 rounded-lg py-1.5 px-1 border border-zinc-800/60">
            <span className="text-zinc-500 block">COLOR TEMP</span>
            <span className="text-zinc-200 font-bold">{colorTempK}K</span>
          </div>
        </div>
      </div>

      {/* Quick Scene Tags & Frame Notes */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3 flex flex-col gap-2.5">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {LIGHTING_PRESET_TAGS.map((tag) => {
            const active = selectedTags.includes(tag);
            return (
              <button
                key={tag}
                onClick={() =>
                  setSelectedTags((prev) =>
                    prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                  )
                }
                className={`px-2.5 py-1 rounded-full text-[11px] shrink-0 border transition ${
                  active
                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 font-medium'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={frameNotes}
            onChange={(e) => setFrameNotes(e.target.value)}
            placeholder="Frame notes (e.g. metered skin tone, yellow filter, tripod)..."
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-400"
          />
          <button
            onClick={() => setIncludeGps((v) => !v)}
            className={`p-2 rounded-xl border text-xs flex items-center gap-1 shrink-0 ${
              includeGps
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-zinc-950 border-zinc-800 text-zinc-500'
            }`}
            title="Toggle GPS Coordinate Tagging"
          >
            <MapPin className="w-4 h-4" />
            <span className="font-mono text-[10px]">GPS</span>
          </button>
        </div>
      </div>

      {/* One-Tap Shutter Logger Button */}
      <button
        onClick={handleLogFrame}
        disabled={isLogging}
        className="w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-400 to-teal-400 hover:from-emerald-300 hover:to-teal-300 active:scale-[0.99] text-zinc-950 font-bold text-base shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2.5 transition disabled:opacity-50"
      >
        <Focus className="w-5 h-5" />
        <span>
          {isLogging
            ? 'Saving Frame & Light Telemetry to SQLite...'
            : activeRoll
            ? `Meter & Log Frame #${activeRoll.frameCount + 1} (${finalShutterSpeed}s • f/${finalAperture})`
            : 'Select a Film Roll to Log Frame'}
        </span>
      </button>

      {lastLoggedBanner && (
        <div className="bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 rounded-xl p-3 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{lastLoggedBanner}</span>
        </div>
      )}
    </div>
  );
};
