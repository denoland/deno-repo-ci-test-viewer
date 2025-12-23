import { ExtractInterface } from "./types.ts";

export type FileFetcher = ExtractInterface<RealFileFetcher>;

export class RealFileFetcher {
  get(url: string | URL, headers: HeadersInit) {
    return fetch(url, { headers });
  }
}
