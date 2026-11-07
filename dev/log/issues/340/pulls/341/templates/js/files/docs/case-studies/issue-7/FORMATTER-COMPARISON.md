# JavaScript/TypeScript Code Formatter Comparison (2025)

## Overview

This document provides a comprehensive comparison of JavaScript/TypeScript code formatters available in 2025, focusing on their features, performance, CI integration, pre-commit hook support, and autoformatting capabilities.

**Analysis Date:** 2025-12-18

---

## Executive Summary

| Formatter       | Primary Use Case                  | Speed          | CI Support | Pre-commit | Autoformat | Active Development       |
| --------------- | --------------------------------- | -------------- | ---------- | ---------- | ---------- | ------------------------ |
| **Prettier**    | Industry standard, multi-language | Baseline       | ✅ Yes     | ✅ Yes     | ✅ Yes     | Active                   |
| **Biome**       | All-in-one linter + formatter     | 35-100x faster | ✅ Yes     | ✅ Yes     | ✅ Yes     | Very Active (2025 focus) |
| **dprint**      | Fast, focused formatter           | 20-60x faster  | ✅ Yes     | ✅ Yes     | ✅ Yes     | Active                   |
| **Standard JS** | Zero-config style guide           | Moderate       | ✅ Yes     | ✅ Yes     | ✅ Yes     | Maintenance mode         |

---

## Detailed Comparison

### 1. Prettier

**Website:** https://prettier.io/

#### Overview

- Opinionated code formatter with minimal configuration
- Industry standard with widespread adoption
- Supports JavaScript, TypeScript, JSX, JSON, CSS, HTML, Markdown, YAML, and more
- 20MB of npm dependencies

#### Performance

- Large codebases take seconds to format
- Adds up when formatting on every save or in pre-commit hooks
- Baseline for speed comparisons

#### Features

**CI Integration:**

```bash
# Check formatting
npx prettier --check "src/**/*.{js,ts,jsx,tsx}"

# Format files
npx prettier --write "src/**/*.{js,ts,jsx,tsx}"
```

**Pre-commit Hook (using husky + lint-staged):**

```json
{
  "husky": {
    "hooks": {
      "pre-commit": "lint-staged"
    }
  },
  "lint-staged": {
    "*.{js,ts,jsx,tsx}": "prettier --write"
  }
}
```

**Autoformat:**

- Format on save in VS Code
- CLI: `prettier --write .`
- Supports incremental formatting (only changed files)

#### Pros

- ✅ Mature ecosystem with extensive plugin support
- ✅ Works with virtually all editors and IDEs
- ✅ Consistent formatting across projects
- ✅ Large community and extensive documentation
- ✅ Multi-language support

#### Cons

- ❌ Slower than Rust-based alternatives
- ❌ Large dependency footprint
- ❌ Only handles formatting (requires separate linter)

#### Recommendation

**Best for:** Teams wanting a stable, well-documented, industry-standard formatter with broad language support.

---

### 2. Biome

**Website:** https://biomejs.dev/

#### Overview

- Modern toolchain combining linting and formatting
- Written in Rust for exceptional performance
- Replaces both ESLint and Prettier
- 97% compatibility with Prettier formatting
- **Note:** Biome is the community fork of Rome (forked August 2023)

#### Performance

- **7x faster** than Prettier on single-threaded workloads
- **100x faster** on multi-core systems (M1 Max with 10 cores)
- Significantly faster than both Prettier and dprint

#### Features

**CI Integration:**

```bash
# Check all files (formatting, linting, etc.)
npx @biomejs/biome ci ./src

# Check formatting only
npx @biomejs/biome format --check ./src

# Lint only
npx @biomejs/biome lint ./src
```

**Pre-commit Hook (using husky):**

```bash
# With --staged flag (Biome 1.7.0+)
npx @biomejs/biome check --error-on-warnings --no-errors-on-unmatched --staged

# Without lint-staged needed (baked-in support)
```

**Autoformat:**

```bash
# Format and apply safe fixes
npx @biomejs/biome check --write ./src

# Format only
npx @biomejs/biome format --write ./src
```

**Configuration (biome.json):**

```json
{
  "formatter": {
    "enabled": true,
    "indentStyle": "space"
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  }
}
```

#### Pros

- ✅ **All-in-one tool** (linter + formatter + more)
- ✅ Exceptional performance (35-100x faster than Prettier)
- ✅ Single configuration file (biome.json)
- ✅ Built-in staged file support (no lint-staged needed)
- ✅ Type-aware linting (Biome 2.0+)
- ✅ Plugin support (2025)
- ✅ Very active development
- ✅ Simplifies toolchain (fewer dependencies)

