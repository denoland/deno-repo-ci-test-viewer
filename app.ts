import { createDefine } from "fresh";
import { defineStore } from "@david/service-store";
import {
  TestResultsDownloader,
  TestResultArtifactStore,
} from "./lib/test-results-downloader.ts";
import { RunsFetcher } from "./lib/runs-fetcher.ts";
import { GitHubApiClient } from "./lib/github-api-client.ts";
import { App, staticFiles } from "fresh";
import { ConfigProvider } from "./config.ts";
import { LoggerFactory } from "./logger.ts";

export interface State {
  store: AppStore;
}

export const define = createDefine<State>();
const configProvider = new ConfigProvider();

// services that live for the duration of the application
const appStore = defineStore()
  .add("loggerFactory", () => {
    return new LoggerFactory();
  })
  .add("testResultArtifactStore", () => {
    return new TestResultArtifactStore();
  })
  .finalize();

export type AppStore = ReturnType<typeof createRequestStore>;

function createRequestStore() {
  // services that live for the duration of a request
  return appStore.createChild()
    .add("logger", (store) => {
      return store.get("loggerFactory").getLogger();
    })
    .add("githubClient", () => {
      return new GitHubApiClient(configProvider.githubToken);
    })
    .add("downloader", (store) => {
      return new TestResultsDownloader(
        store.get("testResultArtifactStore"),
        store.get("githubClient"),
      );
    })
    .add("runsFetcher", (store) => {
      return new RunsFetcher(store.get("githubClient"));
    })
    .finalize();
}

export const app = new App<State>();

app.use(staticFiles());

app.use(async (ctx) => {
  using scopedStore = createRequestStore();
  ctx.state.store = scopedStore;
  return await ctx.next();
});
app.fsRoutes();
