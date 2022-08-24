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
    await client.emit("hello", {
      "api_version": 1, 
      "api_name": "pcrt_scanner",
      "connect_time": new Date().toISOString(),
      "scanner_ready": scanner.scanner_connected
    });

    // Send the client the current storage state.
    await client.emit("storage_state", await database.get_storage_statues());
  })

  client.emitter.on("refresh_storage", async (client_instance) => {
    // Client requested a refresh of the storage view.
    await client_instance.emit("storage_state", await database.get_storage_statues())
  })

  client.emitter.on("apply_action", async (data) => {
    const calling_client = data['client'];
    const action_request = data['data'];
    const woid = action_request['work_order'];
    const action_id = action_request['action_id'];

    // Attempt to resolve the work order
    const work_order = await database.get_work_order(woid).catch(async (error) => {
      logger.error(`Error fetching work order ${woid} - ${error}`)
      await calling_client.emit("server_error", {error: error, message: "No message available."});
      return;
    });
    if (!work_order) {
      logger.error(`Failed to get work order ${woid} - aborting action request.`);
      await calling_client.emit("server_error", {
        "error": "action_request_failed",
        "message": "The server failed to perform the requested action - this is likely a problem with the network or server. Check the logs."
      })
      return;
    }

    // Find PCRT state ID for the requested action
    let pcrt_state = undefined;
    let state_stored = undefined;
    let state_wip = undefined;
    let state_extra_alert = undefined;
    for (const state_id in config['states']) {
      const state = config['states'][state_id]
      if (state['name'] == action_id) {
        pcrt_state = state_id;
        state_stored = state['is_stored'];
        state_wip = state['work_in_progress'];
        state_extra_alert = state['extra_alert'];
      }
    }

    if (!pcrt_state) {
      // Failed to resolve a state, this ia a major fault.
      logger.error(`Failed to resolve ${action_id} to a PCRT state, this is likely a configuration error.`)
      await calling_client.emit("server_error", {
        "error": "state_resolution_failed",
        "message": "The server failed to find a valid PCRT state for this action request and was unable to apply the action - this is a critical error, please contact the system administrator."
      })
      return;
    }

    // Check storage location if this state requires storage.
    let location = work_order.location;
    if (location) logger.debug(`current location: ${location.name}`);
    logger.debug(`is going to be stored: ${state_stored} | is wip: ${state_wip}`)

    let valid_location = true;
    // See if we need to change the location of this device.
    if (work_order.location != undefined) {
      if (state_wip && work_order.location.type != "wip") valid_location = false;
      if (!state_wip && work_order.location.type == "wip") valid_location = false;

      // Ignore oversize devices, these use the same bay whether WIP or complete.
      if (work_order.location.type == "oversize") valid_location = true;
    }

    if (state_stored) {
      if (work_order.location == undefined || !valid_location) {
        // No location is set or it is invalid given this change (i.e., wip -> complete)
        // A new location will be assigned.
        
        client.broadcast_message("info", {"type": "Warning", "message": `Considering new locations for asset ${woid}`})

        const all_locations = await database.get_storage_locations();
        const asset_locations = await database.get_open_work_orders();

        let potential_locations = [];
        for (let location in all_locations) {
          location = all_locations[location]

          logger.debug(`considering ${location.name} (${location.type}) for storage:${state_stored}, wip:${state_wip}`)

          // TODO: Handle this dynamically.
          if (state_wip && location.type != "wip") continue;
          if (!state_wip && location.type != "complete") continue;
          if (location.type == "oversize") continue;
          
          logger.debug(`consideration for ${location.name} continued, checking asset location.`)

          // Check the location is not in use by another WO
          if (await database.get_work_order_by_location(location.id) != undefined) continue;

          logger.debug(`${location.name} considered for storage of this asset`)

          // TODO: Potentially abort the check now we have found a bay?

          // Add this location to the potentials list
          potential_locations.push(location);
        }

        if (potential_locations.length == 0) {
          logger.error("no potential locations available.");
          await client.broadcast_message("server_error", {
            "error": "no_storage_locations",
            "message": "The server couldn't find a potential storage location for this asset, please set it manually in PCRT and re-scan."
          })
          return;
        }

        location = potential_locations[0];
        client.broadcast_message("info", {"type": "Storage", "message": `New location chosen for asset ${woid} - ${location.name}`})

        // Update the location in the database
        const result = await database.set_work_order_location(woid, location['id']);
        if (!result) {
          logger.error("failed to update work order storage location");
          await client.broadcast_message("server_error", {
            "error": "location_change_failed",
            "message": "The server failed to update the storage location, please check the log, update it manually and re-scan."
          });
          return;
        }
      }
    }
    

    // PCRT state has been resolved to a work order, the change can be applied to the database.
    const result = await database.set_work_order_state(woid, pcrt_state);

    if (!result) {
      logger.error("Failed to update state.");
      await calling_client.emit("server_error", {
        "error": "commit_failed",
        "message": "Failed to apply action to database, please see the log."
      });
      return;
    }

    // Emit acknolodgement and update the storage states.
    await client.broadcast_message("storage_state", await database.get_storage_statues())
    let ack_operand = {"location": location};
    
    if (location != work_order.location) {
      ack_operand['location_changed'] = true;
    }

    if (state_stored) {
      // Triggers the storage location prompt as the device is returning to storage.
      ack_operand['location_info_required'] = true;
    }
    
    if (state_extra_alert && !ack_operand['location_inf0_required']) {
      // Trigger an extra modal with a warning message present.
      ack_operand['alert'] = state_extra_alert;
    }

    await client.broadcast_message("ack_action", ack_operand);
    logger.info(`Performed action ${action_id} on work order ${woid} successfully!`)
  })

  // If execution reaches this far, we can safely assume the server is up and running.
  logger.info("PCRT Scanner Server started")
  logger.info(`Listening for scanner agents on port ${config.ports.scanner_socket}`)
  logger.info(`Listening for client requests on port ${config.ports.client_socket}`)
}

// Invoke async entrypoint
main();