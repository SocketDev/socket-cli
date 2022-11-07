# Socket CLI

## Commands

* `report create` - creates a report

## Environment variables

* `SOCKET_SECURITY_API_KEY` - if set, this will be used as the API-key

### Environment variables for development

* `SOCKET_SECURITY_API_BASE_URL` - if set, this will be the base for all API-calls. Defaults to `https://api.socket.dev/v0/`
* `SOCKET_SECURITY_API_PROXY` - if set to something like [`http://127.0.0.1:9090`](https://docs.proxyman.io/troubleshooting/couldnt-see-any-requests-from-3rd-party-network-libraries), then all request will be proxied through that proxy
