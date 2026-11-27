export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface QueryRequest {
  question: string;
  top_k?: number;
  prompt_variant?: 'qa' | 'summarize' | null;
  /** Earlier turns, oldest first (ignored by backends that predate it). */
  history?: ChatMessage[];
  /** Only answer from these documents (source picker); omitted = all. */
  document_ids?: string[];
}

export interface Source {
  document_title: string | null;
  source_path: string;
  chunk_summary: string;
  page_numbers: number[];
  similarity_score: number;
  /** Short excerpt of the chunk (newer backends only). */
  snippet?: string;
}

export interface LatencyBreakdown {
  retrieval_ms: number;
  context_ms: number;
  generation_ms: number;
  total_ms: number;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface QueryResponse {
  answer: string;
  sources: Source[];
  latency: LatencyBreakdown;
  token_usage: TokenUsage;
  prompt_version: string;
  query_log_id: string | null;
  /** Model that produced the answer (newer backends only). */
  model?: string | null;
  coverage?: Coverage | null;
}

/** One NDJSON event from POST /query/stream. */
export type StreamEvent =
  | { type: 'sources'; sources: Source[]; prompt_version: string; coverage?: Coverage | null }
  | { type: 'delta'; text: string }
  | { type: 'status'; text: string }
  | {
      type: 'done';
      answer: string;
      latency: LatencyBreakdown;
      token_usage: TokenUsage;
      prompt_version: string;
      model: string | null;
      query_log_id: string | null;
      coverage?: Coverage | null;
    }
  | { type: 'error'; detail: string };

/** Overview answers: how many of the intended documents made it in. */
export interface Coverage {
  covered: number;
  total: number;
  missing: string[];
  mode: 'overview' | 'map_reduce';
}

export interface DocumentItem {
  id: string;
  title: string | null;
  source_path: string;
  chunk_count: number;
  created_at: string;
  has_summary?: boolean;
}

export interface DocumentsResponse {
  documents: DocumentItem[];
  total: number;
}

export interface FeedbackRequest {
  query_log_id: string | null;
  feedback_type: 'thumbs_up' | 'thumbs_down' | 'correction';
  rating?: number;
  correction?: string;
  query_text?: string;
}

export interface FeedbackResponse {
  id: string;
  created_at: string;
}

export interface EvaluationSummary {
  total_feedback: number;
  positive_rate: number;
  avg_rating: number | null;
  counts_by_type: Record<string, number>;
  since: string | null;
}

export interface HealthResponse {
  status: string;
  database: string;
}

export interface UploadJobResponse {
  job_id: string;
}

export type UploadStage =
  | 'queued'
  | 'loading'
  | 'saving'
  | 'embedding'
  | 'indexing'
  | 'summarizing'
  | 'complete'
  | 'error';

export interface UploadStatusResponse {
  job_id: string;
  stage: UploadStage;
  progress: number;
  error: string | null;
  document_id: string | null;
}
