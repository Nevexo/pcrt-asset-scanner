// PCRT Scanner Tool - Server Database Interface

const events = require("events")
const mysql = require("promise-mysql");

class Database {
  constructor(logger, config, lockouts) {
    this.logger = logger.child({meta: {"service": "database"}});
    this.lockouts = lockouts;
    this.logger.debug("database invoked, loading");
    this.config = config;

    // Setup event emitters
    this.emitter = new events.EventEmitter();
  }

  async clear_caches() {
    this.logger.info("Clearing location/state caches.")
    this.storage_location_cache = undefined;
    this.asset_status_cache = undefined;
  }

  async connect() {
    // Establish connection to database
    this.logger.debug(`Connecting to ${this.config.database.host} as ${this.config.database.user}`)
    this.connection = await mysql.createConnection({
      host: this.config.database.host,
      port: this.config.database.port,
      user: this.config.database.user,
      password: this.config.database.password,
      database: this.config.database.database
    }).catch(error => {
      this.logger.error(error)
    });

    this.connection.on("error", (error) => {
      this.logger.error(error)
    })

    this.connection.on("disconnect", async () => {
      this.logger.info("database connection lost.");
      this.emitter.emit("disconnected");

      await this.handle_disconnection();
    })

    this.logger.debug("connected to database.")
    return true;
  }

  async handle_disconnection() {
    this.logger.debug("restarting database connection")
    await this.connect();
  }

  async disconnect() {
    this.logger.info("disconnecting from database")
    this.connection.end();
  }

  async reconnect() {
    this.logger.info("reconnecting to database")
    await this.disconnect();
    await this.connect();
  }

  async get_storage_locations() {
    // Get all possible storage locations, this is from the
    // storagelocations table.
    if (this.storage_location_cache) return this.storage_location_cache;
    this.logger.debug("getting storage locations")

    const result = await this.connection.query(`SELECT * FROM storagelocations`)

    if (result.length == 0) {
      this.logger.erorr("FATAL: No storage locations found, ensure they are created in PCRT!")
      this.logger.error("This error is fatal, exiting.")
      process.exit(1)
    }

    let locations = {}
    for (let bay in result) {
      bay = result[bay]
      // Find the type of storage location this is from the prefix
      let type = undefined;
      for (let prefix in this.config.storage_prefixes) {
        if (bay.slname.startsWith(this.config.storage_prefixes[prefix])) {
          type = prefix;
          break;
        }
      }

      locations[bay.slid] = {
        "id": bay.slid,
        "name": bay.slname,
        "type": type
      }
    }
    
    this.storage_location_cache = locations;
    return locations;
  }

  async get_asset_states() {
    // Get all possible states for devices, this is from the
    // boxstyles table.
    if (this.asset_status_cache) return this.asset_status_cache;
    this.logger.debug("getting asset states")
    const result = await this.connection.query(`SELECT * FROM boxstyles`)
    
    let states = {};
    for (let state in result) {
      state = result[state]

      states[state.statusid] = {
        "id": state.statusid,
        "name": state.boxtitle,
        "pcrt_scan_state": this.config['states'][state.statusid] || undefined,
        "colour": state.selectorcolor
      }
    }

    this.asset_status_cache = states;
    return states;
  }

  async format_work_order(wo) {
    const states = await this.get_asset_states();
    const locations = await this.get_storage_locations()

    // TODO: Refactor this, requesting notes and labour should not be done here.
    const notes = await this.get_public_notes(wo.woid);
    const internal_notes = await this.get_private_notes(wo.woid);
    const labour = await this.get_job_labour(wo.woid);

    let work_order = {"type": "work_order", "payload":
    {
      "id": wo.woid,
      "customer": await this.get_customer(wo.pcid),
      "problem": wo.probdesc,
      "status": states[wo.pcstatus.toString()] || wo.pcstatus || undefined,
      "open_date": new Date(wo.dropdate).toISOString(),
      "location": locations[wo.slid] || undefined,
      "notes": notes || [],
      "internal_notes": internal_notes || [],
      "tasks": labour || undefined,
    }}
    return work_order
  }

