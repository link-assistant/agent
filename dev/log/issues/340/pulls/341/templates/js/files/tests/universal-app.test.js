import { describe, it, expect } from 'test-anywhere';
import { existsSync, readFileSync } from 'node:fs';

const exampleRoot = 'examples/universal-app';
const packageJsonPath = `${exampleRoot}/package.json`;
const appSourcePath = `${exampleRoot}/src/App.js`;
const viteConfigPath = `${exampleRoot}/vite.config.js`;
const capacitorConfigPath = `${exampleRoot}/capacitor.config.json`;
const workflowPath = '.github/workflows/example-app.yml';
const docsPath = `${exampleRoot}/README.md`;

function readText(filePath) {
  return readFileSync(filePath, 'utf8').replaceAll('\r\n', '\n');
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

describe('universal React example app', () => {
  it('defines the expected app package and build targets', () => {
    expect(existsSync(packageJsonPath)).toBe(true);

    const packageJson = readJson(packageJsonPath);

    expect(packageJson.private).toBe(true);
    expect(packageJson.type).toBe('module');
    expect(packageJson.main).toBe('electron/main.cjs');
    expect(Boolean(packageJson.dependencies.react)).toBe(true);
    expect(Boolean(packageJson.dependencies['react-dom'])).toBe(true);
    expect(Boolean(packageJson.dependencies['@capacitor/core'])).toBe(true);
    expect(Boolean(packageJson.devDependencies.vite)).toBe(true);
    expect(Boolean(packageJson.devDependencies.electron)).toBe(true);
    expect(Boolean(packageJson.devDependencies['electron-builder'])).toBe(true);
    expect(Boolean(packageJson.devDependencies['@capacitor/cli'])).toBe(true);

    expect(packageJson.scripts.build).toBe('vite build');
    expect(packageJson.scripts['desktop:package']).toContain(
      'electron-builder --dir'
    );
    expect(packageJson.scripts['mobile:sync']).toContain('cap sync');
    expect(packageJson.scripts['mobile:android:build']).toContain(
      'cap build android'
    );
    expect(packageJson.scripts['mobile:ios:run']).toContain('cap run ios');
  });

  it('renders a visual UI using the package add and multiply functions', () => {
    const appSource = readText(appSourcePath);

    expect(appSource).toContain("from '../../../src/index.js'");
    expect(appSource).toContain('add(parsedLeft, parsedRight)');
    expect(appSource).toContain('multiply(parsedLeft, parsedRight)');
    expect(appSource).toContain('Addition');
    expect(appSource).toContain('Multiplication');
  });

  it('shares the Vite build output with Capacitor and GitHub Pages', () => {
    const viteConfig = readText(viteConfigPath);
    const capacitorConfig = readJson(capacitorConfigPath);

    expect(viteConfig).toContain('GITHUB_PAGES');
    expect(viteConfig).toContain('base: resolveBasePath()');
    expect(viteConfig).toContain("outDir: 'dist'");
    expect(capacitorConfig.webDir).toBe('dist');
    expect(capacitorConfig.appId).toBe('foundation.link.template.example');
  });

  it('adds root scripts and a workflow for web, desktop, and mobile checks', () => {
    const rootPackageJson = readJson('package.json');
    const workflow = readText(workflowPath);

    expect(rootPackageJson.scripts['example:web:build']).toBe(
      'npm --prefix examples/universal-app run build'
    );
    expect(rootPackageJson.scripts['example:desktop:package']).toBe(
      'npm --prefix examples/universal-app run desktop:package'
    );
    expect(rootPackageJson.scripts['example:mobile:sync']).toBe(
      'npm --prefix examples/universal-app run mobile:sync'
    );

    expect(workflow).toContain(
      'npm ci --prefix examples/universal-app --no-audit --no-fund'
    );
    expect(workflow).toContain('npm run example:web:build');
    expect(workflow).toContain('npm run example:desktop:package');
    expect(workflow).toContain('actions/configure-pages@v6');
    expect(workflow).toContain('./.github/actions/artifact-transport');
    expect(workflow).toContain('scripts/deploy-pages.mjs');
    expect(workflow).toContain('EXAMPLE_APP_ENABLE_ANDROID_BUILD');
    expect(workflow).toContain('EXAMPLE_APP_ENABLE_IOS_BUILD');
  });

  it('documents local validation without store credentials', () => {
    const docs = readText(docsPath);

    expect(docs).toContain('npm install --prefix examples/universal-app');
    expect(docs).toContain('npm run example:web:build');
    expect(docs).toContain('npm run example:desktop:package');
    expect(docs).toContain('npm run example:mobile:sync');
    expect(docs).toContain('Apple Developer Program');
    expect(docs).toContain('Google Play Console');
  });

  it('regenerates preview screenshots with browser-commander on every push to main', () => {
    const rootPackageJson = readJson('package.json');
    const workflow = readText(workflowPath);
    const script = readText('scripts/update-preview-images.mjs');
    const rootReadme = readText('README.md');

    expect(rootPackageJson.scripts['example:web:preview-images']).toBe(
      'node scripts/update-preview-images.mjs'
    );
    expect(existsSync('scripts/update-preview-images.mjs')).toBe(true);

    expect(workflow).toContain('preview-regen:');
    // Pinned by digest; the tag lives in the trailing comment.
    expect(workflow).toMatch(
      /image: mcr\.microsoft\.com\/playwright@sha256:[0-9a-f]{64} # v1\.59\.1-noble/
    );
    expect(workflow).toContain('browser-commander');
    expect(workflow).not.toContain('npx playwright install');
    expect(workflow).toContain('node scripts/update-preview-images.mjs');
    expect(workflow).toContain(
      'git commit -m "chore(preview): regenerate example-app preview images"'
    );
    expect(workflow).not.toContain(
      'git commit -m "chore(preview): regenerate example-app preview images [skip ci]"'
    );

    expect(script).toContain("from 'browser-commander'");
    expect(script).toContain("from 'playwright'");
    expect(script).toContain('docs/screenshots/example-app');

    expect(rootReadme).toContain('Auto-regenerated preview screenshots');
    expect(rootReadme).toContain('npm run example:web:preview-images');
  });
});
