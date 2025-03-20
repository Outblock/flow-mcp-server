#!/usr/bin/env node
// This shebang supports both Node.js and Bun environments
// For Bun-specific environments, you can change this back to #!/usr/bin/env bun
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import SSE from 'express-sse';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';

import { handleToolCall } from './tools/handler.js';
import { toolDefinitions } from './tools/definitions.js';
import { parseArgs, showHelp } from './cli.js';
import { networks } from './config/networks.js';
import { log, error } from './utils/logger.js';

// Load environment variables
dotenv.config();

// Get package.json for version info
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8')
);

// Parse command line arguments
const config = parseArgs();

// Show help and exit if requested
if (config.help) {
  showHelp();
  process.exit(0);
}

// Show version and exit if requested
if (config.version) {
  log(`Flow MCP Server v${packageJson.version}`);
  process.exit(0);
}

// Validate network
if (!networks[config.network.toLowerCase()]) {
  error(`Error: Unsupported network "${config.network}"`);
  log(`Available networks: ${Object.keys(networks).join(', ')}`);
  process.exit(1);
}

// Set network configuration
if (!process.env.FLOW_NETWORK) {
  process.env.FLOW_NETWORK = config.network;
}

// Set default access node based on network if not specified
if (!process.env.FLOW_ACCESS_NODE && !config.accessNode) {
  const networkConfig = networks[config.network.toLowerCase()];
  process.env.FLOW_ACCESS_NODE = networkConfig.accessNode;
} else if (config.accessNode) {
  process.env.FLOW_ACCESS_NODE = config.accessNode;
}

// Check if running in stdio mode
const isStdioMode = process.argv.includes('--stdio');
const port = config.port;

// Initialize SSE for streaming responses
const sse = new SSE();

// Start HTTP server if not in stdio mode
if (!isStdioMode) {
  // Initialize Express app
  const app = express();
  
  // Middleware
  app.use(bodyParser.json());
  app.use(cors());

  // Routes
  app.get('/', (req, res) => {
    res.json({
      name: 'flow-mcp-server',
      version: packageJson.version,
      description: 'Model Context Protocol (MCP) server for Flow blockchain with direct RPC communication',
      network: process.env.FLOW_NETWORK
    });
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // SSE endpoint
  app.get('/sse', (req, res) => {
    sse.init(req, res);
  });

  // MCP messages endpoint
  app.post('/messages', async (req, res) => {
    const { tool, parameters } = req.body;
    
    if (!tool) {
      return res.status(400).json({ error: 'Tool name is required' });
    }
    
    try {
      const result = await handleToolCall(tool, parameters, sse);
      res.json({ result });
    } catch (err) {
      error('Error handling tool call:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // MCP tools metadata endpoint
  app.get('/tools', (req, res) => {
    res.json(toolDefinitions);
  });

  // Network information endpoint
  app.get('/networks', (req, res) => {
    const network = process.env.FLOW_NETWORK.toLowerCase();
    res.json({
      current: network,
      available: Object.keys(networks),
      accessNode: process.env.FLOW_ACCESS_NODE,
      contracts: networks[network].contracts,
      auditors: networks[network].auditors
    });
  });

  // Start HTTP server
  const startServer = (port) => {
    try {
      const server = app.listen(port, () => {
        log(`Flow MCP server v${packageJson.version} listening on port ${port}`);
        log(`Using Flow network: ${process.env.FLOW_NETWORK}`);
        log(`Using Flow access node: ${process.env.FLOW_ACCESS_NODE}`);
        log(`FCL configured with ${Object.keys(networks[process.env.FLOW_NETWORK.toLowerCase()].contracts).length} contract addresses`);
      });
      
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          log(`Port ${port} is in use, trying ${port + 1}...`);
          startServer(port + 1);
        } else {
          error('Server error:', err);
        }
      });
    } catch (err) {
      error('Failed to start server:', err);
    }
  };
  
  startServer(port);
}

// Handle stdio mode
if (isStdioMode) {
  // In stdio mode, we don't output any logs to avoid corrupting the JSON communication
  process.stdin.setEncoding('utf8');
  let buffer = '';
  
  process.stdin.on('data', async (chunk) => {
    buffer += chunk;
    
    try {
      // Try to parse complete JSON objects
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep the last incomplete line in the buffer
      
      for (const line of lines) {
        if (line.trim()) {
          const { tool, parameters } = JSON.parse(line);
          const result = await handleToolCall(tool, parameters);
          process.stdout.write(JSON.stringify({ result }) + '\n');
        }
      }
    } catch (err) {
      // If JSON parsing fails, it might be an incomplete message
      // Just continue collecting more data
      if (buffer.length > 1000000) {
        // Safety limit to prevent memory issues
        buffer = '';
        process.stdout.write(JSON.stringify({ error: 'Message too large' }) + '\n');
      }
    }
  });
}

export default express();