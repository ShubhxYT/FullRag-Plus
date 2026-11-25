import axios, { isAxiosError } from 'axios';
import type {
  QueryRequest,
  QueryResponse,
  DocumentsResponse,
  FeedbackRequest,
  FeedbackResponse,
  EvaluationSummary,
  HealthResponse,
  UploadJobResponse,
  UploadStatusResponse,
  StreamEvent,
} from './types';

const client = axios.create({ baseURL: '/api' });

/**
 * Turn an API error into something a user can act on. FastAPI puts the reason
 * in `detail` (a string, or a list of validation errors for 422s).
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (isAxiosError(error)) {
    if (!error.response) {
      return 'Could not reach the FullRag API. Check your connection or try again in a moment.';
    }
    const { status, data } = error.response;
    const detail = (data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (Array.isArray(detail) && detail.length) {
      return detail
        .map((d) => (typeof d === 'object' && d && 'msg' in d ? String((d as { msg: unknown }).msg) : String(d)))
        .join('; ');
    }
    if (status === 413) return 'That file is too large to upload.';
    if (status === 502 || status === 504) {
      return 'The FullRag backend is not responding right now. Please try again shortly.';
    }
    return `Request failed (HTTP ${status}).`;
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong.';
}

export async function fetchHealth(): Promise<HealthResponse> {
  const { data } = await client.get<HealthResponse>('/health');
  return data;
}

export async function submitQuery(req: QueryRequest, signal?: AbortSignal): Promise<QueryResponse> {
  const { data } = await client.post<QueryResponse>('/query', req, { signal });
  return data;
}

/** Thrown when the backend has no /query/stream endpoint (older deploys). */
export class StreamUnsupportedError extends Error {
  constructor() {
    super('Streaming is not supported by this backend');
    this.name = 'StreamUnsupportedError';
  }
}

/** Error with a user-facing message from the API. */
export class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * POST /query/stream and feed each NDJSON event to onEvent. Resolves when the
 * stream ends; rejects with ApiError on an error event / HTTP error, or with
 * StreamUnsupportedError if the backend predates streaming (404/405).
 */
export async function streamQuery(
  req: QueryRequest,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/query/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify(req),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('Could not reach the FullRag API. Check your connection or try again in a moment.');
  }
  if (res.status === 404 || res.status === 405) throw new StreamUnsupportedError();
  if (!res.ok || !res.body) {
    let detail = `Request failed (HTTP ${res.status}).`;
    try {
      const body = await res.json();
      if (typeof body?.detail === 'string') detail = body.detail;
      else if (Array.isArray(body?.detail)) detail = body.detail.map((d: { msg?: string }) => d.msg ?? String(d)).join('; ');
    } catch {
      if (res.status === 502 || res.status === 504) {
        detail = 'The FullRag backend is not responding right now. Please try again shortly.';
      }
    }
    throw new ApiError(detail, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let event: StreamEvent;
    try {
      event = JSON.parse(line) as StreamEvent;
    } catch {
      return; // ignore keep-alives / partial garbage
    }
    if (event.type === 'error') throw new ApiError(event.detail);
    onEvent(event);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      handleLine(line);
    }
  }
  handleLine(buffer + decoder.decode());
}

export async function fetchDocuments(): Promise<DocumentsResponse> {
  const { data } = await client.get<DocumentsResponse>('/documents');
  return data;
}

export async function submitFeedback(req: FeedbackRequest): Promise<FeedbackResponse> {
  const { data } = await client.post<FeedbackResponse>('/feedback', req);
  return data;
}

export async function fetchEvaluationSummary(since?: string): Promise<EvaluationSummary> {
  const params = since ? { since } : {};
  const { data } = await client.get<EvaluationSummary>('/evaluation/summary', { params });
  return data;
}

export async function uploadDocument(
  file: File,
  onProgress: (pct: number) => void,
): Promise<UploadJobResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await client.post<UploadJobResponse>('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress(event) {
      if (event.total) {
        onProgress(Math.round((event.loaded / event.total) * 20));
      }
    },
  });
  return data;
}

export async function getUploadStatus(jobId: string): Promise<UploadStatusResponse> {
  const { data } = await client.get<UploadStatusResponse>(`/upload/${jobId}/status`);
  return data;
}
