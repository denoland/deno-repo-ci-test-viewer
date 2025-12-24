import { define } from "@/define.ts";
import type {
  RecordedTestResult,
  TestResultsDownloader,
} from "@/lib/test-results-downloader.ts";
import type { GitHubApiClient, WorkflowRun } from "@/lib/github-api-client.ts";
import type { Logger } from "@/lib/logger.ts";

export const handler = define.handlers({
  GET(ctx) {
    return ctx.state.store.get("controller.insights").get();
  },
});

export class InsightsPageController {
  #logger: Logger;
  #githubClient: Pick<GitHubApiClient, "listWorkflowRuns">;
  #downloader: TestResultsDownloader;

  constructor(
    logger: Logger,
    githubClient: Pick<GitHubApiClient, "listWorkflowRuns">,
    downloader: TestResultsDownloader,
  ) {
    this.#logger = logger.withContext(InsightsPageController.name);
    this.#githubClient = githubClient;
    this.#downloader = downloader;
  }

  async get() {
    // Fetch the last 100 runs (to ensure we get at least 20 completed main branch runs)
    const { runs: allRuns } = await this.#githubClient.listWorkflowRuns(100, 1);

    // Filter to only completed CI runs on main branch
    const mainBranchRuns = allRuns
      .filter(
        (run: WorkflowRun) =>
          run.head_branch === "main" &&
          run.status === "completed" &&
          run.name.toLowerCase() === "ci",
      )
      .slice(0, 20);

    // Download test results for all runs
    const allResults = (await Promise.all(mainBranchRuns.map(async (run) => {
      try {
        const results = await this.#downloader.downloadForRunId(run.id);
        return { runId: run.id, run, results };
      } catch (error) {
        this.#logger.logError(
          `Failed to download results for run ${run.id}:`,
          error,
        );
        return undefined!;
      }
    }))).filter((r) => r != null);

    // Analyze flaky tests across all runs
    const flakyTestsMap = new Map<
      string,
      {
        name: string;
        path: string;
        totalFlakyCounts: number;
        occurrences: number;
        avgFlakyCount: number;
        runIds: number[];
      }
    >();

    // Analyze failed tests across all runs
    const failedTestsMap = new Map<
      string,
      {
        name: string;
        path: string;
        failureCount: number;
        runIds: number[];
      }
    >();

    function processTest(test: RecordedTestResult, runId: number) {
      // Track flaky tests
      if (test.flakyCount && test.flakyCount > 0) {
        const key = `${test.path}::${test.name}`;
        const existing = flakyTestsMap.get(key);

        if (existing) {
          existing.totalFlakyCounts += test.flakyCount;
          existing.occurrences++;
          existing.runIds.push(runId);
          existing.avgFlakyCount = existing.totalFlakyCounts /
            existing.occurrences;
        } else {
          flakyTestsMap.set(key, {
            name: test.name,
            path: test.path,
            totalFlakyCounts: test.flakyCount,
            occurrences: 1,
            avgFlakyCount: test.flakyCount,
            runIds: [runId],
          });
        }
      }

      // Track failed tests
      if (test.failed) {
        const key = `${test.path}::${test.name}`;
        const existing = failedTestsMap.get(key);

        if (existing) {
          existing.failureCount++;
          if (!existing.runIds.includes(runId)) {
            existing.runIds.push(runId);
          }
        } else {
          failedTestsMap.set(key, {
            name: test.name,
            path: test.path,
            failureCount: 1,
            runIds: [runId],
          });
        }
      }

      if (test.subTests) {
        test.subTests.forEach((subTest) => processTest(subTest, runId));
      }
    }

    allResults.forEach(({ runId, results }) => {
      results.forEach((jobResult) => {
        jobResult.tests.forEach((test) => processTest(test, runId));
      });
    });

    // Convert to array and sort by total flaky counts
    const flakyTests = Array.from(flakyTestsMap.values()).sort(
      (a, b) => b.totalFlakyCounts - a.totalFlakyCounts,
    );

    // Convert to array and sort by failure count
    const failedTests = Array.from(failedTestsMap.values()).sort(
      (a, b) => b.failureCount - a.failureCount,
    );

    return {
      data: {
        flakyTests,
        failedTests,
        totalRunsAnalyzed: mainBranchRuns.length,
        oldestRun: mainBranchRuns[mainBranchRuns.length - 1],
        newestRun: mainBranchRuns[0],
      },
    };
  }
}

