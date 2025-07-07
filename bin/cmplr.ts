#!/usr/bin/env node

import { promises as fs } from "node:fs";
import * as path from "path";
import { execSync } from "child_process";
import convert, { TSConfig } from "tsconfig-swc";
import install from "@bredele/package-install";

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
  command: "compile" | "create";
  dryRun: boolean;
  help: boolean;
  version: boolean;
  srcDir?: string;
  outDir: string;
  noTypes: boolean;
  typeCheck: boolean;
  // Create command specific
  projectName?: string;
}

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const hasTypeScriptInstalled = async (): Promise<boolean> => {
  // Check if TypeScript exists in project's package.json
  const packageJsonPath = path.join(process.cwd(), "package.json");
  if (await fileExists(packageJsonPath)) {
    try {
      const content = await fs.readFile(packageJsonPath, "utf8");
      const packageJson = JSON.parse(content);
      if (
        packageJson.dependencies?.typescript ||
        packageJson.devDependencies?.typescript
      ) {
        return true;
      }
    } catch {
      // Continue to fallback check
    }
  }

  // Fallback: try to resolve TypeScript
  try {
    require.resolve("typescript");
    return true;
  } catch {
    return false;
  }
};

const ensureTypeScriptInstalled = async (): Promise<void> => {
  if (await hasTypeScriptInstalled()) {
    return;
  }

  console.log("TypeScript not found, installing as dev dependency...");
  try {
    await install("typescript", true);
    console.log("TypeScript installed successfully.");
  } catch (error) {
    throw new Error(`Failed to install TypeScript: ${error}`);
  }
};

const performTypeCheck = async (srcDir: string): Promise<void> => {
  console.log("Running type check...");
  try {
    execSync(`npx tsc --noEmit --rootDir ${srcDir}`, {
      stdio: "inherit",
      cwd: process.cwd(),
    });
    console.log("Type check passed!");
  } catch (error) {
    throw new Error("Type check failed");
  }
};

