// Permalink: https://github.com/sst/opencode/blob/main/packages/opencode/src/cli/bootstrap.ts
// Permalink: https://github.com/sst/opencode/blob/main/packages/opencode/src/project/instance.ts
// Permalink: https://github.com/sst/opencode/blob/main/packages/opencode/src/project/bootstrap.ts

// createOpencode is available from @opencode-ai/sdk but not used directly

class Instance {
  static directory = process.cwd();
  static worktree = process.cwd();

  static provide(options) {
    this.directory = options.directory;
    this.worktree = options.directory;
    return options.fn();
  }

  static dispose() {
    // Cleanup
  }
}

class InstanceBootstrap {
  static async init() {
    // Minimal bootstrap
  }
}

export function bootstrap(directory, cb) {
  return Instance.provide({
    directory,
    init: InstanceBootstrap,
    fn: async () => {
      try {
        const result = await cb();
        return result;
      } finally {
        await Instance.dispose();
      }
    },
  });
}
