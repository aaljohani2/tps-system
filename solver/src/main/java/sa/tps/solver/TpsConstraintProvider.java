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
                minimizeUncovered(f), preferSundayToWednesday(f)
        };
    }
    private Constraint overlappingSessions(ConstraintFactory f) {
        return f.forEachUniquePair(PlanningTask.class)
                .filter((a,b) -> a.getSelected().conflictsWith(b.getSelected()))
                .penalize(HardSoftScore.ONE_HARD, (a,b) -> 1)
                .asConstraint("No instructor room or cohort collision");
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
    private Constraint minimizeUncovered(ConstraintFactory f) {
        return f.forEach(PlanningTask.class).filter(t -> t.getSelected().uncovered())
                .penalize(HardSoftScore.ONE_SOFT, t -> Math.max(t.getContactHours(), 1) * 100)
                .asConstraint("Maximize fully covered sections");
    }
    private Constraint preferSundayToWednesday(ConstraintFactory f) {
        return f.forEach(PlanningTask.class).filter(t -> !t.getSelected().uncovered())
                .penalize(HardSoftScore.ONE_SOFT, t -> t.getSelected().undesirableHours())
                .asConstraint("Avoid Thursday and unnecessary evenings");
    }
}
