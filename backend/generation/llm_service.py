"""LLM service with multi-provider support for enrichment and generation."""

import json
import re
import time
from typing import Iterator, Protocol, runtime_checkable

from google import genai
from google.genai import types
from observability.logging import get_logger

from config.settings import (
    get_gemini_api_key,
    get_groq_api_key,
    get_groq_base_url,
    get_groq_fallback_models,
    get_groq_model,
    get_groq_reasoning_effort,
    get_mistral_api_key,
    get_mistral_model,
    get_opencode_api_key,
    get_opencode_base_url,
    get_opencode_fallback_models,
    get_opencode_model,
    get_opencode_reasoning_effort,
)
from generation.models import (
    ChunkEnrichment,
    GenerationConfig,
    GenerationResponse,
    LLMConfig,
    TokenUsage,
)

logger = get_logger(__name__)


@runtime_checkable
class GenerationProvider(Protocol):
    """Interface for LLM generation providers."""

    def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        config: GenerationConfig,
        history: list[dict[str, str]] | None = None,
    ) -> GenerationResponse:
        """Generate a response from the LLM.

        Args:
            system_prompt: System instruction for the LLM.
            user_prompt: User message / query with context.
            config: Generation configuration.

        Returns:
            GenerationResponse with generated text and metadata.
        """
        ...


@runtime_checkable
class EnrichmentProvider(Protocol):
    """Interface for LLM enrichment providers."""

    def enrich_chunk(
        self,
        chunk_text: str,
        system_prompt: str,
    ) -> "ChunkEnrichment":
        """Generate structured enrichment metadata for a chunk."""
        ...


class GeminiProvider:
    """Wraps the Google GenAI client for structured chunk enrichment.

    Uses Gemini's native JSON schema output mode to guarantee
    structured responses conforming to ChunkEnrichment.
    """

    def __init__(self, config: LLMConfig | None = None) -> None:
        self.config = config or LLMConfig()
        self._client = genai.Client(api_key=get_gemini_api_key())

    def enrich_chunk(
        self, chunk_text: str, system_prompt: str
    ) -> ChunkEnrichment:
        """Generate enrichment metadata for a single chunk.

        Args:
            chunk_text: The chunk text to enrich.
            system_prompt: System instruction for the LLM.

        Returns:
            ChunkEnrichment with summary, keywords, and questions.

        Raises:
            RuntimeError: If all retries are exhausted.
        """
        max_retries = 3
        last_error: Exception | None = None

        for attempt in range(1, max_retries + 1):
            try:
                response = self._client.models.generate_content(
                    model=self.config.model_name,
                    contents=chunk_text,
                    config=types.GenerateContentConfig(
                        system_instruction=system_prompt,
                        temperature=self.config.temperature,
                        max_output_tokens=self.config.max_output_tokens,
                        response_mime_type="application/json",
                        response_json_schema=ChunkEnrichment.model_json_schema(),
                    ),
                )

                # Log token usage
                if response.usage_metadata:
                    logger.debug(
                        "Token usage: prompt=%d, completion=%d, total=%d",
                        response.usage_metadata.prompt_token_count or 0,
                        response.usage_metadata.candidates_token_count or 0,
                        response.usage_metadata.total_token_count or 0,
                    )

                # Parse structured JSON response
                raw_text = response.text
                if not raw_text:
                    raise ValueError("Empty response from Gemini")

                data = json.loads(raw_text)
                return ChunkEnrichment.model_validate(data)

            except Exception as e:
                last_error = e
                if attempt < max_retries:
                    wait = 2 ** attempt
                    logger.warning(
                        "Attempt %d/%d failed: %s. Retrying in %ds...",
                        attempt,
                        max_retries,
                        e,
                        wait,
                    )
                    time.sleep(wait)

        raise RuntimeError(
            f"Enrichment failed after {max_retries} retries: {last_error}"
        )


