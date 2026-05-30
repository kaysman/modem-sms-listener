// Single source of truth for the GPS data shape published to NATS and
// written to the archive/fallback files. Every field is always present so
// downstream consumers and archive rows have a uniform schema.
//
// Accepts loose input: parser output uses `serialno`/`lon`, wire/archive
// payloads use `serial_no`/`lng`. Idempotent — calling it on already-normalized
// data returns the same shape.
export function buildGpsData(input = {}) {
  return {
    serial_no: input.serial_no ?? input.serialno ?? null,
    datetime: input.datetime ?? null,
    lat: input.lat ?? null,
    lng: input.lng ?? input.lon ?? null,
    lat_direction: input.lat_direction ?? null,
    long_direction: input.long_direction ?? null,
    speed: input.speed ?? null,
    battery: input.battery ?? null,
    height: input.height ?? null,
    charging: input.charging ?? false,
    unlocked: input.unlocked ?? false,
    chain_break_alarm: input.chain_break_alarm ?? false,
    sim_open: input.sim_open ?? false,
    top_cover_open: input.top_cover_open ?? false,
    motor_fault: input.motor_fault ?? false,
  };
}
