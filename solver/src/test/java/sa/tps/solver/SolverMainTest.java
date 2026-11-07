package sa.tps.solver;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class SolverMainTest {
    @Test void groupedTheoryCannotOverlapAnyConstituentPracticalBlock() {
        var lecture = new SessionSlot("a","LECT","TH","THEORY","ONSITE","SUN",8,10,
                "ROOM1","TRAINER1","G::B01 + G::B02",List.of("G::B01","G::B02"));
        var practical = new SessionSlot("b","LAB","PR","PRACTICAL","ONSITE","SUN",8,10,
                "ROOM2","TRAINER2","G::B02");
        var unrelated = new SessionSlot("c","LAB2","PR","PRACTICAL","ONSITE","SUN",8,10,
                "ROOM3","TRAINER3","G::B03");
        assertTrue(lecture.conflictsWith(practical),"Shared learner membership must be a hard collision");
        assertTrue(practical.conflictsWith(lecture),"Collision check must be symmetric");
        assertFalse(lecture.conflictsWith(unrelated));
    }
    @Test void choosesAtomicPlacementsWithoutCollisionOrOverload() {
        var a = new SessionSlot("a","A","X","THEORY","ONSITE","SUN",8,10,"R1","T1","B1");
        var b = new SessionSlot("b","B","Y","THEORY","ONSITE","SUN",8,10,"R1","T1","B2");
        var c = new SessionSlot("c","B","Y","THEORY","ONSITE","MON",8,10,"R1","T1","B2");
        var p1 = new Placement("A:one","A","X","T1",2000,4000,false,List.of(a));
        var p2 = new Placement("B:collision","B","Y","T1",2000,4000,false,List.of(b));
        var p3 = new Placement("B:good","B","Y","T1",2000,4000,false,List.of(c));
        var unA = new Placement("A:none","A","X",null,0,0,true,List.of());
        var unB = new Placement("B:none","B","Y",null,0,0,true,List.of());
        var ta = new PlanningTask(); ta.setId("A"); ta.setCourseCode("X"); ta.setContactHours(2); ta.setChoices(List.of(unA,p1));
        var tb = new PlanningTask(); tb.setId("B"); tb.setCourseCode("Y"); tb.setContactHours(2); tb.setChoices(List.of(unB,p2,p3));
        var response = SolverMain.solve(new SolverMain.Input("tps.timefold.v1", List.of(ta,tb), 2));
        assertEquals(0,response.hardScore());
        assertTrue(response.choices().stream().anyMatch(x -> x.candidateId().equals("A:one")));
        assertTrue(response.choices().stream().anyMatch(x -> x.candidateId().equals("B:good")));
    }
}
