import crypto from 'node:crypto';
import type { Types } from 'mongoose';
import { AgentName, DataProvenance, ErrorCode } from '@careerpilot/shared';
import { moduleLogger } from '../config/logger';
import { JobDescription } from '../models/JobDescription';
import { Resume, type IResume } from '../models/Resume';
import { ResumeAnalysis, type IResumeAnalysis } from '../models/ResumeAnalysis';
import { StudentProfile } from '../models/StudentProfile';
import { ApiError } from '../utils/ApiError';
import { addDays } from '../utils/helpers';
import { env } from '../config/env';
import { aiClient } from './aiClient.service';
import { buildStorageKey, storage, verifyFileSignature } from './storage.service';
import { applyParsedResume, mergeResumeSkills } from './student.service';

const log = moduleLogger('resume');

export interface UploadResumeInput {
  studentId: Types.ObjectId;
  userId: string;
  file: Express.Multer.File;
  makePrimary?: boolean;
}

/**
 * Stores an uploaded resume.
 *
 * The magic-byte check happens here rather than in the multer filter because
 * multer only sees the browser-supplied MIME type, which is trivially forged.
 * A duplicate upload of the identical file is short-circuited so a student who
 * clicks twice does not accumulate versions.
 */
export async function uploadResume(input: UploadResumeInput): Promise<IResume> {
  const { file } = input;

  if (!verifyFileSignature(file.buffer, file.mimetype)) {
    throw ApiError.unsupportedMedia(
      `The contents of "${file.originalname}" do not match a ${file.mimetype} file. ` +
        'Please upload a genuine PDF, DOCX or TXT resume.',
    );
  }

  const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex');

  const duplicate = await Resume.findOne({ studentId: input.studentId, checksum });
  if (duplicate) {
    log.info({ resumeId: duplicate._id.toString() }, 'Identical resume already uploaded; reusing it');
    return duplicate;
  }

  const key = buildStorageKey('resumes', input.userId, file.originalname);
  const stored = await storage.put(key, file.buffer, file.mimetype);

  const latestVersion = await Resume.countDocuments({ studentId: input.studentId });

  if (input.makePrimary !== false) {
    await Resume.updateMany({ studentId: input.studentId }, { $set: { isPrimary: false } });
  }

  const resume = await Resume.create({
    studentId: input.studentId,
    userId: input.userId,
    originalName: file.originalname.slice(0, 200),
    storageKey: stored.key,
    mimeType: file.mimetype,
    sizeBytes: stored.size,
    checksum: stored.checksum,
    version: latestVersion + 1,
    isPrimary: input.makePrimary !== false,
    parseStatus: 'PENDING',
    // Privacy (§30): the retention job purges the file after this date.
    retentionUntil: addDays(new Date(), env.DATA_RETENTION_DAYS),
  });

  if (resume.isPrimary) {
    await StudentProfile.updateOne({ _id: input.studentId }, { $set: { primaryResumeId: resume._id } });
  }

  return resume;
}

export interface AnalyzeResumeOptions {
  jobDescriptionId?: string;
  /** Student-supplied job description. Sent to the analysis and discarded. */
  jobDescriptionText?: string;
  jobDescriptionLabel?: string;
  applyToProfile?: boolean;
}

/**
 * Runs the resume through the Python analysis pipeline and persists the result.
 *
 * The file is read back from storage rather than kept in memory, so analysis can
 * be re-run later against a different job description without a re-upload.
 */
