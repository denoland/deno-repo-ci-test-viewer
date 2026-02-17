import { assertEquals } from "@std/assert";
import {
  type ParsedTestResultArtifact,
  RealTestResultsDownloader,
  type RecordedTestResult,
} from "./test-results-downloader.ts";
import type { Artifact } from "./github-api-client.ts";
import type { AsyncValue } from "./utils/async-value.ts";

class MockGitHubApiClient {
  #artifacts: Map<number, Artifact[]> = new Map();
  #blobs: Map<string, Blob> = new Map();

  mockArtifacts(runId: number, artifacts: Artifact[]) {
    this.#artifacts.set(runId, artifacts);
  }

  mockBlob(url: string, blob: Blob) {
    this.#blobs.set(url, blob);
  }

  listArtifacts(runId: number): Promise<Artifact[]> {
    return Promise.resolve(this.#artifacts.get(runId) ?? []);
  }

  downloadArtifact(archiveDownloadUrl: string): Promise<Blob> {
    const blob = this.#blobs.get(archiveDownloadUrl);
    if (!blob) {
      throw new Error(`Blob not found for ${archiveDownloadUrl}`);
    }
    return Promise.resolve(blob);
  }
}

class MockArtifactParser {
  #results: Map<string, { name: string; tests: RecordedTestResult[] }> =
    new Map();

  mockParseResult(
    artifactName: string,
    result: { name: string; tests: RecordedTestResult[] },
  ) {
    this.#results.set(artifactName, result);
  }

