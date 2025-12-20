import {
  BlobReader,
  BlobWriter,
  type FileEntry,
  ZipReader,
} from "@zip-js/zip-js";
import { type Artifact, GitHubApiClient } from "./github-api-client.ts";

const ARTIFACT_PATTERN = /^test-results-.*\.json$/;

export interface DownloadedArtifact {
  name: string;
  data: Uint8Array;
  size: number;
  filename: string;
}

export class ArtifactDownloder {
  readonly #githubClient: GitHubApiClient;

  constructor(githubClient: GitHubApiClient) {
    this.#githubClient = githubClient;
  }

  async downloadForRunId(runId: number): Promise<DownloadedArtifact[]> {
    const artifacts = await this.#githubClient.listArtifacts(runId);

    const matchingArtifacts = artifacts.filter((artifact) =>
      ARTIFACT_PATTERN.test(artifact.name)
    );
    const downloads = await Promise.all(
      matchingArtifacts.map((artifact) => this.#downloadArtifact(artifact)),
    );

    return downloads;
  }

  async #downloadArtifact(
    artifact: Artifact,
  ): Promise<DownloadedArtifact> {
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

    return {
      name: artifact.name,
      data: fileData,
      size: fileData.length,
      filename: jsonEntry.filename,
    };
  }
}
