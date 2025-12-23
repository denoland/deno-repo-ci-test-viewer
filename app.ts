import { defineStore } from "@david/service-store";
import {
  LruTestResultArtifactStore,
  RealTestResultsDownloader,
  type TestResultArtifactStore,
  type TestResultsDownloader,
} from "./lib/test-results-downloader.ts";
import { RealRunsFetcher, type RunsFetcher } from "./lib/runs-fetcher.ts";
import {
  type GitHubApiClient,
  RealGitHubApiClient,
} from "./lib/github-api-client.ts";
import { ConfigProvider } from "./config.ts";
import { LoggerFactory } from "./logger.ts";
import { InsightsPageController } from "./routes/insights.tsx";
import { HomePageController } from "./routes/index.tsx";
import { RunPageController } from "./routes/results/[runId].tsx";
import { type FileFetcher, RealFileFetcher } from "./lib/file-fetcher.ts";
import {
  type ArtifactParser,
  ZipArtifactParser,
} from "./lib/artifact-parser.ts";

export interface AppState {
  store: AppStore;
}

export type AppStore = ReturnType<typeof createRequestStore>;

const configProvider = new ConfigProvider();

// services that live for the duration of the application
const appStore = defineStore()
  .add("loggerFactory", () => {
    return new LoggerFactory();
  })
  .add("artifactParser", (): ArtifactParser => {
    return new ZipArtifactParser();
  })
  .add("testResultArtifactStore", (): TestResultArtifactStore => {
    return new LruTestResultArtifactStore();
  })
  .add("fileFetcher", (): FileFetcher => {
    return new RealFileFetcher();
  })
  .add("githubClient", (store): GitHubApiClient => {
    return new RealGitHubApiClient(
      store.get("fileFetcher"),
      configProvider.githubToken,
    );
  })
  .add("testResultsDownloader", (store): TestResultsDownloader => {
    return new RealTestResultsDownloader(
      store.get("artifactParser"),
      store.get("githubClient"),
      store.get("testResultArtifactStore"),
    );
  })
  .finalize();

export function createRequestStore() {
  // services that live for the duration of a request
  return appStore.createChild()
    .add("logger", (store) => {
      return store.get("loggerFactory").getRequestLogger();
    })
    .add("runsFetcher", (store): RunsFetcher => {
      return new RealRunsFetcher(store.get("githubClient"));
    })
    .add("controller.homePage", (store) => {
      return new HomePageController(store.get("runsFetcher"));
    })
    .add("controller.insights", (store) => {
      return new InsightsPageController(
        store.get("logger"),
        store.get("githubClient"),
        store.get("testResultsDownloader"),
      );
    })
    .add("controller.runPage", (store) => {
      return new RunPageController(
        store.get("githubClient"),
        store.get("testResultsDownloader"),
      );
    })
    .finalize();
}
