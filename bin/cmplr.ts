#!/usr/bin/env node

import { promises as fs } from "node:fs";
import * as path from "path";
import { execSync } from "child_process";
import convert, { TSConfig } from "tsconfig-swc";

interface SWCConfig {
  jsc: {
    parser: {
      syntax: "typescript" | "ecmascript";
      tsx?: boolean;
      jsx?: boolean;
      decorators?: boolean;
    };
    target: string;
    loose?: boolean;
    externalHelpers?: boolean;
  };
  module: {
    type: "commonjs" | "es6";
  };
  sourceMaps: boolean;
  exclude?: string[];
}

interface CLIArgs {
  dryRun: boolean;
  help: boolean;
  version: boolean;
  srcDir?: string;
  outDir: string;
  noTypes: boolean;
}

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const parseArgs = (): CLIArgs => {
  const args = process.argv.slice(2);
  const parsed: CLIArgs = {
    dryRun: false,
    help: false,
    version: false,
    outDir: "dist",
    noTypes: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--version":
      case "-v":
        parsed.version = true;
        break;
      case "--src-dir":
        parsed.srcDir = args[++i];
        break;
      case "--out-dir":
        parsed.outDir = args[++i];
        break;
      case "--no-types":
        parsed.noTypes = true;
        break;
      default:
        if (arg.startsWith("--")) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }

  return parsed;
};

const showHelp = () => {
  console.log(`
cmplr - Speedy web compiler without the config

Usage: cmplr [options]

Options:
  --dry-run      Show what would be compiled without executing
  --help, -h     Show this help message
  --version, -v  Show version number
  --src-dir      Source directory (default: auto-detect from tsconfig or 'src')
  --out-dir      Output directory (default: 'dist')
  --no-types     Skip TypeScript declaration generation

Examples:
  cmplr                    # Compile with auto-detected settings (automatically cleans output)
  cmplr --dry-run          # Preview compilation
  cmplr --src-dir lib      # Use 'lib' as source directory
`);
};

const showVersion = async () => {
  const content = await fs.readFile(
    path.join(__dirname, "../../package.json"),
    "utf8"
  );
  const packageJson = JSON.parse(content);
  console.log(packageJson.version);
};

