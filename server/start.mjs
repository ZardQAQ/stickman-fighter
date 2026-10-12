import http from 'node:http';
import os from 'node:os';
import { createServer as createVite } from 'vite';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 5173);
const httpServer = http.createServer();
const vite = await createVite({
  server: { middlewareMode: true, allowedHosts: true },
  appType: 'spa',
});
const { createHub } = await vite.ssrLoadModule('/server/hub.ts');
const hub = createHub();

httpServer.on('request', (req, res) => {
  if (hub.http(req, res)) return;
  vite.middlewares(req, res, () => {
    res.statusCode = 404;
    res.end('Not Found');
  });
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
wss.on('connection', socket => hub.connect(socket));

httpServer.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(net => net && net.family === 'IPv4' && !net.internal).map(net => net.address);
  console.log('Stickman Fighter 联机');
  console.log(`本机: http://127.0.0.1:${PORT}`);
  for (const ip of ips) console.log(`局域网: http://${ip}:${PORT}`);
  console.log('官方房间已就绪。两边打开同一地址，输入昵称后加入即可。');
});

function shutdown() {
  hub.close();
  wss.close();
  httpServer.close();
  vite.close().finally(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
