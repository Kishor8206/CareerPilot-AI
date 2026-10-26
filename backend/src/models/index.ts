/**
 * Central model registry. Importing from here guarantees every schema is
 * registered with Mongoose before any `populate()` runs.
 */
export * from './User';
export * from './RefreshToken';
export * from './StudentProfile';
export * from './AlumniProfile';
export * from './PlacementOfficer';
export * from './Company';
export * from './JobRole';
export * from './JobDescription';
export * from './Skill';
export * from './Resume';
export * from './ResumeAnalysis';
export * from './Assessment';
export * from './AssessmentQuestion';
export * from './AssessmentAttempt';
export * from './CodingProblem';
export * from './CodingSubmission';
export * from './InterviewSession';
export * from './InterviewQuestion';
export * from './InterviewResponse';
export * from './InterviewEvaluation';
export * from './PlacementReadiness';
export * from './SkillGap';
export * from './Recommendation';
export * from './MentorshipRequest';
export * from './MentorshipSession';
export * from './AlumniFeedback';
export * from './Notification';
export * from './AIInteraction';
export * from './RAGDocument';
export * from './MonitoringEvent';
export * from './AuditLog';
export * from './SystemConfiguration';
export * from './CareerPlan';
