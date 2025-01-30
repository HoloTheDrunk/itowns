type AccessMode = 'get' | 'set';
type Timestamp = number;

type TrackingData = {
    mode: AccessMode,
    exists: boolean,
    time: Timestamp,
    path?: string,
    source?: string,
};

class AccessTrackerEntry {
    public accesses: TrackingData[];

    public constructor() {
        this.accesses = [];
    }

    public get(exists: boolean, path?: string): void {
        this.accesses.push({
            mode: 'get',
            path,
            exists,
            time: Date.now(),
            source: new Error().stack?.split('\n')[4],
        });
    }

    public set(exists: boolean, path?: string): void {
        this.accesses.push({
            mode: 'set',
            path,
            exists,
            time: Date.now(),
            source: new Error().stack?.split('\n')[4],
        });
    }

    public get count(): number {
        return this.accesses.length;
    }

    public existCounts(): [number, number] {
        const counts: [number, number] = [0, 0];
        for (const access of this.accesses) {
            counts[+!access.exists]++;
        }
        return counts;
    }
}

class AccessTracker {
    private accessed: Map<Record<string, unknown>, Map<string, AccessTrackerEntry>>;
    private summary: Map<string, AccessTrackerEntry>;

    public constructor(timeout = 2000) {
        this.accessed = new Map();
        this.summary = new Map();

        // eslint-disable-next-line no-console
        console.debug('AccessTracker initialized');

        if (timeout > 0) {
            setTimeout(() => {
                // eslint-disable-next-line no-console
                console.debug(this);
                this.logSummary();
            }, timeout);
        }
    }

    public logSummary(): void {
        const arr = Array.from(this.summary.entries().map(([prop, entry]) => {
            const [ok, missing] = entry.existCounts();

            const uniqueSources = new Set<string>();
            for (const { exists, source } of entry.accesses) {
                if (source !== undefined) {
                    uniqueSources.add(`${exists ? 'ok' : 'undefined'} | ${source}`);
                }
            }

            return { property: prop, ok, undefined: missing, uniqueSources };
        }));

        // eslint-disable-next-line no-console
        console.table(arr);
    }

    public insert(mode: AccessMode, target: Record<string, unknown>, prop: string) {
        const exists = target[prop] !== undefined;

        if (!this.accessed.has(target)) {
            this.accessed.set(target, new Map());
        }

        AccessTracker.register(mode, this.accessed.get(target)!, exists, prop);
        AccessTracker.register(mode, this.summary, exists, prop);
    }

    static register(
        mode: AccessMode,
        map: Map<string, AccessTrackerEntry>,
        exists: boolean,
        prop: string,
    ): void {
        const optEntry = map.get(prop);
        const entry = optEntry ?? new AccessTrackerEntry();
        entry[mode](exists);
        if (optEntry === undefined) {
            map.set(prop, entry);
        }
    }
}

/**
 * Debugging helper class logging all accesses to an object's properties.
 *
 * # Usage
 * ```ts
 * // accessTracker will log a summary to the console after 3000 milliseconds.
 * const accessTracker = new AccessTrackerProxy<{ a: number, b: number }>(3000);
 * const myObj = accessTracker.init({ a: 2, b: 1 });
 * myObj.b = myObj.a * myObj.b + myObj.a;
 * console.log(myObj.b);
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
            get(target: T, prop: string, receiver?: unknown): T[string] {
                tracker.insert('get', target, prop);
                if (typeof target[prop] === 'object' && target[prop] !== null) {
                    return new Proxy(
                        Reflect.get(target as object, prop, receiver),
                        { get: this.get },
                    );
                } else {
                    return Reflect.get(target as object, prop, receiver);
                }
            },
            set(target: T, prop: string, newValue: unknown, receiver?: unknown): boolean {
                tracker.insert('set', target, prop);
                Reflect.set(target as object, prop, newValue, receiver);
                return true;
            },
        }) as T;
    }
}
