import { assert, copy, emptyDir, exists, resolve } from "../deps.ts";
import { glob } from "./deps.ts";
import { configPath as projectConfigPath, readConfig as readProjectConfig } from "../config/project.ts";
import { ProjectConfig } from "../config/project.ts";
import { loadModule, Module } from "./module.ts";
import { loadRegistry, Registry } from "./registry.ts";
import { ProjectModuleConfig } from "../config/project.ts";
import { validateIdentifier } from "../types/identifiers/mod.ts";
import { Casing } from "../types/identifiers/defs.ts";
import { loadDefaultRegistry } from "./registry.ts";
import { UserError } from "../error/mod.ts";

export interface Project {
	path: string;
	config: ProjectConfig;
	registries: Map<string, Registry>;
	modules: Map<string, Module>;
}

export interface LoadProjectOpts {
	path?: string;
}

export async function loadProject(opts: LoadProjectOpts, signal?: AbortSignal): Promise<Project> {
	const projectRoot = resolve(Deno.cwd(), opts.path ?? ".");

	// Read project config
	const projectConfig = await readProjectConfig(
		projectRoot,
	);

	// Load registries
	const registries = new Map();

	for (const registryName in projectConfig.registries) {
		const registryConfig = projectConfig.registries[registryName];
		const registry = await loadRegistry(
			projectRoot,
			registryName,
			registryConfig,
			signal,
		);
		registries.set(registryName, registry);
	}

	if (!registries.has("default")) {
		const defaultRegistry = await loadDefaultRegistry(projectRoot, signal);
		registries.set("default", defaultRegistry);
	}

	// Validate local registry
	const localRegistry = registries.get("local");
	if (localRegistry) {
		if (!("local" in localRegistry.config)) {
			throw new UserError("Registry named `local` is special and must be configured as a local registry.", {
				path: projectConfigPath(projectRoot),
			});
		}
		if (localRegistry.isExternal) {
			throw new UserError("Registry named `local` is special and can't be external.", {
				path: projectConfigPath(projectRoot),
			});
		}
	}

	// Load modules
	const modules = new Map<string, Module>();
	for (const projectModuleName in projectConfig.modules) {
		const projectModuleConfig = projectConfig.modules[projectModuleName];

		const { path, registry } = await fetchAndResolveModule(
			projectRoot,
			registries,
			projectModuleName,
			projectModuleConfig,
		);
		const module = await loadModule(path, projectModuleName, projectModuleConfig, registry, signal);
		modules.set(projectModuleName, module);
	}

	// Verify existince of module dependencies
	const missingDepsByModule = new Map<string, string[]>();
	for (const module of modules.values()) {
		const missingDeps = [] as string[];
		for (const dependencyName in module.config.dependencies) {
			const dependencyModule = modules.get(dependencyName);
			if (!dependencyModule) {
				missingDeps.push(dependencyName);
			}
		}

		if (missingDeps.length > 0) {
			missingDepsByModule.set(module.name, missingDeps);
		}
	}

	if (missingDepsByModule.size > 0) {
		let details = "";
		for (const [moduleName, missingDeps] of missingDepsByModule) {
			details += `Cannot resolve dependencies for ${moduleName}: ${missingDeps.join(", ")}\n`;
		}
		throw new UserError("Unresolved module dependencies.", {
			details,
			path: projectConfigPath(projectRoot),
		});
	}

	// Module can't depend on itself
	const selfDepModules = [] as string[];
	for (const module of modules.values()) {
		if (module.config.dependencies?.[module.name]) {
			selfDepModules.push(module.name);
		}
	}

	if (selfDepModules.length > 0) {
		let details = "";
		for (const moduleName of selfDepModules) {
			details += `Module ${moduleName} can't depend on itself\n`;
		}
		throw new UserError("Modules can't depend on themselves.", {
			details,
			path: projectConfigPath(projectRoot),
		});
	}

	return { path: projectRoot, config: projectConfig, registries, modules };
}

interface FetchAndResolveModuleOutput {
	/**
	 * Path the module was copied to in .opengb.
	 */
	path: string;

	/**
	 * Path to the original module source code.
	 */
	sourcePath: string;

	/**
	 * Registry the module was fetched from.
	 */
	registry: Registry;
}

/**
 * Clones a registry to a local machine and resovles the path to the module.
 */
