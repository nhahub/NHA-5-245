import { z } from 'zod';

export const DatasetSchema = z.enum(['live', 'demo']);
export type Dataset = z.infer<typeof DatasetSchema>;
export const monthPattern = /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/;
export const utcMonth = (date = new Date()) => date.toISOString().slice(0, 7);
export function previousUtcMonth(date = new Date()) {
  const previous = new Date(date);
  previous.setUTCDate(1);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  return utcMonth(previous);
}
const month = z.string().regex(monthPattern).refine(value => value <= utcMonth(), 'Choose a month through the current UTC month.');

export const GatewayRequest = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('status'), dataset: DatasetSchema.optional() }),
  z.strictObject({ action: z.literal('check'), dataset: z.literal('live').optional() }),
  z.strictObject({ action: z.literal('report'), month: month.optional(), dataset: DatasetSchema.optional() }),
  z.strictObject({ action: z.literal('get_report'), month, dataset: DatasetSchema.optional() }),
]);
export type GatewayRequest = z.infer<typeof GatewayRequest>;
export type Action = GatewayRequest['action'];

const timestamp = z.iso.datetime({ offset: true });
const nonnegative = z.number().min(0);
const percentage = nonnegative.max(100);
const ServiceSchema = z.object({
  id: z.string(), name: z.string(), target_url: z.url({ protocol: /^https?$/ }), provider_name: z.string(), enabled: z.boolean(),
  expected_status: z.number().int().min(100).max(599), timeout_ms: z.number().int().positive(),
  max_sample_gap_seconds: z.number().int().positive(), sla_target_pct: percentage,
  monthly_fee: nonnegative, credit_pct: percentage, currency: z.string().regex(/^[A-Z]{3}$/),
  contract_reference: z.string(),
});
export const CheckSchema = z.object({
  id: z.number().int(), service_id: z.string(), source: DatasetSchema, checked_at: timestamp,
  recorded_at: timestamp, is_up: z.boolean(), status_code: z.number().int().min(100).max(599).nullable(),
  response_ms: nonnegative.nullable(), error: z.string().nullable(), execution_id: z.string(),
});
export type Check = z.infer<typeof CheckSchema>;

const StatusSchema = z.object({
  dataset: DatasetSchema, is_synthetic: z.boolean(), service: ServiceSchema,
  current_status: z.enum(['up', 'down', 'unknown']), latest_check: CheckSchema.nullable(),
  recent_checks: z.array(CheckSchema).max(20),
});
export type Status = z.infer<typeof StatusSchema>;

const assessment = z.enum(['within_sla', 'breach_detected', 'insufficient_data', 'needs_data_review', 'provisional']);
const ReportSchema = z.object({
  month, dataset: DatasetSchema, is_synthetic: z.boolean(), service_id: z.string(), service_name: z.string(),
  is_final: z.boolean(), assessment, period_start: timestamp, period_end: timestamp, assessed_until: timestamp,
  generated_at: timestamp, contract_snapshot: ServiceSchema, measurement_method: z.string(),
  period_seconds: nonnegative, elapsed_seconds: nonnegative, up_seconds: nonnegative,
  down_seconds: nonnegative, unknown_seconds: nonnegative, coverage_pct: percentage.nullable(),
  observed_availability_pct: percentage.nullable(), estimated_monthly_availability_pct: percentage.nullable(),
  candidate_credit_pct: percentage, candidate_credit_amount: nonnegative, currency: z.string().regex(/^[A-Z]{3}$/),
  sample_count: z.number().int().min(0),
  down_windows: z.array(z.object({ started_at: timestamp, ended_at: timestamp, duration_seconds: nonnegative })),
});
export type Report = z.infer<typeof ReportSchema>;
export const SavedReportSchema = z.object({
  report_id: z.uuid(), revision: z.number().int().positive(), report: ReportSchema,
  claim_draft: z.string().nullable(),
});
export type SavedReport = z.infer<typeof SavedReportSchema>;

export const results = {
  status: StatusSchema,
  check: z.object({ check: CheckSchema, transition: z.string(), duplicate: z.boolean() }),
  report: SavedReportSchema.extend({ duplicate: z.boolean() }),
  get_report: SavedReportSchema,
};
export type Result<A extends Action> = z.infer<(typeof results)[A]>;
export const SuccessEnvelope = z.object({
  ok: z.literal(true), action: z.enum(['status', 'check', 'report', 'get_report']),
  execution_id: z.string().min(1), result: z.unknown(),
});
export const FailureEnvelope = z.object({
  ok: z.literal(false), code: z.string().min(1), error: z.string().min(1),
  execution_id: z.string().optional(),
});
