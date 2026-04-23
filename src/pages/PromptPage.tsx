import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import GlassCard from '../components/common/GlassCard';
import GlassButton from '../components/common/GlassButton';
import GlassInput from '../components/common/GlassInput';
import List from '../components/common/List';

interface SearchFilter {
  source?: string;
  eventType?: string;
  includeEventTypes?: string[];
  excludeEventTypes?: string[];
  severity?: string;
  stateCodes?: string[];
  effectiveFrom?: string;
  effectiveTo?: string;
  afdIssuedFrom?: string;
  afdIssuedTo?: string;
  afdSections?: string[];
}

type SearchCorpus = 'alerts' | 'afd';

type ConstraintExtractionSystem = 'bypass' | 'heuristic-v1' | 'heuristic-v2' | 'rules-v2' | 'llm-v1';

type LiveContextMode = 'auto' | 'off' | 'required';

type CitationOrigin = 'search' | 'live-local' | 'live-upstream';

type LiveContextStatus = 'ok' | 'partial' | 'unavailable';

interface ConstraintExtractionMetadata {
  enabled: boolean;
  requestedSystem: ConstraintExtractionSystem;
  appliedSystem: ConstraintExtractionSystem;
  fallbackApplied: boolean;
  warnings: string[];
  detectedEventTypes: string[];
  confidence?: number;
  signals?: string[];
  extractedFilter?: SearchFilter;
  mergedFilter?: SearchFilter;
}

interface SearchHit {
  id: string;
  score: number;
  source?: string;
  citationLabel?: string;
  eventType?: string;
  severity?: string;
  stateCodes?: string[];
  effectiveAt?: string;
  expiresAt?: string;
  afdIssuedAt?: string;
  afdSectionName?: string;
  snippet: string;
  metadata: Record<string, unknown>;
}

interface SearchResponse {
  query?: string;
  corpus: SearchCorpus;
  topK: number;
  model: string;
  collection: string;
  hits: SearchHit[];
}

interface Citation {
  id: string;
  score: number;
  source?: string;
  citationLabel?: string;
  origin?: CitationOrigin;
  fetchedAt?: string;
  freshnessMs?: number;
  snippet: string;
  metadata: Record<string, unknown>;
}

interface LiveContextSource {
  dataset: string;
  origin: Exclude<CitationOrigin, 'search'>;
  source?: string;
  sourceFamily?: string;
  sourceProduct?: string;
  asOf?: string;
  itemCount?: number;
}

interface LiveContextMetadata {
  mode: LiveContextMode;
  status: LiveContextStatus;
  fetchedAt?: string;
  warnings: string[];
  sources: LiveContextSource[];
}

function getNwsCitationLabel(metadata: Record<string, unknown>): string | undefined {
  const raw = metadata.nwsId;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : undefined;
}

interface AnswerResponse {
  question: string;
  answer: string;
  model: string;
  citations: Citation[];
  conversationId?: string;
  extraction?: ConstraintExtractionMetadata;
  liveContext?: LiveContextMetadata;
}

type ConversationHistoryMode = 'none' | 'last-turn' | 'last-10-messages';

interface PromptSettingsMetadata {
  liveMode?: LiveContextMode;
  temperature?: number;
  maxTokens?: number;
  maxContextChars?: number;
  constraintSystem?: {
    enabled?: boolean;
    method?: ConstraintExtractionSystem;
  };
}

interface ConversationMessageMetadata {
  answerModel?: string;
  citations?: Citation[];
  search?: SearchResponse;
  extraction?: ConstraintExtractionMetadata;
  liveContext?: LiveContextMetadata;
  filter?: SearchFilter;
  corpus?: SearchCorpus;
  groupByEvent?: boolean;
  promptSettings?: PromptSettingsMetadata;
  historyMode?: ConversationHistoryMode;
  stageEvents?: AnswerStageEvent[];
}

interface ConversationMessageResponse {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: ConversationMessageMetadata;
  createdAt: string;
  updatedAt: string;
}

interface ConversationResponse {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessageResponse[];
}

interface LatestConversationResponse {
  conversation: ConversationResponse | null;
}

interface ConversationMessage extends ConversationMessageResponse {
  pending?: boolean;
}

type AnswerStreamStage =
  | 'constraints_started'
  | 'constraints_complete'
  | 'live_context_started'
  | 'live_context_complete'
  | 'search_started'
  | 'search_complete'
  | 'generation_started'
  | 'generation_complete'
  | 'cancelled';

interface AnswerStageEvent {
  type: 'stage';
  stage: AnswerStreamStage;
  extraction?: ConstraintExtractionMetadata;
  liveContext?: LiveContextMetadata;
  model?: string;
  citationsCount?: number;
  search?: SearchResponse;
  message?: string;
}

interface AnswerTokenEvent {
  type: 'token';
  token: string;
}

interface AnswerCompleteEvent {
  type: 'complete';
  response: AnswerResponse;
}

interface AnswerErrorEvent {
  type: 'error';
  message: string;
}

type AnswerStreamEvent =
  | AnswerStageEvent
  | AnswerTokenEvent
  | AnswerCompleteEvent
  | AnswerErrorEvent;

type ActiveAction = 'search' | 'answer' | null;

const DEFAULT_API_BASE_URL =
  import.meta.env.VITE_WEATHER_LLM_API_BASE_URL ?? 'http://localhost:3000';
const DEFAULT_ANSWER_TOP_K = 2;
const DEFAULT_ANSWER_MAX_TOKENS = '1024';
const DEFAULT_ANSWER_MAX_CONTEXT_CHARS = '6000';
const DEFAULT_LIVE_MODE: LiveContextMode = 'auto';
const MAX_CONVERSATION_BOOTSTRAP_RETRIES = 3;
const CONVERSATION_BOOTSTRAP_RETRY_DELAYS_MS = [1500, 3000, 5000];

function toCsvValues(raw: string): string[] | undefined {
  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return values.length ? values : undefined;
}

