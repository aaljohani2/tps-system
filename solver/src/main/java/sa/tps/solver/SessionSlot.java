package sa.tps.solver;

import java.util.List;
import java.util.HashSet;

/** Keep every source cohort-block ID for merged theoretical lectures.
 * A compound display blockId alone must never hide overlapping membership.
 */
public record SessionSlot(String id, String sectionId, String courseCode, String component,
        String mode, String day, double start, double end, String roomId,
        String instructorId, String blockId, List<String> blockIds) {

    /** Backward-compatible constructor for existing single-block solver fixtures. */
    public SessionSlot(String id, String sectionId, String courseCode, String component,
            String mode, String day, double start, double end, String roomId,
            String instructorId, String blockId) {
        this(id, sectionId, courseCode, component, mode, day, start, end, roomId, instructorId, blockId, null);
    }
    public boolean overlaps(SessionSlot other) {
        return day.equals(other.day) && start < other.end && other.start < end;
    }
    private List<String> membership() {
        if (blockIds != null && !blockIds.isEmpty()) return blockIds;
        return blockId == null ? List.of() : List.of(blockId);
    }
    public boolean sharesBlock(SessionSlot other) {
        var own = membership();
        if (own.isEmpty()) return false;
        var unique = new HashSet<>(own);
        return other.membership().stream().anyMatch(unique::contains);
    }
    public boolean conflictsWith(SessionSlot other) {
        if (!overlaps(other)) return false;
        return sectionId.equals(other.sectionId) || instructorId.equals(other.instructorId)
                || (roomId != null && roomId.equals(other.roomId)) || sharesBlock(other);
    }
}
