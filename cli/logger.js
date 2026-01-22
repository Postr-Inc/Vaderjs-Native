export const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
};
export async function timedStep(name, fn) {
  logger.step(`${name}...`);
  const start = performance.now();
  try {
    await fn();
    const duration = (performance.now() - start).toFixed(2);
    logger.success(`Finished '${name}' in ${duration}ms`);
  } catch (e) {
    logger.error(`Error during '${name}':`, e);
    if (!isDev) process.exit(1);
  }
}
export const logger = {
  _log: (level, color, symbol, ...args) => {
    const timestamp = new Date().toISOString();
    console.log(
      `${colors.gray}[${timestamp}]${colors.reset} ${color}${symbol}${colors.reset} ${colors.bold}${level}:${colors.reset}`,
      ...args
    );
  },
  info: (...args) => logger._log("INFO", colors.cyan, "ℹ", ...args),
  success: (...args) => logger._log("SUCCESS", colors.green, "✅", ...args),
  warn: (...args) => logger._log("WARN", colors.yellow, "⚠️", ...args),
  error: (...args) => logger._log("ERROR", colors.red, "❌", ...args),
  step: (...args) => {
    const separator = colors.magenta + "═".repeat(50) + colors.reset;
    console.log(`\n${separator}`);
    console.log(`${colors.magenta}🚀 STEP:${colors.reset} ${colors.bold}`, ...args);
    console.log(separator);
  },
  debug: (...args) => logger._log("DEBUG", colors.blue, "🐛", ...args),
  plugin: (...args) => logger._log("PLUGIN", colors.magenta, "🧩", ...args),
  table: (title, data) => {
    console.log(`${colors.cyan}${title}${colors.reset}`);
    console.table(data);
  },
};
