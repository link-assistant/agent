import z from 'zod';
import { Tool } from './tool';
import TurndownService from 'turndown';
import DESCRIPTION from './webfetch.txt';
import { createVerboseFetch } from '../util/verbose-fetch';
import { Permission } from '../permission';
import { Branding } from '../branding';
import { readBounded } from '../util/read-bounded';

const verboseFetch = createVerboseFetch(fetch, { caller: 'webfetch' });

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_TIMEOUT = 30 * 1000; // 30 seconds
const MAX_TIMEOUT = 120 * 1000; // 2 minutes

export const WebFetchTool = Tool.define('webfetch', {
  description: DESCRIPTION,
  parameters: z.object({
    url: z.string().describe('The URL to fetch content from'),
    // Optional, not `.default()`: the JSON schema sent to the model would
    // still list a defaulted field as required, and execute receives the raw
    // arguments (upstream fd973d242e #6345, 2d2f587bfa #30215).
    format: z
      .enum(['text', 'markdown', 'html'])
      .optional()
      .describe(
        'The format to return the content in (text, markdown, or html). Defaults to markdown.'
      ),
    timeout: z
      .number()
      .describe('Optional timeout in seconds (max 120)')
      .optional(),
  }),
  async execute(params, ctx) {
    const format = params.format ?? 'markdown';
    // Validate URL
    if (
      !params.url.startsWith('http://') &&
      !params.url.startsWith('https://')
    ) {
      throw new Error('URL must start with http:// or https://');
    }

    // Permission enforcement (issue #271). `auto` allows; plan/readonly allow
    // (webfetch is read-only); `ask` emits a JSON permission request.
    await Permission.check({
      type: 'webfetch',
      title: params.url,
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      callID: ctx.callID,
      metadata: { url: params.url },
    });

    const timeout = Math.min(
      (params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000,
      MAX_TIMEOUT
    );

    // AbortSignal.timeout keeps no timer alive after a failed fetch, and it
    // also aborts a body that trickles in after the headers (upstream
    // bc1840b196 #21378, 69f1ec22e3 #33259).
    const timeoutSignal = AbortSignal.timeout(timeout);
    const signal = AbortSignal.any([timeoutSignal, ctx.abort]);

    // Build Accept header based on requested format with q parameters for fallbacks
    let acceptHeader = '*/*';
    switch (format) {
      case 'markdown':
        acceptHeader =
          'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1';
        break;
      case 'text':
        acceptHeader =
          'text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1';
        break;
      case 'html':
        acceptHeader =
          'text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1';
        break;
      default:
        acceptHeader =
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8';
    }

    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      Accept: acceptHeader,
      'Accept-Language': 'en-US,en;q=0.9',
    };

    let body: Buffer;
    let response: Response;
    try {
      const initial = await verboseFetch(params.url, { signal, headers });
      // Cloudflare challenges a Chrome UA whose TLS fingerprint is not
      // Chrome's, and lets an honest UA through (upstream b978ca11da #10328).
      if (
        initial.status === 403 &&
        initial.headers.get('cf-mitigated') === 'challenge'
      ) {
        await initial.body?.cancel().catch(() => {});
        response = await verboseFetch(params.url, {
          signal,
          headers: { ...headers, 'User-Agent': Branding.BINARY },
        });
      } else {
        response = initial;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`Request failed with status code: ${response.status}`);
      }

      body = await readBounded(
        response,
        MAX_RESPONSE_SIZE,
        () => new Error('Response too large (exceeds 5MB limit)')
      );
    } catch (error) {
      if (timeoutSignal.aborted && !ctx.abort.aborted) {
        throw new Error(`Request timed out after ${timeout / 1000} seconds`);
      }
      throw error;
    }

    const content = new TextDecoder().decode(body);
    const contentType = response.headers.get('content-type') || '';

    const title = `${params.url} (${contentType})`;

    // Handle content based on requested format and actual content type
    switch (format) {
      case 'markdown':
        if (contentType.includes('text/html')) {
          const markdown = convertHTMLToMarkdown(content);
          return {
            output: markdown,
            title,
            metadata: {},
          };
        }
        return {
          output: content,
          title,
          metadata: {},
        };

      case 'text':
        if (contentType.includes('text/html')) {
          const text = await extractTextFromHTML(content);
          return {
            output: text,
            title,
            metadata: {},
          };
        }
        return {
          output: content,
          title,
          metadata: {},
        };

      case 'html':
        return {
          output: content,
          title,
          metadata: {},
        };

      default:
        return {
          output: content,
          title,
          metadata: {},
        };
    }
  },
});

async function extractTextFromHTML(html: string) {
  let text = '';
  // Count open skipped elements so text after `</script>` and text outside
  // any element is kept (upstream ad6a8a1850, #26309).
  let skipDepth = 0;

  const rewriter = new HTMLRewriter()
    .on('script, style, noscript, iframe, object, embed', {
      element(element) {
        if (!element.canHaveContent) return;
        skipDepth++;
        element.onEndTag(() => {
          skipDepth--;
        });
      },
    })
    .onDocument({
      text(input) {
        if (skipDepth === 0) text += input.text;
      },
    })
    .transform(new Response(html));

  await rewriter.text();
  return text.trim();
}

function convertHTMLToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  });
  turndownService.remove(['script', 'style', 'meta', 'link']);
  return turndownService.turndown(html);
}
