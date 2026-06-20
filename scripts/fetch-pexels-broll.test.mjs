#!/usr/bin/env node

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { fetchPexelsBroll, pickPortraitRendition } from "./fetch-pexels-broll.mjs";

const tempRoot = mkdtempSync(resolve(tmpdir(), "raiz-pexels-test-"));
const calls = [];

try {
  const picked = pickPortraitRendition([
    { link: "landscape.mp4", width: 1920, height: 1080 },
    { link: "portrait-wide.mp4", width: 1200, height: 2200 },
    { link: "portrait-close.mp4", width: 1080, height: 1920 }
  ]);

  if (picked?.link !== "portrait-close.mp4") {
    throw new Error("Expected Pexels picker to prefer portrait rendition closest to 1080 width.");
  }

  const httpClient = {
    async get(url, options) {
      calls.push({ url, options });

      if (url.includes("/videos/search")) {
        return jsonResponse({
          videos: [
            {
              id: 101,
              video_files: [{ link: "https://video.example/valid.mp4", width: 1080, height: 1920 }]
            },
            {
              id: 102,
              video_files: [{ link: "https://video.example/not-video.mp4", width: 1080, height: 1920 }]
            },
            {
              id: 103,
              video_files: [{ link: "https://video.example/empty.mp4", width: 1080, height: 1920 }]
            }
          ]
        });
      }

      if (url.endsWith("/valid.mp4")) {
        return binaryResponse("fake-video-bytes", "video/mp4");
      }

      if (url.endsWith("/not-video.mp4")) {
        return binaryResponse("html", "text/html");
      }

      if (url.endsWith("/empty.mp4")) {
        return binaryResponse("", "video/mp4");
      }

      throw new Error(`Unexpected URL: ${url}`);
    }
  };

  const result = await fetchPexelsBroll({
    httpClient,
    query: "dark desk",
    count: 3,
    outDir: tempRoot,
    apiKey: "test-key",
    logger: silentLogger()
  });

  const validPath = resolve(tempRoot, "pexels-101.mp4");
  const invalidTypePath = resolve(tempRoot, "pexels-102.mp4");
  const emptyPath = resolve(tempRoot, "pexels-103.mp4");

  if (result.saved.length !== 1 || result.saved[0] !== validPath || readFileSync(validPath, "utf8") !== "fake-video-bytes") {
    throw new Error("Expected fetchPexelsBroll to write only the valid video response.");
  }

  if (existsSync(invalidTypePath) || existsSync(emptyPath)) {
    throw new Error("Expected invalid Pexels downloads to be rejected before writing files.");
  }

  if (
    result.errors.length !== 2 ||
    !result.errors.some((error) => error.includes("content-type")) ||
    !result.errors.some((error) => error.includes("empty video response"))
  ) {
    throw new Error("Expected invalid Pexels responses to produce explicit errors.");
  }

  if (calls[0]?.options?.headers?.Authorization !== "test-key") {
    throw new Error("Expected injected HTTP client to receive the Pexels API key header.");
  }

  const skipped = await fetchPexelsBroll({
    httpClient,
    query: "unused",
    outDir: tempRoot,
    apiKey: "",
    logger: silentLogger()
  });

  if (skipped.skipped !== true || skipped.saved.length !== 0) {
    throw new Error("Expected missing Pexels API key to skip without network work.");
  }
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}

console.log("Validated Pexels b-roll fetcher with mocked HTTP.");

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: () => "application/json"
    },
    async json() {
      return body;
    }
  };
}

function binaryResponse(body, contentType) {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type" ? contentType : "";
      }
    },
    async arrayBuffer() {
      const buffer = Buffer.from(body);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
  };
}

function silentLogger() {
  return {
    log() {}
  };
}
