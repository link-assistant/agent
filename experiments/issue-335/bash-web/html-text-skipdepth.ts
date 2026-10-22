// Candidate HTMLRewriter-based fix for webfetch extractTextFromHTML (logic of
// upstream ad6a8a1850 skipDepth). bun experiments/issue-335/bash-web/html-text-skipdepth.ts
const SKIP = 'script, style, noscript, iframe, object, embed';
async function extract(html: string) {
  let text = '';
  let skipDepth = 0;
  await new HTMLRewriter()
    .on(SKIP, {
      element(el) {
        if (!el.canHaveContent) return; // void <embed> has no end tag
        skipDepth++;
        el.onEndTag(() => { skipDepth--; });
      },
    })
    .onDocument({ text(t) { if (skipDepth === 0) text += t.text; } })
    .transform(new Response(html))
    .text();
  return text.trim();
}
for (const h of [
  '<p>Hello <script>x()</script> world</p><p>tail</p>',
  '<div>a<noscript><p>hidden</p></noscript>b</div>',
  '<p>pre<embed src=x>post</p>',
  '<style>.a{}</style>visible',
]) console.log(JSON.stringify(h), '->', JSON.stringify(await extract(h)));
