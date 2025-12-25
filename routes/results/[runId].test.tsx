import { assertEquals } from "@std/assert";
import { processStepPerformance, processTestResults } from "./[runId].tsx";
import type { JobTestResults } from "@/lib/test-results-downloader.ts";
import type { WorkflowJob } from "@/lib/github-api-client.ts";

Deno.test("processTestResults - calculates basic stats correctly", () => {
  const results: JobTestResults[] = [
    {
      name: "test-job",
      tests: [
        {
          name: "passing-test",
          path: "file1.test.ts",
          duration: 100,
          subTests: [],
        },
        {
          name: "failing-test",
          path: "file2.test.ts",
          failed: true,
          duration: 200,
          subTests: [],
        },
        {
          name: "ignored-test",
          path: "file3.test.ts",
          ignored: true,
          subTests: [],
        },
        {
          name: "flaky-test",
          path: "file4.test.ts",
          flakyCount: 2,
          duration: 150,
          subTests: [],
        },
      ],
    },
  ];

  const result = processTestResults(results);

  assertEquals(result.stats.total, 4);
  assertEquals(result.stats.passed, 2);
  assertEquals(result.stats.failed, 1);
  assertEquals(result.stats.ignored, 1);
  assertEquals(result.stats.flaky, 1);
  assertEquals(result.stats.totalDuration, 450);
});

Deno.test("processTestResults - processes nested subtests", () => {
  const results: JobTestResults[] = [
    {
      name: "test-job",
      tests: [
        {
          name: "parent-test",
          path: "file1.test.ts",
          duration: 100,
          subTests: [
            {
              name: "child-test-1",
              path: "file1.test.ts",
              failed: true,
              duration: 50,
              subTests: [],
            },
            {
              name: "child-test-2",
              path: "file1.test.ts",
              duration: 30,
              subTests: [],
            },
          ],
        },
      ],
    },
  ];

  const result = processTestResults(results);

  assertEquals(result.stats.total, 3);
  assertEquals(result.stats.passed, 2);
  assertEquals(result.stats.failed, 1);
  assertEquals(result.stats.totalDuration, 180);
});

Deno.test("processTestResults - sorts job stats alphabetically", () => {
  const results: JobTestResults[] = [
    {
      name: "zebra-job",
      tests: [],
    },
    {
      name: "alpha-job",
      tests: [],
    },
    {
      name: "beta-job",
      tests: [],
    },
  ];

  const result = processTestResults(results);

  assertEquals(result.jobStats.length, 3);
  assertEquals(result.jobStats[0].jobName, "alpha-job");
  assertEquals(result.jobStats[1].jobName, "beta-job");
  assertEquals(result.jobStats[2].jobName, "zebra-job");
});

Deno.test("processTestResults - identifies failed tests per job", () => {
  const results: JobTestResults[] = [
    {
      name: "test-job",
      tests: [
        {
          name: "failing-test-1",
          path: "file1.test.ts",
          failed: true,
          subTests: [],
        },
        {
          name: "failing-test-2",
          path: "file2.test.ts",
          failed: true,
          subTests: [],
        },
        {
          name: "passing-test",
          path: "file3.test.ts",
          subTests: [],
        },
      ],
    },
  ];

  const result = processTestResults(results);

  assertEquals(result.jobStats.length, 1);
  assertEquals(result.jobStats[0].failed.length, 2);
  assertEquals(result.jobStats[0].failed[0].name, "failing-test-1");
  assertEquals(result.jobStats[0].failed[1].name, "failing-test-2");
});

Deno.test("processTestResults - identifies flaky tests per job", () => {
  const results: JobTestResults[] = [
    {
      name: "test-job",
      tests: [
        {
          name: "flaky-test-1",
          path: "file1.test.ts",
          flakyCount: 3,
          subTests: [],
        },
        {
          name: "flaky-test-2",
          path: "file2.test.ts",
          flakyCount: 1,
          subTests: [],
        },
        {
          name: "stable-test",
          path: "file3.test.ts",
          subTests: [],
        },
      ],
    },
  ];

  const result = processTestResults(results);

  assertEquals(result.jobStats.length, 1);
  assertEquals(result.jobStats[0].flaky.length, 2);
  assertEquals(result.jobStats[0].flaky[0].name, "flaky-test-1");
  assertEquals(result.jobStats[0].flaky[1].name, "flaky-test-2");
});