export async function fetchAndResolveModule(
	projectRoot: string,
	registries: Map<string, Registry>,
	moduleName: string,
	module: ProjectModuleConfig,
): Promise<FetchAndResolveModuleOutput> {
	validateIdentifier(moduleName, Casing.Snake);

	// Lookup registry
	const registryName = registryNameForModule(module);
	const registry = registries.get(registryName);
	if (!registry) {
		throw new UserError(`Registry \`${registryName}\` not found for module \`${module}\`.`, {
			path: projectConfigPath(projectRoot),
		});
	}

	// Resolve module path
	const pathModuleName = moduleNameInRegistry(moduleName, module);
	const sourcePath = resolve(registry.path, pathModuleName);
	if (!await exists(resolve(sourcePath, "module.json"))) {
		if (pathModuleName != moduleName) {
			// Has alias
			throw new UserError(
				`Module \`${pathModuleName}\` (alias of \`${moduleName}\`) not found in registry \`${registryName}\`.`,
				{ path: projectConfigPath(projectRoot) },
			);
		} else {
			// No alias
			throw new UserError(
				`Module \`${pathModuleName}\` not found in registry \`${registryName}\`.`,
				{ path: projectConfigPath(projectRoot) },
			);
		}
	}

	let path: string;
	if (registry.isExternal) {
		// Copy to gen dir
		//
		// We do this so generate files into the gen dir without modifying the
		// original module. For example. if multiple projects are using the same
		// local registry, we don't want conflicting generated files.
		path = resolve(
			projectRoot,
			".opengb",
			"external_modules",
			moduleName,
		);

		// HACK: Copy gen file to temp dir to avoid overwriting it
		const genPath = resolve(path, "module.gen.ts");
		let tempGenDir: string | undefined;
		let tempGenPath: string | undefined;
		if (await exists(genPath, { isFile: true })) {
			tempGenDir = await Deno.makeTempDir();
			tempGenPath = resolve(tempGenDir, "module.gen.ts");
			await copy(genPath, tempGenPath, { overwrite: true });
		}

		// TODO: Only copy when needed, this copies every time the CLI is ran
		await emptyDir(path);
		await copy(sourcePath, path, { overwrite: true });

		// HACK: Restore gen file
		if (tempGenDir && tempGenPath) {
			// Cannot `move` from a temp dir because /tmp might be in a
			// different file system
			await copy(tempGenPath, genPath, { overwrite: true });
			await Deno.remove(tempGenDir, { recursive: true });
		}
	} else {
		// Use original path
		path = sourcePath;
	}

	return { path, sourcePath: sourcePath, registry };
}

function registryNameForModule(module: ProjectModuleConfig): string {
	return module.registry ?? "default";
}

function moduleNameInRegistry(
	moduleName: string,
	module: ProjectModuleConfig,
): string {
	return module.module ?? moduleName;
}

export const GITIGNORE_PATH = ".gitignore";
export const RUNTIME_CONFIG_PATH = "runtime_config.ts";
export const ENTRYPOINT_PATH = "entrypoint.ts";
export const ACTOR_PATH = "actor.ts";
export const BUNDLE_PATH = "output.js";
export const MANIFEST_PATH = "manifest.json";
export const META_PATH = "meta.json";
export const OPEN_API_PATH = "openapi.json";
export const CACHE_PATH = "cache.json";
export const RUNTIME_PATH = "runtime";
export const PRISMA_WORKSPACE_PATH = "prisma_workspace";
export const SDK_PATH = "sdk";

export function genPath(project: Project, ...pathSegments: string[]): string {
	return resolve(project.path, ".opengb", ...pathSegments);
}

export function genRuntimeModPath(project: Project): string {
	return genPath(project, "runtime", "src", "runtime", "mod.ts");
}

export function genDependencyTypedefPath(project: Project): string {
	return genPath(project, "dependencies.d.ts");
}
export function genDependencyCaseConversionMapPath(project: Project): string {
	return genPath(project, "dependencyCaseConversion.ts");
}

export function genActorTypedefPath(project: Project): string {
	return genPath(project, "actors.d.ts");
}
export function genActorCaseConversionMapPath(project: Project): string {
	return genPath(project, "actorCaseConversion.ts");
}

function genPublicUtilsFolder(project: Project): string {
	return genPath(project, "public");
}

/**
 * Inner file used to nest any imports related to this module.
 *
 * This will be re-imported in other `genModulePublicExternal`.
 */
export function genModulePublicInternal(project: Project, module: Module): string {
	return resolve(genPublicUtilsFolder(project), `internal_${module.name}.ts`);
}

/**
 * File that gets imported as `Module` in the module.gen.ts.
 *
 * This exports the dependencies (the `genModulePublicInternal` files) with
 * their given module names.
 */
export function genModulePublicExternal(project: Project, module: Module): string {
	return resolve(genPublicUtilsFolder(project), `external_${module.name}.ts`);
}

function genDependenciesFolder(project: Project): string {
	return genPath(project, "dependencies");
}

export function genModuleDependenciesPath(project: Project, module: Module): string {
	return resolve(genDependenciesFolder(project), `dependencies_${module.name}.ts`);
}

export function genPrismaOutputFolder(project: Project, module: Module): string {
	return genPath(project, "prisma_output", module.name);
}

/**
 * Final processed JavaScript bundle that can be used to interact with the database.
 */
export function genPrismaOutputBundle(project: Project, module: Module): string {
	return resolve(genPrismaOutputFolder(project, module), "esm.js");
}

export function genActorPath(project: Project): string {
	return genPath(project, "actor.ts");
}

export interface ListSourceFileOpts {
	/**
	 * Only include local files.
	 *
	 * Useful for commands that are only relevant to modules written by the user.
	 */
	localOnly?: boolean;
}

/**
 * List all paths to TypeScript files in the project.
 */
export async function listSourceFiles(
	project: Project,
	opts: ListSourceFileOpts = {},
): Promise<string[]> {
	const files: string[] = [];
	for (const module of project.modules.values()) {
		// Skip non-local files
		if (opts.localOnly && module.registry.isExternal) continue;

		const moduleFiles = (await glob.glob("**/*.ts", { cwd: module.path, ignore: ".opengb/**" }))
			.map((x) => resolve(module.path, x));
		files.push(...moduleFiles);
	}
	return files;
}

export async function cleanProject(project: Project) {
	await Deno.remove(genPath(project), { recursive: true });
}

export function getDefaultRegistry(project: Project): Registry | undefined {
	return project.registries.get("default");
}

export function getLocalRegistry(
	project: Project,
): Registry | undefined {
	const localRegistry = project.registries.get("local");
	if (localRegistry) {
		assert("local" in localRegistry.config);
		assert(!localRegistry.isExternal);
		return localRegistry;
	} else {
		return undefined;
	}
}
