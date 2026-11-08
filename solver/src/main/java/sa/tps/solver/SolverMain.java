package sa.tps.solver;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import com.fasterxml.jackson.databind.ObjectMapper;
import ai.timefold.solver.core.api.solver.SolverFactory;
import ai.timefold.solver.core.config.solver.SolverConfig;

/** One JSON request via stdin; one JSON response via stdout. Never publishes to Rayat. */
public final class SolverMain {
    private SolverMain() {}
    public record Input(String schemaVersion, List<PlanningTask> tasks, int seconds) {}
    public record Selected(String taskId, String candidateId) {}
    public record Output(String schemaVersion, List<Selected> choices, long hardScore, long softScore) {}
    public static Output solve(Input input) {
        if (!"tps.timefold.v1".equals(input.schemaVersion()) || input.tasks() == null || input.tasks().size() > 1000)
            throw new IllegalArgumentException("Unsupported schema or too many sections");
        for (PlanningTask t : input.tasks()) {
            if (t.getId() == null || t.getChoices() == null || t.getChoices().isEmpty())
                throw new IllegalArgumentException("Empty choices");
            if (t.getChoices().stream().anyMatch(c -> !t.getId().equals(c.sectionId())))
                throw new IllegalArgumentException("Candidate section mismatch");
            if(t.getInitialCandidateId()!=null)
                t.setSelected(t.getChoices().stream().filter(c -> c.id().equals(t.getInitialCandidateId())).findFirst()
                        .orElseThrow(() -> new IllegalArgumentException("Unknown initial candidate")));
        }
        var config = new SolverConfig()
                .withSolutionClass(PlanningProblem.class)
                .withEntityClasses(PlanningTask.class)
                .withConstraintProviderClass(TpsConstraintProvider.class)
                .withTerminationSpentLimit(Duration.ofSeconds(Math.min(Math.max(input.seconds(), 1), 30)));
        var solver = SolverFactory.<PlanningProblem>create(config).buildSolver();
        // Entity-specific candidate ranges cannot exchange placements with a simple swap.
        // Construct priority coverage first so a feasible priority allocation is not trapped
        // behind an already allocated ordinary course and a temporary hard overload.
        var ordered=new java.util.ArrayList<>(input.tasks());
        ordered.sort(java.util.Comparator.comparing(PlanningTask::isPriorityCoverage).reversed());
        var result = solver.solve(new PlanningProblem(ordered));
        return new Output(input.schemaVersion(), result.getTasks().stream()
                .map(t -> new Selected(t.getId(), t.getSelected().id())).toList(),
                result.getScore().hardScore(), result.getScore().softScore());
    }
    public static void main(String[] args) {
        try {
            byte[] data = System.in.readNBytes(8_000_001);
            if (data.length > 8_000_000) throw new IllegalArgumentException("Payload exceeds limit");
            var mapper = new ObjectMapper();
            var input = mapper.readValue(new String(data, StandardCharsets.UTF_8), Input.class);
            System.out.println(mapper.writeValueAsString(solve(input)));
        } catch (Exception e) {
            System.err.println("TPS solver failed: " + e.getMessage());
            System.exit(1);
        }
    }
}
