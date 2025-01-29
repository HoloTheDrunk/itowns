class AccessTracker {
    private accessed: Map<Record<string, unknown>, Map<string, [boolean, number]>>;
    private summary: Map<string, [boolean, number]>;

    constructor(timeout = 2000) {
        this.accessed = new Map();
        this.summary = new Map();

        setTimeout(() => {
            // eslint-disable-next-line no-console
            console.debug(this);
            this.logSummary();
        }, timeout);
    }

    private logSummary(): void {
        const counts: Map<string, [number, number]> = new Map();
        let largestPropLen = 0;

        for (const [obj, map] of this.accessed.entries()) {
            for (const [prop] of map.entries()) {
                const count = counts.get(prop) ?? [0, 0];
                const exists = obj[prop] !== undefined;
                count[0] += +exists;
                count[1] += +!exists;
                counts.set(prop, count);
                if (prop.length > largestPropLen) {
                    largestPropLen = prop.length;
                }
            }
        }

        const countArr = Array.from(counts.values());
        const floorMaxLog10 = (count: number, max: number): number =>
            Math.floor(Math.max(Math.log10(count), max));
        const largestCounts = [
            countArr.reduce((max, count) => floorMaxLog10(count[0], max), 0) + 1,
            countArr.reduce((max, count) => floorMaxLog10(count[1], max), 0) + 1,
        ];

        const lines = [
            '%cAccessTracker summary',
            `%c${' '.repeat(largestPropLen + largestCounts[0] - 1)}OK`
            + '%c UNDEFINED',
        ];
        const css = ['font-weight:bold; font-size:2em', 'color:green;', 'color:red;'];
        for (const [prop, count] of counts.entries()) {
            lines.push(
                `%c${prop.padEnd(largestPropLen, ' ')}`
                + ` %c${count[0].toString().padStart(largestCounts[0], ' ')}`
                + ` %c${count[1].toString().padEnd(largestCounts[1], ' ')}`,
            );
            css.push('color:white;', 'color:green;', 'color:red;');
        }
        // eslint-disable-next-line no-console
        console.debug(lines.join('\n'), ...css);
    }

    public insert(target: Record<string, unknown>, prop: string) {
        const exists = target[prop] !== undefined;

        if (!this.accessed.has(target)) {
            this.accessed.set(target, new Map());
        }
        const map = this.accessed.get(target)!;

        const entry = map.get(prop);
        const [missing, count] = entry ?? [!exists, 0];
        map.set(prop, [missing || !exists, count + 1]);

        const sEntry = this.summary.get(prop);
        const [sMissing, sCount] = sEntry ?? [!exists, 0];
        this.summary.set(prop, [sMissing || !exists, sCount + 1]);

        if (sCount == 0 || sMissing == exists) {
            const [log, tag, color] = sMissing
                // eslint-disable-next-line no-console
                ? [console.trace, '%cUNDEFINED', 'color:red']
                // eslint-disable-next-line no-console
                : [console.debug, '%cOK', 'color:green'];
            log(tag, color, prop);
        }
    }
}

/**
 * Debugging helper class logging all accessses to an object's properties.
 *
 * # Usage
 * ```ts
 * // accessTracker will log a summary to the console after 3000 milliseconds.
 * const accessTracker = new AccessTrackerProxy<{ a: number, b: number }>(3000);
 * const myObj = accessTracker.init({ a: 2, b: 1 });
 * console.log(myObj.a * myObj.b + myObj.a;)
 * ```
 */
export class AccessTrackerProxy<T extends Record<string, unknown>> {
    private _tracker: AccessTracker;

    public constructor(timeout: number = 2000) {
        this._tracker = new AccessTracker(timeout);
    }

    public init(obj: T): T {
        const tracker = this._tracker;
        return new Proxy(obj, {
            get(target: T, prop: string, receiver?: unknown): void {
                tracker.insert(target, prop);
                if (typeof target[prop] === 'object' && target[prop] !== null) {
                    return new Proxy(
                        Reflect.get(target as object, prop, receiver),
                        { get: this.get },
                    );
                } else {
                    return Reflect.get(target as object, prop, receiver);
                }
            },
        }) as T;
    }
}