class MistralEnrichmentProvider:
    """Mistral provider for structured chunk enrichment using JSON schema output."""

    def __init__(self, config: LLMConfig | None = None) -> None:
        from mistralai import Mistral

        self.config = config or LLMConfig(model_name=get_mistral_model())
        self._client = Mistral(api_key=get_mistral_api_key())

    def enrich_chunk(
        self, chunk_text: str, system_prompt: str
    ) -> ChunkEnrichment:
        """Generate enrichment metadata for a single chunk using Mistral.

        Args:
            chunk_text: The chunk text to enrich.
            system_prompt: System instruction for the LLM.

        Returns:
            ChunkEnrichment with summary, keywords, and questions.

        Raises:
            RuntimeError: If all retries are exhausted.
        """
        max_retries = 3
        last_error: Exception | None = None

        for attempt in range(1, max_retries + 1):
            try:
                response = self._client.chat.complete(
                    model=self.config.model_name,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": chunk_text},
                    ],
                    temperature=self.config.temperature,
                    max_tokens=self.config.max_output_tokens,
                    response_format={
                        "type": "json_object",
                    },
                )

                raw_text = response.choices[0].message.content or ""
                if not raw_text:
                    raise ValueError("Empty response from Mistral")

                data = json.loads(raw_text)
                return ChunkEnrichment.model_validate(data)

            except Exception as e:
                last_error = e
                if attempt < max_retries:
                    wait = 2**attempt
                    logger.warning(
                        "Mistral enrichment attempt %d/%d failed: %s. Retrying in %ds...",
                        attempt,
                        max_retries,
                        e,
                        wait,
                    )
                    time.sleep(wait)

        raise RuntimeError(
            f"Mistral enrichment failed after {max_retries} retries: {last_error}"
        )


ChatHistory = list[dict[str, str]]
"""Prior conversation turns: [{"role": "user"|"assistant", "content": str}, ...]."""

_THINK_RE = re.compile(r"<think>.*?(</think>|$)", re.DOTALL | re.IGNORECASE)


def _strip_reasoning(text: str) -> str:
    """Remove <think>...</think> blocks some reasoning models emit inline."""
    return _THINK_RE.sub("", text).strip()


def _normalize_history(history: ChatHistory | None) -> ChatHistory:
    """Keep only well-formed user/assistant turns."""
    turns: ChatHistory = []
    for turn in history or []:
        role = turn.get("role")
        content = (turn.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            turns.append({"role": role, "content": content})
    return turns


class GeminiGenerationProvider:
    """Gemini provider for free-text answer generation."""

    def __init__(self) -> None:
        self._client = genai.Client(api_key=get_gemini_api_key())

    @staticmethod
    def _contents(user_prompt: str, history: ChatHistory | None):
        turns = _normalize_history(history)
        if not turns:
            return user_prompt
        contents = [
            types.Content(
                role="model" if t["role"] == "assistant" else "user",
                parts=[types.Part(text=t["content"])],
            )
            for t in turns
        ]
        contents.append(types.Content(role="user", parts=[types.Part(text=user_prompt)]))
        return contents

    def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        config: GenerationConfig,
        history: ChatHistory | None = None,
    ) -> GenerationResponse:
        """Generate a free-text answer using Gemini.

        Args:
            system_prompt: System instruction for the LLM.
            user_prompt: User message with context and query.
            config: Generation configuration.
            history: Optional prior conversation turns.

        Returns:
            GenerationResponse with generated text and token usage.

        Raises:
            RuntimeError: If all retries are exhausted.
        """
        max_retries = 3
        last_error: Exception | None = None

        for attempt in range(1, max_retries + 1):
            try:
                response = self._client.models.generate_content(
                    model=config.model_name,
                    contents=self._contents(user_prompt, history),
                    config=types.GenerateContentConfig(
                        system_instruction=system_prompt,
                        temperature=config.temperature,
                        max_output_tokens=config.max_output_tokens,
                    ),
                )

                raw_text = response.text
                if not raw_text:
                    raise ValueError("Empty response from Gemini")

                token_usage = TokenUsage()
                if response.usage_metadata:
                    token_usage = TokenUsage(
                        prompt_tokens=response.usage_metadata.prompt_token_count or 0,
                        completion_tokens=response.usage_metadata.candidates_token_count
                        or 0,
                        total_tokens=response.usage_metadata.total_token_count or 0,
                    )

                return GenerationResponse(
                    text=raw_text,
                    model=config.model_name,
                    token_usage=token_usage,
                    finish_reason="stop",
                )

            except Exception as e:
                last_error = e
                if attempt < max_retries:
                    wait = 2**attempt
                    logger.warning(
                        "Generation attempt %d/%d failed: %s. Retrying in %ds...",
                        attempt,
                        max_retries,
                        e,
                        wait,
                    )
                    time.sleep(wait)

        raise RuntimeError(
            f"Generation failed after {max_retries} retries: {last_error}"
        )

    def generate_stream(
        self,
        system_prompt: str,
        user_prompt: str,
        config: GenerationConfig,
        history: ChatHistory | None = None,
    ) -> Iterator[str | GenerationResponse]:
        """Stream an answer: yields text deltas, then a final GenerationResponse."""
        parts: list[str] = []
        usage = TokenUsage()
        stream = self._client.models.generate_content_stream(
            model=config.model_name,
            contents=self._contents(user_prompt, history),
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=config.temperature,
                max_output_tokens=config.max_output_tokens,
            ),
        )
        for chunk in stream:
            if chunk.text:
                parts.append(chunk.text)
                yield chunk.text
            if chunk.usage_metadata:
                usage = TokenUsage(
                    prompt_tokens=chunk.usage_metadata.prompt_token_count or 0,
                    completion_tokens=chunk.usage_metadata.candidates_token_count or 0,
                    total_tokens=chunk.usage_metadata.total_token_count or 0,
                )
        text = "".join(parts)
        if not text:
            raise RuntimeError("Empty response from Gemini")
        yield GenerationResponse(text=text, model=config.model_name, token_usage=usage)


