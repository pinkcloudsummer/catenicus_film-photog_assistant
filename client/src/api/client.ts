import type { Camera, Lens, FilmStock, RollSummary, RollDetail, Frame } from '@catenicus/shared';

export interface SystemInfo {
  nasDataDir: string;
  rollsDir: string;
  rollCount: number;
  frameCount: number;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers
    }
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  getSystemInfo: () => fetchJson<SystemInfo>('/api/system'),
  getCameras: () => fetchJson<Camera[]>('/api/cameras'),
  createCamera: (data: Partial<Camera>) =>
    fetchJson<{ id: string }>('/api/cameras', { method: 'POST', body: JSON.stringify(data) }),

  getLenses: () => fetchJson<Lens[]>('/api/lenses'),
  createLens: (data: Partial<Lens>) =>
    fetchJson<{ id: string }>('/api/lenses', { method: 'POST', body: JSON.stringify(data) }),

  getFilmStocks: () => fetchJson<FilmStock[]>('/api/film-stocks'),
  createFilmStock: (data: Partial<FilmStock>) =>
    fetchJson<{ id: string }>('/api/film-stocks', { method: 'POST', body: JSON.stringify(data) }),

  getRolls: (status?: string) =>
    fetchJson<RollSummary[]>(status ? `/api/rolls?status=${encodeURIComponent(status)}` : '/api/rolls'),
  getRollDetail: (id: string) => fetchJson<RollDetail>(`/api/rolls/${id}`),
  createRoll: (data: {
    title?: string;
    cameraId?: string | null;
    filmStockId: string;
    ratedIso: number;
    maxFrames?: number;
    labNotes?: string;
    autoUnloadExisting?: boolean;
  }) => fetchJson<{ id: string; rollNumber: number; folderName: string }>('/api/rolls', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  updateRoll: (id: string, data: Partial<RollSummary>) =>
    fetchJson<{ ok: boolean }>(`/api/rolls/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  logFrame: (rollId: string, payload: {
    frameNumber?: number;
    lensId?: string | null;
    shutterSpeed: string;
    aperture: number;
    priorityMode?: 'aperture' | 'shutter' | 'manual';
    meteredEv: number;
    ev100?: number;
    centerEv100?: number;
    spotEv100?: number;
    shadowEv100?: number;
    highlightEv100?: number;
    sceneContrastStops?: number;
    colorTempK?: number;
    stopDelta?: number;
    exposureCompEv: number;
    calibrationEv?: number;
    meteringMode: 'center' | 'spot';
    spotCoords?: { x: number; y: number } | null;
    lightingTags?: string[];
    lat?: number | null;
    lng?: number | null;
    notes?: string;
    refImageDataUrl?: string | null;
  }) =>
    fetchJson<Frame>(`/api/rolls/${rollId}/frames`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }),

  updateFrame: (frameId: string, data: Partial<Frame>) =>
    fetchJson<{ ok: boolean }>(`/api/frames/${frameId}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    }),

  uploadFrameScan: (frameId: string, file: File) => {
    const form = new FormData();
    form.append('scan', file);
    return fetchJson<Frame>(`/api/frames/${frameId}/scan`, {
      method: 'POST',
      body: form
    });
  },

  uploadFrameScanDataUrl: (frameId: string, scanDataUrl: string) =>
    fetchJson<Frame>(`/api/frames/${frameId}/scan`, {
      method: 'POST',
      body: JSON.stringify({ scanDataUrl })
    })
};
