import { FormEvent, useEffect, useMemo, useState } from 'react';
import GlassCard from '../components/common/GlassCard';
import GlassButton from '../components/common/GlassButton';
import GlassInput from '../components/common/GlassInput';

interface AdminFilter {
  source?: string;
  eventType?: string;
  severity?: string;
  stateCodes?: string[];
}

interface ApiResult {
  status: 'idle' | 'loading' | 'success' | 'error';
  payload: unknown;
  message?: string;
  action?: string;
}

interface ToastState {
  type: 'success' | 'error';
  title: string;
  message: string;
}

const DEFAULT_API_BASE_URL =
  import.meta.env.VITE_WEATHER_LLM_API_BASE_URL ?? 'http://localhost:3000';

function parseStateCodes(raw: string): string[] | undefined {
  const values = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return values.length ? values : undefined;
}

function buildFilter(
  source: string,
  eventType: string,
  severity: string,
  stateCodesText: string,
): AdminFilter | undefined {
  const filter: AdminFilter = {
    source: source.trim() || undefined,
    eventType: eventType.trim() || undefined,
    severity: severity.trim() || undefined,
    stateCodes: parseStateCodes(stateCodesText),
  };

  if (!filter.source && !filter.eventType && !filter.severity && !filter.stateCodes?.length) {
    return undefined;
  }

  return filter;
}

async function callAdminApi(
  apiBaseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const bodyText = await response.text();
  const jsonBody = bodyText ? JSON.parse(bodyText) : null;

  if (!response.ok) {
    const errorMessage =
      typeof jsonBody?.message === 'string'
        ? jsonBody.message
        : `Request failed with status ${response.status}`;

    throw new Error(errorMessage);
  }

  return jsonBody;
}

