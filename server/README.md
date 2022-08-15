# PCRT Asset Scanner Backend

This Node.JS based server handles interaction with the PCRT MySQL database, it can either run on the same machine
as PCRT, the asset scanning frontend or it's own server entirely.

In our installation, the backend runs on the same server as the frontend and has a WireGuard tunnel to the PCRT server,
which runs the MySQL server.

Please see the config.yaml file for configuration.

## WARNING

The server currently has no provision for authentication - meaning all requests to the server will be accepted. 
It is currently expected that the server is protected by firewall, and/or set to only listen on the asset scanning machine.