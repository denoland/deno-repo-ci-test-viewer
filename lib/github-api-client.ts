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

export class GitHubApiClient {
  readonly #token: string;

  constructor(token: string) {
    this.#token = token;
  }

  #getHeaders(): HeadersInit {
    return {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Authorization": `Bearer ${this.#token}`,
    };
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

    const response = await fetch(url, {
      headers: this.#getHeaders(),
    });

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
    const response = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${runId}`,
      {
        headers: this.#getHeaders(),
      },
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

    const response = await fetch(url, {
      headers: this.#getHeaders(),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to list artifacts: ${response.status} ${response.statusText}`,
      );
    }

    const data: ArtifactsListResponse = await response.json();
    return data.artifacts;
  }

  async downloadArtifact(archiveDownloadUrl: string): Promise<Blob> {
    const response = await fetch(archiveDownloadUrl, {
      headers: this.#getHeaders(),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to download artifact: ${response.status} ${response.statusText}`,
      );
    }

    return await response.blob();
  }
}
