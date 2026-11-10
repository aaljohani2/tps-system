package sa.tps.solver;
import java.util.List;
import ai.timefold.solver.core.api.domain.entity.PlanningEntity;
import ai.timefold.solver.core.api.domain.entity.PlanningId;
import ai.timefold.solver.core.api.domain.variable.PlanningVariable;
import ai.timefold.solver.core.api.domain.valuerange.ValueRangeProvider;

@PlanningEntity
public class PlanningTask {
    private String id;
    private String courseCode;
    private int level;
    private int contactHours;
    private boolean exclusiveInstructor;
    private List<Placement> choices;
    private Placement selected;
    public PlanningTask() {}
    @PlanningId public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getCourseCode() { return courseCode; }
    public void setCourseCode(String courseCode) { this.courseCode = courseCode; }
    public int getLevel() { return level; }
    public void setLevel(int level) { this.level = level; }
    public int getContactHours() { return contactHours; }
    public void setContactHours(int contactHours) { this.contactHours = contactHours; }
    public boolean isExclusiveInstructor() { return exclusiveInstructor; }
    public void setExclusiveInstructor(boolean exclusiveInstructor) { this.exclusiveInstructor = exclusiveInstructor; }
    @ValueRangeProvider(id = "candidateRange") public List<Placement> getChoices() { return choices; }
    public void setChoices(List<Placement> choices) { this.choices = choices; }
    @PlanningVariable(valueRangeProviderRefs = "candidateRange") public Placement getSelected() { return selected; }
    public void setSelected(Placement selected) { this.selected = selected; }
}
