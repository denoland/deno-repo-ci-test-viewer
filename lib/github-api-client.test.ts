import { assertEquals, assertRejects } from "@std/assert";
import { RealGitHubApiClient, type WorkflowRun } from "./github-api-client.ts";
import type { FileFetcher } from "./file-fetcher.ts";

class MockFileFetcher implements FileFetcher {
  #responses: Map<string, Response> = new Map();

  mockResponse(url: string, response: Response) {
    this.#responses.set(url, response);
  }

  get(url: string | URL, _headers: HeadersInit): Promise<Response> {
    const urlString = url.toString();
    const response = this.#responses.get(urlString);
    if (!response) {
      return Promise.resolve(
        new Response(null, { status: 404, statusText: "Not Found" }),
      );
    }
    return Promise.resolve(response);
  }
}

function createMockResponse(
  data: unknown,
  status = 200,
  statusText = "OK",
): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.test("RealGitHubApiClient - listWorkflowRuns success", async () => {
  const mockFetcher = new MockFileFetcher();
  const client = new RealGitHubApiClient(mockFetcher, "test-token");

  const mockData = {
    total_count: 100,
    workflow_runs: [
      {
        id: 123,
        name: "CI",
        display_title: "Test run",
        status: "completed",
        conclusion: "success",
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:10:00Z",
        run_number: 1,
        event: "push",
        head_branch: "main",
        head_sha: "abc123",
      },
    ],
  };

  mockFetcher.mockResponse(
    "https://api.github.com/repos/denoland/deno/actions/runs?per_page=30&page=1",
    createMockResponse(mockData),
  );

  const result = await client.listWorkflowRuns(30, 1);

  assertEquals(result.totalCount, 100);
  assertEquals(result.runs.length, 1);
  assertEquals(result.runs[0].id, 123);
  assertEquals(result.runs[0].name, "CI");
});

Deno.test("RealGitHubApiClient - listWorkflowRuns with custom pagination", async () => {
  const mockFetcher = new MockFileFetcher();
  const client = new RealGitHubApiClient(mockFetcher, "test-token");

  const mockData = {
    total_count: 200,
    workflow_runs: [],
  };

  mockFetcher.mockResponse(
    "https://api.github.com/repos/denoland/deno/actions/runs?per_page=50&page=2",
    createMockResponse(mockData),
  );

  const result = await client.listWorkflowRuns(50, 2);

  assertEquals(result.totalCount, 200);
  assertEquals(result.runs.length, 0);
});

Deno.test("RealGitHubApiClient - listWorkflowRuns failure", async () => {
  const mockFetcher = new MockFileFetcher();
  const client = new RealGitHubApiClient(mockFetcher, "test-token");

  mockFetcher.mockResponse(
    "https://api.github.com/repos/denoland/deno/actions/runs?per_page=30&page=1",
    new Response(null, { status: 500, statusText: "Internal Server Error" }),
  );

  await assertRejects(
    () => client.listWorkflowRuns(30, 1),
    Error,
    "Failed to fetch workflow runs: 500 Internal Server Error",
  );
});

Deno.test("RealGitHubApiClient - getWorkflowRun success", async () => {
  const mockFetcher = new MockFileFetcher();
  const client = new RealGitHubApiClient(mockFetcher, "test-token");

  const mockRun: WorkflowRun = {
    id: 456,
    name: "Test Workflow",
    display_title: "PR #123",
    status: "completed",
    conclusion: "failure",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:15:00Z",
    run_number: 42,
    event: "pull_request",
    head_branch: "feature-branch",
    head_sha: "def456",
  };

  mockFetcher.mockResponse(
    "https://api.github.com/repos/denoland/deno/actions/runs/456",
    createMockResponse(mockRun),
  );

  const result = await client.getWorkflowRun(456);

  assertEquals(result, mockRun);
});

