// Connecting players' programs: opening the host's router port (UPnP, NAT-PMP), the
// public address and CGNAT check, the connection code, and the host's TLS identity.
// Pure Node; nothing here imports the game engine.
export { addressKind, defaultGateway, localAddressFor, type AddressKind, type Gateway } from './addresses';
export { checkHost, classifyRouterAddress, explainHostCheck, lookupPublicAddress, PUBLIC_IP_SERVICES, type HostCheck, type HostCheckOptions, type RouterKind } from './network';
export { openPort, PortMapError, type MapFailure, type PortMapOptions, type PortMapping } from './portmap';
export { decodeJoinCode, encodeJoinCode, JoinCodeError, newJoinPassword, passwordsMatch, type JoinInfo } from './joincode';
export { connectToHost, createHostIdentity, fingerprintOf, HostIdentityError, tlsServerOptions, type HostIdentity } from './identity';