function buildFilter(
  corpus: SearchCorpus,
  source: string,
  eventType: string,
  severity: string,
  stateCodesText: string,
  effectiveFrom: string,
  effectiveTo: string,
  afdIssuedFrom: string,
  afdIssuedTo: string,
  afdSectionsText: string,
): SearchFilter | undefined {
  const filter: SearchFilter = {
    source: source.trim() || undefined,
    eventType: eventType.trim() || undefined,
    severity: severity.trim() || undefined,
    stateCodes: toCsvValues(stateCodesText),
    effectiveFrom: effectiveFrom.trim() || undefined,
    effectiveTo: effectiveTo.trim() || undefined,
    afdIssuedFrom: corpus === 'afd' ? afdIssuedFrom.trim() || undefined : undefined,
    afdIssuedTo: corpus === 'afd' ? afdIssuedTo.trim() || undefined : undefined,
    afdSections: corpus === 'afd' ? toCsvValues(afdSectionsText) : undefined,
  };

  if (
    !filter.source &&
    !filter.eventType &&
    !filter.severity &&
    !filter.stateCodes?.length &&
    !filter.effectiveFrom &&
    !filter.effectiveTo &&
    !filter.afdIssuedFrom &&
    !filter.afdIssuedTo &&
    !filter.afdSections?.length
  ) {
    return undefined;
  }

  return filter;
}

function formatStageMessage(stage: AnswerStreamStage): string {
  switch (stage) {
    case 'constraints_started':
      return 'Extracting constraints...';
    case 'constraints_complete':
      return 'Constraint extraction complete.';
    case 'live_context_started':
      return 'Fetching live context...';
    case 'live_context_complete':
      return 'Live context ready.';
    case 'search_started':
      return 'Searching context...';
    case 'search_complete':
      return 'Context search complete.';
    case 'generation_started':
      return 'Generating answer...';
    case 'generation_complete':
      return 'Generation complete.';
    case 'cancelled':
      return 'Generation cancelled.';
    default:
      return 'Streaming...';
  }
}

function formatAnswerErrorMessage(message: string): string {
  const trimmed = message.trim();
  const normalized = trimmed.toLowerCase();

  if (
    normalized.includes('terminated before completion') ||
    normalized.includes('resource-constrained') ||
    normalized.includes('unstable')
  ) {
    return 'Answer generation stopped early on the model host. Try again, or lower Max tokens for a shorter response.';
  }

  if (normalized.includes('timed out after')) {
    return 'Answer generation timed out before the model completed. Try again, or lower Max tokens for a shorter response.';
  }

  if (normalized.includes('unable to reach ollama-compatible generation endpoint')) {
    return 'Answer generation is currently unavailable because the model host could not be reached.';
  }

  if (normalized.includes('stream ended before completion event')) {
    return 'Answer generation stopped before completion. Try again.';
  }

  if (normalized.startsWith('ollama generate error:')) {
    return `Answer generation failed: ${trimmed.replace(/^Ollama generate error:\s*/i, '')}`;
  }

  return trimmed;
}

function formatIsoForDisplay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toISOString();
}

function formatFreshness(value: number | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }

  const totalMinutes = Math.round(value / 60000);
  if (totalMinutes < 60) {
    return `${totalMinutes}m old`;
  }

  const hours = (totalMinutes / 60).toFixed(totalMinutes % 60 === 0 ? 0 : 1);
  return `${hours}h old`;
}

function getCitationDisplayLabel(citation: Citation): string {
  return citation.citationLabel ?? getNwsCitationLabel(citation.metadata) ?? 'unknown source';
}

function getCitationOriginLabel(origin: CitationOrigin | undefined): string {
  switch (origin) {
    case 'live-local':
      return 'live local';
    case 'live-upstream':
      return 'live upstream';
    case 'search':
    default:
      return 'search';
  }
}

function getCitationOriginClassName(origin: CitationOrigin | undefined): string {
  switch (origin) {
    case 'live-local':
      return 'bg-emerald-500/15 text-emerald-700';
    case 'live-upstream':
      return 'bg-sky-500/15 text-sky-700';
    case 'search':
    default:
      return 'bg-base-300 text-base-content/80';
  }
}

function consumeSseEvents(
  chunk: string,
  onEvent: (event: AnswerStreamEvent) => void,
): string {
  let buffer = chunk;

  while (true) {
    const delimiterIndex = buffer.indexOf('\n\n');
    if (delimiterIndex === -1) {
      break;
    }

    const rawEvent = buffer.slice(0, delimiterIndex);
    buffer = buffer.slice(delimiterIndex + 2);

    if (!rawEvent.trim()) {
      continue;
    }

    const lines = rawEvent.split('\n');
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (!dataLines.length) {
      continue;
    }

    const payloadText = dataLines.join('\n');
    const parsed = JSON.parse(payloadText) as AnswerStreamEvent;
    onEvent(parsed);
  }

  return buffer;
}

async function postJson<TResponse>(
  apiBaseUrl: string,
  path: string,
  body: Record<string, unknown>,
): Promise<TResponse> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return readJsonResponse<TResponse>(response);
}

function parseResponseJson(rawText: string, contentType: string | null): unknown | null {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return null;
  }

  const normalizedContentType = contentType?.toLowerCase() ?? '';
  const looksJson =
    normalizedContentType.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[');

  if (!looksJson) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function formatApiResponseError(response: Response, rawText: string, data: unknown): string {
  if (
    data &&
    typeof data === 'object' &&
    'message' in data &&
    typeof (data as { message?: unknown }).message === 'string'
  ) {
    return (data as { message: string }).message;
  }

  const trimmed = rawText.trim();

  if (!trimmed) {
    return `Request failed with status ${response.status}`;
  }

  if (trimmed.startsWith('<')) {
    return `Unexpected non-JSON response from API (status ${response.status}). Check that ${DEFAULT_API_BASE_URL} is serving the weather API.`;
  }

  return trimmed;
}

async function readJsonResponse<TResponse>(response: Response): Promise<TResponse> {
  const rawText = await response.text();
  const data = parseResponseJson(rawText, response.headers.get('content-type'));

  if (!response.ok) {
    throw new Error(formatApiResponseError(response, rawText, data));
  }

  if (data === null) {
    throw new Error(
      `Unexpected non-JSON response from API (status ${response.status}). Check that ${DEFAULT_API_BASE_URL} is serving the weather API.`,
    );
  }

  return data as TResponse;
}

async function getJson<TResponse>(
  apiBaseUrl: string,
  path: string,
  signal?: AbortSignal,
): Promise<TResponse> {
  const response = await fetch(`${apiBaseUrl}${path}`, { signal });

  return readJsonResponse<TResponse>(response);
}

function buildLocalMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function findLatestAssistantMessage(
  messages: ConversationMessage[],
): ConversationMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'assistant') {
      return message;
    }
  }

  return null;
}

function formatConversationLoadErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'Latest conversation loading was cancelled.';
  }

  const rawMessage = error instanceof Error ? error.message : String(error);
  const trimmed = rawMessage.trim();

  if (!trimmed) {
    return 'Unable to load the latest conversation.';
  }

  const normalized = trimmed.toLowerCase();

  if (normalized.startsWith('unable to load the latest conversation')) {
    return trimmed;
  }

  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('load failed')
  ) {
    return `Unable to reach ${DEFAULT_API_BASE_URL} to load the latest conversation.`;
  }

  return `Unable to load the latest conversation: ${trimmed}`;
}

const MARKDOWN_COMPONENTS = {
  h1({ children, ...props }: React.ComponentProps<'h1'>) {
    return (
      <h1 className="mb-3 mt-1 text-xl font-semibold" {...props}>
        {children}
      </h1>
    );
  },
  h2({ children, ...props }: React.ComponentProps<'h2'>) {
    return (
      <h2 className="mb-2 mt-4 text-lg font-semibold" {...props}>
        {children}
      </h2>
    );
  },
  h3({ children, ...props }: React.ComponentProps<'h3'>) {
    return (
      <h3 className="mb-2 mt-3 text-base font-semibold" {...props}>
        {children}
      </h3>
    );
  },
  p({ children, ...props }: React.ComponentProps<'p'>) {
    return (
      <p className="mb-3 whitespace-pre-wrap leading-relaxed" {...props}>
        {children}
      </p>
    );
  },
  ul({ children, ...props }: React.ComponentProps<'ul'>) {
    return (
      <ul className="mb-3 list-disc space-y-1 pl-6" {...props}>
        {children}
      </ul>
    );
  },
  ol({ children, ...props }: React.ComponentProps<'ol'>) {
    return (
      <ol className="mb-3 list-decimal space-y-1 pl-6" {...props}>
        {children}
      </ol>
    );
  },
  li({ children, ...props }: React.ComponentProps<'li'>) {
    return <li className="leading-relaxed" {...props}>{children}</li>;
  },
  blockquote({ children, ...props }: React.ComponentProps<'blockquote'>) {
    return (
      <blockquote
        className="mb-3 border-l-4 border-base-300 pl-3 italic text-base-content/80"
        {...props}
      >
        {children}
      </blockquote>
    );
  },
  hr(props: React.ComponentProps<'hr'>) {
    return <hr className="my-4 border-base-300" {...props} />;
  },
  pre({ children, ...props }: React.ComponentProps<'pre'>) {
    return (
      <pre className="mb-3 overflow-x-auto rounded bg-base-100 p-3 text-xs" {...props}>
        {children}
      </pre>
    );
  },
  code({ className, children, ...props }: React.ComponentProps<'code'>) {
    if (className) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }

    return (
      <code className="rounded bg-base-100 px-1 py-0.5 text-xs" {...props}>
        {children}
      </code>
    );
  },
  a({ children, ...props }: React.ComponentProps<'a'>) {
    return (
      <a
        className="link link-primary break-all"
        target="_blank"
        rel="noreferrer"
        {...props}
      >
        {children}
      </a>
    );
  },
  table({ children, ...props }: React.ComponentProps<'table'>) {
    return (
      <div className="mb-3 overflow-x-auto">
        <table className="table table-zebra table-xs" {...props}>
          {children}
        </table>
      </div>
    );
  },
  th({ children, ...props }: React.ComponentProps<'th'>) {
    return <th className="font-semibold" {...props}>{children}</th>;
  },
  td({ children, ...props }: React.ComponentProps<'td'>) {
    return <td {...props}>{children}</td>;
  },
};

