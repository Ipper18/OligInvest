import { z } from "zod";
import { isBoundaryHandler, ProblemError } from "./problem.js";
import type { PlatformContext, RequestContext } from "./request-context.js";

export { createBoundaryHandler, parseBoundary } from "./problem.js";

const idSchema = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u);
const keySchema = z.string().regex(/^[a-z][a-z0-9_.:*-]*$/u);
const roleSchema = z.enum(["user", "pro", "admin"]);
const subjectSchema = z
  .object({ userId: z.uuid().optional(), role: roleSchema.optional() })
  .strict();
export type ModuleId = string;
export type FlagKey = `module.${string}`;
export type Subject = z.infer<typeof subjectSchema>;
export type FlagEvaluator = (
  key: FlagKey,
  subject: Readonly<Subject>,
) => boolean | Promise<boolean>;
const permissionSchema = z.object({ key: keySchema, roles: z.array(roleSchema).min(1) }).strict();
const metadataSchema = z
  .object({
    id: idSchema,
    layer: z.enum(["foundation", "feature"]),
    version: z
      .string()
      .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/u),
    featureFlag: z.templateLiteral(["module.", z.string()]).optional(),
    permissions: z.array(permissionSchema),
  })
  .strict();
export type PermissionDef = z.infer<typeof permissionSchema>;
export type ModuleMetadata = z.infer<typeof metadataSchema>;
export interface ModuleDefinition<Router> extends ModuleMetadata {
  routes(app: Router, context: PlatformContext): void;
  adminRoutes?: ((app: Router, context: PlatformContext) => void) | undefined;
  quickRoutes?: ((app: Router, context: PlatformContext) => void) | undefined;
  sseEvents?: string[] | undefined;
}
const FOUNDATIONS = new Set(["identity", "notifications", "market", "portfolio"]);
function frozen<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
function unique(values: string[], description: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${description}`);
}
function subjectOf(input: Subject): Subject {
  const result = subjectSchema.safeParse(input);
  if (!result.success) throw new ProblemError("UNAUTHENTICATED");
  return frozen(result.data);
}
export class ModuleCatalog {
  readonly #modules = new Map<string, ModuleMetadata>();
  readonly #evaluate: FlagEvaluator;
  constructor(definitions: readonly ModuleMetadata[], evaluate: FlagEvaluator = () => false) {
    this.#evaluate = evaluate;
    const permissions: string[] = [];
    for (const input of definitions) {
      const definition = metadataSchema.parse(input);
      if (this.#modules.has(definition.id)) throw new Error("Duplicate module");
      const foundation = FOUNDATIONS.has(definition.id);
      if ((definition.layer === "foundation") !== foundation)
        throw new Error("Invalid module layer");
      if (foundation || definition.id === "admin") {
        if (definition.featureFlag !== undefined) throw new Error("Unexpected module flag");
      } else if (definition.featureFlag !== `module.${definition.id}`)
        throw new Error("Invalid module flag");
      for (const permission of definition.permissions) {
        unique(permission.roles, "permission role");
        permissions.push(permission.key);
      }
      this.#modules.set(definition.id, frozen(definition));
    }
    unique(permissions, "permission");
  }
  get(id: string): ModuleMetadata | undefined {
    return this.#modules.get(id);
  }
  async isEnabled(id: string, input: Subject): Promise<boolean> {
    const subject = subjectOf(input);
    const module = this.#modules.get(id);
    if (!module) return false;
    if (module.id === "admin") return subject.role === "admin";
    if (module.layer === "foundation") return true;
    return (
      module.featureFlag !== undefined &&
      (await this.#evaluate(module.featureFlag, subject)) === true
    );
  }
  hasPermission(id: string, key: string, input: Subject): boolean {
    const { role } = subjectOf(input);
    return (
      role !== undefined &&
      (this.#modules
        .get(id)
        ?.permissions.some(
          (permission) => permission.key === key && permission.roles.includes(role),
        ) ??
        false)
    );
  }
}

function callback<T extends (...args: never[]) => unknown>() {
  return z.custom<T>((value) => typeof value === "function");
}
export class ApiModuleRegistry<Router> {
  readonly #definitions = new Map<string, ModuleDefinition<Router>>();
  constructor(private readonly catalog: ModuleCatalog) {}
  register(input: ModuleDefinition<Router>): void {
    const route = callback<(app: Router, context: PlatformContext) => void>();
    const definition = metadataSchema
      .extend({
        routes: route,
        adminRoutes: route.optional(),
        quickRoutes: route.optional(),
        sseEvents: z.array(keySchema).optional(),
      })
      .strict()
      .parse(input);
    if (this.#definitions.has(definition.id)) throw new Error("Duplicate API module");
    const metadata = metadataSchema.parse(
      Object.fromEntries(
        Object.keys(metadataSchema.shape)
          .filter((key) => Object.hasOwn(definition, key))
          .map((key) => [key, definition[key as keyof typeof definition]]),
      ),
    );
    if (JSON.stringify(metadata) !== JSON.stringify(this.catalog.get(definition.id)))
      throw new Error("Unknown or inconsistent module metadata");
    this.#definitions.set(definition.id, frozen(definition));
  }
  entries(): readonly ModuleDefinition<Router>[] {
    return Object.freeze([...this.#definitions.values()]);
  }
  async require(id: string, subject: Subject): Promise<ModuleDefinition<Router>> {
    const definition = this.#definitions.get(id);
    if (!definition || !(await this.catalog.isEnabled(id, subject)))
      throw new ProblemError("NOT_FOUND");
    return definition;
  }
}

const queueSchema = z
  .object({
    name: idSchema,
    concurrency: z.number().int().positive(),
    rateLimit: z
      .object({ max: z.number().int().positive(), durationMs: z.number().int().positive() })
      .strict()
      .optional(),
  })
  .strict();
const scheduleSchema = z
  .object({ job: keySchema, cron: z.string().min(1), tz: z.string().min(1) })
  .strict();
export type QueueDef = z.infer<typeof queueSchema>;
export type ScheduleDef = z.infer<typeof scheduleSchema>;
export type JobContext = RequestContext;
export type JobHandler = (payload: unknown, context: JobContext) => Promise<void>;
export interface JobsModuleDefinition {
  id: ModuleId;
  queues: QueueDef[];
  handlers: Record<string, JobHandler>;
  subscriptions?: Record<string, JobHandler> | undefined;
  schedules?: ScheduleDef[] | undefined;
}
const jobHandlerSchema = callback<JobHandler>().refine(
  isBoundaryHandler,
  "Use createBoundaryHandler",
);
const jobsSchema = z
  .object({
    id: idSchema,
    queues: z.array(queueSchema),
    handlers: z.record(keySchema, jobHandlerSchema),
    subscriptions: z.record(keySchema, jobHandlerSchema).optional(),
    schedules: z.array(scheduleSchema).optional(),
  })
  .strict();
const jobContextSchema = subjectSchema.extend({ requestId: z.uuid() }).strict();
export class JobsModuleRegistry {
  readonly #definitions = new Map<string, JobsModuleDefinition>();
  constructor(private readonly catalog: ModuleCatalog) {}
  register(input: JobsModuleDefinition): void {
    const definition = jobsSchema.parse(input);
    if (this.#definitions.has(definition.id)) throw new Error("Duplicate jobs module");
    if (!this.catalog.get(definition.id)) throw new Error("Unknown jobs module");
    unique(
      definition.queues.map((queue) => queue.name),
      "queue",
    );
    for (const schedule of definition.schedules ?? []) {
      if (!Object.hasOwn(definition.handlers, schedule.job))
        throw new Error("Schedule has no handler");
      try {
        new Intl.DateTimeFormat("en", { timeZone: schedule.tz });
      } catch {
        throw new Error("Invalid schedule timezone");
      }
    }
    this.#definitions.set(definition.id, frozen(definition));
  }
  async #dispatch(
    id: string,
    name: string,
    payload: unknown,
    input: JobContext,
    kind: "handlers" | "subscriptions",
  ): Promise<"handled" | "skipped"> {
    const parsed = jobContextSchema.safeParse(input);
    if (!parsed.success) throw new ProblemError("VALIDATION_FAILED");
    const context = frozen(parsed.data);
    const subject = {
      ...(context.userId ? { userId: context.userId } : {}),
      ...(context.role ? { role: context.role } : {}),
    };
    const definition = this.#definitions.get(id);
    if (!definition || !(await this.catalog.isEnabled(id, subject))) return "skipped";
    const handlers = definition[kind];
    const handler = handlers && Object.hasOwn(handlers, name) ? handlers[name] : undefined;
    if (!handler) return "skipped";
    await handler(payload, context);
    return "handled";
  }
  dispatch(
    id: string,
    name: string,
    payload: unknown,
    context: JobContext,
  ): Promise<"handled" | "skipped"> {
    return this.#dispatch(id, name, payload, context, "handlers");
  }
  dispatchEvent(
    id: string,
    name: string,
    payload: unknown,
    context: JobContext,
  ): Promise<"handled" | "skipped"> {
    return this.#dispatch(id, name, payload, context, "subscriptions");
  }
  async schedules(
    subject: Subject,
  ): Promise<readonly Readonly<{ moduleId: string; schedule: ScheduleDef }>[]> {
    const result: { moduleId: string; schedule: ScheduleDef }[] = [];
    for (const definition of this.#definitions.values()) {
      if (await this.catalog.isEnabled(definition.id, subject)) {
        for (const schedule of definition.schedules ?? [])
          result.push({ moduleId: definition.id, schedule });
      }
    }
    return frozen(result);
  }
}

const navSchema = z
  .object({
    href: z.string().regex(/^\/(?!\/)[a-zA-Z0-9_/-]*$/u),
    labelKey: keySchema,
    permission: keySchema,
  })
  .strict();
const panelSchema = z
  .object({ id: idSchema, labelKey: keySchema, load: callback<() => Promise<unknown>>() })
  .strict();
export type NavItem = z.infer<typeof navSchema>;
export type AdminPanelDef = z.infer<typeof panelSchema>;
export interface UiModuleDefinition {
  id: ModuleId;
  nav?: NavItem[] | undefined;
  adminPanels?: AdminPanelDef[] | undefined;
  explainers?: string[] | undefined;
}
const uiSchema = z
  .object({
    id: idSchema,
    nav: z.array(navSchema).optional(),
    adminPanels: z.array(panelSchema).optional(),
    explainers: z.array(keySchema).optional(),
  })
  .strict();
export class UiModuleRegistry {
  readonly #definitions = new Map<string, UiModuleDefinition>();
  constructor(private readonly catalog: ModuleCatalog) {}
  register(input: UiModuleDefinition): void {
    const definition = uiSchema.parse(input);
    if (this.#definitions.has(definition.id)) throw new Error("Duplicate UI module");
    const metadata = this.catalog.get(definition.id);
    if (!metadata) throw new Error("Unknown UI module");
    for (const item of definition.nav ?? []) {
      if (!metadata.permissions.some((permission) => permission.key === item.permission))
        throw new Error("Unknown navigation permission");
    }
    unique(
      [...this.#definitions.values()]
        .flatMap((entry) => entry.adminPanels?.map((panel) => panel.id) ?? [])
        .concat(definition.adminPanels?.map((panel) => panel.id) ?? []),
      "admin panel",
    );
    this.#definitions.set(definition.id, frozen(definition));
  }
  async navigation(subject: Subject): Promise<readonly NavItem[]> {
    const result: NavItem[] = [];
    for (const definition of this.#definitions.values()) {
      if (await this.catalog.isEnabled(definition.id, subject)) {
        result.push(
          ...(definition.nav ?? []).filter((item) =>
            this.catalog.hasPermission(definition.id, item.permission, subject),
          ),
        );
      }
    }
    return frozen(result);
  }
  async adminPanels(input: Subject): Promise<readonly AdminPanelDef[]> {
    const subject = subjectOf(input);
    if (subject.role !== "admin") return [];
    const result: AdminPanelDef[] = [];
    for (const definition of this.#definitions.values()) {
      if (await this.catalog.isEnabled(definition.id, subject))
        result.push(...(definition.adminPanels ?? []));
    }
    return frozen(result);
  }
}