class GroqProvider:
    """Groq provider using the OpenAI-compatible API.

    Tries GROQ_MODEL first, then each of GROQ_FALLBACK_MODELS. A model that is
    missing/decommissioned (404/400), forbidden (403) or rate-limited (429)
    is skipped immediately; transient errors (timeouts, 5xx) are retried.
    """

    def __init__(self, models: list[str] | None = None) -> None:
        import openai

        self._openai = openai
        primary = get_groq_model()
        chain = models or [primary, *get_groq_fallback_models()]
        # de-duplicate, keep order
        self._models: list[str] = list(dict.fromkeys(m for m in chain if m))
        self._model_name = self._models[0]
        self._client = openai.OpenAI(
            api_key=get_groq_api_key(),
            base_url=get_groq_base_url(),
            timeout=60.0,
            max_retries=0,
        )

    # Subclasses route some models to another client (see OpenCodeProvider).
    def _client_for(self, model: str):
        return self._client

    def _request_kwargs(self, model: str, system_prompt: str, user_prompt: str, history) -> dict:
        extra = self._extra_body(model)
        return {"extra_body": extra or None}

    _label = "Groq"

    @property
    def models(self) -> list[str]:
        """Model chain tried in order."""
        return list(self._models)

    def _messages(self, system_prompt: str, user_prompt: str, history: ChatHistory | None):
        return [
            {"role": "system", "content": system_prompt},
            *_normalize_history(history),
            {"role": "user", "content": user_prompt},
        ]

    @staticmethod
    def _extra_body(model: str) -> dict:
        """Per-family knobs so reasoning never leaks into the answer text."""
        if model.startswith("openai/gpt-oss"):
            return {"reasoning_effort": get_groq_reasoning_effort(), "include_reasoning": False}
        if model.startswith("qwen/"):
            return {"reasoning_format": "hidden"}
        return {}

    def _skip_model(self, error: Exception) -> bool:
        """True if the error means 'try the next model' rather than 'retry'."""
        o = self._openai
        if isinstance(error, (o.NotFoundError, o.PermissionDeniedError, o.RateLimitError)):
            return True
        # 413 = request bigger than this model's per-minute token limit; 401 =
        # bad key for this endpoint. Retrying the same model cannot help.
        if getattr(error, "status_code", None) in (401, 402, 413):
            return True
        if isinstance(error, o.BadRequestError):
            msg = str(error).lower()
            return any(k in msg for k in ("model", "decommission", "not supported"))
        return False

    def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        config: GenerationConfig,
        history: ChatHistory | None = None,
    ) -> GenerationResponse:
        """Generate a free-text answer using Groq, falling back across models.

        Args:
            system_prompt: System instruction for the LLM.
            user_prompt: User message with context and query.
            config: Generation configuration.
            history: Optional prior conversation turns.

        Returns:
            GenerationResponse with generated text and token usage.

        Raises:
            RuntimeError: If every model in the chain fails.
        """
        max_retries = 3
        errors: list[str] = []

        for model in self._models:
            for attempt in range(1, max_retries + 1):
                try:
                    response = self._client_for(model).chat.completions.create(
                        model=model,
                        messages=self._messages(system_prompt, user_prompt, history),
                        temperature=config.temperature,
                        max_tokens=config.max_output_tokens,
                        **self._request_kwargs(model, system_prompt, user_prompt, history),
                    )

                    choice = response.choices[0]
                    raw_text = _strip_reasoning(choice.message.content or "")
                    if not raw_text:
                        raise ValueError(f"Empty response from {self._label}")

                    token_usage = TokenUsage()
                    if response.usage:
                        token_usage = TokenUsage(
                            prompt_tokens=response.usage.prompt_tokens or 0,
                            completion_tokens=response.usage.completion_tokens or 0,
                            total_tokens=response.usage.total_tokens or 0,
                        )

                    if model != self._models[0]:
                        logger.warning("%s: answered with fallback model %s", self._label, model)
                    return GenerationResponse(
                        text=raw_text,
                        model=model,
                        token_usage=token_usage,
                        finish_reason=choice.finish_reason or "stop",
                    )

                except Exception as e:
                    if self._skip_model(e):
                        logger.warning("%s model %s unavailable: %s", self._label, model, e)
                        errors.append(f"{model}: {e}")
                        break
                    if attempt < max_retries:
                        wait = 2**attempt
                        logger.warning(
                            "%s attempt %d/%d on %s failed: %s. Retrying in %ds...",
                            self._label,
                            attempt,
                            max_retries,
                            model,
                            e,
                            wait,
                        )
                        time.sleep(wait)
                    else:
                        errors.append(f"{model}: {e}")

        raise RuntimeError(
            f"{self._label} generation failed for all models ("
            + ", ".join(self._models)
            + "). Last error: "
            + (errors[-1] if errors else "unknown")
        )

    def generate_stream(
        self,
        system_prompt: str,
        user_prompt: str,
        config: GenerationConfig,
        history: ChatHistory | None = None,
    ) -> Iterator[str | GenerationResponse]:
        """Stream an answer: yields text deltas, then a final GenerationResponse.

        Falls back to the next model only if a model fails before producing
        any text (so the user never sees two half-answers spliced together).
        """
        errors: list[str] = []
        for model in self._models:
            emitted = False
            try:
                stream = self._client_for(model).chat.completions.create(
                    model=model,
                    messages=self._messages(system_prompt, user_prompt, history),
                    temperature=config.temperature,
                    max_tokens=config.max_output_tokens,
                    stream=True,
                    stream_options={"include_usage": True},
                    **self._request_kwargs(model, system_prompt, user_prompt, history),
                )
                parts: list[str] = []
                usage = TokenUsage()
                finish = "stop"
                in_think = False
                for chunk in stream:
                    if getattr(chunk, "usage", None):
                        usage = TokenUsage(
                            prompt_tokens=chunk.usage.prompt_tokens or 0,
                            completion_tokens=chunk.usage.completion_tokens or 0,
                            total_tokens=chunk.usage.total_tokens or 0,
                        )
                    if not chunk.choices:
                        continue
                    choice = chunk.choices[0]
                    if choice.finish_reason:
                        finish = choice.finish_reason
                    delta = choice.delta.content or ""
                    if not delta:
                        continue
                    # drop inline <think> blocks if a model emits them anyway
                    if "<think>" in delta:
                        in_think = True
                        delta = delta.split("<think>", 1)[0]
                    if in_think:
                        if "</think>" in delta:
                            in_think = False
                            delta = delta.split("</think>", 1)[1]
                        else:
                            continue
                    if not delta:
                        continue
                    if not emitted:
                        delta = delta.lstrip()
                        if not delta:
                            continue
                    parts.append(delta)
                    emitted = True
                    yield delta
                text = "".join(parts).strip()
                if not text:
                    raise ValueError(f"Empty response from {self._label}")
                if model != self._models[0]:
                    logger.warning("%s: streamed with fallback model %s", self._label, model)
                yield GenerationResponse(
                    text=text, model=model, token_usage=usage, finish_reason=finish
                )
                return
            except Exception as e:
                if emitted:
                    raise RuntimeError(f"Groq stream interrupted ({model}): {e}") from e
                logger.warning("%s stream on %s failed before output: %s", self._label, model, e)
                errors.append(f"{model}: {e}")
        raise RuntimeError(
            f"{self._label} generation failed for all models ("
            + ", ".join(self._models)
            + "). Last error: "
            + (errors[-1] if errors else "unknown")
        )


