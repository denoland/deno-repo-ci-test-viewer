import { define } from "@/define.ts";
import type {
  RecordedTestResult,
  TestResultsDownloader,
} from "@/lib/test-results-downloader.ts";
import type { GitHubApiClient, WorkflowRun } from "@/lib/github-api-client.ts";
import type { Logger } from "@/lib/logger.ts";
import { formatDuration, TestTimeline } from "@/lib/render.tsx";

export const handler = define.handlers({
  GET(ctx) {
    return ctx.state.store.get("controller.insights").get();
  },
});

export class InsightsPageController {
  #logger: Logger;
  #githubClient: Pick<GitHubApiClient, "listWorkflowRuns" | "listJobs">;
  #downloader: TestResultsDownloader;

  constructor(
    logger: Logger,
    githubClient: Pick<GitHubApiClient, "listWorkflowRuns" | "listJobs">,
    downloader: TestResultsDownloader,
  ) {
    this.#logger = logger.withContext(InsightsPageController.name);
    this.#githubClient = githubClient;
    this.#downloader = downloader;
  }

  async get() {
    // fetch main branch runs directly
    const [page1, page2] = await Promise.all([
      this.#githubClient.listWorkflowRuns(100, 1, "main"),
      this.#githubClient.listWorkflowRuns(100, 2, "main"),
    ]);
    const allRuns = [...page1.runs, ...page2.runs];

    // Filter to only completed CI runs
    const mainBranchRuns = allRuns
      .filter(
        (run: WorkflowRun) =>
          run.status === "completed" &&
          run.name.toLowerCase() === "ci",
      )
      .slice(0, 20);

    // Download test results and job timing data for all runs
    const allResults = (await Promise.all(mainBranchRuns.map(async (run) => {
      try {
        const [results, jobs] = await Promise.all([
          this.#downloader.downloadForRunId(run.id),
          this.#githubClient.listJobs(run.id),
        ]);
        return { runId: run.id, run, results, jobs };
      } catch (error) {
        this.#logger.logError(
          `Failed to download data for run ${run.id}:`,
          error,
        );
        return undefined!;
      }
    }))).filter((r) => r != null);

