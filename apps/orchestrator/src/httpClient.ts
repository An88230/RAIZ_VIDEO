export interface HttpResponse {
  status: number;
  ok: boolean;
  body: unknown;
}

export interface HttpClientPostOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface HttpClient {
  post(url: string, body: unknown, options?: HttpClientPostOptions): Promise<HttpResponse>;
}

export function createFetchHttpClient(): HttpClient {
  return {
    async post(url, body, options = {}) {
      const controller = new AbortController();
      const timeout = options.timeoutMs
        ? setTimeout(() => controller.abort(new Error(`HTTP request timed out after ${options.timeoutMs}ms.`)), options.timeoutMs)
        : null;

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: options.headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });
        const responseText = await response.text();

        return {
          status: response.status,
          ok: response.ok,
          body: parseResponseBody(responseText)
        };
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }
    }
  };
}

function parseResponseBody(responseText: string): unknown {
  if (!responseText.trim()) {
    return null;
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}
