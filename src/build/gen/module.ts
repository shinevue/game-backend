import {
	genActorCaseConversionMapPath,
	genActorTypedefPath,
	hasUserConfigSchema,
	Module,
	moduleHelperGen,
	Project,
} from "../../project/mod.ts";
import { GeneratedCodeBuilder } from "./mod.ts";
import {
	genActorPath,
	genDependencyCaseConversionMapPath,
	genDependencyTypedefPath,
	genModulePublicExternal,
	genPath,
	genPrismaOutputBundle,
	genRuntimeModPath,
	RUNTIME_CONFIG_PATH,
} from "../../project/project.ts";
import { camelify } from "../../types/case_conversions.ts";

export async function compileModuleHelper(
	project: Project,
	module: Module,
) {
	const helper = new GeneratedCodeBuilder(moduleHelperGen(project, module), 3);

	const runtimePath = helper.relative(genRuntimeModPath(project));
	const dependencyCaseConversionMapPath = helper.relative(genDependencyCaseConversionMapPath(project));
	const actorCaseConversionMapPath = helper.relative(genActorCaseConversionMapPath(project));
	const runtimeConfigPath = helper.relative(genPath(project, RUNTIME_CONFIG_PATH));

	// Import block
	const importBlock = helper.chunk.withNewlinesPerChunk(1)
		.append`
			import {
				RuntimeError,
				ModuleContext as ModuleContextInner,
				Runtime,
				TestContext as TestContextInner,
				ScriptContext as ScriptContextInner,
			} from "${runtimePath}";
			import config from "${runtimeConfigPath}";
			import { dependencyCaseConversionMap } from "${dependencyCaseConversionMapPath}";
			import { actorCaseConversionMap } from "${actorCaseConversionMapPath}";

			import { ActorBase, ACTOR_DRIVER } from "${genActorPath(project)}";
		`;

	// Type helpers
	helper.chunk.append`
			/**
			 * Empty Request/Response type.
			 * 
			 * This only exists because of some quirks of empty interfaces in
			 * typescript that can be read more about here:
			 * https://www.totaltypescript.com/the-empty-object-type-in-typescript
			 */
			export type Empty = Record<string, never>;
		`;

	// Common exports
	helper.chunk.append`
			export { RuntimeError, ActorBase };
		`;

	// Gen blocks
	const { userConfigType } = await genUserConfig(project, module, helper);
	genPublic(project, module, helper);
	genDependencies(project, module, helper);
	genActors(project, module, helper);
	genModule(project, module, helper, importBlock, userConfigType);
	genTest(project, module, helper, userConfigType);
	genScript(project, module, helper, userConfigType);

	// Write source
	await helper.write();
}

async function genUserConfig(
	_project: Project,
	module: Module,
	helper: GeneratedCodeBuilder,
): Promise<{ userConfigType: string }> {
	let userConfigType = "Record<string, never>";
	if (await hasUserConfigSchema(module)) {
		userConfigType = "UserConfig";
		helper.chunk.append`import { Config as UserConfig } from "./config.ts";`;
	}
	return { userConfigType };
}

function genPublic(project: Project, module: Module, helper: GeneratedCodeBuilder) {
	const publicExternalPath = helper.relative(genModulePublicExternal(project, module));
	helper.append`
		export * as Module from ${JSON.stringify(publicExternalPath)};
	`;
}

function genDependencies(
	project: Project,
	module: Module,
	helper: GeneratedCodeBuilder,
) {
	const typedefPath = genDependencyTypedefPath(project);

	helper.append`
		import type {
			DependenciesSnake as DependenciesSnakeFull,
			DependenciesCamel as DependenciesCamelFull,
		} from "${typedefPath}";
	`;

	const dependencyTypedefSnake = helper.chunk.withNewlinesPerChunk(1);
	const dependencyTypedefCamel = helper.chunk.withNewlinesPerChunk(1);

	const moduleNameSnake = module.name;
	const moduleNameCamel = camelify(module.name);

	for (const dependencyName of Object.keys(module.config.dependencies || {})) {
		const dependencyNameSnake = dependencyName;
		const dependencyNameCamel = camelify(dependencyName);

		dependencyTypedefSnake.append`
			${dependencyNameSnake}: DependenciesSnakeFull["${dependencyNameSnake}"];
		`;
		dependencyTypedefCamel.append`
			${dependencyNameCamel}: DependenciesCamelFull["${dependencyNameCamel}"];
		`;
	}

	dependencyTypedefSnake.prepend`${moduleNameSnake}: DependenciesSnakeFull["${moduleNameSnake}"];`;
	dependencyTypedefCamel.prepend`${moduleNameCamel}: DependenciesCamelFull["${moduleNameCamel}"];`;

	GeneratedCodeBuilder.wrap(
		"interface DependenciesSnake {",
		dependencyTypedefSnake,
		"}",
	);
	GeneratedCodeBuilder.wrap(
		"interface DependenciesCamel {",
		dependencyTypedefCamel,
		"}",
	);
}