export async function analyzeResume(
  resume: IResume,
  userId: string,
  options: AnalyzeResumeOptions = {},
): Promise<IResumeAnalysis> {
  const buffer = await storage.get(resume.storageKey);

  const payload: Record<string, unknown> = {
    fileBase64: buffer.toString('base64'),
    mimeType: resume.mimeType,
    filename: resume.originalName,
    studentId: resume.studentId.toString(),
  };

  let jobDescriptionSource: 'CATALOGUE' | 'CUSTOM' | null = null;
  let jobDescriptionLabel: string | null = null;

  if (options.jobDescriptionId) {
    const jd = await JobDescription.findById(options.jobDescriptionId)
      .populate<{ companyId: { name: string } }>('companyId', 'name')
      .populate<{ roleId: { title: string } }>('roleId', 'title');

    if (!jd) throw ApiError.notFound('Job description');

    payload.jobDescriptionText = jd.descriptionText;
    payload.jobKeywords = [...jd.requiredSkills, ...jd.preferredSkills, ...jd.atsKeywords];
    payload.companyName = jd.companyId?.name;
    payload.roleTitle = jd.roleId?.title;
    jobDescriptionSource = 'CATALOGUE';
    jobDescriptionLabel = jd.title ?? null;
  } else if (options.jobDescriptionText) {
    // No keyword list is sent: the analysis derives it from the text itself.
    payload.jobDescriptionText = options.jobDescriptionText;
    jobDescriptionSource = 'CUSTOM';
    jobDescriptionLabel = options.jobDescriptionLabel?.trim() || 'Your job description';
  }

  let result;
  try {
    result = await aiClient.post<typeof payload, {
      atsScore: number;
      parsed: Record<string, unknown>;
      breakdown: unknown[];
      matchedKeywords: string[];
      missingKeywords: string[];
      keywordCoverage: number;
      strengths: string[];
      weaknesses: string[];
      formattingRecommendations: string[];
      jobSpecificRecommendations: string[];
      extractedTextLength: number;
      engineVersion: string;
    }>('/ai/resume/analyze', payload, {
      userId,
      studentId: resume.studentId.toString(),
      agent: AgentName.RESUME_INTELLIGENCE,
      operation: 'resume.analyze',
    });
  } catch (error) {
    // Record the failure on the resume so the UI can show why, and offer a retry.
    await Resume.updateOne(
      { _id: resume._id },
      { $set: { parseStatus: 'FAILED', parseError: (error as ApiError).message?.slice(0, 500) ?? 'Unknown error' } },
    );
    if (error instanceof ApiError && error.code === ErrorCode.RESUME_PARSE_FAILED) throw error;
    throw error;
  }

  const data = result.data;

  const analysis = await ResumeAnalysis.create({
    resumeId: resume._id,
    studentId: resume.studentId,
    atsScore: data.atsScore,
    parsed: data.parsed,
    breakdown: data.breakdown,
    matchedKeywords: data.matchedKeywords,
    missingKeywords: data.missingKeywords,
    strengths: data.strengths,
    weaknesses: data.weaknesses,
    formattingRecommendations: data.formattingRecommendations,
    jobSpecificRecommendations: data.jobSpecificRecommendations,
    targetJobDescriptionId: options.jobDescriptionId ?? null,
    jobDescriptionSource,
    jobDescriptionLabel,
    // Coverage only means something when a job description was compared.
    jobMatchScore: jobDescriptionSource ? (data.keywordCoverage ?? null) : null,
    engineVersion: data.engineVersion,
    processingMs: result.meta?.latencyMs ?? 0,
    provenance: DataProvenance.REAL,
  });

  await Resume.updateOne(
    { _id: resume._id },
    {
      $set: {
        parseStatus: 'PARSED',
        parseError: null,
        extractedTextLength: data.extractedTextLength ?? 0,
        latestAnalysisId: analysis._id,
      },
    },
  );

  if (options.applyToProfile !== false) {
    const profile = await StudentProfile.findById(resume.studentId);
    if (profile) {
      const parsed = data.parsed as Record<string, any>;
      const skills: Array<{ name: string; category?: string }> = [
        ...(parsed.programmingLanguages ?? []).map((n: string) => ({ name: n, category: 'PROGRAMMING_LANGUAGE' })),
        ...(parsed.frameworks ?? []).map((n: string) => ({ name: n, category: 'FRAMEWORK' })),
        ...(parsed.databases ?? []).map((n: string) => ({ name: n, category: 'DATABASE' })),
        ...(parsed.cloud ?? []).map((n: string) => ({ name: n, category: 'CLOUD' })),
        ...(parsed.tools ?? []).map((n: string) => ({ name: n, category: 'TOOL' })),
        ...(parsed.fundamentals ?? []).map((n: string) => ({ name: n, category: 'CS_FUNDAMENTAL' })),
      ];
      await mergeResumeSkills(profile, skills);
      await applyParsedResume(profile, parsed);
    }
  }

  log.info(
    { resumeId: resume._id.toString(), atsScore: data.atsScore, degraded: result.meta?.degraded },
    'Resume analysed',
  );

  return analysis;
}

