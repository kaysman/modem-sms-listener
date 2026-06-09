export function parseBarioxMessage(text: string) {
  const match = text.match(
    /^\*(\d{2}\/\d{2}\/\d{2}),(\d{2}:\d{2}:\d{2}),([\d]+),([\d.]+),([NS]),([\d.]+),([EW])(?:,([\d.]+))?(?:,[\d.]+)?(?:,([\d.]+))?/,
  );
  if (!match) return null;

  const [, date, time, serialno, rawLat, latDir, rawLon, lonDir, rawSpeed, rawBattery] = match;
  const lat = latDir === 'S' ? -parseFloat(rawLat) : parseFloat(rawLat);
  const lon = lonDir === 'W' ? -parseFloat(rawLon) : parseFloat(rawLon);

  return {
    serialno,
    datetime: `${date} ${time}`,
    lat,
    lon,
    lat_direction: latDir,
    long_direction: lonDir,
    speed: rawSpeed != null ? parseFloat(rawSpeed) : undefined,
    battery: rawBattery != null ? parseFloat(rawBattery) : 0,
  };
}
