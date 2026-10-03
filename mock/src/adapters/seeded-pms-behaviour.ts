import type { PmsBehaviour } from "../domain/ports.ts";
import { generatorFor } from "../domain/random.ts";

/**
 * Random, with one generator per candidate. Failures come in streaks like a real saturated system,
 * and with a fixed seed a candidate's whole sequence can be replayed to check a complaint.
 */
export class SeededPmsBehaviour implements PmsBehaviour {
    private readonly generators = new Map<string, () => number>();
    private readonly minDelayMs: number;
    private readonly maxDelayMs: number;
    private readonly errorRate: number;
    private readonly seed: string;
    private readonly failFirstN: number;
    private readonly attempts = new Map<string, number>();

    constructor(minDelayMs: number, maxDelayMs: number, errorRate: number, seed: string | null, failFirstN = 0) {
        this.failFirstN = failFirstN;
        this.minDelayMs = minDelayMs;
        this.maxDelayMs = Math.max(minDelayMs, maxDelayMs);
        this.errorRate = errorRate;
        this.seed = seed ?? String(Math.random());
    }

    delayMs(candidateId: string): number {
        return Math.round(this.minDelayMs + this.next(candidateId) * (this.maxDelayMs - this.minDelayMs));
    }

    shouldFail(candidateId: string): boolean {
        const seen = (this.attempts.get(candidateId) ?? 0) + 1;
        this.attempts.set(candidateId, seen);
        const roll = this.next(candidateId);
        return seen <= this.failFirstN || roll < this.errorRate;
    }

    private next(candidateId: string): number {
        let generator = this.generators.get(candidateId);
        if (!generator) {
            generator = generatorFor(`${this.seed}:${candidateId}`);
            this.generators.set(candidateId, generator);
        }
        return generator();
    }
}
