import { createDefine } from "fresh";
import { defineStore } from "@david/service-store";
import { ArtifactDownloder } from "./lib/artifact-downloader.ts";
import { TestResultsDownloader } from "./lib/test-results-downloader.ts";
import { RunsFetcher } from "./lib/runs-fetcher.ts";
import { GitHubApiClient } from "./lib/github-api-client.ts";

// This specifies the type of "ctx.state" which is used to share
// data among middlewares, layouts and routes.
export interface State {
  store: AppStore;
}

export const define = createDefine<State>();

const staticStore = defineStore()
  .add("githubClient", () => {
    return new GitHubApiClient(getEnvOrThrow("GITHUB_TOKEN"));
  })
  .add("downloader", (store) => {
    return new TestResultsDownloader(
      new ArtifactDownloder(store.get("githubClient")),
    );
  })
  .add("runsFetcher", (store) => {
    return new RunsFetcher(store.get("githubClient"));
  })
  .finalize();

export type AppStore = ReturnType<typeof createScopedStore>;

export function createScopedStore() {
  return staticStore.createChild().finalize();
}

function getEnvOrThrow(name: string) {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Requires definition of env var: ${name}`);
  }
  return value;
}
