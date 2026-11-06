/** Types deliberately separate timetable contact hours from weighted instructor load. */
export type DeliveryMode = 'ONSITE' | 'REMOTE' | 'SELF_PACED' | 'HYBRID';
export type Day = 'SUN' | 'MON' | 'TUE' | 'WED' | 'THU';
export type Component = 'THEORY' | 'PRACTICAL';
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
  /** Only permitted instructor for the course when set. */
  assignedInstructorId?: string;
  /** All covered sections must have the same instructor; others are explicitly left uncovered. */
  exclusiveInstructor?: boolean;
  /** Existing cohort/group identifiers; missing values are not inferred. */
  blocks?: string[];
  /** Cohort sizes from normalized block assignments, one scheduled section per assigned block. */
  blockSizes?: number[];
  hybridSplit?: HybridSplit;
  departmentId?: string;
}
export interface Instructor {
  id: string;
  name: string;
  maxLoad: number;
  allowedModes: DeliveryMode[];
  eligibleCourseCodes?: string[];
  /** If present, the instructor must not be assigned any other courses. */
  exclusiveCourseCodes?: string[];
  available?: TimeWindow[];
  /** Explicit exception, never silently modifies the approved base load. */
  overload?: {additionalHours: number; reason: string};
}
export interface Room {
  id: string;
  name: string;
  type: RoomType;
  capacity: number;
  available?: TimeWindow[];
}
export interface CapacityPolicy {theory: number | null; practical: number | null}
export interface Policy {
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
}
export interface Section {
  id: string;
  courseCode: string;
  level: number;
  index: number;
  mode: DeliveryMode;
  students: number;
  capacity: number | null;
  blockId: string | null;
  paired: boolean;
  instructorId: string | null;
  contactHours: number;
  creditedLoad: number;
  state: 'SCHEDULED' | 'UNASSIGNED' | 'ASYNC';
}
export interface Session {
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
  status: 'DRAFT';
  scenarioName: string;
  termId: string;
  sections: Section[];
  sessions: Session[];
  gaps: Gap[];
  instructorLoads: Array<{id: string; baseLimit: number; approvedException: number; credited: number; contact: number; remaining: number}>;
  metrics: {requiredContactHours: number; assignedContactHours: number; uncoveredContactHours: number; sectionCount: number; uncoveredSectionCount: number};
  notices: string[];
}