    // Build a map of runId to date for timeline lookups
    const runIdToDate = new Map<number, string>();
    allResults.forEach(({ runId, run }) => {
      runIdToDate.set(runId, run.created_at.split("T")[0]);
    });

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
        jobCounts: Map<string, number>;
        dailyCounts: Map<string, number>; // date -> flaky count
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
        dailyCounts: Map<string, number>; // date -> failure count
      }
    >();

    // Track flaky test counts per job
    const jobFlakyCountsMap = new Map<string, number>();

    function processTest(
      test: RecordedTestResult,
      runId: number,
      jobName: string,
    ) {
      const runDate = runIdToDate.get(runId)!;

      // Track flaky tests
      if (test.flakyCount && test.flakyCount > 0) {
        const key = `${test.path}::${test.name}`;
        const existing = flakyTestsMap.get(key);

        if (existing) {
          existing.totalFlakyCounts += test.flakyCount;
          existing.occurrences++;
          if (!existing.runIds.includes(runId)) {
            existing.runIds.push(runId);
          }
          existing.avgFlakyCount = existing.totalFlakyCounts /
            existing.occurrences;
          existing.jobCounts.set(
            jobName,
            (existing.jobCounts.get(jobName) || 0) + test.flakyCount,
          );
          existing.dailyCounts.set(
            runDate,
            (existing.dailyCounts.get(runDate) || 0) + test.flakyCount,
          );
        } else {
          flakyTestsMap.set(key, {
            name: test.name,
            path: test.path,
            totalFlakyCounts: test.flakyCount,
            occurrences: 1,
            avgFlakyCount: test.flakyCount,
            runIds: [runId],
            jobCounts: new Map([[jobName, test.flakyCount]]),
            dailyCounts: new Map([[runDate, test.flakyCount]]),
          });
        }

        // Track flaky counts per job
        jobFlakyCountsMap.set(
          jobName,
          (jobFlakyCountsMap.get(jobName) || 0) + test.flakyCount,
        );
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
          existing.dailyCounts.set(
            runDate,
            (existing.dailyCounts.get(runDate) || 0) + 1,
          );
        } else {
          failedTestsMap.set(key, {
            name: test.name,
            path: test.path,
            failureCount: 1,
            runIds: [runId],
            dailyCounts: new Map([[runDate, 1]]),
          });
        }
      }

      if (test.subTests) {
        test.subTests.forEach((subTest) =>
          processTest(subTest, runId, jobName)
        );
      }
    }

    // Track job performance metrics
    const jobPerformanceMap = new Map<
      string,
      {
        totalDuration: number;
        minDuration: number;
        maxDuration: number;
        count: number;
      }
    >();

    // Track step performance metrics
    const stepPerformanceMap = new Map<
      string,
      {
        totalDuration: number;
        minDuration: number;
        maxDuration: number;
        count: number;
      }
    >();

    // Track daily statistics for the chart
    const dailyStatsMap = new Map<
      string,
      {
        date: string;
        failureCount: number;
        flakyCount: number;
        runCount: number;
      }
    >();

    allResults.forEach(({ runId, run, results, jobs }) => {
      // Aggregate daily stats
      const dateKey = run.created_at.split("T")[0];
      let dayStats = dailyStatsMap.get(dateKey);
      if (!dayStats) {
        dayStats = {
          date: dateKey,
          failureCount: 0,
          flakyCount: 0,
          runCount: 0,
        };
        dailyStatsMap.set(dateKey, dayStats);
      }
      dayStats.runCount++;

      // Count failures and flakes for this run
      const countTestStats = (tests: RecordedTestResult[]) => {
        tests.forEach((test) => {
          if (test.failed) dayStats!.failureCount++;
          if (test.flakyCount && test.flakyCount > 0) {
            dayStats!.flakyCount += test.flakyCount;
          }
          if (test.subTests) countTestStats(test.subTests);
        });
      };

      results.forEach((jobResult) => {
        jobResult.tests.forEach((test) =>
          processTest(test, runId, jobResult.name)
        );
        countTestStats(jobResult.tests);
      });

      // Process job timing data
      jobs.forEach((job) => {
        if (job.started_at && job.completed_at) {
          const duration = new Date(job.completed_at).getTime() -
            new Date(job.started_at).getTime();
          const durationInSeconds = duration / 1000;

          const existing = jobPerformanceMap.get(job.name);
          if (existing) {
            existing.totalDuration += durationInSeconds;
            existing.minDuration = Math.min(
              existing.minDuration,
              durationInSeconds,
            );
            existing.maxDuration = Math.max(
              existing.maxDuration,
              durationInSeconds,
            );
            existing.count++;
          } else {
            jobPerformanceMap.set(job.name, {
              totalDuration: durationInSeconds,
              minDuration: durationInSeconds,
              maxDuration: durationInSeconds,
              count: 1,
            });
          }
        }

        // Process step timing data (only for "build" jobs)
        if (job.steps && job.name.startsWith("test")) {
          job.steps.forEach((step) => {
            if (step.started_at && step.completed_at) {
              const duration = new Date(step.completed_at).getTime() -
                new Date(step.started_at).getTime();
              const durationInSeconds = duration / 1000;

              // Skip steps that run fast
              if (durationInSeconds < 6) {
                return;
              }

              const existing = stepPerformanceMap.get(step.name);
              if (existing) {
                existing.totalDuration += durationInSeconds;
                existing.minDuration = Math.min(
                  existing.minDuration,
                  durationInSeconds,
                );
                existing.maxDuration = Math.max(
                  existing.maxDuration,
                  durationInSeconds,
                );
                existing.count++;
              } else {
                stepPerformanceMap.set(step.name, {
                  totalDuration: durationInSeconds,
                  minDuration: durationInSeconds,
                  maxDuration: durationInSeconds,
                  count: 1,
                });
              }
            }
          });
        }
      });
    });

    // Convert to array and sort by total flaky counts
    const flakyTests = Array.from(flakyTestsMap.values()).map((test) => ({
      ...test,
      jobCounts: Array.from(test.jobCounts.entries()).map(([name, count]) => ({
        name,
        count,
      })),
      dailyCounts: Array.from(test.dailyCounts.entries()).map((
        [date, count],
      ) => ({
        date,
        count,
      })),
    })).sort(
      (a, b) => b.totalFlakyCounts - a.totalFlakyCounts,
    );

    // Convert to array and sort by failure count
    const failedTests = Array.from(failedTestsMap.values()).map((test) => ({
      ...test,
      dailyCounts: Array.from(test.dailyCounts.entries()).map((
        [date, count],
      ) => ({
        date,
        count,
      })),
    })).sort(
      (a, b) => b.failureCount - a.failureCount,
    );

    // Convert job flaky counts to array and sort
    const flakyJobs = Array.from(jobFlakyCountsMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Convert job performance to array and sort by average duration
    const jobPerformance = Array.from(jobPerformanceMap.entries())
      .map(([name, data]) => ({
        name,
        avgDuration: data.totalDuration / data.count,
        minDuration: data.minDuration,
        maxDuration: data.maxDuration,
        count: data.count,
      }))
      .sort((a, b) => b.avgDuration - a.avgDuration);

    // Convert step performance to array and sort by average duration
    const stepPerformance = Array.from(stepPerformanceMap.entries())
      .map(([name, data]) => ({
        name,
        avgDuration: data.totalDuration / data.count,
        minDuration: data.minDuration,
        maxDuration: data.maxDuration,
        count: data.count,
      }))
      .sort((a, b) => b.avgDuration - a.avgDuration);

    // Get the date range from oldest run to today
    const allDates = Array.from(runIdToDate.values()).sort();
    const oldestDate = allDates[0];
    const today = new Date().toISOString().split("T")[0];

    // Generate all dates from oldest to today
    const dateRange: string[] = [];
    if (oldestDate) {
      const current = new Date(oldestDate + "T00:00:00");
      const end = new Date(today + "T00:00:00");
      while (current <= end) {
        dateRange.push(current.toISOString().split("T")[0]);
        current.setDate(current.getDate() + 1);
      }
    }

    return {
      data: {
        flakyTests,
        failedTests,
        flakyJobs,
        jobPerformance,
        stepPerformance,
        dateRange,
        totalRunsAnalyzed: mainBranchRuns.length,
        oldestRun: mainBranchRuns[mainBranchRuns.length - 1],
        newestRun: mainBranchRuns[0],
      },
    };
  }
}

