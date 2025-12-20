import { LruCache } from "@std/cache/lru-cache";
import { AsyncValue } from "./utils/async-value.ts";
import { ArtifactDownloder } from "./artifact-downloader.ts";

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

export class TestResultsDownloader {
  #downloader: ArtifactDownloder;
  #cache: LruCache<number, AsyncValue<JobTestResults[]>>;

  constructor(downloader: ArtifactDownloder) {
    this.#downloader = downloader;
    this.#cache = new LruCache(10);
  }

  downloadForRunId(runId: number): Promise<JobTestResults[]> {
    let value = this.#cache.get(runId);
    if (!value) {
      value = new AsyncValue((async () => {
        const artifacts = await this.#downloader.downloadForRunId(runId);
        return artifacts.map((artifact): JobTestResults => {
          // Data is already extracted from the ZIP file
          const text = new TextDecoder().decode(artifact.data);
          const data = JSON.parse(text);
          return {
            name: artifact.name.replace(/^test-results-/, "")
              .replace(/.json$/, ""),
            tests: data.tests,
          };
        });
      })());
      this.#cache.set(runId, value);
    }
    return value.get();
  }
}
