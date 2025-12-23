import { assertEquals } from "@std/assert";
import { InsightsPageController } from "./insights.tsx";
import type { GitHubApiClient, WorkflowRun } from "@/lib/github-api-client.ts";
import type {
  JobTestResults,
  TestResultsDownloader,
} from "@/lib/test-results-downloader.ts";
import { NullLogger } from "@/lib/logger.ts";

interface RunsWithCount {
  totalCount: number;
  runs: WorkflowRun[];
}

class MockGitHubApiClient implements Pick<GitHubApiClient, "listWorkflowRuns"> {
  #runs: RunsWithCount = { totalCount: 0, runs: [] };

  mockRuns(runs: RunsWithCount) {
    this.#runs = runs;
  }

  listWorkflowRuns(
    _perPage?: number,
    _page?: number,
  ) {
    return Promise.resolve(this.#runs);
  }
}

class MockTestResultsDownloader implements TestResultsDownloader {
  #results: Map<number, JobTestResults[]> = new Map();

  mockResults(runId: number, results: JobTestResults[]) {
    this.#results.set(runId, results);
  }

  downloadForRunId(runId: number): Promise<JobTestResults[]> {
    const results = this.#results.get(runId);
    if (!results) {
      return Promise.reject(new Error(`No results for run ${runId}`));
    }
    return Promise.resolve(results);
  }
}

function createMockRun(
  id: number,
  name: string,
  status: string,
  branch: string,
): WorkflowRun {
  return {
    id,
    name,
    display_title: `Run ${id}`,
    status,
    conclusion: "success",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    run_number: id,
    event: "push",
    head_branch: branch,
    head_sha: `sha${id}`,
  };
}

Deno.test("filters main branch completed CI runs", async () => {
  const mockGithub = new MockGitHubApiClient();
  const mockDownloader = new MockTestResultsDownloader();

  const runs = [
    createMockRun(1, "CI", "completed", "main"),
    createMockRun(2, "Build", "completed", "main"), // Wrong name
    createMockRun(3, "CI", "in_progress", "main"), // Not completed
    createMockRun(4, "CI", "completed", "feature"), // Wrong branch
    createMockRun(5, "CI", "completed", "main"),
  ];

  mockGithub.mockRuns({ totalCount: 5, runs });
  mockDownloader.mockResults(1, []);
  mockDownloader.mockResults(5, []);

  const controller = new InsightsPageController(
    new NullLogger(),
    mockGithub,
    mockDownloader,
  );
  const result = await controller.get();

  assertEquals(result.data.totalRunsAnalyzed, 2);
  assertEquals(result.data.newestRun?.id, 1);
  assertEquals(result.data.oldestRun?.id, 5);
});

Deno.test("limits to 20 main branch runs", async () => {
  const mockGithub = new MockGitHubApiClient();
  const mockDownloader = new MockTestResultsDownloader();

  // Create 30 main branch CI runs
  const runs = Array.from(
    { length: 30 },
    (_, i) => createMockRun(i + 1, "CI", "completed", "main"),
  );

  mockGithub.mockRuns({ totalCount: 30, runs });

  // Mock results for first 20 runs only
  for (let i = 1; i <= 20; i++) {
    mockDownloader.mockResults(i, []);
  }

  const controller = new InsightsPageController(
    new NullLogger(),
    mockGithub,
    mockDownloader,
  );
  const result = await controller.get();

  assertEquals(result.data.totalRunsAnalyzed, 20);
});

Deno.test("tracks flaky tests", async () => {
  const mockGithub = new MockGitHubApiClient();
  const mockDownloader = new MockTestResultsDownloader();

  const runs = [
    createMockRun(1, "CI", "completed", "main"),
    createMockRun(2, "CI", "completed", "main"),
  ];

  mockGithub.mockRuns({ totalCount: 2, runs });

  mockDownloader.mockResults(1, [
    {
      name: "test-job",
      tests: [
        {
          name: "test1",
          path: "file1.test.ts",
          flakyCount: 3,
          subTests: [],
        },
      ],
    },
  ]);

  mockDownloader.mockResults(2, [
    {
      name: "test-job",
      tests: [
        {
          name: "test1",
          path: "file1.test.ts",
          flakyCount: 2,
          subTests: [],
        },
      ],
    },
  ]);

  const controller = new InsightsPageController(
    new NullLogger(),
    mockGithub,
    mockDownloader,
  );
  const result = await controller.get();

  assertEquals(result.data.flakyTests.length, 1);
  assertEquals(result.data.flakyTests[0].name, "test1");
  assertEquals(result.data.flakyTests[0].path, "file1.test.ts");
  assertEquals(result.data.flakyTests[0].totalFlakyCounts, 5);
  assertEquals(result.data.flakyTests[0].occurrences, 2);
  assertEquals(result.data.flakyTests[0].avgFlakyCount, 2.5);
  assertEquals(result.data.flakyTests[0].runIds, [1, 2]);
});

Deno.test("tracks failed tests", async () => {
  const mockGithub = new MockGitHubApiClient();
  const mockDownloader = new MockTestResultsDownloader();

  const runs = [
    createMockRun(1, "CI", "completed", "main"),
    createMockRun(2, "CI", "completed", "main"),
  ];

  mockGithub.mockRuns({ totalCount: 2, runs });

  mockDownloader.mockResults(1, [
    {
      name: "test-job",
      tests: [
        {
          name: "failing-test",
          path: "file1.test.ts",
          failed: true,
          subTests: [],
        },
      ],
    },
  ]);

  mockDownloader.mockResults(2, [
    {
      name: "test-job",
      tests: [
        {
          name: "failing-test",
          path: "file1.test.ts",
          failed: true,
          subTests: [],
        },
      ],
    },
  ]);

  const controller = new InsightsPageController(
    new NullLogger(),
    mockGithub,
    mockDownloader,
  );
  const result = await controller.get();

  assertEquals(result.data.failedTests.length, 1);
  assertEquals(result.data.failedTests[0].name, "failing-test");
  assertEquals(result.data.failedTests[0].path, "file1.test.ts");
  assertEquals(result.data.failedTests[0].failureCount, 2);
  assertEquals(result.data.failedTests[0].runIds, [1, 2]);
});

Deno.test("processes nested subtests", async () => {
  const mockGithub = new MockGitHubApiClient();
  const mockDownloader = new MockTestResultsDownloader();

  const runs = [createMockRun(1, "CI", "completed", "main")];

  mockGithub.mockRuns({ totalCount: 1, runs });

  mockDownloader.mockResults(1, [
    {
      name: "test-job",
      tests: [
        {
          name: "parent-test",
          path: "file1.test.ts",
          subTests: [
            {
              name: "child-test",
              path: "file1.test.ts",
              failed: true,
              subTests: [],
            },
          ],
        },
      ],
    },
  ]);

  const controller = new InsightsPageController(
    new NullLogger(),
    mockGithub,
    mockDownloader,
  );
  const result = await controller.get();

  assertEquals(result.data.failedTests.length, 1);
  assertEquals(result.data.failedTests[0].name, "child-test");
  assertEquals(result.data.failedTests[0].failureCount, 1);
});

Deno.test("sorts flaky tests by total count", async () => {
  const mockGithub = new MockGitHubApiClient();
  const mockDownloader = new MockTestResultsDownloader();

  const runs = [createMockRun(1, "CI", "completed", "main")];

  mockGithub.mockRuns({ totalCount: 1, runs });

  mockDownloader.mockResults(1, [
    {
      name: "test-job",
      tests: [
        {
          name: "test1",
          path: "file1.test.ts",
          flakyCount: 2,
          subTests: [],
        },
        {
          name: "test2",
          path: "file2.test.ts",
          flakyCount: 5,
          subTests: [],
        },
        {
          name: "test3",
          path: "file3.test.ts",
          flakyCount: 3,
          subTests: [],
        },
      ],
    },
  ]);

  const controller = new InsightsPageController(
    new NullLogger(),
    mockGithub,
    mockDownloader,
  );
  const result = await controller.get();

  assertEquals(result.data.flakyTests.length, 3);
  assertEquals(result.data.flakyTests[0].name, "test2");
  assertEquals(result.data.flakyTests[0].totalFlakyCounts, 5);
  assertEquals(result.data.flakyTests[1].name, "test3");
  assertEquals(result.data.flakyTests[1].totalFlakyCounts, 3);
  assertEquals(result.data.flakyTests[2].name, "test1");
  assertEquals(result.data.flakyTests[2].totalFlakyCounts, 2);
});

Deno.test("sorts failed tests by failure count", async () => {
  const mockGithub = new MockGitHubApiClient();
  const mockDownloader = new MockTestResultsDownloader();

  const runs = [
    createMockRun(1, "CI", "completed", "main"),
    createMockRun(2, "CI", "completed", "main"),
  ];

  mockGithub.mockRuns({ totalCount: 2, runs });

  mockDownloader.mockResults(1, [
    {
      name: "test-job",
      tests: [
        {
          name: "test1",
          path: "file1.test.ts",
          failed: true,
          subTests: [],
        },
        {
          name: "test2",
          path: "file2.test.ts",
          failed: true,
          subTests: [],
        },
      ],
    },
  ]);

  mockDownloader.mockResults(2, [
    {
      name: "test-job",
      tests: [
        {
          name: "test1",
          path: "file1.test.ts",
          failed: true,
          subTests: [],
        },
        {
          name: "test2",
          path: "file2.test.ts",
          failed: true,
          subTests: [],
        },
        {
          name: "test2",
          path: "file2.test.ts",
          failed: true,
          subTests: [],
        },
      ],
    },
  ]);

  const controller = new InsightsPageController(
    new NullLogger(),
    mockGithub,
    mockDownloader,
  );
  const result = await controller.get();

  assertEquals(result.data.failedTests.length, 2);
  assertEquals(result.data.failedTests[0].name, "test2");
  assertEquals(result.data.failedTests[0].failureCount, 3);
  assertEquals(result.data.failedTests[1].name, "test1");
  assertEquals(result.data.failedTests[1].failureCount, 2);
});

Deno.test("handles download errors gracefully", async () => {
  const mockGithub = new MockGitHubApiClient();
  const mockDownloader = new MockTestResultsDownloader();

  const runs = [
    createMockRun(1, "CI", "completed", "main"),
    createMockRun(2, "CI", "completed", "main"),
  ];

  mockGithub.mockRuns({ totalCount: 2, runs });

  // Only mock results for run 2, run 1 will fail
  mockDownloader.mockResults(2, []);

  const controller = new InsightsPageController(
    new NullLogger(),
    mockGithub,
    mockDownloader,
  );
  const result = await controller.get();

  // Should still return results even though one download failed
  assertEquals(result.data.totalRunsAnalyzed, 2);
  assertEquals(result.data.flakyTests.length, 0);
  assertEquals(result.data.failedTests.length, 0);
});

Deno.test("returns empty lists when no issues found", async () => {
  const mockGithub = new MockGitHubApiClient();
  const mockDownloader = new MockTestResultsDownloader();

  const runs = [createMockRun(1, "CI", "completed", "main")];

  mockGithub.mockRuns({ totalCount: 1, runs });

  mockDownloader.mockResults(1, [
    {
      name: "test-job",
      tests: [
        {
          name: "passing-test",
          path: "file1.test.ts",
          subTests: [],
        },
      ],
    },
  ]);

  const controller = new InsightsPageController(
    new NullLogger(),
    mockGithub,
    mockDownloader,
  );
  const result = await controller.get();

  assertEquals(result.data.flakyTests.length, 0);
  assertEquals(result.data.failedTests.length, 0);
  assertEquals(result.data.totalRunsAnalyzed, 1);
});
