import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { STANDARD_SHUTTER_SPEEDS } from '@catenicus/shared';

export const DATA_DIR = process.env.CATENICUS_DATA_DIR
  ? path.resolve(process.env.CATENICUS_DATA_DIR)
  : path.resolve(process.cwd(), '..', 'data');

export const ROLLS_DIR = path.join(DATA_DIR, 'rolls');

fs.mkdirSync(ROLLS_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, 'catenicus.sqlite');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cameras (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      make TEXT NOT NULL,
      model TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT '35mm',
      shutter_speeds TEXT NOT NULL,
      fixed_lens_spec TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lenses (
      id TEXT PRIMARY KEY,
      camera_id TEXT REFERENCES cameras(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      focal_length_mm INTEGER NOT NULL,
      max_aperture REAL NOT NULL,
      min_aperture REAL NOT NULL,
      apertures TEXT NOT NULL,
      mount TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS film_stocks (
      id TEXT PRIMARY KEY,
      brand TEXT NOT NULL,
      name TEXT NOT NULL,
      box_iso INTEGER NOT NULL,
      process TEXT NOT NULL,
      color_type TEXT NOT NULL,
      default_frames INTEGER NOT NULL DEFAULT 36
    );

    CREATE TABLE IF NOT EXISTS rolls (
      id TEXT PRIMARY KEY,
      roll_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      camera_id TEXT REFERENCES cameras(id) ON DELETE SET NULL,
      film_stock_id TEXT NOT NULL REFERENCES film_stocks(id),
      box_iso INTEGER NOT NULL,
      rated_iso INTEGER NOT NULL,
      push_pull_stops REAL NOT NULL DEFAULT 0,
      max_frames INTEGER NOT NULL DEFAULT 36,
      status TEXT NOT NULL DEFAULT 'loaded',
      folder_name TEXT NOT NULL,
      loaded_at TEXT NOT NULL,
      finished_at TEXT,
      lab_notes TEXT
    );

    CREATE TABLE IF NOT EXISTS frames (
      id TEXT PRIMARY KEY,
      roll_id TEXT NOT NULL REFERENCES rolls(id) ON DELETE CASCADE,
      frame_number INTEGER NOT NULL,
      lens_id TEXT REFERENCES lenses(id) ON DELETE SET NULL,
      shutter_speed TEXT NOT NULL,
      aperture REAL NOT NULL,
      priority_mode TEXT NOT NULL DEFAULT 'aperture',
      metered_ev REAL,
      ev100 REAL,
      center_ev100 REAL,
      spot_ev100 REAL,
      shadow_ev100 REAL,
      highlight_ev100 REAL,
      scene_contrast_stops REAL,
      color_temp_k INTEGER,
      stop_delta REAL NOT NULL DEFAULT 0,
      exposure_comp_ev REAL NOT NULL DEFAULT 0,
      calibration_ev REAL NOT NULL DEFAULT 0,
      metering_mode TEXT NOT NULL DEFAULT 'center',
      spot_coords_json TEXT,
      lighting_tags TEXT NOT NULL DEFAULT '[]',
      lat REAL,
      lng REAL,
      captured_at TEXT NOT NULL,
      ref_image_file TEXT,
      scan_image_file TEXT,
      tagged_scan_file TEXT,
      notes TEXT,
      learning_rating INTEGER
    );
  `);

  migrateColumns();
  seedInitialData();
}

function migrateColumns() {
  const existingCols = (db.prepare(`PRAGMA table_info(frames)`).all() as any[]).map((c) => c.name);
  const addColIfMissing = (colName: string, colDef: string) => {
    if (!existingCols.includes(colName)) {
      db.exec(`ALTER TABLE frames ADD COLUMN ${colName} ${colDef}`);
    }
  };

  addColIfMissing('priority_mode', "TEXT NOT NULL DEFAULT 'aperture'");
  addColIfMissing('ev100', 'REAL');
  addColIfMissing('center_ev100', 'REAL');
  addColIfMissing('spot_ev100', 'REAL');
  addColIfMissing('shadow_ev100', 'REAL');
  addColIfMissing('highlight_ev100', 'REAL');
  addColIfMissing('scene_contrast_stops', 'REAL');
  addColIfMissing('color_temp_k', 'INTEGER');
  addColIfMissing('stop_delta', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('calibration_ev', 'REAL NOT NULL DEFAULT 0');

  // Ensure Minolta SR 505 is seeded as a camera option if not present
  const minoltaExists = db.prepare(`SELECT id FROM cameras WHERE id = 'cam-minolta-sr505'`).get();
  if (!minoltaExists) {
    const now = new Date().toISOString();
    const sr505Speeds = ['1/1000', '1/500', '1/250', '1/125', '1/60', '1/30', '1/15', '1/8', '1/4', '1/2', '1'];
    db.prepare(`
      INSERT INTO cameras (id, name, make, model, format, shutter_speeds, fixed_lens_spec, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'cam-minolta-sr505',
      'Minolta SR 505',
      'Minolta',
      'SR 505',
      '35mm',
      JSON.stringify(sr505Speeds),
      null,
      'Mechanical 35mm SLR with match-needle viewfinder',
      now
    );

    db.prepare(`
      INSERT INTO lenses (id, camera_id, name, focal_length_mm, max_aperture, min_aperture, apertures, mount, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'lens-rokkor-50-17',
      'cam-minolta-sr505',
      'Minolta MC Rokkor-PF 50mm f/1.7',
      50,
      1.7,
      16,
      JSON.stringify([1.7, 2, 2.8, 4, 5.6, 8, 11, 16]),
      'Minolta SR / MC',
      now
    );
  }
}

function seedInitialData() {
  const stockCount = db.prepare('SELECT COUNT(*) as count FROM film_stocks').get() as { count: number };
  if (stockCount.count === 0) {
    const insertStock = db.prepare(`
      INSERT INTO film_stocks (id, brand, name, box_iso, process, color_type, default_frames)
      VALUES (@id, @brand, @name, @boxIso, @process, @colorType, @defaultFrames)
    `);

    const defaultStocks = [
      { id: 'kodak-portra-400', brand: 'Kodak', name: 'Portra 400', boxIso: 400, process: 'C-41', colorType: 'color_neg', defaultFrames: 36 },
      { id: 'kodak-portra-160', brand: 'Kodak', name: 'Portra 160', boxIso: 160, process: 'C-41', colorType: 'color_neg', defaultFrames: 36 },
      { id: 'kodak-portra-800', brand: 'Kodak', name: 'Portra 800', boxIso: 800, process: 'C-41', colorType: 'color_neg', defaultFrames: 36 },
      { id: 'kodak-gold-200', brand: 'Kodak', name: 'Gold 200', boxIso: 200, process: 'C-41', colorType: 'color_neg', defaultFrames: 36 },
      { id: 'kodak-ultramax-400', brand: 'Kodak', name: 'UltraMax 400', boxIso: 400, process: 'C-41', colorType: 'color_neg', defaultFrames: 36 },
      { id: 'kodak-trix-400', brand: 'Kodak', name: 'Tri-X 400', boxIso: 400, process: 'BW', colorType: 'bw', defaultFrames: 36 },
      { id: 'kodak-ektar-100', brand: 'Kodak', name: 'Ektar 100', boxIso: 100, process: 'C-41', colorType: 'color_neg', defaultFrames: 36 },
      { id: 'kodak-ektachrome-e100', brand: 'Kodak', name: 'Ektachrome E100', boxIso: 100, process: 'E-6', colorType: 'slide', defaultFrames: 36 },
      { id: 'ilford-hp5-400', brand: 'Ilford', name: 'HP5 Plus 400', boxIso: 400, process: 'BW', colorType: 'bw', defaultFrames: 36 },
      { id: 'ilford-fp4-125', brand: 'Ilford', name: 'FP4 Plus 125', boxIso: 125, process: 'BW', colorType: 'bw', defaultFrames: 36 },
      { id: 'ilford-delta-3200', brand: 'Ilford', name: 'Delta 3200', boxIso: 3200, process: 'BW', colorType: 'bw', defaultFrames: 36 },
      { id: 'cinestill-800t', brand: 'CineStill', name: '800T Tungsten', boxIso: 800, process: 'C-41', colorType: 'color_neg', defaultFrames: 36 },
      { id: 'cinestill-400d', brand: 'CineStill', name: '400D Daylight', boxIso: 400, process: 'C-41', colorType: 'color_neg', defaultFrames: 36 },
      { id: 'fujifilm-400', brand: 'Fujifilm', name: 'Fuji 400', boxIso: 400, process: 'C-41', colorType: 'color_neg', defaultFrames: 36 },
      { id: 'fujifilm-velvia-50', brand: 'Fujifilm', name: 'Velvia 50', boxIso: 50, process: 'E-6', colorType: 'slide', defaultFrames: 36 }
    ];

    const tx = db.transaction(() => {
      for (const s of defaultStocks) {
        insertStock.run(s);
      }
    });
    tx();
  }

  const cameraCount = db.prepare('SELECT COUNT(*) as count FROM cameras').get() as { count: number };
  if (cameraCount.count === 0) {
    const now = new Date().toISOString();
    const ae1Speeds = ['1/1000', '1/500', '1/250', '1/125', '1/60', '1/30', '1/15', '1/8', '1/4', '1/2', '1', '2'];
    const m6Speeds = ['1/1000', '1/500', '1/250', '1/125', '1/60', '1/30', '1/15', '1/8', '1/4', '1/2', '1'];
    const hassySpeeds = ['1/500', '1/250', '1/125', '1/60', '1/30', '1/15', '1/8', '1/4', '1/2', '1'];

    db.prepare(`
      INSERT INTO cameras (id, name, make, model, format, shutter_speeds, fixed_lens_spec, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('cam-canon-ae1', 'Canon AE-1 Program', 'Canon', 'AE-1 Program', '35mm', JSON.stringify(ae1Speeds), null, 'Primary 35mm SLR body', now);

    db.prepare(`
      INSERT INTO cameras (id, name, make, model, format, shutter_speeds, fixed_lens_spec, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('cam-leica-m6', 'Leica M6 TTL', 'Leica', 'M6', '35mm', JSON.stringify(m6Speeds), null, 'Rangefinder street body', now);

    db.prepare(`
      INSERT INTO cameras (id, name, make, model, format, shutter_speeds, fixed_lens_spec, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('cam-hasselblad-500cm', 'Hasselblad 500C/M', 'Hasselblad', '500C/M', '120_6x6', JSON.stringify(hassySpeeds), null, '6x6 medium format modular system', now);

    // Seed lenses
    db.prepare(`
      INSERT INTO lenses (id, camera_id, name, focal_length_mm, max_aperture, min_aperture, apertures, mount, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('lens-fd-50-14', 'cam-canon-ae1', 'Canon FD 50mm f/1.4 S.S.C.', 50, 1.4, 16, JSON.stringify([1.4, 2, 2.8, 4, 5.6, 8, 11, 16]), 'Canon FD', now);

    db.prepare(`
      INSERT INTO lenses (id, camera_id, name, focal_length_mm, max_aperture, min_aperture, apertures, mount, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('lens-fd-28-28', 'cam-canon-ae1', 'Canon New FD 28mm f/2.8', 28, 2.8, 22, JSON.stringify([2.8, 4, 5.6, 8, 11, 16, 22]), 'Canon FD', now);

    db.prepare(`
      INSERT INTO lenses (id, camera_id, name, focal_length_mm, max_aperture, min_aperture, apertures, mount, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('lens-summicron-35-2', 'cam-leica-m6', 'Summicron-M 35mm f/2 ASPH', 35, 2, 16, JSON.stringify([2, 2.8, 4, 5.6, 8, 11, 16]), 'Leica M', now);

    db.prepare(`
      INSERT INTO lenses (id, camera_id, name, focal_length_mm, max_aperture, min_aperture, apertures, mount, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('lens-planar-80-28', 'cam-hasselblad-500cm', 'Carl Zeiss Planar 80mm f/2.8 T*', 80, 2.8, 22, JSON.stringify([2.8, 4, 5.6, 8, 11, 16, 22]), 'Hasselblad V', now);

    // Seed one sample loaded roll in the Canon AE-1 and one pushed BW roll in the Leica M6
    const roll1Folder = 'Roll-001_Canon-AE1_Portra-400_EI400';
    const roll2Folder = 'Roll-002_Leica-M6_HP5-Plus-400_EI1600';

    for (const folder of [roll1Folder, roll2Folder]) {
      fs.mkdirSync(path.join(ROLLS_DIR, folder, 'references'), { recursive: true });
      fs.mkdirSync(path.join(ROLLS_DIR, folder, 'scans_raw'), { recursive: true });
      fs.mkdirSync(path.join(ROLLS_DIR, folder, 'scans_tagged'), { recursive: true });
    }

    db.prepare(`
      INSERT INTO rolls (id, roll_number, title, camera_id, film_stock_id, box_iso, rated_iso, push_pull_stops, max_frames, status, folder_name, loaded_at, finished_at, lab_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'roll-001',
      1,
      'Autumn Daylight Walk',
      'cam-canon-ae1',
      'kodak-portra-400',
      400,
      400,
      0,
      36,
      'loaded',
      roll1Folder,
      now,
      null,
      'Metering +0.5 EV for warm shadows'
    );

    db.prepare(`
      INSERT INTO rolls (id, roll_number, title, camera_id, film_stock_id, box_iso, rated_iso, push_pull_stops, max_frames, status, folder_name, loaded_at, finished_at, lab_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'roll-002',
      2,
      'Night Street Push +2',
      'cam-leica-m6',
      'ilford-hp5-400',
      400,
      1600,
      2,
      36,
      'loaded',
      roll2Folder,
      now,
      null,
      'PUSH +2 STOPS IN DEV (Rated at EI 1600)'
    );
  }
}

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}
