#!/usr/bin/env node

/**
 * WebSocket Connection Test Script
 * Tests the WebSocket endpoint for connection stability
 */

const WebSocket = require('ws');

const WS_URL = process.env.VITE_WEBSOCKET_URL || 'wss://il7omaw929.execute-api.us-east-2.amazonaws.com/prod';

console.log('\n🔌 WebSocket Connection Test');
console.log('━'.repeat(50));
console.log(`URL: ${WS_URL}\n`);

let connectionCount = 0;
const maxConnections = 5;
const connectionDelay = 2000; // 2 seconds between connections

function testConnection(connectionNumber) {
  return new Promise((resolve) => {
    console.log(`\n📡 Test ${connectionNumber}/${maxConnections}: Connecting...`);
    const startTime = Date.now();
    let connected = false;

    const ws = new WebSocket(WS_URL);

    const timeout = setTimeout(() => {
      if (!connected) {
        console.log(`❌ Test ${connectionNumber}: Connection timeout after 10s`);
        ws.close();
        resolve({ success: false, error: 'timeout', duration: 10000 });
      }
    }, 10000);

    ws.on('open', () => {
      connected = true;
      clearTimeout(timeout);
      const duration = Date.now() - startTime;
      console.log(`✅ Test ${connectionNumber}: Connected successfully in ${duration}ms`);

      // Send ping message
      ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      console.log(`📤 Test ${connectionNumber}: Sent ping message`);

      // Close after 3 seconds
      setTimeout(() => {
        ws.close(1000, 'Test complete');
        resolve({ success: true, duration });
      }, 3000);
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log(`📨 Test ${connectionNumber}: Received message:`, message.type || 'unknown');
      } catch (error) {
        console.log(`📨 Test ${connectionNumber}: Received raw message:`, data.toString());
      }
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;
      console.log(`❌ Test ${connectionNumber}: Error - ${error.message}`);
      resolve({ success: false, error: error.message, duration });
    });

    ws.on('close', (code, reason) => {
      clearTimeout(timeout);
      if (!connected) {
        const duration = Date.now() - startTime;
        console.log(`❌ Test ${connectionNumber}: Closed before connecting - Code: ${code}, Reason: ${reason || 'none'}`);
        resolve({ success: false, error: `closed-${code}`, duration });
      }
    });
  });
}

async function runTests() {
  const results = [];

  for (let i = 1; i <= maxConnections; i++) {
    const result = await testConnection(i);
    results.push(result);

    if (i < maxConnections) {
      console.log(`\n⏳ Waiting ${connectionDelay}ms before next test...`);
      await new Promise(resolve => setTimeout(resolve, connectionDelay));
    }
  }

  // Summary
  console.log('\n' + '━'.repeat(50));
  console.log('📊 Test Summary');
  console.log('━'.repeat(50));

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;

  console.log(`Total Tests: ${results.length}`);
  console.log(`✅ Successful: ${successful}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⏱️  Average Connection Time: ${avgDuration.toFixed(0)}ms`);

  if (failed > 0) {
    console.log('\n❌ Failed Test Details:');
    results.forEach((result, index) => {
      if (!result.success) {
        console.log(`  Test ${index + 1}: ${result.error} (${result.duration}ms)`);
      }
    });
  }

  console.log('\n' + '━'.repeat(50));

  if (successful === maxConnections) {
    console.log('✅ All tests passed! WebSocket is working correctly.');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed. Check the logs above.');
    process.exit(1);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('\n❌ Test script error:', error);
  process.exit(1);
});
