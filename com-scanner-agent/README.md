# Serial-based Scanner Agent

This `Scanner Agent` is used for connecting serial/COM based scanners to the PCRT-Scan control service.

By default, it will check all serial devices for any with the "TMS" vendor tag, this can be manually overwritten by
setting the `SCANNER_MANUFACTURER` environment variable.

Alternatively, if you know the port the scanner will appear on you can manually specify it with the `PORT_OVERRIDE` variable.

## Setup

The scanner must be in USB-COM/serial mode. You'll be able to find this in the instruction manual, it's likely
a barcode that once scanned changes the mode. Note that this will break compatibility mode with software that relies
on HID mode or USB-POS.

Connect the scanner to the host, you'll see it appear in the serial devices list.

If you changed the scanner listen port for the control service, you must set `API_SERVER_URL` to the full Socket.IO URL.
E.g., `http://localhost:3500`

## Operation

Specify the vendor using `SCANNER_MANUFACTURER`, `PORT_OVERRIDE` or allow autodetect to find it.

Ensure the control server is running and displays `Listening for scanner agents on port X`

Start the service with `node index.js`

The scanner will be available to the control server.