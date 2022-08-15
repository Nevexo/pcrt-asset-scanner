// PCRT-Scan - HTML Frontend
// Triarom Engineering (c) 2022

const config = {
  "server": "http://localhost:3500",
  "api_vers": 1
}

const state_icons = {
  "storage": "bi bi-box-fill",
  "on_bench": "bi bi-screwdriver",
  "pending_cust_response": "bi bi-question-circle-fill",
  "complete": "bi bi-check-circle-fill",
  "collected": "bi bi-check-circle-fill",
  "data_transfer": "bi bi-device-hdd-fill",
  "awaiting_parts": "bi bi-tools",
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
  }

  async show(title, body) {
    this.title.innerHTML = title;
    this.body.innerHTML = body;
    await this.modal.show()
  };

  async hide() {await this.modal.hide()};
}

class ErrorModal {
  constructor() {
    this.icon = document.getElementById("error-modal-icon");
    this.heading = document.getElementById("error-modal-heading");
    this.text = document.getElementById("error-modal-text");
    this.modal = new bootstrap.Modal("#error-modal");
  }

  async show(icon, heading, text) {
    this.icon.className = icon || "bi bi-exclamation-triangle-fill";
    this.heading.innerHTML = heading;
    this.text.innerHTML = text;
    await this.modal.show({'backdrop': 'static', 'keyboard': false})
  };

  async hide() {await this.modal.hide()};
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
      "problem": document.getElementById("scan-modal-problem")
    }
    this.buttons = document.getElementById("scan-modal-actions");
    this.modal = new bootstrap.Modal("#scan-modal");
  }

  async show(scan_data) {
    const work_order = scan_data.work_order;
    const wo_options = scan_data.options;

    this.title.innerHTML = `<i class="bi bi-qr-code"></i> Scanned Work Order - ${work_order.customer.name} (${work_order.customer.id})`;
    this.items.owner.innerHTML = `Owner: <i class="bi bi-person-fill"></i> ${work_order.customer.name} (${work_order.customer.company})`;
    this.items.status.innerHTML = `Status: <i class="${state_icons[work_order.status.pcrt_scan_state.name]}"></i> ${work_order.status.name}`;
    this.items.problem.innerHTML = `${work_order.problem}`;

    this.modal.show({'backdrop': 'static', 'keyboard': false});
  }

  async hide() {await this.modal.hide()};
}

const main = async () => {
  const loading_modal = new LoadingModal();
  const toast = new ToastAlert();
  const info = new InfoModal();
  const error_modal = new ErrorModal();
  const scan_modal = new ScanModal();

  const status_text = document.getElementById("scan-status");

  const socket = await io(config.server);

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
    scan_modal.hide();

    scan_modal.show(data);
  })

  socket.on('server_error', async (error) => {
    error_modal.hide();
    loading_modal.hide();
    scan_modal.hide();

    error_modal.show("bi bi-exclamation-triangle-fill", error.error, error.message);
  })

  socket.on('info', async (info) => {
    await toast.show("Server Info", info.message, info.type);
  })
}

main();