Deno.test("RealGitHubApiClient - getWorkflowRun not found", async () => {
  const mockFetcher = new MockFileFetcher();
  const client = new RealGitHubApiClient(mockFetcher, "test-token");

  mockFetcher.mockResponse(
    "https://api.github.com/repos/denoland/deno/actions/runs/999",
    new Response(null, { status: 404, statusText: "Not Found" }),
  );

  const result = await client.getWorkflowRun(999);

  assertEquals(result, undefined);
});

Deno.test("RealGitHubApiClient - getWorkflowRun failure", async () => {
  const mockFetcher = new MockFileFetcher();
  const client = new RealGitHubApiClient(mockFetcher, "test-token");

  mockFetcher.mockResponse(
    "https://api.github.com/repos/denoland/deno/actions/runs/123",
    new Response(null, { status: 403, statusText: "Forbidden" }),
  );

  await assertRejects(
    () => client.getWorkflowRun(123),
    Error,
    "Failed to fetch workflow run: 403 Forbidden",
  );
});

Deno.test("RealGitHubApiClient - listArtifacts success", async () => {
  const mockFetcher = new MockFileFetcher();
  const client = new RealGitHubApiClient(mockFetcher, "test-token");

  const mockData = {
    total_count: 2,
    artifacts: [
      {
        id: 1,
        name: "test-results",
        size_in_bytes: 1024,
        url: "https://api.github.com/artifacts/1",
        archive_download_url: "https://api.github.com/artifacts/1/zip",
        expired: false,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
        expires_at: "2025-01-31T00:00:00Z",
      },
      {
        id: 2,
        name: "coverage",
        size_in_bytes: 2048,
        url: "https://api.github.com/artifacts/2",
        archive_download_url: "https://api.github.com/artifacts/2/zip",
        expired: false,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
        expires_at: "2025-01-31T00:00:00Z",
      },
    ],
  };

  mockFetcher.mockResponse(
    "https://api.github.com/repos/denoland/deno/actions/runs/123/artifacts",
    createMockResponse(mockData),
  );

  const result = await client.listArtifacts(123);

  assertEquals(result.length, 2);
  assertEquals(result[0].name, "test-results");
  assertEquals(result[1].name, "coverage");
});

Deno.test("RealGitHubApiClient - listArtifacts failure", async () => {
  const mockFetcher = new MockFileFetcher();
  const client = new RealGitHubApiClient(mockFetcher, "test-token");

  mockFetcher.mockResponse(
    "https://api.github.com/repos/denoland/deno/actions/runs/123/artifacts",
    new Response(null, { status: 401, statusText: "Unauthorized" }),
  );

  await assertRejects(
    () => client.listArtifacts(123),
    Error,
    "Failed to list artifacts: 401 Unauthorized",
  );
});

Deno.test("RealGitHubApiClient - downloadArtifact success", async () => {
  const mockFetcher = new MockFileFetcher();
  const client = new RealGitHubApiClient(mockFetcher, "test-token");

  const mockBlob = new Blob(["fake zip content"], { type: "application/zip" });
  mockFetcher.mockResponse(
    "https://api.github.com/artifacts/1/zip",
    new Response(mockBlob, { status: 200, statusText: "OK" }),
  );

  const result = await client.downloadArtifact(
    "https://api.github.com/artifacts/1/zip",
  );

  assertEquals(result.type, "application/zip");
  const text = await result.text();
  assertEquals(text, "fake zip content");
});

Deno.test("RealGitHubApiClient - downloadArtifact failure", async () => {
  const mockFetcher = new MockFileFetcher();
  const client = new RealGitHubApiClient(mockFetcher, "test-token");

  mockFetcher.mockResponse(
    "https://api.github.com/artifacts/1/zip",
    new Response(null, { status: 410, statusText: "Gone" }),
  );

  await assertRejects(
    () => client.downloadArtifact("https://api.github.com/artifacts/1/zip"),
    Error,
    "Failed to download artifact: 410 Gone",
  );
});
