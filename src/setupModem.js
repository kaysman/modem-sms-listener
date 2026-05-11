// Runs after the port opens: initialize → PDU mode → clear SIM → log SIM number.
export function setupModem(device, port) {
  device.initializeModem(() => {
    console.log(`[${port}] Modem Initialized`);

    device.setModemMode((res, err) => {
      if (err) {
        console.error(`[${port}] Failed to set PDU mode:`, err.message ?? err);
        return;
      }
      console.log(`[${port}] PDU mode + CNMI set:`, res);

      device.deleteAllSimMessages((res, err) => {
        if (err) {
          console.error(`[${port}] Failed to delete SIM messages:`, err.message ?? err);
          return;
        }
        console.log(`[${port}] SIM messages cleared:`, res);
        logSimNumber(device, port);
      });
    }, false, 30000, 'PDU');
  });
}

function logSimNumber(device, port) {
  device.executeCommand('AT+CNUM', (result, err) => {
    if (err) {
      console.warn(`[${port}] Could not read SIM number:`, err.message ?? err);
      return;
    }
    // +CNUM: "","+1234567890",145  — absent when SIM has no stored MSISDN
    const match = String(result?.data ?? result).match(/\+CNUM:[^,]*,"?([^",]+)"?/);
    if (match) {
      console.log(`[${port}] SIM phone number: ${match[1]}`);
    } else {
      console.log(`[${port}] SIM phone number: not provisioned on this SIM`);
    }
  }, 10000);
}
