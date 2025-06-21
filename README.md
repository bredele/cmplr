# cmplr

Speedy web compiler without the config

## Features

- **Dual Module Output** - Automatically compiles to both CommonJS and ESM formats
- **Zero Configuration** - Works out of the box with sensible defaults
- **TypeScript Support** - Full TypeScript compilation with declaration generation
- **Smart Source Detection** - Auto-detects source directory (`src` > `lib` > `bin`)
- **SWC Powered** - Lightning-fast compilation using SWC
- **TypeScript Config Integration** - Reads and respects your `tsconfig.json` settings
- **Automatic Cleaning** - Cleans output directory before each build to prevent conflicts
- **Package.json Integration** - Automatically updates exports, main, module, and types fields
- **JSX/TSX Support** - Handles React components and JSX syntax
- **Decorators Support** - Works with experimental decorators
- **Source Maps** - Generates source maps for debugging
- **Multiple Entry Points** - Supports projects with multiple entry files
- **Dry Run Mode** - Preview what would be compiled without executing

Born from the frustration of repeatedly setting up TypeScript, SWC configs, and build tooling for every new module. `cmplr` does all the heavy lifting so you can focus on writing typescript code.

## Install

```sh
npm install cmplr --save-dev
```

## Usage

`cmplr` is a CLI you can directly add in your `package.json` scripts:

```json
{
  "scripts": {
    "build": "cmplr"
  }
}
```

### CLI Options

```bash
cmplr [options]

Options:
  --dry-run      Show what would be compiled without executing
  --help, -h     Show help message
  --version, -v  Show version number
  --src-dir      Source directory (default: auto-detect)
  --out-dir      Output directory (default: 'dist')
  --no-types     Skip TypeScript declaration generation
```

## Notes

- **Automatic Cleaning**: Output directory is cleaned before each compilation to prevent conflicts
- **Source Priority**: Detects source directory in order: `src` → `lib` → `bin` → fallback to `src`
- **TypeScript Config**: Respects your `tsconfig.json` settings for target, decorators, JSX, etc.
- **Package.json Updates**: Automatically sets `main`, `module`, `types`, and `exports` fields
- **SWC Configuration**: Uses `tsconfig-swc` for comprehensive TypeScript-to-SWC config conversion
- **File Detection**: Automatically detects TypeScript, JSX, and TSX files in source directory
- **Entry Points**: If `index.*` file exists, all files are treated as entry points; otherwise all non-test files
- **Output Structure**: Creates `dist/cjs/`, `dist/esm/`, and `dist/types/` directories
- **Dependencies**: Requires Node.js 16+ and uses `@swc/core` for compilation
