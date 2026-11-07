package sa.tps.solver;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class SolverMainTest {
    @Test void hardSectionCountCannotBeBypassedByLowWeightedLoad() {
        var tasks = new java.util.ArrayList<PlanningTask>();
        for (int index=0;index<3;index++) {
            var id="SEC"+index;
            var slot=new SessionSlot(id,id,"LAB","PRACTICAL","ONSITE","SUN",8+index*2,10+index*2,"R","T","B"+index);
            var covered=new Placement(id+":yes",id,"LAB","T",1000,24000,false,List.of(slot),12000,1,null,null);
            var uncovered=new Placement(id+":no",id,"LAB",null,0,0,true,List.of());
            var task=new PlanningTask();task.setId(id);task.setCourseCode("LAB");task.setContactHours(2);task.setChoices(List.of(uncovered,covered));tasks.add(task);
        }
        var response=SolverMain.solve(new SolverMain.Input("tps.timefold.v1",tasks,1));
        assertEquals(0,response.hardScore());
        assertEquals(1,response.choices().stream().filter(choice->choice.candidateId().endsWith(":yes")).count());
    }
    @Test void preferredCourseTypeBreaksEquivalentAssignmentTies() {
        var first=new SessionSlot("A","SEC","LAB","PRACTICAL","ONSITE","SUN",8,10,"R","PREFERRED","B");
        var second=new SessionSlot("B","SEC","LAB","PRACTICAL","ONSITE","SUN",8,10,"R","OTHER","B");
        var preferred=new Placement("preferred","SEC","LAB","PREFERRED",2000,12000,false,List.of(first),null,null,null,20);
        var other=new Placement("other","SEC","LAB","OTHER",2000,12000,false,List.of(second));
        var none=new Placement("none","SEC","LAB",null,0,0,true,List.of());
        var task=new PlanningTask();task.setId("SEC");task.setCourseCode("LAB");task.setContactHours(2);task.setChoices(List.of(none,other,preferred));
        var response=SolverMain.solve(new SolverMain.Input("tps.timefold.v1",List.of(task),1));
        assertEquals("preferred",response.choices().getFirst().candidateId());
    }
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
