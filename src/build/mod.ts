import { Project } from "../project/project.ts";
import { ensurePostgresRunning } from "../utils/postgres_daemon.ts";
import { createBuildState, waitForBuildPromises } from "../build_state/mod.ts";
import { success } from "../term/status.ts";
import { planProjectBuild } from "./plan/project.ts";
import { UnreachableError } from "../error/mod.ts";

/**
 * Which format to use for building.
 */
export enum Format {
	Native,
	Bundled,
}

/**
 * Which runtime to target when building.
 */
export enum Runtime {
	Deno,
	CloudflareWorkersPlatforms,
}

/**
 * Which DB driver to use for the runtime.
 */
export enum DbDriver {
	NodePostgres,
	NeonServerless,
	CloudflareHyperdrive,
}

/**
 * Stores options used in the build command.
 */
export interface BuildOpts {
	format: Format;
	runtime: Runtime;
	dbDriver: DbDriver;
	/** If true, parse TypeScript to generate JSON schemas to be validated at runtime. */
	strictSchemas: boolean;
	/** If true, don't run `deno check` on the generated code. */
	skipDenoCheck: boolean;
	/** If exists, run database migrations. */
	migrate?: {
		/** If true, run migrations automatically without dev mode. */
		forceDeploy: boolean;
	};
	signal?: AbortSignal;
}

export async function build(project: Project, opts: BuildOpts) {
	opts.signal?.throwIfAborted();

	// Required for `migrateDev` and `migrateDeploy`
	await ensurePostgresRunning(project);

	const buildState = await createBuildState(project, opts.signal);

	await planProjectBuild(buildState, project, opts);

	// Wait for any remaining build steps
	await waitForBuildPromises(buildState);

	success("Success");
}

export function runtimeToString(runtime: Runtime) {
	if (runtime == Runtime.Deno) return "Deno";
	if (runtime == Runtime.CloudflareWorkersPlatforms) return "Cloudflare";

	throw new UnreachableError(runtime);
}
