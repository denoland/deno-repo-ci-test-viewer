import type { FileFetcher } from "./file-fetcher.ts";
import type { ExtractInterface } from "./types.ts";

const OWNER = "denoland";
const REPO = "deno";

export interface WorkflowRun {
  id: number;
  name: string;
  display_title: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  run_number: number;
  event: string;
  head_branch: string;
  head_sha: string;
}

interface WorkflowRunsResponse {
  total_count: number;
  workflow_runs: WorkflowRun[];
}

export interface Artifact {
  id: number;
  name: string;
  size_in_bytes: number;
  url: string;
  archive_download_url: string;
  expired: boolean;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

interface ArtifactsListResponse {
  total_count: number;
  artifacts: Artifact[];
}

export interface WorkflowStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
  started_at: string | null;
  completed_at: string | null;
}

export interface WorkflowJob {
  id: number;
  run_id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string;
  completed_at: string | null;
  steps?: WorkflowStep[];
}

interface JobsListResponse {
  total_count: number;
  jobs: WorkflowJob[];
}

export type GitHubApiClient = ExtractInterface<RealGitHubApiClient>;

export class RealGitHubApiClient {
  readonly #fileFetcher: FileFetcher;
  readonly #token: string | undefined;

  constructor(fileFetcher: FileFetcher, token: string | undefined) {
    this.#fileFetcher = fileFetcher;
    this.#token = token;
  }

  #getHeaders(): HeadersInit {
    const obj: Record<string, string> = {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (this.#token) {
      obj["Authorization"] = `Bearer ${this.#token}`;
    }
    return obj;
  }

  async listWorkflowRuns(
    perPage = 30,
    page = 1,
  ): Promise<{ runs: WorkflowRun[]; totalCount: number }> {
    const url = new URL(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/runs`,
    );
    url.searchParams.set("per_page", perPage.toString());
    url.searchParams.set("page", page.toString());

    const response = await this.#fileFetcher.get(url, this.#getHeaders());

    if (!response.ok) {
      throw new Error(
        `Failed to fetch workflow runs: ${response.status} ${response.statusText}`,
      );
    }

    const data: WorkflowRunsResponse = await response.json();
    return {
      runs: data.workflow_runs,
      totalCount: data.total_count,
    };
  }

  async getWorkflowRun(runId: number): Promise<WorkflowRun | undefined> {
    const response = await this.#fileFetcher.get(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${runId}`,
      this.#getHeaders(),
    );

    if (response.status === 404) {
      return undefined;
    }

    if (!response.ok) {
      throw new Error(
        `Failed to fetch workflow run: ${response.status} ${response.statusText}`,
      );
    }

    return await response.json();
  }

  async listArtifacts(runId: number): Promise<Artifact[]> {
    const url =
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${runId}/artifacts`;

    const response = await this.#fileFetcher.get(url, this.#getHeaders());

    if (!response.ok) {
      throw new Error(
        `Failed to list artifacts: ${response.status} ${response.statusText}`,
      );
    }

    const data: ArtifactsListResponse = await response.json();
    return data.artifacts;
  }

  async downloadArtifact(archiveDownloadUrl: string): Promise<Blob> {
    const response = await this.#fileFetcher.get(
      archiveDownloadUrl,
      this.#getHeaders(),
    );

    if (!response.ok) {
      throw new Error(
        `Failed to download artifact: ${response.status} ${response.statusText}`,
      );
    }

    return await response.blob();
  }

  async listJobs(runId: number): Promise<WorkflowJob[]> {
    const url =
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${runId}/jobs`;

    const response = await this.#fileFetcher.get(url, this.#getHeaders());

    if (!response.ok) {
      throw new Error(
        `Failed to list jobs: ${response.status} ${response.statusText}`,
      );
    }

    const data: JobsListResponse = await response.json();
    return data.jobs;
  }
}
