---
'@link-assistant/agent': patch
---

fix: Google OAuth 403 restricted_client error from unregistered scopes

When using `agent auth login` with Google OAuth, users encountered a `403: restricted_client`
error with the message "Unregistered scope(s) in the request".

Root cause: The `generative-language.tuning` and `generative-language.retriever` OAuth scopes
were not registered for the Gemini CLI OAuth client (681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j).

This fix removes the unregistered scopes and aligns with the official Gemini CLI implementation,
which only uses:

- `https://www.googleapis.com/auth/cloud-platform`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/userinfo.profile`

This fix resolves issue #93 ("agent auth login через Google не работает").
