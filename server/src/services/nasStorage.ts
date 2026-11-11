import fs from 'node:fs';
import path from 'node:path';
import piexif from 'piexifjs';
import { db, ROLLS_DIR } from '../db.js';

export function sanitizeFolderSlug(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function ensureRollDirectories(folderName: string) {
  const baseDir = path.join(ROLLS_DIR, folderName);
  const refsDir = path.join(baseDir, 'references');
  const scansRawDir = path.join(baseDir, 'scans_raw');
  const scansTaggedDir = path.join(baseDir, 'scans_tagged');

  fs.mkdirSync(refsDir, { recursive: true });
  fs.mkdirSync(scansRawDir, { recursive: true });
  fs.mkdirSync(scansTaggedDir, { recursive: true });

  return { baseDir, refsDir, scansRawDir, scansTaggedDir };
}

/**
 * Writes a human-readable roll-metadata.json manifest inside the NAS roll folder
 * whenever frames or roll details change.
 */
export function writeRollManifestToNas(rollId: string) {
  const roll = db.prepare(`
    SELECT r.*,
           c.name as camera_name, c.make as camera_make, c.model as camera_model, c.format as camera_format,
           fs.brand as film_brand, fs.name as film_name, fs.process as film_process
    FROM rolls r
    LEFT JOIN cameras c ON r.camera_id = c.id
    JOIN film_stocks fs ON r.film_stock_id = fs.id
    WHERE r.id = ?
  `).get(rollId) as any;

  if (!roll) return;

  const frames = db.prepare(`
    SELECT f.*, l.name as lens_name, l.focal_length_mm
    FROM frames f
    LEFT JOIN lenses l ON f.lens_id = l.id
    WHERE f.roll_id = ?
    ORDER BY f.frame_number ASC
  `).all(rollId) as any[];

  const { baseDir } = ensureRollDirectories(roll.folder_name);
  const manifestPath = path.join(baseDir, 'roll-metadata.json');

  const manifest = {
    exportedAt: new Date().toISOString(),
    rollNumber: roll.roll_number,
    title: roll.title,
    status: roll.status,
    camera: roll.camera_id
      ? {
          name: roll.camera_name,
          make: roll.camera_make,
          model: roll.camera_model,
          format: roll.camera_format
        }
      : null,
    filmStock: {
      brand: roll.film_brand,
      name: roll.film_name,
      process: roll.film_process,
      boxIso: roll.box_iso,
      ratedIso: roll.rated_iso,
      pushPullStops: roll.push_pull_stops
    },
    loadedAt: roll.loaded_at,
    finishedAt: roll.finished_at,
    labNotes: roll.lab_notes,
    frames: frames.map((f) => ({
      frameNumber: f.frame_number,
      shutterSpeed: f.shutter_speed,
      aperture: f.aperture,
      priorityMode: f.priority_mode,
      meteredEv: f.metered_ev,
      ev100: f.ev100,
      centerEv100: f.center_ev100,
      spotEv100: f.spot_ev100,
      shadowEv100: f.shadow_ev100,
      highlightEv100: f.highlight_ev100,
      sceneContrastStops: f.scene_contrast_stops,
      colorTempK: f.color_temp_k,
      stopDelta: f.stop_delta,
      exposureCompEv: f.exposure_comp_ev,
      calibrationEv: f.calibration_ev,
      meteringMode: f.metering_mode,
      lens: f.lens_name ? `${f.lens_name} (${f.focal_length_mm}mm)` : null,
      lightingTags: JSON.parse(f.lighting_tags || '[]'),
      gps: f.lat !== null && f.lng !== null ? { lat: f.lat, lng: f.lng } : null,
      capturedAt: f.captured_at,
      notes: f.notes,
      learningRating: f.learning_rating,
      files: {
        reference: f.ref_image_file ? `references/${f.ref_image_file}` : null,
        rawScan: f.scan_image_file ? `scans_raw/${f.scan_image_file}` : null,
        taggedScan: f.tagged_scan_file ? `scans_tagged/${f.tagged_scan_file}` : null
      }
    }))
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

function parseShutterSpeedToRational(shutterSpeed: string): [number, number] {
  const clean = shutterSpeed.replace(/s$/i, '').trim();
  if (clean.includes('/')) {
    const [num, den] = clean.split('/').map((n) => parseInt(n, 10));
    if (!isNaN(num) && !isNaN(den) && den > 0) {
      return [num, den];
    }
  }
  const val = parseFloat(clean);
  if (!isNaN(val) && val > 0) {
    if (val >= 1) return [Math.round(val), 1];
    return [1, Math.round(1 / val)];
  }
  return [1, 125];
}

function formatExifDate(isoString: string): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) {
    return '2026:11:11 12:00:00';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export interface ExifMetadataInput {
  cameraMake: string;
  cameraModel: string;
  lensName: string | null;
  focalLengthMm: number | null;
  filmDescription: string;
  ratedIso: number;
  boxIso: number;
  rollNumber: number;
  frameNumber: number;
  shutterSpeed: string;
  aperture: number;
  capturedAt: string;
  lat: number | null;
  lng: number | null;
  notes: string | null;
}

/**
 * Injects film camera, lens, exposure, film stock, and GPS metadata into a JPEG buffer
 * and writes it to the destination path on the NAS.
 */
export function bakeExifIntoJpegBuffer(jpegBuffer: Buffer, meta: ExifMetadataInput): Buffer {
  try {
    const binaryStr = jpegBuffer.toString('binary');
    // Check JPEG magic header (0xFFD8)
    if (jpegBuffer.length < 4 || jpegBuffer[0] !== 0xff || jpegBuffer[1] !== 0xd8) {
      return jpegBuffer;
    }

    let exifObj: any = { '0th': {}, Exif: {}, GPS: {} };
    try {
      exifObj = piexif.load(binaryStr);
    } catch {
      exifObj = { '0th': {}, Exif: {}, GPS: {} };
    }

    const exifDate = formatExifDate(meta.capturedAt);
    const description = `Roll #${meta.rollNumber} Frame #${meta.frameNumber} | ${meta.filmDescription} @ EI ${meta.ratedIso} (Box ${meta.boxIso})${meta.notes ? ` | ${meta.notes}` : ''}`;

    exifObj['0th'][piexif.ImageIFD.Make] = meta.cameraMake || 'Film Camera';
    exifObj['0th'][piexif.ImageIFD.Model] = meta.cameraModel || 'Analog Body';
    exifObj['0th'][piexif.ImageIFD.Software] = 'Catenicus Film Assistant';
    exifObj['0th'][piexif.ImageIFD.DateTime] = exifDate;
    exifObj['0th'][piexif.ImageIFD.ImageDescription] = description;

    exifObj.Exif[piexif.ExifIFD.DateTimeOriginal] = exifDate;
    exifObj.Exif[piexif.ExifIFD.DateTimeDigitized] = exifDate;
    exifObj.Exif[piexif.ExifIFD.ISOSpeedRatings] = meta.ratedIso;
    exifObj.Exif[piexif.ExifIFD.ExposureTime] = parseShutterSpeedToRational(meta.shutterSpeed);
    exifObj.Exif[piexif.ExifIFD.FNumber] = [Math.round(meta.aperture * 10), 10];

    if (meta.focalLengthMm) {
      exifObj.Exif[piexif.ExifIFD.FocalLength] = [Math.round(meta.focalLengthMm), 1];
    }
    if (meta.lensName) {
      exifObj.Exif[piexif.ExifIFD.LensModel] = meta.lensName;
    }

    if (meta.lat !== null && meta.lng !== null) {
      exifObj.GPS[piexif.GPSIFD.GPSLatitudeRef] = meta.lat >= 0 ? 'N' : 'S';
      exifObj.GPS[piexif.GPSIFD.GPSLatitude] = piexif.GPSHelper.degToDmsRational(Math.abs(meta.lat));
      exifObj.GPS[piexif.GPSIFD.GPSLongitudeRef] = meta.lng >= 0 ? 'E' : 'W';
      exifObj.GPS[piexif.GPSIFD.GPSLongitude] = piexif.GPSHelper.degToDmsRational(Math.abs(meta.lng));
    }

    const exifBytes = piexif.dump(exifObj);
    const newBinary = piexif.insert(exifBytes, binaryStr);
    return Buffer.from(newBinary, 'binary');
  } catch (err) {
    console.warn('EXIF injection fallback (returning original buffer):', err);
    return jpegBuffer;
  }
}
