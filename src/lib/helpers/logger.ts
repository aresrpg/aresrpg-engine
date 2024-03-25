enum EVerbosity {
    WARN = 0,
    INFO,
    DEBUG,
    DIAGNOSTIC,
}

class Logger {
    private static readonly prefix = 'aresrpg-engine: ';
    public verbosity = EVerbosity.INFO;

    public warn(message: string): void {
        if (this.verbosity >= EVerbosity.WARN) {
            console.warn(Logger.prefix + message);
        }
    }

    public info(message: string): void {
        if (this.verbosity >= EVerbosity.INFO) {
            console.info(Logger.prefix + message);
        }
    }

    public debug(message: string): void {
        if (this.verbosity >= EVerbosity.DEBUG) {
            console.debug(Logger.prefix + message);
        }
    }

    public diagnostic(message: string): void {
        if (this.verbosity >= EVerbosity.DIAGNOSTIC) {
            console.debug(Logger.prefix + message);
        }
    }
}

const logger = new Logger();
function setVerbosity(verbosity: EVerbosity): void {
    logger.verbosity = verbosity;
}

export { EVerbosity, logger, setVerbosity };
