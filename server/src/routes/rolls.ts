import { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { db, newId, ROLLS_DIR, DATA_DIR } from '../db.js';
import {
  ensureRollDirectories,
  sanitizeFolderSlug,
  writeRollManifestToNas,
  bakeExifIntoJpegBuffer
} from '../services/nasStorage.js';

function mapRollRow(r: any) {
  return {
    id: r.id,
    rollNumber: r.roll_number,
    title: r.title,
    cameraId: r.camera_id,
    cameraName: r.camera_name || null,
    cameraFormat: r.camera_format || null,
    filmStockId: r.film_stock_id,
    filmBrand: r.film_brand,
    filmName: r.film_name,
    filmProcess: r.film_process,
    filmColorType: r.film_color_type,
    boxIso: r.box_iso,
    ratedIso: r.rated_iso,
    pushPullStops: r.push_pull_stops,
    maxFrames: r.max_frames,
    frameCount: r.frame_count ?? 0,
    scannedCount: r.scanned_count ?? 0,
    status: r.status,
    folderName: r.folder_name,
    loadedAt: r.loaded_at,
    finishedAt: r.finished_at,
    labNotes: r.lab_notes
  };
}

function mapFrameRow(f: any, folderName: string) {
  return {
    id: f.id,
    rollId: f.roll_id,
    frameNumber: f.frame_number,
    lensId: f.lens_id,
    lensName: f.lens_name || null,
    focalLengthMm: f.focal_length_mm || null,
    shutterSpeed: f.shutter_speed,
    aperture: f.aperture,
    priorityMode: f.priority_mode || 'aperture',
    meteredEv: f.metered_ev,
    ev100: f.ev100 ?? null,
    centerEv100: f.center_ev100 ?? null,
    spotEv100: f.spot_ev100 ?? null,
    shadowEv100: f.shadow_ev100 ?? null,
    highlightEv100: f.highlight_ev100 ?? null,
    sceneContrastStops: f.scene_contrast_stops ?? null,
    colorTempK: f.color_temp_k ?? null,
    stopDelta: f.stop_delta ?? 0,
    exposureCompEv: f.exposure_comp_ev,
    calibrationEv: f.calibration_ev ?? 0,
    meteringMode: f.metering_mode,
    spotCoordsJson: f.spot_coords_json,
    lightingTags: JSON.parse(f.lighting_tags || '[]'),
    lat: f.lat,
    lng: f.lng,
    capturedAt: f.captured_at,
    refImageUrl: f.ref_image_file ? `/nas/rolls/${folderName}/references/${f.ref_image_file}` : null,
    scanImageUrl: f.scan_image_file ? `/nas/rolls/${folderName}/scans_raw/${f.scan_image_file}` : null,
    taggedScanUrl: f.tagged_scan_file ? `/nas/rolls/${folderName}/scans_tagged/${f.tagged_scan_file}` : null,
    notes: f.notes,
    learningRating: f.learning_rating
  };
}

export async function registerRollRoutes(app: FastifyInstance) {
  // System info (NAS storage directory & roll counts)
  app.get('/api/system', async () => {
    const rollCount = (db.prepare('SELECT COUNT(*) as c FROM rolls').get() as any).c;
    const frameCount = (db.prepare('SELECT COUNT(*) as c FROM frames').get() as any).c;
    return {
      nasDataDir: DATA_DIR,
      rollsDir: ROLLS_DIR,
      rollCount,
      frameCount
    };
  });

  // GET /api/rolls
  app.get('/api/rolls', async (req) => {
    const query = req.query as { status?: string };
    const baseSql = `
      SELECT r.*,
             c.name as camera_name, c.format as camera_format,
             fs.brand as film_brand, fs.name as film_name, fs.process as film_process, fs.color_type as film_color_type,
             (SELECT COUNT(*) FROM frames f WHERE f.roll_id = r.id) as frame_count,
             (SELECT COUNT(*) FROM frames f WHERE f.roll_id = r.id AND f.scan_image_file IS NOT NULL) as scanned_count
      FROM rolls r
      LEFT JOIN cameras c ON r.camera_id = c.id
      JOIN film_stocks fs ON r.film_stock_id = fs.id
    `;

    const rows = query.status
      ? (db.prepare(`${baseSql} WHERE r.status = ? ORDER BY r.roll_number DESC`).all(query.status) as any[])
      : (db.prepare(`${baseSql} ORDER BY r.roll_number DESC`).all() as any[]);

    return rows.map(mapRollRow);
  });

  // GET /api/rolls/:id
  app.get('/api/rolls/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const rollRow = db.prepare(`
      SELECT r.*,
             c.name as camera_name, c.format as camera_format,
             fs.brand as film_brand, fs.name as film_name, fs.process as film_process, fs.color_type as film_color_type,
             (SELECT COUNT(*) FROM frames f WHERE f.roll_id = r.id) as frame_count,
             (SELECT COUNT(*) FROM frames f WHERE f.roll_id = r.id AND f.scan_image_file IS NOT NULL) as scanned_count
      FROM rolls r
      LEFT JOIN cameras c ON r.camera_id = c.id
      JOIN film_stocks fs ON r.film_stock_id = fs.id
      WHERE r.id = ?
    `).get(id) as any;

    if (!rollRow) {
      return reply.code(404).send({ error: 'Roll not found' });
    }

    const cameraRow = rollRow.camera_id
      ? (db.prepare('SELECT * FROM cameras WHERE id = ?').get(rollRow.camera_id) as any)
      : null;

    const stockRow = db.prepare('SELECT * FROM film_stocks WHERE id = ?').get(rollRow.film_stock_id) as any;

    const frameRows = db.prepare(`
      SELECT f.*, l.name as lens_name, l.focal_length_mm
      FROM frames f
      LEFT JOIN lenses l ON f.lens_id = l.id
      WHERE f.roll_id = ?
      ORDER BY f.frame_number ASC
    `).all(id) as any[];

    return {
      ...mapRollRow(rollRow),
      camera: cameraRow
        ? {
            id: cameraRow.id,
            name: cameraRow.name,
            make: cameraRow.make,
            model: cameraRow.model,
            format: cameraRow.format,
            shutterSpeeds: JSON.parse(cameraRow.shutter_speeds || '[]'),
            fixedLensSpec: cameraRow.fixed_lens_spec,
            notes: cameraRow.notes,
            createdAt: cameraRow.created_at
          }
        : null,
      filmStock: {
        id: stockRow.id,
        brand: stockRow.brand,
        name: stockRow.name,
        boxIso: stockRow.box_iso,
        process: stockRow.process,
        colorType: stockRow.color_type,
        defaultFrames: stockRow.default_frames
      },
      frames: frameRows.map((f) => mapFrameRow(f, rollRow.folder_name))
    };
  });

  // POST /api/rolls — Load a new roll into a camera and create NAS folder structure
  app.post('/api/rolls', async (req, reply) => {
    const body = req.body as any;
    const stock = db.prepare('SELECT * FROM film_stocks WHERE id = ?').get(body.filmStockId) as any;
    if (!stock) {
      return reply.code(400).send({ error: 'Invalid filmStockId' });
    }

    const camera = body.cameraId
      ? (db.prepare('SELECT * FROM cameras WHERE id = ?').get(body.cameraId) as any)
      : null;

    // If the camera already has a loaded roll, automatically mark it rewound or return conflict if requested
    if (camera) {
      const existingLoaded = db.prepare(`SELECT id FROM rolls WHERE camera_id = ? AND status = 'loaded'`).get(camera.id) as any;
      if (existingLoaded && !body.autoUnloadExisting) {
        return reply.code(409).send({
          error: 'Camera already has a loaded roll. Unload or rewind it first, or pass autoUnloadExisting: true.'
        });
      }
      if (existingLoaded && body.autoUnloadExisting) {
        db.prepare(`UPDATE rolls SET status = 'rewound', finished_at = ? WHERE id = ?`).run(
          new Date().toISOString(),
          existingLoaded.id
        );
      }
    }

    const maxRollNum = (db.prepare('SELECT COALESCE(MAX(roll_number), 0) as maxNum FROM rolls').get() as any).maxNum;
    const rollNumber = maxRollNum + 1;
    const ratedIso = Number(body.ratedIso) || stock.box_iso;
    const pushPullStops = Math.round(Math.log2(ratedIso / stock.box_iso) * 10) / 10;
    const maxFrames = Number(body.maxFrames) || stock.default_frames;

    const paddedNum = String(rollNumber).padStart(3, '0');
    const camSlug = camera ? sanitizeFolderSlug(`${camera.make}-${camera.model}`) : 'Unassigned';
    const filmSlug = sanitizeFolderSlug(`${stock.brand}-${stock.name}`);
    const folderName = `Roll-${paddedNum}_${camSlug}_${filmSlug}_EI${ratedIso}`;

    ensureRollDirectories(folderName);

    const id = newId('roll');
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO rolls (
        id, roll_number, title, camera_id, film_stock_id,
        box_iso, rated_iso, push_pull_stops, max_frames,
        status, folder_name, loaded_at, finished_at, lab_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'loaded', ?, ?, NULL, ?)
    `).run(
      id,
      rollNumber,
      body.title || `Roll #${rollNumber} - ${stock.name}`,
      camera ? camera.id : null,
      stock.id,
      stock.box_iso,
      ratedIso,
      pushPullStops,
      maxFrames,
      folderName,
      now,
      body.labNotes || null
    );

    writeRollManifestToNas(id);

    return { id, rollNumber, folderName };
  });

  // PATCH /api/rolls/:id — Update status (loaded -> rewound -> at_lab -> scanned), swap camera, or update lab notes
  app.patch('/api/rolls/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;

    const existing = db.prepare('SELECT * FROM rolls WHERE id = ?').get(id) as any;
    if (!existing) {
      return reply.code(404).send({ error: 'Roll not found' });
    }

    const newStatus = body.status ?? existing.status;
    const newCameraId = body.cameraId !== undefined ? body.cameraId : existing.camera_id;
    const newRatedIso = body.ratedIso !== undefined ? Number(body.ratedIso) : existing.rated_iso;
    const newPushPull = Math.round(Math.log2(newRatedIso / existing.box_iso) * 10) / 10;
    const newTitle = body.title ?? existing.title;
    const newLabNotes = body.labNotes !== undefined ? body.labNotes : existing.lab_notes;
    const finishedAt =
      newStatus !== 'loaded' && !existing.finished_at ? new Date().toISOString() : existing.finished_at;

    db.prepare(`
      UPDATE rolls
      SET status = ?, camera_id = ?, rated_iso = ?, push_pull_stops = ?, title = ?, lab_notes = ?, finished_at = ?
      WHERE id = ?
    `).run(newStatus, newCameraId, newRatedIso, newPushPull, newTitle, newLabNotes, finishedAt, id);

    writeRollManifestToNas(id);

    return { ok: true };
  });

  // POST /api/rolls/:id/frames — Log a metered frame + save digital reference snapshot to NAS
  app.post('/api/rolls/:id/frames', async (req, reply) => {
    const { id: rollId } = req.params as { id: string };
    const roll = db.prepare('SELECT * FROM rolls WHERE id = ?').get(rollId) as any;
    if (!roll) {
      return reply.code(404).send({ error: 'Roll not found' });
    }

    const { refsDir } = ensureRollDirectories(roll.folder_name);

    let meta: any = {};
    let refBuffer: Buffer | null = null;

    if (req.isMultipart()) {
      const parts = req.parts();
      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'refImage') {
          refBuffer = await part.toBuffer();
        } else if (part.type === 'field') {
          if (part.fieldname === 'metadata') {
            try {
              meta = JSON.parse(String(part.value));
            } catch {
              meta = {};
            }
          } else {
            meta[part.fieldname] = part.value;
          }
        }
      }
    } else {
      meta = (req.body as any) || {};
      if (meta.refImageDataUrl && typeof meta.refImageDataUrl === 'string') {
        const base64Data = meta.refImageDataUrl.replace(/^data:image\/\w+;base64,/, '');
        refBuffer = Buffer.from(base64Data, 'base64');
      }
    }

    // Determine next frame number if not explicitly provided
    const maxFrameRow = db
      .prepare('SELECT COALESCE(MAX(frame_number), 0) as maxFrame FROM frames WHERE roll_id = ?')
      .get(rollId) as { maxFrame: number };
    const frameNumber = meta.frameNumber ? Number(meta.frameNumber) : maxFrameRow.maxFrame + 1;
    const paddedFrame = String(frameNumber).padStart(2, '0');

    let refFileName: string | null = null;
    if (refBuffer && refBuffer.length > 0) {
      refFileName = `frame-${paddedFrame}_ref.jpg`;
      fs.writeFileSync(path.join(refsDir, refFileName), refBuffer);
    }

    const frameId = newId('frame');
    const capturedAt = meta.capturedAt || new Date().toISOString();
    const lightingTags = Array.isArray(meta.lightingTags) ? meta.lightingTags : [];

    db.prepare(`
      INSERT INTO frames (
        id, roll_id, frame_number, lens_id,
        shutter_speed, aperture, priority_mode,
        metered_ev, ev100, center_ev100, spot_ev100,
        shadow_ev100, highlight_ev100, scene_contrast_stops, color_temp_k,
        stop_delta, exposure_comp_ev, calibration_ev,
        metering_mode, spot_coords_json, lighting_tags,
        lat, lng, captured_at, ref_image_file, notes, learning_rating
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      frameId,
      rollId,
      frameNumber,
      meta.lensId || null,
      meta.shutterSpeed || '1/125',
      Number(meta.aperture) || 5.6,
      meta.priorityMode || 'aperture',
      meta.meteredEv !== undefined && meta.meteredEv !== null ? Number(meta.meteredEv) : null,
      meta.ev100 !== undefined && meta.ev100 !== null ? Number(meta.ev100) : null,
      meta.centerEv100 !== undefined && meta.centerEv100 !== null ? Number(meta.centerEv100) : null,
      meta.spotEv100 !== undefined && meta.spotEv100 !== null ? Number(meta.spotEv100) : null,
      meta.shadowEv100 !== undefined && meta.shadowEv100 !== null ? Number(meta.shadowEv100) : null,
      meta.highlightEv100 !== undefined && meta.highlightEv100 !== null ? Number(meta.highlightEv100) : null,
      meta.sceneContrastStops !== undefined && meta.sceneContrastStops !== null ? Number(meta.sceneContrastStops) : null,
      meta.colorTempK !== undefined && meta.colorTempK !== null ? Math.round(Number(meta.colorTempK)) : null,
      Number(meta.stopDelta) || 0,
      Number(meta.exposureCompEv) || 0,
      Number(meta.calibrationEv) || 0,
      meta.meteringMode || 'center',
      meta.spotCoords ? JSON.stringify(meta.spotCoords) : null,
      JSON.stringify(lightingTags),
      meta.lat !== undefined && meta.lat !== null ? Number(meta.lat) : null,
      meta.lng !== undefined && meta.lng !== null ? Number(meta.lng) : null,
      capturedAt,
      refFileName,
      meta.notes || null,
      meta.learningRating ? Number(meta.learningRating) : null
    );

    writeRollManifestToNas(rollId);

    const created = db.prepare(`
      SELECT f.*, l.name as lens_name, l.focal_length_mm
      FROM frames f
      LEFT JOIN lenses l ON f.lens_id = l.id
      WHERE f.id = ?
    `).get(frameId) as any;

    return mapFrameRow(created, roll.folder_name);
  });

  // PATCH /api/frames/:id — Update frame notes, learning rating, or exposure metadata
  app.patch('/api/frames/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;

    const frame = db.prepare('SELECT * FROM frames WHERE id = ?').get(id) as any;
    if (!frame) {
      return reply.code(404).send({ error: 'Frame not found' });
    }

    const notes = body.notes !== undefined ? body.notes : frame.notes;
    const learningRating = body.learningRating !== undefined ? body.learningRating : frame.learning_rating;
    const shutterSpeed = body.shutterSpeed ?? frame.shutter_speed;
    const aperture = body.aperture !== undefined ? Number(body.aperture) : frame.aperture;
    const frameNumber = body.frameNumber !== undefined ? Number(body.frameNumber) : frame.frame_number;
    const lightingTags =
      body.lightingTags !== undefined ? JSON.stringify(body.lightingTags) : frame.lighting_tags;

    db.prepare(`
      UPDATE frames
      SET notes = ?, learning_rating = ?, shutter_speed = ?, aperture = ?, frame_number = ?, lighting_tags = ?
      WHERE id = ?
    `).run(notes, learningRating, shutterSpeed, aperture, frameNumber, lightingTags, id);

    writeRollManifestToNas(frame.roll_id);

    return { ok: true };
  });

  // POST /api/frames/:id/scan — Upload a lab film scan for a specific frame and automatically bake EXIF onto NAS
  app.post('/api/frames/:id/scan', async (req, reply) => {
    const { id: frameId } = req.params as { id: string };
    const frame = db.prepare(`
      SELECT f.*,
             r.roll_number, r.folder_name, r.rated_iso, r.box_iso,
             c.make as camera_make, c.model as camera_model,
             fs.brand as film_brand, fs.name as film_name,
             l.name as lens_name, l.focal_length_mm
      FROM frames f
      JOIN rolls r ON f.roll_id = r.id
      LEFT JOIN cameras c ON r.camera_id = c.id
      JOIN film_stocks fs ON r.film_stock_id = fs.id
      LEFT JOIN lenses l ON f.lens_id = l.id
      WHERE f.id = ?
    `).get(frameId) as any;

    if (!frame) {
      return reply.code(404).send({ error: 'Frame not found' });
    }

    let scanBuffer: Buffer | null = null;
    if (req.isMultipart()) {
      const data = await req.file();
      if (data) {
        scanBuffer = await data.toBuffer();
      }
    } else {
      const body = req.body as any;
      if (body?.scanDataUrl) {
        const base64Data = body.scanDataUrl.replace(/^data:image\/\w+;base64,/, '');
        scanBuffer = Buffer.from(base64Data, 'base64');
      }
    }

    if (!scanBuffer || scanBuffer.length === 0) {
      return reply.code(400).send({ error: 'No scan image provided' });
    }

    const { scansRawDir, scansTaggedDir } = ensureRollDirectories(frame.folder_name);
    const paddedFrame = String(frame.frame_number).padStart(2, '0');
    const rawFileName = `frame-${paddedFrame}_scan.jpg`;
    const taggedFileName = `frame-${paddedFrame}_tagged.jpg`;

    // Save untouched raw scan
    fs.writeFileSync(path.join(scansRawDir, rawFileName), scanBuffer);

    // Bake EXIF metadata (Camera, Lens, Film Stock, Rated ISO, Shutter, Aperture, Timestamp, GPS)
    const taggedBuffer = bakeExifIntoJpegBuffer(scanBuffer, {
      cameraMake: frame.camera_make || 'Analog',
      cameraModel: frame.camera_model || 'Film Camera',
      lensName: frame.lens_name || null,
      focalLengthMm: frame.focal_length_mm || null,
      filmDescription: `${frame.film_brand} ${frame.film_name}`,
      ratedIso: frame.rated_iso,
      boxIso: frame.box_iso,
      rollNumber: frame.roll_number,
      frameNumber: frame.frame_number,
      shutterSpeed: frame.shutter_speed,
      aperture: frame.aperture,
      capturedAt: frame.captured_at,
      lat: frame.lat,
      lng: frame.lng,
      notes: frame.notes
    });

    fs.writeFileSync(path.join(scansTaggedDir, taggedFileName), taggedBuffer);

    db.prepare(`
      UPDATE frames
      SET scan_image_file = ?, tagged_scan_file = ?
      WHERE id = ?
    `).run(rawFileName, taggedFileName, frameId);

    writeRollManifestToNas(frame.roll_id);

    const updated = db.prepare(`
      SELECT f.*, l.name as lens_name, l.focal_length_mm
      FROM frames f
      LEFT JOIN lenses l ON f.lens_id = l.id
      WHERE f.id = ?
    `).get(frameId) as any;

    return mapFrameRow(updated, frame.folder_name);
  });
}