Deno.test("processTestResults - finds top 10 longest tests per job", () => {
  const results: JobTestResults[] = [
    {
      name: "test-job",
      tests: Array.from({ length: 15 }, (_, i) => ({
        name: `test-${i}`,
        path: "file.test.ts",
        duration: (15 - i) * 100, // 1500, 1400, 1300, ..., 100
        subTests: [],
      })),
    },
  ];

  const result = processTestResults(results);

  assertEquals(result.jobStats.length, 1);
  assertEquals(result.jobStats[0].longest.length, 10);
  assertEquals(result.jobStats[0].longest[0].duration, 1500);
  assertEquals(result.jobStats[0].longest[9].duration, 600);
});

Deno.test("processTestResults - excludes unit tests from longest tests", () => {
  const results: JobTestResults[] = [
    {
      name: "test-job",
      tests: [
        {
          name: "unit::slow-unit-test",
          path: "file.test.ts",
          duration: 1000,
          subTests: [],
        },
        {
          name: "integration-test",
          path: "file.test.ts",
          duration: 500,
          subTests: [],
        },
        {
          name: "unit_node::another-unit-test",
          path: "file.test.ts",
          duration: 800,
          subTests: [],
        },
      ],
    },
  ];

  const result = processTestResults(results);

  assertEquals(result.jobStats[0].longest.length, 1);
  assertEquals(result.jobStats[0].longest[0].name, "integration-test");
});

Deno.test("processTestResults - calculates normalized test scores across jobs", () => {
  const results: JobTestResults[] = [
    {
      name: "job1",
      tests: [
        {
          name: "slow-test",
          path: "file.test.ts",
          duration: 1000,
          subTests: [],
        },
        {
          name: "fast-test",
          path: "file.test.ts",
          duration: 100,
          subTests: [],
        },
        {
          name: "medium-test",
          path: "file.test.ts",
          duration: 500,
          subTests: [],
        },
      ],
    },
    {
      name: "job2",
      tests: [
        {
          name: "slow-test",
          path: "file.test.ts",
          duration: 2000,
          subTests: [],
        },
        {
          name: "fast-test",
          path: "file.test.ts",
          duration: 200,
          subTests: [],
        },
      ],
    },
  ];

  const result = processTestResults(results);

  // slow-test should be at the top since it appears in both jobs
  const slowTest = result.topAveragedTests.find((t) => t.name === "slow-test");
  assertEquals(slowTest !== undefined, true);
  assertEquals(slowTest!.jobCount, 2);
  assertEquals(slowTest!.avgDuration, 1500); // (1000 + 2000) / 2
});

Deno.test("processTestResults - limits top averaged tests to 15", () => {
  const results: JobTestResults[] = [
    {
      name: "test-job",
      tests: Array.from({ length: 20 }, (_, i) => ({
        name: `test-${i}`,
        path: "file.test.ts",
        duration: (20 - i) * 100,
        subTests: [],
      })),
    },
  ];

  const result = processTestResults(results);

  assertEquals(result.topAveragedTests.length, 15);
});

Deno.test("processTestResults - excludes unit tests from normalized scores", () => {
  const results: JobTestResults[] = [
    {
      name: "test-job",
      tests: [
        {
          name: "unit::unit-test",
          path: "file.test.ts",
          duration: 2000,
          subTests: [],
        },
        {
          name: "integration-test",
          path: "file.test.ts",
          duration: 1000,
          subTests: [],
        },
        {
          name: "normal-test",
          path: "file.test.ts",
          duration: 500,
          subTests: [],
        },
      ],
    },
  ];

  const result = processTestResults(results);

  // Should only have 2 tests, excluding the unit test
  assertEquals(result.topAveragedTests.length, 2);
  assertEquals(
    result.topAveragedTests.every((t) => !t.name.startsWith("unit::")),
    true,
  );
});

Deno.test("processTestResults - handles tests without duration", () => {
  const results: JobTestResults[] = [
    {
      name: "test-job",
      tests: [
        {
          name: "test-with-duration",
          path: "file.test.ts",
          duration: 100,
          subTests: [],
        },
        {
          name: "test-without-duration",
          path: "file.test.ts",
          subTests: [],
        },
      ],
    },
  ];

  const result = processTestResults(results);

  assertEquals(result.stats.totalDuration, 100);
  assertEquals(result.topAveragedTests.length, 1);
  assertEquals(result.topAveragedTests[0].name, "test-with-duration");
});

