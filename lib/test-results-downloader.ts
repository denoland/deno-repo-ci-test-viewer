import {
  BlobReader,
  BlobWriter,
  type FileEntry,
  ZipReader,
} from "@zip-js/zip-js";
import { type Artifact, GitHubApiClient } from "./github-api-client.ts";
import { LruCache } from "@std/cache/lru-cache";
import { AsyncValue } from "./utils/async-value.ts";

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

interface ParsedTestResultArtifact {
  name: string;
  tests: RecordedTestResult[];
}

export class TestResultArtifactStore
  extends LruCache<string, AsyncValue<ParsedTestResultArtifact>> {
  constructor() {
    super(100);
  }
}

export class TestResultsDownloader {
readonly #store: TestResultArtifactStore;
  readonly #githubClient: GitHubApiClient;

  constructor(store: TestResultArtifactStore, githubClient: GitHubApiClient) {
    this.#store = store;
    this.#githubClient = githubClient;
  }

  async downloadForRunId(runId: number): Promise<ParsedTestResultArtifact[]> {
    const artifacts = await this.#githubClient.listArtifacts(runId);

    const matchingArtifacts = artifacts.filter((artifact) =>
      ARTIFACT_PATTERN.test(artifact.name)
    );
    const downloads = await Promise.all(
      matchingArtifacts.map((artifact) => this.#downloadArtifact(artifact)),
    );

    return downloads;
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

        // Extract the ZIP file using @zip-js/zip-js
        const zipReader = new ZipReader(new BlobReader(blob));
        const entries = await zipReader.getEntries();

        // GitHub artifacts should contain a single file with the same name as the artifact
        // Find the JSON file inside the ZIP
        const jsonEntry = entries.find((entry) =>
          !entry.directory &&
          (entry.filename.endsWith(".json") || entry.filename === artifact.name)
        ) as FileEntry | undefined;

        if (!jsonEntry) {
          throw new Error(
            `No JSON file found in artifact "${artifact.name}"`,
          );
        }

        // Extract the file data
        const blobWriter = new BlobWriter();
        const fileBlob = await jsonEntry.getData(blobWriter);
        const fileData = new Uint8Array(await fileBlob.arrayBuffer());

        await zipReader.close();

        const text = new TextDecoder().decode(fileData);
        const data = JSON.parse(text);
        return {
          name: artifact.name.replace(/^test-results-/, "")
            .replace(/.json$/, ""),
          tests: data.tests as RecordedTestResult[],
        };
      });
      this.#store.set(artifact.archive_download_url, value);
    }
    return value.get();
  }
}
