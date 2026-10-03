export const CHANNELS = ["booking", "airbnb"] as const;
export type Channel = (typeof CHANNELS)[number];

export interface Reservation {
    readonly bookingId: string;
    readonly channel: Channel;
    readonly guestName: string;
    readonly checkIn: string;
    readonly checkOut: string;
    readonly totalPrice: number;
    readonly currency: string;
}

export interface Received {
    readonly id: string;
    readonly candidateId: string;
    readonly receivedAt: number;
    readonly reservation: Reservation;
}

export type Validation =
    | { readonly valid: true; readonly reservation: Reservation }
    | { readonly valid: false; readonly invalid: readonly { readonly field: string; readonly problem: string }[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isRealDate = (value: unknown): value is string => {
    if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
};

const isText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function validateReservation(body: unknown): Validation {
    const source = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    const invalid: { field: string; problem: string }[] = [];

    if (!isText(source.bookingId)) invalid.push({ field: "bookingId", problem: "required, non-empty text" });
    if (!CHANNELS.includes(source.channel as Channel)) {
        invalid.push({ field: "channel", problem: `one of ${CHANNELS.join(", ")}` });
    }
    if (!isText(source.guestName)) invalid.push({ field: "guestName", problem: "required, non-empty text" });
    if (!isRealDate(source.checkIn)) invalid.push({ field: "checkIn", problem: "a real date as YYYY-MM-DD" });
    if (!isRealDate(source.checkOut)) invalid.push({ field: "checkOut", problem: "a real date as YYYY-MM-DD" });
    if (isRealDate(source.checkIn) && isRealDate(source.checkOut) && source.checkOut <= source.checkIn) {
        invalid.push({ field: "checkOut", problem: "must be after checkIn" });
    }
    if (typeof source.totalPrice !== "number" || !Number.isFinite(source.totalPrice) || source.totalPrice < 0) {
        invalid.push({ field: "totalPrice", problem: "a number, zero or more" });
    }
    if (typeof source.currency !== "string" || !/^[A-Z]{3}$/.test(source.currency)) {
        invalid.push({ field: "currency", problem: "ISO 4217, three uppercase letters" });
    }

    if (invalid.length > 0) return { valid: false, invalid };

    return {
        valid: true,
        reservation: {
            bookingId: (source.bookingId as string).trim(),
            channel: source.channel as Channel,
            guestName: (source.guestName as string).trim(),
            checkIn: source.checkIn as string,
            checkOut: source.checkOut as string,
            totalPrice: source.totalPrice as number,
            currency: source.currency as string,
        },
    };
}