export async function listResumes(studentId: Types.ObjectId) {
  // Documents, not lean objects: serialisation then includes the `id` the client addresses each resume by.
  return Resume.find({ studentId }).sort({ createdAt: -1 });
}

export async function getResumeOwned(resumeId: string, studentId: Types.ObjectId): Promise<IResume> {
  const resume = await Resume.findOne({ _id: resumeId, studentId });
  if (!resume) throw ApiError.notFound('Resume');
  return resume;
}

export async function getLatestAnalysis(studentId: Types.ObjectId): Promise<IResumeAnalysis | null> {
  return ResumeAnalysis.findOne({ studentId }).sort({ createdAt: -1 });
}

export async function deleteResume(resumeId: string, studentId: Types.ObjectId): Promise<void> {
  const resume = await getResumeOwned(resumeId, studentId);

  await storage.delete(resume.storageKey);
  await ResumeAnalysis.deleteMany({ resumeId: resume._id });
  await Resume.deleteOne({ _id: resume._id });

  if (resume.isPrimary) {
    // Promote the next most recent resume so the student is never left without
    // a primary while others still exist.
    const next = await Resume.findOne({ studentId }).sort({ createdAt: -1 });
    if (next) {
      next.isPrimary = true;
      await next.save();
      await StudentProfile.updateOne({ _id: studentId }, { $set: { primaryResumeId: next._id } });
    } else {
      await StudentProfile.updateOne({ _id: studentId }, { $set: { primaryResumeId: null } });
    }
  }
}

export async function setPrimaryResume(resumeId: string, studentId: Types.ObjectId): Promise<IResume> {
  const resume = await getResumeOwned(resumeId, studentId);
  await Resume.updateMany({ studentId }, { $set: { isPrimary: false } });
  resume.isPrimary = true;
  await resume.save();
  await StudentProfile.updateOne({ _id: studentId }, { $set: { primaryResumeId: resume._id } });
  return resume;
}

/** Streams the stored file back to its owner (or to staff). */
export async function downloadResume(resume: IResume): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
  const buffer = await storage.get(resume.storageKey);
  return { buffer, filename: resume.originalName, mimeType: resume.mimeType };
}

/**
 * Reads the text out of an uploaded job-description file so the student can
 * review it before comparing. The file is passed straight through to the
 * extractor and is not stored anywhere.
 */
export async function extractJobDescriptionText(
  file: Express.Multer.File,
  userId: string,
): Promise<{ text: string; characters: number; recognisedSkills: string[]; filename: string }> {
  const payload = {
    fileBase64: file.buffer.toString('base64'),
    mimeType: file.mimetype,
    filename: file.originalname,
  };
  const result = await aiClient
    .post<typeof payload, { text: string; characters: number; recognisedSkills: string[] }>(
      '/ai/resume/extract-text',
      payload,
      { userId, agent: AgentName.RESUME_INTELLIGENCE, operation: 'resume.jd.extract' },
    )
    .catch((error: unknown) => {
      // An unreadable file is the user's to fix, not a gateway failure.
      if (error instanceof ApiError && error.code === ErrorCode.RESUME_PARSE_FAILED) {
        throw new ApiError(422, error.code, error.message);
      }
      throw error;
    });
  return {
    // Bounded to what the analysis accepts.
    text: result.data.text.slice(0, 20_000),
    characters: result.data.characters,
    recognisedSkills: result.data.recognisedSkills ?? [],
    filename: file.originalname,
  };
}
