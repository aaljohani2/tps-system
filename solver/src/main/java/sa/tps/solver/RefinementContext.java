package sa.tps.solver;

import java.util.*;

/** Opt-in scenario objectives; legacy solver weights remain exactly unchanged. */
public record RefinementContext(Map<String,Integer> blockSizes, List<SessionSlot> fixedSessions,
        List<SessionSlot> referenceSessions, Weights weights, Integer maxCampusDays, Map<String,Integer> requiredCreditedLoads) {
    public RefinementContext(Map<String,Integer> blockSizes,List<SessionSlot> fixedSessions,List<SessionSlot> referenceSessions,Weights weights,Integer maxCampusDays) {
        this(blockSizes,fixedSessions,referenceSessions,weights,maxCampusDays,null);
    }
    public RefinementContext(Map<String,Integer> blockSizes,List<SessionSlot> fixedSessions,List<SessionSlot> referenceSessions,Weights weights) {
        this(blockSizes,fixedSessions,referenceSessions,weights,null,null);
    }
    public int requiredLoadViolations(List<PlanningTask> tasks) {
        if(requiredCreditedLoads==null)return 0;
        int result=0;
        for(var entry:requiredCreditedLoads.entrySet()) {
            int actual=tasks.stream().filter(t->!t.getSelected().uncovered()&&entry.getKey().equals(t.getSelected().instructorId())).mapToInt(t->t.getSelected().creditedMilli()).sum();
            result+=Math.abs(actual-entry.getValue()*1000);
        }
        return result;
    }
    public int campusViolations(List<PlanningTask> tasks) {
        if(maxCampusDays==null)return 0;
        var all=new ArrayList<>(fixedSessions);
        tasks.stream().filter(t->!t.getSelected().uncovered()).forEach(t->all.addAll(t.getSelected().sessions()));
        int violations=0;
        for(var block:blockSizes.keySet()) {
            long count=all.stream().filter(s->"ONSITE".equals(s.mode())&&membership(s).contains(block)).map(SessionSlot::day).distinct().count();
            violations+=Math.max(0,(int)count-maxCampusDays);
        }
        return violations;
    }
    public record Weights(int studentGaps,int studentDays,int trainerGaps,int trainerDays,
            int changes,int roomCount,int coveragePenalty) {}
    private record Quality(int gaps,int days) {}
    private static Quality quality(List<SessionSlot> sessions) {
        int gaps=0,days=0;
        for(var day:List.of("SUN","MON","TUE","WED","THU")) {
            var rows=sessions.stream().filter(s->day.equals(s.day()))
                    .sorted(Comparator.comparingDouble(SessionSlot::start).thenComparingDouble(SessionSlot::end)).toList();
            if(rows.isEmpty())continue;
            days++;
            int end=(int)Math.round(rows.getFirst().end()*60);
            for(var row:rows.subList(1,rows.size())) {
                int start=(int)Math.round(row.start()*60);
                gaps+=Math.max(0,start-end-20);
                end=Math.max(end,(int)Math.round(row.end()*60));
            }
        }
        return new Quality(gaps,days);
    }
    private static List<String> membership(SessionSlot s) {
        return s.blockIds()!=null&&!s.blockIds().isEmpty()?s.blockIds():s.blockId()==null?List.of():List.of(s.blockId());
    }
    private static String signature(List<SessionSlot> sessions,String sectionId) {
        return String.join("|",sessions.stream().filter(s->sectionId.equals(s.sectionId())).map(s->
                s.day()+"/"+Math.round(s.start()*60)+"/"+Math.round(s.end()*60)+"/"+s.roomId()+"/"+s.instructorId()+"/"+s.component()).sorted().toList());
    }
    public int penalty(List<PlanningTask> tasks) {
        var internal=tasks.stream().filter(t->!t.getSelected().uncovered()).flatMap(t->t.getSelected().sessions().stream()).toList();
        var all=new ArrayList<>(internal);all.addAll(fixedSessions);
        long students=blockSizes.values().stream().mapToLong(Integer::longValue).sum();
        double learnerGaps=0,learnerDays=0;
        for(var block:blockSizes.entrySet()) {
            var q=quality(all.stream().filter(s->membership(s).contains(block.getKey())).toList());
            learnerGaps+=(long)q.gaps()*block.getValue();learnerDays+=(long)q.days()*block.getValue();
        }
        if(students>0){learnerGaps/=students;learnerDays/=students;}
        int trainerGaps=0,trainerDays=0;
        for(var instructor:internal.stream().map(SessionSlot::instructorId).filter(Objects::nonNull).distinct().toList()) {
            var q=quality(internal.stream().filter(s->instructor.equals(s.instructorId())).toList());
            trainerGaps+=q.gaps();trainerDays+=q.days();
        }
        int changed=0;long uncovered=0;
        for(var task:tasks) {
            if(task.getSelected().uncovered())uncovered+=Math.max(1,task.getContactHours());
            if(!signature(internal,task.getId()).equals(signature(referenceSessions,task.getId())))changed++;
        }
        long rooms=internal.stream().map(SessionSlot::roomId).filter(Objects::nonNull).distinct().count();
        double total=learnerGaps*weights.studentGaps()+learnerDays*weights.studentDays()+
                (long)trainerGaps*weights.trainerGaps()+(long)trainerDays*weights.trainerDays()+
                (long)changed*weights.changes()+rooms*weights.roomCount()+uncovered*weights.coveragePenalty();
        return (int)Math.min(1000000000,Math.max(0,Math.round(total)));
    }
}
