package sa.tps.solver;
import ai.timefold.solver.core.api.score.HardSoftScore;
import ai.timefold.solver.core.api.score.stream.Constraint;
import ai.timefold.solver.core.api.score.stream.ConstraintFactory;
import ai.timefold.solver.core.api.score.stream.ConstraintProvider;
import ai.timefold.solver.core.api.score.stream.ConstraintCollectors;
import ai.timefold.solver.core.api.score.stream.Joiners;

/** The NONE/uncovered placement is an explicit legal alternative, never an invented staff assignment. */
public class TpsConstraintProvider implements ConstraintProvider {
    @Override public Constraint[] defineConstraints(ConstraintFactory f) {
        return new Constraint[]{
                overlappingSessions(f), instructorOverload(f), exclusiveCourse(f),
                timetableContactLimit(f), sectionCountLimit(f), preferredSectionCount(f), preferredCourseType(f),
                preferredCreditedLoad(f), minimizeUncovered(f), preferSundayToWednesday(f), cohortOverlapWarnings(f),refineSchedule(f),campusDayLimit(f),requiredLoads(f)
        };
    }
    private Constraint requiredLoads(ConstraintFactory f) {
        return f.forEach(PlanningTask.class).groupBy(ConstraintCollectors.toList()).join(RefinementContext.class)
                .filter((tasks,context)->context.requiredLoadViolations(tasks)>0)
                .penalize(HardSoftScore.ONE_HARD,(tasks,context)->context.requiredLoadViolations(tasks))
                .asConstraint("Explicit required credited instructor loads");
    }
    private Constraint campusDayLimit(ConstraintFactory f) {
        return f.forEach(PlanningTask.class).groupBy(ConstraintCollectors.toList()).join(RefinementContext.class)
                .filter((tasks,context)->context.campusViolations(tasks)>0)
                .penalize(HardSoftScore.ONE_HARD,(tasks,context)->context.campusViolations(tasks))
                .asConstraint("Maximum actual learner campus days including fixed general meetings");
    }
    private Constraint refineSchedule(ConstraintFactory f) {
        return f.forEach(PlanningTask.class).groupBy(ConstraintCollectors.toList()).join(RefinementContext.class)
                .penalize(HardSoftScore.ONE_SOFT,(tasks,context)->context.penalty(tasks))
                .asConstraint("Explicit scenario refinement objectives");
    }
    private Constraint overlappingSessions(ConstraintFactory f) {
        return f.forEachUniquePair(PlanningTask.class)
                .filter((a,b) -> a.getSelected().conflictsWith(b.getSelected()))
                .penalize(HardSoftScore.ONE_HARD, (a,b) -> 1)
                .asConstraint("No instructor room or cohort collision");
    }
    private Constraint cohortOverlapWarnings(ConstraintFactory f) {
        return f.forEachUniquePair(PlanningTask.class)
                .filter((a,b)->a.getSelected().cohortWarningCount(b.getSelected())>0)
                .penalize(HardSoftScore.ONE_SOFT,(a,b)->a.getSelected().cohortWarningCount(b.getSelected())*20)
                .asConstraint("Visible permitted Economics cohort overlaps");
    }
    private Constraint instructorOverload(ConstraintFactory f) {
        return f.forEach(PlanningTask.class)
                .filter(t -> !t.getSelected().uncovered())
                .groupBy(t -> t.getSelected().instructorId(),
                        t -> t.getSelected().effectiveLimitMilli(),
                        ConstraintCollectors.sum(t -> t.getSelected().creditedMilli()))
                .filter((id, limit, total) -> total > limit)
                .penalize(HardSoftScore.ONE_HARD, (id, limit, total) -> total - limit)
                .asConstraint("Approved trainer credit limit");
    }
    private Constraint exclusiveCourse(ConstraintFactory f) {
        return f.forEachUniquePair(PlanningTask.class,
                Joiners.equal(PlanningTask::getCourseCode))
                .filter((a,b) -> a.isExclusiveInstructor() && b.isExclusiveInstructor()
                        && !a.getSelected().uncovered() && !b.getSelected().uncovered()
                        && !a.getSelected().instructorId().equals(b.getSelected().instructorId()))
                .penalize(HardSoftScore.ONE_HARD)
                .asConstraint("One remote course owner");
    }
    private Constraint timetableContactLimit(ConstraintFactory f) {
        return f.forEach(PlanningTask.class)
                .filter(t -> !t.getSelected().uncovered() && t.getSelected().contactLimitMilli()!=null)
                .groupBy(t -> t.getSelected().instructorId(), t -> t.getSelected().contactLimitMilli(),
                        ConstraintCollectors.sum(t -> t.getSelected().contactMilli()))
                .filter((id,limit,total) -> total>limit)
                .penalize(HardSoftScore.ONE_HARD,(id,limit,total) -> total-limit)
                .asConstraint("Trainer actual weekly timetable hour limit");
    }
    private Constraint sectionCountLimit(ConstraintFactory f) {
        return f.forEach(PlanningTask.class)
                .filter(t -> !t.getSelected().uncovered() && t.getSelected().sectionLimit()!=null)
                .groupBy(t -> t.getSelected().instructorId(), t -> t.getSelected().sectionLimit(),ConstraintCollectors.count())
                .filter((id,limit,total) -> total>limit)
                .penalize(HardSoftScore.ONE_HARD,(id,limit,total) -> total-limit)
                .asConstraint("Trainer maximum section count");
    }
    private Constraint preferredSectionCount(ConstraintFactory f) {
        return f.forEach(PlanningTask.class)
                .filter(t -> !t.getSelected().uncovered() && t.getSelected().preferredSectionCount()!=null)
                .groupBy(t -> t.getSelected().instructorId(), t -> t.getSelected().preferredSectionCount(),ConstraintCollectors.count())
                .reward(HardSoftScore.ONE_SOFT,(id,target,total) -> Math.min(target,total)*40)
                .asConstraint("Trainer requested section count preference");
    }
    private Constraint preferredCourseType(ConstraintFactory f) {
        return f.forEach(PlanningTask.class)
                .filter(t -> !t.getSelected().uncovered() && t.getSelected().preferenceScore()!=null)
                .reward(HardSoftScore.ONE_SOFT,t -> t.getSelected().preferenceScore())
                .asConstraint("Trainer course type preference");
    }
    private Constraint minimizeUncovered(ConstraintFactory f) {
        return f.forEach(PlanningTask.class).filter(t -> t.getSelected().uncovered())
                .penalize(HardSoftScore.ONE_SOFT, t -> Math.max(t.getContactHours(), 1) * 100
                        + (t.isPriorityCoverage() ? 100000 : 0))
                .asConstraint("Maximize fully covered sections");
    }
    private Constraint preferredCreditedLoad(ConstraintFactory f) {
        return f.forEach(PlanningTask.class)
                .filter(t -> !t.getSelected().uncovered() && t.getSelected().preferredCreditedMilli()!=null)
                .groupBy(t -> t.getSelected().instructorId(),t -> t.getSelected().preferredCreditedMilli(),
                        ConstraintCollectors.sum(t -> t.getSelected().creditedMilli()))
                .reward(HardSoftScore.ONE_SOFT,(id,target,total) -> {
                    return (int)Math.min(target,total);
                }).asConstraint("Fill requested credited trainer loads");
    }
    private Constraint preferSundayToWednesday(ConstraintFactory f) {
        return f.forEach(PlanningTask.class).filter(t -> !t.getSelected().uncovered())
                .penalize(HardSoftScore.ONE_SOFT, t -> t.getSelected().undesirableHours())
                .asConstraint("Avoid Thursday and unnecessary evenings");
    }
}
