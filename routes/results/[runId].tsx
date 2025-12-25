import { define } from "@/define.ts";
import type {
  JobTestResults,
  RecordedTestResult,
  TestResultsDownloader,
} from "@/lib/test-results-downloader.ts";
import type { GitHubApiClient } from "@/lib/github-api-client.ts";
import { formatDuration } from "@/lib/render.tsx";

export const handler = define.handlers({
  GET(ctx) {
    const runId = parseInt(ctx.params.runId, 10);
    return ctx.state.store.get("controller.runPage").getForRun(runId);
  },
});

export class RunPageController {
  #githubClient: Pick<GitHubApiClient, "getWorkflowRun" | "listJobs">;
  #downloader: TestResultsDownloader;

  constructor(
    githubClient: Pick<GitHubApiClient, "getWorkflowRun" | "listJobs">,
    downloader: TestResultsDownloader,
  ) {
    this.#githubClient = githubClient;
    this.#downloader = downloader;
  }

  async getForRun(runId: number) {
    if (isNaN(runId)) {
      return new Response("Invalid run ID", { status: 400 });
    }

    const run = await this.#githubClient.getWorkflowRun(runId);
    if (run == null) {
      return new Response(null, {
        status: 404,
      });
    }

    const [results, jobs] = await Promise.all([
      this.#downloader.downloadForRunId(runId),
      this.#githubClient.listJobs(runId),
    ]);

    return { data: { runId, run, results, jobs } };
  }
}

function TestResultItem(
  { test, depth = 0 }: { test: RecordedTestResult; depth?: number },
) {
  const statusColor = test.failed
    ? "text-red-600"
    : test.ignored
    ? "text-gray-500"
    : "text-green-600";

  const statusText = test.failed ? "✗" : test.ignored ? "○" : "✓";

  const paddingLeft = depth * 20;

  return (
    <div>
      <div
        class="py-2 px-4 border-b border-gray-200 hover:bg-gray-50"
        style={{ paddingLeft: `${paddingLeft + 16}px` }}
      >
        <div class="flex items-center gap-3">
          <span class={`font-bold ${statusColor}`}>{statusText}</span>
          <span class="flex-1 font-mono text-sm">{test.name}</span>
          {test.flakyCount && test.flakyCount > 0 && (
            <span class="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
              Flaky ({test.flakyCount})
            </span>
          )}
          {test.duration && (
            <span class="text-xs text-gray-600">
              {formatDuration(test.duration)}
            </span>
          )}
        </div>
        {test.path && depth === 0 && (
          <div class="text-xs text-gray-500 mt-1 ml-8">{test.path}</div>
        )}
      </div>
      {test.subTests &&
        test.subTests.map((subTest) => (
          <TestResultItem test={subTest} depth={depth + 1} />
        ))}
    </div>
  );
}

