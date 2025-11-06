const WebSocket = require('ws');

const ws = new WebSocket('wss://il7omaw929.execute-api.us-east-2.amazonaws.com/prod');

ws.on('open', function open() {
  console.log('✅ Connected successfully');
  console.log('Connection established at:', new Date().toISOString());
  
  // Keep alive for 5 seconds
  setTimeout(() => {
    console.log('Closing connection...');
    ws.close();
  }, 5000);
});

ws.on('message', function message(data) {
  console.log('📨 Message received:', data.toString());
});

ws.on('error', function error(err) {
  console.error('❌ WebSocket error:', err.message);
  console.error('Error code:', err.code);
  console.error('Error details:', err);
});

ws.on('close', function close(code, reason) {
  console.log('🔌 Connection closed');
  console.log('Close code:', code);
  console.log('Close reason:', reason.toString());
  process.exit(0);
});

// Timeout if connection doesn't open in 10 seconds
setTimeout(() => {
  if (ws.readyState !== WebSocket.OPEN) {
    console.error('⏱️  Connection timeout');
    ws.close();
  }
}, 10000);
