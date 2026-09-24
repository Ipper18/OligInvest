import { z } from "zod";

export const PROBLEM_DEFINITIONS = {
  BAD_REQUEST: { status: 400, title: "Nieprawidłowe żądanie" },
  UNAUTHENTICATED: { status: 401, title: "Wymagane zalogowanie" },
  FORBIDDEN: { status: 403, title: "Brak uprawnień" },
  MFA_REQUIRED: { status: 403, title: "Wymagane uwierzytelnienie dwuskładnikowe" },
  MFA_ENROLLMENT_REQUIRED: {
    status: 403,
    title: "Wymagana konfiguracja uwierzytelnienia dwuskładnikowego",
  },
  STEP_UP_REQUIRED: { status: 403, title: "Wymagane ponowne potwierdzenie tożsamości" },
  PAT_SCOPE_MISSING: { status: 403, title: "Brak wymaganego zakresu tokenu" },
  TERMS_ACCEPTANCE_REQUIRED: { status: 403, title: "Wymagana akceptacja regulaminu" },
  NOT_FOUND: { status: 404, title: "Nie znaleziono zasobu" },
  CONFLICT: { status: 409, title: "Konflikt stanu zasobu" },
  IDEMPOTENCY_CONFLICT: { status: 409, title: "Konflikt klucza idempotencji" },
  INSTRUMENT_AMBIGUOUS: { status: 409, title: "Niejednoznaczny instrument" },
  DUPLICATE_IMPORT: { status: 409, title: "Import już istnieje" },
  RECONCILIATION_REQUIRED: { status: 412, title: "Wymagane uzgodnienie danych" },
  FILE_TOO_LARGE: { status: 413, title: "Plik jest zbyt duży" },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, title: "Nieobsługiwany typ danych" },
  IMPORT_FORMAT_UNKNOWN: { status: 415, title: "Nieznany format importu" },
  VALIDATION_FAILED: { status: 422, title: "Nieprawidłowe dane" },
  PARAMETERS_OUT_OF_BOUNDS: { status: 422, title: "Parametry poza dozwolonym zakresem" },
  RATE_LIMITED: { status: 429, title: "Przekroczono limit żądań" },
  QUOTA_EXCEEDED: { status: 429, title: "Wyczerpano limit operacji" },
  INTERNAL: { status: 500, title: "Błąd wewnętrzny" },
  SERVICE_UNAVAILABLE: { status: 503, title: "Usługa chwilowo niedostępna" },
} as const;
export type ProblemCode = keyof typeof PROBLEM_DEFINITIONS;
const fieldErrorSchema = z
  .object({ path: z.string(), code: z.string(), message: z.string() })
  .strict();
const optionsSchema = z
  .object({
    detail: z.string().optional(),
    errors: z.array(fieldErrorSchema).optional(),
    retryAfterSeconds: z.number().int().positive().optional(),
  })
  .strict();
type ProblemOptions = z.infer<typeof optionsSchema>;

export class ProblemError extends Error {
  readonly code: ProblemCode;
  readonly options: Readonly<ProblemOptions>;
  constructor(code: ProblemCode, options: ProblemOptions = {}) {
    if (!Object.hasOwn(PROBLEM_DEFINITIONS, code)) throw new Error("Invalid problem code");
    super(PROBLEM_DEFINITIONS[code].title);
    this.name = "ProblemError";
    this.code = code;
    const parsed = optionsSchema.safeParse(options);
    if (!parsed.success) throw new Error("Invalid problem options");
    this.options = Object.freeze(parsed.data);
  }
}

export function problemResponse(
  error: unknown,
  requestId: string,
  publicBaseUrl: string,
): Response {
  const problem = error instanceof ProblemError ? error : new ProblemError("INTERNAL");
  const { code } = problem;
  const { status, title } = PROBLEM_DEFINITIONS[code];
  const body = {
    type: `${new URL(publicBaseUrl).origin}/problems/${code.toLowerCase().replaceAll("_", "-")}`,
    title,
    status,
    code,
    instance: requestId,
    ...(code === "INTERNAL"
      ? {}
      : {
          ...(problem.options.detail === undefined ? {} : { detail: problem.options.detail }),
          ...(problem.options.errors === undefined ? {} : { errors: problem.options.errors }),
        }),
  };
  const headers = new Headers({
    "Content-Type": "application/problem+json",
    "Cache-Control": "no-store",
    "X-Request-Id": requestId,
  });
  if (status === 429 || status === 503)
    headers.set("Retry-After", String(problem.options.retryAfterSeconds ?? 1));
  return new Response(JSON.stringify(body), { status, headers });
}

export function parseBoundary<S extends z.ZodRawShape>(
  shape: S,
  input: unknown,
): z.output<z.ZodObject<S>> {
  const parsed = z.object(shape).strict().safeParse(input);
  if (!parsed.success) {
    throw new ProblemError("VALIDATION_FAILED", {
      errors: parsed.error.issues.map((issue) => ({
        path:
          typeof issue.path[0] === "string" && Object.hasOwn(shape, issue.path[0])
            ? issue.path[0]
            : "",
        code: issue.code,
        message: "Nieprawidłowa wartość lub niedozwolone pole.",
      })),
    });
  }
  return parsed.data;
}

const boundaryHandlers = new WeakSet<object>();
export function isBoundaryHandler(value: unknown): boolean {
  return typeof value === "function" && boundaryHandlers.has(value);
}
export function createBoundaryHandler<S extends z.ZodRawShape, C>(
  shape: S,
  handler: (value: z.output<z.ZodObject<S>>, context: C) => Promise<void>,
): (input: unknown, context: C) => Promise<void> {
  const guarded = async (input: unknown, context: C) =>
    handler(parseBoundary(shape, input), context);
  boundaryHandlers.add(guarded);
  return guarded;
}
