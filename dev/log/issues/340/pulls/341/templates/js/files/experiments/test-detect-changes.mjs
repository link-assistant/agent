#!/usr/bin/env node

// Test script for detect-code-changes.mjs logic
// Validates that the change detection correctly classifies files

function isExcludedFromCodeChanges(filePath) {
  if (filePath.endsWith('.md')) {
    return true;
  }
  const excludedFolders = ['.changeset/', 'docs/', 'experiments/', 'examples/'];
  for (const folder of excludedFolders) {
    if (filePath.startsWith(folder)) {
      return true;
    }
  }
  return false;
}

function classifyFiles(changedFiles) {
  const mjsChanged = changedFiles.some((f) => f.endsWith('.mjs'));
  const jsChanged = changedFiles.some((f) => f.endsWith('.js'));
  const packageChanged = changedFiles.some((f) => f === 'package.json');
  const docsChanged = changedFiles.some((f) => f.endsWith('.md'));
  const workflowChanged = changedFiles.some((f) =>
    f.startsWith('.github/workflows/')
  );

  const codeChangedFiles = changedFiles.filter(
    (file) => !isExcludedFromCodeChanges(file)
  );
  const codePattern = /\.(mjs|js|json|yml|yaml)$|\.github\/workflows\//;
  const anyCodeChanged = codeChangedFiles.some((file) =>
    codePattern.test(file)
  );

  return {
    mjsChanged,
    jsChanged,
    packageChanged,
    docsChanged,
    workflowChanged,
    anyCodeChanged,
    codeChangedFiles,
  };
}

let passed = 0;
let failed = 0;

function test(name, files, expected) {
  const result = classifyFiles(files);
  const errors = [];
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (result[key] !== expectedValue) {
      errors.push(`  ${key}: expected ${expectedValue}, got ${result[key]}`);
    }
  }
  if (errors.length > 0) {
    console.log(`FAIL: ${name}`);
    errors.forEach((e) => console.log(e));
    failed++;
  } else {
    console.log(`PASS: ${name}`);
    passed++;
  }
}

test('.gitkeep only change', ['.gitkeep'], {
  anyCodeChanged: false,
  docsChanged: false,
  mjsChanged: false,
  jsChanged: false,
});

test('.gitignore only change', ['.gitignore'], {
  anyCodeChanged: false,
});

test('README.md only change', ['README.md'], {
  anyCodeChanged: false,
  docsChanged: true,
});

test('docs/ folder change', ['docs/case-studies/issue-31/README.md'], {
  anyCodeChanged: false,
  docsChanged: true,
});

test('.mjs file change', ['scripts/detect-code-changes.mjs'], {
  anyCodeChanged: true,
  mjsChanged: true,
  jsChanged: false,
});

test('.js file change', ['src/index.js'], {
  anyCodeChanged: true,
  jsChanged: true,
  mjsChanged: false,
});

test('package.json change', ['package.json'], {
  anyCodeChanged: true,
  packageChanged: true,
});

test('workflow change', ['.github/workflows/release.yml'], {
  anyCodeChanged: true,
  workflowChanged: true,
});

test(
  '.changeset/ folder excluded from code changes',
  ['.changeset/some-change.md'],
  {
    anyCodeChanged: false,
    docsChanged: true,
  }
);

test(
  'experiments/ folder excluded from code changes',
  ['experiments/test.mjs'],
  {
    anyCodeChanged: false,
  }
);

test('examples/ folder excluded from code changes', ['examples/demo.js'], {
  anyCodeChanged: false,
});

test('LICENSE file', ['LICENSE'], {
  anyCodeChanged: false,
  docsChanged: false,
  mjsChanged: false,
  jsChanged: false,
});

test(
  'Mixed: .gitkeep + .mjs triggers code change',
  ['.gitkeep', 'scripts/detect-code-changes.mjs'],
  {
    anyCodeChanged: true,
    mjsChanged: true,
  }
);

test(
  'Mixed: README.md + package.json triggers code change',
  ['README.md', 'package.json'],
  {
    anyCodeChanged: true,
    docsChanged: true,
    packageChanged: true,
  }
);

test('YAML config change', ['eslint.config.js'], {
  anyCodeChanged: true,
  jsChanged: true,
});

test('YAML workflow file', ['.github/workflows/links.yml'], {
  anyCodeChanged: true,
  workflowChanged: true,
});

test('Multiple non-code files', ['.gitkeep', 'LICENSE', '.gitignore'], {
  anyCodeChanged: false,
  docsChanged: false,
  mjsChanged: false,
  jsChanged: false,
});

console.log(
  `\n${passed} passed, ${failed} failed out of ${passed + failed} tests`
);
process.exit(failed > 0 ? 1 : 0);