const parseArgs = (): CLIArgs => {
  const args = process.argv.slice(2);
  const parsed: CLIArgs = {
    command: "compile", // default command
    dryRun: false,
    help: false,
    version: false,
    outDir: "dist",
    noTypes: false,
    typeCheck: false,
  };

  // Check for subcommand as first argument
  if (args.length > 0 && !args[0].startsWith("-")) {
    const subcommand = args[0];
    if (subcommand === "create") {
      parsed.command = "create";
      // Get project name as second argument
      if (args.length > 1 && !args[1].startsWith("-")) {
        parsed.projectName = args[1];
      }
      // Start parsing from index 2 (or 1 if no project name)
      args.splice(0, parsed.projectName ? 2 : 1);
    }
  }

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
      case "--type-check":
        parsed.typeCheck = true;
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

const showHelp = (command?: string) => {
  if (command === "create") {
    console.log(`
cmplr create - Create and initialize a new TypeScript project

Usage: cmplr create [project-name] [options]

Options:
  --help, -h     Show this help message

Examples:
  cmplr create my-project  # Create a new project in 'my-project' directory
  cmplr create             # Create a new project in current directory
`);
  } else {
    console.log(`
cmplr - Speedy web compiler without the config

Usage: cmplr [command] [options]

Commands:
  compile        Compile TypeScript/JavaScript files (default)
  create         Create and initialize a new TypeScript project

Compile Options:
  --dry-run      Show what would be compiled without executing
  --help, -h     Show this help message
  --version, -v  Show version number
  --src-dir      Source directory (default: auto-detect from tsconfig or 'src')
  --out-dir      Output directory (default: 'dist')
  --no-types     Skip TypeScript declaration generation
  --type-check   Enable TypeScript type checking (installs TypeScript if needed)

Examples:
  cmplr                    # Compile with auto-detected settings (automatically cleans output)
  cmplr --dry-run          # Preview compilation
  cmplr --src-dir lib      # Use 'lib' as source directory
  cmplr --type-check       # Compile with type checking enabled
  cmplr create my-project  # Create a new TypeScript project
`);
  }
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

  // Add or update the "files" field to include the dist folder
  if (!packageJson.files) {
    packageJson.files = [outDir];
  } else if (
    Array.isArray(packageJson.files) &&
    !packageJson.files.includes(outDir)
  ) {
    packageJson.files.push(outDir);
  }

  await fs.writeFile(
    packageJsonPath,
    JSON.stringify(packageJson, null, 2) + "\n"
  );
};

const createProject = async (projectName?: string) => {
  // Determine project directory
  const projectDir = projectName
    ? path.join(process.cwd(), projectName)
    : process.cwd();
  const actualProjectName = projectName || path.basename(process.cwd());

  // Create project directory if it doesn't exist
  if (projectName && !(await fileExists(projectDir))) {
    await fs.mkdir(projectDir, { recursive: true });
    console.log(`Created project directory: ${projectName}`);
  }

  // Create lib directory
  const libDir = path.join(projectDir, "lib");
  if (!(await fileExists(libDir))) {
    await fs.mkdir(libDir, { recursive: true });
    console.log(`Created lib directory`);
  }

  // Create or update package.json
  const packageJsonPath = path.join(projectDir, "package.json");
  let packageJson: any;

  if (await fileExists(packageJsonPath)) {
    // Read existing package.json and update scripts
    const content = await fs.readFile(packageJsonPath, "utf8");
    packageJson = JSON.parse(content);

    // Update scripts
    if (!packageJson.scripts) {
      packageJson.scripts = {};
    }
    packageJson.scripts.build = "cmplr --type-check";
    packageJson.scripts.test = "node --test dist/cjs/**/*.test.js";

    await fs.writeFile(
      packageJsonPath,
      JSON.stringify(packageJson, null, 2) + "\n"
    );
    console.log(`Updated package.json scripts`);
  } else {
    // Create new package.json
    packageJson = {
      name: actualProjectName,
      version: "1.0.0",
      files: ["dist"],
      scripts: {
        build: "cmplr --type-check",
        test: "node --test dist/cjs/**/*.test.js",
      },
    };

    await fs.writeFile(
      packageJsonPath,
      JSON.stringify(packageJson, null, 2) + "\n"
    );
    console.log(`Created package.json`);
  }

  // Create tsconfig.json
  const tsconfigPath = path.join(projectDir, "tsconfig.json");
  const tsconfigJson = {
    compilerOptions: {
      target: "ES2021",
      lib: ["ES2021"],
      types: ["node"],
      module: "CommonJS",
      moduleResolution: "node",
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      strict: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      declaration: true,
      declarationMap: true,
      outDir: "dist",
      rootDir: "lib",
      noEmit: false,
      resolveJsonModule: true,
    },
    include: ["lib/**/*"],
    exclude: ["node_modules", "dist"],
  };

  if (!(await fileExists(tsconfigPath))) {
    await fs.writeFile(
      tsconfigPath,
      JSON.stringify(tsconfigJson, null, 2) + "\n"
    );
    console.log(`Created tsconfig.json`);
  } else {
    console.log(`tsconfig.json already exists, skipping`);
  }

  // Create lib/index.ts
  const indexPath = path.join(libDir, "index.ts");
  if (!(await fileExists(indexPath))) {
    await fs.writeFile(indexPath, "");
    console.log(`Created lib/index.ts`);
  } else {
    console.log(`lib/index.ts already exists, skipping`);
  }

  // Create lib/index.test.ts
  const testPath = path.join(libDir, "index.test.ts");
  const testContent = `import test from 'node:test';
import assert from 'node:assert';
`;

  if (!(await fileExists(testPath))) {
    await fs.writeFile(testPath, testContent);
    console.log(`Created lib/index.test.ts`);
  } else {
    console.log(`lib/index.test.ts already exists, skipping`);
  }

  // Install dependencies
  console.log(`\nInstalling dependencies...`);
  try {
    // Change to project directory for installation
    const originalCwd = process.cwd();
    process.chdir(projectDir);

    await install("cmplr");
    await install("@types/node", true); // true for dev dependency

    // Change back to original directory
    process.chdir(originalCwd);

    console.log(`Dependencies installed successfully!`);
  } catch (error) {
    console.warn(`Warning: Failed to install dependencies: ${error}`);
    console.warn(
      `You can manually install them with: npm install cmplr && npm install --save-dev @types/node`
    );
  }

  console.log(`\nProject '${actualProjectName}' initialized successfully!`);
  console.log(`\nNext steps:`);
  if (projectName) {
    console.log(`  cd ${projectName}`);
  }
  console.log(`  npm run build`);
  console.log(`  npm test`);
};

const main = async () => {
  const args = parseArgs();

  if (args.help) {
    showHelp(args.command);
    return;
  }

  if (args.version) {
    await showVersion();
    return;
  }

  // Handle create command
  if (args.command === "create") {
    await createProject(args.projectName);
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
    console.log(`  Type check: ${args.typeCheck ? "enabled" : "disabled"}`);
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

    // Perform type checking if requested
    if (args.typeCheck) {
      await ensureTypeScriptInstalled();
      await performTypeCheck(srcDir);
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
