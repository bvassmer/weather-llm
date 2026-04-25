import { useMemo, useState } from 'react';
import GlassButton from '../components/common/GlassButton';
import GlassCard from '../components/common/GlassCard';
import GlassInput from '../components/common/GlassInput';

type EmailTemplatePreviewScenario = {
  scenario: string;
  subject?: string;
  emailFormat: 'html' | 'text';
  status: 'captured' | 'failed';
  preview?: {
    subject?: string;
    html?: string;
    htmlForBrowser?: string;
    text?: string;
  };
  aiSummaryCheck?: {
    expected: 'present' | 'absent';
    passed: boolean;
    sectionCount: number;
    textCount: number;
  };
  error?: string;
};

type EmailTemplatePreviewResponse = {
  runId: string;
  startedAt: string;
  completedAt: string;
  scenarios: EmailTemplatePreviewScenario[];
  hadErrors: boolean;
};

type RealEmailTestCandidate = {
  id: string;
  source: string;
  event?: string;
  headline?: string;
  issuedAt?: string;
  locationLabel?: string;
  canSend: boolean;
  reason?: string;
};

type RealEmailTestCandidatesResponse = {
  generatedAt: string;
  candidates: RealEmailTestCandidate[];
};

type SendRealEmailTestResponse = {
  candidateId: string;
  status: 'sent' | 'skipped' | 'failed';
  reason: string;
  source?: string;
  event?: string;
  headline?: string;
  messageId?: string;
  embeddingEnqueue?: {
    attempted: boolean;
    status: string;
    reason?: string;
  };
};

const DEFAULT_API_BASE_URL =
  import.meta.env.VITE_WEATHER_LLM_API_BASE_URL ?? 'http://localhost:3000';

const getResponseMessage = (payload: unknown, fallbackMessage: string) => {
  if (payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string') {
    return payload.message;
  }

  return fallbackMessage;
};

