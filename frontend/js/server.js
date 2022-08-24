// PCRT-Scan - HTML Frontend
// Triarom Engineering (c) 2022

let socket;

const config = {
  "server": "http://localhost:3500",
  "api_vers": 1
}

const state_icons = {
  "storage": "bi bi-box-fill",
  "on_bench": "bi bi-screwdriver",
  "pending_cust_response": "bi bi-person-fill",
  "complete": "bi bi-check-circle-fill",
  "collected": "bi bi-check-circle-fill",
  "data_transfer": "bi bi-device-hdd-fill",
  "awaiting_parts": "bi bi-tools",
}

const state_colours = {
  "storage": "btn-primary",
  "on_bench": "btn-info",
  "pending_cust_response": "btn-warning",
  "complete": "btn-success",
  "data_transfer": "btn-warning",
  "awaiting_parts": "btn-danger"
}

const slice_array = (arr, chunkSize) => {
  // Derived from https://stackabuse.com/how-to-split-an-array-into-even-chunks-in-javascript/
  let res = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
      const chunk = arr.slice(i, i + chunkSize);
      res.push(chunk);
  }
  return res;
}

class LoadingModal {
  constructor() {
    this.message = "Thinking about it...";
    this.message_box = document.getElementById("loading-modal-text");
    this.message_box.innerText = this.message;
    this.modal = new bootstrap.Modal("#loading-modal");
  }

  async show(message = "Twiddling thumbs..") {
    this.message_box.innerText = message;
    await this.modal.show({'backdrop': 'static', 'keyboard': false})
  };

  async hide() {await this.modal.hide()};
}

class InfoModal {
  constructor() {
    this.title = document.getElementById("info-modal-title");
    this.body = document.getElementById("info-modal-body");
    this.modal = new bootstrap.Modal("#info-modal");
    this.visible = false;
  }

  async show(title, body) {
    this.title.innerHTML = title;
    this.body.innerHTML = body;
    await this.modal.show()
    this.visible = true;
  };

  async hide() {
    if (this.visible) await this.modal.hide()
    this.visible = false;
  };
}

class ErrorModal {
  constructor() {
    this.icon = document.getElementById("error-modal-icon");
    this.heading = document.getElementById("error-modal-heading");
    this.text = document.getElementById("error-modal-text");
    this.modal = new bootstrap.Modal("#error-modal");
    this.visible = false;
  }

  async show(icon, heading, text) {
    this.icon.className = icon || "bi bi-exclamation-triangle-fill";
    this.heading.innerHTML = heading;
    this.text.innerHTML = text;
    await this.modal.show({'backdrop': 'static', 'keyboard': false})
    this.visible = true;
  };

  async hide() {
    if (this.visible) await this.modal.hide()
    this.visible = false;
  };
}

class ToastAlert {
  constructor() {
    this.toast_title = document.getElementById("toast-alert-title");
    this.toast_small = document.getElementById("toast-alert-small");
    this.toast_body = document.getElementById("toast-alert-body");
    this.toast = new bootstrap.Toast("#toast-alert");
  }

  async show(title = "Toast", content = "Toast message", small = "") {
    this.toast_title.innerText = title;
    this.toast_body.innerText = content;
    this.toast_small.innerText = small;
    await this.toast.show({});
  }

  async hide() {await this.toast.hide()};
}

class ScanModal {
  constructor() {
    this.title = document.getElementById("scan-modal-label");
    this.items = {
      "owner": document.getElementById("scan-modal-owner"),
      "status": document.getElementById("scan-modal-current-status"),
      "problem": document.getElementById("scan-modal-problem"),
      "location": document.getElementById("scan-modal-location")
    }
    this.buttons = document.getElementById("scan-modal-actions");
    this.modal = new bootstrap.Modal("#scan-modal");
    this.visible = false;
  }