function JobSection({ job }: { job: JobStats }) {
  const hasContent = job.failed.length > 0 || job.flaky.length > 0 ||
    job.longest.length > 0;

  if (!hasContent) return null;

  return (
    <div class="bg-white rounded-lg shadow-md mb-6">
      <div class="bg-blue-100 px-4 py-3 rounded-t-lg border-b border-blue-300">
        <div class="flex items-center justify-between">
          <h2 class="font-semibold text-xl">{job.jobName}</h2>
          <div class="text-sm text-blue-900">
            <span class="font-semibold">
              {formatDuration(job.totalDuration)}
            </span>
          </div>
        </div>
      </div>

      {job.failed.length > 0 && (
        <div class="border-b border-gray-200">
          <div class="bg-red-50 px-4 py-2 border-b border-red-200">
            <h3 class="font-semibold text-red-900">
              ❌ Failed Tests ({job.failed.length})
            </h3>
          </div>
          <div>
            {job.failed.map((test, idx) => (
              <TestResultItem test={test} key={idx} />
            ))}
          </div>
        </div>
      )}

      {job.flaky.length > 0 && (
        <div class="border-b border-gray-200">
          <div class="bg-yellow-50 px-4 py-2 border-b border-yellow-200">
            <h3 class="font-semibold text-yellow-900">
              ⚠️ Flaky Tests ({job.flaky.length})
            </h3>
          </div>
          <div>
            {job.flaky.map((test, idx) => (
              <TestResultItem test={test} key={idx} />
            ))}
          </div>
        </div>
      )}

      {job.longest.length > 0 && (
        <div>
          <div class="bg-blue-50 px-4 py-2 border-b border-blue-200">
            <h3 class="font-semibold text-blue-900">
              ⏱️ Top 10 Longest Tests
            </h3>
          </div>
          <div>
            {job.longest.map((test, idx) => (
              <TestResultItem test={test} key={idx} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default define.page<typeof handler>(function TestResultsPage({ data }) {
  const { runId, run, results, jobs } = data;
  const { stats, jobStats, topAveragedTests } = processTestResults(results);
  const stepPerformance = processStepPerformance(jobs);

  return (
    <div class="container mx-auto px-4 py-8 max-w-7xl">
      <div class="mb-8">
        <h1 class="text-3xl font-bold mb-2">Test Results for Run #{runId}</h1>
        <div class="text-gray-600 mb-2">
          Branch: <span class="font-semibold">{run.head_branch}</span>
        </div>
        <a
          href="/"
          class="text-blue-600 hover:text-blue-800 text-sm"
        >
          ← Back to runs list
        </a>
      </div>

      {run.status !== "completed" && (
        <div class="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-8">
          <div class="flex items-center">
            <div class="flex-shrink-0">
              <span class="text-2xl">⚠️</span>
            </div>
            <div class="ml-3">
              <p class="text-sm text-yellow-800">
                <span class="font-semibold">Warning:</span>{" "}
                This workflow run hasn't completed yet (Status:{" "}
                {run.status}). Test results may be incomplete.
              </p>
            </div>
          </div>
        </div>
      )}

      <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <div class="bg-white rounded-lg shadow p-4">
          <div class="text-gray-600 text-sm mb-1">Total Tests</div>
          <div class="text-2xl font-bold">{stats.total}</div>
        </div>

        <div class="bg-white rounded-lg shadow p-4">
          <div class="text-gray-600 text-sm mb-1">Passed</div>
          <div class="text-2xl font-bold text-green-600">{stats.passed}</div>
        </div>

        <div class="bg-white rounded-lg shadow p-4">
          <div class="text-gray-600 text-sm mb-1">Failed</div>
          <div class="text-2xl font-bold text-red-600">{stats.failed}</div>
        </div>

        <div class="bg-white rounded-lg shadow p-4">
          <div class="text-gray-600 text-sm mb-1">Ignored</div>
          <div class="text-2xl font-bold text-gray-500">{stats.ignored}</div>
        </div>

        <div class="bg-white rounded-lg shadow p-4">
          <div class="text-gray-600 text-sm mb-1">Flaky</div>
          <div class="text-2xl font-bold text-yellow-600">{stats.flaky}</div>
        </div>
      </div>

      <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8">
        <div class="flex items-center justify-between">
          <span class="text-gray-700">Total Duration</span>
          <span class="font-semibold text-lg">
            {formatDuration(stats.totalDuration)}
          </span>
        </div>
      </div>

      <div>
        {topAveragedTests.length > 0 && (
          <div class="bg-white rounded-lg shadow-md mb-6">
            <div class="bg-purple-100 px-4 py-3 rounded-t-lg border-b border-purple-300">
              <h2 class="font-semibold text-xl">
                📊 Top 15 Slowest Tests (Averaged Across Jobs)
              </h2>
              <p class="text-sm text-purple-900 mt-1">
                Tests that consistently take the longest time across multiple
                jobs
              </p>
            </div>
            <div>
              {topAveragedTests.map((test, idx) => (
                <div key={idx}>
                  <div class="py-2 px-4 border-b border-gray-200 hover:bg-gray-50">
                    <div class="flex items-center gap-3">
                      <span class="font-mono text-sm flex-1">{test.name}</span>
                      <span
                        class="text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded cursor-help"
                        title={`This test is on average ${
                          test.normalizedScore.toFixed(1)
                        }x slower than the median test in its job.`}
                      >
                        {test.normalizedScore.toFixed(1)}x slower
                      </span>
                      <span class="text-xs text-gray-600 font-semibold">
                        {formatDuration(test.avgDuration)}
                      </span>
                    </div>
                    {test.path && (
                      <div class="text-xs text-gray-500 mt-1 ml-0">
                        {test.path}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {jobStats.map((job) => <JobSection job={job} key={job.jobName} />)}

        {stepPerformance.length > 0 && (
          <div class="bg-white rounded-lg shadow-md">
            <div class="bg-green-100 px-4 py-3 rounded-t-lg border-b border-green-300">
              <h2 class="font-semibold text-xl">
                🔍 Slowest Steps by Average Duration ({stepPerformance.length})
              </h2>
              <p class="text-sm text-green-900 mt-1">
                Workflow steps taking 6+ seconds, averaged across jobs
              </p>
            </div>
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
                          Jobs: <span class="font-semibold">{step.count}</span>
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
          </div>
        )}
      </div>
    </div>
  );
});

interface NormalizedTest {
  name: string;
  path: string;
  normalizedScore: number;
  avgDuration: number;
  jobCount: number;
}

interface ProcessedPageData {
  stats: TestStats;
  jobStats: JobStats[];
  topAveragedTests: NormalizedTest[];
}

interface StepPerformance {
  name: string;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  count: number;
}

export function processStepPerformance(
  jobs: import("@/lib/github-api-client.ts").WorkflowJob[],
): StepPerformance[] {
  const stepPerformanceMap = new Map<
    string,
    {
      totalDuration: number;
      minDuration: number;
      maxDuration: number;
      count: number;
    }
  >();

  jobs.forEach((job) => {
    // Only process steps from "test" jobs
    if (job.steps && job.name.startsWith("test")) {
      job.steps.forEach((step) => {
        if (step.started_at && step.completed_at) {
          const duration = new Date(step.completed_at).getTime() -
            new Date(step.started_at).getTime();
          const durationInSeconds = duration / 1000;

          // Skip steps that take less than 6 seconds
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

  // Convert to array and sort by average duration descending
  return Array.from(stepPerformanceMap.entries())
    .map(([name, data]) => ({
      name,
      avgDuration: data.totalDuration / data.count,
      minDuration: data.minDuration,
      maxDuration: data.maxDuration,
      count: data.count,
    }))
    .sort((a, b) => b.avgDuration - a.avgDuration);
}

export function processTestResults(
  results: JobTestResults[],
): ProcessedPageData {
  const stats = calculateStats(results);
  const jobStats = results.map(getJobStats).sort((a, b) =>
    a.jobName.localeCompare(b.jobName)
  );

  // Calculate normalized slowest tests across all jobs
  // Normalize each test's duration relative to its job's median duration
  const testNormalizedScores = new Map<
    string,
    { scores: number[]; durations: number[]; path: string }
  >();

  results.forEach((jobResult) => {
    // Flatten all tests in this job to get all durations
    const allTests = flattenTestsInJob(jobResult.tests);
    const allDurations = allTests
      .map((t) => t.duration || 0)
      .filter((d) => d > 0)
      .sort((a, b) => a - b);

    const median = allDurations.length > 0
      ? allDurations[Math.floor(allDurations.length / 2)]
      : 1;

    // Process all tests from this job
    allTests.forEach((test) => {
      if (!test.duration || test.duration === 0) return;

      // Skip unit tests
      if (isUnitTest(test)) {
        return;
      }

      if (!testNormalizedScores.has(test.name)) {
        testNormalizedScores.set(test.name, {
          scores: [],
          durations: [],
          path: test.path,
        });
      }
      const data = testNormalizedScores.get(test.name)!;
      // Normalize: how many times slower than the median test in this job?
      const normalizedScore = (test.duration || 0) / median;
      data.scores.push(normalizedScore);
      data.durations.push(test.duration || 0);
    });
  });

  // Calculate average normalized score for each test
  const normalizedTests: NormalizedTest[] = Array.from(
    testNormalizedScores.entries(),
  ).map(
    ([name, data]) => {
      const avgScore = data.scores.reduce((a, b) => a + b, 0) /
        data.scores.length;
      const avgDuration = data.durations.reduce((a, b) => a + b, 0) /
        data.durations.length;

      return {
        name,
        path: data.path,
        normalizedScore: avgScore,
        avgDuration,
        jobCount: data.scores.length,
      };
    },
  );

  // Sort by normalized score (tests that are consistently slow relative to their job)
  const topAveragedTests = normalizedTests
    .sort((a, b) => b.normalizedScore - a.normalizedScore)
    .slice(0, 15);

  return { stats, jobStats, topAveragedTests };
}

interface JobStats {
  jobName: string;
  failed: RecordedTestResult[];
  flaky: RecordedTestResult[];
  longest: RecordedTestResult[];
  totalDuration: number;
}

function flattenTestsInJob(tests: RecordedTestResult[]): RecordedTestResult[] {
  const flattened: RecordedTestResult[] = [];

  function flatten(test: RecordedTestResult) {
    flattened.push(test);
    if (test.subTests) {
      test.subTests.forEach(flatten);
    }
  }

  tests.forEach(flatten);
  return flattened;
}

function getJobStats(job: JobTestResults): JobStats {
  const allTests = flattenTestsInJob(job.tests);

  const failed = allTests.filter((test) => test.failed);
  const flaky = allTests.filter(
    (test) => test.flakyCount && test.flakyCount > 0,
  );

  // Get top 10 longest tests (only root level tests)
  const longest = job.tests
    .filter((test) => test.duration != null && !isUnitTest(test))
    .sort((a, b) => (b.duration || 0) - (a.duration || 0))
    .slice(0, 10);

  // Calculate total duration
  const totalDuration = allTests.reduce(
    (sum, test) => sum + (test.duration || 0),
    0,
  );

  return {
    jobName: job.name,
    failed,
    flaky,
    longest,
    totalDuration,
  };
}

interface TestStats {
  total: number;
  passed: number;
  failed: number;
  ignored: number;
  flaky: number;
  totalDuration: number;
}

function calculateStats(results: JobTestResults[]): TestStats {
  const stats: TestStats = {
    total: 0,
    passed: 0,
    failed: 0,
    ignored: 0,
    flaky: 0,
    totalDuration: 0,
  };

  function processTest(test: RecordedTestResult) {
    stats.total++;

    if (test.failed) {
      stats.failed++;
    } else if (test.ignored) {
      stats.ignored++;
    } else {
      stats.passed++;
    }

    if (test.flakyCount && test.flakyCount > 0) {
      stats.flaky++;
    }

    if (test.duration) {
      stats.totalDuration += test.duration;
    }

    if (test.subTests) {
      test.subTests.forEach(processTest);
    }
  }

  results.forEach((result) => {
    result.tests.forEach(processTest);
  });

  return stats;
}

function isUnitTest(test: RecordedTestResult) {
  return test.name.startsWith("unit::") || test.name.startsWith("unit_node::");
}