  async get_work_order_by_location(slid) {
    // Get work order from storage location
    this.logger.debug(`getting work order in location ${slid}`)

    // Find status ID for all closed jobs
    let closed_state = undefined;
    for (const state in this.config.states) {
      if (this.config.states[state].name == "collected") closed_state = state;
    }

    if (!closed_state) {
      this.logger.error("FATAL: No closed state found, ensure it is created in PCRT!")
      this.logger.error("This error is fatal, exiting.")
      process.exit(1)
    }

    const result = await this.connection.query(`SELECT * FROM pc_wo WHERE slid = ${mysql.escape(slid)} AND pcstatus != ${mysql.escape(closed_state)}`);

    if (result.length == 0) {
      // Check for a bay lockout
      const lockout = await this.lockouts.get_lockout_for_bay(slid);

      // There is an active lockout, send this instead of a work order.
      if (lockout) {
        return {
          "type": "lockout",
          "payload": {
            "id": lockout.id,
            "engineer": lockout.engineer,
            "timestamp": lockout.timestamp,
          }
        }
      } else {return undefined;}
    } 

    if (result.length > 1) {
      // There are too many assets in this bay.
      throw new Error("overallocated_bay");
    }

    return this.format_work_order(result[0]);
  }

  async get_work_order(woid) {
    // Get a work order from it's ID, as scanned by the scanner.
    this.logger.debug(`getting work order ${woid}`)
    const result = await this.connection.query(`SELECT * FROM pc_wo WHERE woid = ${mysql.escape(woid)}`);

    if (result.length == 0) {
      throw new Error(`invalid_work_order`);
    }
    
    this.logger.debug(`found work order ${woid} - PCID: ${result[0].pcid}`)
    
    const wo = result[0];

    const work_order = this.format_work_order(wo);

    return work_order;
  }

  async get_work_order_by_status(status) {
    // Get all currently open work orders from their status ID
    this.logger.debug(`getting work orders by status ${status}`)

    const result = await this.connection.query(`SELECT * FROM pc_wo WHERE pcstatus = ${mysql.escape(status)}`)

    let work_orders = [];
    for (let wo in result) {
      result.push(this.format_work_order(result[wo]))
    }

    return work_orders
  }

  async get_open_work_orders() {
    // Get all non-collected work orders
    this.logger.debug("getting open work orders")

    // Find status ID for all closed jobs
    let closed_state = undefined;
    for (const state in this.config.states) {
      if (this.config.states[state].name == "collected") closed_state = state;
    }

    if (!closed_state) {
      this.logger.error("FATAL: No closed state found, ensure it is created in PCRT!")
      this.logger.error("This error is fatal, exiting.")
      process.exit(1)
    }

    const result = await this.connection.query(`SELECT * FROM pc_wo WHERE pcstatus != ${closed_state}`)

    let work_orders = [];
    for (let wo in result) {
      work_orders.push(await this.format_work_order(result[wo]))
    }

    return work_orders
  }

  async set_work_order_state(woid, state_id, state) {
    // Set a work order to a new PCRT state. 
    this.logger.debug(`setting ${woid} to state: ${state_id} (${state['name']})`)

    // TODO: temporary hack
    let dateQuery = "";
    if (!state.is_on_site) {
      dateQuery = `, pickupdate = '${new Date().toISOString().slice(0, 19).replace('T', ' ')}'`;
    }

    await this.connection.query(`UPDATE pc_wo SET pcstatus = ${mysql.escape(state_id)} ${dateQuery} WHERE woid = ${mysql.escape(woid)}`).catch(error => {
      this.logger.error(error);
      return false;
    });
    
    return true;
  }

  async set_work_order_location(woid, slid) {
    // Set a work order to a new location by slid.
    this.logger.debug(`setting ${woid} location to ${slid}`)

    await this.connection.query(`UPDATE pc_wo SET slid = ${mysql.escape(slid)} WHERE woid = ${mysql.escape(woid)}`).catch(error => {
      this.logger.error(error);
      return false;
    });

    return true;
  }

