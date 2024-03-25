enum ELogLevel {
    WARN = 0,
    INFO,
    DEBUG,
    DIAGNOSTIC,
}

type LevelStyle = {
    readonly method: 'error' | 'warn' | 'log' | 'debug';
    readonly colors: {
        readonly header: string;
        readonly message: string;
    };
};

class Logger {
    // eslint-disable-next-line no-useless-constructor
    public constructor(
        private readonly prefix: string,
        private readonly logStyle: Record<ELogLevel, LevelStyle>
    ) { }

    public verbosity = ELogLevel.INFO;

    public readonly warn = this.log.bind(this, ELogLevel.WARN);
    public readonly info = this.log.bind(this, ELogLevel.INFO);
    public readonly debug = this.log.bind(this, ELogLevel.DEBUG);
    public readonly diagnostic = this.log.bind(this, ELogLevel.DIAGNOSTIC);

    private log(level: ELogLevel, message: string): void {
        if (this.verbosity >= level) {
            const logStyle = this.logStyle[level];

            console[logStyle.method](
                `%c${this.prefix}%c ${message}`,
                `background: ${logStyle.colors.header}; color: white; padding: 2px 4px; border-radius: 2px`,
                `font-weight: 800; color: ${logStyle.colors.message}`
            );
        }
    }
}

const logger = new Logger('aresrpg-engine', [
    { method: 'warn', colors: { header: '#7B9E7B', message: '#FF6A00' } },
    { method: 'log', colors: { header: '#7B9E7B', message: '#0094FF' } },
    { method: 'debug', colors: { header: '#7B9E7B', message: '#808080' } },
    { method: 'debug', colors: { header: '#7B9E7B', message: '#A56148' } },
]);
function setVerbosity(verbosity: ELogLevel): void {
    logger.verbosity = verbosity;
}

export { ELogLevel, logger, setVerbosity };
