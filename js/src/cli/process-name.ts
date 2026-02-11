import { platform } from 'os';
import { dlopen, FFIType, ptr } from 'bun:ffi';

/**
 * Set the process name visible in system monitoring tools (top, ps, htop, etc.).
 *
 * Bun does not implement the process.title setter (unlike Node.js), so we use
 * platform-specific system calls via Bun's FFI:
 * - Linux: prctl(PR_SET_NAME, name) sets /proc/<pid>/comm
 * - macOS: pthread_setname_np(name) sets the thread name shown in Activity Monitor / ps
 * - Windows: no-op (Task Manager shows the executable name)
 */
export function setProcessName(name: string): void {
  // Set in-process values for any JS code that checks them
  process.title = name;
  process.argv0 = name;

  const os = platform();

  if (os === 'linux') {
    try {
      const PR_SET_NAME = 15;
      const libc = dlopen('libc.so.6', {
        prctl: {
          args: [FFIType.i32, FFIType.ptr],
          returns: FFIType.i32,
        },
      });
      // PR_SET_NAME accepts up to 16 bytes including the null terminator
      const buf = Buffer.from(name.slice(0, 15) + '\0');
      libc.symbols.prctl(PR_SET_NAME, ptr(buf));
      libc.close();
    } catch (_e) {
      // Silently ignore - process name is cosmetic
    }
  } else if (os === 'darwin') {
    try {
      const libc = dlopen('libSystem.B.dylib', {
        pthread_setname_np: {
          args: [FFIType.ptr],
          returns: FFIType.i32,
        },
      });
      // macOS pthread_setname_np accepts up to 64 bytes including the null terminator
      const buf = Buffer.from(name.slice(0, 63) + '\0');
      libc.symbols.pthread_setname_np(ptr(buf));
      libc.close();
    } catch (_e) {
      // Silently ignore - process name is cosmetic
    }
  }
}
