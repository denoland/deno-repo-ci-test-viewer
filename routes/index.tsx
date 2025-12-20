import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const runsFetcher = await ctx.state.store.get("runsFetcher");
    const url = new URL(ctx.req.url);
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const perPage = 30;

    const result = await runsFetcher.fetchRecentRuns(perPage, page);

    return {
      data: {
        runs: result.runs,
        totalCount: result.totalCount,
        currentPage: page,
        perPage,
        totalPages: Math.ceil(result.totalCount / perPage),
      },
    };
  },
});

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString();
}

function getStatusBadge(status: string, conclusion: string | null) {
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

export default define.page<typeof handler>(function Home({ data }) {
  const { runs, currentPage, totalPages, totalCount } = data;

  return (
    <div class="px-4 py-8 mx-auto min-h-screen bg-gray-50">
      <Head>
        <title>Deno CI Test Viewer</title>
      </Head>
      <div class="max-w-6xl mx-auto">
        <div class="mb-8">
          <h1 class="text-4xl font-bold mb-2">Deno CI Test Viewer</h1>
          <p class="text-gray-600">View test results from recent CI runs</p>
        </div>

        <div class="bg-white rounded-lg shadow">
          <div class="px-6 py-4 border-b border-gray-200">
            <div class="flex items-center justify-between">
              <h2 class="text-xl font-semibold">Recent Workflow Runs</h2>
              <div class="text-sm text-gray-600">
                Total: {totalCount} runs
              </div>
            </div>
          </div>
          <div class="divide-y divide-gray-200">
            {runs.length === 0
              ? (
                <div class="px-6 py-8 text-center text-gray-500">
                  No runs found
                </div>
              )
              : (
                runs.map((run) => (
                  <a
                    href={`/results/${run.id}`}
                    class="block px-6 py-4 hover:bg-gray-50 transition-colors"
                  >
                    <div class="flex items-start justify-between gap-4">
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                          {getStatusBadge(run.status, run.conclusion)}
                          <span class="font-semibold text-gray-900">
                            {run.display_title}
                          </span>
                        </div>
                        <div class="text-sm text-gray-600 mb-1">
                          {run.name} #{run.run_number}
                        </div>
                        <div class="text-xs text-gray-500">
                          {run.head_branch} • {run.event}
                        </div>
                      </div>
                      <div class="text-right flex-shrink-0">
                        <div class="text-sm text-gray-900 font-mono">
                          Run #{run.id}
                        </div>
                        <div class="text-xs text-gray-500 mt-1">
                          {formatDate(run.created_at)}
                        </div>
                      </div>
                    </div>
                  </a>
                ))
              )}
          </div>
          {totalPages > 1 && (
            <div class="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              <div class="text-sm text-gray-600">
                Page {currentPage} of {totalPages}
              </div>
              <div class="flex gap-2">
                {currentPage > 1 && (
                  <a
                    href={`/?page=${currentPage - 1}`}
                    class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                  >
                    Previous
                  </a>
                )}
                {currentPage < totalPages && (
                  <a
                    href={`/?page=${currentPage + 1}`}
                    class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                  >
                    Next
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
