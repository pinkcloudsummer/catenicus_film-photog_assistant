export type FilmFormat = '35mm' | '120_645' | '120_6x6' | '120_6x7' | '120_6x9' | '4x5';

export type FilmProcess = 'C-41' | 'BW' | 'E-6' | 'ECN-2';

export type FilmColorType = 'color_neg' | 'bw' | 'slide';

export type RollStatus = 'loaded' | 'rewound' | 'at_lab' | 'scanned' | 'archived';

export type MeteringMode = 'center' | 'spot';

export type PriorityMode = 'aperture' | 'shutter' | 'manual';

export interface Camera {
  id: string;
  name: string;
  make: string;
  model: string;
  format: FilmFormat;
  shutterSpeeds: string[];
  fixedLensSpec: string | null;
  notes: string | null;
  createdAt: string;
  activeRoll?: RollSummary | null;
}

export interface Lens {
  id: string;
  cameraId: string | null;
  name: string;
  focalLengthMm: number;
  maxAperture: number;
  minAperture: number;
  apertures: number[];
  mount: string | null;
  createdAt: string;
}

export interface FilmStock {
  id: string;
  brand: string;
  name: string;
  boxIso: number;
  process: FilmProcess;
  colorType: FilmColorType;
  defaultFrames: number;
}

export interface RollSummary {
  id: string;
  rollNumber: number;
  title: string;
  cameraId: string | null;
  cameraName?: string | null;
  cameraFormat?: FilmFormat | null;
  filmStockId: string;
  filmBrand?: string;
  filmName?: string;
  filmProcess?: FilmProcess;
  filmColorType?: FilmColorType;
  boxIso: number;
  ratedIso: number;
  pushPullStops: number;
  maxFrames: number;
  frameCount: number;
  scannedCount: number;
  status: RollStatus;
  folderName: string;
  loadedAt: string;
  finishedAt: string | null;
  labNotes: string | null;
}

export interface Frame {
  id: string;
  rollId: string;
  frameNumber: number;
  lensId: string | null;
  lensName?: string | null;
  focalLengthMm?: number | null;
  shutterSpeed: string;
  aperture: number;
  priorityMode: PriorityMode;
  meteredEv: number | null;
  ev100: number | null;
  centerEv100: number | null;
  spotEv100: number | null;
  shadowEv100: number | null;
  highlightEv100: number | null;
  sceneContrastStops: number | null;
  colorTempK: number | null;
  stopDelta: number;
  exposureCompEv: number;
  calibrationEv: number;
  meteringMode: MeteringMode;
  spotCoordsJson: string | null;
  lightingTags: string[];
  lat: number | null;
  lng: number | null;
  capturedAt: string;
  refImageUrl: string | null;
  scanImageUrl: string | null;
  taggedScanUrl: string | null;
  notes: string | null;
  learningRating: number | null;
}

export interface RollDetail extends RollSummary {
  camera: Camera | null;
  filmStock: FilmStock;
  frames: Frame[];
}

export const STANDARD_SHUTTER_SPEEDS = [
  '1/4000',
  '1/2000',
  '1/1000',
  '1/500',
  '1/250',
  '1/125',
  '1/60',
  '1/30',
  '1/15',
  '1/8',
  '1/4',
  '1/2',
  '1',
  '2',
  '4',
  '8'
];

export const STANDARD_APERTURES = [
  1.2, 1.4, 1.8, 2, 2.8, 4, 5.6, 8, 11, 16, 22
];

export const FORMAT_ASPECT_RATIOS: Record<FilmFormat, { label: string; ratio: number }> = {
  '35mm': { label: '35mm (3:2)', ratio: 3 / 2 },
  '120_645': { label: '6x4.5 (4:3)', ratio: 4 / 3 },
  '120_6x6': { label: '6x6 (1:1)', ratio: 1 },
  '120_6x7': { label: '6x7 (7:6)', ratio: 7 / 6 },
  '120_6x9': { label: '6x9 (3:2)', ratio: 3 / 2 },
  '4x5': { label: '4x5 LF (5:4)', ratio: 5 / 4 }
};
