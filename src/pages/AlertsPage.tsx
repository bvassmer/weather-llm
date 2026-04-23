import { FormEvent, useEffect, useMemo, useState } from 'react';
import GlassCard from '../components/common/GlassCard';
import GlassButton from '../components/common/GlassButton';
import GlassInput from '../components/common/GlassInput';
import List from '../components/common/List';

type SortBy = 'event' | 'headline' | 'effectiveAt' | 'id';
type SortDir = 'asc' | 'desc';

interface AlertListItem {
  id: number;
  event: string | null;
  headline: string | null;
  effectiveAt: string | null;
}

interface AlertsListResponse {
  items: AlertListItem[];
  page: number;
  pageSize: number;
  total: number;
  sortBy: SortBy;
  sortDir: SortDir;
}

interface AlertDetails {
  id: number;
  nwsId: string | null;
  event: string | null;
  headline: string | null;
  description: string | null;
  shortDescription: string | null;
  geometry: string | null;
  sent: string | null;
  effective: string | null;
  onset: string | null;
  expires: string | null;
  ends: string | null;
}

interface AlertUpdateRequest {
  nwsId: string | null;
  event: string | null;
  headline: string | null;
  description: string | null;
  shortDescription: string | null;
  geometry: string | null;
  sent: string | null;
  effective: string | null;
  onset: string | null;
  expires: string | null;
  ends: string | null;
}

const DEFAULT_API_BASE_URL =
  import.meta.env.VITE_WEATHER_LLM_API_BASE_URL ?? 'http://localhost:3000';

