package sa.tps.solver;
import java.util.List;

/** An indivisible choice for one section; includes its full theory/practical timetable. */
public record Placement(String id, String sectionId, String courseCode, String instructorId,
        int creditedMilli, int effectiveLimitMilli, boolean uncovered,
        List<SessionSlot> sessions, Integer contactLimitMilli, Integer sectionLimit,
        Integer preferredSectionCount, Integer preferenceScore) {
    public Placement(String id,String sectionId,String courseCode,String instructorId,int creditedMilli,
            int effectiveLimitMilli,boolean uncovered,List<SessionSlot> sessions) {
        this(id,sectionId,courseCode,instructorId,creditedMilli,effectiveLimitMilli,uncovered,sessions,null,null,null,null);
    }
    public int contactMilli() {
        return (int)Math.round(sessions.stream().mapToDouble(s -> s.end()-s.start()).sum()*1000);
    }
    public boolean conflictsWith(Placement other) {
        if (uncovered || other.uncovered) return false;
        for (var a : sessions) for (var b : other.sessions) if (a.conflictsWith(b)) return true;
        return false;
    }
    public int undesirableHours() {
        if (uncovered) return 0;
        return sessions.stream().mapToInt(s -> (s.day().equals("THU") ? 5 : 0)
                + (s.start() >= 16 ? 1 : 0)).sum();
    }
}
