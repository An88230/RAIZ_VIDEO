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
