# TPS — business rules and acceptance criteria (planning policy)

These are **project planning rules requested by the user**; they are not certified TVTC regulations. Approval must occur independently before operational use.

| ID | Rule | Severity | Initial behavior |
|---|---|---|---|
| CAP-01 | ONSITE 45 theory / 30 practical | Hard | Implemented |
| CAP-02 | REMOTE 120 theory/practical if enabled and course eligible | Hard | Implemented |
| CAP-03 | SELF_PACED unlimited capacity (null), no synchronous slot | Hard | Implemented; requires explicit load policy |
| CAP-04 | HYBRID 45 both; onsite before 12, online 16–22 | Hard | Implemented; requires split hour inputs |
| SEC-01 | 1 theory group pairs with exactly 1 practical group for same trainees | Hard | Implemented as one `Section` containing both components |
| SEC-02 | Effective pair capacity `min(theory, practical)` | Hard | Implemented |
| INS-01 | Instructor mode eligibility, fixed course and max credited load | Hard | Implemented |
| INS-02 | 3 remote practical contact hours = 2 credited hours | Configurable | Implemented, factor = 2/3 |
| INS-03 | Overload must have explicit numeric allowance and reason | Hard | Implemented |
| INS-04 | Exclusive owner for online course when requested | Hard | Implemented within greedy coverage |
| TIM-01 | No instructor overlap | Hard | Implemented |
| TIM-02 | No physical room overlap, right room type/capacity | Hard | Implemented |
| TIM-03 | No overlap for same supplied student block | Hard | Implemented; missing block IDs flagged |
| TIM-04 | No synchronous Thursday sessions ending after 10 | Hard | Implemented |
| TIM-05 | Prefer no Thursday sessions; favor morning for shared courses | Soft | First four days preferred by greedy; shared-course window deferred |
| PLAN-01 | Leave uncovered sections and hours visible | Hard | Implemented |
| PLAN-02 | Estimate cohort from compulsory-course mean + optional 5% retry margin | Planning | Deferred to CSV/XLSX import and demand estimation phase |
| PLAN-03 | Never double-count theory and practical sections | Hard | Implemented |
| PLAN-04 | Compare approved scenarios, preserve revisions | Hard | Deferred: no persistence yet |

**Limitations:** current scheduling uses integer hour intervals (not 30-minute blocks), produces a feasible greedy draft if it can, and does not solve global multi-objective optimization. It may leave feasible lessons unplaced. Rooms are required for every onsite component. Virtual lessons do not consume physical rooms. Missing student-block membership prevents complete trainee-conflict validation.

## Auditable numeric examples

| Example | Expected |
|---|---|
| 180 learners, onsite theory | 4 sections of 45 |
| 180 learners, onsite practical | 6 groups of 30 |
| 180 learners, onsite mixed theory/practical | 6 linked groups of 30, not 4 theory plus 6 practical |
| 180 learners, remote mixed | 2 linked groups of ≤120 |
| 180 learners, hybrid mixed | 4 linked groups of 45 |
| 1800 learners, self-paced | 1 unlimited-size offering, no weekly synchronous lessons |
| 2 theory + 3 remote practical | 5 contact hours, 4 credited hours |
| 3 theory, instructor cap 2, no declared exception | uncovered; with +1 documented exception can be covered |
