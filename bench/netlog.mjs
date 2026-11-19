// bench/netlog.mjs — C8's evidence: records the host of every outgoing connection this process opens (http, https and
// fetch all open their sockets through net.Socket.prototype.connect). Import it FIRST, before anything that might connect.
import net from 'node:net';

const hosts = new Map();
const LOCAL = new Set(['127.0.0.1', 'localhost', '::1']);
const hostOf = (a) => {
  const [a0, a1] = a;
  if (a0 && typeof a0 === 'object') return a0.path ? 'unix:' + a0.path : String(a0.host || 'localhost');
  if (typeof a0 === 'number' || /^\d+$/.test(String(a0))) return String(a1 && typeof a1 === 'string' ? a1 : 'localhost');
  return 'unix:' + String(a0);
};
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...a) {
  try {
    const h = hostOf(Array.isArray(a[0]) ? a[0] : a);
    hosts.set(h, (hosts.get(h) || 0) + 1);
  } catch { hosts.set('unreadable', (hosts.get('unreadable') || 0) + 1); }
  return connect.apply(this, a);
};

// report() → { connections: [[host, count]…], outside: [hosts that are not this machine], localOnly }
export function report() {
  const connections = [...hosts.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1));
  const outside = connections.map(([h]) => h).filter((h) => !LOCAL.has(h) && !h.startsWith('unix:'));
  return { connections, outside, localOnly: outside.length === 0 };
}
export default { report };
