import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Journal, JournalEntry } from "../domain/ports.ts";

/**
 * One JSON object per line, appended synchronously. A crash can only leave the last line half
 * written, and replay skips a line it cannot read instead of refusing to start.
 */
export class FileJournal implements Journal {
    private readonly path: string;

    constructor(path: string) {
        this.path = path;
        mkdirSync(dirname(path), { recursive: true });
    }

    append(entry: JournalEntry): void {
        appendFileSync(this.path, JSON.stringify(entry) + "\n", "utf8");
    }

    replay(): readonly JournalEntry[] {
        if (!existsSync(this.path)) return [];
        const entries: JournalEntry[] = [];
        for (const line of readFileSync(this.path, "utf8").split("\n")) {
            if (!line.trim()) continue;
            try {
                entries.push(JSON.parse(line) as JournalEntry);
            } catch {
                continue;
            }
        }
        return entries;
    }
}
