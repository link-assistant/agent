---
'@link-assistant/agent': minor
---

Add Qwen Coder OAuth subscription support

- Add QwenPlugin and AlibabaPlugin to auth plugins with OAuth device flow
- Support Qwen Coder subscription via OAuth (device flow) with free tier
- Add token refresh support for automatic credential renewal
- Add custom provider loaders for qwen-coder and alibaba in provider.ts
- Both "Qwen Coder" and "Alibaba" menu items available in auth login
