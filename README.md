# FullRag-Plus

A production-ready Retrieval-Augmented Generation (RAG) system combining a FastAPI Python backend with a React TypeScript frontend, backed by PostgreSQL + pgvector for semantic search.

**Live demo:** [rag-ui.shubhsomani.tech](https://rag-ui.shubhsomani.tech) · **API:** [rag.shubhsomani.tech](https://rag.shubhsomani.tech/health) ([interactive docs](https://rag.shubhsomani.tech/docs))

Upload PDF, DOCX, HTML or Markdown files in the Library, then ask questions in a streaming chat with numbered citations. Conversations are saved in your browser (History), and documents can be deleted again from the Library.


## Architecture

![Architecture](architecture.png)

## System Preview Image

![FullRag Architecture](backend/fullrag-architecture.png)

**Request flow:** User query → React UI → FastAPI `/query` → routing (search / named documents / overview / map-reduce) → pgvector search + local reranker + MMR → LLM generation (OpenCode Go `deepseek-v4.1-flash`, Groq as fallback, or Gemini) → answer with sources returned to UI.

**Retrieval details:**

- **Embeddings:** chunks are embedded with `BAAI/bge-base-en-v1.5` together with their document name and section path, so questions that name a document ("my modules", "module 5") find it.
- **Ordinary questions:** 40 candidates from pgvector → local cross-encoder reranker (`cross-encoder/ms-marco-MiniLM-L-6-v2`, free, CPU) → MMR for diversity with at most 3 chunks per document → `top_k` chunks.
- **Questions that name documents** ("module 3", "the huffman notes"): the series word can sit anywhere in the file name (`DAA_DSE3101-Module 3.pdf`). Those documents are searched first, then the answer is topped up from the others.
- **Overview questions** ("list all modules with topics", "go through all the sources…"): when the question is corpus-wide, or the library has ≤ `SMALL_LIBRARY_DOCS` documents, **every** document is included, sorted by file name. Each one is represented by its stored summary plus every non-generic heading, within its own budget (`OVERVIEW_CONTEXT_TOKENS`). If not everything fits, the answer ends with **"Covered X of N documents"** and lists what was left out.
- **Summarize everything** ("summarize all the documents"): map-reduce. One LLM call per document (in parallel, `MAP_REDUCE_CONCURRENCY`), then one combined answer. The stream sends `status` events ("Read 5 of 23 documents…") while it works.
- **Follow-ups** ("and its complexity?") are rewritten by the LLM into a standalone search query.
- **Source picker:** `document_ids` in the request (or the picker under the search box) limits every path to those documents.
- **Per-document summaries** are written at upload (one LLM call). Documents that have none are filled in the background at startup, or by `python -m ingestion.summaries --missing`. This only writes `documents.summary`; chunks and embeddings are never touched.
- When nothing scores above `INSUFFICIENT_THRESHOLD`, the answer says the documents don't cover it.

## Repository Structure

```
FullRag-Plus/
├── backend/                    # Python FastAPI backend (fullrag-plus-backend)
│   ├── api/                    # FastAPI app: main.py + routes/
│   │   └── routes/             #   health, documents, query, evaluation
│   ├── config/                 # Settings loaded from .env
│   ├── database/               # SQLAlchemy models, repository, seed
│   ├── embeddings/             # Embedding service (sentence-transformers)
│   ├── generation/             # LLM generation pipeline (OpenCode Go / Groq / Gemini)
│   ├── ingestion/              # Document ingestion and chunking pipeline
│   ├── pipeline/               # RAG orchestration (retrieval + generation)
│   ├── retrieval/              # pgvector similarity search
│   ├── evaluation/             # Continuous evaluation loop + metrics
│   ├── observability/          # Structured logging + tracing
│   ├── streamlit_app/          # Admin debug dashboard
│   ├── alembic/                # Database migrations
│   ├── data/                   # Transcript fallback (data/transcript.md)
│   ├── test/                   # pytest test suite
│   ├── pyproject.toml          # Python dependencies (managed by uv)
│   ├── uv.lock                 # Locked Python dependencies
│   ├── alembic.ini             # Alembic migration config
│   └── Dockerfile              # Backend container
├── frontend/                   # React + TypeScript frontend (fullrag-plus)
│   ├── src/
│   │   ├── main.tsx            # App entry point
│   │   ├── App.tsx             # Routes: Home, Results, Library
│   │   ├── lib/                # API client (axios) + TypeScript types
│   │   ├── pages/              # Home, Results, Library pages
│   │   └── components/         # Layout, search, results, library components
│   ├── public/                 # Static assets
│   ├── index.html              # HTML shell (dark mode, Manrope/Inter fonts)
│   ├── package.json
│   ├── vite.config.ts          # Dev server port 5173, proxy /api → :8001
│   ├── tailwind.config.js      # Material Design 3 dark theme tokens
│   ├── nginx.conf              # Production nginx (SPA + /api proxy)
│   └── Dockerfile              # Multi-stage: node:20-alpine + nginx:alpine
├── .env.example                # All environment variable templates
├── .gitignore
├── docker-compose.yml          # PostgreSQL + backend + frontend (nginx)
├── Makefile                    # Developer convenience targets
└── README.md
```

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Python | 3.12+ | [python.org](https://www.python.org) |
| uv | latest | `pip install uv` |
| Node.js | 20+ | [nodejs.org](https://nodejs.org) |
| Docker | 20+ | [docker.com](https://www.docker.com) |
| Docker Compose | v2 | Included with Docker Desktop |

**API Keys required (at least one LLM provider):**
- **Google Gemini:** [aistudio.google.com](https://aistudio.google.com) → Create API key
- **Groq:** [console.groq.com](https://console.groq.com) → Create API key

## Quick Start (Local Development)

```bash
# 1. Clone and enter the repo
git clone <repo-url> FullRag-Plus
cd FullRag-Plus

# 2. Set up environment variables
cp .env.example .env
# Edit .env and fill in GEMINI_API_KEY and/or GROQ_API_KEY

# 3. Install all dependencies
make install

# 4. Start the database
make dev-db

# 5. Run database migrations
make migrate

# 6. Start both dev servers (in separate terminals for best experience)
# Terminal 1:
make dev-backend    # FastAPI at http://localhost:8001

# Terminal 2:
make dev-frontend   # React at http://localhost:5173
```

Open **http://localhost:5173** in your browser.

## Docker Production

```bash
# 1. Set up environment variables
cp .env.example .env
# Edit .env — set real API keys

# 2. Build and start all services
docker compose up --build

# Services started:
#   PostgreSQL + pgvector  →  localhost:5432
#   FastAPI backend        →  localhost:8001
#   React frontend (nginx) →  localhost:80
```

Open **http://localhost** in your browser.

The backend container automatically runs `alembic upgrade head` on startup before launching the API server.

## Make Targets

| Command | Description |
|---------|-------------|
| `make install` | Install Python (`uv sync`) and Node (`npm install`) dependencies |
| `make dev-db` | Start PostgreSQL container in the background |
| `make dev-backend` | Start FastAPI with hot-reload on port 8001 |
| `make dev-frontend` | Start Vite dev server on port 5173 |
| `make dev` | Start all (db + backend + frontend concurrently) |
| `make migrate` | Run Alembic migrations (`alembic upgrade head`) |
| `make build` | Build frontend production bundle to `frontend/dist/` |
| `make test` | Run pytest test suite in `backend/test/` |
| `make streamlit` | Start Streamlit admin dashboard on port 8501 |
| `make clean` | Remove `frontend/dist/` and `__pycache__/` directories |

## API Reference

Base URL (local dev): `http://localhost:8001` · live: `https://rag.shubhsomani.tech`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check — returns DB connection status |
| `GET` | `/documents` | List all ingested documents with chunk counts |
| `POST` | `/upload` | Upload a document (PDF, DOCX, HTML, MD; 50 MB); returns a `job_id` |
| `GET` | `/upload/{job_id}/status` | Ingestion progress for an upload |
| `DELETE` | `/documents/{id}` | Delete a document with its chunks and embeddings (404 unknown, 409 still processing) |
| `POST` | `/documents/delete` | Bulk delete: `{"ids": [...]}` → `deleted`, `not_found` |
| `POST` | `/query` | Submit a RAG query — returns answer + sources (optional `history` for follow-ups) |
| `POST` | `/query/stream` | Same, streamed as NDJSON: `status`… → `sources` → `delta`… → `done` (or `error`) |
| `POST` | `/feedback` | Submit user feedback on a query result |
| `GET` | `/evaluation/summary` | Get evaluation metrics summary |

### Query Request/Response

```json
// POST /query
{
  "question": "go through all the sources and list all modules with topics in them",
  "top_k": 5,
  "history": [],              // earlier turns, oldest first (optional)
  "document_ids": null        // limit to these documents (optional; null = all)
}

// Response
{
  "answer": "## Module 1 ... [3]",
  "sources": [{ "source_path": "DAA_DSE3101-Module 1.pdf", "similarity_score": 0.0, "snippet": "..." }],
  "latency": { "retrieval_ms": 90, "generation_ms": 40000, "total_ms": 40100 },
  "token_usage": { "prompt_tokens": 21056, "completion_tokens": 4341, "total_tokens": 25397 },
  "prompt_version": "overview_v1",
  "model": "deepseek-v4.1-flash",
  "coverage": { "covered": 23, "total": 23, "missing": [], "mode": "overview" },  // overview / map-reduce only
  "query_log_id": "uuid"
}
```

## Environment Variables

All variables are read from `.env` in the project root (Docker Compose) or `backend/.env` (local dev).

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `OPENCODE_API_KEY` | — | Yes* | OpenCode Go API key (default provider when set) |
| `GEMINI_API_KEY` | — | Yes* | Google Gemini API key |
| `GROQ_API_KEY` | — | Yes* | Groq API key (*one LLM key required); also the fallback for OpenCode |
| `DATABASE_URL` | `postgresql+psycopg://fullrag:fullrag@localhost:5432/fullrag` | Yes | PostgreSQL connection string |
| `GENERATION_PROVIDER` | auto | No | `opencode`, `groq` or `gemini`. Auto: `opencode` if `OPENCODE_API_KEY` is set, else `groq` if only a Groq key, else `gemini` |
| `OPENCODE_BASE_URL` | `https://opencode.ai/inference/go/openai/v1` | No | OpenCode Go OpenAI-compatible endpoint |
| `OPENCODE_MODEL` | `deepseek-v4.1-flash` | No | Model id from `curl https://opencode.ai/inference/go/v1/models` (~1M context) |
| `OPENCODE_FALLBACK_MODELS` | — | No | More OpenCode models to try before Groq |
| `OPENCODE_REASONING_EFFORT` | `low` | No | `low` / `high` / `max` (empty disables) |
| `GROQ_FALLBACK_ENABLED` | `true` | No | With `opencode`, fall back to the Groq chain when OpenCode fails |
| `GENERATION_MODEL` | `gemini-2.5-flash` | No | Gemini model name |
| `GENERATION_TEMPERATURE` | `0.3` | No | LLM sampling temperature |
| `GENERATION_MAX_TOKENS` | `8192` (opencode/gemini), `2048` (groq) | No | Maximum output tokens |
| `MAX_CONTEXT_TOKENS` | `128000` (opencode/gemini), `6000` (groq) | No | Context window budget for ordinary answers (75% used for chunks) |
| `OVERVIEW_CONTEXT_TOKENS` | `200000` (opencode/gemini), `4500` (groq) | No | Budget for overview / map-reduce context |
| `SMALL_LIBRARY_DOCS` | `40` | No | Libraries up to this size get every document in an overview answer |
| `MAP_REDUCE_CONCURRENCY` | `8` | No | Parallel per-document calls for "summarize everything" |
| `MAP_REDUCE_DOC_TOKENS` | `30000` | No | Most document text sent to one map call |
| `RERANKER` | `cross-encoder` | No | `cross-encoder` (local), `llm` (generation model) or `none` |
| `RERANKER_MODEL` | `cross-encoder/ms-marco-MiniLM-L-6-v2` | No | sentence-transformers CrossEncoder model |
| `RETRIEVAL_CANDIDATES` | `40` | No | Candidates fetched before rerank + MMR |
| `MMR_LAMBDA` | `0.7` | No | MMR relevance/diversity trade-off (1 = relevance only) |
| `QUERY_REWRITE_ENABLED` | `true` | No | LLM rewrite of follow-ups into standalone queries |
| `DOCUMENT_SUMMARIES_ENABLED` | `true` | No | Write a per-document summary at upload |
| `SUMMARY_BACKFILL_ON_STARTUP` | `true` | No | Fill missing summaries in the background at startup |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | No | Primary Groq model (must be available to your key) |
| `GROQ_FALLBACK_MODELS` | `openai/gpt-oss-20b,qwen/qwen3.8-27b` | No | Comma-separated models tried when the primary is missing or rate-limited |
| `GROQ_REASONING_EFFORT` | `low` | No | gpt-oss reasoning effort (low/medium/high) |
| `LOG_LEVEL` | `INFO` | No | `DEBUG` / `INFO` / `WARNING` / `ERROR` |
| `LOG_FORMAT` | `json` | No | `json` or `text` |
| `CACHE_TTL_SECONDS` | `3600` | No | Response cache TTL |
| `RESPONSE_CACHE_ENABLED` | `true` | No | Toggle response cache |
| `CONTINUOUS_EVAL_ENABLED` | `true` | No | Toggle background evaluation loop |
| `TRANSCRIPT_FALLBACK_ENABLED` | `true` | No | Enable transcript file fallback |
| `TRANSCRIPT_PATH` | `data/transcript.md` | No | Path to transcript fallback file |
| `INSUFFICIENT_THRESHOLD` | `0.45` | No | Below this best similarity the answer says the documents don't cover the question |

## Document Ingestion (CLI)

After setup, ingest documents through the backend CLI:

```bash
cd backend

# Ingest a PDF or text file
uv run python -m ingestion.cli ingest path/to/document.pdf

# Check ingestion status
uv run python -m ingestion.cli status

# Generate and store embeddings
uv run python -m embeddings.cli embed --all
```

## Streamlit Admin Dashboard

A debug/admin dashboard is available via Streamlit:

```bash
make streamlit
# Opens at http://localhost:8501
```

Features: document browser, query tester, evaluation metrics viewer, embedding cache inspector.

## Running Tests

```bash
make test

# Or with coverage:
cd backend && uv run pytest -v --tb=short
```

Test files are in `backend/test/` covering: database, embeddings, chunker, API endpoints, and continuous evaluation.

## Troubleshooting

**Database connection refused:**
```bash
make dev-db          # Ensure container is running
docker ps            # Verify fullrag-plus-postgres is up
```

**`alembic upgrade head` fails:**
```bash
# Check DATABASE_URL in .env points to running database
cd backend && uv run alembic current
```

**Frontend cannot reach API:**
- Local dev: Vite proxies `/api` → `http://localhost:8001` (check backend is running)
- Docker: nginx proxies `/api` → `http://backend:8001` (check `docker compose ps`)

**Large Docker build (torch/sentence-transformers):**
The backend image includes PyTorch for sentence-transformers embeddings. Initial build downloads ~2–3 GB. Subsequent builds use the Docker layer cache.