#### Cons

- ❌ Newer tool (less mature than Prettier)
- ❌ Smaller community and ecosystem
- ❌ Missing some typescript-eslint rules (64 of 100+)
- ❌ No incremental formatting (formats all files)
- ❌ Type-checking still experimental vs. full TypeScript compiler

#### Recent Milestones

- **June 2025:** Biome v2.0 - type-aware linting, plugins, multi-file analysis
- **January 2024:** Biome reaches 97% Prettier compatibility
- **August 2023:** Forked from Rome after Rome Tools Inc. shutdown

#### Recommendation

**Best for:** Teams wanting a unified, high-performance toolchain and willing to adopt newer technology. Ideal for TypeScript projects where speed is critical.

---

### 3. dprint

**Website:** https://dprint.dev/

#### Overview

- Code formatter written in Rust
- Compiles to native binary (~15MB)
- Zero npm dependencies
- Follows Prettier's formatting principles
- Focused solely on formatting (does one thing well)

#### Performance

- **20-60x faster** than Prettier
- Entire pre-commit hook runs in **under 1 second** (~100ms for formatting)
- Commits feel instant

#### Features

**CI Integration:**

```bash
# Check formatting
dprint check

# Format files
dprint fmt
```

**Pre-commit Hook:**

```bash
# Extremely fast pre-commit
dprint fmt --staged
```

**Configuration (.dprintrc.json):**

```json
{
  "typescript": {
    "lineWidth": 100
  },
  "json": {},
  "markdown": {},
  "includes": ["**/*.{ts,tsx,js,jsx,json,md}"],
  "excludes": ["**/node_modules"]
}
```

#### Pros

- ✅ **Exceptional speed** (20-60x faster)
- ✅ **Zero npm dependencies** (single binary)
- ✅ Focused tool that does one thing well
- ✅ Nearly identical to Prettier output
- ✅ Supports incremental formatting
- ✅ Fast pre-commit experience

#### Cons

- ❌ Only handles formatting (requires separate linter)
- ❌ Smaller ecosystem than Prettier
- ❌ Less editor integration than Prettier

#### Recommendation

**Best for:** Teams wanting the fastest possible formatter with minimal dependencies, who already have a linter (ESLint) and value specialized tools.

---

### 4. Standard JS

**Website:** https://standardjs.com/

#### Overview

- Zero-configuration JavaScript style guide
- Combines linting and formatting
- No configuration files needed
- Opinionated rules (semicolons, 2-space indent, etc.)

#### Features

**CI Integration:**

```bash
# Check code
standard

# Auto-fix issues
standard --fix
```

**Pre-commit Hook:**

```json
{
  "husky": {
    "hooks": {
      "pre-commit": "standard"
    }
  }
}
```

**Autoformat:**

```bash
standard --fix
```

#### Pros

- ✅ Zero configuration required
- ✅ Simple to set up
- ✅ Good for small projects or quick prototypes
- ✅ Combines linting and formatting

#### Cons

- ❌ Very opinionated (limited customization)
- ❌ JavaScript-only (no TypeScript without extensions)
- ❌ Slower than Rust-based alternatives
- ❌ Less active development

#### Recommendation

**Best for:** Solo developers or small projects wanting zero configuration. Not recommended for TypeScript or teams needing customization.

---

## Feature Comparison Matrix

### Core Capabilities

| Feature                    | Prettier    | Biome      | dprint         | Standard JS |
| -------------------------- | ----------- | ---------- | -------------- | ----------- |
| **Formatting**             | ✅ Yes      | ✅ Yes     | ✅ Yes         | ✅ Yes      |
| **Linting**                | ❌ No       | ✅ Yes     | ❌ No          | ✅ Yes      |
| **Type Checking**          | ❌ No       | ⚠️ Partial | ❌ No          | ❌ No       |
| **CI Check Mode**          | ✅ Yes      | ✅ Yes     | ✅ Yes         | ✅ Yes      |
| **Autoformat**             | ✅ Yes      | ✅ Yes     | ✅ Yes         | ✅ Yes      |
| **Pre-commit Support**     | ✅ Yes      | ✅ Yes     | ✅ Yes         | ✅ Yes      |
| **Incremental Formatting** | ✅ Yes      | ❌ No      | ✅ Yes         | ✅ Yes      |
| **Configuration File**     | .prettierrc | biome.json | .dprintrc.json | ❌ None     |

### Language Support

