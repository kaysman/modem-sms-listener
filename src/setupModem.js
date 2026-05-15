import { handleMessage } from './handleMessage.js';

// Runs after the port opens: initialize → PDU mode → drain SIM backlog → log SIM number.
export function setupModem(device, port) {
  device.initializeModem(() => {
    console.log(`[${port}] Modem Initialized`);

    device.setModemMode((res, err) => {
      if (err) {
        console.error(`[${port}] Failed to set PDU mode:`, err.message ?? err);
        return;
      }
      console.log(`[${port}] PDU mode + CNMI set:`, res);

      logStorageCapacity(device, port);

      // Drain messages already stored on the SIM (24h backlog from the tracker)
      // through the same pipeline as freshly arrived SMS. Deletion is skipped
      // on purpose — SIM ages them out and we never want to lose a fix.
      device.getSimInbox((result, err) => {
        if (err) {
          console.error(`[${port}] Failed to read SIM inbox:`, err.message ?? err);
          return;
        }
        const messages = result?.data ?? [];
        console.log(`[${port}] SIM inbox: ${messages.length} stored message(s)`);
        if (messages.length > 0) handleMessage(port, messages);
      });
    }, false, 30000, 'PDU');
  });
}

function logStorageCapacity(device, port) {
  // AT+CPMS=? → which storages the modem supports (e.g. ("SM","ME","MT"),(...),(...))
  device.executeCommand('AT+CPMS=?', (result, err) => {
    if (err) {
      console.warn(`[${port}] AT+CPMS=? failed:`, err.message ?? err);
      return;
    }
    console.log(`[${port}] Supported SMS storages:`, String(result?.data?.result ?? '').trim());
  }, 10000);

  // AT+CPMS? → currently selected storage + used/total per slot
  // Response: +CPMS: <mem1>,<used1>,<total1>,<mem2>,<used2>,<total2>,<mem3>,<used3>,<total3>
  device.executeCommand('AT+CPMS?', (result, err) => {
    if (err) {
      console.warn(`[${port}] AT+CPMS? failed:`, err.message ?? err);
      return;
    }
    console.log(`[${port}] Current SMS storage:`, String(result?.data?.result ?? '').trim());
  }, 10000);
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