const readTSConfig = async (): Promise<TSConfig | null> => {
  const tsconfigPath = path.join(process.cwd(), "tsconfig.json");
  if (!(await fileExists(tsconfigPath))) {
    return null;
  }

  try {
    const content = await fs.readFile(tsconfigPath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    console.warn("Warning: Could not parse tsconfig.json, using defaults");
    return null;
  }
};

const detectSourceDir = async (
  tsconfig: TSConfig | null,
  srcDirArg?: string
): Promise<string> => {
  if (srcDirArg) return srcDirArg;

  if (tsconfig?.compilerOptions?.rootDir) {
    return tsconfig.compilerOptions.rootDir;
  }

  if (await fileExists("src")) return "src";
  if (await fileExists("lib")) return "lib";
  if (await fileExists("bin")) return "bin";

  return "src";
};

const createSWCConfig = async (
  tsconfig: TSConfig | null,
  moduleType: "commonjs" | "es6",
  srcDir: string
): Promise<SWCConfig> => {
  let files: string[] = [];
  if (await fileExists(srcDir)) {
    const dirents = await fs.readdir(srcDir, { withFileTypes: true });
    files = dirents
      .filter((dirent) => dirent.isFile())
      .map((dirent) => dirent.name);
  }

  const hasTypeScript = files.some(
    (file) => file.endsWith(".ts") || file.endsWith(".tsx")
  );
  const hasTSX = files.some((file) => file.endsWith(".tsx"));
  const hasJSX = files.some(
    (file) => file.endsWith(".jsx") || file.endsWith(".tsx")
  );

  // Use tsconfig-swc to convert TypeScript config to SWC config
  let baseConfig: any = {};
  if (tsconfig) {
    try {
      baseConfig = convert(tsconfig);
    } catch (error) {
      console.warn(
        "Warning: Could not convert tsconfig with tsconfig-swc, using fallback"
      );
    }
  }

  // Override with our specific requirements and auto-detected settings
  const config: SWCConfig = {
    ...baseConfig,
    jsc: {
      ...baseConfig.jsc,
      parser: {
        ...baseConfig.jsc?.parser,
        syntax: hasTypeScript ? "typescript" : "ecmascript",
        tsx: hasTSX,
        jsx: hasJSX,
        decorators:
          baseConfig.jsc?.parser?.decorators ??
          (tsconfig?.compilerOptions?.experimentalDecorators || false),
      },
      target: baseConfig.jsc?.target || "es2020",
      loose: baseConfig.jsc?.loose ?? false,
      externalHelpers: baseConfig.jsc?.externalHelpers ?? false,
    },
    module: {
      type: moduleType, // Always override module type for dual compilation
    },
    sourceMaps: baseConfig.sourceMaps ?? true,
  };

  if (tsconfig?.exclude) {
    config.exclude = tsconfig.exclude;
  }

  return config;
};

const detectEntryPoints = async (srcDir: string): Promise<string[]> => {
  if (!(await fileExists(srcDir))) {
    throw new Error(`Source directory '${srcDir}' does not exist`);
  }

  const dirents = await fs.readdir(srcDir, { withFileTypes: true });
  const files = dirents
    .filter((dirent) => dirent.isFile())
    .map((dirent) => dirent.name)
    .filter(
      (file) =>
        /\.(ts|tsx|js|jsx)$/.test(file) &&
        !file.includes(".test.") &&
        !file.includes(".spec.")
    );

  // If there's an index file, return all files (index + other entry points)
  const indexFile = files.find((file) => file.startsWith("index."));
  if (indexFile) {
    return files; // Return all files including index
  }

  return files;
};

const createTempSWCConfig = async (
  config: SWCConfig,
  configName: string
): Promise<string> => {
  const tempDir = path.join(__dirname, "../.temp");
  if (!(await fileExists(tempDir))) {
    await fs.mkdir(tempDir, { recursive: true });
  }

  const configPath = path.join(tempDir, `${configName}.swcrc`);
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  return configPath;
};

const cleanupTempConfigs = async () => {
  const tempDir = path.join(__dirname, "../.temp");
  if (await fileExists(tempDir)) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
};

const updatePackageJsonExports = async (
  entryPoints: string[],
  outDir: string,
  noTypes: boolean
) => {
  const packageJsonPath = path.join(process.cwd(), "package.json");
  if (!(await fileExists(packageJsonPath))) {
    console.warn("Warning: package.json not found, skipping exports update");
    return;
  }

  const content = await fs.readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(content);

  if (entryPoints.length === 1 && entryPoints[0].startsWith("index.")) {
    const baseName = path.parse(entryPoints[0]).name;
    packageJson.main = `./${outDir}/cjs/${baseName}.js`;
    packageJson.module = `./${outDir}/esm/${baseName}.js`;
    if (!noTypes) {
      packageJson.types = `./${outDir}/types/${baseName}.d.ts`;
    }

    packageJson.exports = {
      ".": {
        import: `./${outDir}/esm/${baseName}.js`,
        require: `./${outDir}/cjs/${baseName}.js`,
        ...(noTypes ? {} : { types: `./${outDir}/types/${baseName}.d.ts` }),
      },
    };
  } else {
    packageJson.exports = {};
    entryPoints.forEach((entry) => {
      const baseName = path.parse(entry).name;
      const exportKey = baseName === "index" ? "." : `./${baseName}`;
      packageJson.exports[exportKey] = {
        import: `./${outDir}/esm/${baseName}.js`,
        require: `./${outDir}/cjs/${baseName}.js`,
        ...(noTypes ? {} : { types: `./${outDir}/types/${baseName}.d.ts` }),
      };
    });

    const mainEntry =
      entryPoints.find((e) => e.startsWith("index.")) || entryPoints[0];
    const mainBaseName = path.parse(mainEntry).name;
    packageJson.main = `./${outDir}/cjs/${mainBaseName}.js`;
    packageJson.module = `./${outDir}/esm/${mainBaseName}.js`;
    if (!noTypes) {
      packageJson.types = `./${outDir}/types/${mainBaseName}.d.ts`;
    }
  }

  await fs.writeFile(
    packageJsonPath,
    JSON.stringify(packageJson, null, 2) + "\n"
  );
};

const main = async () => {
  const args = parseArgs();

  if (args.help) {
    showHelp();
    return;
  }

  if (args.version) {
    await showVersion();
    return;
  }

  const tsconfig = await readTSConfig();
  const srcDir = await detectSourceDir(tsconfig, args.srcDir);
  const entryPoints = await detectEntryPoints(srcDir);

  if (args.dryRun) {
    console.log("Dry run - would compile:");
    console.log(`  Source: ${srcDir}`);
    console.log(`  Output: ${args.outDir}`);
    console.log(`  Entry points: ${entryPoints.join(", ")}`);
    console.log(`  TypeScript config: ${tsconfig ? "found" : "not found"}`);
    console.log(`  Generate types: ${!args.noTypes}`);
    return;
  }

  try {
    // Always clean output directory before compilation
    if (await fileExists(args.outDir)) {
      console.log(`Cleaning ${args.outDir}...`);
      await fs.rm(args.outDir, { recursive: true, force: true });
    }

    const cjsConfig = await createSWCConfig(tsconfig, "commonjs", srcDir);
    const esmConfig = await createSWCConfig(tsconfig, "es6", srcDir);

    const cjsConfigPath = await createTempSWCConfig(cjsConfig, "cjs");
    const esmConfigPath = await createTempSWCConfig(esmConfig, "esm");

    console.log("Compiling CommonJS...");
    execSync(
      `npx swc ${srcDir} -d ${args.outDir}/cjs --config-file ${cjsConfigPath} --strip-leading-paths`,
      { stdio: "inherit" }
    );

    console.log("Compiling ESM...");
    execSync(
      `npx swc ${srcDir} -d ${args.outDir}/esm --config-file ${esmConfigPath} --strip-leading-paths`,
      { stdio: "inherit" }
    );

    if (!args.noTypes && tsconfig) {
      console.log("Generating TypeScript declarations...");
      const tscCommand = `npx tsc --declaration --emitDeclarationOnly --outDir ${args.outDir}/types`;
      execSync(tscCommand, { stdio: "inherit" });
    }

    await updatePackageJsonExports(entryPoints, args.outDir, args.noTypes);

    console.log("Compilation complete!");
  } catch (error) {
    console.error("Compilation failed:", error);
    process.exit(1);
  } finally {
    await cleanupTempConfigs();
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error("Unexpected error:", error);
    process.exit(1);
  });
}
