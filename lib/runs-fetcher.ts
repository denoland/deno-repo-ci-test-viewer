import { GitHubApiClient, type WorkflowRun } from "./github-api-client.ts";

export type { WorkflowRun };

export class RunsFetcher {
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
