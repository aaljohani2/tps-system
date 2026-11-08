/** Types deliberately separate timetable contact hours from weighted instructor load. */
export type DeliveryMode = 'ONSITE' | 'REMOTE' | 'SELF_PACED' | 'HYBRID';
export type Day = 'SUN' | 'MON' | 'TUE' | 'WED' | 'THU';
export type Component = 'THEORY' | 'PRACTICAL';
export type CourseType = 'THEORY' | 'PRACTICAL' | 'MIXED';
export interface InstructorTeachingRules {
  /** Desired credited teaching load, distinct from wall-clock occupancy. */
  preferredCreditedLoad?: number;
  maxContactHours?: number;
  maxSections?: number;
  preferredSections?: number;
  allowedCourseTypes?: CourseType[];
  preferredCourseTypes?: CourseType[];
}
export type RoomType = 'CLASSROOM' | 'LAB' | 'MULTI';
export type TimedMode = 'ONSITE' | 'REMOTE';

export interface TimeWindow {day: Day; from: number; to: number}
export interface HybridSplit {
  theoryOnsiteHours: number; theoryRemoteHours: number;
  practicalOnsiteHours: number; practicalRemoteHours: number;
}
export interface Course {
  code: string;
  title: string;
  level: number;
  demand: number;
  theoryHours: number;
  practicalHours: number;
  mode: DeliveryMode;
  eligibleModes: DeliveryMode[];
  /** Explicit instructor credentials required, all must be present. */
  requiredSpecialties?: string[];
  /** Physical equipment required for each onsite session, all must be present. */
  requiredEquipment?: string[];
  /** Only permitted instructor for the course when set. */
  assignedInstructorId?: string;
  /** All covered sections must have the same instructor; others are explicitly left uncovered. */
  exclusiveInstructor?: boolean;
  /** Existing cohort/group identifiers; missing values are not inferred. */
  blocks?: string[];
  /** Cohort sizes from normalized block assignments, with optional safe theory-only grouping. */
  blockSizes?: number[];
  /** The exact original blocks included in each section. Required when several blocks are combined. */
  blockGroups?: string[][];
  /** A scenario-specific course limit within the snapshot policy envelope. */
  sectionCapacity?: number;
  hybridSplit?: HybridSplit;
  departmentId?: string;
  assignmentScope?: 'DEPARTMENT'|'EXTERNAL';
  externalSectionCapacity?: number;
  responsibleDepartment?: string|null;
}
export interface Instructor {
  id: string;
  name: string;
  maxLoad: number;
  /** Actual weekly timetable limits are independent of weighted load. */
  teachingRules?: InstructorTeachingRules;
  allowedModes: DeliveryMode[];
  eligibleCourseCodes?: string[];
  specialties?: string[];
  /** If present, the instructor must not be assigned any other courses. */
  exclusiveCourseCodes?: string[];
  available?: TimeWindow[];
  /** Explicit exception, never silently modifies the approved base load. */
  overload?: {additionalHours: number; reason: string};
}
export interface Room {
  id: string;
  name: string;
  type: RoomType | null;
  capacity: number | null;
  equipmentCodes?: string[];
  available?: TimeWindow[];
}
export interface CapacityPolicy {theory: number | null; practical: number | null}
export interface LecturePeriod {startMinute:number;endMinute:number;trainingHours:number}
export interface LecturePeriodPolicy {
  academicHourMinutes:number;
  partialPeriod:'TRIM_END'|'FULL_PERIOD';
  regular:LecturePeriod[];
  courseOverrides:Record<string,{periods:LecturePeriod[];allowCohortOverlap:boolean}>;
}
export interface Policy {
  /** Department courses covered before other demand, subject to all hard constraints. */
  priorityCourseCodes?: string[];
  lecturePeriods?:LecturePeriodPolicy;
  /** Explicit local planning choice; room type/equipment/time constraints still apply. */
  ignoreRoomCapacity?: boolean;
  /** Explicit course exceptions may override the general section-capacity envelope. */
  courseSectionCapacities?: Record<string,number>;
  enabledModes: DeliveryMode[];
  capacities: Record<DeliveryMode, CapacityPolicy>;
  remotePracticalLoadFactor: number;
  onsitePracticalLoadFactor: number;
  /** null means SELF_PACED cannot be assigned until a load policy is approved. */
  selfPacedLoadPerOffering: number | null;
  slots: TimeWindow[];
  sessionMaxHours: number;
}
export interface PlanRequest {
  scenarioName: string;
  termId: string;
  courses: Course[];
  instructors: Instructor[];
  rooms: Room[];
  policy: Policy;
  /** Exact anonymous membership partitions permitting safe regrouping across course types. */
  cohortBlocks?: Array<{ref:string;level:number;size:number}>;
  projection?: {
    key:string;label:string;sourceTermId:string;newIntake:number;
    levelStudents:Record<number,number>;cooperativeStudents:number;cooperativeAdministrativeBlocks:number;
    baseBlocksByLevel:Record<number,number>;assumptions:string[];
    rules:{theory:number;mixed:number;practical:number;economics:number|null};
  };
}
export interface Section {
  /** Expected wall-clock occupancy, distinct from curriculum training hours. */
  clockHours?:number;
  id: string;
  courseCode: string;
  level: number;
  index: number;
  mode: DeliveryMode;
  students: number;
  capacity: number | null;
  blockId: string | null;
  /** Original block identities preserved for safe collision checks in merged lectures. */
  blockIds?: string[];
  paired: boolean;
  instructorId: string | null;
  contactHours: number;
  creditedLoad: number;
  state: 'SCHEDULED' | 'UNASSIGNED' | 'ASYNC';
}
export interface Session {
  /** Curriculum hours delivered in this fixed-period meeting. */
  trainingHours?:number;
  cohortOverlapWarning?:boolean;
  id: string;
  sectionId: string;
  courseCode: string;
  component: Component;
  mode: TimedMode;
  day: Day;
  start: number;
  end: number;
  roomId: string | null;
  instructorId: string;
  blockId: string | null;
  /** Original block identities preserved for safe collision checks in merged lectures. */
  blockIds?: string[];
}
export interface Gap {
  sectionId: string;
  courseCode: string;
  level: number;
  students: number;
  contactHours: number;
  equivalentLoad: number;
  reason: 'NO_ELIGIBLE_INSTRUCTOR' | 'LOAD_LIMIT' | 'NO_FEASIBLE_TIMETABLE' | 'SELF_PACED_NO_LOAD_POLICY';
}
export interface PlanResult {
  /** Pending support-department demand, excluded from this department's solver/load/gaps. */
  externalSections?: Array<{id:string;courseCode:string;title:string;level:number;students:number;capacity:number;
    contactHours:number;responsibleDepartment:string|null;blockIds:string[];status:'PENDING_EXTERNAL_ASSIGNMENT'}>;
  status: 'DRAFT';
  scenarioName: string;
  termId: string;
  sections: Section[];
  sessions: Session[];
  gaps: Gap[];
  instructorLoads: Array<{id: string; baseLimit: number; approvedException: number; credited: number; contact: number; clockHours?:number; remaining: number}>;
  metrics: {requiredContactHours: number; assignedContactHours: number; uncoveredContactHours: number; sectionCount: number; uncoveredSectionCount: number};
  notices: string[];
}
