import type { Journal, JournalEntry } from "../domain/ports.ts";

export class NoJournal implements Journal {
    append(_entry: JournalEntry): void {}

    replay(): readonly JournalEntry[] {
        return [];
    }
}
