import type {Day, DeliveryMode, Policy, TimeWindow} from './types.js';
export const DAYS: Day[] = ['SUN', 'MON', 'TUE', 'WED', 'THU'];
export const MODES: DeliveryMode[] = ['ONSITE', 'REMOTE', 'SELF_PACED', 'HYBRID'];
/** Local planning preferences only; not a claim that TVTC has approved remote modes. */
export const defaultPolicy = (): Policy => ({
  enabledModes: ['ONSITE'],
  capacities: {
    ONSITE: {theory: 45, practical: 30},
    REMOTE: {theory: 120, practical: 120},
    SELF_PACED: {theory: null, practical: null},
    HYBRID: {theory: 45, practical: 45}
  },
  remotePracticalLoadFactor: 2 / 3,
  onsitePracticalLoadFactor: 1,
  selfPacedLoadPerOffering: null,
  slots: DAYS.flatMap<TimeWindow>(day => {
    if (day === 'THU') return [{day, from: 8, to: 10}];
    return [{day, from: 8, to: 16}, {day, from: 16, to: 22}];
  }),
  sessionMaxHours: 2
});
