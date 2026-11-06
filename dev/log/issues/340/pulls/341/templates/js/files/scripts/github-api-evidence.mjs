/** Successful CLI exit alone does not establish a usable GitHub response. */
export function validateReleaseData(data, { id, tag } = {}) {
  if (
    !data ||
    !Number.isSafeInteger(data.id) ||
    data.id <= 0 ||
    (id !== undefined && String(data.id) !== String(id)) ||
    (tag !== undefined && data.tag_name !== tag) ||
    !(typeof data.body === 'string' || data.body === null)
  ) {
    throw new Error('Malformed GitHub release response');
  }
  return data;
}

export function validatePullRequestPages(pages) {
  if (
    !Array.isArray(pages) ||
    pages.length === 0 ||
    pages.some(
      (page) =>
        !Array.isArray(page) ||
        page.some(
          (pr) =>
            !pr ||
            !Number.isSafeInteger(pr.number) ||
            pr.number <= 0 ||
            typeof pr.title !== 'string'
        )
    )
  ) {
    throw new Error('Malformed GitHub commit-to-PR pages');
  }
  return pages.flat();
}
