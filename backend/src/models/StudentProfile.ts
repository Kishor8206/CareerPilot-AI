import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import { DataProvenance, SkillCategory } from '@careerpilot/shared';
import type {
  CertificationEntry,
  EducationEntry,
  ExperienceEntry,
  ProjectEntry,
  StudentSkillDto,
} from '@careerpilot/shared';

export interface IStudentProfile extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  rollNumber?: string;
  department?: string;
  degree?: string;
  batch?: string;
  section?: string;
  graduationYear?: number;
  cgpa?: number;
  backlogs: number;
  phone?: string;
  location?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  headline?: string;
  summary?: string;
  skills: StudentSkillDto[];
  education: EducationEntry[];
  projects: ProjectEntry[];
  experience: ExperienceEntry[];
  certifications: CertificationEntry[];
  achievements: string[];
  targetCompanies: Types.ObjectId[];
  targetRoles: Types.ObjectId[];
  /** Free-text targets kept alongside catalog references for flexibility. */
  targetCompanyNames: string[];
  targetRoleTitles: string[];
  profileCompletion: number;
  primaryResumeId?: Types.ObjectId | null;
  lastActivityAt?: Date | null;
  provenance: DataProvenance;
  createdAt: Date;
  updatedAt: Date;
}

export const studentSkillSchema = new Schema<StudentSkillDto>(
  {
    skillId: { type: Schema.Types.ObjectId, ref: 'Skill' },
    name: { type: String, required: true, trim: true },
    category: { type: String, enum: Object.values(SkillCategory), default: SkillCategory.PROGRAMMING_LANGUAGE },
    proficiency: { type: Number, min: 0, max: 100, default: 50 },
    source: { type: String, enum: ['SELF', 'RESUME', 'ASSESSMENT', 'ALUMNI'], default: 'SELF' },
    verified: { type: Boolean, default: false },
  },
  { _id: false },
);

const educationSchema = new Schema<EducationEntry>(
  {
    degree: { type: String, required: true, trim: true },
    institution: { type: String, required: true, trim: true },
    fieldOfStudy: String,
    startYear: Number,
    endYear: Number,
    cgpa: { type: Number, min: 0, max: 10 },
    percentage: { type: Number, min: 0, max: 100 },
  },
  { _id: false },
);

const projectSchema = new Schema<ProjectEntry>(
  {
    title: { type: String, required: true, trim: true },
    description: String,
    technologies: { type: [String], default: [] },
    link: String,
    durationMonths: Number,
  },
  { _id: false },
);

const experienceSchema = new Schema<ExperienceEntry>(
  {
    company: { type: String, required: true, trim: true },
    role: { type: String, required: true, trim: true },
    type: { type: String, enum: ['INTERNSHIP', 'FULL_TIME', 'PART_TIME', 'FREELANCE'], default: 'INTERNSHIP' },
    startDate: String,
    endDate: String,
    description: String,
  },
  { _id: false },
);

const certificationSchema = new Schema<CertificationEntry>(
  {
    name: { type: String, required: true, trim: true },
    issuer: String,
    issuedOn: String,
    credentialId: String,
    link: String,
  },
  { _id: false },
);

const studentProfileSchema = new Schema<IStudentProfile>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    rollNumber: { type: String, trim: true, sparse: true, index: true },
    department: { type: String, trim: true, index: true },
    degree: { type: String, trim: true },
    batch: { type: String, trim: true, index: true },
    section: { type: String, trim: true },
    graduationYear: { type: Number, min: 1980, max: 2100 },
    cgpa: { type: Number, min: 0, max: 10 },
    backlogs: { type: Number, min: 0, default: 0 },
    phone: { type: String, trim: true },
    location: { type: String, trim: true },
    linkedinUrl: String,
    githubUrl: String,
    portfolioUrl: String,
    headline: { type: String, maxlength: 160 },
    summary: { type: String, maxlength: 2000 },
    skills: { type: [studentSkillSchema], default: [] },
    education: { type: [educationSchema], default: [] },
    projects: { type: [projectSchema], default: [] },
    experience: { type: [experienceSchema], default: [] },
    certifications: { type: [certificationSchema], default: [] },
    achievements: { type: [String], default: [] },
    targetCompanies: [{ type: Schema.Types.ObjectId, ref: 'Company' }],
    targetRoles: [{ type: Schema.Types.ObjectId, ref: 'JobRole' }],
    targetCompanyNames: { type: [String], default: [] },
    targetRoleTitles: { type: [String], default: [] },
    profileCompletion: { type: Number, min: 0, max: 100, default: 0 },
    primaryResumeId: { type: Schema.Types.ObjectId, ref: 'Resume', default: null },
    lastActivityAt: { type: Date, default: null },
    provenance: { type: String, enum: Object.values(DataProvenance), default: DataProvenance.REAL, index: true },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

studentProfileSchema.index({ department: 1, batch: 1 });
studentProfileSchema.index({ 'skills.name': 1 });

/**
 * Profile completion drives the dashboard nudges. Weights reflect how much each
 * section contributes to a usable placement profile.
 */
studentProfileSchema.methods.computeCompletion = function computeCompletion(this: IStudentProfile): number {
  const checks: Array<[boolean, number]> = [
    [Boolean(this.rollNumber), 5],
    [Boolean(this.department), 5],
    [Boolean(this.degree), 5],
    [Boolean(this.graduationYear), 5],
    [Boolean(this.cgpa), 10],
    [Boolean(this.phone), 5],
    [Boolean(this.headline), 5],
    [Boolean(this.summary), 5],
    [this.skills.length >= 5, 15],
    [this.education.length > 0, 10],
    [this.projects.length > 0, 10],
    [this.certifications.length > 0, 5],
    [Boolean(this.primaryResumeId), 10],
    [this.targetRoleTitles.length > 0 || this.targetRoles.length > 0, 5],
  ];
  return checks.reduce((sum, [pass, weight]) => sum + (pass ? weight : 0), 0);
};

studentProfileSchema.pre('save', function preSave(next) {
  // Keep completion in sync on every write rather than recomputing on read.
  const doc = this as unknown as IStudentProfile & { computeCompletion: () => number };
  doc.profileCompletion = doc.computeCompletion();
  next();
});

export const StudentProfile = registerModel<IStudentProfile>('StudentProfile', studentProfileSchema);
