import type { Clock } from "../domain/ports.ts";

export class SystemClock implements Clock {
    today(): string {
        return new Date().toISOString().slice(0, 10);
    }
}

/** For tests and for the verifier, where a moving date would make results unreproducible. */
export class FixedClock implements Clock {
    private readonly date: string;

    constructor(date: string) {
        this.date = date;
    }

    today(): string {
        return this.date;
    }
}
