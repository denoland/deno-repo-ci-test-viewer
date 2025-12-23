import { defineStore } from "@david/service-store";
import {
  LruTestResultArtifactStore,
  RealTestResultsDownloader,
  TestResultArtifactStore,
  TestResultsDownloader,
} from "./lib/test-results-downloader.ts";
import { RealRunsFetcher, RunsFetcher } from "./lib/runs-fetcher.ts";
import {
  GitHubApiClient,
  RealGitHubApiClient,
} from "./lib/github-api-client.ts";
import { App, staticFiles } from "fresh";
import { ConfigProvider } from "./config.ts";
import { InsightsPageController } from "./routes/insights.tsx";
import { HomePageController } from "./routes/index.tsx";
import { RunPageController } from "./routes/results/[runId].tsx";
import { FileFetcher, RealFileFetcher } from "./lib/file-fetcher.ts";
import { ArtifactParser, ZipArtifactParser } from "./lib/artifact-parser.ts";

export interface AppState {
  store: AppStore;
}

const configProvider = new ConfigProvider();

// services that live for the duration of the application
const appStore = defineStore()
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

export type AppStore = ReturnType<typeof createRequestStore>;

function createRequestStore() {
  // services that live for the duration of a request
  return appStore.createChild()
    .add("runsFetcher", (store): RunsFetcher => {
      return new RealRunsFetcher(store.get("githubClient"));
    })
    .add("controller.homePage", (store) => {
      return new HomePageController(store.get("runsFetcher"));
    })
    .add("controller.insights", (store) => {
      return new InsightsPageController(
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

export const app = new App<AppState>();

app.use(staticFiles());

app.use(async (ctx) => {
  using scopedStore = createRequestStore();
  ctx.state.store = scopedStore;
  return await ctx.next();
});
app.fsRoutes();
