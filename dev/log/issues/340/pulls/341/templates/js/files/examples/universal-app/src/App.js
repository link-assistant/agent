import { createElement as h, useMemo, useState } from 'react';
import { add, multiply } from '../../../src/index.js';

const repositoryUrl =
  import.meta.env.VITE_REPOSITORY_URL ??
  'https://github.com/link-foundation/js-ai-driven-development-pipeline-template';

const desktopTargets = [
  {
    label: 'Windows',
    detail: 'Installer or portable package from the latest desktop build.',
  },
  {
    label: 'macOS',
    detail: 'Signed archive when Apple credentials are configured.',
  },
  {
    label: 'Linux',
    detail: 'Zip, deb, or rpm output from Electron Forge.',
  },
];

function parseInput(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function NumberField({ id, label, value, onChange }) {
  return h(
    'label',
    { className: 'number-field', htmlFor: id },
    h('span', null, label),
    h('input', {
      id,
      inputMode: 'decimal',
      type: 'number',
      value,
      onChange: (event) => onChange(event.target.value),
    })
  );
}

function ResultTile({ label, value, tone }) {
  return h(
    'div',
    { className: `result-tile result-tile-${tone}` },
    h('span', { className: 'result-label' }, label),
    h('strong', null, String(value))
  );
}

function DownloadTarget({ label, detail }) {
  return h('li', null, h('span', null, label), h('small', null, detail));
}

export function App() {
  const [left, setLeft] = useState('2');
  const [right, setRight] = useState('3');
  const parsedLeft = parseInput(left);
  const parsedRight = parseInput(right);
  const addition = useMemo(
    () => add(parsedLeft, parsedRight),
    [parsedLeft, parsedRight]
  );
  const multiplication = useMemo(
    () => multiply(parsedLeft, parsedRight),
    [parsedLeft, parsedRight]
  );

  return h(
    'main',
    { className: 'app-shell' },
    h(
      'section',
      { className: 'workspace', 'aria-labelledby': 'calculator-title' },
      h(
        'div',
        { className: 'calculator-panel' },
        h('p', { className: 'eyebrow' }, 'Package function UI'),
        h('h1', { id: 'calculator-title' }, 'Universal Example App'),
        h(
          'div',
          { className: 'input-grid' },
          h(NumberField, {
            id: 'left-number',
            label: 'First value',
            value: left,
            onChange: setLeft,
          }),
          h(NumberField, {
            id: 'right-number',
            label: 'Second value',
            value: right,
            onChange: setRight,
          })
        ),
        h(
          'div',
          { className: 'results-grid', 'aria-live': 'polite' },
          h(ResultTile, {
            label: 'Addition',
            value: addition,
            tone: 'green',
          }),
          h(ResultTile, {
            label: 'Multiplication',
            value: multiplication,
            tone: 'blue',
          })
        )
      ),
      h(
        'aside',
        { className: 'distribution-panel', 'aria-labelledby': 'desktop-title' },
        h('h2', { id: 'desktop-title' }, 'Desktop builds'),
        h(
          'p',
          null,
          'The same React bundle is used by GitHub Pages, Electron, Android, and iOS.'
        ),
        h(
          'ul',
          { className: 'target-list' },
          desktopTargets.map((target) =>
            h(DownloadTarget, { key: target.label, ...target })
          )
        ),
        h(
          'a',
          {
            className: 'download-link',
            href: `${repositoryUrl}/releases/latest`,
            target: '_blank',
            rel: 'noreferrer',
          },
          'Open desktop downloads'
        )
      )
    )
  );
}
