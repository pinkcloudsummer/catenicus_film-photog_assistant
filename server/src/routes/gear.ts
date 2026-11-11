import { FastifyInstance } from 'fastify';
import { db, newId } from '../db.js';
import { STANDARD_SHUTTER_SPEEDS, STANDARD_APERTURES } from '@catenicus/shared';

export async function registerGearRoutes(app: FastifyInstance) {
  // GET /api/cameras — returns all cameras along with their currently loaded roll (if any)
  app.get('/api/cameras', async () => {
    const cameras = db.prepare('SELECT * FROM cameras ORDER BY created_at ASC').all() as any[];
    const loadedRolls = db.prepare(`
      SELECT r.*, fs.brand as film_brand, fs.name as film_name, fs.process as film_process, fs.color_type as film_color_type,
             (SELECT COUNT(*) FROM frames f WHERE f.roll_id = r.id) as frame_count,
             (SELECT COUNT(*) FROM frames f WHERE f.roll_id = r.id AND f.scan_image_file IS NOT NULL) as scanned_count
      FROM rolls r
      JOIN film_stocks fs ON r.film_stock_id = fs.id
      WHERE r.status = 'loaded'
    `).all() as any[];

    const rollByCamera = new Map<string, any>();
    for (const r of loadedRolls) {
      if (r.camera_id) {
        rollByCamera.set(r.camera_id, {
          id: r.id,
          rollNumber: r.roll_number,
          title: r.title,
          cameraId: r.camera_id,
          filmStockId: r.film_stock_id,
          filmBrand: r.film_brand,
          filmName: r.film_name,
          filmProcess: r.film_process,
          filmColorType: r.film_color_type,
          boxIso: r.box_iso,
          ratedIso: r.rated_iso,
          pushPullStops: r.push_pull_stops,
          maxFrames: r.max_frames,
          frameCount: r.frame_count,
          scannedCount: r.scanned_count,
          status: r.status,
          folderName: r.folder_name,
          loadedAt: r.loaded_at,
          finishedAt: r.finished_at,
          labNotes: r.lab_notes
        });
      }
    }

    return cameras.map((c) => ({
      id: c.id,
      name: c.name,
      make: c.make,
      model: c.model,
      format: c.format,
      shutterSpeeds: JSON.parse(c.shutter_speeds || '[]'),
      fixedLensSpec: c.fixed_lens_spec,
      notes: c.notes,
      createdAt: c.created_at,
      activeRoll: rollByCamera.get(c.id) || null
    }));
  });

  app.post('/api/cameras', async (req) => {
    const body = req.body as any;
    const id = newId('cam');
    const now = new Date().toISOString();
    const shutterSpeeds = Array.isArray(body.shutterSpeeds) && body.shutterSpeeds.length > 0
      ? body.shutterSpeeds
      : STANDARD_SHUTTER_SPEEDS;

    db.prepare(`
      INSERT INTO cameras (id, name, make, model, format, shutter_speeds, fixed_lens_spec, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      body.name || `${body.make} ${body.model}`,
      body.make || 'Custom',
      body.model || 'Camera',
      body.format || '35mm',
      JSON.stringify(shutterSpeeds),
      body.fixedLensSpec || null,
      body.notes || null,
      now
    );

    return { id };
  });

  // GET /api/lenses
  app.get('/api/lenses', async () => {
    const rows = db.prepare('SELECT * FROM lenses ORDER BY focal_length_mm ASC').all() as any[];
    return rows.map((l) => ({
      id: l.id,
      cameraId: l.camera_id,
      name: l.name,
      focalLengthMm: l.focal_length_mm,
      maxAperture: l.max_aperture,
      minAperture: l.min_aperture,
      apertures: JSON.parse(l.apertures || '[]'),
      mount: l.mount,
      createdAt: l.created_at
    }));
  });

  app.post('/api/lenses', async (req) => {
    const body = req.body as any;
    const id = newId('lens');
    const now = new Date().toISOString();
    const maxAp = Number(body.maxAperture) || 2;
    const minAp = Number(body.minAperture) || 16;
    const apertures = STANDARD_APERTURES.filter((a) => a >= maxAp && a <= minAp);
    if (!apertures.includes(maxAp)) apertures.unshift(maxAp);

    db.prepare(`
      INSERT INTO lenses (id, camera_id, name, focal_length_mm, max_aperture, min_aperture, apertures, mount, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      body.cameraId || null,
      body.name,
      Number(body.focalLengthMm) || 50,
      maxAp,
      minAp,
      JSON.stringify(apertures),
      body.mount || null,
      now
    );

    return { id };
  });

  // GET /api/film-stocks
  app.get('/api/film-stocks', async () => {
    const rows = db.prepare('SELECT * FROM film_stocks ORDER BY brand ASC, box_iso ASC').all() as any[];
    return rows.map((s) => ({
      id: s.id,
      brand: s.brand,
      name: s.name,
      boxIso: s.box_iso,
      process: s.process,
      colorType: s.color_type,
      defaultFrames: s.default_frames
    }));
  });

  app.post('/api/film-stocks', async (req) => {
    const body = req.body as any;
    const id = newId('stock');
    db.prepare(`
      INSERT INTO film_stocks (id, brand, name, box_iso, process, color_type, default_frames)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      body.brand,
      body.name,
      Number(body.boxIso) || 400,
      body.process || 'C-41',
      body.colorType || 'color_neg',
      Number(body.defaultFrames) || 36
    );
    return { id };
  });
}