Deno.test("processTestResults - handles empty results", () => {
  const results: JobTestResults[] = [];

  const result = processTestResults(results);

  assertEquals(result.stats.total, 0);
  assertEquals(result.stats.passed, 0);
  assertEquals(result.stats.failed, 0);
  assertEquals(result.stats.ignored, 0);
  assertEquals(result.stats.flaky, 0);
  assertEquals(result.stats.totalDuration, 0);
  assertEquals(result.jobStats.length, 0);
  assertEquals(result.topAveragedTests.length, 0);
});

Deno.test("processTestResults - normalizes scores relative to job median", () => {
  const results: JobTestResults[] = [
    {
      name: "job1",
      tests: [
        // Median will be 200 (sorted: 100, 200, 1000)
        {
          name: "slow-test",
          path: "file.test.ts",
          duration: 1000,
          subTests: [],
        },
        {
          name: "fast-test",
          path: "file.test.ts",
          duration: 100,
          subTests: [],
        },
        {
          name: "median-test",
          path: "file.test.ts",
          duration: 200,
          subTests: [],
        },
      ],
    },
  ];

  const result = processTestResults(results);

  const slowTest = result.topAveragedTests.find((t) => t.name === "slow-test");
  assertEquals(slowTest !== undefined, true);
  // slow-test is 1000ms, median is 200ms, so normalized score should be 5
  assertEquals(slowTest!.normalizedScore, 5);
});

Deno.test("processTestResults - calculates total duration per job", () => {
  const results: JobTestResults[] = [
    {
      name: "test-job",
      tests: [
        {
          name: "test1",
          path: "file.test.ts",
          duration: 100,
          subTests: [
            {
              name: "subtest1",
              path: "file.test.ts",
              duration: 50,
              subTests: [],
            },
          ],
        },
        {
          name: "test2",
          path: "file.test.ts",
          duration: 200,
          subTests: [],
        },
      ],
    },
  ];

  const result = processTestResults(results);

  assertEquals(result.jobStats[0].totalDuration, 350);
});

Deno.test("processStepPerformance - filters and sorts steps correctly", () => {
  const jobs: WorkflowJob[] = [
    {
      id: 1,
      run_id: 100,
      name: "test-linux",
      status: "completed",
      conclusion: "success",
      started_at: "2024-01-01T10:00:00Z",
      completed_at: "2024-01-01T10:10:00Z",
      steps: [
        {
          name: "Checkout code",
          status: "completed",
          conclusion: "success",
          number: 1,
          started_at: "2024-01-01T10:00:00Z",
          completed_at: "2024-01-01T10:00:30Z", // 30 seconds
        },
        {
          name: "Run tests",
          status: "completed",
          conclusion: "success",
          number: 2,
          started_at: "2024-01-01T10:00:30Z",
          completed_at: "2024-01-01T10:05:30Z", // 5 minutes = 300 seconds
        },
        {
          name: "Quick step",
          status: "completed",
          conclusion: "success",
          number: 3,
          started_at: "2024-01-01T10:05:30Z",
          completed_at: "2024-01-01T10:05:33Z", // 3 seconds (should be filtered out)
        },
      ],
    },
  ];

  const result = processStepPerformance(jobs);

  // Should have 2 steps (excluding the 3-second step)
  assertEquals(result.length, 2);
  // Should be sorted by average duration descending
  assertEquals(result[0].name, "Run tests");
  assertEquals(result[0].avgDuration, 300);
  assertEquals(result[0].count, 1);
  assertEquals(result[1].name, "Checkout code");
  assertEquals(result[1].avgDuration, 30);
  assertEquals(result[1].count, 1);
});

Deno.test("processStepPerformance - only includes test jobs", () => {
  const jobs: WorkflowJob[] = [
    {
      id: 1,
      run_id: 100,
      name: "test-linux",
      status: "completed",
      conclusion: "success",
      started_at: "2024-01-01T10:00:00Z",
      completed_at: "2024-01-01T10:10:00Z",
      steps: [
        {
          name: "Run tests",
          status: "completed",
          conclusion: "success",
          number: 1,
          started_at: "2024-01-01T10:00:00Z",
          completed_at: "2024-01-01T10:01:00Z", // 60 seconds
        },
      ],
    },
    {
      id: 2,
      run_id: 100,
      name: "build-artifacts",
      status: "completed",
      conclusion: "success",
      started_at: "2024-01-01T10:00:00Z",
      completed_at: "2024-01-01T10:10:00Z",
      steps: [
        {
          name: "Build",
          status: "completed",
          conclusion: "success",
          number: 1,
          started_at: "2024-01-01T10:00:00Z",
          completed_at: "2024-01-01T10:02:00Z", // 120 seconds
        },
      ],
    },
  ];

  const result = processStepPerformance(jobs);

  // Should only include steps from "test-linux" job
  assertEquals(result.length, 1);
  assertEquals(result[0].name, "Run tests");
  assertEquals(result[0].avgDuration, 60);
  assertEquals(result[0].count, 1);
});

