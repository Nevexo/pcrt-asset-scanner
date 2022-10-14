// PCRT COM Scanner Agent
// For use with serial-based scanners.

const io = require('socket.io-client');
const { SerialPort } = require('serialport');
const winston = require('winston');

const manifest = {
    "type": "COM Scanner",
    "version": "2.0"
}

// Defaults to TMS for most serial chips, can be overridden with SCANNER_MANUFACTURER env var.
const device_manufacturer = process.env.SCANNER_MANUFACTURER || "TMS";

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || "info",
    format: winston.format.combine(
            winston.format.timestamp({
                format: "YYYY-MM-DD HH:mm:ss"
            }),
            winston.format.printf(info => `${info.timestamp} (${info.service}) ${info.level}: ${info.message}`)
            ),
    transports: [
        new winston.transports.Console()
    ],
    defaultMeta: {service: 'main'}
});

const find_com_port = async () => {
    // Find the COM port the scanner is connected to.
    if (process.env.PORT_OVERRIDE) {
        return process.env.PORT_OVERRIDE;
    }

    const available_ports = await SerialPort.list();
    for (const port of available_ports) {
        logger.debug(`port at ${port.path}, vendor is: ${port.manufacturer}`);
        if (port.manufacturer === device_manufacturer) {
            logger.info(`Found ${device_manufacturer} scanner at ${port.path}!`);
            return port.path;
        }
    }

    return undefined;
}

const main = async () => {
    logger.info("Hello! Starting Serial Port (COM) PCRT Scanner Agent!");

    // Generate the API URL (defaults to http://localhost:3000)
    const server_url = process.env.API_SERVER_URL || "http://localhost:3000"

    logger.debug(`determined server url of ${server_url}`)
    // Open a new self-healing session with the server
    const socket = await io(server_url, {
        "reconnection": true,
        "reconnectionAttempts": 50,
        "reconnectionDelay": 1000
    })

    // Catch connection events
    socket.on('connect', async () => {
        logger.info("Successfully connected to PCRT-Scan API Server!");
        await socket.emit("manifest", manifest);
    })

    // Catch disconnections
    socket.on('disconnect', () => {
        logger.warn("Disconnected from PCRT-Scan, please check the server is still running.");
    })

    // Catch errors from socket.io
    socket.on('error', (error) => {
        logger.error("Got error message from server: " + error);
        logger.error("Shutting down!");
        process.exit(1);
    })

    // Handle acknodlogements from server
    socket.on('ack', (data) => {
        logger.debug(`Got ack: on payload ${data}`);
        logger.info("Server has acknolodged the previous scan.")
    })

    // Discover the COM port.
    // NOTE: The port is only discovered on start-up, if it changes during
    // operation, the scanner agent must be reloaded.
    const scanner_port = await find_com_port();

    // Shutdown if there's no scanner online.
    if (!scanner_port) {
        logger.error("No scanner has been found, please check it's in USB-COM mode and connected. Will exit.")
        logger.info("Please note: If you know the COM port of the device, you can specify it manually with the PORT_OVERRIDE environment variable.")
        process.exit(1);
    }

    // Inform the user if COM_BAUD_RATE isn't set
    if (!process.env.COM_BAUD_RATE) {
        logger.warn("No baud rate set, will default to 9600, this could cause issues if the scanner does not use this value.");
    }

    let session_faulted = false;

    // Open the connection!
    logger.info(`Bringing up scanner connection on port ${scanner_port}...`);
    const port = new SerialPort({
        path: scanner_port,
        baudRate: process.env.COM_BAUD || 9600,
        dataBits: process.env.COM_DATA_BITS || 8,
        parity: process.env.COM_PARITY || 'none',
        stopBits: process.env.COM_STOP_BITS || 1,
        flowControl: process.env.COM_FLOW_CONTROL || false,
        autoOpen: true
    })

    // Port has opened, will inform server if a fault clears.
    port.on('open', () => {
        logger.info("Serial port has opened successfully, now listening for codes!");
        if (session_faulted) {
            // Clear the agent fault.
            logger.info("Scanner fault has cleared!");
            session_faulted = false;
            socket.emit("fault_clear");
        }
    })

    // A port error has been raised, inform server.
    port.on('error', async (err) => {
        logger.error(err)
        logger.warn("FAULT: error caught, will reconnect port.");
        session_faulted = true;
        await socket.emit("fault")
        setTimeout (async () => {
            await port.open();
        }, 1000);
    })

    // The port closed down, attempt to re-open.
    port.on('close', async () => {
        logger.warn("FAULT: COM port has closed, will attempt to reconnect.")
        session_faulted = true;
        await socket.emit("fault")
        await port.open();
    })

    // The port has recieved data, send it to the server.
    port.on('data', async (data) => {
        const string = data.toString().trim();
        logger.debug(`incoming string: ${string} (length: ${string.length}) (limiter: ${process.env.DATA_LENGTH_LIMIT || 6})`);
        if (string.length > (process.env.DATA_LENGTH_LIMIT || 6)) {
            logger.warn("Invalid item scanned, will not forward to server.");
            return;
        }

        // Send data to server
        await socket.emit("barcode", string);
        logger.info(`Successfully sent data payload ${string} to server!`);
    })
}

console.log("Getting ready...")
main();