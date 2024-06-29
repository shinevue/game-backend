import { BuildState, buildStep } from "../../build_state/mod.ts";
import { assertExists } from "../../deps.ts";
import { Module, Project, Script } from "../../project/mod.ts";
import { compileScriptSchema } from "../script_schema.ts";
import { BuildOpts } from "../mod.ts";

export async function planScriptBuild(
	buildState: BuildState,
	project: Project,
	module: Module,
	script: Script,
	opts: BuildOpts,
) {
	buildStep(buildState, {
		id: `module.${module.name}.script.${script.name}.parse`,
		name: "Parse",
		description: `${script.name}.ts`,
		module,
		script,
		condition: {
			// TODO: This module and all of its dependent scripts. Use tjs.getProgramFiles() to get the dependent files?
			files: [
				// If the script is modified
				script.path,
			],
			expressions: {
				strictSchemas: opts.strictSchemas,
			},
		},
		delayedStart: true,
		async build({ onStart }) {
			// Compile schema
			//
			// This mutates `script`
			await compileScriptSchema(project, module, script, { strictSchemas: opts.strictSchemas, onStart });
		},
		async alreadyCached() {
			// Read schemas from cache
			const schemas = buildState.cache.persist.scriptSchemas[module.name][script.name];
			assertExists(schemas);
			script.requestSchema = schemas.request;
			script.responseSchema = schemas.response;
		},
		async finally() {
			assertExists(script.requestSchema);
			assertExists(script.responseSchema);

			// Populate cache with response
			if (!buildState.cache.persist.scriptSchemas[module.name]) {
				buildState.cache.persist.scriptSchemas[module.name] = {};
			}
			buildState.cache.persist.scriptSchemas[module.name][script.name] = {
				request: script.requestSchema,
				response: script.responseSchema,
			};
		},
	});
}