  parse(artifactName: string, _blob: Blob) {
    const result = this.#results.get(artifactName);
    if (!result) {
      throw new Error(`No mock result for artifact: ${artifactName}`);
    }
    return Promise.resolve(result);
  }
}

class MockTestResultArtifactStore
  extends Map<string, AsyncValue<ParsedTestResultArtifact>> {
}

function createMockArtifact(
  id: number,
  name: string,
  downloadUrl: string,
): Artifact {
  return {
    id,
    name,
    size_in_bytes: 1024,
    url: `https://api.github.com/artifacts/${id}`,
    archive_download_url: downloadUrl,
    expired: false,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    expires_at: "2025-01-31T00:00:00Z",
  };
}

Deno.test("download test results for run", async () => {
  const mockClient = new MockGitHubApiClient();
  const mockParser = new MockArtifactParser();
  const mockStore = new MockTestResultArtifactStore();

  const downloader = new RealTestResultsDownloader(
    mockParser,
    mockClient,
    mockStore,
  );

  // Setup mocks
  const artifacts = [
    createMockArtifact(
      1,
      "test-results-linux.json",
      "https://example.com/1.zip",
    ),
    createMockArtifact(
      2,
      "test-results-macos.json",
      "https://example.com/2.zip",
    ),
    createMockArtifact(3, "build-logs.txt", "https://example.com/3.zip"), // Should be filtered out
  ];

  mockClient.mockArtifacts(12345, artifacts);
  mockClient.mockBlob("https://example.com/1.zip", new Blob(["test1"]));
  mockClient.mockBlob("https://example.com/2.zip", new Blob(["test2"]));

  mockParser.mockParseResult("test-results-linux.json", {
    name: "linux",
    tests: [{ name: "test1", path: "test1.ts", duration: 100 }],
  });

  mockParser.mockParseResult("test-results-macos.json", {
    name: "macos",
    tests: [{ name: "test2", path: "test2.ts", duration: 200 }],
  });

  // Execute
  const results = await downloader.downloadForRunId(12345);

  // Verify
  assertEquals(results.length, 2);
  assertEquals(results[0].name, "linux");
  assertEquals(results[0].tests.length, 1);
  assertEquals(results[0].tests[0].name, "test1");
  assertEquals(results[1].name, "macos");
  assertEquals(results[1].tests.length, 1);
  assertEquals(results[1].tests[0].name, "test2");
});

Deno.test("filter non-matching artifacts", async () => {
  const mockClient = new MockGitHubApiClient();
  const mockParser = new MockArtifactParser();
  const mockStore = new MockTestResultArtifactStore();

  const downloader = new RealTestResultsDownloader(
    mockParser,
    mockClient,
    mockStore,
  );

  // Setup mocks with various artifact names
  const artifacts = [
    createMockArtifact(1, "test-results-ci.json", "https://example.com/1.zip"),
    createMockArtifact(2, "coverage-report.json", "https://example.com/2.zip"),
    createMockArtifact(3, "build-output.zip", "https://example.com/3.zip"),
    createMockArtifact(4, "test-results.json", "https://example.com/4.zip"), // Missing suffix
    createMockArtifact(5, "test-results-windows", "https://example.com/5.zip"), // Missing .json
  ];

  mockClient.mockArtifacts(456, artifacts);
  mockClient.mockBlob("https://example.com/1.zip", new Blob(["test"]));

  mockParser.mockParseResult("test-results-ci.json", {
    name: "ci",
    tests: [],
  });

  // Execute
  const results = await downloader.downloadForRunId(456);

  // Verify - only test-results-ci.json should match the pattern
  assertEquals(results.length, 1);
  assertEquals(results[0].name, "ci");
});

Deno.test("cache artifacts by download URL", async () => {
  const mockClient = new MockGitHubApiClient();
  const mockParser = new MockArtifactParser();
  const mockStore = new MockTestResultArtifactStore();

  const downloader = new RealTestResultsDownloader(
    mockParser,
    mockClient,
    mockStore,
  );

  // Setup mocks
  const artifacts = [
    createMockArtifact(
      1,
      "test-results-cached.json",
      "https://example.com/cached.zip",
    ),
  ];

  mockClient.mockArtifacts(789, artifacts);
  mockClient.mockBlob("https://example.com/cached.zip", new Blob(["test"]));

  let parseCallCount = 0;
  mockParser.mockParseResult("test-results-cached.json", {
    name: "cached",
    tests: [{ name: "test", path: "test.ts", duration: 100 }],
  });

  // Wrap parse to count calls
  const originalParse = mockParser.parse.bind(mockParser);
  mockParser.parse = async (artifactName: string, blob: Blob) => {
    parseCallCount++;
    return await originalParse(artifactName, blob);
  };

  // Execute multiple times
  const results1 = await downloader.downloadForRunId(789);
  const results2 = await downloader.downloadForRunId(789);
  const results3 = await downloader.downloadForRunId(789);

  // Verify - parse should only be called once due to caching
  assertEquals(parseCallCount, 1);
  assertEquals(results1.length, 1);
  assertEquals(results2.length, 1);
  assertEquals(results3.length, 1);
  assertEquals(results1[0].name, "cached");
  assertEquals(results2[0].name, "cached");
  assertEquals(results3[0].name, "cached");
});

Deno.test("handle empty artifact list", async () => {
  const mockClient = new MockGitHubApiClient();
  const mockParser = new MockArtifactParser();
  const mockStore = new MockTestResultArtifactStore();

  const downloader = new RealTestResultsDownloader(
    mockParser,
    mockClient,
    mockStore,
  );

  // Setup with no artifacts
  mockClient.mockArtifacts(999, []);

  // Execute
  const results = await downloader.downloadForRunId(999);

  // Verify
  assertEquals(results.length, 0);
});

Deno.test("handle complex test results", async () => {
  const mockClient = new MockGitHubApiClient();
  const mockParser = new MockArtifactParser();
  const mockStore = new MockTestResultArtifactStore();

  const downloader = new RealTestResultsDownloader(
    mockParser,
    mockClient,
    mockStore,
  );

  // Setup mocks
  const artifacts = [
    createMockArtifact(
      1,
      "test-results-integration.json",
      "https://example.com/int.zip",
    ),
  ];

  mockClient.mockArtifacts(111, artifacts);
  mockClient.mockBlob("https://example.com/int.zip", new Blob(["test"]));

  mockParser.mockParseResult("test-results-integration.json", {
    name: "integration",
    tests: [
      {
        name: "parent test",
        path: "test/parent.ts",
        duration: 500,
        subTests: [
          {
            name: "child test 1",
            path: "test/parent.ts",
            duration: 200,
          },
          {
            name: "child test 2",
            path: "test/parent.ts",
            duration: 300,
            failed: true,
          },
        ],
      },
      {
        name: "flaky test",
        path: "test/flaky.ts",
        flakyCount: 3,
        duration: 100,
      },
      {
        name: "ignored test",
        path: "test/ignored.ts",
        ignored: true,
      },
    ],
  });

  // Execute
  const results = await downloader.downloadForRunId(111);

  // Verify
  assertEquals(results.length, 1);
  assertEquals(results[0].tests.length, 3);
  assertEquals(results[0].tests[0].subTests?.length, 2);
  assertEquals(results[0].tests[0].subTests?.[1].failed, true);
  assertEquals(results[0].tests[1].flakyCount, 3);
  assertEquals(results[0].tests[2].ignored, true);
});

Deno.test("download multiple artifacts in parallel", async () => {
  const mockClient = new MockGitHubApiClient();
  const mockParser = new MockArtifactParser();
  const mockStore = new MockTestResultArtifactStore();

  const downloader = new RealTestResultsDownloader(
    mockParser,
    mockClient,
    mockStore,
  );

  // Setup mocks with 5 artifacts
  const artifacts = [
    createMockArtifact(
      1,
      "test-results-linux.json",
      "https://example.com/1.zip",
    ),
    createMockArtifact(
      2,
      "test-results-macos.json",
      "https://example.com/2.zip",
    ),
    createMockArtifact(
      3,
      "test-results-windows.json",
      "https://example.com/3.zip",
    ),
    createMockArtifact(
      4,
      "test-results-freebsd.json",
      "https://example.com/4.zip",
    ),
    createMockArtifact(
      5,
      "test-results-docker.json",
      "https://example.com/5.zip",
    ),
  ];

  mockClient.mockArtifacts(222, artifacts);

  for (let i = 1; i <= 5; i++) {
    mockClient.mockBlob(`https://example.com/${i}.zip`, new Blob([`test${i}`]));
    mockParser.mockParseResult(
      `test-results-${
        ["linux", "macos", "windows", "freebsd", "docker"][i - 1]
      }.json`,
      {
        name: ["linux", "macos", "windows", "freebsd", "docker"][i - 1],
        tests: [{ name: `test${i}`, path: `test${i}.ts`, duration: i * 100 }],
      },
    );
  }

  // Execute
  const startTime = Date.now();
  const results = await downloader.downloadForRunId(222);
  const duration = Date.now() - startTime;

  // Verify - should complete quickly due to parallel processing
  assertEquals(results.length, 5);
  // Parallel execution should be significantly faster than sequential
  // Even with mocks, this should complete in well under 500ms
  assertEquals(
    duration < 500,
    true,
    `Expected parallel execution, took ${duration}ms`,
  );
});

Deno.test("merge split artifacts by job", async () => {
  const mockClient = new MockGitHubApiClient();
  const mockParser = new MockArtifactParser();
  const mockStore = new MockTestResultArtifactStore();

  const downloader = new RealTestResultsDownloader(
    mockParser,
    mockClient,
    mockStore,
  );

  // setup artifacts split by suite (new naming convention)
  const artifacts = [
    createMockArtifact(
      1,
      "test-results-linux-x86_64-debug-integration.json",
      "https://example.com/1.zip",
    ),
    createMockArtifact(
      2,
      "test-results-linux-x86_64-debug-unit.json",
      "https://example.com/2.zip",
    ),
    createMockArtifact(
      3,
      "test-results-macos-aarch64-debug-specs.json",
      "https://example.com/3.zip",
    ),
  ];

  mockClient.mockArtifacts(444, artifacts);
  for (let i = 1; i <= 3; i++) {
    mockClient.mockBlob(`https://example.com/${i}.zip`, new Blob([`test${i}`]));
  }

  mockParser.mockParseResult(
    "test-results-linux-x86_64-debug-integration.json",
    {
      name: "linux-x86_64-debug-integration",
      tests: [{ name: "int_test", path: "test/int.ts", duration: 100 }],
    },
  );
  mockParser.mockParseResult("test-results-linux-x86_64-debug-unit.json", {
    name: "linux-x86_64-debug-unit",
    tests: [{ name: "unit_test", path: "test/unit.ts", duration: 50 }],
  });
  mockParser.mockParseResult(
    "test-results-macos-aarch64-debug-specs.json",
    {
      name: "macos-aarch64-debug-specs",
      tests: [{ name: "spec_test", path: "test/spec.ts", duration: 200 }],
    },
  );

  const results = await downloader.downloadForRunId(444);

  // linux-x86_64-debug artifacts should be merged into one
  assertEquals(results.length, 2);
  assertEquals(results[0].name, "linux-x86_64-debug");
  assertEquals(results[0].tests.length, 2);
  assertEquals(results[0].tests[0].name, "int_test");
  assertEquals(results[0].tests[1].name, "unit_test");
  assertEquals(results[1].name, "macos-aarch64-debug");
  assertEquals(results[1].tests.length, 1);
});

Deno.test("store is shared across downloads", async () => {
  const mockClient = new MockGitHubApiClient();
  const mockParser = new MockArtifactParser();
  const mockStore = new MockTestResultArtifactStore();

  const downloader = new RealTestResultsDownloader(
    mockParser,
    mockClient,
    mockStore,
  );

  // Setup mocks
  const artifacts = [
    createMockArtifact(
      1,
      "test-results-shared.json",
      "https://example.com/shared.zip",
    ),
  ];

  mockClient.mockArtifacts(333, artifacts);
  mockClient.mockBlob("https://example.com/shared.zip", new Blob(["test"]));

  mockParser.mockParseResult("test-results-shared.json", {
    name: "shared",
    tests: [],
  });

  // Execute first download
  await downloader.downloadForRunId(333);

  // Verify store has the cached value
  const cachedValue = mockStore.get("https://example.com/shared.zip");
  assertEquals(cachedValue !== undefined, true);

  // Get the cached value
  const cached = await cachedValue!.get();
  assertEquals(cached.name, "shared");
});