class OpenCodeProvider(GroqProvider):
    """OpenCode Go (OpenAI-compatible) first, then the Groq chain as fallback.

    OPENCODE_MODEL (default deepseek-v4.1-flash, ~1M context) and
    OPENCODE_FALLBACK_MODELS are tried on OpenCode; when GROQ_API_KEY is set
    and GROQ_FALLBACK_ENABLED is not false, GROQ_MODEL + GROQ_FALLBACK_MODELS
    follow. Go asks clients to send their own User-Agent and a stable
    x-opencode-session per conversation.
    """

    USER_AGENT = "fullrag-plus/1.0"
    _label = "OpenCode"

    def __init__(self, models: list[str] | None = None, groq_models: list[str] | None = None) -> None:
        import openai

        from config.settings import get_groq_fallback_enabled

        self._openai = openai
        oc_chain = models or [get_opencode_model(), *get_opencode_fallback_models()]
        self._oc_models: list[str] = list(dict.fromkeys(m for m in oc_chain if m))
        self._oc_client = openai.OpenAI(
            api_key=get_opencode_api_key(),
            base_url=get_opencode_base_url(),
            timeout=180.0,
            max_retries=0,
            default_headers={"User-Agent": self.USER_AGENT},
        )
        self._groq_models: list[str] = []
        self._client = None
        if groq_models is not None or get_groq_fallback_enabled():
            try:
                self._client = openai.OpenAI(
                    api_key=get_groq_api_key(),
                    base_url=get_groq_base_url(),
                    timeout=60.0,
                    max_retries=0,
                )
                chain = groq_models if groq_models is not None else [get_groq_model(), *get_groq_fallback_models()]
                self._groq_models = [m for m in dict.fromkeys(chain) if m and m not in self._oc_models]
            except RuntimeError:  # no Groq key: OpenCode only
                self._client = None
        self._models = self._oc_models + self._groq_models
        self._model_name = self._models[0]

    def _client_for(self, model: str):
        return self._oc_client if model in self._oc_models else self._client

    @staticmethod
    def _session_id(system_prompt: str, user_prompt: str, history) -> str:
        import hashlib

        first = ""
        for t in history or []:
            if t.get("role") == "user" and t.get("content"):
                first = t["content"]
                break
        seed = first or user_prompt[-400:]
        return "fullrag-" + hashlib.sha256(seed.encode("utf-8", "ignore")).hexdigest()[:24]

    def _request_kwargs(self, model: str, system_prompt: str, user_prompt: str, history) -> dict:
        if model not in self._oc_models:
            return super()._request_kwargs(model, system_prompt, user_prompt, history)
        kwargs: dict = {
            "extra_headers": {"x-opencode-session": self._session_id(system_prompt, user_prompt, history)}
        }
        effort = get_opencode_reasoning_effort()
        if effort and effort != "none":
            kwargs["extra_body"] = {"reasoning_effort": effort}
        return kwargs