export default define.page<typeof handler>(function InsightsPage({ data }) {
  const { flakyTests, failedTests, totalRunsAnalyzed, oldestRun, newestRun } =
    data;

  return (
    <div class="container mx-auto px-4 py-8 max-w-7xl">
      <div class="mb-8">
        <h1 class="text-3xl font-bold mb-2">Test Insights (Main Branch)</h1>
        <p class="text-gray-600 mb-2">
          Analysis of test behavior across the last {totalRunsAnalyzed}{" "}
          completed CI runs on the main branch
        </p>
        {oldestRun && newestRun && (
          <div class="text-sm text-gray-500">
            From run #{oldestRun.id} to #{newestRun.id}
          </div>
        )}
        <a
          href="/"
          class="text-blue-600 hover:text-blue-800 text-sm mt-2 inline-block"
        >
          ← Back to runs list
        </a>
      </div>

      <div class="bg-white rounded-lg shadow mb-6">
        <div class="bg-red-100 px-4 py-3 rounded-t-lg border-b border-red-300">
          <div class="flex items-center justify-between">
            <h2 class="font-semibold text-xl">
              ❌ Most Frequently Failing Tests ({failedTests.length})
            </h2>
          </div>
        </div>
        {failedTests.length === 0
          ? (
            <div class="p-8 text-center">
              <div class="text-6xl mb-4">🎉</div>
              <h3 class="text-xl font-bold mb-2">No Failed Tests!</h3>
              <p class="text-gray-600">
                All tests passed across the analyzed runs.
              </p>
            </div>
          )
          : (
            <div class="divide-y divide-gray-200">
              {failedTests.map((test, idx) => (
                <div
                  key={idx}
                  class="px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div class="flex items-start justify-between gap-4">
                    <div class="flex-1 min-w-0">
                      <div class="font-mono text-sm font-semibold text-gray-900 mb-1">
                        {test.name}
                      </div>
                      {test.path && (
                        <div class="text-xs text-gray-500 mb-2">
                          {test.path}
                        </div>
                      )}
                      <div class="flex items-center gap-4 text-xs text-gray-600">
                        <span>
                          Failed in{" "}
                          <span class="font-semibold">
                            {test.runIds.length}
                          </span>{" "}
                          of {totalRunsAnalyzed} runs
                        </span>
                        <span>
                          Failure rate:{" "}
                          <span class="font-semibold">
                            {((test.runIds.length / totalRunsAnalyzed) * 100)
                              .toFixed(1)}%
                          </span>
                        </span>
                      </div>
                    </div>
                    <div class="flex-shrink-0">
                      <div class="bg-red-100 text-red-800 px-3 py-2 rounded text-center">
                        <div class="text-2xl font-bold">
                          {test.failureCount}
                        </div>
                        <div class="text-xs">failures</div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>

      <div class="bg-white rounded-lg shadow">
        <div class="bg-yellow-100 px-4 py-3 rounded-t-lg border-b border-yellow-300">
          <div class="flex items-center justify-between">
            <h2 class="font-semibold text-xl">
              ⚠️ Most Flaky Tests ({flakyTests.length})
            </h2>
          </div>
        </div>
        {flakyTests.length === 0
          ? (
            <div class="p-8 text-center">
              <div class="text-6xl mb-4">🎉</div>
              <h3 class="text-xl font-bold mb-2">No Flaky Tests Found!</h3>
              <p class="text-gray-600">
                All tests have been stable across the analyzed runs.
              </p>
            </div>
          )
          : (
            <div class="divide-y divide-gray-200">
              {flakyTests.map((test, idx) => (
                <div
                  key={idx}
                  class="px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div class="flex items-start justify-between gap-4">
                    <div class="flex-1 min-w-0">
                      <div class="font-mono text-sm font-semibold text-gray-900 mb-1">
                        {test.name}
                      </div>
                      {test.path && (
                        <div class="text-xs text-gray-500 mb-2">
                          {test.path}
                        </div>
                      )}
                      <div class="flex items-center gap-4 text-xs text-gray-600">
                        <span>
                          Flaked in{" "}
                          <span class="font-semibold">
                            {test.occurrences}
                          </span>{" "}
                          of {totalRunsAnalyzed} runs
                        </span>
                        <span>
                          Total flakes:{" "}
                          <span class="font-semibold">
                            {test.totalFlakyCounts}
                          </span>
                        </span>
                        <span>
                          Avg flakes per occurrence:{" "}
                          <span class="font-semibold">
                            {test.avgFlakyCount.toFixed(1)}
                          </span>
                        </span>
                      </div>
                    </div>
                    <div class="flex-shrink-0">
                      <div class="bg-yellow-100 text-yellow-800 px-3 py-2 rounded text-center">
                        <div class="text-2xl font-bold">
                          {test.totalFlakyCounts}
                        </div>
                        <div class="text-xs">total flakes</div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
});
