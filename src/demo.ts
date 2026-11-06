import {readFileSync} from 'node:fs';
import {buildDraftPlan} from './planner.js';
import type {PlanRequest} from './types.js';
const path = process.argv[2] ?? 'examples/onsite.json';
const plan = buildDraftPlan(JSON.parse(readFileSync(path, 'utf8')) as PlanRequest);
console.log(JSON.stringify(plan, null, 2));
