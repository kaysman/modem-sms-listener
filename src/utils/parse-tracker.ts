export function parseTrackerMessage(text: string) {
  const match = text.match(
    /^\*(\d{2}\/\d{2}\/\d{2}),(\d{2}:\d{2}:\d{2}),(\d+)\s*,([\d.]+),([NS]),([\d.]+),([EW]),(\d+),(\d+),&,(\d+),([01]),([01]),([01]),([01]),([01]),([01])#$/,
  );
  if (!match) return null;

  const [
    ,
    date,
    time,
    serialno,
    rawLat,
    latDir,
    rawLon,
    lonDir,
    rawSpeed,
    rawHeight,
    rawBattery,
    rawCharging,
    rawUnlock,
    rawChainBreak,
    rawSim,
    rawTopCover,
    rawMotorJam,
  ] = match;

  const lat = latDir === 'S' ? -parseFloat(rawLat) : parseFloat(rawLat);
  const lon = lonDir === 'W' ? -parseFloat(rawLon) : parseFloat(rawLon);

  return {
    serialno,
    datetime: `${date} ${time}`,
    lat,
    lon,
    lat_direction: latDir,
    long_direction: lonDir,
    speed: parseInt(rawSpeed, 10),
    height: parseInt(rawHeight, 10),
    battery: parseInt(rawBattery, 10),
    charging: rawCharging === '1',
    unlocked: rawUnlock === '1',
    chain_break_alarm: rawChainBreak === '1',
    sim_open: rawSim === '1',
    top_cover_open: rawTopCover === '1',
    motor_fault: rawMotorJam === '1',
  };
}