| Language   | Prettier | Biome  | dprint | Standard JS   |
| ---------- | -------- | ------ | ------ | ------------- |
| JavaScript | ✅ Yes   | ✅ Yes | ✅ Yes | ✅ Yes        |
| TypeScript | ✅ Yes   | ✅ Yes | ✅ Yes | ⚠️ Via plugin |
| JSX/TSX    | ✅ Yes   | ✅ Yes | ✅ Yes | ✅ Yes        |
| JSON       | ✅ Yes   | ✅ Yes | ✅ Yes | ❌ No         |
| CSS        | ✅ Yes   | ✅ Yes | ✅ Yes | ❌ No         |
| HTML       | ✅ Yes   | ✅ Yes | ✅ Yes | ❌ No         |
| Markdown   | ✅ Yes   | ❌ No  | ✅ Yes | ❌ No         |

### Performance Metrics

| Metric                 | Prettier      | Biome         | dprint        | Standard JS |
| ---------------------- | ------------- | ------------- | ------------- | ----------- |
| **Speed vs Prettier**  | 1x (baseline) | 7-100x faster | 20-60x faster | ~1x         |
| **Pre-commit Time**    | Seconds       | Milliseconds  | ~100ms        | Seconds     |
| **Dependencies**       | ~20MB npm     | Rust binary   | ~15MB binary  | npm         |
| **Multi-core Scaling** | Limited       | Excellent     | Good          | Limited     |

---

## Migration Considerations

### From Prettier to Biome

**Compatibility:** 97% compatible with Prettier output

**Steps:**

1. Install Biome: `npm install --save-dev @biomejs/biome`
2. Initialize config: `npx @biomejs/biome init`
3. Migrate settings: Use `biome migrate` command
4. Update CI scripts
5. Update pre-commit hooks
6. Remove Prettier and ESLint dependencies

**Benefits:**

- Faster CI runs (80% faster build pipelines reported)
- Simplified configuration (one tool instead of two)
- Better performance on large codebases

**Risks:**

- Newer tool with smaller community
- Some formatting edge cases may differ
- Missing some advanced ESLint rules

### From Prettier to dprint

**Compatibility:** Nearly identical to Prettier

**Steps:**

1. Install dprint binary
2. Create `.dprintrc.json`
3. Update CI and pre-commit scripts
4. Keep ESLint for linting

**Benefits:**

- Much faster formatting
- Zero npm dependencies
- Near-instant pre-commit hooks

**Risks:**

- Still need separate linter
- Smaller ecosystem
- Less editor support

---

## 2025 Trends and Recommendations

### Industry Adoption

**Prettier:** Still the industry standard, used by most projects

**Biome:** Rapidly growing adoption in 2025

- Teams report 80% faster build pipelines
- Becoming the go-to for new TypeScript projects
- Strong momentum in React/Next.js communities

**dprint:** Stable niche for teams wanting speed without changing linters

### For Our Repository

**Current Setup:** ESLint + Prettier (solid, stable)

**Recommendation for 2025:**

#### Option 1: Stay with Prettier + ESLint (Conservative)

✅ **Pros:**

- Proven, stable, well-documented
- Extensive ecosystem
- Team familiarity
- Multi-language support

❌ **Cons:**

- Slower on large codebases
- Two separate tools to configure

**Best if:** Team values stability, has multi-language needs, or doesn't have performance issues

#### Option 2: Migrate to Biome (Progressive)

✅ **Pros:**

- 7-100x performance improvement
- Single tool for linting + formatting
- Active development with 2025 focus
- Type-aware linting
- Plugin support

❌ **Cons:**

- Newer tool (requires team buy-in)
- Some missing typescript-eslint rules
- Migration effort required

**Best if:** Team wants cutting-edge tooling, values performance, primarily uses JS/TS

#### Option 3: Switch to dprint + ESLint (Performance-focused)

✅ **Pros:**

- 20-60x faster formatting
- Zero npm dependencies
- Keep familiar ESLint setup
- Fast pre-commit hooks

❌ **Cons:**

- Still two separate tools
- Smaller ecosystem
- Less editor integration

**Best if:** Team has slow formatting issues but wants to keep ESLint

---

## Conclusion

### Quick Decision Guide

**Choose Prettier if:**

- You want the industry standard with maximum compatibility
- You need extensive multi-language support
- You value ecosystem maturity over performance
- Your team is familiar with Prettier

**Choose Biome if:**

- You want an all-in-one modern toolchain
- Performance is a priority (large codebase)
- You're willing to adopt newer technology
- You want to simplify your toolchain

**Choose dprint if:**

- You want maximum formatting speed
- You prefer specialized tools over all-in-one
- You're happy with your current linter
- You want minimal dependencies

**Choose Standard JS if:**

- You want zero configuration
- You have a small JavaScript-only project
- You're working solo or in a small team

---

## Sources

### Research Sources

