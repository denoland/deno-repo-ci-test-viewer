import { GitHubApiClient, type WorkflowRun } from "./github-api-client.ts";
import { ExtractInterface } from "./types.ts";

export type { WorkflowRun };

export type RunsFetcher = ExtractInterface<RealRunsFetcher>;

export class RealRunsFetcher {
  readonly #githubClient: GitHubApiClient;

  constructor(githubClient: GitHubApiClient) {
    this.#githubClient = githubClient;
  }

  async fetchRecentRuns(
    perPage = 30,
    page = 1,
  ): Promise<{ runs: WorkflowRun[]; totalCount: number }> {
    const result = await this.#githubClient.listWorkflowRuns(perPage, page);

    // Filter to only "ci" workflow runs
    const filteredRuns = result.runs.filter(
      (run) => run.name.toLowerCase() === "ci",
    );

    return {
      runs: filteredRuns,
      totalCount: result.totalCount,
    };
  }
}
