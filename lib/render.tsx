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
