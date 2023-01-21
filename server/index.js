// PCRT Scanner - Local WS Server
// Cameron Fleming / Triarom Ltd (c) 2022

const winston = require("winston");
const YAML = require('yaml')

const db = require("./database.js");
const scan = require("./scanner.js")
const clients = require("./client.js")
const lockouts = require("./lockouts.js")
const transactions = require("./transactions.js")
const notify_handler = require("./notify.js")
const cron = require("cron").CronJob;

const child_process = require("child_process");

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

  // Create Triarom Notify handler
  logger.debug("starting notify handler")
  const notify = new notify_handler.Notify(logger, config);
  
  // Ensure transactions are enabled if daily reports are enabled.
  if (config.daily_report.enable && !config.transaction_logging.enable) {
    logger.error("Daily reports are enabled, but transaction logging is not. Please enable transaction logging to use daily reports.")
    process.exit(1)
  }

  // Bring up lockouts handler
  logger.debug("starting lockouts handler")
  const lockout = new lockouts.Lockouts(logger, config);

  // Bring up transactions handler
  logger.debug("starting transactions handler")
  const transaction = new transactions.Transactions(logger, config);

  // Configure daily report cron job if enabled
  if (config.daily_report.enable && config.daily_report.cron != undefined) {
    logger.debug("creating daily reports cron job")
    const daily_report_job = new cron(config.daily_report.cron, async () => {
      logger.info("Daily report cron job triggered, generating report.")
      const report = await transaction.daily_report()
      await client.broadcast_message("daily_report", report)
      await notify.send_msg("daily_report", report)
    }, null, true, "Europe/London");
  }

  // Bring up database
  logger.debug("database load")
  const database = new db.Database(logger, config, lockout);

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
        await client.broadcast_message("info", {"message": "Shutting down, please wait."})
        child_process.exec("shutdowm.exe /s /t 3")
        break;
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
    await client.broadcast_message("scanner_status", {"status": "connected"})
  });

  scanner.emitter.on("scanner_info", async (data) => {
   await client.broadcast_message("scanner_status", {
     "status": "connected",
     "type": data['type'],
     "version": data['version']
   })
  })

  // Handle scanner disconnecting
  scanner.emitter.on("scanner_disconnected", async () => {
    await client.broadcast_message("scanner_status", {"status": "disconnected"})
  });

  // Handle a fault from the scanner agent
  scanner.emitter.on("scanner_faulted", async () => {
      await client.broadcast_message("scanner_status", {
        "status": "faulted",
        "message": "Scanner agent reported a fault, this is usually temporary. Check the logs if this persists."
      });
  })

  // Handle scanner fault clearing
  scanner.emitter.on("scanner_fault_clear", async () => {
      await client.broadcast_message("scanner_status", {
          "status": "connected"
      })
  })

  // Handle any other barcode entering the system from a scanner agent.
  scanner.emitter.on('barcode', async (code) => {
    await client.broadcast_message("busy", "fetching");
    let wo = await database.get_work_order(code).catch(error => {
      logger.error(error)
      logger.warn("Unknown barcode: " + code)
      client.broadcast_message("server_error", {
        "error": "invalid_barcode",
        "message": "Invalid barcode scanned, ensure the scanner is reading the correct barcode."
      })
      return;
    });

    if (!wo) return;
    if (wo.type != "work_order") return;

    wo = wo.payload;

    // Successfully found the work order and customer, we can proceede.
    logger.debug("Scanned owner: " + wo.customer.name);
    logger.debug("Scanned work order problem: " + wo.problem);

    // Log transaction for this scan
    await transaction.log_transaction("scan", {"woid": wo.id})

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

        // Skip any states that are "stored" unless no storage location is set.
        if (state.pcrt_scan_state.is_stored && wo.location != undefined) continue;
        
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
      "api_version": 3, 
      "api_name": "pcrt_scanner",
      "connect_time": new Date().toISOString(),
      "scanner_ready": scanner.scanner_connected,
      "scan_count": await transaction.scan_odometer() || undefined,
      "client_id": client.id
    });

    await client.emit("busy", "Initalising!");

    // Send the client the current storage state.
    await client.emit("storage_state", await database.get_storage_statues());
  })

  client.emitter.on("refresh_storage", async (client_instance) => {
    // Client requested a refresh of the storage view.
    await client.broadcast_message("busy", "fetching");
    // await client_instance.emit("storage_state", await database.get_storage_statues())
    await client.broadcast_message("storage_state", await database.get_storage_statues())
  })

  // Handle request for lockout info
  client.emitter.on("get_lockout_info", async (data) => {
    // The client has requested lockout information for a given slid
    logger.debug(`Client requested lockout info for ${data.data.slid}`);
    const calling_client = data.client;
    const slid = data.data.slid;

    const bay_lockout = await lockout.get_lockout_for_bay(slid);
    logger.debug(`Lockout info for ${slid} is ${JSON.stringify(bay_lockout)}`);

    if (!bay_lockout) {
      // There is no lockout for this bay, give the client the option to create one.
      await calling_client.emit("lockout_info", {
        "slid": slid,
        "engineers": config.lockouts.engineers
      })
    } else {
      // There is a lockout in this bay
      await calling_client.emit("lockout_info", {
        "slid": slid,
        "lockout": bay_lockout
      })
    }
  })

  client.emitter.on("lockout_create", async (data) => {
    // The client has requested a new lockout
    logger.debug(`Client requested lockout creation for ${data.data.slid} for engineer: ${data.data.engineer}`);

    // Check for an existing work order
    const existing_wo = await database.get_work_order_by_location(data.data.slid);
    if (existing_wo) {
      // There is a work order for this bay, we cannot create a lockout.
      await data.client.emit("server_error", {
        "error": "lockout_create_failed",
        "message": `Cannot create lockout for ${data.data.slid} - there is a work order in this bay.`
      })

      return;
    }

    await lockout.create_lockout(data.data.slid, data.data.engineer);
    await client.broadcast_message("storage_state", await database.get_storage_statues())
    await transaction.log_transaction("lockout_change", {"slid": data.data.slid, "engineer": data.data.engineer, "action": "create"});
    await notify.send_msg("lockout_created", data.data);
  });

  client.emitter.on("clear_lockout", async (data) => {
    // The client has requested a lockout release.
    // This accepts a lockout ID, not a bay ID.
    logger.debug(`Client requested lockout release for ${data.data.lockout_id}`);
    const id = data.data.id;

    await lockout.clear_lockout(id);
    await client.broadcast_message("storage_state", await database.get_storage_statues())
    await transaction.log_transaction("lockout_change", {"slid": data.data.slid, "engineer": data.data.engineer, "action": "clear"});
  });

  client.emitter.on("get_daily_report", async (data) => {
    // Handle daily report request data
    if (!config.daily_report.enable) {
      // Daily reports are disabled.
      await data.client.emit("server_error", {
        "error": "daily_report_disabled",
        "message": "Daily reports are disabled on this server."
      })

      return;
    }

    const report = await transaction.daily_report();
    await data.client.emit("daily_report", report);
  })

  client.emitter.on("apply_action", async (data) => {
    await client.broadcast_message("busy", "applying_action");
    const calling_client = data['client'];
    const action_request = data['data'];
    const woid = action_request['work_order'];
    const action_id = action_request['action_id'];

    // Attempt to resolve the work order
    let work_order = await database.get_work_order(woid).catch(async (error) => {
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

    if (work_order.type != "work_order") {
      await calling_client.emit("server_error", {
        "error": "action_apply_wo_type_invalid",
        "message": "Returned work order type is invalid, cannot continue."
      })
      return;
    }

    work_order = work_order.payload;

    // Find PCRT state ID for the requested action
    let pcrt_state = undefined;
    let state_stored = undefined;
    let state_wip = undefined;
    let state_extra_alert = undefined;
    let new_state = undefined;
    for (const state_id in config['states']) {
      const state = config['states'][state_id]
      if (state['name'] == action_id) {
        pcrt_state = state_id;
        state_stored = state['is_stored'];
        state_wip = state['work_in_progress'];
        state_extra_alert = state['extra_alert'];
        new_state = state;
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

    await client.broadcast_message("busy", "new_location");
    
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
          if (location.type == "oversize") continue; // Skip oversize locations, these are handled separately.
          if (await lockout.get_lockout_for_bay(location.id)) continue; // Skip locked bays
          
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

        // Add private notes for location change/assignment
        if (work_order.location == undefined) {
          // A location has never been set
          if (config['notes']['location_assigned']) {
            await database.add_private_note(woid, `Location assigned: ${location.name}`);
          }
        } else {
          // This is a change of location
          if (config['notes']['location_changed']) {
            await database.add_private_note(woid, `Asset location changed from ${work_order.location.name} to ${location.name} by the server.`);
          }
        }

      }
    }
    
    await client.broadcast_message("busy", "updating_pcrt");

    // PCRT state has been resolved to a work order, the change can be applied to the database.
    const result = await database.set_work_order_state(woid, pcrt_state, new_state);

    // Add private note to work order regarding state change
    if (config['notes']['status_changed']) {
      await database.add_private_note(woid, `Asset state changed to '${new_state['alias']}' by scanner.`);
    }

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
    let ack_operand = {"location": location, "action": new_state};
    
    if (location != work_order.location) {
      ack_operand['location_changed'] = true;
    }

    if (state_stored) {
      // Triggers the storage location prompt as the device is returning to storage.
      ack_operand['location_info_required'] = true;
    }
    
    if (state_extra_alert && !ack_operand['location_info_required']) {
      // Trigger an extra modal with a warning message present.
      ack_operand['alert'] = state_extra_alert;
    }

    await client.broadcast_message("ack_action", ack_operand);
    logger.info(`Performed action ${action_id} on work order ${woid} successfully!`)

    // Log transaction
    await transaction.log_transaction("action_applied", {woid: woid, action: action_id, location: location.name || null, new_state_alias: new_state['alias']});
  })

  // Handle frontend_ack for location change ack
  client.emitter.on("location_change_ack", async (data) => {
    client.broadcast_message("ack_action", "ack_elsewhere");
  })

  client.emitter.on("frontend_modal_close", async (data) => {
    // Handle this the same as location_change_ack, this is for future-proofing.
    client.broadcast_message("ack_action", "ack_elsewhere");
  })

  // If execution reaches this far, we can safely assume the server is up and running.
  logger.info("PCRT Scanner Server started")
  logger.info(`Listening for scanner agents on port ${config.ports.scanner_socket}`)
  logger.info(`Listening for client requests on port ${config.ports.client_socket}`)
}

// Invoke async entrypoint
console.log("Showtime!")
main();