// PCRT Scanner - Local WS Server
// Cameron Fleming / Triarom Ltd (c) 2022

const winston = require("winston");
const YAML = require('yaml')

const db = require("./database.js");
const scan = require("./scanner.js")
const clients = require("./client.js")

// Create a default logger with Winston
// TODO: modify this to create local logging files and/or store in JSON format.
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

const main = async () => {
  logger.info("Starting PCRT Scanner Server")
  logger.debug("configuration load")

  // Fetching configuration from YAML file
  // TODO: Make this safer.
  let config;
  try {
    config = YAML.parse(await require('fs').readFileSync('./config.yaml', 'utf8'))
  } catch (Error) {
    logger.error("Failed to load configuration")
    logger.error(Error)
    process.exit(1)
  }
  logger.debug("configuration loaded")

  // Bring up database
  logger.debug("database load")
  const database = new db.Database(logger, config);

  database.emitter.on("disconnected", () => {
    logger.error("Database disconnected")
  })

  logger.debug("connecting to database")
  await database.connect().catch((error) => {
    logger.error("Failed to connect to database on cold-start, this will cause a process exit.")
    logger.error(error)
    process.exit(1)
  });

  // Bring up Scanner SocketIO
  logger.debug("starting scanner socket server")
  const scanner = new scan.Scanner(logger, config);

  // Handle "QRCommands"
  // These are QR codes that can be printed to trigger commands within the PCRT-asset-scanner.
  // This will likely be removed in the future, but it makes my life easier for now.
  scanner.emitter.on("system_command", async (command) => {
    switch (command) {
      case "RECONNECT":
        logger.info("QRCommand: Reconnecting to database")
        await database.reconnect();
        break;
      case "DISCONNECT":
        logger.info("QRCommand: Disconnecting from database")
        await database.disconnect();
        break;
      case "SHUTDOWN":
        logger.info("QRCommand: Shutting down")
        database.disconnect();
        process.exit(0)
      case "CACHE_CLEAR":
        logger.info("QRCommand: Clearing location/state caches")
        client.broadcast_message("info", {"message": "Clearing location/state caches", "type": "info"})
        await database.clear_caches();
        break;
      default:
        logger.warn("QRCommand: Unknown command: " + command)
        client.broadcast_message("error", {"error": "qrcommand_error", "message": "Invalid command sent to QRCommand."})
        break;
    }
  })
  
  // Handle new scanner connecting
  scanner.emitter.on("scanner_connected", async () => {
    client.broadcast_message("scanner_status", {"status": "connected"})
  });

  // Handle scanner disconnecting
  scanner.emitter.on("scanner_disconnected", async () => {
    client.broadcast_message("scanner_status", {"status": "disconnected"})
  });

  // Handle any other barcode entering the system from a scanner agent.
  scanner.emitter.on('barcode', async (code) => {
    const wo = await database.get_work_order(code).catch(error => {
      logger.error(error)
      logger.warn("Unknown barcode: " + code)
      client.broadcast_message("server_error", {
        "error": "invalid_barcode",
        "message": "Invalid barcode scanned, ensure the scanner is reading the correct barcode."
      })
      return;
    });

    if (!wo) return;

    // Successfully found the work order and customer, we can proceede.
    logger.debug("Scanned owner: " + wo.customer.name);
    logger.debug("Scanned work order problem: " + wo.problem);

    // Create a broadcast for this scan
    // This also lists the available options for the user, this may be handed off to the frontend
    // at some point, but the configuration lives on the server at the moment.

    // Calculate available options
    if (wo.status.pcrt_scan_state == undefined) {
      // This is a state the system isn't sure how to handle, throw a warning.
      logger.error(`Work order ${wo.id} is in an unknown state: ${wo.status.name}`)
      client.broadcast_message("server_error", {
        "error": "unknown_state",
        "message": `Work order ${wo.id} is in an unknown state: ${wo.status.name} - the system is unable to proceede, please manually update the work order on PCRT. `
      });
      return;
    }

    if (wo.status.pcrt_scan_state.name == "collected") {
      // This shouldn't be possible, a closed work order has been scanned. This is usually
      // due to staff not replacing asset labels after opening a new W/O.

      logger.error(`Work order ${wo.id} is in completed state.`);
      client.broadcast_message("server_error", {
        "error": "old_work_order",
        "message": `Work order ${wo.id} is in collected state. If you have just checked this device in, please make sure to replace it's asset labels before storing, alternatively, you can set the work order status to open on PCRT.`
      });

      return;
    }

    let permissible_states = [];
    const states = await database.get_asset_states();

    if (wo.status.pcrt_scan_state.is_on_site && !wo.status.pcrt_scan_state.work_in_progress) {
      // Find any state that is off site & not work in progress

      for (let state in states) {
        state = states[state];

        // Skip any states that PCRT-Scan does not handle
        if (state.pcrt_scan_state == undefined) continue;
        
        logger.debug(`[storage -> complete?] processing state: ${state.pcrt_scan_state.name} | stored: ${state.pcrt_scan_state.is_stored} | work in progress: ${state.pcrt_scan_state.work_in_progress} | on-site: ${state.pcrt_scan_state.is_on_site}`)

        // Skip any on-site states
        if (state.pcrt_scan_state.is_on_site) continue;

        // Skip any in-progress states redundant? (TODO)
        if (state.pcrt_scan_state.work_in_progress) continue;

        permissible_states.push(state);
      }

    } else if (wo.status.pcrt_scan_state.is_on_site && wo.status.pcrt_scan_state.is_stored) {
      // This device is currently in storage, find all possible states that are "work in progress" and not "stored"

      for (let state in states) {
        state = states[state];

        // Skip any states that PCRT-Scan does not handle
        if (state.pcrt_scan_state == undefined) continue;

        logger.debug(`[storage -> wip/complete] processing state: ${state.pcrt_scan_state.name} | stored: ${state.pcrt_scan_state.is_stored} | work in progress: ${state.pcrt_scan_state.work_in_progress} | on-site: ${state.pcrt_scan_state.is_on_site}`)

        // Skip any states that are not "work in progress"
        if (!state.pcrt_scan_state.work_in_progress) continue;

        // Skip any states that are "stored"
        if (state.pcrt_scan_state.is_stored) continue;
        
        permissible_states.push(state);
      }

    } else if (wo.status.pcrt_scan_state.is_on_site && wo.status.pcrt_scan_state.work_in_progress) {
      // The device is being worked on, find all possible states that are "stored"
      
      for (let state in states) {
        state = states[state];

        // Skip any states that PCRT-Scan does not handle
        if (state.pcrt_scan_state == undefined) continue;

        logger.debug(`[wip -> storage] processing state: ${state.pcrt_scan_state.name} | stored: ${state.pcrt_scan_state.is_stored} | work in progress: ${state.pcrt_scan_state.work_in_progress} | on-site: ${state.pcrt_scan_state.is_on_site}`)

        // Skip any states that are not "stored"
        if (!state.pcrt_scan_state.is_stored) continue;

        logger.debug(`[wip -> storage] adding state: ${state.pcrt_scan_state.name}`)
        permissible_states.push(state);
      }
    } else {
      // This should never happen, a likely cause is that a device was taken off-site while waiting for parts.
      // TODO: Handle this nateively.

      logger.error(`Work order ${wo.id} cannot proceede from ${wo.status.pcrt_scan_state.name} - is off site?`);
      client.broadcast_message("server_error", {
        "error": "no_permissible_states",
        "message": `Work order ${wo.id} cannot proceede from ${wo.status.pcrt_scan_state.name} - if it was taken off site while still being worked on, please manually update the state in PCRT. This will be fixed eventually.`
      });
      return;
    }

    if (permissible_states.length == 0) {
      // Somehow there are no states we can go to, this should never happen but oh well.
      logger.error(`Work order ${wo.id} cannot proceede from ${wo.status.pcrt_scan_state.name}`);
      client.broadcast_message("server_error", {
        "error": "no_permissible_states",
        "message": `Work order ${wo.id} cannot proceede from ${wo.status.pcrt_scan_state.name} - there are no available states from this state. This error is really bad, tell Cam...`
      });

      return;
    }

    // Tell the client about the work order and permissible states.
    await client.broadcast_message("scan", {
      "work_order": wo,
      "options": {
        "states": permissible_states
      }
    })

    logger.info(`Work order ${wo.id} has been scanned and delivered to clients.`);
  })

  // Bring up Frontend Sockets
  const client = new clients.Client(logger, config);
  
  // Add handlers
  // TODO: This really needs tidying up into its own module.
  client.emitter.on('client_connected', async (client) => {
    client.emit("hello", {
      "api_version": 1, 
      "api_name": "pcrt_scanner",
      "connect_time": new Date().toISOString(),
      "scanner_ready": scanner.scanner_connected
    });
  })

  // If execution reaches this far, we can safely assume the server is up and running.
  logger.info("PCRT Scanner Server started")
  logger.info(`Listening for scanner agents on port ${config.ports.scanner_socket}`)
  logger.info(`Listening for client requests on port ${config.ports.client_socket}`)
}

// Invoke async entrypoint
main();