function PromptPage() {
  const [prompt, setPrompt] = useState('');
  const [historyMode, setHistoryMode] = useState<ConversationHistoryMode>('none');
  const [liveMode, setLiveMode] = useState<LiveContextMode>(DEFAULT_LIVE_MODE);
  const [temperatureText, setTemperatureText] = useState('0.2');
  const [maxTokensText, setMaxTokensText] = useState(DEFAULT_ANSWER_MAX_TOKENS);
  const [maxContextCharsText, setMaxContextCharsText] = useState(
    DEFAULT_ANSWER_MAX_CONTEXT_CHARS,
  );
  const [constraintExtractionEnabled, setConstraintExtractionEnabled] = useState(true);
  const [groupByEventEnabled, setGroupByEventEnabled] = useState(true);
  const [constraintExtractionMethod, setConstraintExtractionMethod] =
    useState<ConstraintExtractionSystem>('heuristic-v1');

  const [corpus, setCorpus] = useState<SearchCorpus>('alerts');
  const [source, setSource] = useState('');
  const [eventType, setEventType] = useState('');
  const [severity, setSeverity] = useState('');
  const [stateCodesText, setStateCodesText] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [afdIssuedFrom, setAfdIssuedFrom] = useState('');
  const [afdIssuedTo, setAfdIssuedTo] = useState('');
  const [afdSectionsText, setAfdSectionsText] = useState('');

  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [conversationLoading, setConversationLoading] = useState(true);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [conversationRetryAttempt, setConversationRetryAttempt] = useState(0);
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [answerStageMessage, setAnswerStageMessage] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const answerAbortControllerRef = useRef<AbortController | null>(null);
  const conversationLoadAbortControllerRef = useRef<AbortController | null>(null);
  const conversationLoadRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conversationLoadRequestIdRef = useRef(0);

  const filter = useMemo(
    () =>
      buildFilter(
        corpus,
        source,
        eventType,
        severity,
        stateCodesText,
        effectiveFrom,
        effectiveTo,
        afdIssuedFrom,
        afdIssuedTo,
        afdSectionsText,
      ),
    [
      afdIssuedFrom,
      afdIssuedTo,
      afdSectionsText,
      corpus,
      effectiveFrom,
      effectiveTo,
      eventType,
      severity,
      source,
      stateCodesText,
    ],
  );

  function buildSharedPayload() {
    return {
      corpus,
      filter,
      groupByEvent: groupByEventEnabled,
    };
  }

  function clearConversationLoadRetryTimer() {
    if (conversationLoadRetryTimerRef.current !== null) {
      clearTimeout(conversationLoadRetryTimerRef.current);
      conversationLoadRetryTimerRef.current = null;
    }
  }

  function cancelConversationLoad() {
    clearConversationLoadRetryTimer();
    conversationLoadRequestIdRef.current += 1;
    conversationLoadAbortControllerRef.current?.abort();
    conversationLoadAbortControllerRef.current = null;
  }

  async function loadLatestConversation({
    allowRetry = true,
    attempt = 0,
  }: {
    allowRetry?: boolean;
    attempt?: number;
  } = {}) {
    cancelConversationLoad();

    const requestId = conversationLoadRequestIdRef.current;
    const abortController = new AbortController();
    conversationLoadAbortControllerRef.current = abortController;

    setConversationLoading(true);

    if (attempt === 0) {
      setConversationError(null);
      setConversationRetryAttempt(0);
    }

    let scheduledRetry = false;

    try {
      const response = await getJson<LatestConversationResponse>(
        DEFAULT_API_BASE_URL,
        '/nws-alerts/conversation/latest',
        abortController.signal,
      );

      if (requestId !== conversationLoadRequestIdRef.current) {
        return;
      }

      const loadedMessages = response.conversation?.messages ?? [];
      setConversationId(response.conversation?.id ?? null);
      setConversationMessages(loadedMessages);
      setSearchResult(findLatestAssistantMessage(loadedMessages)?.metadata?.search ?? null);
      setConversationError(null);
      setConversationRetryAttempt(0);
    } catch (requestError) {
      if (abortController.signal.aborted || requestId !== conversationLoadRequestIdRef.current) {
        return;
      }

      const message = formatConversationLoadErrorMessage(requestError);
      const nextAttempt = attempt + 1;

      if (allowRetry && nextAttempt <= MAX_CONVERSATION_BOOTSTRAP_RETRIES) {
        const retryDelayMs =
          CONVERSATION_BOOTSTRAP_RETRY_DELAYS_MS[nextAttempt - 1] ??
          CONVERSATION_BOOTSTRAP_RETRY_DELAYS_MS[
            CONVERSATION_BOOTSTRAP_RETRY_DELAYS_MS.length - 1
          ];

        setConversationRetryAttempt(nextAttempt);
        setConversationError(`${message} Retrying in ${Math.ceil(retryDelayMs / 1000)}s...`);
        conversationLoadRetryTimerRef.current = setTimeout(() => {
          void loadLatestConversation({ allowRetry, attempt: nextAttempt });
        }, retryDelayMs);
        scheduledRetry = true;
        return;
      }

      setConversationError(message);
    } finally {
      if (
        requestId === conversationLoadRequestIdRef.current &&
        conversationLoadAbortControllerRef.current === abortController
      ) {
        conversationLoadAbortControllerRef.current = null;
      }

      if (requestId === conversationLoadRequestIdRef.current && !scheduledRetry) {
        setConversationLoading(false);
      }
    }
  }

  useEffect(() => {
    void loadLatestConversation();

    return () => {
      cancelConversationLoad();
      answerAbortControllerRef.current?.abort();
    };
  }, []);

  const latestAssistantMessage = useMemo(
    () => findLatestAssistantMessage(conversationMessages),
    [conversationMessages],
  );
  const displayedSearchResult = searchResult ?? latestAssistantMessage?.metadata?.search ?? null;

  function updateConversationMessage(
    messageId: string,
    updater: (message: ConversationMessage) => ConversationMessage,
  ) {
    setConversationMessages((previous) =>
      previous.map((message) =>
        message.id === messageId ? updater(message) : message,
      ),
    );
  }

  async function runSearch() {
    if (!prompt.trim()) {
      setError('Prompt/query is required.');
      return;
    }

    setError(null);
    setActiveAction('search');

    try {
      const payload = {
        query: prompt.trim(),
        ...buildSharedPayload(),
      };

      const response = await postJson<SearchResponse>(
        DEFAULT_API_BASE_URL,
        '/nws-alerts/search',
        payload,
      );

      setSearchResult(response);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setActiveAction(null);
    }
  }

  async function runAnswer() {
    if (!prompt.trim()) {
      setError('Prompt/question is required.');
      return;
    }
    const temperature = Number.parseFloat(temperatureText);
    const maxTokens = Number.parseInt(maxTokensText, 10);
    const maxContextChars = Number.parseInt(maxContextCharsText, 10);

    const errs: Record<string, string> = {};
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      errs.temperature = 'Temperature must be between 0 and 2.';
    }
    if (!Number.isFinite(maxTokens) || !Number.isInteger(maxTokens) || maxTokens < 1) {
      errs.maxTokens = 'Max tokens must be a positive integer.';
    }
    if (!Number.isFinite(maxContextChars) || !Number.isInteger(maxContextChars) || maxContextChars < 1) {
      errs.maxContextChars = 'Max context chars must be a positive integer.';
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});

    const question = prompt.trim();
    const previousSearchResult = displayedSearchResult;
    const submittedAt = new Date().toISOString();
    const localUserMessageId = buildLocalMessageId('user');
    const localAssistantMessageId = buildLocalMessageId('assistant');
    const pendingPromptSettings: PromptSettingsMetadata = {
      liveMode,
      temperature: Number.isFinite(temperature) ? temperature : undefined,
      maxTokens: Number.isFinite(maxTokens) ? maxTokens : undefined,
      maxContextChars: Number.isFinite(maxContextChars) ? maxContextChars : undefined,
      constraintSystem: {
        enabled: constraintExtractionEnabled,
        method: constraintExtractionMethod,
      },
    };
    const pendingMetadata: ConversationMessageMetadata = {
      filter,
      corpus,
      groupByEvent: groupByEventEnabled,
      promptSettings: pendingPromptSettings,
      historyMode,
      stageEvents: [],
    };

    cancelConversationLoad();
    setConversationLoading(false);
    setConversationError(null);
    setConversationRetryAttempt(0);
    setError(null);
    setSearchResult(null);
    setPrompt('');
    setConversationMessages((previous) => [
      ...previous,
      {
        id: localUserMessageId,
        role: 'user',
        content: question,
        createdAt: submittedAt,
        updatedAt: submittedAt,
      },
      {
        id: localAssistantMessageId,
        role: 'assistant',
        content: '',
        metadata: pendingMetadata,
        createdAt: submittedAt,
        updatedAt: submittedAt,
        pending: true,
      },
    ]);

    setActiveAction('answer');
    setAnswerStageMessage('Initializing answer stream...');

    const abortController = new AbortController();
    answerAbortControllerRef.current?.abort();
    answerAbortControllerRef.current = abortController;

    try {
      const payload = {
        question,
        conversationId: conversationId ?? undefined,
        historyMode,
        ...buildSharedPayload(),
        topK: DEFAULT_ANSWER_TOP_K,
        liveMode,
        constraintSystem: {
          enabled: constraintExtractionEnabled,
          method: constraintExtractionMethod,
        },
        temperature: Number.isFinite(temperature) ? temperature : undefined,
        maxTokens: Number.isFinite(maxTokens) ? maxTokens : undefined,
        maxContextChars: Number.isFinite(maxContextChars) ? maxContextChars : undefined,
      };

      const response = await fetch(`${DEFAULT_API_BASE_URL}/nws-alerts/answer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const parsed = parseResponseJson(errorText, response.headers.get('content-type'));
        throw new Error(formatApiResponseError(response, errorText, parsed));
      }

      if (!response.body) {
        throw new Error('Streaming response body was empty');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;

      let sseIdleTimer: ReturnType<typeof setTimeout> | null = null;
      const parsedSseIdleTimeoutMs = Number.parseInt(
        import.meta.env.VITE_SSE_IDLE_TIMEOUT_MS ?? '90000',
        10,
      );
      const sseIdleTimeoutMs =
        Number.isFinite(parsedSseIdleTimeoutMs) && parsedSseIdleTimeoutMs > 0
          ? parsedSseIdleTimeoutMs
          : 90000;

      function makeIdlePromise() {
        return new Promise<never>((_, reject) => {
          sseIdleTimer = setTimeout(() => {
            reject(new Error('Answer stream timed out — no data received.'));
          }, sseIdleTimeoutMs);
        });
      }

      while (true) {
        if (sseIdleTimer !== null) clearTimeout(sseIdleTimer);
        const { value, done } = await Promise.race([reader.read(), makeIdlePromise()]);
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        buffer = consumeSseEvents(buffer, (event) => {
          if (event.type === 'stage') {
            const baseMessage = formatStageMessage(event.stage);
            const details =
              event.stage === 'search_complete' && typeof event.citationsCount === 'number'
                ? ` (${event.citationsCount} citations)`
                : '';
            const extraMessage =
              typeof event.message === 'string' && event.message.trim().length > 0
                ? ` ${event.message}`
                : '';
            setAnswerStageMessage(`${baseMessage}${details}${extraMessage}`);

            updateConversationMessage(localAssistantMessageId, (message) => ({
              ...message,
              metadata: {
                ...(message.metadata ?? {}),
                ...(event.extraction
                  ? {
                      extraction: event.extraction,
                    }
                  : {}),
                ...(event.liveContext
                  ? {
                      liveContext: event.liveContext,
                    }
                  : {}),
                ...(event.model
                  ? {
                      answerModel: event.model,
                    }
                  : {}),
                ...(event.stage === 'search_complete' && event.search
                  ? {
                      search: event.search,
                    }
                  : {}),
                stageEvents: [
                  ...((message.metadata?.stageEvents ?? []) as AnswerStageEvent[]),
                  event,
                ],
              },
            }));

            if (event.stage === 'search_complete' && event.search) {
              setSearchResult(event.search);
            }

            return;
          }

          if (event.type === 'token') {
            updateConversationMessage(localAssistantMessageId, (message) => ({
              ...message,
              content: `${message.content}${event.token}`,
            }));
            return;
          }

          if (event.type === 'complete') {
            completed = true;
            setConversationId((previous) => event.response.conversationId ?? previous);
            updateConversationMessage(localAssistantMessageId, (message) => ({
              ...message,
              content: event.response.answer,
              pending: false,
              metadata: {
                ...(message.metadata ?? {}),
                answerModel: event.response.model,
                citations: event.response.citations,
                ...(event.response.extraction
                  ? {
                      extraction: event.response.extraction,
                    }
                  : {}),
                ...(event.response.liveContext
                  ? {
                      liveContext: event.response.liveContext,
                    }
                  : {}),
              },
            }));
            setAnswerStageMessage('Generation complete.');
            return;
          }

          if (event.type === 'error') {
            throw new Error(event.message);
          }
        });
      }

      if (sseIdleTimer !== null) clearTimeout(sseIdleTimer);

      const trailing = decoder.decode().replace(/\r\n/g, '\n');
      if (trailing.length > 0) {
        buffer += trailing;
      }
      buffer = consumeSseEvents(`${buffer}\n\n`, (event) => {
        if (event.type === 'complete') {
          completed = true;
          setConversationId((previous) => event.response.conversationId ?? previous);
          updateConversationMessage(localAssistantMessageId, (message) => ({
            ...message,
            content: event.response.answer,
            pending: false,
            metadata: {
              ...(message.metadata ?? {}),
              answerModel: event.response.model,
              citations: event.response.citations,
              ...(event.response.extraction
                ? {
                    extraction: event.response.extraction,
                  }
                : {}),
              ...(event.response.liveContext
                ? {
                    liveContext: event.response.liveContext,
                  }
                : {}),
            },
          }));
          setAnswerStageMessage('Generation complete.');
          return;
        }

        if (event.type === 'stage') {
          const extraMessage =
            typeof event.message === 'string' && event.message.trim().length > 0
              ? ` ${event.message}`
              : '';
          setAnswerStageMessage(`${formatStageMessage(event.stage)}${extraMessage}`);

          updateConversationMessage(localAssistantMessageId, (message) => ({
            ...message,
            metadata: {
              ...(message.metadata ?? {}),
              ...(event.extraction
                ? {
                    extraction: event.extraction,
                  }
                : {}),
              ...(event.liveContext
                ? {
                    liveContext: event.liveContext,
                  }
                : {}),
              ...(event.model
                ? {
                    answerModel: event.model,
                  }
                : {}),
              ...(event.stage === 'search_complete' && event.search
                ? {
                    search: event.search,
                  }
                : {}),
              stageEvents: [
                ...((message.metadata?.stageEvents ?? []) as AnswerStageEvent[]),
                event,
              ],
            },
          }));

          if (event.stage === 'search_complete' && event.search) {
            setSearchResult(event.search);
          }
          return;
        }

        if (event.type === 'token') {
          updateConversationMessage(localAssistantMessageId, (message) => ({
            ...message,
            content: `${message.content}${event.token}`,
          }));
          return;
        }

        if (event.type === 'error') {
          throw new Error(event.message);
        }
      });

      if (!completed && !abortController.signal.aborted) {
        throw new Error('Answer stream ended before completion event');
      }
    } catch (requestError) {
      setConversationMessages((previous) =>
        previous.filter(
          (message) =>
            message.id !== localUserMessageId &&
            message.id !== localAssistantMessageId,
        ),
      );
      setSearchResult(previousSearchResult);
      setPrompt(question);

      if (requestError instanceof DOMException && requestError.name === 'AbortError') {
        setAnswerStageMessage('Generation cancelled.');
      } else {
        const message = requestError instanceof Error ? requestError.message : String(requestError);
        setAnswerStageMessage('Generation failed.');
        setError(formatAnswerErrorMessage(message));
      }
    } finally {
      if (answerAbortControllerRef.current === abortController) {
        answerAbortControllerRef.current = null;
      }
      setActiveAction(null);
    }
  }

  function cancelAnswer() {
    answerAbortControllerRef.current?.abort();
  }

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    void runSearch();
  }

  function handleAnswer(event: FormEvent) {
    event.preventDefault();
    void runAnswer();
  }

  const isBusy = activeAction !== null;
  const latestAssistantMetadata = latestAssistantMessage?.metadata;
  const conversationStatusText = answerStageMessage ?? (latestAssistantMessage ? 'Latest conversation loaded.' : 'No status yet.');
  const conversationConnectText = conversationRetryAttempt > 0
    ? `Reconnect attempt ${conversationRetryAttempt} of ${MAX_CONVERSATION_BOOTSTRAP_RETRIES}`
    : conversationMessages.length > 0
      ? 'Saved conversation connected'
      : 'Waiting for latest conversation';

  return (
    <>
      {!import.meta.env.VITE_WEATHER_LLM_API_BASE_URL && (
        <div role="alert" className="alert alert-warning mb-4">
          <span>
            No API URL configured — using default <code>http://localhost:3000</code>. Set{' '}
            <code>VITE_WEATHER_LLM_API_BASE_URL</code> for production.
          </span>
        </div>
      )}
      <div className="grid gap-6">
      <GlassCard>
        <form className="card-body gap-5" onSubmit={handleAnswer}>
          <div className="mx-auto w-full max-w-5xl rounded-box border border-base-300 bg-base-200/60 p-2">
            <GlassInput
              className="input input-ghost h-14 w-full text-lg"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask anything about weather alerts..."
              disabled={isBusy}
            />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <GlassButton
              type="button"
              variant="outline"
              loading={activeAction === 'search'}
              loadingText="Searching..."
              onClick={(event) => {
                event.preventDefault();
                void runSearch();
              }}
              disabled={isBusy}
            >
              Search Context
            </GlassButton>
            <GlassButton
              type="submit"
              tint="primary"
              loading={activeAction === 'answer'}
              loadingText="Generating..."
              disabled={isBusy}
            >
              Ask LLM
            </GlassButton>
            <GlassButton
              type="button"
              tint="error"
              variant="outline"
              onClick={cancelAnswer}
              disabled={activeAction !== 'answer'}
            >
              Cancel
            </GlassButton>
            <GlassButton
              type="button"
              variant="ghost"
              onClick={() => setAdvancedOpen((previous) => !previous)}
              aria-expanded={advancedOpen}
              aria-controls="advanced-settings-panel"
              disabled={isBusy}
            >
              {advancedOpen ? 'Hide Advanced' : 'Advanced'}
            </GlassButton>
          </div>

          {advancedOpen && (
            <div id="advanced-settings-panel" className="grid gap-4 rounded-md bg-base-200/70 p-4">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <label className="form-control">
                  <span className="label-text">Temperature</span>
                  <GlassInput
                    className="input input-bordered"
                    type="number"
                    step="0.1"
                    min={0}
                    value={temperatureText}
                    onChange={(event) => setTemperatureText(event.target.value)}
                    disabled={isBusy}
                  />
                  {fieldErrors.temperature && (
                    <p className="text-error text-xs mt-1">{fieldErrors.temperature}</p>
                  )}
                </label>
                <label className="form-control">
                  <span className="label-text">Max Tokens</span>
                  <GlassInput
                    className="input input-bordered"
                    type="number"
                    min={1}
                    value={maxTokensText}
                    onChange={(event) => setMaxTokensText(event.target.value)}
                    disabled={isBusy}
                  />
                  {fieldErrors.maxTokens && (
                    <p className="text-error text-xs mt-1">{fieldErrors.maxTokens}</p>
                  )}
                </label>
                <label className="form-control">
                  <span className="label-text">Max Context Chars</span>
                  <GlassInput
                    className="input input-bordered"
                    type="number"
                    min={1}
                    value={maxContextCharsText}
                    onChange={(event) => setMaxContextCharsText(event.target.value)}
                    disabled={isBusy}
                  />
                  {fieldErrors.maxContextChars && (
                    <p className="text-error text-xs mt-1">{fieldErrors.maxContextChars}</p>
                  )}
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
                <label className="form-control">
                  <span className="label-text">Corpus</span>
                  <select
                    className="select select-bordered"
                    value={corpus}
                    onChange={(event) => setCorpus(event.target.value as SearchCorpus)}
                    disabled={isBusy}
                  >
                    <option value="alerts">alerts</option>
                    <option value="afd">afd</option>
                  </select>
                </label>
                <label className="form-control">
                  <span className="label-text">Conversation Context</span>
                  <select
                    className="select select-bordered"
                    value={historyMode}
                    onChange={(event) =>
                      setHistoryMode(event.target.value as ConversationHistoryMode)
                    }
                    disabled={isBusy}
                  >
                    <option value="none">No prior messages</option>
                    <option value="last-turn">Last 1 full turn</option>
                    <option value="last-10-messages">Last 10 messages</option>
                  </select>
                </label>
                <label className="form-control">
                  <span className="label-text">Live Mode</span>
                  <select
                    className="select select-bordered"
                    value={liveMode}
                    onChange={(event) => setLiveMode(event.target.value as LiveContextMode)}
                    disabled={isBusy}
                  >
                    <option value="auto">Auto (recommended)</option>
                    <option value="off">Off (search only)</option>
                    <option value="required">Required (fail if unavailable)</option>
                  </select>
                </label>
                <label className="label cursor-pointer justify-start gap-2">
                  <GlassInput
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={groupByEventEnabled}
                    onChange={(event) => setGroupByEventEnabled(event.target.checked)}
                    disabled={isBusy}
                  />
                  <span className="label-text">Group Alerts By Event</span>
                </label>
                <label className="label cursor-pointer justify-start gap-2">
                  <GlassInput
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={constraintExtractionEnabled}
                    onChange={(event) => setConstraintExtractionEnabled(event.target.checked)}
                    disabled={isBusy}
                  />
                  <span className="label-text">Enable Constraint Extraction</span>
                </label>
                <label className="form-control">
                  <span className="label-text">Method</span>
                  <select
                    className="select select-bordered"
                    value={constraintExtractionMethod}
                    onChange={(event) =>
                      setConstraintExtractionMethod(event.target.value as ConstraintExtractionSystem)
                    }
                    disabled={isBusy || !constraintExtractionEnabled}
                  >
                    <option value="bypass">bypass</option>
                    <option value="heuristic-v1">heuristic-v1</option>
                    <option value="heuristic-v2">heuristic-v2</option>
                    <option value="rules-v2">rules-v2</option>
                    <option value="llm-v1">llm-v1</option>
                  </select>
                </label>
              </div>

              <h2 className="text-lg font-semibold">Optional Filter</h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <label className="form-control">
                  <span className="label-text">Source</span>
                  <GlassInput
                    className="input input-bordered"
                    value={source}
                    onChange={(event) => setSource(event.target.value)}
                    disabled={isBusy}
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">Event Type</span>
                  <GlassInput
                    className="input input-bordered"
                    value={eventType}
                    onChange={(event) => setEventType(event.target.value)}
                    disabled={isBusy}
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">Severity</span>
                  <GlassInput
                    className="input input-bordered"
                    value={severity}
                    onChange={(event) => setSeverity(event.target.value)}
                    disabled={isBusy}
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">State Codes (comma separated)</span>
                  <GlassInput
                    className="input input-bordered"
                    value={stateCodesText}
                    onChange={(event) => setStateCodesText(event.target.value)}
                    placeholder="CO, WY"
                    disabled={isBusy}
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">Effective From (ISO)</span>
                  <GlassInput
                    className="input input-bordered"
                    value={effectiveFrom}
                    onChange={(event) => setEffectiveFrom(event.target.value)}
                    placeholder="2026-02-15T00:00:00Z"
                    disabled={isBusy}
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">Effective To (ISO)</span>
                  <GlassInput
                    className="input input-bordered"
                    value={effectiveTo}
                    onChange={(event) => setEffectiveTo(event.target.value)}
                    placeholder="2026-02-16T00:00:00Z"
                    disabled={isBusy}
                  />
                </label>
              </div>

              {corpus === 'afd' && (
                <>
                  <h3 className="text-base font-semibold">AFD Filter</h3>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <label className="form-control">
                      <span className="label-text">AFD Issued From (ISO)</span>
                      <GlassInput
                        className="input input-bordered"
                        value={afdIssuedFrom}
                        onChange={(event) => setAfdIssuedFrom(event.target.value)}
                        placeholder="2026-02-15T00:00:00Z"
                        disabled={isBusy}
                      />
                    </label>
                    <label className="form-control">
                      <span className="label-text">AFD Issued To (ISO)</span>
                      <GlassInput
                        className="input input-bordered"
                        value={afdIssuedTo}
                        onChange={(event) => setAfdIssuedTo(event.target.value)}
                        placeholder="2026-02-16T23:59:59Z"
                        disabled={isBusy}
                      />
                    </label>
                    <label className="form-control">
                      <span className="label-text">AFD Sections (comma separated)</span>
                      <GlassInput
                        className="input input-bordered"
                        value={afdSectionsText}
                        onChange={(event) => setAfdSectionsText(event.target.value)}
                        placeholder="AVIATION, LONG TERM"
                        disabled={isBusy}
                      />
                    </label>
                  </div>
                </>
              )}
            </div>
          )}
        </form>
      </GlassCard>

      {error && (
        <GlassCard>
          <div className="card-body">
            <p className="text-error">{error}</p>
          </div>
        </GlassCard>
      )}

      <GlassCard>
        <div className="card-body gap-6">
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <section className="grid min-w-0 content-start gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="card-title">Conversation</h2>
                  <p className="text-xs text-base-content/60">
                    {conversationId ? `Thread ${conversationId.slice(0, 8)}...` : 'No saved thread yet'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs text-base-content/60">{conversationConnectText}</p>
                  <GlassButton
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void loadLatestConversation();
                    }}
                    disabled={activeAction === 'answer'}
                  >
                    {conversationMessages.length > 0 ? 'Reconnect' : 'Retry'}
                  </GlassButton>
                </div>
              </div>
              {conversationError && (
                <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-base-content">
                  <p className="font-medium text-warning">Latest conversation unavailable</p>
                  <p className="mt-1 text-base-content/80">{conversationError}</p>
                </div>
              )}
              {conversationLoading && conversationMessages.length === 0 && (
                <p className="text-base-content/70">
                  {conversationRetryAttempt > 0
                    ? `Reconnecting to the latest saved conversation...`
                    : 'Loading latest conversation...'}
                </p>
              )}
              {!conversationLoading && conversationMessages.length === 0 && (
                <p className="text-base-content/70">No conversation yet.</p>
              )}
              {conversationMessages.length > 0 && (
                <div className="grid gap-3">
                  {conversationMessages.map((message) => (
                    <article
                      key={message.id}
                      className={[
                        'rounded-2xl border p-4',
                        message.role === 'assistant'
                          ? 'mr-6 border-base-300 bg-base-200 text-base-content'
                          : 'ml-6 border-primary/20 bg-primary/10 text-base-content',
                      ].join(' ')}
                    >
                      <div className="mb-2 flex items-center justify-between gap-3 text-xs uppercase tracking-[0.18em] text-base-content/60">
                        <span>{message.role === 'assistant' ? 'Assistant' : 'User'}</span>
                        <span>{formatIsoForDisplay(message.createdAt)}</span>
                      </div>
                      {message.role === 'assistant' ? (
                        message.content.length > 0 ? (
                          <div className="overflow-x-auto text-sm text-base-content">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={MARKDOWN_COMPONENTS}
                            >
                              {message.content}
                            </ReactMarkdown>
                          </div>
                        ) : (
                          <p className="text-sm text-base-content/70">
                            {message.pending ? answerStageMessage ?? 'Generating answer...' : 'No content.'}
                          </p>
                        )
                      ) : (
                        <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
                      )}
                      {message.role === 'assistant' && message.metadata?.citations && message.metadata.citations.length > 0 && (
                        <div className="mt-4 grid gap-2 border-t border-base-300 pt-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-base-content/60">
                            Citations
                          </p>
                          {message.metadata.citations.map((citation) => (
                            <div key={citation.id} className="rounded-md bg-base-100 p-3 text-sm">
                              <div className="flex flex-wrap items-center gap-2 text-xs text-base-content/70">
                                <span className="font-semibold text-base-content">
                                  {citation.source ?? 'unknown source'}
                                </span>
                                <span>{getCitationDisplayLabel(citation)}</span>
                                <span
                                  className={`rounded-full px-2 py-0.5 font-medium ${getCitationOriginClassName(citation.origin)}`}
                                >
                                  {getCitationOriginLabel(citation.origin)}
                                </span>
                                {formatFreshness(citation.freshnessMs) && (
                                  <span className="rounded-full bg-base-300 px-2 py-0.5">
                                    {formatFreshness(citation.freshnessMs)}
                                  </span>
                                )}
                                {citation.fetchedAt && (
                                  <span>as of {formatIsoForDisplay(citation.fetchedAt)}</span>
                                )}
                              </div>
                              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                                {citation.snippet}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="grid content-start gap-4">
              <div className="rounded-md bg-base-200 p-3 text-sm">
                <h3 className="mb-2 font-semibold">Answer Details</h3>
                <p className="text-base-content/70">Status: {conversationStatusText}</p>
                {latestAssistantMetadata?.answerModel && (
                  <p className="text-base-content/70">Model: {latestAssistantMetadata.answerModel}</p>
                )}
                {latestAssistantMetadata?.historyMode && (
                  <p className="text-base-content/70">History mode: {latestAssistantMetadata.historyMode}</p>
                )}
                {latestAssistantMetadata?.promptSettings?.liveMode && (
                  <p className="text-base-content/70">
                    Requested live mode: {latestAssistantMetadata.promptSettings.liveMode}
                  </p>
                )}
                {latestAssistantMetadata?.liveContext && (
                  <div className="mt-2 rounded bg-base-100 p-3">
                    <p>
                      Live context: {latestAssistantMetadata.liveContext.status} · mode{' '}
                      {latestAssistantMetadata.liveContext.mode}
                    </p>
                    {latestAssistantMetadata.liveContext.fetchedAt && (
                      <p className="text-base-content/70">
                        Fetched: {formatIsoForDisplay(latestAssistantMetadata.liveContext.fetchedAt)}
                      </p>
                    )}
                    {latestAssistantMetadata.liveContext.sources.length > 0 && (
                      <div className="mt-2 grid gap-1 text-xs text-base-content/80">
                        {latestAssistantMetadata.liveContext.sources.map((sourceInfo) => (
                          <p key={`${sourceInfo.dataset}-${sourceInfo.origin}-${sourceInfo.sourceProduct ?? 'unknown'}`}>
                            {sourceInfo.dataset} · {sourceInfo.origin}
                            {sourceInfo.itemCount != null ? ` · ${sourceInfo.itemCount} items` : ''}
                            {sourceInfo.asOf ? ` · as of ${formatIsoForDisplay(sourceInfo.asOf)}` : ''}
                          </p>
                        ))}
                      </div>
                    )}
                    {latestAssistantMetadata.liveContext.warnings.length > 0 && (
                      <p className="mt-2 text-warning">
                        Live warnings: {latestAssistantMetadata.liveContext.warnings.join(' | ')}
                      </p>
                    )}
                  </div>
                )}
                {latestAssistantMetadata?.extraction && (
                  <div className="mt-2">
                    {(
                      latestAssistantMetadata.extraction.extractedFilter?.effectiveFrom ||
                      latestAssistantMetadata.extraction.extractedFilter?.effectiveTo
                    ) && (
                      <p className="text-base-content/80">
                        Inferred timeframe:{" "}
                        {formatIsoForDisplay(
                          latestAssistantMetadata.extraction.extractedFilter?.effectiveFrom ??
                            "unspecified start",
                        )}{" "}
                        →{" "}
                        {formatIsoForDisplay(
                          latestAssistantMetadata.extraction.extractedFilter?.effectiveTo ??
                            "unspecified end",
                        )}
                      </p>
                    )}
                    <p>
                      Extraction: {latestAssistantMetadata.extraction.appliedSystem} (requested:{' '}
                      {latestAssistantMetadata.extraction.requestedSystem})
                    </p>
                    <p>
                      Enabled: {String(latestAssistantMetadata.extraction.enabled)} · Fallback:{' '}
                      {String(latestAssistantMetadata.extraction.fallbackApplied)}
                    </p>
                    {typeof latestAssistantMetadata.extraction.confidence === 'number' && (
                      <p>Confidence: {latestAssistantMetadata.extraction.confidence.toFixed(2)}</p>
                    )}
                    {latestAssistantMetadata.extraction.signals && latestAssistantMetadata.extraction.signals.length > 0 && (
                      <p>Signals: {latestAssistantMetadata.extraction.signals.join(', ')}</p>
                    )}
                    {latestAssistantMetadata.extraction.detectedEventTypes.length > 0 && (
                      <p>
                        Detected event types: {latestAssistantMetadata.extraction.detectedEventTypes.join(', ')}
                      </p>
                    )}
                    {latestAssistantMetadata.extraction.warnings.length > 0 && (
                      <p className="text-warning">
                        Warnings: {latestAssistantMetadata.extraction.warnings.join(' | ')}
                      </p>
                    )}
                    {latestAssistantMetadata.extraction.mergedFilter && (
                      <pre className="mt-2 whitespace-pre-wrap rounded bg-base-100 p-2 text-xs">
                        {JSON.stringify(latestAssistantMetadata.extraction.mergedFilter, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
              <h2 className="card-title">Search Results</h2>
              {!displayedSearchResult && <p className="text-base-content/70">No search run yet.</p>}
              {displayedSearchResult && (
                <>
                  <p className="text-base-content/70">
                    Corpus: {displayedSearchResult.corpus} · Model: {displayedSearchResult.model} · Collection:{' '}
                    {displayedSearchResult.collection} · Hits:{' '}
                    {displayedSearchResult.hits.length}
                  </p>
                  <List className="grid min-w-0 gap-3 p-3">
                    {displayedSearchResult.hits.map((hit) => (
                      <div key={hit.id} className="overflow-hidden rounded-md bg-base-200 p-3">
                        <p className="text-sm font-semibold break-all">
                          {hit.source ?? 'unknown source'} · {hit.citationLabel ?? getNwsCitationLabel(hit.metadata) ?? 'unknown nwsId'} · score {hit.score.toFixed(4)}
                        </p>
                        {(hit.afdSectionName || hit.afdIssuedAt) && (
                          <p className="text-xs text-base-content/70 break-words">
                            {hit.afdSectionName ? `Section: ${hit.afdSectionName}` : 'Section: unknown'}
                            {hit.afdIssuedAt ? ` · Issued: ${formatIsoForDisplay(hit.afdIssuedAt)}` : ''}
                          </p>
                        )}
                        <p className="text-sm break-words">{hit.snippet}</p>
                      </div>
                    ))}
                  </List>
                </>
              )}
            </section>
          </div>
        </div>
      </GlassCard>
    </div>
    </>
  );
}

export default PromptPage;