  async show(scan_data) {
    const work_order = scan_data.work_order;
    const buttons = gen_action_buttons(scan_data.work_order.id, scan_data.options.states || [])

    this.title.innerHTML = `<i class="bi bi-qr-code"></i> Scanned Work Order - ${work_order.customer.name} (${work_order.customer.id})`;
    this.items.owner.innerHTML = `Owner: <i class="bi bi-person-fill"></i> ${work_order.customer.name} (${work_order.customer.company})`;
    this.items.status.innerHTML = `Status: <i class="${state_icons[work_order.status.pcrt_scan_state.name]}"></i> ${work_order.status.name}`;
    this.items.problem.innerHTML = `${work_order.problem}`;

    if (scan_data.work_order.location != undefined) {
      this.items.location.innerHTML = `Asset Location: <b>${scan_data.work_order.location.name}</b>`;
    }

    this.buttons.innerHTML = buttons;

    this.modal.show({'backdrop': 'static', 'keyboard': false});
    this.visible = true;
  }

  async hide() {
    if (this.visible) await this.modal.hide()
    this.visible = false;
  };
}

const request_refresh = async () => {
  // Request a new storage status poll
  const toast = new ToastAlert();
  const dom_container_pending = document.getElementById("grid-data-pending");

  socket.emit("request_refresh");
  dom_container_pending.style.display = "block";
  await toast.show("Refresh Requested", "Refreshing storage view...", "Pending")
}

const gen_action_buttons = (woid, actions) => {
  // Generate buttons 
  let html = "<div class='row'>";

  for (let action in actions) {
    action = actions[action];

    // Resolve icon for action
    const icon = state_icons[action['pcrt_scan_state']['name']] || "bi bi-app";

    // Resolve button colour to class
    const colour = state_colours[action['pcrt_scan_state']['name']] || "btn-primary"

    // Resolve button name - prefer alias from PCRT-Scan.
    const name = action['pcrt_scan_state']['alias'] || action['name']

    html += "<div class='col'>"
    html += '<div class="btn-group" style="width:100%">'
    html += `<button type="button" onclick="perform_action('${action['pcrt_scan_state']['name']}', ${woid}); return true;" class="btn btn-block ${colour}"><i class="${icon}"></i> ${name}</button>`
    html += "</div></div>"
  }

  html += "</div>";
  return html;
}

const action_modal = new LoadingModal();

const perform_action = async (action_id, woid) => {
  const toast = new ToastAlert();
  console.log(`perform action ${action_id} on w/o ${woid}`)
  scan_modal.hide();
  
  await toast.show("Performing action", `Applying ${action_id} on work order ${woid}`, woid);
  action_modal.show("Applying changes");

  socket.emit("apply_action", {
    "action_id": action_id,
    "work_order": woid
  })
}

const loading_modal = new LoadingModal();
const toast = new ToastAlert();
const info = new InfoModal();
const error_modal = new ErrorModal();
const scan_modal = new ScanModal();

