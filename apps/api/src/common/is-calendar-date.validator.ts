import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

/**
 * A date that EXISTS, not merely one shaped like a date.
 *
 * `@Matches(/^\d{4}-\d{2}-\d{2}$/)` is the established spelling across this api
 * for a whole-day field, and it accepts three kinds of value that are not dates.
 * Measured, not supposed:
 *
 *     '2032-04-00'  regex passes -> Invalid Date  -> 500
 *     '2026-13-01'  regex passes -> Invalid Date  -> 500
 *     '2026-02-30'  regex passes -> 2026-03-02    -> SILENTLY THE WRONG DAY
 *
 * The third is the one that matters. A 500 is loud and somebody reports it; a
 * silent rollover records a fact nobody typed. On the holiday calendar that
 * means a non-working day stored on 2 March because an administrator typed
 * 30 February, and every business-day deadline in the office then counts against
 * the wrong day — with the record showing a date she never entered.
 *
 * The test is a ROUND TRIP, which is the only form that catches all three: parse
 * as a whole UTC day and require the ISO date back out to be byte-identical to
 * what came in. A rollover changes the string; an invalid date has none.
 *
 * Deliberately paired with `@Matches` rather than replacing it, so the shape and
 * the existence are two separate messages: "that is not a date" and "that day
 * does not exist" send a reader to different places.
 */
export function isCalendarDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

export function IsCalendarDate(options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isCalendarDate',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => isCalendarDate(value),
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} must be a date that exists — 2026-02-30 and 2026-13-01 are not days`,
      },
    });
  };
}
