# COM-Scanner-Agent

This `scanner agent` finds a "TMS" branded scanner connected to the host and connects it to the PCRT-Scan server.

This will be rewritten at some point, it is a very temporary tool for testing PCRT-Scan.

## Operation

Connect your scanner to the host machine.

Check the port is set correctly in index.js and start the server.

On non-unix hosts, the COM port must be manually specified, this can be done by setting the PORT_OVERRIDE environment variable with a path, I.e., COM10.