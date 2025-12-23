import { defineStore } from "@david/service-store";
import {
  TestResultsDownloader,
  TestResultArtifactStore,
} from "./lib/test-results-downloader.ts";
import { RunsFetcher } from "./lib/runs-fetcher.ts";
import { GitHubApiClient } from "./lib/github-api-client.ts";
import { App, staticFiles } from "fresh";
import { ConfigProvider } from "./config.ts";
import { InsightsPageController } from "./routes/insights.tsx";
import { HomePageController } from "./routes/index.tsx";
import { RunPageController } from "./routes/results/[runId].tsx";

export interface AppState {
  store: AppStore;
}

const configProvider = new ConfigProvider();

// services that live for the duration of the application
const appStore = defineStore()
  .add("testResultArtifactStore", () => {
    return new TestResultArtifactStore();
  })
  .add("githubClient", () => {
    return new GitHubApiClient(configProvider.githubToken);
  })
  .add("testResultsDownloader", (store) => {
    return new TestResultsDownloader(
      store.get("testResultArtifactStore"),
      store.get("githubClient"),
    );
  })
  .finalize();

export type AppStore = ReturnType<typeof createRequestStore>;

function createRequestStore() {
  // services that live for the duration of a request
  return appStore.createChild()
    .add("runsFetcher", (store) => {
      return new RunsFetcher(store.get("githubClient"));
    })
    .add("controller.homePage", (store) => {
      return new HomePageController(store.get("runsFetcher"));
    })
    .add("controller.insights", (store) => {
      return new InsightsPageController(store.get("githubClient"), store.get("testResultsDownloader"));
    })
    .add("controller.runPage", (store) => {
      return new RunPageController(store.get("githubClient"), store.get("testResultsDownloader"));
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
