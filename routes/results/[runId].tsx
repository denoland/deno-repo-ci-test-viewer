import { define } from "../../utils.ts";
import type {
  JobTestResults,
  RecordedTestResult,
} from "../../lib/test-results-downloader.ts";
import type { WorkflowRun } from "../../lib/github-api-client.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const runId = parseInt(ctx.params.runId);

    if (isNaN(runId)) {
      return new Response("Invalid run ID", { status: 400 });
    }

    const githubClient = await ctx.state.store.get("githubClient");
    const run: WorkflowRun = await githubClient.getWorkflowRun(runId);

    // Only download artifacts if the run is completed
    let results: JobTestResults[] = [];
    if (run.status === "completed") {
      const downloader = await ctx.state.store.get("downloader");
      results = await downloader.downloadForRunId(runId);
    }

    return { data: { runId, run, results } };
  },
});

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

function formatDuration(ms: number): string {
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

function TestSuite({ suite }: { suite: JobTestResults }) {
  return (
    <div class="bg-white rounded-lg shadow-md mb-6">
      <div class="bg-gray-100 px-4 py-3 rounded-t-lg border-b border-gray-300">
        <h3 class="font-semibold text-lg">{suite.name}</h3>
      </div>
      <div>
        {suite.tests.map((test) => (
          <TestResultItem test={test} key={test.name} />
        ))}
      </div>
    </div>
  );
}

export default define.page<typeof handler>(function TestResultsPage({ data }) {
  const { runId, run, results } = data;

  if (run.status !== "completed") {
    return (
      <div class="container mx-auto px-4 py-8 max-w-7xl">
        <div class="mb-8">
          <h1 class="text-3xl font-bold mb-2">Test Results for Run #{runId}</h1>
          <a
            href="/"
            class="text-blue-600 hover:text-blue-800 text-sm"
          >
            ← Back to runs list
          </a>
        </div>

        <div class="bg-blue-50 border border-blue-200 rounded-lg p-8 text-center">
          <div class="text-6xl mb-4">⏳</div>
          <h2 class="text-2xl font-bold mb-2">CI Run Pending</h2>
          <p class="text-gray-700 mb-4">
            This workflow run is still in progress. Test results will be
            available once the run completes.
          </p>
          <div class="text-sm text-gray-600">
            Status: <span class="font-semibold">{run.status}</span>
          </div>
          <div class="mt-6">
            <a
              href={`/results/${runId}`}
              class="inline-block px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              Refresh Page
            </a>
          </div>
        </div>
      </div>
    );
  }

  const stats = calculateStats(results);

  return (
    <div class="container mx-auto px-4 py-8 max-w-7xl">
      <div class="mb-8">
        <h1 class="text-3xl font-bold mb-2">Test Results for Run #{runId}</h1>
        <a
          href="/"
          class="text-blue-600 hover:text-blue-800 text-sm"
        >
          ← Back to runs list
        </a>
      </div>

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
        {results.map((suite) => <TestSuite suite={suite} key={suite.name} />)}
      </div>
    </div>
  );
});
