export class Logger {
  constructor(private tag: string) {}

  info(message: string, ...details: unknown[]) {
    if (details.length > 0) {
      console.log(`[${this.tag}] ${message}`, ...details);
    } else {
      console.log(`[${this.tag}] ${message}`);
    }
  }

  warn(message: string, ...details: unknown[]) {
    if (details.length > 0) {
      console.warn(`[${this.tag}] ${message}`, ...details);
    } else {
      console.warn(`[${this.tag}] ${message}`);
    }
  }

  error(message: string, ...details: unknown[]) {
    if (details.length > 0) {
      console.error(`[${this.tag}] ${message}`, ...details);
    } else {
      console.error(`[${this.tag}] ${message}`);
    }
  }

  debug(message: string, ...details: unknown[]) {
    if (details.length > 0) {
      console.debug(`[${this.tag}] ${message}`, ...details);
    } else {
      console.debug(`[${this.tag}] ${message}`);
    }
  }
}

export function createLogger(tag: string): Logger {
  return new Logger(tag);
}
