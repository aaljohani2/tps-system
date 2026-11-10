package sa.tps.solver;
import java.util.List;
import ai.timefold.solver.core.api.domain.solution.PlanningEntityCollectionProperty;
import ai.timefold.solver.core.api.domain.solution.PlanningScore;
import ai.timefold.solver.core.api.domain.solution.PlanningSolution;
import ai.timefold.solver.core.api.score.buildin.hardsoft.HardSoftScore;

@PlanningSolution
public class PlanningProblem {
    private List<PlanningTask> tasks;
    private HardSoftScore score;
    public PlanningProblem() {}
    public PlanningProblem(List<PlanningTask> tasks) {this.tasks=tasks;}
    @PlanningEntityCollectionProperty public List<PlanningTask> getTasks() {return tasks;}
    public void setTasks(List<PlanningTask> tasks) {this.tasks=tasks;}
    @PlanningScore public HardSoftScore getScore(){return score;}
    public void setScore(HardSoftScore score){this.score=score;}
}
