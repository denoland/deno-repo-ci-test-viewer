export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString();
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(2)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds.toFixed(1)}s`;
}

export interface TestTimelineProps {
  dateRange: string[];
  dailyCounts: { date: string; count: number }[];
  color: "red" | "yellow";
}

export function TestTimeline(
  { dateRange, dailyCounts, color }: TestTimelineProps,
) {
  if (dateRange.length === 0) {
    return null;
  }

  // Convert dailyCounts array to a map for quick lookup
  const countsMap = new Map(dailyCounts.map((d) => [d.date, d.count]));

  // Find the max count for scaling bar heights
  const maxCount = Math.max(1, ...dailyCounts.map((d) => d.count));

  // Color schemes
  const colors = {
    red: { fill: "#FEE2E2", stroke: "#EF4444", active: "#EF4444" },
    yellow: { fill: "#FEF3C7", stroke: "#F59E0B", active: "#F59E0B" },
  };
  const colorScheme = colors[color];

  // Calculate the last occurrence date
  const sortedDates = dailyCounts.map((d) => d.date).sort();
  const lastOccurrence = sortedDates[sortedDates.length - 1];
  const lastOccurrenceFormatted = lastOccurrence
    ? new Date(lastOccurrence + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })
    : null;

  return (
    <div class="mt-2">
      <div class="flex items-center gap-2">
        <div
          class="flex items-end gap-px flex-1"
          style={{ minWidth: 0, height: "16px" }}
        >
          {dateRange.map((date) => {
            const count = countsMap.get(date) || 0;
            const height = count > 0 ? Math.max(4, (count / maxCount) * 16) : 2;
            const isActive = count > 0;

            return (
              <div
                key={date}
                class="flex-1"
                style={{ minWidth: "2px", maxWidth: "8px" }}
                title={`${
                  new Date(date + "T00:00:00").toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })
                }: ${count} ${color === "red" ? "failure" : "flake"}${
                  count !== 1 ? "s" : ""
                }`}
              >
                <div
                  style={{
                    height: `${height}px`,
                    backgroundColor: isActive ? colorScheme.active : "#E5E7EB",
                    borderRadius: "1px",
                  }}
                />
              </div>
            );
          })}
        </div>
        {lastOccurrenceFormatted && (
          <span class="text-xs text-gray-500 whitespace-nowrap">
            Last: {lastOccurrenceFormatted}
          </span>
        )}
      </div>
    </div>
  );
}

export function getStatusBadge(status: string, conclusion: string | null) {
  if (status !== "completed") {
    return (
      <span class="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-semibold">
        Pending
      </span>
    );
  }

  if (conclusion === "success") {
    return (
      <span class="bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-semibold">
        Success
      </span>
    );
  } else if (conclusion === "failure") {
    return (
      <span class="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-semibold">
        Failure
      </span>
    );
  } else if (conclusion === "cancelled") {
    return (
      <span class="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs font-semibold">
        Cancelled
      </span>
    );
  } else {
    return (
      <span class="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs font-semibold">
        {conclusion || "Unknown"}
      </span>
    );
  }
}