  async get_storage_statues() {
    // Get the storage status for each bay.
    const open_work_orders = await this.get_open_work_orders();
    const locations = await this.get_storage_locations();
    const lockouts = await this.lockouts.get_lockouts();
    let storage_status = [];
  
    this.logger.debug(`targeting ${open_work_orders.length} open work orders`)
    this.logger.debug(`targeting ${lockouts.length} lockouts`)

    for (let location in locations) {
      // Check if a work order is in this location
      location = locations[location];

      let work_orders = [];
      for (const wo in open_work_orders) {
        if (open_work_orders[wo]['payload'].location == undefined) continue; // Skip if no location set

        // Check if the work order is in this location
        if (open_work_orders[wo]['payload'].location.id == location.id) {
          work_orders.push(open_work_orders[wo]);
        }
      }

      this.logger.debug(`found ${work_orders.length} work orders in location ${location.name}`)

      // Check for a lockout
      for (const lockout in lockouts) {
        if (lockouts[lockout].bay == location.id) {
          work_orders.push({
            "type": "lockout",
            "payload": lockouts[lockout]
          })
        }
      }

      // Add the location to the storage status
      if (work_orders.length > 1) {
        storage_status.push({
          "id": location.id,
          "name": location.name,
          "location_type": location.type,
          "clashing_work_orders": work_orders,
          "error": "clash"
        })

        this.logger.warn(`clash detected at location ${location.id} (loc name: ${location.name})! Found ${work_orders.length} w/os`)
      } else {
        storage_status.push({
            "id": location.id,
            "name": location.name,
            "location_type": location.type,
            "work_order": work_orders[0]
        })
      }
    }

    this.logger.debug(`resolved ${storage_status.length} storage locations`);
    return storage_status;
  };

  async get_customer(pcid) {
    // Get a customer from it's ID, usually from a work order.
    this.logger.debug(`getting customer ${pcid}`)
    const result = await this.connection.query(`SELECT * FROM pc_owner WHERE pcid = ${mysql.escape(pcid)}`)
    
    if (result.length == 0) {
      throw new Error(`invalid_customer`);
    } 

    const cust = result[0];
    const customer = {
      "id": cust.pcid,
      "name": cust.pcname,
      "device": cust.pcmake,
      "company": cust.pccompany || "Individual"
    }

    return customer;
  }

  async add_private_note(woid, note) {
    // Add a private note to the work order
    this.logger.debug(`adding private note to ${woid} - ${note}`)
    const date = new Date().toISOString().slice(0, 19).replace('T', ' ');

    await this.connection.query(`INSERT INTO wonotes (notetype, thenote, noteuser, notetime, woid) VALUES (1, ${mysql.escape(note)}, 'Scanner', ${mysql.escape(date)}, ${mysql.escape(woid)})`).catch(error => {
      this.logger.error(error);
      return false;
    })

    return true;
  }

  async get_private_notes(woid) {
    // Get private notes for a work order
    this.logger.debug(`getting private notes for ${woid}`)
    const result = await this.connection.query(`SELECT * FROM wonotes WHERE woid = ${mysql.escape(woid)} AND notetype = 1`)
    let notes = [];

    for (let note in result) {
      notes.push({
        "id": result[note].noteid,
        "content": result[note].thenote,
        "author": result[note].noteuser,
        "timestamp": result[note].notetime
      })
    }
    
    return notes.reverse();
  }

  async get_public_notes(woid) {
    // Get public notes for a work order
    this.logger.debug(`getting public notes for ${woid}`)
    const result = await this.connection.query(`SELECT * FROM wonotes WHERE woid = ${mysql.escape(woid)} AND notetype = 0`)
    let notes = [];

    for (let note in result) {
      notes.push({
        "id": result[note].noteid,
        "content": result[note].thenote,
        "author": result[note].noteuser,
        "timestamp": result[note].notetime
      })
    }

    return notes.reverse();
  }

  async get_job_labour(woid) {
    // Get the labour costs for a job
    // Automatically includes the VAT. TODO: Possibly make this configurable.
    this.logger.debug(`getting labour costs for ${woid}`)

    let labour = {
      "cost": 0,
      "tasks": []
    }

    const result = await this.connection.query(`SELECT * FROM repaircart WHERE pcwo = ${mysql.escape(woid)}`);
    if (result.length == 0) return false;

    for (let task in result) {
      task = result[task];
      const cost = task['unit_price'] + task['itemtax'];
      labour.cost += cost;
      labour.tasks.push({
        "name": task.labor_desc,
        "cost": cost
      });
      
      this.logger.debug(`added ${task.labor_desc} at £${cost} to ${woid} task.`);
    }

    return labour;
  }
}

exports.Database = Database;