function genActors(
	project: Project,
	module: Module,
	helper: GeneratedCodeBuilder,
) {
	const typedefPath = genActorTypedefPath(project);

	helper.append`
		import type {
			ActorsSnake as ActorsSnakeFull,
			ActorsCamel as ActorsCamelFull,
		} from "${typedefPath}";
	`;

	const actorsTypedefSnake = helper.chunk.withNewlinesPerChunk(1);
	const actorsTypedefCamel = helper.chunk.withNewlinesPerChunk(1);

	const moduleNameSnake = module.name;
	const moduleNameCamel = camelify(module.name);

	for (const dependencyName of Object.keys(module.config.dependencies || {})) {
		const dependencyNameSnake = dependencyName;
		const dependencyNameCamel = camelify(dependencyName);

		actorsTypedefSnake.append`
			${dependencyNameSnake}: ActorsSnakeFull["${dependencyNameSnake}"];
		`;
		actorsTypedefCamel.append`
			${dependencyNameCamel}: ActorsCamelFull["${dependencyNameCamel}"];
		`;
	}

	actorsTypedefSnake.prepend`${moduleNameSnake}: ActorsSnakeFull["${moduleNameSnake}"];`;
	actorsTypedefCamel.prepend`${moduleNameCamel}: ActorsCamelFull["${moduleNameCamel}"];`;

	GeneratedCodeBuilder.wrap(
		"interface ActorsSnake {",
		actorsTypedefSnake,
		"}",
	);
	GeneratedCodeBuilder.wrap(
		"interface ActorsCamel {",
		actorsTypedefCamel,
		"}",
	);
}

function genModule(
	project: Project,
	module: Module,
	helper: GeneratedCodeBuilder,
	importBlock: GeneratedCodeBuilder,
	userConfigType: string,
) {
	// Database
	if (module.db) {
		const prismaBundlePath = helper.relative(genPrismaOutputBundle(project, module));
		importBlock.append`
			import prisma from ${JSON.stringify(prismaBundlePath)};
			export { prisma };
			export const Prisma = prisma.Prisma;
		`;
	}

	// Export block
	helper.chunk.withNewlinesPerChunk(2)
		.append`
			export type ModuleContext = ModuleContextInner<
				DependenciesSnake,
				DependenciesCamel,
				ActorsSnake,
				ActorsCamel,
				${userConfigType},
				${module.db ? "prisma.PrismaClient" : "undefined"},
				${module.db ? "string" : "undefined"}
			>;
		`;
}

function genTest(
	_project: Project,
	module: Module,
	helper: GeneratedCodeBuilder,
	userConfigType: string,
) {
	// Export block
	helper.chunk.withNewlinesPerChunk(1)
		.newline()
		.append`
			export type TestContext = TestContextInner<
				DependenciesSnake,
				DependenciesCamel,
				ActorsSnake,
				ActorsCamel,
				${userConfigType},
				${module.db ? "prisma.PrismaClient" : "undefined"},
				${module.db ? "string" : "undefined"}
			>;
		`;

	// Test Block
	helper.chunk.withNewlinesPerChunk(2)
		.append`export type TestFn = (ctx: TestContext) => Promise<void>;`
		.append`
			export function test(name: string, fn: TestFn) {
				Runtime.test(
					config,
					ACTOR_DRIVER,
					"${module.name}",
					name,
					fn,
					dependencyCaseConversionMap,
					actorCaseConversionMap,
				);
			}
		`;
}

function genScript(
	_project: Project,
	module: Module,
	helper: GeneratedCodeBuilder,
	userConfigType: string,
) {
	// Export block
	helper.chunk.withNewlinesPerChunk(1)
		.newline()
		.append`
			export type ScriptContext = ScriptContextInner<
				DependenciesSnake,
				DependenciesCamel,
				ActorsSnake,
				ActorsCamel,
				${userConfigType},
				${module.db ? "prisma.PrismaClient" : "undefined"},
				${module.db ? "string" : "undefined"}
			>;
		`;
}
