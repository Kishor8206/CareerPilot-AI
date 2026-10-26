import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import { SkillCategory } from '@careerpilot/shared';

/**
 * Canonical skill catalogue. `aliases` lets the resume parser and the matcher
 * collapse "JS", "Javascript" and "ECMAScript" onto a single record.
 */
export interface ISkill extends Document {
  _id: Types.ObjectId;
  name: string;
  normalized: string;
  category: SkillCategory;
  aliases: string[];
  description?: string;
  /** Skills that are commonly required alongside this one; used for suggestions. */
  relatedSkills: string[];
  demandScore: number;
  learningResources: Array<{ title: string; url?: string; type: string }>;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const skillSchema = new Schema<ISkill>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    normalized: { type: String, required: true, index: true },
    category: { type: String, enum: Object.values(SkillCategory), required: true, index: true },
    aliases: { type: [String], default: [], index: true },
    description: String,
    relatedSkills: { type: [String], default: [] },
    /** 0-100 indicator of how often the skill appears in the JD corpus. */
    demandScore: { type: Number, min: 0, max: 100, default: 50 },
    learningResources: {
      type: [
        new Schema(
          { title: { type: String, required: true }, url: String, type: { type: String, default: 'ARTICLE' } },
          { _id: false },
        ),
      ],
      default: [],
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

export const Skill = registerModel<ISkill>('Skill', skillSchema);
