package sa.tps.solver;

public record SessionSlot(String id, String sectionId, String courseCode, String component,
        String mode, String day, double start, double end, String roomId,
        String instructorId, String blockId) {
    public boolean overlaps(SessionSlot other) {
        return day.equals(other.day) && start < other.end && other.start < end;
    }
    public boolean conflictsWith(SessionSlot other) {
        if (!overlaps(other)) return false;
        return sectionId.equals(other.sectionId) || instructorId.equals(other.instructorId)
                || (roomId != null && roomId.equals(other.roomId))
                || (blockId != null && blockId.equals(other.blockId));
    }
}
