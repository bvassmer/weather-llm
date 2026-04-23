import { FormEvent, useEffect, useState } from 'react';
import GlassCard from '../components/common/GlassCard';
import GlassButton from '../components/common/GlassButton';
import GlassInput from '../components/common/GlassInput';
import List from '../components/common/List';

interface QueueStatsResponse {
  totals: Record<string, number>;
  oldestPendingAt: string | null;
  oldestRetryingAt: string | null;
}

interface DeadQueueJob {
  id: number;
  dedupeKey: string;
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  deadLetteredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RetryDeadJobsResponse {
  retried: number;
}

interface EnqueueAlertsBackfillResponse {
  runId: string;
  cursorId: number;
  nextCursorId: number;
  snapshotMaxId: number;
  rowsRead: number;
  accepted: number;
  enqueued: number;
  duplicate: number;
  skippedInvalid: number;
  dryRun: boolean;
  hasMore: boolean;
}

const DEFAULT_API_BASE_URL =
  import.meta.env.VITE_WEATHER_LLM_API_BASE_URL ?? 'http://localhost:3000';

async function getJson<TResponse>(apiBaseUrl: string, path: string): Promise<TResponse> {
  const response = await fetch(`${apiBaseUrl}${path}`);
  const responseText = await response.text();
  const contentType = response.headers.get('content-type');
  if (responseText && contentType && !contentType.includes('application/json')) {
    throw new Error(`Expected JSON response but received ${contentType} (status ${response.status})`);
  }
  const data = responseText ? JSON.parse(responseText) : null;

  if (!response.ok) {
    const message =
      typeof data?.message === 'string'
        ? data.message
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data as TResponse;
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

  const responseText = await response.text();
  const data = responseText ? JSON.parse(responseText) : null;

  if (!response.ok) {
    const message =
      typeof data?.message === 'string'
        ? data.message
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data as TResponse;
}

function QueuePage() {
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL);
  const [queueStats, setQueueStats] = useState<QueueStatsResponse | null>(null);
  const [deadQueueJobs, setDeadQueueJobs] = useState<DeadQueueJob[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueActionLoading, setQueueActionLoading] = useState(false);

  const [deadQueueLimitText, setDeadQueueLimitText] = useState('25');
  const [retryDeadJobIdsText, setRetryDeadJobIdsText] = useState('');
  const [autoRefreshQueue, setAutoRefreshQueue] = useState(true);
  const [queueRefreshIntervalSecText, setQueueRefreshIntervalSecText] = useState('15');

  const [backfillCursorId, setBackfillCursorId] = useState('0');
  const [backfillLimit, setBackfillLimit] = useState('500');
  const [backfillSnapshotMaxId, setBackfillSnapshotMaxId] = useState('');
  const [backfillDryRun, setBackfillDryRun] = useState(false);
  const [lastResult, setLastResult] = useState<unknown>(null);

  async function refreshQueueStats() {
    const stats = await getJson<QueueStatsResponse>(apiBaseUrl, '/nws-alerts/admin/queue/stats');
    setQueueStats(stats);
  }

  async function refreshDeadQueueJobs() {
    const limit = Number.parseInt(deadQueueLimitText, 10);
    const rows = await postJson<DeadQueueJob[]>(apiBaseUrl, '/nws-alerts/admin/queue/dead', {
      limit: Number.isFinite(limit) && limit > 0 ? limit : 25,
    });
    setDeadQueueJobs(rows);
  }

  async function refreshQueueData() {
    setQueueLoading(true);
    setQueueError(null);

    try {
      await Promise.all([refreshQueueStats(), refreshDeadQueueJobs()]);
    } catch (requestError) {
      setQueueError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setQueueLoading(false);
    }
  }

  async function handleRetryDeadJobs(retryAll = false) {
    setQueueActionLoading(true);
    setQueueError(null);

    const ids = retryAll
      ? []
      : retryDeadJobIdsText
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
          .map((value) => Number.parseInt(value, 10))
          .filter((value) => Number.isFinite(value) && value > 0);

    try {
      const result = await postJson<RetryDeadJobsResponse>(
        apiBaseUrl,
        '/nws-alerts/admin/queue/retry-dead',
        {
          ids: ids.length ? ids : undefined,
        },
      );

      if (retryAll || !ids.length) {
        setRetryDeadJobIdsText('');
      }

      setLastResult(result);
      await refreshQueueData();
    } catch (requestError) {
      setQueueError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setQueueActionLoading(false);
    }
  }

  async function handleEnqueueAlertsBackfill(event: FormEvent) {
    event.preventDefault();
    setQueueActionLoading(true);
    setQueueError(null);

    const cursorId = Number.parseInt(backfillCursorId, 10);
    const limit = Number.parseInt(backfillLimit, 10);
    const snapshotMaxId = Number.parseInt(backfillSnapshotMaxId, 10);

    try {
      const response = await postJson<EnqueueAlertsBackfillResponse>(
        apiBaseUrl,
        '/nws-alerts/admin/embeddings/backfill:enqueue',
        {
          cursorId: Number.isFinite(cursorId) ? cursorId : undefined,
          limit: Number.isFinite(limit) ? limit : undefined,
          snapshotMaxId: Number.isFinite(snapshotMaxId) ? snapshotMaxId : undefined,
          dryRun: backfillDryRun,
        },
      );

      setLastResult(response);

      if (Number.isFinite(response.nextCursorId)) {
        setBackfillCursorId(String(response.nextCursorId));
      }

      if (!Number.isFinite(snapshotMaxId) && Number.isFinite(response.snapshotMaxId)) {
        setBackfillSnapshotMaxId(String(response.snapshotMaxId));
      }

      await refreshQueueData();
    } catch (requestError) {
      setQueueError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setQueueActionLoading(false);
    }
  }

  useEffect(() => {
    void refreshQueueData();
  }, [apiBaseUrl]);

  useEffect(() => {
    if (!autoRefreshQueue) {
      return;
    }

    const seconds = Number.parseInt(queueRefreshIntervalSecText, 10);
    const intervalMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 15000;

    const timer = window.setInterval(() => {
      void refreshQueueData();
    }, intervalMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [autoRefreshQueue, queueRefreshIntervalSecText, apiBaseUrl, deadQueueLimitText]);

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
      <div className="grid gap-6 lg:grid-cols-2">
      <GlassCard className="lg:col-span-2">
        <div className="card-body gap-4">
          <h1 className="card-title text-2xl">Queue</h1>
          <p className="text-base-content/80">Embedding queue health, dead-letter management, and backfill controls.</p>

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

      <GlassCard className="lg:col-span-2">
        <div className="card-body gap-4">
          <div className="flex items-center justify-between">
            <h2 className="card-title">Embedding Queue Health</h2>
            <GlassButton
              size="sm"
              variant="outline"
              onClick={() => void refreshQueueData()}
              disabled={queueLoading || queueActionLoading}
              loading={queueLoading}
              loadingText="Refreshing..."
            >
              Refresh
            </GlassButton>
          </div>

          <div className="grid gap-3 md:grid-cols-[auto_auto_1fr]">
            <label className="label cursor-pointer justify-start gap-2">
              <GlassInput
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={autoRefreshQueue}
                onChange={(event) => setAutoRefreshQueue(event.target.checked)}
              />
              <span className="label-text">Auto-refresh</span>
            </label>
            <label className="form-control max-w-28">
              <span className="label-text">Seconds</span>
              <GlassInput
                className="input input-bordered input-sm"
                value={queueRefreshIntervalSecText}
                onChange={(event) => setQueueRefreshIntervalSecText(event.target.value)}
                disabled={!autoRefreshQueue}
              />
            </label>
            <label className="form-control max-w-40">
              <span className="label-text">Dead jobs limit</span>
              <GlassInput
                className="input input-bordered input-sm"
                value={deadQueueLimitText}
                onChange={(event) => setDeadQueueLimitText(event.target.value)}
              />
            </label>
          </div>

          {queueError && <p className="text-error">{queueError}</p>}

          {!queueStats && !queueError && (
            <p className="text-base-content/70">No queue stats loaded yet.</p>
          )}

          {queueStats && (
            <>
              <div className="grid gap-3 md:grid-cols-5">
                <div className="rounded-md bg-base-200 p-3 text-sm">Pending: {queueStats.totals.pending ?? 0}</div>
                <div className="rounded-md bg-base-200 p-3 text-sm">Retrying: {queueStats.totals.retrying ?? 0}</div>
                <div className="rounded-md bg-base-200 p-3 text-sm">Processing: {queueStats.totals.processing ?? 0}</div>
                <div className="rounded-md bg-base-200 p-3 text-sm">Completed: {queueStats.totals.completed ?? 0}</div>
                <div className="rounded-md bg-base-200 p-3 text-sm">Dead: {queueStats.totals.dead ?? 0}</div>
              </div>
              <p className="text-sm text-base-content/70">
                Oldest pending: {queueStats.oldestPendingAt ?? 'n/a'}
              </p>
              <p className="text-sm text-base-content/70">
                Oldest retrying: {queueStats.oldestRetryingAt ?? 'n/a'}
              </p>
            </>
          )}

          <div className="divider my-1" />
          <h3 className="text-lg font-semibold">Dead-letter Jobs</h3>

          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <label className="form-control">
              <span className="label-text">Retry specific IDs (comma separated)</span>
              <GlassInput
                className="input input-bordered"
                value={retryDeadJobIdsText}
                onChange={(event) => setRetryDeadJobIdsText(event.target.value)}
                placeholder="12, 18, 24"
              />
            </label>
            <GlassButton
              tint="warning"
              className="self-end"
              type="button"
              onClick={() => void handleRetryDeadJobs()}
              disabled={queueActionLoading}
              loading={queueActionLoading}
              loadingText="Retrying..."
            >
              Retry Selected
            </GlassButton>
            <GlassButton
              tint="warning"
              variant="outline"
              className="self-end"
              type="button"
              onClick={() => {
                setRetryDeadJobIdsText('');
                void handleRetryDeadJobs(true);
              }}
              disabled={queueActionLoading}
            >
              Retry All Dead
            </GlassButton>
          </div>

          {deadQueueJobs.length === 0 ? (
            <p className="text-base-content/70">No dead-letter jobs found.</p>
          ) : (
            <List className="max-h-72 overflow-auto p-2">
              <table className="table table-xs">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Attempts</th>
                    <th>Dead At</th>
                    <th>Key</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {deadQueueJobs.map((job) => (
                    <tr key={job.id}>
                      <td>{job.id}</td>
                      <td>
                        {job.attemptCount}/{job.maxAttempts}
                      </td>
                      <td>{job.deadLetteredAt ?? 'n/a'}</td>
                      <td className="max-w-64 truncate" title={job.dedupeKey}>
                        {job.dedupeKey}
                      </td>
                      <td className="max-w-96 truncate" title={job.lastError ?? ''}>
                        {job.lastError ?? 'n/a'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </List>
          )}
        </div>
      </GlassCard>

      <GlassCard className="lg:col-span-2">
        <form className="card-body gap-4" onSubmit={handleEnqueueAlertsBackfill}>
          <h2 className="card-title">Ensure Alerts Embeddings</h2>
          <p className="text-base-content/80">
            Enqueue a backfill batch from the Alerts DB table. Keep running until <strong>hasMore</strong> is false.
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="form-control">
              <span className="label-text">Cursor ID</span>
              <GlassInput
                className="input input-bordered"
                type="number"
                min={0}
                value={backfillCursorId}
                onChange={(event) => setBackfillCursorId(event.target.value)}
              />
            </label>
            <label className="form-control">
              <span className="label-text">Batch Limit</span>
              <GlassInput
                className="input input-bordered"
                type="number"
                min={1}
                value={backfillLimit}
                onChange={(event) => setBackfillLimit(event.target.value)}
              />
            </label>
            <label className="form-control">
              <span className="label-text">Snapshot Max ID (optional)</span>
              <GlassInput
                className="input input-bordered"
                type="number"
                min={0}
                value={backfillSnapshotMaxId}
                onChange={(event) => setBackfillSnapshotMaxId(event.target.value)}
                placeholder="auto"
              />
            </label>
          </div>
          <label className="label cursor-pointer justify-start gap-3">
            <GlassInput
              className="checkbox"
              type="checkbox"
              checked={backfillDryRun}
              onChange={(event) => setBackfillDryRun(event.target.checked)}
            />
            <span className="label-text">Dry Run</span>
          </label>
          <GlassButton
            tint="primary"
            type="submit"
            disabled={queueActionLoading}
            loading={queueActionLoading}
            loadingText="Running..."
          >
            Enqueue Backfill Batch
          </GlassButton>
        </form>
      </GlassCard>

      <GlassCard className="lg:col-span-2">
        <div className="card-body">
          <h2 className="card-title">Last Queue Action Result</h2>
          {!lastResult && (
            <p className="text-base-content/70">Run a queue action to view response output.</p>
          )}
          {lastResult !== null && lastResult !== undefined && (
            <pre className="max-h-96 overflow-auto rounded-md bg-base-200 p-4 text-sm">
              {JSON.stringify(lastResult, null, 2)}
            </pre>
          )}
        </div>
      </GlassCard>
    </div>
    </>
  );
}

export default QueuePage;