function formatDate(value: string | null): string {
  if (!value) {
    return 'n/a';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function toEditable(value: string | null): string {
  return value ?? '';
}

function normalizeFormValue(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

async function getJson<TResponse>(apiBaseUrl: string, path: string): Promise<TResponse> {
  const response = await fetch(`${apiBaseUrl}${path}`);
  const bodyText = await response.text();
  const contentType = response.headers.get('content-type');
  if (bodyText && contentType && !contentType.includes('application/json')) {
    throw new Error(`Expected JSON response but received ${contentType} (status ${response.status})`);
  }
  const body = bodyText ? JSON.parse(bodyText) : null;

  if (!response.ok) {
    const message =
      typeof body?.message === 'string'
        ? body.message
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return body as TResponse;
}

async function callJson<TResponse>(
  apiBaseUrl: string,
  path: string,
  init: RequestInit,
): Promise<TResponse> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    ...init,
  });

  const bodyText = await response.text();
  const body = bodyText ? JSON.parse(bodyText) : null;

  if (!response.ok) {
    const message =
      typeof body?.message === 'string'
        ? body.message
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return body as TResponse;
}

function AlertsPage() {
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL);
  const [queryText, setQueryText] = useState('');
  const [eventFilter, setEventFilter] = useState('');
  const [headlineFilter, setHeadlineFilter] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('effectiveAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [listResult, setListResult] = useState<AlertsListResponse | null>(null);

  const [selectedAlert, setSelectedAlert] = useState<AlertDetails | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const [editNwsId, setEditNwsId] = useState('');
  const [editEvent, setEditEvent] = useState('');
  const [editHeadline, setEditHeadline] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editShortDescription, setEditShortDescription] = useState('');
  const [editGeometry, setEditGeometry] = useState('');
  const [editSent, setEditSent] = useState('');
  const [editEffective, setEditEffective] = useState('');
  const [editOnset, setEditOnset] = useState('');
  const [editExpires, setEditExpires] = useState('');
  const [editEnds, setEditEnds] = useState('');

  const totalPages = useMemo(() => {
    if (!listResult) {
      return 1;
    }

    return Math.max(1, Math.ceil(listResult.total / listResult.pageSize));
  }, [listResult]);

  async function fetchAlerts(nextPage = page) {
    setLoading(true);
    setError(null);

    const searchParams = new URLSearchParams();
    if (queryText.trim()) {
      searchParams.set('query', queryText.trim());
    }
    if (eventFilter.trim()) {
      searchParams.set('event', eventFilter.trim());
    }
    if (headlineFilter.trim()) {
      searchParams.set('headline', headlineFilter.trim());
    }
    if (effectiveFrom.trim()) {
      searchParams.set('effectiveFrom', effectiveFrom.trim());
    }
    if (effectiveTo.trim()) {
      searchParams.set('effectiveTo', effectiveTo.trim());
    }

    searchParams.set('sortBy', sortBy);
    searchParams.set('sortDir', sortDir);
    searchParams.set('page', String(nextPage));
    searchParams.set('pageSize', String(pageSize));

    try {
      const result = await getJson<AlertsListResponse>(
        apiBaseUrl,
        `/nws-alerts/alerts?${searchParams.toString()}`,
      );
      setListResult(result);
      setPage(result.page);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function fetchAlertDetails(alertId: number, openInEditMode = false) {
    setSaving(true);
    setError(null);

    try {
      const details = await getJson<AlertDetails>(apiBaseUrl, `/nws-alerts/alerts/${alertId}`);
      setSelectedAlert(details);
      setEditNwsId(toEditable(details.nwsId));
      setEditEvent(toEditable(details.event));
      setEditHeadline(toEditable(details.headline));
      setEditDescription(toEditable(details.description));
      setEditShortDescription(toEditable(details.shortDescription));
      setEditGeometry(toEditable(details.geometry));
      setEditSent(toEditable(details.sent));
      setEditEffective(toEditable(details.effective));
      setEditOnset(toEditable(details.onset));
      setEditExpires(toEditable(details.expires));
      setEditEnds(toEditable(details.ends));
      setEditMode(openInEditMode);
      setDrawerOpen(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveChanges(event: FormEvent) {
    event.preventDefault();

    if (!selectedAlert) {
      return;
    }

    setSaving(true);
    setError(null);

    const payload: AlertUpdateRequest = {
      nwsId: normalizeFormValue(editNwsId),
      event: normalizeFormValue(editEvent),
      headline: normalizeFormValue(editHeadline),
      description: normalizeFormValue(editDescription),
      shortDescription: normalizeFormValue(editShortDescription),
      geometry: normalizeFormValue(editGeometry),
      sent: normalizeFormValue(editSent),
      effective: normalizeFormValue(editEffective),
      onset: normalizeFormValue(editOnset),
      expires: normalizeFormValue(editExpires),
      ends: normalizeFormValue(editEnds),
    };

    try {
      const updated = await callJson<AlertDetails>(apiBaseUrl, `/nws-alerts/alerts/${selectedAlert.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      setSelectedAlert(updated);
      setEditMode(false);
      await fetchAlerts(page);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAlert(alertId: number) {
    const confirmed = window.confirm(`Delete alert ${alertId}?`);
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setDeleteError(null);

    // Optimistic removal
    const snapshot = listResult;
    setListResult((prev) =>
      prev
        ? { ...prev, items: prev.items.filter((a) => a.id !== alertId), total: prev.total - 1 }
        : prev,
    );

    try {
      await callJson<{ id: number; deleted: boolean }>(apiBaseUrl, `/nws-alerts/alerts/${alertId}`, {
        method: 'DELETE',
      });

      if (selectedAlert?.id === alertId) {
        setDrawerOpen(false);
        setSelectedAlert(null);
        setEditMode(false);
      }

      await fetchAlerts(page);
    } catch (requestError) {
      setListResult(snapshot);
      setDeleteError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setSaving(false);
    }
  }

  function handleSort(column: SortBy) {
    if (sortBy === column) {
      setSortDir((previous) => (previous === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortBy(column);
    setSortDir(column === 'effectiveAt' ? 'desc' : 'asc');
  }

  function handleFilterSubmit(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    void fetchAlerts(1);
  }

  useEffect(() => {
    void fetchAlerts(1);
  }, [apiBaseUrl, sortBy, sortDir]);

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
          <form className="card-body gap-4" onSubmit={handleFilterSubmit}>
            <h1 className="card-title text-2xl">Alerts</h1>
            <p className="text-base-content/80">Filter and sort weather alerts, then open a row for details.</p>

            <label className="form-control max-w-xl">
              <span className="label-text">API Base URL</span>
              <GlassInput
                className="input input-bordered"
                value={apiBaseUrl}
                onChange={(event) => setApiBaseUrl(event.target.value)}
                placeholder="http://localhost:3000"
              />
            </label>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
              <label className="form-control lg:col-span-2">
                <span className="label-text">Search</span>
                <GlassInput
                  className="input input-bordered"
                  value={queryText}
                  onChange={(event) => setQueryText(event.target.value)}
                  placeholder="Search event, headline, description, nwsId"
                />
              </label>
              <label className="form-control">
                <span className="label-text">Event</span>
                <GlassInput
                  className="input input-bordered"
                  value={eventFilter}
                  onChange={(event) => setEventFilter(event.target.value)}
                />
              </label>
              <label className="form-control">
                <span className="label-text">Headline</span>
                <GlassInput
                  className="input input-bordered"
                  value={headlineFilter}
                  onChange={(event) => setHeadlineFilter(event.target.value)}
                />
              </label>
              <label className="form-control">
                <span className="label-text">Effective From (ISO)</span>
                <GlassInput
                  className="input input-bordered"
                  value={effectiveFrom}
                  onChange={(event) => setEffectiveFrom(event.target.value)}
                  placeholder="2026-02-15T00:00:00Z"
                />
              </label>
              <label className="form-control">
                <span className="label-text">Effective To (ISO)</span>
                <GlassInput
                  className="input input-bordered"
                  value={effectiveTo}
                  onChange={(event) => setEffectiveTo(event.target.value)}
                  placeholder="2026-02-16T00:00:00Z"
                />
              </label>
            </div>

            <div className="card-actions justify-end">
              <GlassButton
                variant="outline"
                type="button"
                onClick={() => void fetchAlerts(page)}
                disabled={loading}
                loading={loading}
                loadingText="Refreshing..."
              >
                Refresh
              </GlassButton>
              <GlassButton tint="primary" type="submit" disabled={loading}>
                Apply Filters
              </GlassButton>
            </div>
          </form>
        </GlassCard>

        {(error || deleteError) && (
          <GlassCard>
            <div className="card-body">
              {error && <p className="text-error">{error}</p>}
              {deleteError && <p className="text-error">{deleteError}</p>}
            </div>
          </GlassCard>
        )}

        <GlassCard>
          <div className="card-body gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="card-title">Alert List</h2>
              <p className="text-sm text-base-content/70">
                {listResult ? `${listResult.total} total` : 'No results loaded'}
              </p>
            </div>

            <List className="overflow-x-auto p-2">
              <table className="table bg-transparent [&_th]:bg-transparent [&_td]:bg-transparent">
                <thead>
                  <tr>
                    <th>
                      <GlassButton variant="ghost" size="xs" type="button" onClick={() => handleSort('event')}>
                        Event {sortBy === 'event' ? `(${sortDir})` : ''}
                      </GlassButton>
                    </th>
                    <th>
                      <GlassButton variant="ghost" size="xs" type="button" onClick={() => handleSort('effectiveAt')}>
                        Date {sortBy === 'effectiveAt' ? `(${sortDir})` : ''}
                      </GlassButton>
                    </th>
                    <th>
                      <GlassButton variant="ghost" size="xs" type="button" onClick={() => handleSort('headline')}>
                        Headline {sortBy === 'headline' ? `(${sortDir})` : ''}
                      </GlassButton>
                    </th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {listResult?.items.map((alert) => (
                    <tr
                      key={alert.id}
                      className="cursor-pointer hover"
                      onClick={() => void fetchAlertDetails(alert.id)}
                    >
                      <td>{alert.event ?? 'n/a'}</td>
                      <td>{formatDate(alert.effectiveAt)}</td>
                      <td>{alert.headline ?? 'n/a'}</td>
                      <td>
                        <div className="flex justify-end gap-2">
                          <GlassButton
                            size="xs"
                            variant="outline"
                            square
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void fetchAlertDetails(alert.id, true);
                            }}
                            disabled={saving}
                            aria-label="Edit alert"
                            title="Edit"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            >
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                            </svg>
                          </GlassButton>
                          <GlassButton
                            size="xs"
                            tint="error"
                            variant="outline"
                            square
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleDeleteAlert(alert.id);
                            }}
                            disabled={saving}
                            aria-label="Delete alert"
                            title="Delete"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            >
                              <path d="M3 6h18" />
                              <path d="M8 6V4h8v2" />
                              <path d="M19 6l-1 14H6L5 6" />
                              <path d="M10 11v6" />
                              <path d="M14 11v6" />
                            </svg>
                          </GlassButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!listResult?.items.length && (
                    <tr>
                      <td colSpan={4} className="text-center text-base-content/70">
                        {loading ? 'Loading alerts...' : 'No alerts found.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </List>

            <div className="flex items-center justify-end gap-2">
              <GlassButton
                size="sm"
                variant="outline"
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => void fetchAlerts(page - 1)}
              >
                Previous
              </GlassButton>
              <span className="text-sm text-base-content/70">
                Page {page} of {totalPages}
              </span>
              <GlassButton
                size="sm"
                variant="outline"
                type="button"
                disabled={page >= totalPages || loading}
                onClick={() => void fetchAlerts(page + 1)}
              >
                Next
              </GlassButton>
            </div>
          </div>
        </GlassCard>
      </div>

      {drawerOpen && selectedAlert && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={() => setDrawerOpen(false)}>
          <div
            className="h-full w-full max-w-2xl overflow-y-auto bg-base-100 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <h2 className="text-xl font-semibold">
                Alert {selectedAlert.id} {editMode ? '(Edit)' : '(Details)'}
              </h2>
              <div className="flex gap-2">
                {!editMode && (
                  <GlassButton size="sm" variant="outline" type="button" onClick={() => setEditMode(true)}>
                    Edit
                  </GlassButton>
                )}
                <GlassButton size="sm" type="button" onClick={() => setDrawerOpen(false)}>
                  Close
                </GlassButton>
              </div>
            </div>

            {!editMode ? (
              <div className="grid gap-3 text-sm">
                <p><strong>NWS ID:</strong> {selectedAlert.nwsId ?? 'n/a'}</p>
                <p><strong>Event:</strong> {selectedAlert.event ?? 'n/a'}</p>
                <p><strong>Headline:</strong> {selectedAlert.headline ?? 'n/a'}</p>
                <p><strong>Short Description:</strong> {selectedAlert.shortDescription ?? 'n/a'}</p>
                <p><strong>Description:</strong> {selectedAlert.description ?? 'n/a'}</p>
                <p><strong>Geometry:</strong> {selectedAlert.geometry ?? 'n/a'}</p>
                <p><strong>Sent:</strong> {selectedAlert.sent ?? 'n/a'}</p>
                <p><strong>Effective:</strong> {selectedAlert.effective ?? 'n/a'}</p>
                <p><strong>Onset:</strong> {selectedAlert.onset ?? 'n/a'}</p>
                <p><strong>Expires:</strong> {selectedAlert.expires ?? 'n/a'}</p>
                <p><strong>Ends:</strong> {selectedAlert.ends ?? 'n/a'}</p>
              </div>
            ) : (
              <form className="grid gap-4" onSubmit={handleSaveChanges}>
                <label className="form-control">
                  <span className="label-text">NWS ID</span>
                  <GlassInput className="input input-bordered" value={editNwsId} onChange={(event) => setEditNwsId(event.target.value)} />
                </label>
                <label className="form-control">
                  <span className="label-text">Event</span>
                  <GlassInput className="input input-bordered" value={editEvent} onChange={(event) => setEditEvent(event.target.value)} />
                </label>
                <label className="form-control">
                  <span className="label-text">Headline</span>
                  <GlassInput className="input input-bordered" value={editHeadline} onChange={(event) => setEditHeadline(event.target.value)} />
                </label>
                <label className="form-control">
                  <span className="label-text">Short Description</span>
                  <textarea className="textarea textarea-bordered" value={editShortDescription} onChange={(event) => setEditShortDescription(event.target.value)} />
                </label>
                <label className="form-control">
                  <span className="label-text">Description</span>
                  <textarea className="textarea textarea-bordered min-h-24" value={editDescription} onChange={(event) => setEditDescription(event.target.value)} />
                </label>
                <label className="form-control">
                  <span className="label-text">Geometry</span>
                  <textarea className="textarea textarea-bordered" value={editGeometry} onChange={(event) => setEditGeometry(event.target.value)} />
                </label>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="form-control">
                    <span className="label-text">Sent (ISO)</span>
                    <GlassInput className="input input-bordered" value={editSent} onChange={(event) => setEditSent(event.target.value)} />
                  </label>
                  <label className="form-control">
                    <span className="label-text">Effective (ISO)</span>
                    <GlassInput className="input input-bordered" value={editEffective} onChange={(event) => setEditEffective(event.target.value)} />
                  </label>
                  <label className="form-control">
                    <span className="label-text">Onset (ISO)</span>
                    <GlassInput className="input input-bordered" value={editOnset} onChange={(event) => setEditOnset(event.target.value)} />
                  </label>
                  <label className="form-control">
                    <span className="label-text">Expires (ISO)</span>
                    <GlassInput className="input input-bordered" value={editExpires} onChange={(event) => setEditExpires(event.target.value)} />
                  </label>
                  <label className="form-control md:col-span-2">
                    <span className="label-text">Ends (ISO)</span>
                    <GlassInput className="input input-bordered" value={editEnds} onChange={(event) => setEditEnds(event.target.value)} />
                  </label>
                </div>

                <div className="flex justify-end gap-2">
                  <GlassButton variant="outline" type="button" onClick={() => setEditMode(false)} disabled={saving}>
                    Cancel
                  </GlassButton>
                  <GlassButton
                    tint="primary"
                    type="submit"
                    disabled={saving}
                    loading={saving}
                    loadingText="Saving..."
                  >
                    Save Changes
                  </GlassButton>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default AlertsPage;
