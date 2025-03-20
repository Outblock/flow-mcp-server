/**
 * Logger utility that respects stdio mode
 * In stdio mode, console output is suppressed to prevent JSON parsing issues
 */

// Check if running in stdio mode
const isStdioMode = process.argv.includes('--stdio');

/**
 * Log information in non-stdio mode only
 * @param {...any} args - Arguments to log
 */
export function log(...args) {
  if (!isStdioMode) {
    console.log(...args);
  }
}

/**
 * Log errors in non-stdio mode only
 * @param {...any} args - Arguments to log
 */
export function error(...args) {
  if (!isStdioMode) {
    console.error(...args);
  }
} 