// Tables of friends (phase 4 of multiplayer): hosting one with a join code, joining one,
// and the endpoints a game window uses for both. See src/net/lobby.ts.
export { Lobby } from './lobby';
export { handleApi, handleLobbyApi } from './http';
export { HOST_PORT, type HostingOptions } from './hosting';
export { APP_VERSION } from './version';
