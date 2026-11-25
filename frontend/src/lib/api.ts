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
} from './types';

const client = axios.create({ baseURL: '/api' });

/**
 * Turn an API error into something a user can act on. FastAPI puts the reason
 * in `detail` (a string, or a list of validation errors for 422s).
 */
export function getErrorMessage(error: unknown): string {
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

export async function submitQuery(req: QueryRequest): Promise<QueryResponse> {
  const { data } = await client.post<QueryResponse>('/query', req);
  return data;
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
