const DEFAULT_LANGUAGES = ['en', 'ru', 'zh', 'hi'];

const LANGUAGE_PATTERNS = {
  en: [
    /\b(?:previously|formerly|used to|no longer|once|originally)\b[\s\S]{0,40}?\b(?:was|were|is|are|did|do|does|had|has|have|used|use|uses|call(?:s|ed)?|name[ds]?|return(?:s|ed)?|live[ds]?|work(?:s|ed)?)\b/iu,
    /\b(?:after the fix|as before|back-compat(?:ible|ibility)?|backwards compat(?:ible|ibility)?)\b/iu,
    /\b(?:instead of|rather than)\b/iu,
    /\b(?:changed|renamed|moved|moved out|switched|migrated|replaced)\b[\s\S]{0,30}?\b(?:from|to|out)\b/iu,
    /\bnow\b[\s\S]{0,30}?\b(?:uses?|does|is|are|returns?|lives?|points?|goes?)\b[\s\S]{0,30}?\b(?:instead|no longer|rather)\b/iu,
  ],
  ru: [
    /(?:раньше|ранее|прежде|прежн[\p{L}\p{M}\p{N}_]+|до этого|до фикса)[\s\S]{0,40}?(?:был[\p{L}\p{M}\p{N}_]*|делал[\p{L}\p{M}\p{N}_]*|использовал[\p{L}\p{M}\p{N}_]*|называл[\p{L}\p{M}\p{N}_]*|возвращал[\p{L}\p{M}\p{N}_]*|жил[\p{L}\p{M}\p{N}_]*)/iu,
    /(?:теперь|больше не|сменил[\p{L}\p{M}\p{N}_]*|перешл[\p{L}\p{M}\p{N}_]*|вынес[\p{L}\p{M}\p{N}_]*|перенес[\p{L}\p{M}\p{N}_]*|переименова[\p{L}\p{M}\p{N}_]*)/iu,
  ],
  zh: [
    /(?:以前|之前|原来|曾经)[\s\S]{0,20}?(?:是|用|叫|返回|改)/u,
    /(?:现在改为|改成了?|不再|已移除|已重命名)/u,
  ],
  hi: [/(?:पहले|पहले था|अब नहीं|बदल दिया|हटा दिया|नाम बदला)/u],
};

const SHARED_PATTERNS = [
  { expression: /\b(?:PR|issue|pull request)\s*#\d+/iu },
  { expression: /\b\d{4}-\d{2}-\d{2}\b/u, kind: 'date' },
];

function normalizeOptions(options = {}) {
  return {
    languages: options.languages ?? DEFAULT_LANGUAGES,
    checkStrings: options.checkStrings ?? true,
    allow: options.allow ?? [],
    allowDatesInStrings: options.allowDatesInStrings ?? false,
  };
}

function removeAllowedText(text, allow) {
  return allow.reduce(
    (currentText, allowedText) => currentText.replaceAll(allowedText, ''),
    text
  );
}

function getLanguagePatterns(languages) {
  return languages.flatMap((language) => LANGUAGE_PATTERNS[language] ?? []);
}

function findHistoryPattern(text, kind, options, languagePatterns) {
  const checkedText = removeAllowedText(text, options.allow);

  if (languagePatterns.some((pattern) => pattern.test(checkedText))) {
    return true;
  }

  return SHARED_PATTERNS.some((pattern) => {
    if (
      pattern.kind === 'date' &&
      kind === 'string' &&
      options.allowDatesInStrings
    ) {
      return false;
    }

    return pattern.expression.test(checkedText);
  });
}

const noChangelogCommentsRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Detect comments and strings that describe source change history',
    },
    schema: [
      {
        type: 'object',
        properties: {
          languages: {
            type: 'array',
            items: {
              enum: DEFAULT_LANGUAGES,
            },
            uniqueItems: true,
          },
          checkStrings: {
            type: 'boolean',
          },
          allow: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
          allowDatesInStrings: {
            type: 'boolean',
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      sourceHistory:
        'Describe current behavior; keep source history in git, PRs, or docs.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const options = normalizeOptions(context.options[0]);
    const languagePatterns = getLanguagePatterns(options.languages);

    function reportText(text, descriptor, kind) {
      if (!text || (kind === 'string' && !options.checkStrings)) {
        return;
      }

      if (findHistoryPattern(text, kind, options, languagePatterns)) {
        context.report({
          ...descriptor,
          messageId: 'sourceHistory',
        });
      }
    }

    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          reportText(comment.value, { loc: comment.loc }, 'comment');
        }
      },
      Literal(node) {
        if (typeof node.value === 'string') {
          reportText(node.value, { node }, 'string');
        }
      },
      TemplateElement(node) {
        reportText(node.value.cooked ?? node.value.raw, { node }, 'string');
      },
    };
  },
};

export default noChangelogCommentsRule;
