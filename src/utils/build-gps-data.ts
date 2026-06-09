export interface GpsData {
  serial_no: string | null;
  datetime: string | null;
  lat: number | null;
  lng: number | null;
  lat_direction: string | null;
  long_direction: string | null;
  speed: number | null;
  battery: number | null;
  height: number | null;
  charging: boolean;
  unlocked: boolean;
  chain_break_alarm: boolean;
  sim_open: boolean;
  top_cover_open: boolean;
  motor_fault: boolean;
}

export function buildGpsData(input: Record<string, any> = {}): GpsData {
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