const main = async () => {

  const status_text = document.getElementById("scan-status");

  socket = await io(config.server);

  socket.on('connect', async () => {
    console.log('Connected to server!');
    toast.show("Connected", "Connected to PCRT-Scan backend", "Just Now");
    await loading_modal.hide();
  })

  socket.on('hello', async (data) => {
    await loading_modal.hide();
    toast.show("Server Hello", "Got hello from server!", "Just Now");

    // Confirm API version
    if (data.api_version != config.api_vers) {
      info.show("API Version Mismatch", "The server is running an incompatible API version. Please update your client.");
    }

    // Check scanner status
    if (!data.scanner_ready) {
      error_modal.show("bi bi-upc-scan", "Scanner Disconnected", "Please check the services and USB cables to ensure the scanner is connected.")
    } else {
      status_text.innerText = "Ready to Scan";
      status_text.className = "text-success";
    }
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from server!');
    toast.show("Disconnected", "Lost connection from local server.", "Just Now")
    loading_modal.show("Reconnecting to server...");
  })

  socket.on('scanner_status', async (status) => {
    console.log("Scanner status:", status);
    
    if (status.status == "disconnected") {
      error_modal.show("bi bi-upc-scan", "Scanner Disconnected", "Please check the services and USB cables to ensure the scanner is connected.")
      status_text.innerText = "Not Ready";
      status_text.className = "text-danger";
    } else {
      error_modal.hide();
      status_text.innerText = "Ready to Scan";
      status_text.className = "text-success";
    }
  })

  socket.on('scan', async (data) => {
    console.log("Scan data:", data);
    error_modal.hide();
    loading_modal.hide();

    scan_modal.show(data);
  })

  socket.on('ack_action', async (data) => {
    // Server has acknolodged an action, close the modal.
    console.log("Got server ack for action, ack data:");
    console.dir(data)
    await action_modal.hide();

    // Show alerts if the server sent any.
    if (data['alert'] != undefined) {
      await info.show("System Alert", data['alert']);
    } 

    // Don't continue if the location info modal isn't required.
    if (!data['location_info_required']) return;

    if (data['location_changed']) {
      // A new location has been selected, inform the user they must use this location.
      await info.show("Location Chosen Automatically", `Please place this device in <b>${data.location.name}</b> <br><br><i class="bi bi-info-circle-fill"></i> If this bay is not available, please manually update it in PCRT and click refresh on the dashboard.<br><br><i class="bi bi-info-circle-fill"></i> <b>Please Note: </b> If this device has been moved between states, a new location may have been chosen. Please pay attention to this!`);
    } else {
      await info.show("Return Asset to Location", `Please return this asset to it's storage bay <b>${data.location.name}.</b>`)
    }
  })

  socket.on('storage_state', async (storage_bays) => {
    // Handle new storage bay information. This is either requested or sent on an interval.
    const dom_container = document.getElementById("grid");
    const dom_container_pending = document.getElementById("grid-data-pending");
    dom_container_pending.style.display = "block";

    // Split storage bays into sections (by the storage_type)
    // For example, the A prefixed bays in our installation are 'work-in-progress' this is show the bays can be split correctly.
    // TODO: This will need refactoring to make the system portable - as will a lot of the project.
    let types = {};

    for (const bay_name in storage_bays) {
      const bay = storage_bays[bay_name];

      if (!types.hasOwnProperty(bay['location_type'])) {
        // Create a new location type
        types[bay['location_type']] = [];
      }

      types[bay['location_type']].push(bay);
    }

    // Process each of the storage bay types into an array for gridgen
    let entries = [];

    for (const type_id in types) {
      const type = types[type_id];
      let type_entries = [];

      if (type.length > 5) {
        // MAGIC NUMBERS HERE.
        // There are a large number of bays of this type, so we'll split them across multiple rows.
        type_entries = slice_array(type, 4)
      } else {
        type_entries = [type]
      }

      // Format this style of array into that expected by gridgen.
      for (let row in type_entries) {
        row = type_entries[row];
        let entry_row = []

        for (let col in row) {
          col = row[col];
          let entry_col = {
            "title": col['name']
          }

          if (col.hasOwnProperty('work_order')) {
            // Bay is in use
            switch(col['work_order']['status']['id']) {
              case 1: 
                // In storage
                entry_col['status'] = "wip";
                break;
              case 2:
                // On the bench
                entry_col['status'] = "bench";
                break;
              case 4:
                // Complete
                entry_col['status'] = "complete";
                break;
              case 3:
                // Waiting for customer
                entry_col['status'] = "customer";
                break;
              case 101:
                // Waiting for parts
                entry_col['status'] = "parts";
                break;
              default:
                // Any other system status
                entry_col['status'] = "bench";
                break;
            }

            entry_col['bay_status'] = col['work_order']['customer']['name'];

          } else {
            entry_col['status'] = "available";
            entry_col['bay_status'] = "Available."
          }

          entry_row.push(entry_col)
        }

        entries.push(entry_row)
      }
    }

    dom_container.innerHTML = gen_grid(entries)
    dom_container_pending.style.display = "none";

  })

  socket.on('server_error', async (error) => {
    loading_modal.hide();
    scan_modal.hide();

    error_modal.show("bi bi-exclamation-triangle-fill", error.error, error.message);
  })

  socket.on('info', async (info) => {
    await toast.show("Server Info", info.message, info.type);
  })

  // Send refresh message to server every 5 minutes
  // TODO: potentially move this to server logic, to stop multiple clients from requesting a refresh at once.
  setInterval(async () => {
    await socket.emit("request_refresh")
  }, 5 * 60 * 1000)
}

main();