def get_generation_provider(provider_name: str = "gemini") -> GenerationProvider:
    """Factory function to get a generation provider by name.

    Args:
        provider_name: Provider name ('gemini' or 'groq').

    Returns:
        A GenerationProvider instance.

    Raises:
        ValueError: If the provider name is not recognized.
    """
    providers = {
        "gemini": GeminiGenerationProvider,
        "groq": GroqProvider,
        "opencode": OpenCodeProvider,
    }
    if provider_name not in providers:
        raise ValueError(
            f"Unknown provider '{provider_name}'. "
            f"Supported: {', '.join(providers)}"
        )
    return providers[provider_name]()


def get_enrichment_provider(
    provider_name: str | None = None,
    config: LLMConfig | None = None,
) -> EnrichmentProvider:
    """Factory function to get an enrichment provider by name.

    Args:
        provider_name: Provider name ('gemini' or 'mistral'). If None,
            reads ENRICHMENT_PROVIDER from environment.
        config: Optional LLMConfig to pass to the provider.

    Returns:
        An EnrichmentProvider instance.

    Raises:
        ValueError: If the provider name is not recognized.
    """
    from config.settings import get_enrichment_provider as _get_provider_name

    name = provider_name or _get_provider_name()
    providers = {
        "gemini": GeminiProvider,
        "mistral": MistralEnrichmentProvider,
    }
    if name not in providers:
        raise ValueError(
            f"Unknown enrichment provider '{name}'. "
            f"Supported: {', '.join(providers)}"
        )
    return providers[name](config=config)