1. [Biome: The Faster Lint and Formatting Alternative to Prettier](https://medium.com/navara/biome-the-faster-lint-and-formatting-alternative-to-prettier-12fcf8b122b9)
2. [Differences with Prettier | Biome](https://biomejs.dev/formatter/differences-with-prettier/)
3. [Biome, toolchain of the web](https://biomejs.dev/)
4. [BiomeJS - A 35x faster alternative to Prettier](https://blog.oxyconit.com/biomejs-a-35x-faster-alternative-to-prettier-for-formatting-and-linting/)
5. [Biome.js Replaces ESLint and Prettier: The 2025 Frontend Code Standards Revolution](https://markaicode.com/biome-js-frontend-code-standards-revolution-2025/)
6. [dprint: The Rust-Based Code Formatter That's 10-100x Faster Than Prettier](https://mfyz.com/dprint-rust-based-code-formatter-faster-prettier/)
7. [From ESLint and Prettier to Biome](https://kittygiraudel.com/2024/06/01/from-eslint-and-prettier-to-biome/)
8. [Prettier vs Biome: Choosing the Right Tool for Quality Code](https://www.dhiwise.com/post/prettier-vs-biome-code-quality-comparison)
9. [Transitioning from ESLint and Prettier to Biome: A Comprehensive Guide](https://medium.com/@yanirmanor/transitioning-from-eslint-and-prettier-to-biome-a-comprehensive-guide-fcbccb42dc2c)
10. [Why I Chose Biome Over ESLint+Prettier: 20x Faster Linting](https://dev.to/saswatapal/why-i-chose-biome-over-eslintprettier-20x-faster-linting-one-tool-to-rule-them-all-10kf)
11. [Biome formatter wins the Prettier challenge](https://biomejs.dev/blog/biome-wins-prettier-challenge/)
12. [Announcing Biome](https://biomejs.dev/blog/announcing-biome/)
13. [Biome adoption guide: Overview, examples, and alternatives](https://blog.logrocket.com/biome-adoption-guide/)
14. [Announcing Biome: the community fork of Rome](https://github.com/rome/tools/discussions/4787)
15. [Best Code Formatter for VSCode JavaScript](https://rapidfreeformatter.com/best-code-formatter-for-vscode-javascript-top-tools-for-speed-style-consistency/)
16. [Alternatives to Prettier – Popular Code Linting and Formatting Tools](https://www.freecodecamp.org/news/alternatives-to-prettier/)

---

## Appendix: Sample Configurations

### Prettier Configuration (.prettierrc)

```json
{
  "semi": true,
  "trailingComma": "all",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2
}
```

### Biome Configuration (biome.json)

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "complexity": {
        "noExtraBooleanCast": "error",
        "noMultipleSpacesInRegularExpressionLiterals": "error",
        "noUselessCatch": "error",
        "noUselessTypeConstraint": "error",
        "noWith": "error"
      },
      "correctness": {
        "noConstAssign": "error",
        "noConstantCondition": "error",
        "noEmptyCharacterClassInRegex": "error",
        "noEmptyPattern": "error",
        "noGlobalObjectCalls": "error",
        "noInvalidConstructorSuper": "error",
        "noInvalidNewBuiltin": "error",
        "noNonoctalDecimalEscape": "error",
        "noPrecisionLoss": "error",
        "noSelfAssign": "error",
        "noSetterReturn": "error",
        "noSwitchDeclarations": "error",
        "noUndeclaredVariables": "error",
        "noUnreachable": "error",
        "noUnreachableSuper": "error",
        "noUnsafeFinally": "error",
        "noUnsafeOptionalChaining": "error",
        "noUnusedLabels": "error",
        "noUnusedVariables": "error",
        "useIsNan": "error",
        "useValidForDirection": "error",
        "useYield": "error"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "always",
      "trailingCommas": "all"
    }
  }
}
```

### dprint Configuration (.dprintrc.json)

```json
{
  "typescript": {
    "lineWidth": 100,
    "indentWidth": 2,
    "useTabs": false,
    "semiColons": "always",
    "quoteStyle": "alwaysSingle",
    "trailingCommas": "always"
  },
  "json": {
    "indentWidth": 2
  },
  "markdown": {
    "lineWidth": 100
  },
  "includes": ["**/*.{ts,tsx,js,jsx,json,md}"],
  "excludes": ["**/node_modules", "**/*-lock.json", "**/dist", "**/build"],
  "plugins": [
    "https://plugins.dprint.dev/typescript-0.91.6.wasm",
    "https://plugins.dprint.dev/json-0.19.3.wasm",
    "https://plugins.dprint.dev/markdown-0.17.2.wasm"
  ]
}
```