function SettingsPage() {
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL);
  const [source, setSource] = useState('');
  const [eventType, setEventType] = useState('');
  const [severity, setSeverity] = useState('');
  const [stateCodesText, setStateCodesText] = useState('');
  const [deleteDryRun, setDeleteDryRun] = useState(true);
  const [reindexDryRun, setReindexDryRun] = useState(true);
  const [reindexLimit, setReindexLimit] = useState('200');
  const [reindexBatchSize, setReindexBatchSize] = useState('50');
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetVectorSize, setResetVectorSize] = useState('');

  const [result, setResult] = useState<ApiResult>({
    status: 'idle',
    payload: null,
  });
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const activeFilter = useMemo(
    () => buildFilter(source, eventType, severity, stateCodesText),
    [eventType, severity, source, stateCodesText],
  );

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setToast(null);
    }, 3500);

    return () => window.clearTimeout(timeout);
  }, [toast]);

  async function runAction(actionName: string, action: () => Promise<unknown>) {
    setActiveAction(actionName);
    setResult({ status: 'loading', payload: null, action: actionName });

    try {
      const payload = await action();
      setResult({ status: 'success', payload, action: actionName });
      setToast({
        type: 'success',
        title: `${actionName} complete`,
        message: 'Request finished successfully.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setResult({
        status: 'error',
        payload: null,
        message,
        action: actionName,
      });
      setToast({
        type: 'error',
        title: `${actionName} failed`,
        message,
      });
    } finally {
      setActiveAction(null);
    }
  }

  async function handleGetStats() {
    await runAction('Get Stats', async () => {
      return callAdminApi(apiBaseUrl, '/nws-alerts/admin/collections/stats');
    });
  }

  async function handleDeleteByFilter(event: FormEvent) {
    event.preventDefault();

    if (!activeFilter) {
      setResult({
        status: 'error',
        payload: null,
        message: 'Delete by filter requires at least one filter field.',
        action: 'Delete By Filter',
      });
      setToast({
        type: 'error',
        title: 'Delete By Filter failed',
        message: 'Delete by filter requires at least one filter field.',
      });
      return;
    }

    await runAction('Delete By Filter', async () => {
      return callAdminApi(apiBaseUrl, '/nws-alerts/admin/delete-by-filter', {
        method: 'POST',
        body: JSON.stringify({
          filter: activeFilter,
          dryRun: deleteDryRun,
        }),
      });
    });
  }

  async function handleReindex(event: FormEvent) {
    event.preventDefault();

    const limit = Number.parseInt(reindexLimit, 10);
    const batchSize = Number.parseInt(reindexBatchSize, 10);

    await runAction('Reindex', async () => {
      return callAdminApi(apiBaseUrl, '/nws-alerts/admin/reindex', {
        method: 'POST',
        body: JSON.stringify({
          filter: activeFilter,
          dryRun: reindexDryRun,
          limit: Number.isFinite(limit) ? limit : undefined,
          batchSize: Number.isFinite(batchSize) ? batchSize : undefined,
        }),
      });
    });
  }

  async function handleResetCollection(event: FormEvent) {
    event.preventDefault();

    await runAction('Reset Collection', async () => {
      const parsedVectorSize = Number.parseInt(resetVectorSize, 10);

      return callAdminApi(apiBaseUrl, '/nws-alerts/admin/collections/reset', {
        method: 'POST',
        body: JSON.stringify({
          confirm: resetConfirm,
          vectorSize: Number.isFinite(parsedVectorSize) ? parsedVectorSize : undefined,
        }),
      });
    });
  }


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
      {toast && (
        <div className="toast toast-top toast-end">
          <div className={`alert ${toast.type === 'success' ? 'alert-success' : 'alert-error'}`}>
            <div>
              <p className="font-semibold">{toast.title}</p>
              <p>{toast.message}</p>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
      <GlassCard className="lg:col-span-2">
        <div className="card-body">
          <h1 className="card-title text-2xl">Admin Settings</h1>
          <p className="text-base-content/80">Interact with weather-llm-api admin functions.</p>
          <label className="form-control w-full max-w-xl">
            <span className="label-text">API Base URL</span>
            <GlassInput
              className="input input-bordered"
              value={apiBaseUrl}
              onChange={(event) => setApiBaseUrl(event.target.value)}
              placeholder="http://localhost:3000"
            />
          </label>
        </div>
      </GlassCard>

      <GlassCard>
        <div className="card-body gap-4">
          <h2 className="card-title">Collection Stats</h2>
          <GlassButton
            tint="primary"
            onClick={handleGetStats}
            disabled={activeAction !== null}
            loading={activeAction === 'Get Stats'}
            loadingText="Running..."
          >
            Get Stats
          </GlassButton>
        </div>
      </GlassCard>

      <GlassCard>
        <form className="card-body gap-4" onSubmit={handleDeleteByFilter}>
          <h2 className="card-title">Delete By Filter</h2>
          <label className="label cursor-pointer justify-start gap-3">
            <GlassInput
              className="checkbox"
              type="checkbox"
              checked={deleteDryRun}
              onChange={(event) => setDeleteDryRun(event.target.checked)}
            />
            <span className="label-text">Dry Run</span>
          </label>
          <GlassButton
            tint="warning"
            type="submit"
            disabled={activeAction !== null}
            loading={activeAction === 'Delete By Filter'}
            loadingText="Running..."
          >
            Run Delete
          </GlassButton>
        </form>
      </GlassCard>

      <GlassCard className="lg:col-span-2">
        <form className="card-body gap-4" onSubmit={handleReindex}>
          <h2 className="card-title">Reindex</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="form-control">
              <span className="label-text">Limit</span>
              <GlassInput
                className="input input-bordered"
                type="number"
                min={1}
                value={reindexLimit}
                onChange={(event) => setReindexLimit(event.target.value)}
              />
            </label>
            <label className="form-control">
              <span className="label-text">Batch Size</span>
              <GlassInput
                className="input input-bordered"
                type="number"
                min={1}
                value={reindexBatchSize}
                onChange={(event) => setReindexBatchSize(event.target.value)}
              />
            </label>
          </div>
          <label className="label cursor-pointer justify-start gap-3">
            <GlassInput
              className="checkbox"
              type="checkbox"
              checked={reindexDryRun}
              onChange={(event) => setReindexDryRun(event.target.checked)}
            />
            <span className="label-text">Dry Run</span>
          </label>
          <GlassButton
            tint="primary"
            type="submit"
            disabled={activeAction !== null}
            loading={activeAction === 'Reindex'}
            loadingText="Running..."
          >
            Run Reindex
          </GlassButton>
        </form>
      </GlassCard>

      <GlassCard className="lg:col-span-2">
        <form className="card-body gap-4" onSubmit={handleResetCollection}>
          <h2 className="card-title">Reset Collection</h2>
          <label className="form-control max-w-sm">
            <span className="label-text">Vector Size (optional)</span>
            <GlassInput
              className="input input-bordered"
              type="number"
              min={1}
              value={resetVectorSize}
              onChange={(event) => setResetVectorSize(event.target.value)}
            />
          </label>
          <label className="label cursor-pointer justify-start gap-3">
            <GlassInput
              className="checkbox checkbox-error"
              type="checkbox"
              checked={resetConfirm}
              onChange={(event) => setResetConfirm(event.target.checked)}
            />
            <span className="label-text text-error">I confirm collection reset</span>
          </label>
          <GlassButton
            tint="error"
            type="submit"
            disabled={activeAction !== null}
            loading={activeAction === 'Reset Collection'}
            loadingText="Running..."
          >
            Reset Collection
          </GlassButton>
        </form>
      </GlassCard>

      <GlassCard className="lg:col-span-2">
        <div className="card-body">
          <h2 className="card-title">Shared Filter</h2>
          <p className="text-base-content/80">
            Used by Delete By Filter and Reindex. Leave blank to run Reindex over all points.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="form-control">
              <span className="label-text">Source</span>
              <GlassInput
                className="input input-bordered"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder="nws"
              />
            </label>
            <label className="form-control">
              <span className="label-text">Event Type</span>
              <GlassInput
                className="input input-bordered"
                value={eventType}
                onChange={(event) => setEventType(event.target.value)}
                placeholder="Winter Storm Warning"
              />
            </label>
            <label className="form-control">
              <span className="label-text">Severity</span>
              <GlassInput
                className="input input-bordered"
                value={severity}
                onChange={(event) => setSeverity(event.target.value)}
                placeholder="Severe"
              />
            </label>
            <label className="form-control">
              <span className="label-text">State Codes (comma separated)</span>
              <GlassInput
                className="input input-bordered"
                value={stateCodesText}
                onChange={(event) => setStateCodesText(event.target.value)}
                placeholder="CO, WY"
              />
            </label>
          </div>
        </div>
      </GlassCard>

      <GlassCard className="lg:col-span-2">
        <div className="card-body">
          <h2 className="card-title">Last Result</h2>
          {result.action && <p className="text-base-content/80">Action: {result.action}</p>}
          {result.status === 'loading' && <p>Running request...</p>}
          {result.status === 'error' && <p className="text-error">{result.message}</p>}
          {result.status === 'success' && (
            <pre className="max-h-96 overflow-auto rounded-md bg-base-200 p-4 text-sm">
              {JSON.stringify(result.payload, null, 2)}
            </pre>
          )}
          {result.status === 'idle' && (
            <p className="text-base-content/70">Run an action to view response output.</p>
          )}
        </div>
      </GlassCard>
      </div>
    </>
  );
}

export default SettingsPage;
