import { Command, ValidationError } from "../deps.ts";
import { GlobalOpts, initProject } from "../common.ts";
import { build, DbDriver, Format, Runtime } from "../../build/mod.ts";
import { watch } from "../../watch/mod.ts";
import { Project } from "../../project/mod.ts";

export const buildCommand = new Command<GlobalOpts>()
	.description("Build the project")
	.option("--watch", "Automatically rebuild on changes", { default: false })
	.option(
		"-r, --runtime <runtime:string>",
		"Set target runtime (deno, cloudflare)",
		{
			default: "deno",
			value: (value: string) => {
				if (value == "deno") {
					return Runtime.Deno;
				} else if (value == "cloudflare-workers-platforms") {
					return Runtime.CloudflareWorkersPlatforms;
				} else {
					throw new ValidationError(
						`\`runtime\` must be one of "deno" or "cloudflare-workers-platforms" but got "${value}".`,
					);
				}
			},
		},
	)
	.option(
		"-f, --output-format <format:string>",
		"Set output format (native, bundled)",
		{
			// default: "native",
			value: (value: string) => {
				if (value == "native") {
					return Format.Native;
				} else if (value == "bundled") {
					return Format.Bundled;
				} else {
					throw new ValidationError(
						`\`output-format\` format must be one of "native", or "bundled" but got "${value}".`,
					);
				}
			},
		},
	)
	.option(
		"--db-driver <target:string>",
		"Set target runtime (node-postgres, neon-serverless)",
		{
			// default: "node-postgres",
			value: (value: string) => {
				if (value == "node-postgres") {
					return DbDriver.NodePostgres;
				} else if (value == "neon-serverless") {
					return DbDriver.NeonServerless;
				} else if (value == "cloudflare-hyperdrive") {
					return DbDriver.CloudflareHyperdrive;
				} else {
					throw new ValidationError(
						`\`db-driver\` must be one of "node-postgres", "neon-serverless", or "cloudflare-hyperdrive", but got "${value}".`,
					);
				}
			},
		},
	)
	.option(
		"--auto-migrate",
		"Automatically migrate the database",
		{ default: false },
	)
	.option("--force-deploy-migrations", "Auto deploy migrations without using development prompt", { default: false })
	.option(
		"--no-strict-schemas",
		"Disable strict schema validation",
	)
	.action(async (opts) => {
		const project = await initProject(opts);

		// Defaults based on runtime
		if (opts.runtime == Runtime.Deno) {
			if (opts.outputFormat == undefined) opts.outputFormat = Format.Native;
			if (opts.dbDriver == undefined) opts.dbDriver = DbDriver.NodePostgres;
		} else if (opts.runtime == Runtime.CloudflareWorkersPlatforms) {
			if (opts.outputFormat == undefined) opts.outputFormat = Format.Bundled;
			if (opts.dbDriver == undefined) opts.dbDriver = DbDriver.CloudflareHyperdrive;
		}

		// Validate
		if (opts.runtime == Runtime.CloudflareWorkersPlatforms) {
			if (opts.outputFormat != Format.Bundled) {
				throw new ValidationError(
					`\`format\` must be "bundled" if \`runtime\` is "cloudflare-workers-platforms".`,
				);
			}
			if (opts.dbDriver != DbDriver.NeonServerless && opts.dbDriver != DbDriver.CloudflareHyperdrive) {
				throw new ValidationError(
					`\`db-driver\` must be "neon-serverless" or "cloudflare-hyperdrive" if \`runtime\` is "cloudflare-workers-platforms".`,
				);
			}
		}
		if (opts.runtime == Runtime.Deno) {
			if (opts.outputFormat != Format.Native) {
				throw new ValidationError(
					`\`format\` must be "native" if \`runtime\` is "deno".`,
				);
			}
		}

		await watch(project, {
			disableWatch: !opts.watch,
			async fn(project: Project, signal: AbortSignal) {
				await build(project, {
					format: opts.outputFormat!,
					runtime: opts.runtime,
					dbDriver: opts.dbDriver!,
					strictSchemas: opts.strictSchemas,
					skipDenoCheck: false,
					migrate: opts.autoMigrate
						? {
							forceDeploy: opts.forceDeployMigrations,
						}
						: undefined,
					signal,
				});
			},
		});
	});
