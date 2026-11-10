package sa.tps.solver;
import java.util.List;
import ai.timefold.solver.core.api.domain.solution.PlanningEntityCollectionProperty;
import ai.timefold.solver.core.api.domain.solution.PlanningScore;
import ai.timefold.solver.core.api.domain.solution.PlanningSolution;
import ai.timefold.solver.core.api.domain.solution.ProblemFactCollectionProperty;
import ai.timefold.solver.core.api.score.HardSoftScore;

@PlanningSolution
public class PlanningProblem {
    private List<PlanningTask> tasks;
    private HardSoftScore score;
    private List<RefinementContext> refinements=List.of();
    public PlanningProblem() {}
    public PlanningProblem(List<PlanningTask> tasks) {this.tasks=tasks;}
    public PlanningProblem(List<PlanningTask> tasks,RefinementContext refinement) {
        this.tasks=tasks;this.refinements=refinement==null?List.of():List.of(refinement);
    }
    @ProblemFactCollectionProperty public List<RefinementContext> getRefinements(){return refinements;}
    public void setRefinements(List<RefinementContext> refinements){this.refinements=refinements;}
    @PlanningEntityCollectionProperty public List<PlanningTask> getTasks() {return tasks;}
    public void setTasks(List<PlanningTask> tasks) {this.tasks=tasks;}
    @PlanningScore public HardSoftScore getScore(){return score;}
    public void setScore(HardSoftScore score){this.score=score;}
}