export default define.page<typeof handler>(function InsightsPage({ data }) {
  const {
    flakyTests,
    failedTests,
    flakyJobs,
    jobPerformance,
    stepPerformance,
    dateRange,
    totalRunsAnalyzed,
    oldestRun,
    newestRun,
  } = data;

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
                      <TestTimeline
                        dateRange={dateRange}
                        dailyCounts={test.dailyCounts}
                        color="red"
                      />
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

      <div class="bg-white rounded-lg shadow mb-6">
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
                            {test.runIds.length}
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
                      {test.jobCounts.length > 0 && (
                        <div class="mt-2 text-xs text-gray-600">
                          <span class="font-semibold">Jobs:</span>{" "}
                          {test.jobCounts
                            .sort((a, b) => b.count - a.count)
                            .map((job, i) => (
                              <span key={i}>
                                {i > 0 && ", "}
                                {job.name} ({job.count})
                              </span>
                            ))}
                        </div>
                      )}
                      <TestTimeline
                        dateRange={dateRange}
                        dailyCounts={test.dailyCounts}
                        color="yellow"
                      />
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

      <div class="bg-white rounded-lg shadow mb-6">
        <div class="bg-purple-100 px-4 py-3 rounded-t-lg border-b border-purple-300">
          <div class="flex items-center justify-between">
            <h2 class="font-semibold text-xl">
              🔧 Most Flaky Jobs ({flakyJobs.length})
            </h2>
          </div>
        </div>
        {flakyJobs.length === 0
          ? (
            <div class="p-8 text-center">
              <div class="text-6xl mb-4">🎉</div>
              <h3 class="text-xl font-bold mb-2">No Flaky Jobs!</h3>
              <p class="text-gray-600">
                No jobs had flaky tests across the analyzed runs.
              </p>
            </div>
          )
          : (
            <div class="divide-y divide-gray-200">
              {flakyJobs.map((job, idx) => (
                <div
                  key={idx}
                  class="px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div class="flex items-center justify-between gap-4">
                    <div class="flex-1 min-w-0">
                      <div class="font-mono text-sm font-semibold text-gray-900">
                        {job.name}
                      </div>
                    </div>
                    <div class="flex-shrink-0">
                      <div class="bg-purple-100 text-purple-800 px-3 py-2 rounded text-center">
                        <div class="text-2xl font-bold">
                          {job.count}
                        </div>
                        <div class="text-xs">flaky tests</div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>

      <div class="bg-white rounded-lg shadow mb-6">
        <div class="bg-blue-100 px-4 py-3 rounded-t-lg border-b border-blue-300">
          <div class="flex items-center justify-between">
            <h2 class="font-semibold text-xl">
              ⏱️ Slowest Jobs by Average Duration ({jobPerformance.length})
            </h2>
          </div>
        </div>
        {jobPerformance.length === 0
          ? (
            <div class="p-8 text-center">
              <div class="text-6xl mb-4">⏱️</div>
              <h3 class="text-xl font-bold mb-2">No Job Data Available</h3>
              <p class="text-gray-600">
                No job timing information found for the analyzed runs.
              </p>
            </div>
          )
          : (
            <div class="divide-y divide-gray-200">
              {jobPerformance.map((job, idx) => (
                <div
                  key={idx}
                  class="px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div class="flex items-start justify-between gap-4">
                    <div class="flex-1 min-w-0">
                      <div class="font-mono text-sm font-semibold text-gray-900 mb-1">
                        {job.name}
                      </div>
                      <div class="flex items-center gap-4 text-xs text-gray-600">
                        <span>
                          Avg:{" "}
                          <span class="font-semibold">
                            {formatDuration(job.avgDuration * 1000)}
                          </span>
                        </span>
                        <span>
                          Min:{" "}
                          <span class="font-semibold">
                            {formatDuration(job.minDuration * 1000)}
                          </span>
                        </span>
                        <span>
                          Max:{" "}
                          <span class="font-semibold">
                            {formatDuration(job.maxDuration * 1000)}
                          </span>
                        </span>
                        <span>
                          Runs: <span class="font-semibold">{job.count}</span>
                        </span>
                      </div>
                    </div>
                    <div class="flex-shrink-0">
                      <div class="bg-blue-100 text-blue-800 px-3 py-2 rounded text-center">
                        <div class="text-2xl font-bold">
                          {formatDuration(job.avgDuration * 1000)}
                        </div>
                        <div class="text-xs">avg duration</div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>

      <div class="bg-white rounded-lg shadow">
        <div class="bg-green-100 px-4 py-3 rounded-t-lg border-b border-green-300">
          <div class="flex items-center justify-between">
            <h2 class="font-semibold text-xl">
              🔍 Slowest Steps by Average Duration ({stepPerformance.length})
            </h2>
          </div>
        </div>
        {stepPerformance.length === 0
          ? (
            <div class="p-8 text-center">
              <div class="text-6xl mb-4">🔍</div>
              <h3 class="text-xl font-bold mb-2">No Step Data Available</h3>
              <p class="text-gray-600">
                No step timing information found for the analyzed runs.
              </p>
            </div>
          )
          : (
            <div class="divide-y divide-gray-200">
              {stepPerformance.map((step, idx) => (
                <div
                  key={idx}
                  class="px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div class="flex items-start justify-between gap-4">
                    <div class="flex-1 min-w-0">
                      <div class="font-mono text-sm font-semibold text-gray-900 mb-1">
                        {step.name}
                      </div>
                      <div class="flex items-center gap-4 text-xs text-gray-600">
                        <span>
                          Avg:{" "}
                          <span class="font-semibold">
                            {formatDuration(step.avgDuration * 1000)}
                          </span>
                        </span>
                        <span>
                          Min:{" "}
                          <span class="font-semibold">
                            {formatDuration(step.minDuration * 1000)}
                          </span>
                        </span>
                        <span>
                          Max:{" "}
                          <span class="font-semibold">
                            {formatDuration(step.maxDuration * 1000)}
                          </span>
                        </span>
                        <span>
                          Runs: <span class="font-semibold">{step.count}</span>
                        </span>
                      </div>
                    </div>
                    <div class="flex-shrink-0">
                      <div class="bg-green-100 text-green-800 px-3 py-2 rounded text-center">
                        <div class="text-2xl font-bold">
                          {formatDuration(step.avgDuration * 1000)}
                        </div>
                        <div class="text-xs">avg duration</div>
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
