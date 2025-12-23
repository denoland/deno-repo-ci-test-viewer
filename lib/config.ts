export class ConfigProvider {
  #githubToken: string | undefined;

  get githubToken() {
    return this.#githubToken ??
      (this.#githubToken = Deno.env.get("GITHUB_TOKEN"));
  }
}
