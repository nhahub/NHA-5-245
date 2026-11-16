import { FailureEnvelope, SuccessEnvelope, results, type Action, type GatewayRequest, type Result } from '../shared/contract.ts';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly executionId?: string;

  constructor(message: string, code: string, status: number, executionId?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.executionId = executionId;
  }
}

export async function callGateway<A extends Action>(request: GatewayRequest & { action: A }, signal?: AbortSignal): Promise<Result<A>> {
  let response: Response;
  try {
    response = await fetch('/api/sla', {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError('Could not connect to the dashboard server. Check that it is running, then retry.', 'DISCONNECTED', 0);
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = FailureEnvelope.safeParse(data);
    if (error.success) throw new ApiError(error.data.error, error.data.code, response.status, error.data.execution_id);
    throw new ApiError('The dashboard server returned an unexpected response. Try refreshing.', 'DISCONNECTED', response.status);
  }
  const envelope = SuccessEnvelope.safeParse(data);
  const result = envelope.success && envelope.data.action === request.action
    ? results[request.action].safeParse(envelope.data.result) : null;
  if (!result?.success) throw new ApiError('The dashboard received an invalid gateway response.', 'INVALID_RESPONSE', 502);
  return result.data as Result<A>;
}
