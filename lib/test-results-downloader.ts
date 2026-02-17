import type { Artifact, GitHubApiClient } from "./github-api-client.ts";
import { LruCache } from "@std/cache/lru-cache";
import { AsyncValue } from "./utils/async-value.ts";
import type { ExtractInterface } from "./types.ts";
import type { ArtifactParser } from "./artifact-parser.ts";

const ARTIFACT_PATTERN = /^test-results-.*\.json$/;

export interface RecordedTestResult {
  name: string;
  path: string;
  duration?: number;
  failed?: true;
  ignored?: true;
  flakyCount?: number;
  subTests?: RecordedTestResult[];
}

export interface JobTestResults {
  name: string;
  tests: RecordedTestResult[];
}

export interface ParsedTestResultArtifact {
  name: string;
  tests: RecordedTestResult[];
}

export interface TestResultArtifactStore {
  get(key: string): AsyncValue<ParsedTestResultArtifact> | undefined;
  set(key: string, value: AsyncValue<ParsedTestResultArtifact>): void;
}

export class LruTestResultArtifactStore
  extends LruCache<string, AsyncValue<ParsedTestResultArtifact>> {
  constructor() {
    super(200);
  }
}

export type TestResultsDownloader = ExtractInterface<RealTestResultsDownloader>;

export class RealTestResultsDownloader {
  readonly #artifactParser: ArtifactParser;
  readonly #githubClient: Pick<
    GitHubApiClient,
    "listArtifacts" | "downloadArtifact"
  >;
  readonly #store: TestResultArtifactStore;

  constructor(
    artifactParser: ArtifactParser,
    githubClient: Pick<GitHubApiClient, "listArtifacts" | "downloadArtifact">,
    store: TestResultArtifactStore,
  ) {
    this.#artifactParser = artifactParser;
    this.#githubClient = githubClient;
    this.#store = store;
  }

  async downloadForRunId(runId: number): Promise<ParsedTestResultArtifact[]> {
    const artifacts = await this.#githubClient.listArtifacts(runId);

    const matchingArtifacts = artifacts.filter((artifact) =>
      ARTIFACT_PATTERN.test(artifact.name)
    );
    const downloads = await Promise.all(
      matchingArtifacts.map((artifact) => this.#downloadArtifact(artifact)),
    );

    return mergeArtifactsByJob(downloads);
  }

  #downloadArtifact(
    artifact: Artifact,
  ): Promise<ParsedTestResultArtifact> {
    let value = this.#store.get(artifact.archive_download_url);
    if (!value) {
      value = new AsyncValue(async () => {
        const blob = await this.#githubClient.downloadArtifact(
          artifact.archive_download_url,
        );
        return await this.#artifactParser.parse(artifact.name, blob);
      });
      this.#store.set(artifact.archive_download_url, value);
    }
    return value.get();
  }
}

/**
 * Merges artifacts that belong to the same job. Artifacts follow the naming
 * pattern `{os}-{arch}-{build_type}-{suite}` (e.g. `linux-x86_64-debug-integration`).
 * This groups by the first three segments (os-arch-build_type) and concatenates
 * tests from each suite. Old-style names without suite segments are left as-is.
 */
function mergeArtifactsByJob(
  artifacts: ParsedTestResultArtifact[],
): ParsedTestResultArtifact[] {
  const groups = new Map<string, RecordedTestResult[]>();
  const groupOrder: string[] = [];

  for (const artifact of artifacts) {
    const parts = artifact.name.split("-");
    // new-style: os-arch-build_type-suite (4+ segments)
    // old-style: os (1 segment, e.g. "linux")
    const key = parts.length >= 4 ? parts.slice(0, 3).join("-") : artifact.name;

    const existing = groups.get(key);
    if (existing) {
      existing.push(...artifact.tests);
    } else {
      groupOrder.push(key);
      groups.set(key, [...artifact.tests]);
    }
  }

  return groupOrder.map((key) => ({
    name: key,
    tests: groups.get(key)!,
  }));
}
