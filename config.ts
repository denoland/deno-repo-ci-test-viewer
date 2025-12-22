export class ConfigProvider {
  #githubToken: string | undefined;

  get githubToken() {
    return this.#githubToken ??
      (this.#githubToken = getEnvOrThrow("GITHUB_TOKEN"));
  }
}

function getEnvOrThrow(name: string) {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Requires definition of env var: ${name}`);
  }
  return value;
}