function EmailTemplatesPage() {
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL);
  const [result, setResult] = useState<EmailTemplatePreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [candidatesResult, setCandidatesResult] = useState<RealEmailTestCandidatesResponse | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<SendRealEmailTestResponse | null>(null);

  const selected = useMemo(() => {
    if (!result || !result.scenarios.length) {
      return null;
    }

    if (!selectedScenario) {
      return result.scenarios[0] ?? null;
    }

    return result.scenarios.find((item) => item.scenario === selectedScenario) ?? result.scenarios[0] ?? null;
  }, [result, selectedScenario]);

  const runPreview = async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch(`${apiBaseUrl}/nws-alerts/admin/email-templates/preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const bodyText = await response.text();
      const payload = bodyText ? (JSON.parse(bodyText) as EmailTemplatePreviewResponse) : null;

      if (!response.ok) {
        const message = getResponseMessage(payload, `Preview request failed with status ${response.status}`);
        throw new Error(message);
      }

      if (!payload) {
        throw new Error('Preview response was empty');
      }

      setResult(payload);
      setSelectedScenario(payload.scenarios[0]?.scenario ?? null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const loadCandidates = async () => {
    setCandidatesLoading(true);
    setErrorMessage(null);
    setSendResult(null);

    try {
      const response = await fetch(`${apiBaseUrl}/nws-alerts/admin/email-templates/candidates`);
      const bodyText = await response.text();
      const payload = bodyText ? (JSON.parse(bodyText) as RealEmailTestCandidatesResponse) : null;

      if (!response.ok) {
        const message = getResponseMessage(payload, `Candidate request failed with status ${response.status}`);
        throw new Error(message);
      }

      if (!payload) {
        throw new Error('Candidate response was empty');
      }

      setCandidatesResult(payload);
      setSelectedCandidateId(payload.candidates[0]?.id ?? null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCandidatesLoading(false);
    }
  };

  const sendSelectedCandidate = async () => {
    if (!selectedCandidateId) {
      setErrorMessage('Select a candidate before sending a test email.');
      return;
    }

    setSendLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch(`${apiBaseUrl}/nws-alerts/admin/email-templates/send-test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ candidateId: selectedCandidateId }),
      });

      const bodyText = await response.text();
      const payload = bodyText ? (JSON.parse(bodyText) as SendRealEmailTestResponse) : null;

      if (!response.ok) {
        const message = getResponseMessage(payload, `Send request failed with status ${response.status}`);
        throw new Error(message);
      }

      if (!payload) {
        throw new Error('Send response was empty');
      }

      setSendResult(payload);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSendLoading(false);
    }
  };

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <GlassCard className="self-start">
        <div className="card-body gap-4">
          <h1 className="card-title text-2xl">Email Template Previews</h1>
          <p className="text-base-content/80">
            Run fixture-driven template rendering through the same backend email generation logic used for production
            sends.
          </p>

          <label className="form-control w-full">
            <span className="label-text">API Base URL</span>
            <GlassInput
              className="input input-bordered"
              value={apiBaseUrl}
              onChange={(event) => setApiBaseUrl(event.target.value)}
              placeholder="http://localhost:3000"
            />
          </label>

          <GlassButton className="btn btn-primary" disabled={loading} onClick={runPreview}>
            {loading ? 'Running Preview...' : 'Run Email Preview'}
          </GlassButton>

          <GlassButton className="btn btn-secondary" disabled={candidatesLoading} onClick={loadCandidates}>
            {candidatesLoading ? 'Loading Real Candidates...' : 'Load Real Email Candidates'}
          </GlassButton>

          <GlassButton
            className="btn btn-accent"
            disabled={sendLoading || !selectedCandidateId}
            onClick={sendSelectedCandidate}
          >
            {sendLoading ? 'Sending Test Email...' : 'Send Selected Test Email'}
          </GlassButton>

          <p className="text-sm text-base-content/70">
            Sends one selected real candidate to the configured alert recipient using the full backend email pipeline.
          </p>

          {errorMessage ? <div className="alert alert-error text-sm">{errorMessage}</div> : null}

          {result ? (
            <div className="rounded-xl border border-base-300 bg-base-100/60 p-3 text-sm">
              <p>
                <span className="font-semibold">Run ID:</span> {result.runId}
              </p>
              <p>
                <span className="font-semibold">Started:</span> {new Date(result.startedAt).toLocaleString()}
              </p>
              <p>
                <span className="font-semibold">Completed:</span> {new Date(result.completedAt).toLocaleString()}
              </p>
              <p>
                <span className="font-semibold">Status:</span>{' '}
                {result.hadErrors ? <span className="text-error">Completed with errors</span> : 'All captured'}
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            {(result?.scenarios ?? []).map((scenario) => {
              const active = selected?.scenario === scenario.scenario;
              return (
                <button
                  key={scenario.scenario}
                  type="button"
                  className={`btn justify-between ${active ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
                  onClick={() => setSelectedScenario(scenario.scenario)}
                >
                  <span className="truncate">{scenario.scenario}</span>
                  <span className={`badge ${scenario.status === 'captured' ? 'badge-success' : 'badge-error'}`}>
                    {scenario.status}
                  </span>
                </button>
              );
            })}
          </div>

          {candidatesResult ? (
            <div className="flex flex-col gap-2 rounded-xl border border-base-300 bg-base-100/60 p-3 text-sm">
              <p className="font-semibold">Real Email Candidates</p>
              <p className="text-base-content/70">
                Generated: {new Date(candidatesResult.generatedAt).toLocaleString()}
              </p>
              {(candidatesResult.candidates ?? []).length ? (
                candidatesResult.candidates.map((candidate) => {
                  const active = selectedCandidateId === candidate.id;
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      className={`btn h-auto min-h-0 justify-between py-3 ${
                        active ? 'btn-secondary' : 'btn-ghost border border-base-300'
                      }`}
                      onClick={() => setSelectedCandidateId(candidate.id)}
                    >
                      <span className="flex min-w-0 flex-col items-start text-left">
                        <span className="truncate font-semibold">{candidate.headline ?? candidate.event ?? candidate.id}</span>
                        <span className="truncate text-xs text-base-content/70">
                          {candidate.source}
                          {candidate.issuedAt ? ` • ${new Date(candidate.issuedAt).toLocaleString()}` : ''}
                        </span>
                      </span>
                      <span className={`badge ${candidate.canSend ? 'badge-success' : 'badge-warning'}`}>
                        {candidate.canSend ? 'sendable' : 'review'}
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="alert alert-warning text-sm">No real email candidates were returned.</div>
              )}
            </div>
          ) : null}

          {sendResult ? (
            <div className="rounded-xl border border-base-300 bg-base-100/60 p-3 text-sm">
              <p>
                <span className="font-semibold">Send status:</span>{' '}
                <span className={sendResult.status === 'sent' ? 'text-success' : sendResult.status === 'failed' ? 'text-error' : 'text-warning'}>
                  {sendResult.status}
                </span>
              </p>
              <p>
                <span className="font-semibold">Reason:</span> {sendResult.reason}
              </p>
              {sendResult.messageId ? (
                <p>
                  <span className="font-semibold">Message ID:</span> {sendResult.messageId}
                </p>
              ) : null}
              {sendResult.embeddingEnqueue ? (
                <p>
                  <span className="font-semibold">Embedding enqueue:</span> {sendResult.embeddingEnqueue.status}
                  {sendResult.embeddingEnqueue.reason ? ` (${sendResult.embeddingEnqueue.reason})` : ''}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </GlassCard>

      <GlassCard>
        <div className="card-body gap-4">
          <h2 className="card-title text-xl">Template Output</h2>
          {!selected ? (
            <p className="text-base-content/80">Run a preview to display rendered templates.</p>
          ) : (
            <>
              <div className="rounded-xl border border-base-300 bg-base-100/60 p-3">
                <p className="text-sm text-base-content/80">Scenario</p>
                <p className="font-semibold">{selected.scenario}</p>
                <p className="mt-2 text-sm text-base-content/80">Subject</p>
                <p className="font-semibold">{selected.preview?.subject ?? selected.subject ?? 'No subject available'}</p>
                {selected.aiSummaryCheck ? (
                  <p className="mt-2 text-sm">
                    AI summary check:{' '}
                    <span className={selected.aiSummaryCheck.passed ? 'text-success' : 'text-error'}>
                      {selected.aiSummaryCheck.passed ? 'passed' : 'failed'}
                    </span>
                  </p>
                ) : null}
                {selected.error ? <p className="mt-2 text-sm text-error">{selected.error}</p> : null}
              </div>

              <div className="rounded-xl border border-base-300 bg-white p-2">
                {selected.preview?.htmlForBrowser ? (
                  <iframe
                    title={`${selected.scenario}-preview`}
                    srcDoc={selected.preview.htmlForBrowser}
                    className="h-[900px] w-full rounded-lg border border-base-300 bg-white"
                  />
                ) : (
                  <div className="alert alert-warning">No HTML preview content was returned for this scenario.</div>
                )}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-base-300 bg-base-100/60 p-3">
                  <p className="mb-2 text-sm font-semibold">Raw HTML</p>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">
                    {selected.preview?.html ?? 'No HTML payload'}
                  </pre>
                </div>

                <div className="rounded-xl border border-base-300 bg-base-100/60 p-3">
                  <p className="mb-2 text-sm font-semibold">Raw Text</p>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">
                    {selected.preview?.text ?? 'No text payload'}
                  </pre>
                </div>
              </div>
            </>
          )}
        </div>
      </GlassCard>
    </div>
  );
}

export default EmailTemplatesPage;
