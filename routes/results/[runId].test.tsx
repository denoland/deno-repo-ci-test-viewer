import { assertEquals } from "@std/assert";
import { processTestResults } from "./[runId].tsx";
import type { JobTestResults } from "@/lib/test-results-downloader.ts";

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
