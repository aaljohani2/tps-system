package sa.tps.solver;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class SolverMainTest {
    @Test void requiredLoadIsHardAndMissingHoursCannotBeReportedAsSatisfied() {
        var slot=new SessionSlot("s","S","C","THEORY","ONSITE","SUN",8,10,"R","T","B");
        var task=new PlanningTask();task.setId("S");task.setCourseCode("C");task.setContactHours(2);
        task.setChoices(List.of(new Placement("none","S","C",null,0,0,true,List.of()),new Placement("yes","S","C","T",2000,24000,false,List.of(slot))));
        var weights=new RefinementContext.Weights(0,0,0,0,0,0,1000000);
        var exact=new RefinementContext(java.util.Map.of("B",20),List.of(),List.of(),weights,null,java.util.Map.of("T",2));
        var result=SolverMain.solve(new SolverMain.Input("tps.timefold.v1",List.of(task),1,exact,42L));
        assertEquals(0,result.hardScore());assertEquals("yes",result.choices().getFirst().candidateId());
        var impossible=new RefinementContext(java.util.Map.of("B",20),List.of(),List.of(),weights,null,java.util.Map.of("T",3));
        result=SolverMain.solve(new SolverMain.Input("tps.timefold.v1",List.of(task),1,impossible,42L));
        assertTrue(result.hardScore()<0);
    }
    @Test void actualTimefoldCannotAddThirdCampusDayButMayUseRemoteThirdDay() {
        var monday=new SessionSlot("fixed1","G1","G","THEORY","ONSITE","MON",8,10,null,"","BLOCK");
        var wednesday=new SessionSlot("fixed2","G2","G","PRACTICAL","ONSITE","WED",8,10,null,"","BLOCK");
        var onsite=new SessionSlot("onsite","SEC","X","THEORY","ONSITE","SUN",8,10,"R","T","BLOCK");
        var remote=new SessionSlot("remote","SEC","X","THEORY","REMOTE","SUN",8,10,null,"T","BLOCK");
        var task=new PlanningTask();task.setId("SEC");task.setCourseCode("X");task.setContactHours(2);
        task.setChoices(List.of(new Placement("none","SEC","X",null,0,0,true,List.of()),
            new Placement("onsite","SEC","X","T",2000,24000,false,List.of(onsite)),
            new Placement("remote","SEC","X","T",2000,24000,false,List.of(remote))));
        var context=new RefinementContext(java.util.Map.of("BLOCK",40),List.of(monday,wednesday),List.of(),new RefinementContext.Weights(0,0,0,0,0,0,1000000),2);
        var result=SolverMain.solve(new SolverMain.Input("tps.timefold.v1",List.of(task),1,context,42L));
        assertEquals(0,result.hardScore());assertEquals("remote",result.choices().getFirst().candidateId());
    }
    @Test void refinementMeasuresWeightedLearnerGapsAndDoesNotChargeNormalBreaks() {
        var first=new SessionSlot("a","A","X","THEORY","ONSITE","SUN",8,9+40.0/60,"R","T","A");
        var far=new SessionSlot("b","B","Y","THEORY","ONSITE","SUN",12,13+40.0/60,"R","T","A");
        var close=new SessionSlot("c","B","Y","THEORY","ONSITE","SUN",10,11+40.0/60,"R","T","A");
        var a=new PlanningTask();a.setId("A");a.setContactHours(2);a.setSelected(new Placement("a","A","X","T",2000,24000,false,List.of(first)));
        var b=new PlanningTask();b.setId("B");b.setContactHours(2);b.setSelected(new Placement("far","B","Y","T",2000,24000,false,List.of(far)));
        var context=new RefinementContext(java.util.Map.of("A",10,"UNSCHEDULED_STUDENT",30),List.of(),List.of(),
                new RefinementContext.Weights(1,0,0,0,0,0,1000000));
        assertEquals(30,context.penalty(List.of(a,b)));
        b.setSelected(new Placement("close","B","Y","T",2000,24000,false,List.of(close)));
        assertEquals(0,context.penalty(List.of(a,b)));
    }
    @Test void actualTimefoldRefinementPrefersCompactLearnerDayWithoutSacrificingCoverage() {
        var first=new SessionSlot("a","A","X","THEORY","ONSITE","SUN",8,9+40.0/60,"R","T","BLOCK");
        var far=new SessionSlot("b","B","Y","THEORY","ONSITE","SUN",12,13+40.0/60,"R","T","BLOCK");
        var close=new SessionSlot("c","B","Y","THEORY","ONSITE","SUN",10,11+40.0/60,"R","T","BLOCK");
        var pa=new Placement("A:yes","A","X","T",2000,24000,false,List.of(first));
        var pf=new Placement("B:far","B","Y","T",2000,24000,false,List.of(far));
        var pc=new Placement("B:close","B","Y","T",2000,24000,false,List.of(close));
        var a=new PlanningTask();a.setId("A");a.setCourseCode("X");a.setContactHours(2);a.setChoices(List.of(new Placement("A:no","A","X",null,0,0,true,List.of()),pa));a.setInitialCandidateId("A:yes");
        var b=new PlanningTask();b.setId("B");b.setCourseCode("Y");b.setContactHours(2);b.setChoices(List.of(new Placement("B:no","B","Y",null,0,0,true,List.of()),pf,pc));b.setInitialCandidateId("B:far");
        var context=new RefinementContext(java.util.Map.of("BLOCK",20),List.of(),List.of(first,far),new RefinementContext.Weights(10,0,0,0,0,0,1000000));
        var solved=SolverMain.solve(new SolverMain.Input("tps.timefold.v1",List.of(a,b),1,context,42L));
        assertEquals(0,solved.hardScore());
        assertTrue(solved.choices().stream().anyMatch(c->c.candidateId().equals("B:close")));
        assertTrue(solved.choices().stream().noneMatch(c->c.candidateId().endsWith(":no")));
    }
    @Test void priorityCoverageDoesNotBypassHardTrainerLoad() {
        var tasks=new java.util.ArrayList<PlanningTask>();
        for(int index=0;index<2;index++) {
            var id="C"+index;
            var slot=new SessionSlot(id,id,id,"THEORY","ONSITE","SUN",8+index*2,10+index*2,"R","T",id);
            var covered=new Placement(id+":yes",id,id,"T",2000,2000,false,List.of(slot));
            var none=new Placement(id+":no",id,id,null,0,0,true,List.of());
            var task=new PlanningTask();task.setId(id);task.setCourseCode(id);task.setContactHours(2);
            task.setPriorityCoverage(index==1);task.setChoices(List.of(none,covered));tasks.add(task);
        }
        var result=SolverMain.solve(new SolverMain.Input("tps.timefold.v1",tasks,1));
        assertEquals(0,result.hardScore());
        assertEquals("C0:no",result.choices().stream().filter(choice->choice.taskId().equals("C0")).findFirst().orElseThrow().candidateId());
        assertEquals("C1:yes",result.choices().stream().filter(choice->choice.taskId().equals("C1")).findFirst().orElseThrow().candidateId());
    }
    @Test void economicsCohortOverlapIsSoftButResourcesAndOrdinaryCohortsRemainHard() {
        var economics=new SessionSlot("E","ECO","ECO","THEORY","ONSITE","SUN",10,12.5,"R1","T1","G::A",null,3.0,true);
        var ordinary=new SessionSlot("O","MAIN","MAIN","THEORY","ONSITE","SUN",10,11+40.0/60,"R2","T2","G::A",null,2.0,false);
        assertFalse(economics.conflictsWith(ordinary));assertFalse(ordinary.conflictsWith(economics));
        var sameRoom=new SessionSlot("R","MAIN","MAIN","THEORY","ONSITE","SUN",10,11+40.0/60,"R1","T2","G::A",null,2.0,false);
        assertTrue(economics.conflictsWith(sameRoom));
        var sameTrainer=new SessionSlot("T","MAIN","MAIN","THEORY","ONSITE","SUN",10,11+40.0/60,"R2","T1","G::A",null,2.0,false);
        assertTrue(economics.conflictsWith(sameTrainer));
        var secondOrdinary=new SessionSlot("B","OTHER","OTHER","THEORY","ONSITE","SUN",10,11+40.0/60,"R3","T3","G::A",null,2.0,false);
        assertTrue(ordinary.conflictsWith(secondOrdinary));
        var placement=new Placement("P","ECO","ECO","T1",3000,12000,false,List.of(economics));
        assertEquals(2500,placement.contactMilli());
    }
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
