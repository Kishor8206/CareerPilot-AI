import path from 'node:path';
import multer from 'multer';
import { ALLOWED_RESUME_EXTENSIONS, ALLOWED_RESUME_MIME_TYPES } from '@careerpilot/shared';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';

/**
 * Uploads are buffered in memory and handed to the storage abstraction, so the
 * API server never writes attacker-controlled paths to disk itself.
 *
 * Both the MIME type and the extension are checked: the browser-supplied MIME
 * type alone is trivially forged, and the extension alone says nothing about
 * content. The storage layer additionally verifies the file's magic bytes.
 */
const storage = multer.memoryStorage();

function resumeFileFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeOk = (ALLOWED_RESUME_MIME_TYPES as readonly string[]).includes(file.mimetype);
  const extOk = (ALLOWED_RESUME_EXTENSIONS as readonly string[]).includes(ext);

  if (!mimeOk || !extOk) {
    cb(
      ApiError.unsupportedMedia(
        `Only ${ALLOWED_RESUME_EXTENSIONS.join(', ')} files are accepted. Received "${file.originalname}" (${file.mimetype}).`,
      ),
    );
    return;
  }
  cb(null, true);
}

export const uploadResume = multer({
  storage,
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 20 },
  fileFilter: resumeFileFilter,
}).single('resume');

/** A job description to compare a resume against. Same file rules as a resume; never stored. */
export const uploadJobDescription = multer({
  storage,
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 5 },
  fileFilter: resumeFileFilter,
}).single('jd');

/**
 * Short audio utterance for server-side transcription (§11).
 *
 * Buffered in memory and proxied straight to the AI service — the clip is never
 * written to disk, because storing a student's spoken answer would create a
 * recording nobody consented to. The 12 MB ceiling is well above a two-minute
 * Opus clip while blocking a file upload dressed as audio.
 */
export const uploadAudio = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 10 },
  fileFilter: (_req, file, cb) => {
    // Browsers append codec parameters, e.g. `audio/webm;codecs=opus`.
    const baseType = file.mimetype.split(';')[0].trim().toLowerCase();
    const allowed = ['audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/m4a'];

    if (!allowed.includes(baseType)) {
      cb(ApiError.unsupportedMedia(`'${file.mimetype}' is not a supported audio format.`));
      return;
    }
    cb(null, true);
  },
}).single('audio');

/** Generic single-document upload (alumni employment proof, etc.). */
export const uploadDocument = multer({
  storage,
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 20 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/png', 'image/jpeg'];
    if (!allowed.includes(file.mimetype)) {
      cb(ApiError.unsupportedMedia('Only PDF, PNG or JPEG documents are accepted.'));
      return;
    }
    cb(null, true);
  },
}).single('document');