Deno.test("processStepPerformance - handles jobs without steps", () => {
  const jobs: WorkflowJob[] = [
    {
      id: 1,
      run_id: 100,
      name: "test-linux",
      status: "completed",
      conclusion: "success",
      started_at: "2024-01-01T10:00:00Z",
      completed_at: "2024-01-01T10:10:00Z",
      // No steps property
    },
  ];

  const result = processStepPerformance(jobs);

  assertEquals(result.length, 0);
});

Deno.test("processStepPerformance - excludes steps without timing data", () => {
  const jobs: WorkflowJob[] = [
    {
      id: 1,
      run_id: 100,
      name: "test-linux",
      status: "completed",
      conclusion: "success",
      started_at: "2024-01-01T10:00:00Z",
      completed_at: "2024-01-01T10:10:00Z",
      steps: [
        {
          name: "Step with timing",
          status: "completed",
          conclusion: "success",
          number: 1,
          started_at: "2024-01-01T10:00:00Z",
          completed_at: "2024-01-01T10:01:00Z",
        },
        {
          name: "Step without timing",
          status: "completed",
          conclusion: "success",
          number: 2,
          started_at: null,
          completed_at: null,
        },
      ],
    },
  ];

  const result = processStepPerformance(jobs);

  assertEquals(result.length, 1);
  assertEquals(result[0].name, "Step with timing");
});

Deno.test("processStepPerformance - averages steps across jobs", () => {
  const jobs: WorkflowJob[] = [
    {
      id: 1,
      run_id: 100,
      name: "test-linux",
      status: "completed",
      conclusion: "success",
      started_at: "2024-01-01T10:00:00Z",
      completed_at: "2024-01-01T10:10:00Z",
      steps: [
        {
          name: "Run tests",
          status: "completed",
          conclusion: "success",
          number: 1,
          started_at: "2024-01-01T10:00:00Z",
          completed_at: "2024-01-01T10:01:00Z", // 60 seconds
        },
        {
          name: "Upload results",
          status: "completed",
          conclusion: "success",
          number: 2,
          started_at: "2024-01-01T10:01:00Z",
          completed_at: "2024-01-01T10:01:20Z", // 20 seconds
        },
      ],
    },
    {
      id: 2,
      run_id: 100,
      name: "test-windows",
      status: "completed",
      conclusion: "success",
      started_at: "2024-01-01T10:00:00Z",
      completed_at: "2024-01-01T10:10:00Z",
      steps: [
        {
          name: "Run tests",
          status: "completed",
          conclusion: "success",
          number: 1,
          started_at: "2024-01-01T10:00:00Z",
          completed_at: "2024-01-01T10:02:00Z", // 120 seconds
        },
        // This job doesn't have "Upload results" step
      ],
    },
    {
      id: 3,
      run_id: 100,
      name: "test-macos",
      status: "completed",
      conclusion: "success",
      started_at: "2024-01-01T10:00:00Z",
      completed_at: "2024-01-01T10:10:00Z",
      steps: [
        {
          name: "Run tests",
          status: "completed",
          conclusion: "success",
          number: 1,
          started_at: "2024-01-01T10:00:00Z",
          completed_at: "2024-01-01T10:01:30Z", // 90 seconds
        },
        {
          name: "Upload results",
          status: "completed",
          conclusion: "success",
          number: 2,
          started_at: "2024-01-01T10:01:30Z",
          completed_at: "2024-01-01T10:02:00Z", // 30 seconds
        },
      ],
    },
  ];

  const result = processStepPerformance(jobs);

  assertEquals(result.length, 2);

  // Run tests appears in all 3 jobs: avg=(60+120+90)/3=90s, min=60s, max=120s
  assertEquals(result[0].name, "Run tests");
  assertEquals(result[0].avgDuration, 90);
  assertEquals(result[0].minDuration, 60);
  assertEquals(result[0].maxDuration, 120);
  assertEquals(result[0].count, 3);

  // Upload results appears in only 2 jobs: avg=(20+30)/2=25s, min=20s, max=30s
  assertEquals(result[1].name, "Upload results");
  assertEquals(result[1].avgDuration, 25);
  assertEquals(result[1].minDuration, 20);
  assertEquals(result[1].maxDuration, 30);
  assertEquals(result[1].count, 2);
});
