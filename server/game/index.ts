// The game server: the referee that holds the whole game (host.ts) and its web endpoints
// (http.ts). The launcher runs it beside the game's files; `npm run dev` runs it too.
export { GameHost, type Schedule } from './host';
export { handleGameApi, json, readJson } from './http';
export { Refused, type GameService } from './service';
