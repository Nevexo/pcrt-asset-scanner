// PCRT COM Scanner Agent
// This is a temporary implementation.

const io = require('socket.io-client');
const { SerialPort } = require('serialport')

const main = async () => {
  const socket = await io("http://localhost:3000");
  socket.on('connect', () => {
    console.log('connected');
  })

  socket.on('event', (data) => {
    console.log(data);
  })

  socket.on('error', (error) => {
    console.log(error);
  })

  socket.on('disconnect', () => {
    console.log('disconnected');
  })

  console.log("finding scanner");
  const ports = await SerialPort.list();
  let scanner_port;

  for (const port of ports) {
    console.log(`port ${port.path} - vendor: ${port.manufacturer}`)
    if (port.path == process.env.PORT_OVERRIDE) {
      scanner_port = port;
      break;
    }
    if (port.manufacturer == "TMS")
    {
      scanner_port = port;
    }
  }

  if (!scanner_port) {
    console.log("no scanner found");
    return;
  }

  console.log("found scanner on " + scanner_port.path);
  const port = new SerialPort({
    path: scanner_port.path,
    baudRate: 9600,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    flowControl: false,
    autoOpen: true
  })

  port.on('open', () => {
    console.log("port open");
  })

  port.on('close', () => {
    console.log("port closed, exiting.");
    socket.disconnect();
  })

  port.on('data', (data) => {
    let string = data.toString().trim();
    console.log("incoming: " + string)
    if (string.startsWith("http://db.triarom.net")) {
      // Remove server URL from QR.
      string = string.replace("http://db.triarom.net/repair/index.php?pcwo=", "");
    }
    console.log("outgoing: " + string);
    socket.emit('barcode', string);
  })

  console.log("Very temporaryTM scanner agent.");
  console.log("Scanner must be in USB-COM mode, connected and powered on.")
};

main();